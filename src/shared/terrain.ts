// Configuration du terrain (la maison) : pièces, postes, tâches, passages.
// Le maître du jeu peut tout modifier sans programmer ; ce module fournit un terrain
// d'exemple, un générateur automatique et la validation des données reçues.

import { GAMES } from './catalog';
import { CODE_ALPHABET, cryptoRng, randomCode, seededRng, type Rng } from './rng';
import type { GameKind, Passage, Room, SabotageKind, Settings, Station, StationKind, TaskDef, TaskType, Terrain } from './types';

interface TaskTemplate {
  name: string;
  type: TaskType;
  games: GameKind[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  { name: 'Badge d’accès', type: 'common', games: ['swipe'] },
  { name: 'Réparer les câbles', type: 'common', games: ['wires'] },
  { name: 'Transfert de données', type: 'long', games: ['wait', 'wait'] },
  { name: 'Réaligner les moteurs', type: 'long', games: ['slider', 'slider'] },
  { name: 'Démarrer le réacteur', type: 'long', games: ['sequence', 'calibrate'] },
  { name: 'Énigme du coffre', type: 'long', games: ['count', 'assemble'] },
  { name: 'Séquence de démarrage', type: 'short', games: ['sequence'] },
  { name: 'Déverrouillage', type: 'short', games: ['order'] },
  { name: 'Calibrage', type: 'short', games: ['calibrate'] },
  { name: 'Nettoyage des filtres', type: 'short', games: ['targets'] },
  { name: 'Scan médical', type: 'short', games: ['scan'] },
  { name: 'Inventaire', type: 'short', games: ['count'] },
  { name: 'Puzzle', type: 'short', games: ['assemble'] },
  { name: 'Câblage secondaire', type: 'short', games: ['wires'] },
  { name: 'Alignement de l’antenne', type: 'short', games: ['slider'] },
];

export interface RoomSeed {
  name: string;
  floor?: string;
  forbidden?: boolean;
  transit?: boolean;
}

export const EXAMPLE_ROOMS: RoomSeed[] = [
  { name: 'Salon', floor: 'Rez-de-chaussée' },
  { name: 'Cuisine', floor: 'Rez-de-chaussée' },
  { name: 'Salle à manger', floor: 'Rez-de-chaussée' },
  { name: 'Entrée', floor: 'Rez-de-chaussée' },
  { name: 'Bureau', floor: 'Rez-de-chaussée' },
  { name: 'Buanderie', floor: 'Rez-de-chaussée' },
  { name: 'Escalier', floor: 'Entre les étages', transit: true },
  { name: 'Couloir de l’étage', floor: 'Étage', transit: true },
  { name: 'Chambre 1', floor: 'Étage' },
  { name: 'Chambre 2', floor: 'Étage' },
  { name: 'Salle de jeux', floor: 'Étage' },
  { name: 'Salle de bain', floor: 'Étage' },
  { name: 'Chambre parentale', floor: 'Étage', forbidden: true },
];

const DEFAULT_SAFETY =
  'Ne courez jamais, surtout dans l’escalier et les couloirs. Les portes ne sont jamais verrouillées. ' +
  'Les zones interdites ne sont accessibles à personne. Aucune élimination dans l’escalier ni dans une zone de passage. ' +
  'Sortie de secours : porte d’entrée. En cas de problème, appuyez sur « Alerte sécurité » ou prévenez le maître du jeu.';

export function newId(prefix: string, rng: Rng = cryptoRng): string {
  return prefix + randomCode(6, rng, 'abcdefghijkmnpqrstuvwxyz23456789');
}

function uniqueCode(used: Set<string>, rng: Rng): string {
  for (;;) {
    const c = randomCode(4, rng, CODE_ALPHABET);
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
}

/**
 * Génère un terrain complet à partir d'une simple liste de pièces :
 * un poste de tâches par pièce jouable, le bouton d'urgence dans la salle de réunion,
 * les postes de sabotage répartis dans des pièces différentes et un catalogue de tâches.
 */
export function generateTerrain(seeds: RoomSeed[], meetingIndex = 0, rng: Rng = cryptoRng, name = 'Ma maison'): Terrain {
  const rooms: Room[] = seeds.map((s) => ({
    id: newId('r', rng),
    name: s.name.trim().slice(0, 40) || 'Pièce',
    floor: (s.floor ?? '').trim().slice(0, 30),
    forbidden: !!s.forbidden,
    transit: !!s.transit && !s.forbidden,
    hideAllowed: !s.forbidden && !s.transit,
    notes: '',
  }));
  const playable = rooms.filter((r) => !r.forbidden && !r.transit);
  if (playable.length === 0) throw new Error('Au moins une pièce jouable est nécessaire.');
  const meeting = rooms[meetingIndex] && !rooms[meetingIndex].forbidden && !rooms[meetingIndex].transit ? rooms[meetingIndex] : playable[0];
  const used = new Set<string>();
  const stations: Station[] = [];
  const add = (kind: StationKind, room: Room, label: string) => {
    const st: Station = { id: newId('s', rng), name: label, roomId: room.id, kind, code: uniqueCode(used, rng) };
    stations.push(st);
    return st;
  };
  add('emergency', meeting, 'Bouton d’urgence');
  const taskStations = playable.map((r) => add('task', r, `Poste ${r.name}`));

  // Postes spéciaux : on évite la salle de réunion et on alterne les étages quand c'est possible.
  const others = playable.filter((r) => r.id !== meeting.id);
  const pool = others.length >= 2 ? others : playable;
  const byFloor = new Map<string, Room[]>();
  for (const r of pool) byFloor.set(r.floor, [...(byFloor.get(r.floor) ?? []), r]);
  const spread: Room[] = [];
  const lists = [...byFloor.values()];
  for (let i = 0; spread.length < pool.length; i++) {
    for (const l of lists) if (l[i]) spread.push(l[i]);
  }
  const at = (i: number) => spread[i % spread.length];
  add('reactor', at(0), 'Réacteur A');
  add('reactor', at(Math.max(1, Math.floor(spread.length / 2))), 'Réacteur B');
  add('oxygen', at(1), 'Oxygène A');
  add('oxygen', at(Math.max(2, Math.floor(spread.length / 2) + 1)), 'Oxygène B');
  add('lights', at(2), 'Poste Énergie (fictif)');
  add('comms', at(3), 'Poste Radio');
  add('vitals', at(4), 'Moniteur de vie');

  const tasks = makeTasks(taskStations, rng);
  return { name, rooms, stations, tasks, passages: [], meetingRoomId: meeting.id, safetyNotes: DEFAULT_SAFETY };
}

/** Catalogue de tâches réparti sur les postes de tâches donnés. */
function makeTasks(taskStations: Station[], rng: Rng): TaskDef[] {
  const tasks: TaskDef[] = [];
  let cursor = 0;
  for (const t of TASK_TEMPLATES) {
    const steps = t.games.map((game, i) => {
      // la 2e étape d'une tâche longue se fait dans une autre pièce
      const st = taskStations[(cursor + i * Math.max(1, Math.ceil(taskStations.length / 2))) % taskStations.length];
      return { stationId: st.id, game };
    });
    cursor++;
    tasks.push({ id: newId('t', rng), name: t.name, type: t.type, steps, enabled: true, seed: rng.int(2 ** 31) });
  }
  return tasks;
}

/** Nom provisoire d'une pièce créée par blankTerrain (« Pièce A », « Pièce B »…). */
export const PLACEHOLDER_ROOM = /^Pièce [A-Z]{1,2}$/;

const letter = (i: number) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));

/** Fiches indispensables d'un terrain préparé à l'avance (A à F) : postes spéciaux, énigmes papier et scan au sol y sont tous. */
export const BLANK_CORE = 6;
export const BLANK_MAX = 40;

/** Tâches courtes supplémentaires : assez d'étapes pour que chacune des 40 fiches possibles ait une tâche. */
const EXTRA_TEMPLATES: TaskTemplate[] = [
  { name: 'Réglage du bouclier', type: 'short', games: ['calibrate'] },
  { name: 'Code de sécurité', type: 'short', games: ['order'] },
  { name: 'Diagnostic des systèmes', type: 'short', games: ['sequence'] },
  { name: 'Téléchargement', type: 'short', games: ['wait'] },
  { name: 'Tri des déchets', type: 'short', games: ['targets'] },
  { name: 'Raccordement électrique', type: 'short', games: ['wires'] },
  { name: 'Pilotage', type: 'short', games: ['slider'] },
  { name: 'Contrôle d’identité', type: 'short', games: ['swipe'] },
  { name: 'Mise à jour du logiciel', type: 'short', games: ['wait'] },
  { name: 'Purge des conduits', type: 'short', games: ['targets'] },
  { name: 'Stabilisation', type: 'short', games: ['slider'] },
  { name: 'Combinaison du coffre-fort', type: 'short', games: ['order'] },
  { name: 'Réglage de la pression', type: 'short', games: ['calibrate'] },
  { name: 'Branchement des capteurs', type: 'short', games: ['wires'] },
  { name: 'Réparation du hublot', type: 'short', games: ['targets'] },
  { name: 'Calibrage du radar', type: 'short', games: ['calibrate'] },
  { name: 'Vérification des fusibles', type: 'short', games: ['wires'] },
  { name: 'Saisie des coordonnées', type: 'short', games: ['order'] },
  { name: 'Synchronisation', type: 'short', games: ['sequence'] },
  { name: 'Équilibrage du moteur', type: 'short', games: ['slider'] },
  { name: 'Sauvegarde des données', type: 'short', games: ['wait'] },
];

/** Mini-jeu lié à ce qui est posé avec la fiche (énigme imprimée, croix au sol) : il ne change jamais de poste. */
export const isFixedGame = (g: GameKind) => !!GAMES[g].paper || g === 'scan';

const SEED_SPACE = CODE_ALPHABET.length ** 6;

/** Code de récupération : nombre de fiches + graine, par ex. « 30-K7QM2X ». */
export function makePrintCode(count: number, seed: number): string {
  let c = '';
  for (let i = 0, x = seed; i < 6; i++, x = Math.floor(x / CODE_ALPHABET.length)) c = CODE_ALPHABET[x % CODE_ALPHABET.length] + c;
  return `${count}-${c}`;
}

export function parsePrintCode(input: string): { count: number; seed: number } | undefined {
  const m = /^(\d{1,2})([A-Z0-9]{6})$/.exec(String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (!m) return undefined;
  const count = Number(m[1]);
  if (count < 1 || count > BLANK_MAX || [...m[2]].some((ch) => !CODE_ALPHABET.includes(ch))) return undefined;
  const seed = [...m[2]].reduce((x, ch) => x * CODE_ALPHABET.length + CODE_ALPHABET.indexOf(ch), 0);
  return { count, seed };
}

/**
 * Terrain pour imprimer les fiches avant de connaître la maison : des pièces provisoires
 * (Pièce A, Pièce B…) et des postes nommés par lettre (Poste A, Poste B…). Sur place, le MJ
 * renomme les pièces où il a posé une fiche puis retire les autres (removeUnplacedRooms) :
 * les postes suivent et les codes imprimés restent valables.
 *
 * Entièrement déterminé par le code de récupération : ne modifiez pas cette génération, sinon
 * des fiches déjà imprimées ne correspondraient plus (un test fige le résultat).
 */
export function blankTerrain(count: number, seed: number = cryptoRng.int(SEED_SPACE)): Terrain {
  const n = Math.max(1, Math.min(BLANK_MAX, Math.floor(count) || 1));
  seed = Math.abs(Math.floor(seed)) % SEED_SPACE;
  const rng = seededRng(seed);
  const rooms: Room[] = Array.from({ length: n }, (_, i) => ({ id: newId('r', rng), name: `Pièce ${letter(i)}`, floor: '', forbidden: false, transit: false, hideAllowed: true, notes: '' }));
  const used = new Set<string>();
  const stations: Station[] = [];
  const add = (kind: StationKind, room: Room, name: string) => {
    const st: Station = { id: newId('s', rng), name, roomId: room.id, kind, code: uniqueCode(used, rng) };
    stations.push(st);
    return st;
  };
  add('emergency', rooms[0], 'Bouton d’urgence');
  const taskStations = rooms.map((r, i) => add('task', r, `Poste ${letter(i)}`));
  // postes spéciaux sur B à F (A, la salle de réunion, a le bouton d'urgence) : réacteurs B et D, oxygène C et E
  const core = rooms.slice(0, BLANK_CORE);
  const spot = (i: number) => core[core.length > 1 ? 1 + (i % (core.length - 1)) : 0];
  add('reactor', spot(0), 'Réacteur A');
  add('oxygen', spot(1), 'Oxygène A');
  add('reactor', spot(2), 'Réacteur B');
  add('oxygen', spot(3), 'Oxygène B');
  add('lights', spot(4), 'Poste Énergie (fictif)');
  add('comms', spot(5), 'Poste Radio');
  add('vitals', spot(6), 'Moniteur de vie');

  const templates = [...TASK_TEMPLATES, ...EXTRA_TEMPLATES];
  const tasks: TaskDef[] = templates.map((tp) => ({ id: newId('t', rng), name: tp.name, type: tp.type, steps: [], enabled: true, seed: rng.int(2 ** 31) }));
  const load = new Map(taskStations.map((s) => [s.id, 0]));
  // d'abord les étapes liées à la fiche, sur A à F ; puis les autres, chacune au poste le moins chargé
  for (const fixed of [true, false]) {
    tasks.forEach((k, ti) =>
      templates[ti].games.forEach((game, gi) => {
        if (isFixedGame(game) !== fixed) return;
        const taken = new Set(k.steps.filter(Boolean).map((st) => st.stationId));
        const pool = fixed ? taskStations.slice(0, BLANK_CORE) : taskStations;
        const pick = [...pool].sort((x, y) => Number(taken.has(x.id)) - Number(taken.has(y.id)) || load.get(x.id)! - load.get(y.id)!)[0];
        load.set(pick.id, load.get(pick.id)! + 1);
        k.steps[gi] = { stationId: pick.id, game };
      }),
    );
  }
  return { name: 'Ma maison', rooms, stations, tasks, passages: [], meetingRoomId: rooms[0].id, safetyNotes: DEFAULT_SAFETY, printCode: makePrintCode(n, seed) };
}

/**
 * Sur place : retire les pièces restées au nom provisoire (fiches imprimées en trop, jamais posées)
 * et leurs postes de tâches, comme s'ils n'avaient jamais existé. Les étapes de tâches qui s'y
 * trouvaient passent sur les postes posés (les moins chargés, dans une autre pièce que les autres
 * étapes de la tâche) ; une tâche liée à une fiche non posée (énigme imprimée, croix au sol) est
 * supprimée. Chaque poste posé garde au moins une tâche. Les codes des postes posés ne changent pas.
 */
export function removeUnplacedRooms(t: Terrain): Terrain {
  const gone = new Set(t.rooms.filter((r) => PLACEHOLDER_ROOM.test(r.name)).map((r) => r.id));
  if (!gone.size) return t;
  const roomName = (id: string) => t.rooms.find((r) => r.id === id)?.name;
  const stuck = t.stations.filter((s) => s.kind !== 'task' && gone.has(s.roomId));
  if (stuck.length)
    throw new Error(
      `${stuck.map((s) => `« ${s.name} » (${roomName(s.roomId)})`).join(', ')} : ces fiches spéciales seraient retirées. Les postes A à F sont indispensables : posez-les et renommez leurs pièces, ou indiquez dans la liste des postes la pièce où chaque fiche spéciale est posée.`,
    );
  const stations = t.stations.filter((s) => !gone.has(s.roomId));
  const kept = stations.filter((s) => s.kind === 'task');
  if (!kept.length) throw new Error('Aucun poste de tâches posé : renommez d’abord les pièces où vous avez posé les fiches.');
  const roomOf = new Map(stations.map((s) => [s.id, s.roomId]));
  const tasks = t.tasks
    .filter((k) => !k.steps.some((st) => !roomOf.has(st.stationId) && isFixedGame(st.game)))
    .map((k) => ({ ...k, steps: k.steps.map((st) => ({ ...st })) }));
  const load = new Map(kept.map((s) => [s.id, 0]));
  const count = (k: TaskDef, id: string, d: number) => k.enabled && load.set(id, load.get(id)! + d);
  for (const k of tasks) for (const st of k.steps) if (load.has(st.stationId)) count(k, st.stationId, 1);
  const roomsOf = (k: TaskDef, except?: object) => new Set(k.steps.filter((x) => x !== except && roomOf.has(x.stationId)).map((x) => roomOf.get(x.stationId)));
  for (const k of tasks) {
    for (const st of k.steps) {
      if (roomOf.has(st.stationId)) continue;
      const taken = roomsOf(k, st);
      const pick = [...kept].sort((a, b) => Number(taken.has(a.roomId)) - Number(taken.has(b.roomId)) || load.get(a.id)! - load.get(b.id)!)[0];
      st.stationId = pick.id;
      count(k, pick.id, 1);
    }
  }
  // un poste posé sans tâche reçoit une étape d'un poste qui en a plusieurs (jamais une étape liée à sa fiche)
  for (const empty of kept.filter((s) => load.get(s.id) === 0)) {
    const movable = (k: TaskDef, st: TaskDef['steps'][number]) => k.enabled && !isFixedGame(st.game) && load.get(st.stationId)! > 1;
    const k = tasks.find((x) => !roomsOf(x).has(empty.roomId) && x.steps.some((st) => movable(x, st)));
    const st = k?.steps.find((x) => movable(k, x));
    if (!k || !st) continue;
    count(k, st.stationId, -1);
    st.stationId = empty.id;
    count(k, empty.id, 1);
  }
  const rooms = t.rooms.filter((r) => !gone.has(r.id));
  const meetingRoomId = gone.has(t.meetingRoomId) ? (stations.find((s) => s.kind === 'emergency')?.roomId ?? rooms.find((r) => !r.forbidden && !r.transit)?.id ?? '') : t.meetingRoomId;
  const passages = t.passages.filter((p) => !gone.has(p.fromRoomId) && !gone.has(p.toRoomId));
  return { ...t, rooms, stations, tasks, passages, meetingRoomId };
}

/**
 * Remet toutes les fiches imprimées (code de récupération) : après un retrait trop rapide, ou sur un
 * nouvel appareil / une nouvelle partie. Si le terrain actuel vient du même code, ce qui a été saisi
 * sur place est conservé (noms et étages des pièces, pièces ajoutées, pièce de chaque poste, réglages).
 */
export function restorePrinted(current: Terrain, code: string | undefined = current.printCode): Terrain {
  const p = parsePrintCode(code ?? '');
  if (!p) throw new Error('Code de récupération invalide (exemple : 30-K7QM2X).');
  const full = blankTerrain(p.count, p.seed);
  if (current.printCode !== full.printCode) return { ...full, safetyNotes: current.safetyNotes || full.safetyNotes };
  // pièces actuelles (renommées sur place) + pièces provisoires retirées entre-temps
  const rooms = [...current.rooms.map((r) => ({ ...r })), ...full.rooms.filter((r) => !current.rooms.some((x) => x.id === r.id)).map((r) => ({ ...r }))];
  const playable = (id: string) => rooms.some((r) => r.id === id && !r.forbidden && !r.transit);
  const spare = new Map<string, Room>();
  const stations = full.stations.map((s) => {
    const c = current.stations.find((x) => x.id === s.id);
    if (c && playable(c.roomId)) return { ...s, roomId: c.roomId };
    if (playable(s.roomId)) return s;
    // sa pièce d'origine est devenue une zone interdite ou de passage : nouvelle pièce provisoire à son nom d'origine
    if (!spare.has(s.roomId)) {
      const r: Room = { ...full.rooms.find((x) => x.id === s.roomId)!, id: newId('r') };
      spare.set(s.roomId, r);
      rooms.push(r);
    }
    return { ...s, roomId: spare.get(s.roomId)!.id };
  });
  const ids = new Set(rooms.map((r) => r.id));
  return {
    ...current,
    rooms,
    stations,
    tasks: full.tasks,
    passages: current.passages.filter((x) => ids.has(x.fromRoomId) && ids.has(x.toRoomId)),
    meetingRoomId: ids.has(current.meetingRoomId) ? current.meetingRoomId : full.meetingRoomId,
  };
}

export function exampleTerrain(rng: Rng = cryptoRng): Terrain {
  // Pas de « conduit » par défaut : seul le MJ sait si sa maison offre un second itinéraire sûr.
  return generateTerrain(EXAMPLE_ROOMS, 0, rng, 'Maison d\u2019exemple');
}

const GAME_KINDS = Object.keys(GAMES) as GameKind[];
const STATION_KINDS: StationKind[] = ['task', 'emergency', 'reactor', 'oxygen', 'lights', 'comms', 'vitals'];

const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const id = (v: unknown) => str(v, 24).replace(/[^a-zA-Z0-9_-]/g, '');

/** Valide un terrain envoyé par le navigateur du maître du jeu. Lève une erreur lisible si invalide. */
export function sanitizeTerrain(input: unknown): Terrain {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const rooms: Room[] = (Array.isArray(src.rooms) ? src.rooms : []).slice(0, 60).map((r: any) => ({
    id: id(r?.id) || newId('r'),
    name: str(r?.name, 40) || 'Pièce',
    floor: str(r?.floor, 30),
    forbidden: !!r?.forbidden,
    transit: !!r?.transit && !r?.forbidden,
    hideAllowed: !!r?.hideAllowed,
    notes: str(r?.notes, 200),
  }));
  const roomIds = new Set(rooms.map((r) => r.id));
  if (roomIds.size !== rooms.length) throw new Error('Identifiants de pièces en double.');
  const usedCodes = new Set<string>();
  const stations: Station[] = (Array.isArray(src.stations) ? src.stations : []).slice(0, 120).map((s: any) => {
    const kind = STATION_KINDS.includes(s?.kind) ? s.kind : 'task';
    let code = str(s?.code, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4 || [...code].some((c) => !CODE_ALPHABET.includes(c)) || usedCodes.has(code)) {
      code = uniqueCode(usedCodes, cryptoRng);
    } else usedCodes.add(code);
    return { id: id(s?.id) || newId('s'), name: str(s?.name, 40) || 'Poste', roomId: id(s?.roomId), kind, code };
  });
  for (const s of stations) {
    if (!roomIds.has(s.roomId)) throw new Error(`Le poste « ${s.name} » n'est rattaché à aucune pièce.`);
    const room = rooms.find((r) => r.id === s.roomId)!;
    if (room.forbidden || room.transit) throw new Error(`Le poste « ${s.name} » est dans une zone interdite ou de passage.`);
  }
  const stationIds = new Set(stations.map((s) => s.id));
  if (stationIds.size !== stations.length) throw new Error('Identifiants de postes en double.');
  const tasks: TaskDef[] = (Array.isArray(src.tasks) ? src.tasks : []).slice(0, 80).map((t: any) => {
    const type: TaskType = t?.type === 'common' || t?.type === 'long' ? t.type : 'short';
    const steps = (Array.isArray(t?.steps) ? t.steps : []).slice(0, 4).map((st: any) => ({
      stationId: id(st?.stationId),
      game: GAME_KINDS.includes(st?.game) ? st.game : 'wires',
    }));
    return {
      id: id(t?.id) || newId('t'),
      name: str(t?.name, 40) || 'Tâche',
      type,
      steps,
      enabled: t?.enabled !== false,
      seed: Number.isInteger(t?.seed) ? Math.abs(t.seed) % 2 ** 31 : cryptoRng.int(2 ** 31),
    };
  });
  for (const t of tasks) {
    if (t.steps.length === 0) throw new Error(`La tâche « ${t.name} » n'a aucune étape.`);
    for (const st of t.steps) {
      const station = stations.find((s) => s.id === st.stationId);
      if (!station || station.kind !== 'task') throw new Error(`La tâche « ${t.name} » utilise un poste inexistant ou qui n'est pas un poste de tâches.`);
    }
  }
  const passages: Passage[] = (Array.isArray(src.passages) ? src.passages : []).slice(0, 20).map((p: any) => ({
    id: id(p?.id) || newId('p'),
    name: str(p?.name, 40) || 'Conduit',
    fromRoomId: id(p?.fromRoomId),
    toRoomId: id(p?.toRoomId),
    notes: str(p?.notes, 200),
  })).filter((p: Passage) => roomIds.has(p.fromRoomId) && roomIds.has(p.toRoomId));
  let meetingRoomId = id(src.meetingRoomId);
  if (!roomIds.has(meetingRoomId)) meetingRoomId = rooms.find((r) => !r.forbidden && !r.transit)?.id ?? '';
  return {
    name: str(src.name, 60) || 'Ma maison',
    rooms,
    stations,
    tasks,
    passages,
    meetingRoomId,
    safetyNotes: str(src.safetyNotes, 1500),
    ...(parsePrintCode(src.printCode) ? { printCode: makePrintCode(parsePrintCode(src.printCode)!.count, parsePrintCode(src.printCode)!.seed) } : {}),
  };
}

/** Sabotages réellement disponibles avec ce terrain. */
export function availableSabotages(t: Terrain): SabotageKind[] {
  const count = (k: StationKind) => t.stations.filter((s) => s.kind === k).length;
  const out: SabotageKind[] = [];
  if (count('reactor') >= 2) out.push('reactor');
  if (count('oxygen') >= 2) out.push('oxygen');
  if (count('lights') >= 1) out.push('lights');
  if (count('comms') >= 1) out.push('comms');
  return out;
}

/** Problèmes bloquants pour démarrer une partie. */
export function startProblems(t: Terrain, s: Settings, playerCount: number): string[] {
  const p: string[] = [];
  if (playerCount < 4) p.push('Il faut au moins 4 joueurs.');
  if (playerCount > s.maxPlayers) p.push(`Trop de joueurs (maximum ${s.maxPlayers}).`);
  if (s.impostors < 1) p.push('Il faut au moins un imposteur.');
  if (s.impostors * 2 >= playerCount) p.push(`Trop d'imposteurs : ils doivent être moins nombreux que l'équipage (max ${Math.max(0, Math.floor((playerCount - 1) / 2))}).`);
  if (!t.rooms.some((r) => r.id === t.meetingRoomId)) p.push('Choisissez une salle de réunion.');
  if (!t.stations.some((st) => st.kind === 'emergency')) p.push('Ajoutez un poste « Bouton d’urgence ».');
  const enabled = t.tasks.filter((x) => x.enabled);
  const n = (type: TaskType) => enabled.filter((x) => x.type === type).length;
  if (n('common') < s.commonTasks) p.push(`Pas assez de tâches communes actives (${n('common')} pour ${s.commonTasks} demandées).`);
  if (n('long') < s.longTasks) p.push(`Pas assez de tâches longues actives (${n('long')} pour ${s.longTasks} demandées).`);
  if (n('short') < s.shortTasks) p.push(`Pas assez de tâches courtes actives (${n('short')} pour ${s.shortTasks} demandées).`);
  if (s.commonTasks + s.longTasks + s.shortTasks === 0) p.push('Chaque joueur doit avoir au moins une tâche.');
  const provisional = t.rooms.filter((r) => PLACEHOLDER_ROOM.test(r.name));
  if (provisional.length)
    p.push(`Pièces au nom provisoire (${provisional.map((r) => r.name).join(', ')}) : renommez celles où une fiche est posée, puis « Retirer les fiches non posées » (onglet Terrain).`);
  return p;
}

/** Avertissements non bloquants pour aider le MJ à préparer un bon terrain. */
export function terrainWarnings(t: Terrain): string[] {
  const w: string[] = [];
  const count = (k: StationKind) => t.stations.filter((s) => s.kind === k).length;
  if (count('reactor') < 2) w.push('Moins de 2 postes Réacteur : le sabotage « Fusion du réacteur » est désactivé.');
  if (count('oxygen') < 2) w.push('Moins de 2 postes Oxygène : le sabotage « Fuite d’oxygène » est désactivé.');
  if (count('lights') < 1) w.push('Pas de poste Énergie : la « Panne de courant » est désactivée.');
  if (count('comms') < 1) w.push('Pas de poste Radio : « Communications coupées » est désactivé.');
  const roomOf = (id: string) => t.stations.find((s) => s.id === id)?.roomId;
  for (const k of t.tasks.filter((x) => x.enabled && x.steps.length > 1)) {
    const rooms = new Set(k.steps.map((s) => roomOf(s.stationId)));
    if (rooms.size < k.steps.length) w.push(`Tâche longue « ${k.name} » : plusieurs étapes dans la même pièce (moins de déplacements).`);
  }
  for (const s of t.stations.filter((x) => x.kind === 'task')) {
    if (!t.tasks.some((k) => k.enabled && k.steps.some((st) => st.stationId === s.id))) w.push(`Le poste « ${s.name} » n’a aucune tâche active : inutile de l’imprimer.`);
  }
  for (const r of t.rooms.filter((x) => !x.forbidden && !x.transit)) {
    if (!t.stations.some((s) => s.roomId === r.id)) w.push(`La pièce « ${r.name} » n’a aucun poste : personne n’aura de raison d’y aller.`);
  }
  return w;
}
