// Notifications « push » standard du Web (RFC 8030), sans service payant :
// - VAPID (RFC 8292) : le serveur de partie signe ses envois avec une clé générée automatiquement ;
// - chiffrement du contenu aes128gcm (RFC 8291) : seul le téléphone destinataire peut le lire.
// Uniquement WebCrypto : fonctionne dans Cloudflare Workers, dans Node (tests) et dans le navigateur.

export interface PushSubscriptionData {
  endpoint: string;
  p256dh: string; // clé publique du navigateur (base64url, 65 octets)
  auth: string; // secret d'authentification (base64url, 16 octets)
}

export interface VapidKeys {
  publicKey: string; // base64url du point P-256 non compressé (65 octets)
  privateJwk: JsonWebKey;
}

const enc = new TextEncoder();

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}

/** Clés VAPID d'une partie (générées une fois, gardées sur le serveur). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer;
  const privateJwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  return { publicKey: b64u(pub), privateJwk };
}

/** En-tête Authorization VAPID : jeton JWT ES256 limité à l'origine du service de push. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...keys.privateJwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Paire de clés éphémère de l'émetteur (forçable dans les tests pour rejouer le vecteur de la RFC 8291). */
export interface SenderKeys {
  publicRaw: Uint8Array;
  privateKey: CryptoKey;
}

export async function ephemeralKeys(): Promise<SenderKeys> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { publicRaw: new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer), privateKey: kp.privateKey };
}

/** Importe une clé privée ECDH à partir de sa composante d (base64url) et de sa clé publique brute. */
export async function importSenderKeys(dB64: string, publicB64: string): Promise<SenderKeys> {
  const pub = unb64u(publicB64);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: dB64, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return { publicRaw: pub, privateKey };
}

/** Chiffre un message pour un abonnement (RFC 8291, un seul enregistrement de 4096 octets). */
export async function encryptPayload(plaintext: Uint8Array, sub: Pick<PushSubscriptionData, 'p256dh' | 'auth'>, sender?: SenderKeys, salt?: Uint8Array): Promise<Uint8Array> {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('abonnement push invalide');
  const as = sender ?? (await ephemeralKeys());
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as never, as.privateKey, 256));
  // HKDF « à la main » (HMAC-SHA256) pour suivre exactement la RFC
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, as.publicRaw);
  const ikm = (await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(saltBytes, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, concat(plaintext, new Uint8Array([2])) as BufferSource));
  const header = new Uint8Array(21 + as.publicRaw.length);
  header.set(saltBytes, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = as.publicRaw.length;
  header.set(as.publicRaw, 21);
  return concat(header, cipher);
}

/** Services de push officiels des navigateurs : aucun autre hôte n'est contacté (évite d'utiliser le serveur comme relais). */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.mozaws\.net$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];

export function validSubscription(x: unknown): PushSubscriptionData | undefined {
  const o = (x ?? {}) as Record<string, any>;
  const endpoint = String(o.endpoint ?? '');
  const p256dh = String(o.keys?.p256dh ?? o.p256dh ?? '');
  const auth = String(o.keys?.auth ?? o.auth ?? '');
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || endpoint.length > 1000 || !PUSH_HOSTS.some((r) => r.test(u.hostname))) return undefined;
    if (unb64u(p256dh).length !== 65 || unb64u(auth).length < 16) return undefined;
  } catch {
    return undefined;
  }
  return { endpoint, p256dh, auth };
}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  urgent?: boolean;
}

/** Prépare la requête HTTP vers le service de push du téléphone. */
export async function buildPushRequest(sub: PushSubscriptionData, msg: PushMessage, keys: VapidKeys, subject: string): Promise<{ url: string; init: RequestInit }> {
  const body = await encryptPayload(enc.encode(JSON.stringify(msg)), sub);
  return {
    url: sub.endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '120',
        Urgency: 'high',
        Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'jeu',
        Authorization: await vapidAuthorization(sub.endpoint, keys, subject),
      },
      body: body as BodyInit,
    },
  };
}
