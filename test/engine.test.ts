import { describe, expect, it } from 'vitest';
import {
  addPlayer, createGame, GameError, gmAction, nextWakeup, personalOrder, playerAction, tallyVotes, taskProgress, tick, type PlayerAction,
} from '../src/shared/engine';
import { assemblePuzzle, countPuzzle } from '../src/shared/puzzles';
import { seededRng } from '../src/shared/rng';
import { sanitizeTerrain } from '../src/shared/terrain';
import { exampleTerrain } from './fixtures';
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
  return act(s, imp, { type: 'kill', target: victim.id });
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

  it('un imposteur voit ses alliés et leurs délais restent secrets pour l’équipage', () => {
    const s = setup(10, 2);
    const [a, b] = imps(s);
    const vb = viewForPlayer(s, b.id, clock);
    expect(vb.allies!.map((x) => x.id)).toEqual([a.id]);
    expect(vb.terrain.passages).toBeDefined();
    expect(vb.me.killCooldownUntil).toBe(b.killCooldownUntil);
    const vc = viewForPlayer(s, crew(s)[0].id, clock);
    expect(vc.me.killCooldownUntil).toBeUndefined();
    expect(vc.sabotageCooldownUntil).toBeUndefined();
    expect(vc.sabotageOptions).toBeUndefined();
  });

  it('les tâches diffèrent selon les joueurs ; la tâche commune est partagée mais jamais en premier', () => {
    const s = setup(10, 2);
    const lists = crew(s).map((p) => p.tasks.map((t) => t.taskId));
    expect(new Set(lists.map((l) => l.join())).size).toBeGreaterThan(1);
    const common = s.terrain.tasks.filter((t) => t.type === 'common').map((t) => t.id);
    const shared = lists[0].find((id) => common.includes(id))!;
    for (const l of lists) {
      expect(l).toHaveLength(4);
      expect(l).toContain(shared);
      expect(common).not.toContain(l[0]); // personne n'est envoyé d'abord au poste de la tâche commune
    }
  });

  it('ordre personnel : sur 40 joueurs, les premières étapes sont réparties sur plusieurs postes', () => {
    const s = setup(40, 6);
    const firstStations = s.players.map((p) => {
      const v = viewForPlayer(s, p.id, clock);
      const t = v.me.tasks!.find((x) => x.taskId === v.me.nextTaskId)!;
      return t.next!.stationName;
    });
    const counts = new Map<string, number>();
    for (const st of firstStations) counts.set(st, (counts.get(st) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...counts.values())).toBeLessThan(20); // avant : les 40 au même poste
    for (const p of s.players) expect(s.terrain.tasks.find((t) => t.id === p.tasks[0].taskId)!.type).not.toBe('common');
  });

  it('personalOrder : la tâche commune n’est jamais en tête, même tirée en premier', () => {
    for (let k = 0; k < 300; k++) {
      const r = seededRng(k);
      const out = personalOrder([{ type: 'common', id: 'c' }, { type: 'short', id: 'a' }, { type: 'long', id: 'b' }], r);
      expect(out[0].type).not.toBe('common');
      expect(out.map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
    }
    // seulement des tâches communes : rien à échanger
    expect(personalOrder([{ type: 'common' }], seededRng(1))[0].type).toBe('common');
  });

  it('prochaine étape conseillée : même pièce, puis même étage que la dernière tâche faite', () => {
    const s = setup(10, 2, { commonTasks: 0, longTasks: 0, shortTasks: 4 });
    const c = crew(s)[0];
    const v0 = viewForPlayer(s, c.id, clock);
    expect(v0.me.nextTaskId).toBe(c.tasks[0].taskId); // au départ : l'ordre personnel
    expect(v0.me.tasks!.every((t) => t.near === undefined)).toBe(true);
    doStep(s, c, c.tasks[0].taskId);
    const v = viewForPlayer(s, c.id, clock);
    const lastSt = s.terrain.stations.find((x) => x.id === c.lastStationId)!;
    const lastRoom = s.terrain.rooms.find((r) => r.id === lastSt.roomId)!;
    const todo = v.me.tasks!.filter((t) => !t.done);
    for (const t of todo) {
      const st = s.terrain.stations.find((x) => x.name === t.next!.stationName)!;
      const room = s.terrain.rooms.find((r) => r.id === st.roomId)!;
      expect(t.near).toBe(room.id === lastRoom.id ? 0 : room.floor === lastRoom.floor ? 1 : 2);
    }
    const best = Math.min(...todo.map((t) => t.near!));
    const next = todo.find((t) => t.taskId === v.me.nextTaskId)!;
    expect(next.near).toBe(best);
    // à égalité, l'ordre personnel départage
    expect(todo.filter((t) => t.near === best)[0].taskId).toBe(next.taskId);
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
    // une tâche à une seule étape : la valider la termine (la progression compte les tâches terminées)
    const t = c.tasks.find((x) => s.terrain.tasks.find((d) => d.id === x.taskId)!.steps.length === 1)!;
    const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
    const st = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    const ch = act(s, c, { type: 'startTask', code: st.code, taskId: t.taskId }) as { id: string };
    advance(20_000);
    const answer = c.challenge!.answer;
    act(s, c, { type: 'submit', challengeId: ch.id, answer });
    expect(err(() => act(s, c, { type: 'submit', challengeId: ch.id, answer }))).toBe('no_challenge');
    expect(t.step).toBe(1);
    expect(taskProgress(s).done).toBe(1);
  });

  it('tâches simulées : même progression et même réponse qu’un équipier, sans faire avancer la barre', () => {
    const s = setup(10, 2, { commonTasks: 1, longTasks: 1, shortTasks: 2 });
    const i = imps(s)[0];
    const c = crew(s)[0];
    const long = (p: PlayerState) => p.tasks.find((t) => s.terrain.tasks.find((d) => d.id === t.taskId)!.type === 'long')!;
    // étape 1 d'une tâche longue : réponses identiques
    expect(doStep(s, i, long(i).taskId)).toEqual(doStep(s, c, long(c).taskId));
    expect(doStep(s, i, long(i).taskId)).toEqual({ taskDone: true });
    expect(doStep(s, c, long(c).taskId)).toEqual({ taskDone: true });
    expect(taskProgress(s).done).toBe(1); // seule la tâche de l'équipier compte
    expect(long(i).done).toBe(true);
    // la liste de l'imposteur avance comme celle d'un équipier (compteur, prochaine étape)
    const vi = viewForPlayer(s, i.id, clock);
    const vc = viewForPlayer(s, c.id, clock);
    expect(vi.me.tasks!.filter((t) => t.done)).toHaveLength(1);
    expect(vc.me.tasks!.filter((t) => t.done)).toHaveLength(1);
    expect(vi.me.nextTaskId).not.toBe(long(i).taskId);
    // un imposteur qui « termine » tout ne fait jamais gagner l'équipage
    finishAllTasks(s, i);
    expect(s.phase).toBe('playing');
    expect(i.tasks.every((t) => t.done)).toBe(true);
    expect(s.log.some((l) => l.secret && /a simulé/.test(l.msg))).toBe(true);
  });

  it('les codes erronés répétés bloquent temporairement le joueur', () => {
    const s = setup(10, 2);
    const c = crew(s)[0];
    for (let k = 0; k < 6; k++) expect(err(() => act(s, c, { type: 'scan', code: 'ZZZZ' }))).toBe('bad_code');
    expect(err(() => act(s, c, { type: 'scan', code: stationOf(s, 'task').code }))).toBe('blocked');
  });

  it('les énigmes papier sont stables (même fiche imprimée) mais la question change d’une fois sur l’autre', () => {
    expect(countPuzzle(123).grid).toEqual(countPuzzle(123).grid);
    expect(assemblePuzzle(9)).toEqual(assemblePuzzle(9));
    expect(countPuzzle(5).grid.length).toBe(48);
    const s = setup(10, 2);
    const t = s.terrain.tasks.find((x) => x.steps.some((st) => st.game === 'count'))!;
    const st = s.terrain.stations.find((x) => x.id === t.steps.find((y) => y.game === 'count')!.stationId)!;
    const questions = new Set<string>();
    for (let k = 0; k < 40; k++) {
      gmAction(s, { type: 'testTask', taskId: t.id, stepIndex: t.steps.findIndex((y) => y.game === 'count') }, ctx());
      questions.add(String(s.gmChallenge!.params.question));
      expect(s.gmChallenge!.stationId).toBe(st.id);
    }
    expect(questions.size).toBeGreaterThan(8);
  });
});

describe('éliminations', () => {
  it('l’imposteur choisit sa victime : délai initial puis délai entre deux éliminations', () => {
    const s = setup(10, 2, { initialKillCooldownSec: 30, killCooldownSec: 60 });
    const i = imps(s)[0];
    const [v, w, x] = crew(s);
    expect(err(() => act(s, i, { type: 'kill', target: v.id }))).toBe('cooldown');
    advance(30_000);
    expect(act(s, i, { type: 'kill', target: v.id })).toEqual({ ok: true, name: v.name });
    expect(v.alive).toBe(false);
    expect(v.killedBy).toBe(i.id);
    expect(v.body!.code).toMatch(/^\d{4}$/);
    expect(i.kills).toBe(1);
    expect(err(() => act(s, i, { type: 'kill', target: w.id }))).toBe('cooldown');
    advance(59_000);
    expect(err(() => act(s, i, { type: 'kill', target: w.id }))).toBe('cooldown');
    advance(1_000);
    act(s, i, { type: 'kill', target: w.id });
    expect(w.alive).toBe(false);
    expect(x.alive).toBe(true);
  });

  it('cible invalide : un allié, soi-même, un mort, un inconnu, un joueur parti', () => {
    const s = setup(10, 2);
    const [a, b] = imps(s);
    const [v, w] = crew(s);
    advance(60_000);
    expect(err(() => act(s, a, { type: 'kill', target: b.id }))).toBe('ally');
    expect(err(() => act(s, a, { type: 'kill', target: a.id }))).toBe('bad_target');
    expect(err(() => act(s, a, { type: 'kill', target: 'inconnu' }))).toBe('bad_target');
    expect(err(() => act(s, a, { type: 'kill', target: undefined as never }))).toBe('bad_target');
    kill(s, b, v);
    expect(err(() => act(s, a, { type: 'kill', target: v.id }))).toBe('bad_target');
    act(s, w, { type: 'leave' });
    expect(err(() => act(s, a, { type: 'kill', target: w.id }))).toBe('bad_target');
    // aucun refus ne consomme le délai
    expect(a.killCooldownUntil).toBeLessThanOrEqual(clock);
    expect(b.alive && a.alive).toBe(true);
  });

  it('un membre d’équipage ne peut ni éliminer ni saboter ; un imposteur fantôme ne peut plus éliminer', () => {
    const s = setup(10, 2);
    advance(60_000);
    expect(err(() => act(s, crew(s)[0], { type: 'kill', target: crew(s)[1].id }))).toBe('forbidden');
    expect(err(() => act(s, crew(s)[0], { type: 'sabotage', kind: 'lights' }))).toBe('forbidden');
    const i = imps(s)[0];
    gmAction(s, { type: 'kill', playerId: i.id }, ctx());
    expect(err(() => act(s, i, { type: 'kill', target: crew(s)[1].id }))).toBe('dead');
  });

  it('la victime n’a rien à saisir ; son écran devient un corps, les autres ne savent rien', () => {
    const s = setup(10, 2);
    const i = imps(s)[0];
    const [v, other] = crew(s);
    v.challenge = undefined;
    kill(s, i, v);
    const vv = viewForPlayer(s, v.id, clock);
    expect(vv.me.bodyPending).toBe(true);
    expect(vv.me.deathRevealed).toBe(false);
    expect(vv.me.body!.code).toBe(v.body!.code);
    const vo = viewForPlayer(s, other.id, clock);
    expect(vo.players.find((p) => p.id === v.id)!.status).toBe('alive');
    // le tueur, lui, sait que sa victime est morte ; son allié non (jusqu'à la réunion)
    expect(viewForPlayer(s, i.id, clock).players.find((p) => p.id === v.id)!.status).toBe('dead');
    expect(viewForPlayer(s, imps(s)[1].id, clock).players.find((p) => p.id === v.id)!.status).toBe('alive');
    expect(JSON.stringify(vo)).not.toContain(v.body!.code);
  });

  it('élimination d’un joueur en plein mini-jeu ou qui tient le réacteur : tout est annulé proprement', () => {
    const s = setup(10, 2, { reactorSec: 60 });
    const [i, j] = imps(s);
    const [v, w] = crew(s);
    advance(60_000);
    const t = v.tasks[0];
    const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
    act(s, v, { type: 'startTask', code: s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!.code, taskId: t.taskId });
    expect(v.challenge).toBeDefined();
    act(s, j, { type: 'sabotage', kind: 'reactor' });
    const [ra] = s.terrain.stations.filter((x) => x.kind === 'reactor');
    act(s, w, { type: 'hold', code: ra.code, on: true });
    kill(s, i, v);
    kill(s, j, w);
    expect(v.challenge).toBeUndefined();
    expect(s.sabotage!.holds).toHaveLength(0);
  });

  it('contestation : une seule par mort, seulement pour une élimination, le MJ reçoit le nom du tueur', () => {
    const s = setup(10, 2);
    const i = imps(s)[0];
    const [v, w] = crew(s);
    expect(err(() => act(s, v, { type: 'dispute' }))).toBe('not_killed');
    kill(s, i, v);
    expect(act(s, v, { type: 'dispute' })).toEqual({ ok: true });
    expect(err(() => act(s, v, { type: 'dispute' }))).toBe('already');
    const al = s.alerts.at(-1)!;
    expect(al.kind).toBe('dispute');
    expect(al.playerId).toBe(v.id);
    expect(al.message).toContain(i.name);
    // les joueurs ne reçoivent jamais les alertes (le nom du tueur reste secret)
    expect(JSON.stringify(viewForPlayer(s, w.id, clock))).not.toContain(al.message);
    expect(viewForGm(s, clock, new Set()).alerts.at(-1)!.kind).toBe('dispute');
    expect(viewForPlayer(s, v.id, clock).me.disputed).toBe(true);
    gmAction(s, { type: 'kill', playerId: w.id }, ctx());
    expect(err(() => act(s, w, { type: 'dispute' }))).toBe('not_killed'); // mort déclarée par le MJ
    // le MJ annule l'élimination : la contestation est remise à zéro
    gmAction(s, { type: 'revive', playerId: v.id }, ctx());
    expect(v.alive).toBe(true);
    expect(v.disputed).toBeUndefined();
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
    expect(err(() => act(s, i, { type: 'kill', target: other.id }))).toBe('meeting');
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

  it('rassemblement : dès que la majorité est arrivée, il ne reste que 15 s aux retardataires', () => {
    const s = setup(10, 2, { gatherSec: 90, discussionSec: 60 });
    gmAction(s, { type: 'meeting' }, ctx());
    const m = s.meeting!;
    const end0 = m.stageEndsAt;
    expect(end0).toBe(clock + 90_000);
    const alive = s.players.filter((p) => p.alive);
    for (const p of alive.slice(0, 5)) act(s, p, { type: 'checkIn' }); // 5/10 : pas encore la majorité
    expect(m.stageEndsAt).toBe(end0);
    advance(10_000);
    act(s, alive[5], { type: 'checkIn' }); // 6/10 : majorité
    expect(m.stageEndsAt).toBe(clock + 15_000);
    advance(5_000);
    act(s, alive[6], { type: 'checkIn' }); // on ne rallonge jamais
    expect(m.stageEndsAt).toBe(clock + 10_000);
    advance(10_000);
    tick(s, clock);
    expect(s.meeting!.stage).toBe('discussion');
  });

  it('rassemblement : une prolongation du MJ après la majorité n’est pas annulée par les arrivées suivantes', () => {
    const s = setup(10, 2, { gatherSec: 90 });
    gmAction(s, { type: 'meeting' }, ctx());
    const alive = s.players.filter((p) => p.alive);
    for (const p of alive.slice(0, 6)) act(s, p, { type: 'checkIn' });
    expect(s.meeting!.stageEndsAt).toBe(clock + 15_000);
    gmAction(s, { type: 'extend', seconds: 30 }, ctx());
    expect(s.meeting!.stageEndsAt).toBe(clock + 45_000);
    advance(5_000);
    act(s, alive[6], { type: 'checkIn' });
    expect(s.meeting!.stageEndsAt).toBe(clock + 40_000);
  });

  it('rassemblement : la règle des 15 s ne rallonge jamais un minuteur plus court', () => {
    const s = setup(10, 2, { gatherSec: 15 });
    gmAction(s, { type: 'meeting' }, ctx());
    const end0 = s.meeting!.stageEndsAt;
    advance(8_000);
    for (const p of s.players.slice(0, 6)) act(s, p, { type: 'checkIn' });
    expect(s.meeting!.stageEndsAt).toBe(end0);
  });

  it('discussion : le vote s’ouvre dès que la majorité des vivants est « prête à voter »', () => {
    const s = setup(10, 2, { discussionSec: 120 });
    const [v] = crew(s);
    kill(s, imps(s)[0], v);
    gmAction(s, { type: 'meeting' }, ctx());
    for (const p of s.players.filter((x) => x.alive)) act(s, p, { type: 'checkIn' });
    expect(s.meeting!.stage).toBe('discussion');
    const alive = s.players.filter((p) => p.alive); // 9 vivants : il faut 5 prêts
    expect(err(() => act(s, v, { type: 'readyVote' }))).toBe('dead');
    for (const p of alive.slice(0, 4)) act(s, p, { type: 'readyVote' });
    act(s, alive[0], { type: 'readyVote' }); // deux fois : compté une fois
    expect(s.meeting!.stage).toBe('discussion');
    const view = viewForPlayer(s, alive[0].id, clock).meeting!;
    expect(view.readyCount).toBe(4);
    expect(view.myReady).toBe(true);
    expect(viewForPlayer(s, alive[8].id, clock).meeting!.myReady).toBe(false);
    act(s, alive[4], { type: 'readyVote' });
    expect(s.meeting!.stage).toBe('voting');
    expect(err(() => act(s, alive[5], { type: 'readyVote' }))).toBe('not_now');
  });

  it('discussion : un départ ou une mort peut suffire à atteindre la majorité', () => {
    const s = setup(10, 2, { discussionSec: 120 });
    gmAction(s, { type: 'meeting' }, ctx());
    for (const p of s.players) act(s, p, { type: 'checkIn' });
    const alive = s.players.filter((p) => p.alive);
    for (const p of alive.slice(0, 5)) act(s, p, { type: 'readyVote' }); // 5/10 : pas la majorité
    expect(s.meeting!.stage).toBe('discussion');
    act(s, alive[9], { type: 'leave' }); // 5/9 : majorité
    expect(s.meeting!.stage).toBe('voting');
  });

  it('discussion : les « prêts » morts ou partis ne comptent plus', () => {
    const s = setup(10, 2, { discussionSec: 120 });
    gmAction(s, { type: 'meeting' }, ctx());
    for (const p of s.players) act(s, p, { type: 'checkIn' });
    const alive = s.players.filter((p) => p.alive);
    for (const p of alive.slice(0, 4)) act(s, p, { type: 'readyVote' });
    gmAction(s, { type: 'kill', playerId: alive[0].id }, ctx()); // 3 prêts sur 9
    expect(s.meeting!.stage).toBe('discussion');
    expect(viewForPlayer(s, alive[1].id, clock).meeting!.readyCount).toBe(3);
    act(s, alive[5], { type: 'readyVote' }); // 4/9 : pas encore
    expect(s.meeting!.stage).toBe('discussion');
    act(s, alive[6], { type: 'readyVote' }); // 5/9
    expect(s.meeting!.stage).toBe('voting');
  });

  it('badge fantôme : la mort n’est « annoncée » qu’à la réunion suivante (corps disparu compris)', () => {
    const s = setup(10, 2, { bodyTimeoutSec: 60 });
    const v = crew(s)[0];
    kill(s, imps(s)[0], v);
    advance(61_000);
    tick(s, clock);
    expect(v.body!.vanished).toBe(true);
    const before = viewForPlayer(s, v.id, clock);
    expect(before.me.bodyPending).toBe(false);
    expect(before.me.deathRevealed).toBe(false); // fantôme libre, mais sans badge
    gmAction(s, { type: 'meeting' }, ctx());
    expect(viewForPlayer(s, v.id, clock).me.deathRevealed).toBe(true);
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
    expect(err(() => act(s, i1, { type: 'kill', target: crew(s)[0].id }))).toBe('dead');
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

  it('panne de courant : dans le noir, aucun signalement de corps ; les tâches, même en cours, continuent', () => {
    const s = setup(10, 2, { emergencyCooldownSec: 0 });
    advance(60_000);
    const [i, j] = imps(s);
    const [v, c, d] = crew(s);
    // une tâche commencée avant la panne
    const t = c.tasks[0];
    const def = s.terrain.tasks.find((x) => x.id === t.taskId)!;
    const st = s.terrain.stations.find((x) => x.id === def.steps[0].stationId)!;
    const ch = act(s, c, { type: 'startTask', code: st.code, taskId: t.taskId }) as { id: string };
    kill(s, i, v);
    act(s, j, { type: 'sabotage', kind: 'lights' });
    expect(c.challenge?.id).toBe(ch.id); // conservée
    advance(15_000);
    expect(act(s, c, { type: 'submit', challengeId: ch.id, answer: c.challenge!.answer })).toMatchObject({ taskDone: expect.any(Boolean) });
    // nouvelle tâche pendant la panne : possible
    const t2 = d.tasks[0];
    const def2 = s.terrain.tasks.find((x) => x.id === t2.taskId)!;
    const st2 = s.terrain.stations.find((x) => x.id === def2.steps[0].stationId)!;
    expect(act(s, d, { type: 'startTask', code: st2.code, taskId: t2.taskId })).toHaveProperty('id');
    // signalement impossible, sans compter comme code erroné ni consommer le corps
    for (let k = 0; k < 8; k++) expect(err(() => act(s, d, { type: 'report', code: v.body!.code }))).toBe('dark');
    expect(d.blockedUntil).toBe(0);
    expect(s.phase).toBe('playing');
    // bouton d'urgence bloqué aussi
    expect(err(() => act(s, d, { type: 'callEmergency', code: stationOf(s, 'emergency').code }))).toBe('cannot_call');
    // après réparation, le corps peut être signalé
    const fix = act(s, c, { type: 'fixStart', code: stationOf(s, 'lights').code }) as { id: string };
    advance(3_000);
    expect(act(s, c, { type: 'submit', challengeId: fix.id, answer: 'done' })).toEqual({ fixed: true });
    act(s, d, { type: 'report', code: v.body!.code });
    expect(s.phase).toBe('meeting');
  });

  it('un imposteur a le même écran qu\u2019un équipier pendant panne et communications (aucun indice visuel)', () => {
    const s = setup(10, 2);
    advance(15_000);
    const i = imps(s)[0];
    const c = crew(s)[0];
    act(s, imps(s)[1], { type: 'sabotage', kind: 'lights' });
    const strip = (x: ReturnType<typeof viewForPlayer>) => ({ tasksHidden: x.me.tasksHidden, sabotage: x.sabotage, taskBar: x.taskBar });
    expect(strip(viewForPlayer(s, i.id, clock))).toEqual(strip(viewForPlayer(s, c.id, clock)));
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

  it('le sabotage « salle condamnée » n\u2019existe plus (irréalisable dans une vraie maison)', () => {
    const s = setup(10, 2);
    advance(15_000);
    expect(err(() => act(s, imps(s)[0], { type: 'sabotage', kind: 'doors' as never }))).toBe('unavailable');
    expect(viewForPlayer(s, imps(s)[0].id, clock).sabotageOptions).toEqual(['reactor', 'oxygen', 'lights', 'comms']);
  });

  it('bouton d\u2019urgence bloqué pendant tout sabotage', () => {
    const s = setup(10, 2, { emergencyCooldownSec: 0 });
    advance(15_000);
    act(s, imps(s)[0], { type: 'sabotage', kind: 'comms' });
    expect(err(() => act(s, crew(s)[0], { type: 'callEmergency', code: stationOf(s, 'emergency').code }))).toBe('cannot_call');
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
    expect(err(() => act(s, imps(s)[0], { type: 'kill', target: crew(s)[0].id }))).toBe('paused');
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
    const bad = { ...t, stations: [...t.stations, { id: 'k30', name: 'X', roomId: 'inexistant', kind: 'task', code: 'AAAA' }] };
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
