// Moteur de règles : fonctions pures qui modifient l'état de la partie.
// Toutes les vérifications d'éligibilité sont faites ici, côté serveur.

import { FIXES, SABOTAGE_INFO } from './catalog';
import { kitSheetByCode } from './kit';
import { checkAnswer, makeFixChallenge, makeTaskChallenge } from './puzzles';
import { cryptoRng, normalizeCode, randomDigits, shuffle, type Rng } from './rng';
import { validSubscription } from './webpush';
import { DEFAULT_SETTINGS, GATHER_MAJORITY_SEC, sanitizeSettings, startSettings } from './settings';
import { availableSabotages, exampleTerrain, newId, sanitizeTerrain, startProblems } from './terrain';
import type {
  ActiveSabotage, Challenge, FixKind, GameState, Meeting, PlayerState, SabotageKind, Settings, Station, Terrain, VoteResult, Winner,
} from './types';

export class GameError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface Ctx {
  now: number;
  rng: Rng;
}

const fail = (code: string, msg: string): never => {
  throw new GameError(code, msg);
};

export const REACTOR_HOLD_MS = 2500;
export const HOLD_STALE_MS = 5000;
export const FAILURE_WINDOW_MS = 60_000;
export const MAX_FAILURES = 6;
export const BLOCK_MS = 60_000;
const MAX_LOG = 4000;
const sec = (n: number) => n * 1000;

// ---------------------------------------------------------------------------
// Création / salon
// ---------------------------------------------------------------------------

export function createGame(code: string, gmTokenHash: string, gmSecretHash: string, now: number, settings?: unknown, terrain?: unknown): GameState {
  let t: Terrain;
  try {
    t = terrain ? sanitizeTerrain(terrain) : exampleTerrain();
    if (t.rooms.length === 0) t = exampleTerrain();
  } catch {
    t = exampleTerrain();
  }
  return {
    v: 1,
    code,
    createdAt: now,
    gmTokenHashes: [gmTokenHash],
    gmSecretHash,
    gameNumber: 1,
    phase: 'lobby',
    paused: false,
    emergencyStop: false,
    lobbyLocked: false,
    settings: sanitizeSettings(settings, DEFAULT_SETTINGS),
    terrain: t,
    players: [],
    nextNum: 1,
    emergencyCooldownUntil: 0,
    sabotageCooldownUntil: 0,
    taskBarSnapshot: 0,
    sabotageHistory: [],
    meetings: [],
    log: [{ at: now, type: 'create', msg: 'Partie créée.' }],
    alerts: [],
    nextAlertId: 1,
    reclaim: [],
    gmFailures: [],
    gmPush: [],
    pingId: 0,
    seq: 0,
  };
}

export function log(s: GameState, now: number, type: string, msg: string, secret = false) {
  s.log.push({ at: now, type, msg, secret: secret || undefined });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

export function addPlayer(s: GameState, rawName: unknown, tokenHash: string, now: number): PlayerState {
  if (s.phase !== 'lobby') fail('started', 'La partie a déjà commencé : demandez au maître du jeu de vous ajouter à la prochaine.');
  if (s.lobbyLocked) fail('locked', 'Le salon est verrouillé par le maître du jeu.');
  const name = cleanName(rawName);
  if (normalizeName(name).length < 2) fail('bad_name', 'Pseudonyme trop court (2 caractères au minimum).');
  const active = s.players.filter((p) => !p.kicked);
  if (active.length >= s.settings.maxPlayers) fail('full', 'Le salon est complet.');
  if (active.some((p) => normalizeName(p.name) === normalizeName(name))) fail('name_taken', 'Ce pseudonyme est déjà pris dans ce salon.');
  const p: PlayerState = {
    id: newId('p'),
    name,
    num: s.nextNum++,
    tokenHash,
    joinedAt: now,
    alive: true,
    left: false,
    kicked: false,
    deathRevealed: false,
    tasks: [],
    emergencyLeft: 0,
    killCooldownUntil: 0,
    failures: [],
    blockedUntil: 0,
    checkedIn: false,
    kills: 0,
  };
  s.players.push(p);
  log(s, now, 'join', `${name} a rejoint le salon.`);
  return p;
}

// ---------------------------------------------------------------------------
// Utilitaires d'état
// ---------------------------------------------------------------------------

export const inGame = (p: PlayerState) => !p.left && !p.kicked && !!p.role;
export const aliveImpostors = (s: GameState) => s.players.filter((p) => inGame(p) && p.alive && p.role === 'impostor');
export const aliveCrew = (s: GameState) => s.players.filter((p) => inGame(p) && p.alive && p.role === 'crewmate');
export const bodyPending = (p: PlayerState) => !p.alive && !!p.body && !p.body.reported && !p.body.vanished;

export function taskProgress(s: GameState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const p of s.players) {
    if (!inGame(p) || p.role !== 'crewmate') continue;
    total += p.tasks.length;
    done += p.tasks.filter((t) => t.done).length;
  }
  return { done, total };
}

export function stationByCode(s: GameState, code: unknown): Station | undefined {
  const c = normalizeCode(String(code ?? ''));
  if (!c) return undefined;
  return s.terrain.stations.find((st) => st.code === c);
}

const roomName = (s: GameState, id?: string) => s.terrain.rooms.find((r) => r.id === id)?.name ?? '?';
const nameOf = (s: GameState, id?: string) => s.players.find((p) => p.id === id)?.name ?? '?';

function getPlayer(s: GameState, id: string): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.kicked) fail('no_player', 'Joueur inconnu ou exclu.');
  return p!;
}

function requirePlaying(s: GameState) {
  if (s.phase === 'meeting') fail('meeting', 'Action impossible : une réunion est en cours.');
  if (s.phase !== 'playing') fail('not_playing', 'La partie n’est pas en cours.');
  if (s.paused || s.emergencyStop) fail('paused', 'La partie est en pause.');
}

function requireInGame(p: PlayerState) {
  if (p.left) fail('left', 'Vous avez quitté la partie.');
  if (!p.role) fail('no_role', 'Vous ne participez pas à cette manche.');
}

function checkBlocked(p: PlayerState, now: number) {
  if (p.blockedUntil > now) fail('blocked', `Trop de codes erronés. Réessayez dans ${Math.ceil((p.blockedUntil - now) / 1000)} s.`);
}

function registerFailure(s: GameState, p: PlayerState, now: number, what: string) {
  p.failures = p.failures.filter((t) => t > now - FAILURE_WINDOW_MS);
  p.failures.push(now);
  log(s, now, 'bad_code', `${p.name} : ${what} erroné.`, true);
  if (p.failures.length >= MAX_FAILURES) {
    p.blockedUntil = now + BLOCK_MS;
    p.failures = [];
    log(s, now, 'blocked', `${p.name} est bloqué·e 60 s après trop de codes erronés.`, true);
  }
}

/**
 * Fiche du kit universel qui n'est pas appairée dans cette partie : elle n'existe pas pour le jeu. Message clair,
 * signalé au MJ, sans compter comme un code erroné (le joueur n'y est pour rien).
 */
function unusedKitSheet(s: GameState, p: PlayerState, code: unknown, now: number) {
  const k = s.terrain.kit ? kitSheetByCode(normalizeCode(String(code ?? ''))) : undefined;
  if (!k || s.terrain.stations.some((x) => x.id === k.id)) return;
  log(s, now, 'unused_sheet', `${p.name} a scanné la fiche « ${k.name} », qui n’est pas appairée : retirez-la ou appairez-la.`, true);
  fail('unused_sheet', 'Cette fiche ne sert pas dans cette partie : ignorez-la et prévenez le maître du jeu.');
}

function activeCodes(s: GameState): Set<string> {
  const set = new Set<string>();
  for (const p of s.players) if (p.body && !p.body.reported && !p.body.vanished) set.add(p.body.code);
  return set;
}

function uniqueDigits(s: GameState, rng: Rng): string {
  const used = activeCodes(s);
  for (;;) {
    const c = randomDigits(4, rng);
    if (!used.has(c)) return c;
  }
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

export function startGame(s: GameState, ctx: Ctx) {
  if (s.phase !== 'lobby') fail('not_lobby', 'La partie doit être dans le salon pour démarrer.');
  const players = s.players.filter((p) => !p.kicked && !p.left);
  s.settings = startSettings(s.settings, players.length);
  const problems = startProblems(s.terrain, s.settings, players.length);
  if (problems.length) fail('cannot_start', problems.join(' '));
  const { now } = ctx;
  const st = s.settings;
  // Tirage des rôles avec un générateur cryptographique (pas Math.random).
  const order = shuffle(players.map((p) => p.id), cryptoRng);
  const impostorIds = new Set(order.slice(0, st.impostors));
  const enabled = s.terrain.tasks.filter((t) => t.enabled);
  const common = shuffle(enabled.filter((t) => t.type === 'common'), ctx.rng).slice(0, st.commonTasks);
  const longs = enabled.filter((t) => t.type === 'long');
  const shorts = enabled.filter((t) => t.type === 'short');
  for (const p of players) {
    p.role = impostorIds.has(p.id) ? 'impostor' : 'crewmate';
    p.alive = true;
    p.deathRevealed = false;
    p.diedAt = undefined;
    p.deathCause = undefined;
    p.killedBy = undefined;
    p.body = undefined;
    p.challenge = undefined;
    p.disputed = undefined;
    p.lastStationId = undefined;
    p.kills = 0;
    p.checkedIn = false;
    p.failures = [];
    p.blockedUntil = 0;
    p.emergencyLeft = st.emergencyMeetingsPerPlayer;
    p.killCooldownUntil = now + sec(st.initialKillCooldownSec);
    const mine = personalOrder([...common, ...shuffle(longs, ctx.rng).slice(0, st.longTasks), ...shuffle(shorts, ctx.rng).slice(0, st.shortTasks)], ctx.rng);
    p.tasks = mine.map((t) => ({ taskId: t.id, step: 0, done: false }));
  }
  s.phase = 'playing';
  s.paused = false;
  s.emergencyStop = false;
  s.startedAt = now;
  s.emergencyCooldownUntil = now + sec(st.emergencyCooldownSec);
  s.sabotageCooldownUntil = now + sec(st.initialSabotageCooldownSec);
  s.sabotage = undefined;
  s.sabotageHistory = [];
  s.meeting = undefined;
  s.meetings = [];
  s.winner = undefined;
  s.endReason = undefined;
  s.endedAt = undefined;
  s.taskBarSnapshot = 0;
  log(s, now, 'start', `La partie n°${s.gameNumber} commence avec ${players.length} joueurs et ${st.impostors} imposteur(s).`);
  log(s, now, 'roles', `Imposteurs : ${players.filter((p) => p.role === 'impostor').map((p) => p.name).join(', ')}.`, true);
}

/**
 * Ordre des tâches propre à chaque joueur : mélangé, et jamais une tâche commune en premier
 * (sinon tout le monde se précipiterait au même poste au début de la partie).
 */
export function personalOrder<T extends { type: string }>(tasks: T[], rng: Rng): T[] {
  const out = shuffle(tasks, rng);
  if (out[0]?.type === 'common') {
    const others = out.map((t, i) => (t.type === 'common' ? -1 : i)).filter((i) => i > 0);
    if (others.length) {
      const j = others[rng.int(others.length)];
      [out[0], out[j]] = [out[j], out[0]];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fin de partie
// ---------------------------------------------------------------------------

export function endGame(s: GameState, winner: Winner, reason: string, now: number) {
  if (s.phase === 'ended') return;
  if (s.sabotage) {
    s.sabotageHistory.push({ kind: s.sabotage.kind, by: s.sabotage.by, at: s.sabotage.startedAt, outcome: winner === 'impostors' && SABOTAGE_INFO[s.sabotage.kind].critical ? 'non réparé (fin de partie)' : 'en cours à la fin' });
    s.sabotage = undefined;
  }
  if (s.meeting) archiveMeeting(s);
  s.meeting = undefined;
  for (const p of s.players) p.challenge = undefined;
  s.phase = 'ended';
  s.paused = false;
  s.emergencyStop = false;
  s.winner = winner;
  s.endReason = reason;
  s.endedAt = now;
  const label = winner === 'crew' ? 'Victoire de l’équipage' : winner === 'impostors' ? 'Victoire des imposteurs' : 'Partie arrêtée sans vainqueur';
  log(s, now, 'end', `${label} : ${reason}`);
}

/**
 * Conditions de victoire du mode classique (vérifiées après chaque action et à la fin des réunions) :
 * - équipage : plus aucun imposteur en jeu, ou toutes les tâches de l'équipage terminées (fantômes compris) ;
 * - imposteurs : autant d'imposteurs vivants que de membres d'équipage vivants (ou plus).
 * Le sabotage critique non réparé est traité dans tick().
 */
export function checkWin(s: GameState, now: number): boolean {
  if (s.phase !== 'playing') return false;
  const imp = aliveImpostors(s).length;
  const crew = aliveCrew(s).length;
  if (imp === 0) {
    endGame(s, 'crew', 'Tous les imposteurs ont été éliminés.', now);
    return true;
  }
  if (imp >= crew) {
    endGame(s, 'impostors', 'Les imposteurs sont aussi nombreux que l’équipage encore en vie.', now);
    return true;
  }
  const { done, total } = taskProgress(s);
  if (total > 0 && done >= total) {
    endGame(s, 'crew', 'Toutes les tâches ont été accomplies.', now);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Réunions
// ---------------------------------------------------------------------------

function clearVolatile(s: GameState) {
  for (const p of s.players) p.challenge = undefined;
  if (s.sabotage) s.sabotage.holds = [];
}

export function startMeeting(s: GameState, kind: Meeting['kind'], now: number, callerId?: string, bodyOf?: string) {
  clearVolatile(s);
  let endedSabotage: SabotageKind | undefined;
  if (s.sabotage && SABOTAGE_INFO[s.sabotage.kind].critical) {
    endedSabotage = s.sabotage.kind;
    resolveSabotage(s, now, 'interrompu par la réunion');
  }
  for (const p of s.players) {
    if (p.body && !p.body.reported && !p.body.vanished) p.body.vanished = true; // les corps disparaissent
  }
  const newlyDead = s.players.filter((p) => inGame(p) && !p.alive && !p.deathRevealed).map((p) => p.id);
  for (const p of s.players) if (!p.alive) p.deathRevealed = true;
  if (s.settings.taskBarUpdates === 'meetings') {
    const { done, total } = taskProgress(s);
    s.taskBarSnapshot = total ? done / total : 0;
  }
  for (const p of s.players) p.checkedIn = false;
  s.meeting = {
    id: s.meetings.length + 1,
    kind,
    calledBy: callerId,
    bodyOf,
    startedAt: now,
    stage: 'gather',
    stageEndsAt: now + sec(s.settings.gatherSec),
    votes: {},
    ready: [],
    deadAtStart: s.players.filter((p) => inGame(p) && !p.alive).map((p) => p.id),
    newlyDead,
    endedSabotage,
  };
  s.phase = 'meeting';
  const why = kind === 'report' ? `${nameOf(s, callerId)} a signalé le corps de ${nameOf(s, bodyOf)}` : kind === 'emergency' ? `${nameOf(s, callerId)} a appuyé sur le bouton d’urgence` : 'le maître du jeu a convoqué une réunion';
  log(s, now, 'meeting', `Réunion n°${s.meeting.id} : ${why}.`);
}

function voters(s: GameState) {
  return s.players.filter((p) => inGame(p) && p.alive);
}

export function tallyVotes(s: GameState, m: Meeting): VoteResult {
  const eligible = voters(s);
  const tally: Record<string, number> = {};
  let skips = 0;
  let cast = 0;
  for (const v of eligible) {
    const t = m.votes[v.id];
    if (!t) continue;
    if (t !== 'skip') {
      const target = s.players.find((x) => x.id === t);
      if (!target || !inGame(target) || !target.alive) continue; // cible partie entre-temps : vote ignoré
    }
    cast++;
    if (t === 'skip') skips++;
    else tally[t] = (tally[t] ?? 0) + 1;
  }
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter((k) => tally[k] === max);
  const res: VoteResult = { tally, skips, abstentions: eligible.length - cast, tie: false };
  if (max > 0 && top.length === 1 && max > skips) res.ejectedId = top[0];
  else if (max > 0 && max >= skips && (top.length > 1 || max === skips)) res.tie = true;
  if (!s.settings.anonymousVotes) res.votes = { ...m.votes };
  return res;
}

function archiveMeeting(s: GameState) {
  const m = s.meeting!;
  s.meetings.push({ id: m.id, kind: m.kind, calledBy: m.calledBy, bodyOf: m.bodyOf, at: m.startedAt, newlyDead: m.newlyDead, result: m.result, votes: { ...m.votes } });
}

export function advanceMeeting(s: GameState, now: number) {
  const m = s.meeting;
  if (!m || s.phase !== 'meeting') return;
  const st = s.settings;
  switch (m.stage) {
    case 'gather':
      if (st.discussionSec > 0) {
        m.stage = 'discussion';
        m.stageEndsAt = now + sec(st.discussionSec);
        break;
      }
    // falls through : pas de discussion → vote direct
    case 'discussion':
      m.stage = 'voting';
      m.stageEndsAt = now + sec(st.votingSec);
      break;
    case 'voting': {
      const res = tallyVotes(s, m);
      if (res.ejectedId) {
        const e = s.players.find((p) => p.id === res.ejectedId)!;
        e.alive = false;
        e.deathRevealed = true;
        e.diedAt = now;
        e.deathCause = 'ejected';
        e.challenge = undefined;
        if (st.confirmEjects) {
          res.wasImpostor = e.role === 'impostor';
          res.impostorsLeft = aliveImpostors(s).length;
        }
        log(s, now, 'eject', `${e.name} a été éjecté·e (${res.tally[e.id]} voix).`);
        log(s, now, 'eject_role', `${e.name} était ${e.role === 'impostor' ? 'imposteur' : 'membre d’équipage'}.`, true);
      } else {
        if (st.confirmEjects) res.impostorsLeft = aliveImpostors(s).length;
        log(s, now, 'eject', res.tie ? 'Égalité : personne n’est éjecté.' : 'Personne n’est éjecté (vote passé ou aucun vote).');
      }
      m.result = res;
      m.stage = 'result';
      m.stageEndsAt = now + sec(st.resultSec);
      break;
    }
    case 'result': {
      archiveMeeting(s);
      s.meeting = undefined;
      s.phase = 'playing';
      for (const p of s.players) {
        p.checkedIn = false;
        if (p.role === 'impostor') p.killCooldownUntil = now + sec(st.killCooldownSec);
      }
      s.emergencyCooldownUntil = now + sec(st.emergencyCooldownSec);
      s.sabotageCooldownUntil = Math.max(s.sabotageCooldownUntil, now + sec(st.initialSabotageCooldownSec));
      log(s, now, 'resume', 'Fin de la réunion : la partie reprend.');
      checkWin(s, now);
      break;
    }
  }
}

function maybeEndVoting(s: GameState, now: number) {
  const m = s.meeting;
  if (!m || m.stage !== 'voting') return;
  if (voters(s).every((p) => m.votes[p.id])) advanceMeeting(s, now);
}

function maybeEndGather(s: GameState, now: number) {
  const m = s.meeting;
  if (!m || m.stage !== 'gather') return;
  const v = voters(s);
  if (v.length > 0 && v.every((p) => p.checkedIn)) return advanceMeeting(s, now);
  // majorité arrivée : on n'attend plus les retardataires que quelques secondes (une seule fois, pour qu'un « +30 s » du MJ tienne)
  if (m.majorityAt === undefined && 2 * v.filter((p) => p.checkedIn).length > v.length) {
    m.majorityAt = now;
    m.stageEndsAt = Math.min(m.stageEndsAt, now + sec(GATHER_MAJORITY_SEC));
  }
}

/** Nombre de vivants « prêts à voter » (seuls les vivants encore en jeu comptent). */
export function readyCount(s: GameState, m: Meeting): number {
  const ready = new Set(m.ready ?? []);
  return voters(s).filter((p) => ready.has(p.id)).length;
}

function maybeEndDiscussion(s: GameState, now: number) {
  const m = s.meeting;
  if (!m || m.stage !== 'discussion') return;
  if (2 * readyCount(s, m) > voters(s).length) advanceMeeting(s, now);
}

function meetingRecheck(s: GameState, now: number) {
  if (s.phase !== 'meeting') return;
  maybeEndGather(s, now);
  maybeEndDiscussion(s, now);
  maybeEndVoting(s, now);
}

// ---------------------------------------------------------------------------
// Sabotages
// ---------------------------------------------------------------------------

export function resolveSabotage(s: GameState, now: number, outcome: string) {
  const sab = s.sabotage;
  if (!sab) return;
  s.sabotageHistory.push({ kind: sab.kind, by: sab.by, at: sab.startedAt, outcome });
  s.sabotage = undefined;
  s.sabotageCooldownUntil = Math.max(s.sabotageCooldownUntil, now + sec(s.settings.sabotageCooldownSec));
  for (const p of s.players) if (p.challenge?.purpose === 'fix') p.challenge = undefined;
  log(s, now, 'sabotage_end', `${SABOTAGE_INFO[sab.kind].label} : ${outcome}.`);
}

function freshHolds(sab: ActiveSabotage, now: number) {
  return sab.holds.filter((h) => h.beat > now - HOLD_STALE_MS);
}

/** Instant où le réacteur sera réparé si les mains restent posées (undefined si pas assez de postes tenus). */
export function reactorFixTime(s: GameState, now: number): number | undefined {
  const sab = s.sabotage;
  if (!sab || sab.kind !== 'reactor') return undefined;
  const first = new Map<string, number>();
  for (const h of freshHolds(sab, now)) {
    const p = s.players.find((x) => x.id === h.playerId);
    if (!p || !p.alive) continue;
    first.set(h.stationId, Math.min(first.get(h.stationId) ?? Infinity, h.since));
  }
  if (first.size < 2) return undefined;
  const starts = [...first.values()].sort((a, b) => a - b);
  // deux postes différents tenus en même temps (par deux joueurs différents, cf. hold())
  return starts[1] + REACTOR_HOLD_MS;
}

function checkReactor(s: GameState, now: number) {
  const t = reactorFixTime(s, now);
  if (t !== undefined && now >= t) resolveSabotage(s, now, 'réparé');
}

// ---------------------------------------------------------------------------
// Horloge serveur
// ---------------------------------------------------------------------------

/** Fait avancer les minuteurs. Retourne true si l'état a changé. */
export function tick(s: GameState, now: number): boolean {
  if (s.paused || (s.phase !== 'playing' && s.phase !== 'meeting')) return false;
  let changed = false;
  if (s.phase === 'playing') {
    for (const p of s.players) {
      if (p.body && !p.body.reported && !p.body.vanished && p.body.vanishAt && p.body.vanishAt <= now) {
        p.body.vanished = true;
        log(s, now, 'body_vanish', `Le corps de ${p.name} n’a pas été découvert à temps et disparaît.`, true);
        changed = true;
      }
    }
    const sab = s.sabotage;
    if (sab) {
      if (sab.deadline && sab.deadline <= now) {
        endGame(s, 'impostors', `${SABOTAGE_INFO[sab.kind].label} : le sabotage critique n’a pas été réparé à temps.`, now);
        return true;
      }
      if (sab.kind === 'reactor') {
        const n = sab.holds.length;
        sab.holds = freshHolds(sab, now);
        if (sab.holds.length !== n) changed = true;
        const had = !!s.sabotage;
        checkReactor(s, now);
        if (had && !s.sabotage) changed = true;
      }
    }
  }
  let guard = 0;
  while (s.phase === 'meeting' && s.meeting && s.meeting.stageEndsAt <= now && guard++ < 5) {
    advanceMeeting(s, now);
    changed = true;
  }
  return changed;
}

/** Prochain instant où tick() aura quelque chose à faire (pour programmer l'alarme du serveur). */
export function nextWakeup(s: GameState, now: number): number | undefined {
  if (s.paused || (s.phase !== 'playing' && s.phase !== 'meeting')) return undefined;
  const times: number[] = [];
  if (s.phase === 'meeting' && s.meeting) times.push(s.meeting.stageEndsAt);
  if (s.phase === 'playing') {
    for (const p of s.players) {
      if (p.body && !p.body.reported && !p.body.vanished && p.body.vanishAt) times.push(p.body.vanishAt);
    }
    const sab = s.sabotage;
    if (sab) {
      if (sab.deadline) times.push(sab.deadline);
      for (const h of sab.holds) times.push(h.beat + HOLD_STALE_MS);
      const f = reactorFixTime(s, now);
      if (f !== undefined) times.push(f);
    }
  }
  return times.length ? Math.min(...times) : undefined;
}

function shiftTimers(s: GameState, delta: number) {
  s.emergencyCooldownUntil += delta;
  s.sabotageCooldownUntil += delta;
  if (s.meeting) s.meeting.stageEndsAt += delta;
  if (s.sabotage) {
    if (s.sabotage.deadline) s.sabotage.deadline += delta;
    s.sabotage.holds = [];
  }
  for (const p of s.players) {
    p.killCooldownUntil += delta;
    if (p.body?.vanishAt) p.body.vanishAt += delta;
    if (p.challenge) p.challenge.startedAt += delta;
    if (p.blockedUntil) p.blockedUntil += delta;
  }
}

// ---------------------------------------------------------------------------
// Actions des joueurs
// ---------------------------------------------------------------------------

export type PlayerAction =
  | { type: 'scan'; code: string }
  | { type: 'startTask'; code: string; taskId: string }
  | { type: 'submit'; challengeId: string; answer: unknown }
  | { type: 'cancelChallenge' }
  | { type: 'callEmergency'; code: string }
  | { type: 'report'; code: string }
  | { type: 'kill'; target: string }
  | { type: 'dispute' }
  | { type: 'sabotage'; kind: SabotageKind }
  | { type: 'fixStart'; code: string }
  | { type: 'hold'; code: string; on: boolean }
  | { type: 'checkIn' }
  | { type: 'readyVote' }
  | { type: 'vote'; target: string }
  | { type: 'alert'; message?: string }
  | { type: 'leave' }
  | { type: 'pushSubscribe'; subscription: unknown }
  | { type: 'pushUnsubscribe' };

function challengeView(s: GameState, c: Challenge) {
  const station = s.terrain.stations.find((x) => x.id === c.stationId);
  const task = s.terrain.tasks.find((t) => t.id === c.taskId);
  return {
    id: c.id,
    purpose: c.purpose,
    game: c.game,
    params: c.params,
    startedAt: c.startedAt,
    minMs: c.minMs,
    stationName: station?.name ?? '',
    taskName: task?.name ?? (s.sabotage ? SABOTAGE_INFO[s.sabotage.kind].label : ''),
  };
}
export type ChallengeView = ReturnType<typeof challengeView>;

/** Vue du mini-jeu testé par le MJ : la réponse attendue est montrée pour vérifier les fiches papier. */
export function gmChallengeView(s: GameState) {
  const c = s.gmChallenge;
  if (!c) return undefined;
  const v = challengeView(s, c);
  const paper = c.game === 'count' || c.game === 'assemble';
  return { ...v, taskName: c.purpose === 'fix' ? FIXES[c.game as FixKind].label : v.taskName, expected: paper ? String(c.answer) : undefined };
}
export { challengeView };

function taskBlockReason(p: PlayerState): string | undefined {
  // La panne de courant ne bloque plus les tâches (elle empêche de signaler les corps).
  if (bodyPending(p)) return 'Vous êtes un corps : restez sur place jusqu’à la découverte ou la prochaine réunion.';
  return undefined;
}

/** Analyse d'un poste scanné : ce que ce joueur peut y faire. */
function scanStation(s: GameState, p: PlayerState, station: Station, now: number) {
  const base = { stationId: station.id, name: station.name, kind: station.kind, roomName: roomName(s, station.roomId) };
  switch (station.kind) {
    case 'task': {
      const block = taskBlockReason(p);
      const tasks = p.tasks
        .filter((a) => !a.done)
        .map((a) => {
          const def = s.terrain.tasks.find((t) => t.id === a.taskId)!;
          const step = def.steps[a.step];
          return step && step.stationId === station.id
            ? { taskId: def.id, name: def.name, step: a.step + 1, steps: def.steps.length, game: step.game }
            : undefined;
        })
        .filter(Boolean);
      return { ...base, tasks, block };
    }
    case 'emergency': {
      let block: string | undefined;
      if (!p.alive) block = 'Les fantômes ne peuvent pas convoquer de réunion.';
      else if (p.emergencyLeft <= 0) block = 'Vous avez utilisé toutes vos réunions d’urgence.';
      else if (s.sabotage) block = 'Impossible pendant un sabotage : réparez d’abord !';
      else if (now < s.emergencyCooldownUntil) block = `Bouton disponible dans ${Math.ceil((s.emergencyCooldownUntil - now) / 1000)} s.`;
      return { ...base, emergencyLeft: p.emergencyLeft, block };
    }
    case 'vitals': {
      if (s.sabotage?.kind === 'comms') return { ...base, block: 'Communications coupées : moniteur indisponible.' };
      if (bodyPending(p)) return { ...base, block: 'Vous êtes un corps : restez sur place.' };
      return {
        ...base,
        vitals: s.players.filter(inGame).map((x) => ({ id: x.id, name: x.name, num: x.num, status: x.left ? 'left' : x.alive ? 'alive' : 'dead' })),
      };
    }
    default: {
      const kind = station.kind as SabotageKind;
      const sab = s.sabotage;
      let block: string | undefined;
      if (!sab || sab.kind !== kind) block = 'Rien à réparer ici pour le moment.';
      else if (!p.alive) block = 'Les fantômes ne peuvent pas réparer les sabotages.';
      else if (kind === 'oxygen' && sab.fixed.includes(station.id)) block = 'Ce poste est déjà réparé : allez à l’autre poste Oxygène !';
      return { ...base, fix: !block, block };
    }
  }
}

export function playerAction(s: GameState, playerId: string, a: PlayerAction, ctx: Ctx): unknown {
  const { now, rng } = ctx;
  const p = getPlayer(s, playerId);
  switch (a?.type) {
    case 'pushSubscribe': {
      const sub = validSubscription(a.subscription);
      if (!sub) fail('bad_push', 'Abonnement aux notifications refusé (service de notification inconnu).');
      p.push = sub;
      return { ok: true };
    }
    case 'pushUnsubscribe': {
      p.push = undefined;
      return { ok: true };
    }
    case 'alert': {
      const message = String(a.message ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200) || 'Alerte sécurité';
      s.alerts.push({ id: s.nextAlertId++, at: now, playerId: p.id, message, acked: false });
      log(s, now, 'alert', `ALERTE SÉCURITÉ de ${p.name} : ${message}`);
      return { ok: true };
    }
    case 'leave': {
      if (s.phase === 'lobby' || !p.role) {
        s.players = s.players.filter((x) => x.id !== p.id);
        log(s, now, 'leave', `${p.name} a quitté le salon.`);
        return { ok: true };
      }
      markLeft(s, p, now, `${p.name} a quitté la partie.`);
      return { ok: true };
    }
    case 'dispute': {
      requireInGame(p);
      if (s.phase !== 'playing' && s.phase !== 'meeting') fail('not_playing', 'La partie n’est pas en cours.');
      if (p.alive || p.deathCause !== 'killed') fail('not_killed', 'Seul un joueur éliminé par un imposteur peut contester.');
      if (p.disputed) fail('already', 'Contestation déjà envoyée au maître du jeu.');
      p.disputed = true;
      const message = `Conteste son élimination (attribuée à ${nameOf(s, p.killedBy)}) : « je n’ai pas été touché·e ».`;
      s.alerts.push({ id: s.nextAlertId++, kind: 'dispute', at: now, playerId: p.id, message, acked: false });
      log(s, now, 'dispute', `${p.name} ${message}`, true);
      return { ok: true };
    }
    case 'readyVote': {
      requireInGame(p);
      const m = s.meeting;
      if (s.phase !== 'meeting' || !m || m.stage !== 'discussion') fail('not_now', 'Pas de discussion en cours.');
      if (s.paused) fail('paused', 'La partie est en pause.');
      if (!p.alive) fail('dead', 'Les fantômes ne votent pas.');
      m!.ready ??= [];
      if (!m!.ready.includes(p.id)) m!.ready.push(p.id);
      maybeEndDiscussion(s, now);
      return { ok: true };
    }
    case 'checkIn': {
      requireInGame(p);
      if (s.phase !== 'meeting' || s.meeting?.stage !== 'gather') fail('not_now', 'Pas de rassemblement en cours.');
      if (s.paused) fail('paused', 'La partie est en pause.');
      if (!p.alive) fail('dead', 'Les fantômes n’ont pas besoin de pointer.');
      p.checkedIn = true;
      maybeEndGather(s, now);
      return { ok: true };
    }
    case 'vote': {
      requireInGame(p);
      const m = s.meeting;
      if (s.phase !== 'meeting' || !m || m.stage !== 'voting') fail('not_voting', 'Le vote n’est pas ouvert.');
      if (s.paused) fail('paused', 'La partie est en pause.');
      if (!p.alive) fail('dead', 'Les fantômes ne votent pas.');
      if (m!.votes[p.id]) fail('already_voted', 'Vous avez déjà voté.');
      const target = String(a.target ?? '');
      if (target !== 'skip') {
        const t = s.players.find((x) => x.id === target);
        if (!t || !inGame(t) || !t.alive) fail('bad_target', 'Vote invalide : ce joueur n’est pas éligible.');
      }
      m!.votes[p.id] = target;
      log(s, now, 'vote', `${p.name} a voté.`);
      maybeEndVoting(s, now);
      return { ok: true };
    }
  }

  // Toutes les actions suivantes exigent une partie en cours (ni réunion, ni pause).
  requireInGame(p);
  requirePlaying(s);

  switch (a?.type) {
    case 'scan': {
      checkBlocked(p, now);
      const station = stationByCode(s, a.code);
      if (!station) {
        unusedKitSheet(s, p, a.code, now);
        registerFailure(s, p, now, 'code de poste');
        fail('bad_code', 'Code de poste inconnu.');
      }
      return scanStation(s, p, station!, now);
    }

    case 'startTask': {
      checkBlocked(p, now);
      const station = stationByCode(s, a.code);
      if (!station) {
        unusedKitSheet(s, p, a.code, now);
        registerFailure(s, p, now, 'code de poste');
        fail('bad_code', 'Code de poste inconnu.');
      }
      const assigned = p.tasks.find((t) => t.taskId === a.taskId);
      if (!assigned) fail('not_your_task', 'Cette tâche ne vous est pas attribuée.');
      if (assigned!.done) fail('task_done', 'Tâche déjà terminée.');
      const def = s.terrain.tasks.find((t) => t.id === assigned!.taskId)!;
      const step = def.steps[assigned!.step];
      if (!step || step.stationId !== station!.id) fail('wrong_station', 'Ce n’est pas le bon poste pour cette étape.');
      const block = taskBlockReason(p);
      if (block) fail('blocked_task', block);
      const ch = makeTaskChallenge(step.game, def.seed, rng);
      const purpose = p.role === 'impostor' ? 'fake' : 'task';
      if (step.game === 'scan') ch.params = { visual: purpose === 'task' && s.settings.visualTasks };
      p.challenge = { id: newId('c', rng), purpose, taskId: def.id, stepIndex: assigned!.step, stationId: station!.id, game: ch.game, params: ch.params, answer: ch.answer, startedAt: now, minMs: ch.minMs };
      return challengeView(s, p.challenge);
    }

    case 'cancelChallenge': {
      p.challenge = undefined;
      return { ok: true };
    }

    case 'submit': {
      const c = p.challenge;
      if (!c || c.id !== a.challengeId) fail('no_challenge', 'Ce mini-jeu n’est plus actif (réunion, sabotage ou mort ?).');
      if (now - c!.startedAt < c!.minMs - 300) fail('too_fast', 'Trop rapide ! Prenez le temps de terminer le mini-jeu.');
      const station = s.terrain.stations.find((x) => x.id === c!.stationId)!;
      if (c!.purpose !== 'fix') {
        const block = taskBlockReason(p);
        if (block) {
          p.challenge = undefined;
          fail('blocked_task', block);
        }
      }
      if (!checkAnswer(c!.game, c!.answer, a.answer)) {
        if (c!.game === 'count' || c!.game === 'assemble' || c!.game === 'pin') {
          checkBlocked(p, now);
          registerFailure(s, p, now, 'réponse d’énigme');
        }
        fail('wrong', 'Ce n’est pas la bonne réponse. Réessayez.');
      }
      p.challenge = undefined;
      if (c!.purpose === 'fix') return applyFix(s, p, station, now);
      // Tâche réelle ou simulée (imposteur) : même progression et même réponse, pour que les deux téléphones
      // soient indiscernables. Seules les tâches de l'équipage comptent dans la barre (taskProgress).
      const assigned = p.tasks.find((t) => t.taskId === c!.taskId);
      if (!assigned || assigned.done || assigned.step !== c!.stepIndex) fail('task_state', 'Cette étape a déjà été validée.');
      const def = s.terrain.tasks.find((t) => t.id === assigned!.taskId)!;
      assigned!.step++;
      p.lastStationId = station.id;
      const fake = c!.purpose === 'fake';
      if (assigned!.step >= def.steps.length) {
        assigned!.done = true;
        assigned!.doneAt = now;
        log(s, now, 'task', `${p.name} a ${fake ? 'simulé' : 'terminé'} « ${def.name} »${p.alive ? '' : ' (fantôme)'}.`, true);
        if (!fake) checkWin(s, now);
        return { taskDone: true };
      }
      return { taskDone: false, nextStep: assigned!.step + 1 };
    }

    case 'callEmergency': {
      checkBlocked(p, now);
      const station = stationByCode(s, a.code);
      if (!station || station.kind !== 'emergency') {
        unusedKitSheet(s, p, a.code, now);
        registerFailure(s, p, now, 'code du bouton d’urgence');
        fail('bad_code', 'Ce n’est pas le code du bouton d’urgence.');
      }
      const info = scanStation(s, p, station!, now) as { block?: string };
      if (info.block) fail('cannot_call', info.block);
      p.emergencyLeft--;
      startMeeting(s, 'emergency', now, p.id);
      return { ok: true };
    }

    case 'report': {
      if (!p.alive) fail('dead', 'Les fantômes ne peuvent pas signaler de corps.');
      checkBlocked(p, now);
      if (s.sabotage?.kind === 'lights') fail('dark', 'Panne de courant : dans le noir, impossible de signaler un corps. Réparez d’abord au poste Énergie.');
      const code = normalizeCode(a.code);
      const body = s.players.find((x) => x.body && x.body.code === code && !x.body.reported && !x.body.vanished && !x.alive);
      if (!body) {
        registerFailure(s, p, now, 'code de corps');
        fail('bad_code', 'Code de corps invalide (ou corps déjà signalé).');
      }
      body!.body!.reported = true;
      startMeeting(s, 'report', now, p.id, body!.id);
      return { ok: true };
    }

    case 'kill': {
      // L'imposteur touche sa victime puis choisit son pseudonyme : la victime n'a rien à saisir.
      if (p.role !== 'impostor') fail('forbidden', 'Action réservée aux imposteurs.');
      if (!p.alive) fail('dead', 'Les fantômes ne peuvent pas éliminer.');
      if (now < p.killCooldownUntil) fail('cooldown', `Élimination disponible dans ${Math.ceil((p.killCooldownUntil - now) / 1000)} s.`);
      const v = s.players.find((x) => x.id === String(a.target ?? ''));
      if (!v || v.id === p.id || !inGame(v)) fail('bad_target', 'Joueur introuvable.');
      // l'imposteur connaît déjà ses alliés : ce refus ne révèle rien
      if (v!.role === 'impostor') fail('ally', 'Impossible : c’est un allié imposteur.');
      if (!v!.alive) fail('bad_target', 'Ce joueur ne peut pas être éliminé.');
      killPlayer(s, v!, now, 'killed', p);
      return { ok: true, name: v!.name };
    }

    case 'sabotage': {
      if (p.role !== 'impostor') fail('forbidden', 'Action réservée aux imposteurs.');
      if (s.sabotage) fail('busy', 'Un sabotage est déjà en cours.');
      if (now < s.sabotageCooldownUntil) fail('cooldown', `Sabotage disponible dans ${Math.ceil((s.sabotageCooldownUntil - now) / 1000)} s.`);
      const kind = a.kind;
      if (!availableSabotages(s.terrain).includes(kind)) fail('unavailable', 'Ce sabotage n’est pas disponible sur ce terrain.');
      const st = s.settings;
      const sab: ActiveSabotage = { kind, by: p.id, startedAt: now, fixed: [], holds: [] };
      if (kind === 'reactor') sab.deadline = now + sec(st.reactorSec);
      if (kind === 'oxygen') sab.deadline = now + sec(st.oxygenSec);
      s.sabotage = sab;
      // Les mini-jeux en cours sont conservés (aucun sabotage n'interrompt une tâche).
      log(s, now, 'sabotage', `Sabotage : ${SABOTAGE_INFO[kind].label}.`);
      log(s, now, 'sabotage_by', `Sabotage déclenché par ${p.name}.`, true);
      return { ok: true };
    }

    case 'fixStart': {
      if (!p.alive) fail('dead', 'Les fantômes ne peuvent pas réparer les sabotages.');
      checkBlocked(p, now);
      const station = stationByCode(s, a.code);
      if (!station) {
        unusedKitSheet(s, p, a.code, now);
        registerFailure(s, p, now, 'code de poste');
        fail('bad_code', 'Code de poste inconnu.');
      }
      const sab = s.sabotage;
      if (!sab || sab.kind === 'reactor' || (sab.kind as string) !== station!.kind) fail('nothing', 'Rien à réparer ici pour le moment.');
      if (sab!.kind === 'oxygen' && sab!.fixed.includes(station!.id)) fail('already', 'Ce poste est déjà réparé : allez à l’autre poste Oxygène !');
      const kind = sab!.kind === 'lights' ? 'switches' : sab!.kind === 'comms' ? 'tune' : 'pin';
      const ch = makeFixChallenge(kind, rng);
      p.challenge = { id: newId('c', rng), purpose: 'fix', stationId: station!.id, game: ch.game, params: ch.params, answer: ch.answer, startedAt: now, minMs: ch.minMs };
      return challengeView(s, p.challenge);
    }

    case 'hold': {
      if (!p.alive) fail('dead', 'Les fantômes ne peuvent pas réparer les sabotages.');
      const sab = s.sabotage;
      if (!sab || sab.kind !== 'reactor') {
        if (!a.on) return { ok: true };
        fail('nothing', 'Le réacteur ne fond pas : rien à faire ici.');
      }
      const station = stationByCode(s, a.code);
      if (!station || station.kind !== 'reactor') {
        unusedKitSheet(s, p, a.code, now);
        checkBlocked(p, now);
        registerFailure(s, p, now, 'code de poste réacteur');
        fail('bad_code', 'Ce n’est pas un poste Réacteur.');
      }
      if (!a.on) {
        sab!.holds = sab!.holds.filter((h) => h.playerId !== p.id);
        return { ok: true };
      }
      const mine = sab!.holds.find((h) => h.playerId === p.id && h.stationId === station!.id);
      sab!.holds = sab!.holds.filter((h) => h.playerId !== p.id); // une seule main par joueur
      sab!.holds.push({ stationId: station!.id, playerId: p.id, since: mine ? mine.since : now, beat: now });
      checkReactor(s, now);
      return { fixed: !s.sabotage, holders: s.sabotage ? new Set(freshHolds(s.sabotage, now).map((h) => h.stationId)).size : 2 };
    }
  }
  return fail('unknown', 'Action inconnue.');
}

function applyFix(s: GameState, p: PlayerState, station: Station, now: number) {
  const sab = s.sabotage;
  if (!sab || sab.kind !== station.kind) return { fixed: false, stale: true };
  if (sab.kind === 'oxygen') {
    if (!sab.fixed.includes(station.id)) sab.fixed.push(station.id);
    log(s, now, 'fix_part', `${station.name} réparé par ${p.name}.`, true);
    const all = s.terrain.stations.filter((x) => x.kind === 'oxygen');
    const needed = Math.min(2, all.length);
    if (sab.fixed.length >= needed) {
      resolveSabotage(s, now, 'réparé');
      return { fixed: true };
    }
    return { fixed: false, partial: true };
  }
  log(s, now, 'fix_part', `${station.name} : réparation par ${p.name}.`, true);
  resolveSabotage(s, now, 'réparé');
  return { fixed: true };
}

export function killPlayer(s: GameState, victim: PlayerState, now: number, cause: 'killed' | 'gm', killer?: PlayerState) {
  victim.alive = false;
  victim.diedAt = now;
  victim.deathCause = cause;
  victim.killedBy = killer?.id;
  victim.challenge = undefined;
  if (s.sabotage) s.sabotage.holds = s.sabotage.holds.filter((h) => h.playerId !== victim.id);
  if (s.phase === 'playing') {
    const t = s.settings.bodyTimeoutSec;
    victim.body = { code: uniqueDigits(s, cryptoRng), at: now, reported: false, vanished: false, vanishAt: t > 0 ? now + sec(t) : undefined };
    victim.deathRevealed = false;
  } else {
    victim.body = undefined;
    victim.deathRevealed = true;
  }
  if (killer) {
    killer.killCooldownUntil = now + sec(s.settings.killCooldownSec);
    killer.kills++;
    log(s, now, 'kill', `${killer.name} a éliminé ${victim.name}.`, true);
  } else {
    log(s, now, 'kill', `Le maître du jeu a déclaré ${victim.name} mort·e.`, true);
  }
  checkWin(s, now);
}

function markLeft(s: GameState, p: PlayerState, now: number, msg: string) {
  p.left = true;
  if (p.alive) {
    p.alive = false;
    p.deathCause = 'left';
    p.diedAt = now;
  }
  p.deathRevealed = true;
  p.challenge = undefined;
  if (p.body) p.body.vanished = true;
  if (s.sabotage) s.sabotage.holds = s.sabotage.holds.filter((h) => h.playerId !== p.id);
  log(s, now, 'left', msg);
  meetingRecheck(s, now);
  checkWin(s, now);
}

// ---------------------------------------------------------------------------
// Actions du maître du jeu
// ---------------------------------------------------------------------------

export type GmAction =
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'terrain'; terrain: Terrain }
  | { type: 'lock'; locked: boolean }
  | { type: 'kick'; playerId: string }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'meeting'; bodyOf?: string }
  | { type: 'advance' }
  | { type: 'extend'; seconds: number }
  | { type: 'end'; winner: Winner }
  | { type: 'revive'; playerId: string }
  | { type: 'kill'; playerId: string }
  | { type: 'taskDone'; playerId: string; taskId: string; done: boolean }
  | { type: 'fixSabotage' }
  | { type: 'markLeft'; playerId: string }
  | { type: 'ackAlert'; id: number }
  | { type: 'newGame' }
  | { type: 'ping' }
  | { type: 'pushSubscribe'; subscription: unknown }
  | { type: 'testTask'; taskId: string; stepIndex?: number }
  | { type: 'testFix'; kind: FixKind }
  | { type: 'testSubmit'; challengeId: string; answer: unknown }
  | { type: 'testCancel' };

export function gmAction(s: GameState, a: GmAction, ctx: Ctx): unknown {
  const { now } = ctx;
  const findP = (id: string) => {
    const p = s.players.find((x) => x.id === id && !x.kicked);
    if (!p) fail('no_player', 'Joueur introuvable.');
    return p!;
  };
  const needGame = () => {
    if (s.phase !== 'playing' && s.phase !== 'meeting') fail('not_playing', 'Aucune manche en cours.');
  };
  switch (a?.type) {
    case 'settings':
      if (s.phase !== 'lobby') fail('not_lobby', 'Les paramètres se modifient dans le salon, avant le démarrage.');
      s.settings = sanitizeSettings(a.settings, s.settings);
      log(s, now, 'gm', 'Paramètres modifiés.');
      return { ok: true };
    case 'terrain':
      if (s.phase !== 'lobby') fail('not_lobby', 'Le terrain se modifie dans le salon, avant le démarrage.');
      s.terrain = sanitizeTerrain(a.terrain);
      log(s, now, 'gm', 'Terrain modifié.');
      return { ok: true };
    case 'lock':
      s.lobbyLocked = !!a.locked;
      return { ok: true };
    case 'kick': {
      const p = findP(a.playerId);
      if (s.phase === 'lobby' || !p.role) {
        s.players = s.players.filter((x) => x.id !== p.id);
        log(s, now, 'gm', `${p.name} a été retiré·e du salon.`);
      } else {
        p.kicked = true;
        markLeft(s, p, now, `${p.name} a été exclu·e par le maître du jeu.`);
      }
      return { ok: true };
    }
    case 'start':
      startGame(s, ctx);
      return { ok: true };
    case 'pause':
      needGame();
      if (!s.paused) {
        s.paused = true;
        s.pausedAt = now;
        if (s.sabotage) s.sabotage.holds = [];
        log(s, now, 'pause', 'Pause générale.');
      }
      return { ok: true };
    case 'stop':
      if (s.phase === 'playing' || s.phase === 'meeting') {
        if (!s.paused) {
          s.paused = true;
          s.pausedAt = now;
        }
      }
      s.emergencyStop = true;
      log(s, now, 'stop', 'ARRÊT D’URGENCE déclenché par le maître du jeu.');
      return { ok: true };
    case 'resume':
      if (s.paused) {
        shiftTimers(s, now - (s.pausedAt ?? now));
        s.paused = false;
        s.pausedAt = undefined;
      }
      s.emergencyStop = false;
      log(s, now, 'resume', 'Reprise de la partie.');
      return { ok: true };
    case 'meeting': {
      if (s.phase !== 'playing') fail('not_playing', 'Une réunion ne peut être convoquée que pendant le jeu.');
      let bodyOf: string | undefined;
      if (a.bodyOf) {
        const b = findP(a.bodyOf);
        if (b.alive) fail('alive', 'Ce joueur est vivant.');
        if (b.body) b.body.reported = true;
        bodyOf = b.id;
      }
      startMeeting(s, 'gm', now, undefined, bodyOf);
      return { ok: true };
    }
    case 'advance':
      if (s.phase !== 'meeting') fail('not_meeting', 'Aucune réunion en cours.');
      advanceMeeting(s, now);
      return { ok: true };
    case 'extend': {
      if (s.phase !== 'meeting' || !s.meeting) fail('not_meeting', 'Aucune réunion en cours.');
      const add = Math.max(-300, Math.min(300, Math.round(Number(a.seconds) || 0)));
      s.meeting!.stageEndsAt = Math.max(now + 1000, s.meeting!.stageEndsAt + sec(add));
      return { ok: true };
    }
    case 'end': {
      needGame();
      const w: Winner = a.winner === 'crew' || a.winner === 'impostors' ? a.winner : 'none';
      endGame(s, w, 'Fin de partie décidée par le maître du jeu.', now);
      return { ok: true };
    }
    case 'revive': {
      needGame();
      const p = findP(a.playerId);
      if (p.alive) fail('alive', 'Ce joueur est déjà vivant.');
      if (p.left) fail('left', 'Ce joueur a quitté la partie.');
      p.alive = true;
      p.deathRevealed = false;
      p.diedAt = undefined;
      p.deathCause = undefined;
      p.killedBy = undefined;
      p.body = undefined;
      p.disputed = undefined;
      log(s, now, 'gm', `Correction : ${p.name} est ramené·e à la vie par le maître du jeu.`);
      if (s.phase === 'playing') checkWin(s, now);
      return { ok: true };
    }
    case 'kill': {
      needGame();
      const p = findP(a.playerId);
      if (!p.alive) fail('dead', 'Ce joueur est déjà mort.');
      if (!p.role) fail('no_role', 'Ce joueur ne participe pas.');
      killPlayer(s, p, now, 'gm');
      meetingRecheck(s, now);
      return { ok: true, body: p.body?.code };
    }
    case 'taskDone': {
      needGame();
      const p = findP(a.playerId);
      const t = p.tasks.find((x) => x.taskId === a.taskId);
      if (!t) fail('no_task', 'Tâche introuvable.');
      const def = s.terrain.tasks.find((x) => x.id === t!.taskId)!;
      t!.done = !!a.done;
      t!.step = a.done ? def.steps.length : 0;
      t!.doneAt = a.done ? now : undefined;
      log(s, now, 'gm', `Correction : tâche « ${def.name} » de ${p.name} ${a.done ? 'validée' : 'réinitialisée'}.`);
      checkWin(s, now);
      return { ok: true };
    }
    case 'fixSabotage':
      if (!s.sabotage) fail('none', 'Aucun sabotage en cours.');
      resolveSabotage(s, now, 'annulé par le maître du jeu');
      return { ok: true };
    case 'markLeft': {
      needGame();
      const p = findP(a.playerId);
      if (p.left) fail('left', 'Déjà parti·e.');
      markLeft(s, p, now, `${p.name} a quitté la partie (déclaré par le maître du jeu).`);
      return { ok: true };
    }
    case 'ping':
      s.pingId++;
      log(s, now, 'gm', 'Test d\u2019alerte envoyé à tous les téléphones.');
      return { ok: true, pingId: s.pingId };
    case 'pushSubscribe': {
      const sub = validSubscription(a.subscription);
      if (!sub) fail('bad_push', 'Abonnement aux notifications refusé.');
      s.gmPush = [...s.gmPush.filter((x) => x.endpoint !== sub!.endpoint), sub!].slice(-5);
      return { ok: true };
    }
    case 'testTask': {
      const def = s.terrain.tasks.find((t) => t.id === a.taskId);
      if (!def) fail('no_task', 'Tâche introuvable (terrain non enregistré ?).');
      const idx = Math.max(0, Math.min(def!.steps.length - 1, Number(a.stepIndex) || 0));
      const step = def!.steps[idx];
      const ch = makeTaskChallenge(step.game, def!.seed, ctx.rng);
      if (step.game === 'scan') ch.params = { visual: true };
      s.gmChallenge = { id: newId('c', ctx.rng), purpose: 'task', taskId: def!.id, stepIndex: idx, stationId: step.stationId, game: ch.game, params: ch.params, answer: ch.answer, startedAt: now, minMs: ch.minMs };
      return gmChallengeView(s);
    }
    case 'testFix': {
      if (!['switches', 'tune', 'pin'].includes(a.kind)) fail('bad_fix', 'Réparation inconnue.');
      const ch = makeFixChallenge(a.kind, ctx.rng);
      const kind = a.kind === 'switches' ? 'lights' : a.kind === 'tune' ? 'comms' : 'oxygen';
      const st = s.terrain.stations.find((x) => x.kind === kind);
      s.gmChallenge = { id: newId('c', ctx.rng), purpose: 'fix', stationId: st?.id ?? '', game: ch.game, params: ch.params, answer: ch.answer, startedAt: now, minMs: ch.minMs };
      return gmChallengeView(s);
    }
    case 'testSubmit': {
      const c = s.gmChallenge;
      if (!c || c.id !== a.challengeId) fail('no_challenge', 'Ce test n\u2019est plus actif.');
      if (now - c!.startedAt < c!.minMs - 300) fail('too_fast', 'Trop rapide : la durée minimale du mini-jeu n\u2019est pas écoulée.');
      if (!checkAnswer(c!.game, c!.answer, a.answer)) fail('wrong', 'Réponse refusée par le serveur.');
      s.gmChallenge = undefined;
      return { ok: true, game: c!.game };
    }
    case 'testCancel':
      s.gmChallenge = undefined;
      return { ok: true };
    case 'ackAlert': {
      const al = s.alerts.find((x) => x.id === a.id);
      if (al) al.acked = true;
      return { ok: true };
    }
    case 'newGame': {
      if (s.phase !== 'ended' && s.phase !== 'lobby') fail('in_progress', 'Terminez d’abord la manche en cours.');
      s.players = s.players.filter((p) => !p.kicked && !p.left);
      for (const p of s.players) {
        p.role = undefined;
        p.alive = true;
        p.deathRevealed = false;
        p.diedAt = undefined;
        p.deathCause = undefined;
        p.killedBy = undefined;
        p.tasks = [];
        p.body = undefined;
        p.challenge = undefined;
        p.disputed = undefined;
        p.lastStationId = undefined;
        p.kills = 0;
        p.checkedIn = false;
        p.failures = [];
        p.blockedUntil = 0;
      }
      s.phase = 'lobby';
      s.gameNumber++;
      s.sabotage = undefined;
      s.sabotageHistory = [];
      s.meeting = undefined;
      s.meetings = [];
      s.winner = undefined;
      s.endReason = undefined;
      s.endedAt = undefined;
      s.startedAt = undefined;
      s.paused = false;
      s.emergencyStop = false;
      s.alerts = s.alerts.filter((x) => !x.acked);
      s.log = [{ at: now, type: 'new', msg: `Nouvelle partie n°${s.gameNumber} : retour au salon.` }];
      return { ok: true };
    }
  }
  return fail('unknown', 'Action inconnue.');
}
