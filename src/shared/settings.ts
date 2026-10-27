import type { Settings } from './types';

/**
 * Paramètres par défaut.
 * Entre parenthèses : la valeur par défaut du jeu vidéo officiel lorsqu'elle diffère
 * (les durées sont allongées car les joueurs marchent dans une vraie maison).
 */
export const DEFAULT_SETTINGS: Settings = {
  maxPlayers: 40,
  impostors: 3,
  killCooldownSec: 60, // officiel : 45 s (10–60)
  initialKillCooldownSec: 30, // officiel : 10 s au premier tour
  killCodeTtlSec: 45,
  emergencyMeetingsPerPlayer: 1, // officiel : 1
  emergencyCooldownSec: 30, // officiel : 15 s
  gatherSec: 90, // n'existe pas dans le jeu vidéo (téléportation)
  discussionSec: 90, // officiel : 15 s
  votingSec: 90, // officiel : 120 s
  resultSec: 12,
  anonymousVotes: false, // officiel : désactivé
  confirmEjects: true, // officiel : activé
  taskBarUpdates: 'always', // officiel : toujours
  commonTasks: 1, // officiel : 1
  longTasks: 1, // officiel : 1
  shortTasks: 2, // officiel : 2
  visualTasks: true, // officiel : activé
  sabotageCooldownSec: 30, // officiel : 30 s
  initialSabotageCooldownSec: 10, // officiel : 10 s
  reactorSec: 75, // officiel : 30 à 60 s selon la carte
  oxygenSec: 90, // officiel : 30 à 45 s
  doorsSec: 20, // officiel : 10 s
  bodyTimeoutSec: 180,
  ghostsSeeRoles: false,
};

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

export const SETTING_BOUNDS: Record<NumKey, [number, number]> = {
  maxPlayers: [4, 60],
  impostors: [1, 10],
  killCooldownSec: [10, 600],
  initialKillCooldownSec: [5, 600],
  killCodeTtlSec: [15, 180],
  emergencyMeetingsPerPlayer: [0, 9],
  emergencyCooldownSec: [0, 300],
  gatherSec: [15, 600],
  discussionSec: [0, 600],
  votingSec: [15, 600],
  resultSec: [5, 60],
  commonTasks: [0, 4],
  longTasks: [0, 5],
  shortTasks: [0, 10],
  sabotageCooldownSec: [10, 600],
  initialSabotageCooldownSec: [5, 600],
  reactorSec: [30, 600],
  oxygenSec: [30, 600],
  doorsSec: [10, 120],
  bodyTimeoutSec: [0, 1800],
};

/** Valide et borne des paramètres venant du client (le navigateur n'est jamais cru sur parole). */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Settings = { ...base };
  for (const key of Object.keys(SETTING_BOUNDS) as NumKey[]) {
    if (key in src) {
      const n = Number(src[key]);
      if (Number.isFinite(n)) {
        const [lo, hi] = SETTING_BOUNDS[key];
        out[key] = Math.min(hi, Math.max(lo, Math.round(n)));
      }
    }
  }
  for (const key of ['anonymousVotes', 'confirmEjects', 'visualTasks', 'ghostsSeeRoles'] as const) {
    if (key in src) out[key] = Boolean(src[key]);
  }
  if (src.taskBarUpdates === 'always' || src.taskBarUpdates === 'meetings' || src.taskBarUpdates === 'never') {
    out.taskBarUpdates = src.taskBarUpdates;
  }
  return out;
}

/** Nombre d'imposteurs conseillé (le jeu officiel plafonne à 3 pour 15 joueurs). */
export function recommendedImpostors(players: number): number {
  if (players <= 6) return 1;
  if (players <= 10) return 2;
  if (players <= 17) return 3;
  if (players <= 24) return 4;
  if (players <= 32) return 5;
  return 6;
}

/** Le nombre d'imposteurs doit rester strictement inférieur au nombre de membres d'équipage. */
export function maxImpostorsFor(players: number): number {
  return Math.max(0, Math.floor((players - 1) / 2));
}
