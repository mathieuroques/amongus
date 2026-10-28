import { describe, expect, it } from 'vitest';
import { b64u, buildPushRequest, encryptPayload, generateVapidKeys, importSenderKeys, unb64u, validSubscription, vapidAuthorization } from '../src/shared/webpush';

// Vecteur de test officiel : RFC 8291, section 5 et annexe A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('notifications push (chiffrement RFC 8291 / VAPID RFC 8292)', () => {
  it('reproduit exactement le message chiffré de la RFC 8291', async () => {
    const sender = await importSenderKeys(RFC.asPrivate, RFC.asPublic);
    const out = await encryptPayload(new TextEncoder().encode(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, sender, unb64u(RFC.salt));
    expect(b64u(out)).toBe(RFC.body);
  });

  it('produit un jeton VAPID ES256 vérifiable avec la clé publique', async () => {
    const keys = await generateVapidKeys();
    expect(unb64u(keys.publicKey)).toHaveLength(65);
    const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:mj@example.invalid', 1_000_000);
    const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43200, sub: 'mailto:mj@example.invalid' });
    const pub = await crypto.subtle.importKey('raw', unb64u(keys.publicKey) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]) as BufferSource, new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });

  it('refuse les abonnements vers un hôte inconnu (pas de relais vers n’importe quel site)', () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    expect(validSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys })).toBeDefined();
    expect(validSubscription({ endpoint: 'https://web.push.apple.com/abc', keys })).toBeDefined();
    expect(validSubscription({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', keys })).toBeDefined();
    expect(validSubscription({ endpoint: 'https://evil.example.com/x', keys })).toBeUndefined();
    expect(validSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys })).toBeUndefined();
    expect(validSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'abc', auth: RFC.auth } })).toBeUndefined();
  });

  it('aller-retour : le téléphone destinataire déchiffre exactement la notification envoyée', async () => {
    // « téléphone » : paire ECDH + secret d'authentification, comme le ferait le navigateur
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPub = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', p256dh: b64u(uaPub), auth: b64u(auth) };
    const msg = { title: '📣 RÉUNION !', body: 'Rejoignez le salon', tag: 'meeting', urgent: true };
    const keys = await generateVapidKeys();
    const { url, init } = await buildPushRequest(sub, msg, keys, 'https://imposteurs.example.workers.dev');
    expect(url).toBe(sub.endpoint);
    const h = init.headers as Record<string, string>;
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.Urgency).toBe('high');
    expect(h.Authorization).toMatch(/^vapid t=.+, k=/);
    // déchiffrement RFC 8291 côté récepteur
    const B = (x: Uint8Array) => x as unknown as BufferSource;
    const body = init.body as Uint8Array;
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    expect(rs).toBe(4096);
    const asPub = body.slice(21, 21 + body[20]);
    const cipher = body.slice(21 + body[20]);
    const asKey = await crypto.subtle.importKey('raw', B(asPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as never, ua.privateKey, 256));
    const hmac = async (k: Uint8Array, d: Uint8Array) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', B(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), B(d)));
    const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
    const te = new TextEncoder();
    const prkKey = await hmac(auth, ecdh);
    const ikm = (await hmac(prkKey, cat(te.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
    const prk = await hmac(salt, ikm);
    const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
    const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B(nonce) }, await crypto.subtle.importKey('raw', B(cek), { name: 'AES-GCM' }, false, ['decrypt']), B(cipher)));
    expect(plain[plain.length - 1]).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))).toEqual(msg);
  });
});
