// Sessions mémorisées sur l'appareil (localStorage). Seul un jeton aléatoire est stocké :
// aucune donnée personnelle, aucun compte.

export interface Session {
  code: string;
  token: string;
}

const KEY_PLAYER = 'imposteurs.player';
const KEY_GM = 'imposteurs.gm';
const KEY_TERRAIN = 'imposteurs.terrain';
const KEY_SETTINGS = 'imposteurs.settings';

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée) : la session ne survivra pas à un rechargement */
  }
}

export const sessions = {
  player: () => read<Session>(KEY_PLAYER),
  setPlayer: (s?: Session) => write(KEY_PLAYER, s),
  gm: () => read<Session & { secret?: string }>(KEY_GM),
  setGm: (s?: Session & { secret?: string }) => write(KEY_GM, s),
  terrain: () => read<unknown>(KEY_TERRAIN),
  setTerrain: (t: unknown) => write(KEY_TERRAIN, t),
  settings: () => read<unknown>(KEY_SETTINGS),
  setSettings: (t: unknown) => write(KEY_SETTINGS, t),
};

export function storageAvailable(): boolean {
  try {
    localStorage.setItem('imposteurs.test', '1');
    localStorage.removeItem('imposteurs.test');
    return true;
  } catch {
    return false;
  }
}
