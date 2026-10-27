// Vues filtrées : ce que chaque appareil a le droit de recevoir.
// Un joueur ne reçoit JAMAIS : le rôle des autres (sauf alliés imposteurs / fin de partie),
// les codes des postes, les codes d'élimination des autres, les réponses des mini-jeux,
// les votes individuels avant la révélation, ni le journal secret.

import { GAMES, SABOTAGE_INFO } from './catalog';
import { bodyPending, challengeView, inGame, taskProgress, type ChallengeView } from './engine';
import { availableSabotages } from './terrain';
import type {
  GameState, LogEntry, Meeting, MeetingStage, Passage, Phase, PlayerState, Role, Room, SabotageKind, SafetyAlert, Settings,
  StationKind, TaskType, Terrain, VoteResult, Winner,
} from './types';

export type Status = 'alive' | 'dead' | 'left';

export interface PublicPlayer {
  id: string;
  name: string;
  num: number;
  status: Status;
  role?: Role;
  voted?: boolean;
  checkedIn?: boolean;
}

export interface MyTask {
  taskId: string;
  name: string;
  type: TaskType;
  steps: number;
  step: number;
  done: boolean;
  next?: { stationName: string; roomName: string; floor: string; gameLabel: string };
}

export interface SabotageView {
  kind: SabotageKind;
  label: string;
  critical: boolean;
  deadline?: number;
  endsAt?: number;
  roomName?: string;
  roomId?: string;
  stations: { name: string; roomName: string; fixed: boolean; held: boolean }[];
}

export interface MeetingView {
  id: number;
  kind: Meeting['kind'];
  calledByName?: string;
  bodyOfName?: string;
  stage: MeetingStage;
  stageEndsAt: number;
  newlyDead: { id: string; name: string }[];
  votedIds: string[];
  myVote?: string;
  checkedInCount: number;
  aliveCount: number;
  result?: VoteResult & { ejectedName?: string };
  endedSabotage?: string;
}

export interface EndView {
  winner: Winner;
  reason: string;
  endedAt: number;
  players: {
    id: string;
    name: string;
    num: number;
    role?: Role;
    status: Status;
    deathCause?: string;
    killedByName?: string;
    tasksDone: number;
    tasksTotal: number;
    kills: number;
  }[];
  meetings: {
    id: number;
    kind: Meeting['kind'];
    calledByName?: string;
    bodyOfName?: string;
    newlyDead: string[];
    ejectedName?: string;
    wasImpostor?: boolean;
    tie: boolean;
    skips: number;
    tally: { name: string; votes: number }[];
    votes?: { voter: string; target: string }[];
  }[];
  sabotages: { label: string; byName: string; at: number; outcome: string; roomName?: string }[];
  kills: { at: number; killer: string; victim: string }[];
  taskBar: number;
  durationSec: number;
}

export interface PublicTerrain {
  name: string;
  rooms: Room[];
  meetingRoomId: string;
  safetyNotes: string;
  stations: { id: string; name: string; roomId: string; kind: StationKind }[];
  passages?: Passage[];
}

export interface PlayerView {
  kind: 'player';
  now: number;
  code: string;
  gameNumber: number;
  phase: Phase;
  paused: boolean;
  emergencyStop: boolean;
  lobbyLocked: boolean;
  settings: Settings;
  terrain: PublicTerrain;
  me: {
    id: string;
    name: string;
    num: number;
    role?: Role;
    alive: boolean;
    left: boolean;
    deathCause?: string;
    killedByName?: string;
    tasks?: MyTask[];
    tasksHidden: boolean;
    emergencyLeft: number;
    killCooldownUntil?: number;
    killCode?: { code: string; expiresAt: number };
    body?: { code: string; reported: boolean; vanished: boolean; vanishAt?: number };
    bodyPending: boolean;
    challenge?: ChallengeView;
    blockedUntil: number;
    checkedIn: boolean;
  };
  allies?: { id: string; name: string; num: number; status: Status }[];
  players: PublicPlayer[];
  taskBar?: number;
  emergencyCooldownUntil: number;
  sabotageCooldownUntil?: number;
  sabotageOptions?: SabotageKind[];
  sabotage?: SabotageView;
  meeting?: MeetingView;
  end?: EndView;
}

export interface GmPlayer {
  id: string;
  name: string;
  num: number;
  role?: Role;
  alive: boolean;
  left: boolean;
  kicked: boolean;
  connected: boolean;
  deathCause?: string;
  deathRevealed: boolean;
  killedByName?: string;
  body?: { code: string; reported: boolean; vanished: boolean };
  tasks: { taskId: string; name: string; type: TaskType; step: number; steps: number; done: boolean }[];
  emergencyLeft: number;
  killCooldownUntil: number;
  armed: boolean;
  kills: number;
  checkedIn: boolean;
  blockedUntil: number;
  voted: boolean;
  inChallenge?: string;
}

export interface GmView {
  kind: 'gm';
  now: number;
  code: string;
  gameNumber: number;
  phase: Phase;
  paused: boolean;
  emergencyStop: boolean;
  lobbyLocked: boolean;
  settings: Settings;
  terrain: Terrain;
  players: GmPlayer[];
  taskBar: { done: number; total: number };
  emergencyCooldownUntil: number;
  sabotageCooldownUntil: number;
  sabotage?: SabotageView & { byName: string; holds: { stationName: string; playerName: string }[] };
  meeting?: MeetingView & { votes: { voter: string; target: string }[] };
  sabotageOptions: SabotageKind[];
  alerts: (SafetyAlert & { playerName: string })[];
  log: LogEntry[];
  end?: EndView;
  startedAt?: number;
}

const roomName = (s: GameState, id?: string) => s.terrain.rooms.find((r) => r.id === id)?.name ?? '';
const nameOf = (s: GameState, id?: string) => (id === 'skip' ? 'Passer' : s.players.find((p) => p.id === id)?.name ?? '?');
const realStatus = (p: PlayerState): Status => (p.left ? 'left' : p.alive ? 'alive' : 'dead');

function taskList(s: GameState, p: PlayerState): MyTask[] {
  return p.tasks.map((a) => {
    const def = s.terrain.tasks.find((t) => t.id === a.taskId)!;
    const step = def.steps[a.step];
    const st = step ? s.terrain.stations.find((x) => x.id === step.stationId) : undefined;
    const room = st ? s.terrain.rooms.find((r) => r.id === st.roomId) : undefined;
    return {
      taskId: def.id,
      name: def.name,
      type: def.type,
      steps: def.steps.length,
      step: a.step,
      done: a.done,
      next: step && st ? { stationName: st.name, roomName: room?.name ?? '', floor: room?.floor ?? '', gameLabel: GAMES[step.game].label } : undefined,
    };
  });
}

function sabotageView(s: GameState, now: number): SabotageView | undefined {
  const sab = s.sabotage;
  if (!sab) return undefined;
  const kindStations = sab.kind === 'doors' ? [] : s.terrain.stations.filter((x) => x.kind === sab.kind);
  const fresh = sab.holds.filter((h) => h.beat > now - 5000);
  return {
    kind: sab.kind,
    label: SABOTAGE_INFO[sab.kind].label,
    critical: SABOTAGE_INFO[sab.kind].critical,
    deadline: sab.deadline,
    endsAt: sab.endsAt,
    roomId: sab.roomId,
    roomName: sab.roomId ? roomName(s, sab.roomId) : undefined,
    stations: kindStations.map((x) => ({
      name: x.name,
      roomName: roomName(s, x.roomId),
      fixed: sab.fixed.includes(x.id),
      held: fresh.some((h) => h.stationId === x.id),
    })),
  };
}

function meetingView(s: GameState, viewer?: PlayerState): MeetingView | undefined {
  const m = s.meeting;
  if (!m) return undefined;
  const alive = s.players.filter((p) => inGame(p) && p.alive);
  return {
    id: m.id,
    kind: m.kind,
    calledByName: m.calledBy ? nameOf(s, m.calledBy) : undefined,
    bodyOfName: m.bodyOf ? nameOf(s, m.bodyOf) : undefined,
    stage: m.stage,
    stageEndsAt: m.stageEndsAt,
    newlyDead: m.newlyDead.map((id) => ({ id, name: nameOf(s, id) })),
    votedIds: Object.keys(m.votes),
    myVote: viewer ? m.votes[viewer.id] : undefined,
    checkedInCount: alive.filter((p) => p.checkedIn).length,
    aliveCount: alive.length,
    result: m.stage === 'result' && m.result ? { ...m.result, ejectedName: m.result.ejectedId ? nameOf(s, m.result.ejectedId) : undefined } : undefined,
    endedSabotage: m.endedSabotage ? SABOTAGE_INFO[m.endedSabotage].label : undefined,
  };
}

function endView(s: GameState): EndView | undefined {
  if (s.phase !== 'ended' || !s.winner) return undefined;
  const { done, total } = taskProgress(s);
  return {
    winner: s.winner,
    reason: s.endReason ?? '',
    endedAt: s.endedAt ?? 0,
    players: s.players.filter((p) => p.role && !p.kicked).map((p) => ({
      id: p.id,
      name: p.name,
      num: p.num,
      role: p.role,
      status: realStatus(p),
      deathCause: p.deathCause,
      killedByName: p.killedBy ? nameOf(s, p.killedBy) : undefined,
      tasksDone: p.tasks.filter((t) => t.done).length,
      tasksTotal: p.tasks.length,
      kills: p.kills,
    })),
    meetings: s.meetings.map((m) => ({
      id: m.id,
      kind: m.kind,
      calledByName: m.calledBy ? nameOf(s, m.calledBy) : undefined,
      bodyOfName: m.bodyOf ? nameOf(s, m.bodyOf) : undefined,
      newlyDead: m.newlyDead.map((id) => nameOf(s, id)),
      ejectedName: m.result?.ejectedId ? nameOf(s, m.result.ejectedId) : undefined,
      wasImpostor: m.result?.ejectedId ? s.players.find((p) => p.id === m.result!.ejectedId)?.role === 'impostor' : undefined,
      tie: !!m.result?.tie,
      skips: m.result?.skips ?? 0,
      tally: Object.entries(m.result?.tally ?? {}).map(([id, n]) => ({ name: nameOf(s, id), votes: n })).sort((a, b) => b.votes - a.votes),
      votes: s.settings.anonymousVotes ? undefined : Object.entries(m.votes).map(([v, t]) => ({ voter: nameOf(s, v), target: nameOf(s, t) })),
    })),
    sabotages: s.sabotageHistory.map((h) => ({ label: SABOTAGE_INFO[h.kind].label, byName: nameOf(s, h.by), at: h.at, outcome: h.outcome, roomName: h.roomId ? roomName(s, h.roomId) : undefined })),
    kills: s.players.filter((p) => p.deathCause === 'killed' && p.killedBy).map((p) => ({ at: p.diedAt ?? 0, killer: nameOf(s, p.killedBy), victim: p.name })).sort((a, b) => a.at - b.at),
    taskBar: total ? done / total : 0,
    durationSec: Math.round(((s.endedAt ?? 0) - (s.startedAt ?? s.endedAt ?? 0)) / 1000),
  };
}

function publicTerrain(s: GameState, withPassages: boolean): PublicTerrain {
  const t = s.terrain;
  return {
    name: t.name,
    rooms: t.rooms,
    meetingRoomId: t.meetingRoomId,
    safetyNotes: t.safetyNotes,
    stations: t.stations.map((x) => ({ id: x.id, name: x.name, roomId: x.roomId, kind: x.kind })),
    passages: withPassages ? t.passages : undefined,
  };
}

export function viewForPlayer(s: GameState, playerId: string, now: number): PlayerView {
  const me = s.players.find((p) => p.id === playerId)!;
  const ended = s.phase === 'ended';
  const started = s.phase !== 'lobby' && !!me.role;
  const isImp = started && me.role === 'impostor';
  const ghost = started && !me.alive;
  const seeAllDeaths = ghost || ended;
  const seeAllRoles = ended || (ghost && s.settings.ghostsSeeRoles);
  const comms = s.sabotage?.kind === 'comms';
  const players: PublicPlayer[] = s.players
    .filter((p) => !p.kicked)
    .map((p) => {
      let status: Status = 'alive';
      if (p.left) status = 'left';
      else if (!p.alive && (p.id === me.id || p.deathRevealed || seeAllDeaths)) status = 'dead';
      let role: Role | undefined;
      if (started && (p.id === me.id || seeAllRoles || (isImp && p.role === 'impostor'))) role = p.role;
      const out: PublicPlayer = { id: p.id, name: p.name, num: p.num, status, role };
      if (s.meeting) {
        out.voted = !!s.meeting.votes[p.id];
        out.checkedIn = p.checkedIn;
      }
      return out;
    });

  let taskBar: number | undefined;
  if (started && !comms && s.settings.taskBarUpdates !== 'never') {
    if (s.settings.taskBarUpdates === 'always' || ended) {
      const { done, total } = taskProgress(s);
      taskBar = total ? done / total : 0;
    } else taskBar = s.taskBarSnapshot;
  }
  // Pendant « Communications coupées », un joueur vivant ne voit plus sa liste de tâches
  // (imposteurs compris, pour que leur écran reste identique à celui d'un équipier).
  const tasksHidden = started && comms && me.alive;
  const view: PlayerView = {
    kind: 'player',
    now,
    code: s.code,
    gameNumber: s.gameNumber,
    phase: s.phase,
    paused: s.paused,
    emergencyStop: s.emergencyStop,
    lobbyLocked: s.lobbyLocked,
    settings: s.settings,
    terrain: publicTerrain(s, isImp),
    me: {
      id: me.id,
      name: me.name,
      num: me.num,
      role: started ? me.role : undefined,
      alive: me.alive,
      left: me.left,
      deathCause: me.deathCause,
      killedByName: me.killedBy ? nameOf(s, me.killedBy) : undefined,
      tasks: started && !tasksHidden ? taskList(s, me) : undefined,
      tasksHidden,
      emergencyLeft: me.emergencyLeft,
      killCooldownUntil: isImp ? me.killCooldownUntil : undefined,
      killCode: isImp && me.killCode && me.killCode.expiresAt > now ? me.killCode : undefined,
      body: me.body && !me.alive ? { code: me.body.code, reported: me.body.reported, vanished: me.body.vanished, vanishAt: me.body.vanishAt } : undefined,
      bodyPending: bodyPending(me),
      challenge: me.challenge ? challengeView(s, me.challenge) : undefined,
      blockedUntil: me.blockedUntil,
      checkedIn: me.checkedIn,
    },
    players,
    taskBar,
    emergencyCooldownUntil: s.emergencyCooldownUntil,
    sabotage: started ? sabotageView(s, now) : undefined,
    meeting: meetingView(s, me),
    end: endView(s),
  };
  if (isImp) {
    view.allies = s.players.filter((p) => p.role === 'impostor' && p.id !== me.id && !p.kicked).map((p) => ({ id: p.id, name: p.name, num: p.num, status: realStatus(p) }));
    view.sabotageCooldownUntil = s.sabotageCooldownUntil;
    view.sabotageOptions = availableSabotages(s.terrain);
  }
  return view;
}

export function viewForGm(s: GameState, now: number, connected: Set<string>): GmView {
  const sab = sabotageView(s, now);
  const m = meetingView(s);
  return {
    kind: 'gm',
    now,
    code: s.code,
    gameNumber: s.gameNumber,
    phase: s.phase,
    paused: s.paused,
    emergencyStop: s.emergencyStop,
    lobbyLocked: s.lobbyLocked,
    settings: s.settings,
    terrain: s.terrain,
    players: s.players.filter((p) => !p.kicked || p.role).map((p) => ({
      id: p.id,
      name: p.name,
      num: p.num,
      role: p.role,
      alive: p.alive,
      left: p.left,
      kicked: p.kicked,
      connected: connected.has(p.id),
      deathCause: p.deathCause,
      deathRevealed: p.deathRevealed,
      killedByName: p.killedBy ? nameOf(s, p.killedBy) : undefined,
      body: p.body ? { code: p.body.code, reported: p.body.reported, vanished: p.body.vanished } : undefined,
      tasks: p.tasks.map((a) => {
        const def = s.terrain.tasks.find((t) => t.id === a.taskId);
        return { taskId: a.taskId, name: def?.name ?? '?', type: def?.type ?? 'short', step: a.step, steps: def?.steps.length ?? 1, done: a.done };
      }),
      emergencyLeft: p.emergencyLeft,
      killCooldownUntil: p.killCooldownUntil,
      armed: !!p.killCode && p.killCode.expiresAt > now,
      kills: p.kills,
      checkedIn: p.checkedIn,
      blockedUntil: p.blockedUntil,
      voted: !!s.meeting?.votes[p.id],
      inChallenge: p.challenge ? p.challenge.game : undefined,
    })),
    taskBar: taskProgress(s),
    emergencyCooldownUntil: s.emergencyCooldownUntil,
    sabotageCooldownUntil: s.sabotageCooldownUntil,
    sabotage: sab && s.sabotage
      ? {
          ...sab,
          byName: nameOf(s, s.sabotage.by),
          holds: s.sabotage.holds.filter((h) => h.beat > now - 5000).map((h) => ({ stationName: s.terrain.stations.find((x) => x.id === h.stationId)?.name ?? '', playerName: nameOf(s, h.playerId) })),
        }
      : undefined,
    meeting: m && s.meeting ? { ...m, votes: Object.entries(s.meeting.votes).map(([v, t]) => ({ voter: nameOf(s, v), target: nameOf(s, t) })) } : undefined,
    sabotageOptions: availableSabotages(s.terrain),
    alerts: s.alerts.map((a) => ({ ...a, playerName: nameOf(s, a.playerId) })),
    log: s.log.slice(-400),
    end: endView(s),
    startedAt: s.startedAt,
  };
}

