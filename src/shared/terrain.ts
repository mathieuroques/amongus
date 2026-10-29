// Terrain (la maison) : pièces saisies par le MJ et fiches du kit universel appairées à ces pièces.
// Les fiches et les tâches viennent du kit (kit.ts) ; ce module valide les données reçues du navigateur
// du MJ, recalcule les tâches et signale ce qui manque pour démarrer.

import { KIT_SHEETS, kitSheet, kitTasks } from './kit';
import { cryptoRng, randomCode, type Rng } from './rng';
import type { Passage, Room, SabotageKind, Settings, Station, StationKind, TaskType, Terrain } from './types';

/** Nombre maximum de pièces et de zones d'une maison. */
export const MAX_ROOMS = 60;

export const DEFAULT_SAFETY =
  'Ne courez jamais, surtout dans l’escalier et les couloirs. Les portes ne sont jamais verrouillées. ' +
  'Les zones interdites ne sont accessibles à personne. Aucune élimination dans l’escalier ni dans une zone de passage. ' +
  'Sortie de secours : porte d’entrée. En cas de problème, appuyez sur « Alerte sécurité » ou prévenez le maître du jeu.';

export function newId(prefix: string, rng: Rng = cryptoRng): string {
  return prefix + randomCode(6, rng, 'abcdefghijkmnpqrstuvwxyz23456789');
}

/** Terrain d'une nouvelle partie : aucune maison par défaut, aucune fiche appairée. */
export function emptyTerrain(): Terrain {
  return { name: 'Ma maison', rooms: [], stations: [], tasks: [], passages: [], meetingRoomId: '', safetyNotes: DEFAULT_SAFETY };
}

const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const id = (v: unknown) => str(v, 24).replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * Valide un terrain envoyé par le navigateur du maître du jeu. Lève une erreur lisible si invalide.
 * Les fiches sont celles du kit (noms, codes et types imposés), une seule fois chacune, dans une pièce
 * jouable ; les tâches sont toujours recalculées ici. Une fiche inconnue est ignorée.
 */
export function sanitizeTerrain(input: unknown): Terrain {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const rooms: Room[] = (Array.isArray(src.rooms) ? src.rooms : []).slice(0, MAX_ROOMS).map((r: any) => ({
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
  const seen = new Set<string>();
  const stations: Station[] = [];
  for (const s of Array.isArray(src.stations) ? src.stations.slice(0, 120) : []) {
    const k = kitSheet(id(s?.id));
    if (!k || seen.has(k.id)) continue;
    seen.add(k.id);
    const roomId = id(s?.roomId);
    if (!roomIds.has(roomId)) throw new Error(`La fiche « ${k.name} » n'est rattachée à aucune pièce.`);
    const room = rooms.find((r) => r.id === roomId)!;
    if (room.forbidden || room.transit) throw new Error(`La fiche « ${k.name} » est dans une zone interdite ou de passage.`);
    stations.push({ id: k.id, name: k.name, roomId, kind: k.kind, code: k.code });
  }
  const order = (x: Station) => KIT_SHEETS.findIndex((k) => k.id === x.id);
  stations.sort((a, b) => order(a) - order(b));
  let meetingRoomId = id(src.meetingRoomId);
  const playable = rooms.filter((r) => !r.forbidden && !r.transit);
  if (!playable.some((r) => r.id === meetingRoomId)) meetingRoomId = stations.find((x) => x.kind === 'emergency')?.roomId ?? playable[0]?.id ?? '';
  const passages: Passage[] = (Array.isArray(src.passages) ? src.passages : [])
    .slice(0, 20)
    .map((p: any) => ({ id: id(p?.id) || newId('p'), name: str(p?.name, 40) || 'Conduit', fromRoomId: id(p?.fromRoomId), toRoomId: id(p?.toRoomId), notes: str(p?.notes, 200) }))
    .filter((p: Passage) => roomIds.has(p.fromRoomId) && roomIds.has(p.toRoomId) && p.fromRoomId !== p.toRoomId);
  return {
    name: str(src.name, 60) || 'Ma maison',
    rooms,
    stations,
    tasks: kitTasks(stations, rooms),
    passages,
    meetingRoomId,
    // consignes absentes : celles par défaut ; un texte vidé volontairement par le MJ reste vide
    safetyNotes: typeof src.safetyNotes === 'string' ? str(src.safetyNotes, 1500) : DEFAULT_SAFETY,
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
  if (!t.stations.some((st) => st.kind === 'emergency')) p.push('Appairez la fiche « Bouton d’urgence » (onglet Terrain).');
  if (!t.stations.some((st) => st.kind === 'task')) p.push('Appairez au moins une fiche « Poste » (onglet Terrain).');
  else {
    if (!t.rooms.some((r) => r.id === t.meetingRoomId)) p.push('Choisissez une salle de réunion (onglet Terrain).');
    const n = (type: TaskType) => t.tasks.filter((x) => x.enabled && x.type === type).length;
    if (n('common') < s.commonTasks) p.push(`Pas assez de tâches communes (${n('common')} pour ${s.commonTasks} demandées) : baissez ce nombre dans les paramètres.`);
    if (n('long') < s.longTasks) p.push(`Pas assez de tâches longues (${n('long')} pour ${s.longTasks} demandées) : baissez ce nombre dans les paramètres.`);
    if (n('short') < s.shortTasks) p.push(`Pas assez de tâches courtes (${n('short')} pour ${s.shortTasks} demandées) : baissez ce nombre dans les paramètres.`);
  }
  if (s.commonTasks + s.longTasks + s.shortTasks === 0) p.push('Chaque joueur doit avoir au moins une tâche (paramètres).');
  return p;
}

/** Avertissements non bloquants pour aider le MJ à préparer un bon terrain. */
export function terrainWarnings(t: Terrain): string[] {
  const w: string[] = [];
  const count = (k: StationKind) => t.stations.filter((s) => s.kind === k).length;
  if (count('reactor') < 2) w.push('Moins de 2 fiches Réacteur appairées : le sabotage « Fusion du réacteur » est désactivé.');
  if (count('oxygen') < 2) w.push('Moins de 2 fiches Oxygène appairées : le sabotage « Fuite d’oxygène » est désactivé.');
  if (count('lights') < 1) w.push('Fiche Énergie non appairée : la « Panne de courant » est désactivée.');
  if (count('comms') < 1) w.push('Fiche Radio non appairée : « Communications coupées » est désactivé.');
  for (const [k, label] of [['reactor', 'Réacteur'], ['oxygen', 'Oxygène']] as const) {
    const st = t.stations.filter((s) => s.kind === k);
    if (st.length >= 2 && new Set(st.map((s) => s.roomId)).size < st.length) w.push(`Les fiches ${label} sont dans la même pièce : le sabotage est trop facile à réparer, éloignez-les.`);
  }
  const roomOf = (id: string) => t.stations.find((s) => s.id === id)?.roomId;
  for (const k of t.tasks.filter((x) => x.enabled && x.steps.length > 1)) {
    const rooms = new Set(k.steps.map((s) => roomOf(s.stationId)));
    if (rooms.size < k.steps.length) w.push(`Tâche longue « ${k.name} » : ses étapes sont dans la même pièce (posez des fiches dans d’autres pièces).`);
  }
  for (const r of t.rooms.filter((x) => !x.forbidden && !x.transit)) {
    if (!t.stations.some((s) => s.roomId === r.id)) w.push(`La pièce « ${r.name} » n’a aucune fiche : personne n’aura de raison d’y aller.`);
  }
  return w;
}
