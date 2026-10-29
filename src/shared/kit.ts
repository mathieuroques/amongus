// Kit de fiches universel : 40 fiches « Poste » et 8 fiches spéciales imprimées une fois pour toutes,
// valables pour toutes les parties et toutes les maisons (PDF prêt à imprimer : docs/pdf/kit-fiches.pdf).
// Sur place, le MJ appaire chaque fiche posée avec sa pièce ; une fiche non appairée n'existe pas pour le jeu.
// Les tâches sont réparties automatiquement sur les fiches appairées, à chaque changement.
//
// NE MODIFIEZ JAMAIS les codes, identifiants, noms, graines et fiches attitrées ci-dessous : des fiches déjà
// imprimées ne correspondraient plus. Un test fige ces valeurs. On peut seulement AJOUTER des fiches en fin de liste.

import type { GameKind, Room, Station, StationKind, TaskDef, TaskType, Terrain } from './types';

export interface KitSheet {
  id: string;
  name: string;
  kind: StationKind;
  code: string;
}

const CODES = 'EWTX FKQS PPBY HN8J MWVB PAS5 M4SS ZVJC KNXA NEXC TC8G CZHG 5QNG STMM GSUQ K2ZP TM22 A9EY 29UW 4G49 MV6U XVEN FFZ9 RFCU RC9F ZY9D ANGK BBSS CMN6 MRTV CR6N 6BQM PD9Q XJA5 3MCV 6Z8Y YP5H SCTJ GE7B U8K9 FVHX F4F5 TY94 5V8V ZCBU 53XR VECB RXSY'.split(' ');

export const KIT_TASK_SHEETS = 40;
const num = (i: number) => String(i + 1).padStart(2, '0');

export const KIT_SHEETS: readonly KitSheet[] = [
  ...Array.from({ length: KIT_TASK_SHEETS }, (_, i): KitSheet => ({ id: `k${num(i)}`, name: `Poste ${num(i)}`, kind: 'task', code: CODES[i] })),
  { id: 'kurg', name: 'Bouton d’urgence', kind: 'emergency', code: CODES[40] },
  { id: 'krea1', name: 'Réacteur A', kind: 'reactor', code: CODES[41] },
  { id: 'krea2', name: 'Réacteur B', kind: 'reactor', code: CODES[42] },
  { id: 'koxy1', name: 'Oxygène A', kind: 'oxygen', code: CODES[43] },
  { id: 'koxy2', name: 'Oxygène B', kind: 'oxygen', code: CODES[44] },
  { id: 'kener', name: 'Poste Énergie (fictif)', kind: 'lights', code: CODES[45] },
  { id: 'kradio', name: 'Poste Radio', kind: 'comms', code: CODES[46] },
  { id: 'kvie', name: 'Moniteur de vie', kind: 'vitals', code: CODES[47] },
];

const BY_ID = new Map(KIT_SHEETS.map((k) => [k.id, k]));
const BY_CODE = new Map(KIT_SHEETS.map((k) => [k.code, k]));
export const kitSheet = (id: string) => BY_ID.get(id);
export const kitSheetByCode = (code: string) => BY_CODE.get(code);

interface KitTask {
  id: string;
  name: string;
  type: TaskType;
  seed: number;
  /** sheet : fiche attitrée, sur laquelle l'énigme est imprimée ou devant laquelle la croix est collée. */
  steps: { game: GameKind; sheet?: string }[];
}

const T = (id: number, name: string, type: TaskType, seed: number, ...steps: (GameKind | [GameKind, string])[]): KitTask => ({
  id: `kt${num(id - 1)}`,
  name,
  type,
  seed,
  steps: steps.map((s) => (Array.isArray(s) ? { game: s[0], sheet: s[1] } : { game: s })),
});

/** Catalogue des tâches du kit (40 étapes : chacune des 40 fiches a une tâche quand toutes sont posées). */
export const KIT_TASKS: readonly KitTask[] = [
  T(1, 'Badge d’accès', 'common', 1350807201, 'swipe'),
  T(2, 'Réparer les câbles', 'common', 279331856, 'wires'),
  T(3, 'Transfert de données', 'long', 1789423370, 'wait', 'wait'),
  T(4, 'Réaligner les moteurs', 'long', 902118447, 'slider', 'slider'),
  T(5, 'Démarrer le réacteur', 'long', 1503978112, 'sequence', 'calibrate'),
  T(6, 'Énigme du coffre', 'long', 492817364, ['count', 'k03'], ['assemble', 'k04']),
  T(7, 'Séquence de démarrage', 'short', 66109473, 'sequence'),
  T(8, 'Déverrouillage', 'short', 1174663020, 'order'),
  T(9, 'Calibrage', 'short', 2034519988, 'calibrate'),
  T(10, 'Nettoyage des filtres', 'short', 381900571, 'targets'),
  T(11, 'Scan médical', 'short', 1650183329, ['scan', 'k05']),
  T(12, 'Inventaire', 'short', 734921577, ['count', 'k01']),
  T(13, 'Puzzle', 'short', 1846290315, ['assemble', 'k02']),
  T(14, 'Câblage secondaire', 'short', 1268514907, 'wires'),
  T(15, 'Alignement de l’antenne', 'short', 577230186, 'slider'),
  T(16, 'Réglage du bouclier', 'short', 1931046651, 'calibrate'),
  T(17, 'Code de sécurité', 'short', 120385944, 'order'),
  T(18, 'Diagnostic des systèmes', 'short', 1427759302, 'sequence'),
  T(19, 'Téléchargement', 'short', 849016613, 'wait'),
  T(20, 'Tri des déchets', 'short', 1712358190, 'targets'),
  T(21, 'Raccordement électrique', 'short', 305567728, 'wires'),
  T(22, 'Pilotage', 'short', 1093328851, 'slider'),
  T(23, 'Contrôle d’identité', 'short', 1999021457, 'swipe'),
  T(24, 'Mise à jour du logiciel', 'short', 656381092, 'wait'),
  T(25, 'Purge des conduits', 'short', 1380442876, 'targets'),
  T(26, 'Stabilisation', 'short', 211763405, 'slider'),
  T(27, 'Combinaison du coffre-fort', 'short', 1585300219, 'order'),
  T(28, 'Réglage de la pression', 'short', 943627738, 'calibrate'),
  T(29, 'Branchement des capteurs', 'short', 1820094461, 'wires'),
  T(30, 'Réparation du hublot', 'short', 432985117, 'targets'),
  T(31, 'Calibrage du radar', 'short', 1136650370, 'calibrate'),
  T(32, 'Vérification des fusibles', 'short', 761294958, 'wires'),
  T(33, 'Saisie des coordonnées', 'short', 1654480203, 'order'),
  T(34, 'Synchronisation', 'short', 29573831, 'sequence'),
  T(35, 'Équilibrage du moteur', 'short', 1247006694, 'slider'),
  T(36, 'Sauvegarde des données', 'short', 1043829815, 'wait'),
];

/** Ce qu'il faut préparer avec une fiche (imprimé sur la fiche du MJ et vérifié par les tests). */
export function kitSheetExtras(id: string): { game: GameKind; seed: number; task: string }[] {
  return KIT_TASKS.flatMap((k) => k.steps.filter((st) => st.sheet === id).map((st) => ({ game: st.game, seed: k.seed, task: k.name })));
}

/**
 * Tâches d'un terrain du kit, recalculées à partir des fiches appairées : une tâche dont la fiche attitrée
 * n'est pas posée n'existe pas ; les autres étapes vont au poste le moins chargé, dans une autre pièce que
 * les autres étapes de la même tâche quand c'est possible. Même entrée, même résultat.
 */
export function kitTasks(stations: Station[], rooms: Room[]): TaskDef[] {
  const playable = new Set(rooms.filter((r) => !r.forbidden && !r.transit).map((r) => r.id));
  const posted = KIT_SHEETS.filter((k) => k.kind === 'task')
    .map((k) => stations.find((s) => s.id === k.id && s.kind === 'task' && playable.has(s.roomId)))
    .filter((s): s is Station => !!s);
  if (!posted.length) return [];
  const load = new Map(posted.map((s) => [s.id, 0]));
  const roomOf = new Map(posted.map((s) => [s.id, s.roomId]));
  const tasks: TaskDef[] = KIT_TASKS.filter((k) => k.steps.every((st) => !st.sheet || load.has(st.sheet))).map((k) => ({
    id: k.id,
    name: k.name,
    type: k.type,
    enabled: true,
    seed: k.seed,
    steps: k.steps.map((st) => ({ stationId: st.sheet ?? '', game: st.game })),
  }));
  for (const k of tasks) for (const st of k.steps) if (st.stationId) load.set(st.stationId, load.get(st.stationId)! + 1);
  for (const k of tasks)
    for (const st of k.steps) {
      if (st.stationId) continue;
      const taken = new Set(k.steps.filter((x) => x.stationId).map((x) => roomOf.get(x.stationId)));
      const pick = [...posted].sort((a, b) => Number(taken.has(a.roomId)) - Number(taken.has(b.roomId)) || load.get(a.id)! - load.get(b.id)!)[0];
      st.stationId = pick.id;
      load.set(pick.id, load.get(pick.id)! + 1);
    }
  return tasks;
}

/** Terrain après appairage (roomId) ou retrait (roomId absent) d'une fiche ; tâches recalculées comme le fera le serveur. */
export function pairSheet(t: Terrain, sheetId: string, roomId?: string, newRoom?: Room): Terrain {
  const k = kitSheet(sheetId)!;
  const rooms = newRoom ? [...t.rooms, newRoom] : t.rooms;
  const stations = t.stations.filter((s) => s.id !== sheetId);
  if (roomId) stations.push({ id: k.id, name: k.name, kind: k.kind, code: k.code, roomId });
  stations.sort((a, b) => KIT_SHEETS.findIndex((x) => x.id === a.id) - KIT_SHEETS.findIndex((x) => x.id === b.id));
  const playable = rooms.filter((r) => !r.forbidden && !r.transit);
  let meetingRoomId = t.meetingRoomId;
  // la salle de réunion suit le bouton d'urgence (premier appairage, ou déplacement depuis la salle de réunion) ;
  // un autre choix du MJ est gardé ensuite. Même règle de secours que le serveur (sanitizeTerrain).
  const before = t.stations.find((s) => s.id === k.id);
  const valid = (id: string) => playable.some((r) => r.id === id);
  if (k.kind === 'emergency' && roomId && (!before || before.roomId === meetingRoomId || !valid(meetingRoomId))) meetingRoomId = roomId;
  if (!valid(meetingRoomId)) meetingRoomId = stations.find((s) => s.kind === 'emergency')?.roomId ?? playable[0]?.id ?? '';
  return { ...t, rooms, stations, meetingRoomId, tasks: kitTasks(stations, rooms) };
}
