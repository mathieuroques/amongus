import { describe, expect, it } from 'vitest';
import {
  addPlayer, createGame, GameError, gmAction, nextWakeup, playerAction, tallyVotes, taskProgress, tick, type PlayerAction,
} from '../src/shared/engine';
import { assemblePuzzle, countPuzzle } from '../src/shared/puzzles';
import { seededRng } from '../src/shared/rng';
import { exampleTerrain, sanitizeTerrain } from '../src/shared/terrain';
import type { GameState, PlayerState } from '../src/shared/types';
import { viewForGm, viewForPlayer } from '../src/shared/view';

let clock = 1_000_000;
const rng = seededRng(42);
const ctx = () => ({ now: clock, rng });
const advance = (ms: number) => {
  clock += ms;
};

function setup(n = 10, impostors = 2, extra: Record<string, unknown> = {}): GameState {
  clock = 1_000_000;
  const s = createGame('BCDFGH', 'gmhash', 'secrethash', clock, { impostors, ...extra }, exampleTerrain(seededRng(7)));
  for (let i = 0; i < n; i++) addPlayer(s, `Joueur ${i + 1}`, `tok${i}`, clock);
  gmAction(s, { type: 'start' }, ctx());
  return s;
}

const imps = (s: GameState) => s.players.filter((p) => p.role === 'impostor');
const crew = (s: GameState) => s.players.filter((p) => p.role === 'crewmate');
const act = (s: GameState, p: PlayerState, a: PlayerAction) => playerAction(s, p.id, a, ctx());
const err = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameError) return e.code;
    throw e;
  }
  throw new Error('aucune erreur levée');
};
const stationOf = (s: GameState, kind: string, i = 0) => s.terrain.stations.filter((x) => x.kind === kind)[i];

/** Termine l'étape courante d'une tâche en répondant correctement au défi (le test lit la réponse côté serveur). */
function doStep(s: GameState, p: PlayerState, taskId: string) {
  const a = p.tasks.find((t) => t.taskId === taskId)!;
  const def = s.terrain.tasks.find((t) => t.id === taskId)!;
  const st = s.terrain.stations.find((x) => x.id === def.steps[a.step].stationId)!;
  const ch = act(s, p, { type: 'startTask', code: st.code, taskId }) as { id: string };
  advance(15_000);
  return act(s, p, { type: 'submit', challengeId: ch.id, answer: p.challenge!.answer });
}

function finishAllTasks(s: GameState, p: PlayerState) {
  for (const t of p.tasks) while (!t.done) doStep(s, p, t.taskId);
}

function kill(s: GameState, imp: PlayerState, victim: PlayerState) {
  if (clock < imp.killCooldownUntil) advance(imp.killCooldownUntil - clock);
  const { code } = act(s, imp, { type: 'arm' }) as { code: string };
  return act(s, victim, { type: 'killed', code });
}

function runMeetingToVoting(s: GameState) {
  for (const p of s.players.filter((x) => x.alive && !x.left)) act(s, p, { type: 'checkIn' });
  expect(s.meeting!.stage).toBe('discussion');
  gmAction(s, { type: 'advance' }, ctx());
  expect(s.meeting!.stage).toBe('voting');
}

describe('création et salon', () => {
  it('crée une partie et refuse les pseudonymes en double (accents/majuscules ignorés)', () => {
    const s = createGame('BCDFGH', 'h', 'h2', 0);
    addPlayer(s, 'Élodie', 't1', 0);
    expect(err(() => addPlayer(s, 'elodie', 't2', 0))).toBe('name_taken');
    expect(err(() => addPlayer(s, 'a', 't3', 0))).toBe('bad_name');
    expect(s.players).toHaveLength(1);
  });

  it('refuse de démarrer avec trop d’imposteurs', () => {
    const s = createGame('BCDFGH', 'h', 'h2', 0, { impostors: 3 });
    for (let i = 0; i < 6; i++) addPlayer(s, `P${i}`, `t${i}`, 0);
    expect(err(() => gmAction(s, { type: 'start' }, ctx()))).toBe('cannot_start');
    expect(s.phase).toBe('lobby');
  });

  it('refuse les arrivées une fois la partie lancée', () => {
    const s = setup(6, 1);
    expect(err(() => addPlayer(s, 'Retard', 'tx', clock))).toBe('started');
  });
});

describe('rôles et confidentialité', () => {
  it('attribue exactement le bon nombre d’imposteurs', () => {
    const s = setup(30, 5);
    expect(imps(s)).toHaveLength(5);
    expect(crew(s)).toHaveLength(25);
  });

  it('la répartition des rôles est aléatoire (chaque joueur peut être imposteur)', () => {
    const counts = new Array(8).fill(0);
    for (let k = 0; k < 400; k++) {
      const s = setup(8, 1);
      counts[s.players.findIndex((p) => p.role === 'impostor')]++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(20); // ~50 attendu par joueur
  });

  it('la vue d’un membre d’équipage ne contient aucun rôle d’autrui ni aucun secret', () => {
    const s = setup(10, 2);
    const c = crew(s)[0];
    const v = viewForPlayer(s, c.id, clock);
    const json = JSON.stringify(v);
    for (const p of s.players) if (p.id !== c.id) expect(v.players.find((x) => x.id === p.id)!.role).toBeUndefined();
    expect(json).not.toContain('"role":"impostor"');
    for (const st of s.terrain.stations) expect(json).not.toContain(`"${st.code}"`);
    expect(json).not.toContain('tokenHash');
    expect(json).not.toContain('answer');
    expect(v.allies).toBeUndefined();
    expect(v.terrain.passages).toBeUndefined();
  });

  it('un imposteur voit ses alliés mais pas le code d’élimination des autres', () => {
    const s = setup(10, 2);
    const [a, b] = imps(s);
    kill(s, b, crew(s)[0]); // b a un délai ; on arme ensuite a
    advance(120_000);
    act(s, a, { type: 'arm' });
    const vb = viewForPlayer(s, b.id, clock);
    expect(vb.allies!.map((x) => x.id)).toEqual([a.id]);
    expect(JSON.stringify(vb)).not.toContain(a.killCode!.code);
    expect(vb.terrain.passages).toBeDefined();
  });

  it('les tâches diffèrent selon les joueurs mais la tâche commune est partagée', () => {
    const s = setup(10, 2);
    const lists = crew(s).map((p) => p.tasks.map((t) => t.taskId));
    expect(new Set(lists.map((l) => l.join())).size).toBeGreaterThan(1);
    const common = lists[0][0];
    for (const l of lists) expect(l[0]).toBe(common);
    for (const l of lists) expect(l).toHaveLength(4);
  });
});

describe('tâches', () => {
  it('valide une tâche attribuée, refuse une tâche déjà terminée ou non attribuée', () => {
    const s = setup(10, 2);
    const c = crew(s)[0];
    const short = c.tasks.find((t) => s.terrain.tasks.find((d) => d.id === t.taskId)!.type === 'short')!;
    const before = taskProgress(s).done;
    expect(doStep(s, c, short.taskId)).toEqual({ taskDone: true });
    expect(taskProgress(s).done).toBe(before + 1);
    const def = s.terrain.tasks.find((d) => d.id === short.taskId)!;
    const st = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    expect(err(() => act(s, c, { type: 'startTask', code: st.code, taskId: short.taskId }))).toBe('task_done');
    const notMine = s.terrain.tasks.find((d) => !c.tasks.some((t) => t.taskId === d.id))!;
    expect(err(() => act(s, c, { type: 'startTask', code: st.code, taskId: notMine.id }))).toBe('not_your_task');
  });

  it('refuse un mauvais poste, une réponse trop rapide et une mauvaise réponse', () => {
    const s = setup(10, 2);
    const c = crew(s)[0];
    const t = c.tasks[0];
    const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
    const wrong = s.terrain.stations.find((x) => x.kind === 'task' && x.id !== def.steps[0].stationId)!;
    expect(err(() => act(s, c, { type: 'startTask', code: wrong.code, taskId: t.taskId }))).toBe('wrong_station');
    const good = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    const ch = act(s, c, { type: 'startTask', code: good.code, taskId: t.taskId }) as { id: string };
    expect(err(() => act(s, c, { type: 'submit', challengeId: ch.id, answer: c.challenge!.answer }))).toBe('too_fast');
    advance(20_000);
    expect(err(() => act(s, c, { type: 'submit', challengeId: ch.id, answer: 'faux' }))).toBe('wrong');
    expect(t.done).toBe(false);
  });

  it('une même étape ne peut pas être validée deux fois (requêtes concurrentes)', () => {
    const s = setup(10, 2);
    const c = crew(s)[0];
    const t = c.tasks[0];
    const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
    const st = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    const ch = act(s, c, { type: 'startTask', code: st.code, taskId: t.taskId }) as { id: string };
    advance(20_000);
    const answer = c.challenge!.answer;
    act(s, c, { type: 'submit', challengeId: ch.id, answer });
    expect(err(() => act(s, c, { type: 'submit', challengeId: ch.id, answer }))).toBe('no_challenge');
    expect(taskProgress(s).done).toBe(1);
  });

  it('les tâches d’un imposteur sont simulées et ne font pas progresser la barre', () => {
    const s = setup(10, 2);
    const i = imps(s)[0];
    const r = doStep(s, i, i.tasks[0].taskId);
    expect(r).toEqual({ fake: true });
    expect(taskProgress(s).done).toBe(0);
  });

  it('les codes erronés répétés bloquent temporairement le joueur', () => {
    const s = setup(10, 2);
    const c = crew(s)[0];
    for (let k = 0; k < 6; k++) expect(err(() => act(s, c, { type: 'scan', code: 'ZZZZ' }))).toBe('bad_code');
    expect(err(() => act(s, c, { type: 'scan', code: stationOf(s, 'task').code }))).toBe('blocked');
  });

  it('les énigmes papier ont une réponse stable dérivée de la graine imprimée', () => {
    expect(countPuzzle(123).answer).toBe(countPuzzle(123).answer);
    expect(assemblePuzzle(9).word).toBe(assemblePuzzle(9).word);
    const p = countPuzzle(5);
    expect(p.grid.length).toBe(48);
  });
});

describe('éliminations', () => {
  it('respecte le délai initial puis le délai entre deux éliminations', () => {
    const s = setup(10, 2, { initialKillCooldownSec: 30, killCooldownSec: 60 });
    const i = imps(s)[0];
    expect(err(() => act(s, i, { type: 'arm' }))).toBe('cooldown');
    advance(30_000);
    const { code } = act(s, i, { type: 'arm' }) as { code: string };
    const v = crew(s)[0];
    act(s, v, { type: 'killed', code });
    expect(v.alive).toBe(false);
    expect(v.killedBy).toBe(i.id);
    expect(err(() => act(s, i, { type: 'arm' }))).toBe('cooldown');
    advance(59_000);
    expect(err(() => act(s, i, { type: 'arm' }))).toBe('cooldown');
    advance(1_000);
    expect(act(s, i, { type: 'arm' })).toHaveProperty('code');
  });

  it('un code ne sert qu’une fois et un mort ne peut pas être tué', () => {
    const s = setup(10, 2);
    const i = imps(s)[0];
    advance(60_000);
    const { code } = act(s, i, { type: 'arm' }) as { code: string };
    const [v1, v2] = crew(s);
    act(s, v1, { type: 'killed', code });
    expect(err(() => act(s, v2, { type: 'killed', code }))).toBe('bad_code');
    expect(err(() => act(s, v1, { type: 'killed', code }))).toBe('dead');
    expect(v2.alive).toBe(true);
  });

  it('le code d’élimination expire', () => {
    const s = setup(10, 2, { killCodeTtlSec: 30 });
    const i = imps(s)[0];
    advance(60_000);
    const { code } = act(s, i, { type: 'arm' }) as { code: string };
    advance(31_000);
    tick(s, clock);
    expect(err(() => act(s, crew(s)[0], { type: 'killed', code }))).toBe('bad_code');
  });

  it('un imposteur ne peut pas être éliminé et le message ne révèle rien', () => {
    const s = setup(10, 2);
    const [a, b] = imps(s);
    advance(60_000);
    const { code } = act(s, a, { type: 'arm' }) as { code: string };
    let msg = '';
    try {
      act(s, b, { type: 'killed', code });
    } catch (e) {
      msg = (e as Error).message;
    }
    let msg2 = '';
    try {
      act(s, crew(s)[0], { type: 'killed', code: '0000' === code ? '1111' : '0000' });
    } catch (e) {
      msg2 = (e as Error).message;
    }
    expect(msg).toBe(msg2);
    expect(b.alive).toBe(true);
  });

  it('un membre d’équipage ne peut ni armer ni saboter', () => {
    const s = setup(10, 2);
    advance(60_000);
    expect(err(() => act(s, crew(s)[0], { type: 'arm' }))).toBe('forbidden');
    expect(err(() => act(s, crew(s)[0], { type: 'sabotage', kind: 'lights' }))).toBe('forbidden');
  });
});

describe('corps et réunions', () => {
  it('signalement d’un corps : réunion, actions bloquées, morts révélés', () => {
    const s = setup(10, 2);
    const i = imps(s)[0];
    const [v, r, other] = crew(s);
    kill(s, i, v);
    // avant la réunion, les autres ignorent la mort
    expect(viewForPlayer(s, other.id, clock).players.find((p) => p.id === v.id)!.status).toBe('alive');
    expect(viewForPlayer(s, v.id, clock).me.body!.code).toHaveLength(4);
    act(s, r, { type: 'report', code: v.body!.code });
    expect(s.phase).toBe('meeting');
    expect(s.meeting!.bodyOf).toBe(v.id);
    expect(viewForPlayer(s, other.id, clock).players.find((p) => p.id === v.id)!.status).toBe('dead');
    // pendant la réunion : pas de tâche, pas d'élimination, pas de sabotage
    advance(120_000);
    expect(err(() => act(s, i, { type: 'arm' }))).toBe('meeting');
    expect(err(() => act(s, i, { type: 'sabotage', kind: 'lights' }))).toBe('meeting');
    expect(err(() => act(s, other, { type: 'scan', code: stationOf(s, 'task').code }))).toBe('meeting');
  });

  it('un fantôme ne peut ni signaler ni convoquer ni voter', () => {
    const s = setup(10, 2);
    const i = imps(s)[0];
    const [v, w] = crew(s);
    kill(s, i, v);
    advance(60_000);
    expect(err(() => act(s, v, { type: 'report', code: v.body!.code }))).toBe('dead');
    const r = act(s, v, { type: 'scan', code: stationOf(s, 'emergency').code }) as { block?: string };
    expect(r.block).toMatch(/fantômes/);
    act(s, w, { type: 'report', code: v.body!.code });
    runMeetingToVoting(s);
    expect(err(() => act(s, v, { type: 'vote', target: 'skip' }))).toBe('dead');
  });

  it('bouton d’urgence : délai, nombre limité, interdit pendant un sabotage', () => {
    const s = setup(10, 2, { emergencyCooldownSec: 20, emergencyMeetingsPerPlayer: 1 });
    const c = crew(s)[0];
    const em = stationOf(s, 'emergency').code;
    expect(err(() => act(s, c, { type: 'callEmergency', code: em }))).toBe('cannot_call');
    advance(20_000);
    const i = imps(s)[0];
    act(s, i, { type: 'sabotage', kind: 'lights' });
    expect(err(() => act(s, c, { type: 'callEmergency', code: em }))).toBe('cannot_call');
    gmAction(s, { type: 'fixSabotage' }, ctx());
    expect(err(() => act(s, c, { type: 'callEmergency', code: 'ABCD' }))).toBe('bad_code');
    act(s, c, { type: 'callEmergency', code: em });
    expect(s.phase).toBe('meeting');
    expect(c.emergencyLeft).toBe(0);
  });

  it('vote : double vote refusé, vote pour un mort refusé, éjection à la majorité relative', () => {
    const s = setup(10, 2, { confirmEjects: true });
    gmAction(s, { type: 'meeting' }, ctx());
    runMeetingToVoting(s);
    const target = crew(s)[0];
    const alive = [...s.players.filter((p) => p.alive && p.id !== target.id), target];
    act(s, alive[0], { type: 'vote', target: target.id });
    expect(err(() => act(s, alive[0], { type: 'vote', target: 'skip' }))).toBe('already_voted');
    // les votes individuels restent secrets pendant le vote
    const other = viewForPlayer(s, alive[1].id, clock);
    expect(other.meeting!.votedIds).toContain(alive[0].id);
    expect(JSON.stringify(other.meeting)).not.toContain(`"${alive[0].id}":"${target.id}"`);
    for (const p of alive.slice(1, 6)) act(s, p, { type: 'vote', target: target.id });
    for (const p of alive.slice(6, -1)) act(s, p, { type: 'vote', target: 'skip' });
    expect(s.meeting!.stage).toBe('voting'); // la cible n'a pas voté
    act(s, target, { type: 'vote', target: 'skip' });
    expect(s.meeting!.stage).toBe('result');
    expect(s.meeting!.result!.ejectedId).toBe(target.id);
    expect(s.meeting!.result!.wasImpostor).toBe(false);
    expect(target.alive).toBe(false);
  });

  it('égalité, passer majoritaire et abstention : personne n’est éjecté', () => {
    const s = setup(10, 2);
    gmAction(s, { type: 'meeting' }, ctx());
    runMeetingToVoting(s);
    const [a, b, c, d] = s.players;
    act(s, a, { type: 'vote', target: c.id });
    act(s, b, { type: 'vote', target: d.id });
    let res = tallyVotes(s, s.meeting!);
    expect(res.ejectedId).toBeUndefined();
    expect(res.tie).toBe(true);
    expect(res.abstentions).toBe(8);
    act(s, c, { type: 'vote', target: 'skip' });
    act(s, d, { type: 'vote', target: 'skip' });
    res = tallyVotes(s, s.meeting!);
    expect(res.ejectedId).toBeUndefined();
    expect(res.skips).toBe(2);
    // fin du temps de vote : les abstentionnistes ne comptent pas
    advance(10 * 60_000);
    tick(s, clock);
    expect(s.meeting?.stage ?? 'fini').not.toBe('voting');
    expect(s.players.every((p) => p.alive)).toBe(true);
  });

  it('égalité entre un joueur et « passer » : personne n’est éjecté', () => {
    const s = setup(10, 2);
    gmAction(s, { type: 'meeting' }, ctx());
    runMeetingToVoting(s);
    const [a, b, c] = s.players;
    act(s, a, { type: 'vote', target: c.id });
    act(s, b, { type: 'vote', target: 'skip' });
    const res = tallyVotes(s, s.meeting!);
    expect(res.ejectedId).toBeUndefined();
    expect(res.tie).toBe(true);
  });

  it('votes anonymes : les votes individuels ne sont jamais envoyés aux joueurs', () => {
    const s = setup(10, 2, { anonymousVotes: true });
    gmAction(s, { type: 'meeting' }, ctx());
    runMeetingToVoting(s);
    for (const p of s.players) act(s, p, { type: 'vote', target: s.players[0].id });
    const v = viewForPlayer(s, s.players[3].id, clock);
    expect(v.meeting!.result!.votes).toBeUndefined();
    expect(v.meeting!.result!.ejectedId).toBe(s.players[0].id);
  });

  it('après la réunion : délais réinitialisés et les corps non signalés disparaissent', () => {
    const s = setup(10, 2, { killCooldownSec: 45, emergencyCooldownSec: 15 });
    const [i1, i2] = imps(s);
    const [v1, v2, r] = crew(s);
    kill(s, i1, v1);
    kill(s, i2, v2);
    act(s, r, { type: 'report', code: v1.body!.code });
    expect(v2.body!.vanished).toBe(true);
    expect(s.meeting!.newlyDead.sort()).toEqual([v1.id, v2.id].sort());
    runMeetingToVoting(s);
    gmAction(s, { type: 'advance' }, ctx());
    gmAction(s, { type: 'advance' }, ctx());
    expect(s.phase).toBe('playing');
    expect(i1.killCooldownUntil).toBe(clock + 45_000);
    expect(s.emergencyCooldownUntil).toBe(clock + 15_000);
    expect(err(() => act(s, r, { type: 'report', code: v2.body!.code }))).toBe('bad_code');
  });

  it('un corps non découvert disparaît après le délai configuré', () => {
    const s = setup(10, 2, { bodyTimeoutSec: 60 });
    const v = crew(s)[0];
    kill(s, imps(s)[0], v);
    expect(nextWakeup(s, clock)).toBeLessThanOrEqual(clock + 60_000);
    advance(61_000);
    tick(s, clock);
    expect(v.body!.vanished).toBe(true);
    expect(err(() => act(s, crew(s)[1], { type: 'report', code: v.body!.code }))).toBe('bad_code');
  });
});

describe('fantômes', () => {
  it('un fantôme d’équipage termine ses tâches (comptées) mais pas tant que son corps attend', () => {
    const s = setup(10, 2);
    const v = crew(s)[0];
    kill(s, imps(s)[0], v);
    const t = v.tasks[0];
    const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
    const st = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    expect(err(() => act(s, v, { type: 'startTask', code: st.code, taskId: t.taskId }))).toBe('blocked_task');
    act(s, crew(s)[1], { type: 'report', code: v.body!.code });
    runMeetingToVoting(s);
    gmAction(s, { type: 'advance' }, ctx());
    gmAction(s, { type: 'advance' }, ctx());
    const before = taskProgress(s).done;
    doStep(s, v, t.taskId);
    expect(taskProgress(s).done).toBeGreaterThanOrEqual(before);
  });

  it('un fantôme imposteur peut saboter mais pas éliminer ; un fantôme ne répare pas', () => {
    const s = setup(10, 2);
    const [i1] = imps(s);
    gmAction(s, { type: 'kill', playerId: i1.id }, ctx());
    advance(60_000);
    expect(err(() => act(s, i1, { type: 'arm' }))).toBe('dead');
    act(s, i1, { type: 'sabotage', kind: 'lights' });
    expect(s.sabotage?.kind).toBe('lights');
    const ghost = crew(s)[0];
    gmAction(s, { type: 'kill', playerId: ghost.id }, ctx());
    expect(err(() => act(s, ghost, { type: 'fixStart', code: stationOf(s, 'lights').code }))).toBe('dead');
  });

  it('les fantômes voient toutes les morts, pas les rôles (option par défaut)', () => {
    const s = setup(10, 2);
    const [v1, v2] = crew(s);
    kill(s, imps(s)[0], v1);
    kill(s, imps(s)[1], v2);
    const view = viewForPlayer(s, v1.id, clock);
    expect(view.players.find((p) => p.id === v2.id)!.status).toBe('dead');
    expect(JSON.stringify(view)).not.toContain('"role":"impostor"');
  });
});

describe('sabotages', () => {
  it('refuse un sabotage pendant le délai initial, en double ou par l’équipage', () => {
    const s = setup(10, 2, { initialSabotageCooldownSec: 10, sabotageCooldownSec: 30 });
    const [i1, i2] = imps(s);
    expect(err(() => act(s, i1, { type: 'sabotage', kind: 'comms' }))).toBe('cooldown');
    advance(10_000);
    act(s, i1, { type: 'sabotage', kind: 'comms' });
    expect(err(() => act(s, i2, { type: 'sabotage', kind: 'lights' }))).toBe('busy');
    // communications : liste des tâches et barre masquées pour l'équipage vivant
    const c = crew(s)[0];
    const v = viewForPlayer(s, c.id, clock);
    expect(v.me.tasksHidden).toBe(true);
    expect(v.me.tasks).toBeUndefined();
    expect(v.taskBar).toBeUndefined();
    const ch = act(s, c, { type: 'fixStart', code: stationOf(s, 'comms').code }) as { id: string };
    advance(3_000);
    act(s, c, { type: 'submit', challengeId: ch.id, answer: c.challenge!.answer });
    expect(s.sabotage).toBeUndefined();
    expect(err(() => act(s, i2, { type: 'sabotage', kind: 'lights' }))).toBe('cooldown');
  });

  it('panne de courant : les postes de l’équipage sont hors service', () => {
    const s = setup(10, 2);
    advance(15_000);
    act(s, imps(s)[0], { type: 'sabotage', kind: 'lights' });
    const c = crew(s)[0];
    const t = c.tasks[0];
    const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
    const st = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    expect(err(() => act(s, c, { type: 'startTask', code: st.code, taskId: t.taskId }))).toBe('blocked_task');
  });

  it('un imposteur a le même écran qu\u2019un équipier pendant panne et communications (aucun indice visuel)', () => {
    const s = setup(10, 2);
    advance(15_000);
    const i = imps(s)[0];
    act(s, imps(s)[1], { type: 'sabotage', kind: 'lights' });
    const t = i.tasks[0];
    const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
    const st = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    expect(err(() => act(s, i, { type: 'startTask', code: st.code, taskId: t.taskId }))).toBe('blocked_task');
    gmAction(s, { type: 'fixSabotage' }, ctx());
    advance(31_000);
    act(s, imps(s)[1], { type: 'sabotage', kind: 'comms' });
    const vi = viewForPlayer(s, i.id, clock);
    expect(vi.me.tasksHidden).toBe(true);
    expect(vi.me.tasks).toBeUndefined();
  });

  it('réacteur : il faut deux joueurs vivants simultanément sur deux postes différents', () => {
    const s = setup(10, 2, { reactorSec: 60 });
    advance(15_000);
    act(s, imps(s)[0], { type: 'sabotage', kind: 'reactor' });
    const [a, b] = crew(s);
    const [ra, rb] = s.terrain.stations.filter((x) => x.kind === 'reactor');
    act(s, a, { type: 'hold', code: ra.code, on: true });
    advance(1_000);
    // le même joueur ne peut pas tenir les deux postes
    act(s, a, { type: 'hold', code: rb.code, on: true });
    advance(3_000);
    act(s, a, { type: 'hold', code: rb.code, on: true });
    expect(s.sabotage).toBeDefined();
    act(s, b, { type: 'hold', code: ra.code, on: true });
    advance(1_000);
    act(s, b, { type: 'hold', code: ra.code, on: true });
    expect(s.sabotage).toBeDefined();
    advance(1_600);
    act(s, a, { type: 'hold', code: rb.code, on: true });
    expect(s.sabotage).toBeUndefined();
    expect(s.sabotageHistory.at(-1)!.outcome).toBe('réparé');
  });

  it('réacteur non réparé à temps : victoire des imposteurs', () => {
    const s = setup(10, 2, { reactorSec: 45 });
    advance(15_000);
    act(s, imps(s)[0], { type: 'sabotage', kind: 'reactor' });
    advance(45_000);
    tick(s, clock);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('impostors');
  });

  it('oxygène : deux postes à réparer ; un signalement de corps interrompt le sabotage critique', () => {
    const s = setup(10, 2);
    advance(15_000);
    act(s, imps(s)[0], { type: 'sabotage', kind: 'oxygen' });
    const c = crew(s)[0];
    const [oa] = s.terrain.stations.filter((x) => x.kind === 'oxygen');
    const ch = act(s, c, { type: 'fixStart', code: oa.code }) as { id: string };
    advance(3_000);
    expect(act(s, c, { type: 'submit', challengeId: ch.id, answer: c.challenge!.answer })).toEqual({ fixed: false, partial: true });
    expect(err(() => act(s, c, { type: 'fixStart', code: oa.code }))).toBe('already');
    const v = crew(s)[1];
    advance(60_000);
    kill(s, imps(s)[1], v);
    act(s, c, { type: 'report', code: v.body!.code });
    expect(s.sabotage).toBeUndefined();
    expect(s.meeting!.endedSabotage).toBe('oxygen');
  });

  it('portes : la salle est condamnée puis se rouvre seule', () => {
    const s = setup(10, 2, { doorsSec: 20 });
    advance(15_000);
    const room = s.terrain.rooms.find((r) => !r.forbidden && !r.transit && r.id !== s.terrain.meetingRoomId)!;
    expect(err(() => act(s, imps(s)[0], { type: 'sabotage', kind: 'doors', roomId: s.terrain.meetingRoomId }))).toBe('bad_room');
    act(s, imps(s)[0], { type: 'sabotage', kind: 'doors', roomId: room.id });
    advance(20_000);
    tick(s, clock);
    expect(s.sabotage).toBeUndefined();
  });
});

describe('conditions de victoire', () => {
  it('équipage : toutes les tâches terminées (fantômes compris)', () => {
    const s = setup(6, 1);
    for (const p of crew(s)) finishAllTasks(s, p);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('crew');
  });

  it('équipage : tous les imposteurs éjectés', () => {
    const s = setup(6, 1);
    const i = imps(s)[0];
    gmAction(s, { type: 'meeting' }, ctx());
    runMeetingToVoting(s);
    for (const p of s.players) act(s, p, { type: 'vote', target: i.id });
    expect(s.meeting!.result!.ejectedId).toBe(i.id);
    expect(s.meeting!.result!.impostorsLeft).toBe(0);
    gmAction(s, { type: 'advance' }, ctx());
    expect(s.winner).toBe('crew');
  });

  it('imposteurs : parité atteinte par élimination', () => {
    const s = setup(6, 1);
    const i = imps(s)[0];
    const cs = crew(s);
    kill(s, i, cs[0]);
    kill(s, i, cs[1]);
    kill(s, i, cs[2]);
    expect(s.phase).toBe('playing');
    kill(s, i, cs[3]);
    expect(s.winner).toBe('impostors');
  });

  it('imposteurs : parité atteinte par une éjection erronée', () => {
    const s = setup(4, 1);
    const i = imps(s)[0];
    const cs = crew(s);
    kill(s, i, cs[0]);
    gmAction(s, { type: 'meeting' }, ctx());
    runMeetingToVoting(s);
    for (const p of s.players.filter((x) => x.alive)) act(s, p, { type: 'vote', target: cs[1].id });
    gmAction(s, { type: 'advance' }, ctx());
    expect(s.winner).toBe('impostors');
  });

  it('un départ de joueur retire ses tâches du total et peut déclencher une victoire', () => {
    const s = setup(6, 1);
    const cs = crew(s);
    for (const p of cs.slice(0, 4)) finishAllTasks(s, p);
    expect(s.phase).toBe('playing');
    act(s, cs[4], { type: 'leave' });
    expect(s.winner).toBe('crew');
  });
});

describe('maître du jeu', () => {
  it('pause : actions refusées et minuteurs gelés puis décalés à la reprise', () => {
    const s = setup(10, 2);
    gmAction(s, { type: 'meeting' }, ctx());
    const end = s.meeting!.stageEndsAt;
    gmAction(s, { type: 'pause' }, ctx());
    advance(500_000);
    expect(tick(s, clock)).toBe(false);
    expect(s.meeting!.stage).toBe('gather');
    gmAction(s, { type: 'resume' }, ctx());
    expect(s.meeting!.stageEndsAt).toBe(end + 500_000);
  });

  it('arrêt d’urgence : tout est bloqué', () => {
    const s = setup(10, 2);
    gmAction(s, { type: 'stop' }, ctx());
    advance(60_000);
    expect(err(() => act(s, imps(s)[0], { type: 'arm' }))).toBe('paused');
    expect(s.emergencyStop).toBe(true);
  });

  it('corrections : annuler une élimination injustifiée, valider une tâche', () => {
    const s = setup(10, 2);
    const v = crew(s)[0];
    kill(s, imps(s)[0], v);
    gmAction(s, { type: 'revive', playerId: v.id }, ctx());
    expect(v.alive).toBe(true);
    expect(v.body).toBeUndefined();
    gmAction(s, { type: 'taskDone', playerId: v.id, taskId: v.tasks[0].taskId, done: true }, ctx());
    expect(v.tasks[0].done).toBe(true);
  });

  it('la vue MJ contient rôles et journal, nouvelle partie remet tout à zéro', () => {
    const s = setup(10, 2);
    const g = viewForGm(s, clock, new Set());
    expect(g.players.filter((p) => p.role === 'impostor')).toHaveLength(2);
    expect(g.log.some((l) => l.secret)).toBe(true);
    gmAction(s, { type: 'end', winner: 'none' }, ctx());
    expect(s.phase).toBe('ended');
    const pv = viewForPlayer(s, crew(s)[0].id, clock);
    expect(pv.end!.players.filter((p) => p.role === 'impostor')).toHaveLength(2); // rôles révélés en fin de partie
    gmAction(s, { type: 'newGame' }, ctx());
    expect(s.phase).toBe('lobby');
    expect(s.players).toHaveLength(10);
    expect(s.players.every((p) => !p.role && p.alive && p.tasks.length === 0)).toBe(true);
    gmAction(s, { type: 'start' }, ctx());
    expect(s.phase).toBe('playing');
  });

  it('exclusion d’un joueur en cours de partie', () => {
    const s = setup(10, 2);
    const c = crew(s)[0];
    gmAction(s, { type: 'kick', playerId: c.id }, ctx());
    expect(c.kicked && c.left).toBe(true);
    expect(err(() => act(s, c, { type: 'scan', code: 'AAAA' }))).toBe('no_player');
  });

  it('terrain : validation des données envoyées par le navigateur', () => {
    const t = exampleTerrain(seededRng(1));
    const bad = { ...t, stations: [...t.stations, { id: 'sx', name: 'X', roomId: 'inexistant', kind: 'task', code: 'AAAA' }] };
    expect(() => sanitizeTerrain(bad)).toThrow();
    const ok = sanitizeTerrain(JSON.parse(JSON.stringify(t)));
    expect(ok.stations.map((x) => x.code)).toEqual(t.stations.map((x) => x.code));
  });
});

describe('capacité', () => {
  it('partie complète à 40 joueurs', () => {
    const s = setup(40, 6);
    expect(s.players).toHaveLength(40);
    expect(imps(s)).toHaveLength(6);
    for (const p of s.players) {
      const v = viewForPlayer(s, p.id, clock);
      expect(JSON.stringify(v).length).toBeLessThan(40_000);
    }
    gmAction(s, { type: 'meeting' }, ctx());
    runMeetingToVoting(s);
    for (const p of s.players) act(s, p, { type: 'vote', target: 'skip' });
    expect(s.meeting!.stage).toBe('result');
  });
});
