// Aléatoire : cryptographique pour tout ce qui touche au secret (rôles, codes),
// déterministe (graine) uniquement pour générer les énigmes imprimables.

export interface Rng {
  /** Entier uniforme dans [0, n). */
  int(n: number): number;
}

/** Générateur cryptographique sans biais (rejet des valeurs hors plage). */
export const cryptoRng: Rng = {
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new Error('n invalide');
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  },
};

/** PRNG déterministe (mulberry32) — NE PAS utiliser pour des secrets. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (n: number) => Math.floor(next() * n) };
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[rng.int(arr.length)];
}

/** Alphabet sans caractères ambigus (pas de 0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const GAME_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ23456789';

export function randomCode(len: number, rng: Rng = cryptoRng, alphabet = CODE_ALPHABET): string {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[rng.int(alphabet.length)];
  return s;
}

export function randomDigits(len: number, rng: Rng = cryptoRng): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String(rng.int(10));
  return s;
}

export function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Normalise un code saisi à la main ou lu dans un QR code (URL acceptée). */
export function normalizeCode(input: string): string {
  let s = String(input ?? '').trim();
  const slash = s.lastIndexOf('/');
  if (slash >= 0) s = s.slice(slash + 1);
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, 12);
}
