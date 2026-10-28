// Lecture des QR codes et des codes tapés à la main (fonctions pures, testées unitairement).

/** Adresse encodée dans le QR code affiché par le téléphone d'un corps. */
export function bodyUrl(code: string, origin = location.origin) {
  return `${origin}/#/c/${code}`;
}

/** Code de corps lu dans un QR code affiché par un téléphone de « corps » (…/#/c/1234), ou transmis par un lien (c:1234). */
export function bodyCodeOf(raw: string): string | undefined {
  const m = /(?:#\/c\/|^c:)(\d{4})\s*$/.exec(raw.trim());
  return m?.[1];
}

/** QR code d'un poste (…/#/s/CODE) ou code tapé à la main ; tout autre QR code (affiche d'invitation…) est ignoré sans rien envoyer. */
export function stationCodeOf(raw: string): string | undefined {
  const t = raw.trim();
  if (/^[A-Za-z0-9 -]{3,8}$/.test(t)) return t;
  const m = /#\/s\/([A-Za-z0-9-]{3,8})\s*$/.exec(t);
  return m?.[1];
}
