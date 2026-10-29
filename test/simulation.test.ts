// Simulation aléatoire (« fuzzing ») du moteur : des parties complètes jouées par des agents
// qui mélangent actions sensées, erreurs et tentatives de triche. Après chaque action, on vérifie
// les invariants du jeu. But : qu'aucune séquence d'événements ne plante ou ne corrompe une partie.
import { describe, expect, it } from 'vitest';
import {
  addPlayer, aliveCrew, aliveImpostors, createGame, GameError, gmAction, nextWakeup, playerAction, readyCount, taskProgress, tick, type GmAction, type PlayerAction,
} from '../src/shared/engine';
import { seededRng, type Rng } from '../src/shared/rng';
import { KIT_SHEETS, pairSheet } from '../src/shared/kit';
import { exampleTerrain, kitTerrain } from '../src/shared/terrain';
import type { GameState, SabotageKind, Terrain } from '../src/shared/types';
import { viewForGm, viewForPlayer } from '../src/shared/view';

const SAB: SabotageKind[] = ['reactor', 'oxygen', 'lights', 'comms'];

function invariants(s: GameState, now: number) {
  expect(['lobby', 'playing', 'meeting', 'ended']).toContain(s.phase);
  expect(!!s.meeting).toBe(s.phase === 'meeting');
  if (s.phase === 'playing' && !s.paused) {
    const imp = aliveImpostors(s).length;
    const crew = aliveCrew(s).length;
    expect(imp).toBeGreaterThan(0);
    expect(imp).toBeLessThan(crew);
    const { done, total } = taskProgress(s);
    if (total > 0) expect(done).toBeLessThan(total);
    if (s.sabotage?.deadline) expect(s.sabotage.deadline).toBeGreaterThan(now);
  }
  if (s.phase === 'meeting' && !s.paused) {
    expect(nextWakeup(s, now)).toBeDefined();
    const m = s.meeting!;
    const alive = s.players.filter((p) => !p.left && !p.kicked && p.role && p.alive);
    // une majorité « prête à voter » ouvre le vote aussitôt ; tous arrivés : la discussion commence aussitôt
    if (m.stage === 'discussion') expect(2 * readyCount(s, m)).toBeLessThanOrEqual(alive.length);
    if (m.stage === 'gather' && alive.length > 0) expect(alive.every((p) => p.checkedIn)).toBe(false);
  }
  for (const p of s.players) {
    for (const t of p.tasks) {
      const def = s.terrain.tasks.find((d) => d.id === t.taskId)!;
      expect(t.step).toBeLessThanOrEqual(def.steps.length);
      if (t.done) expect(t.step).toBe(def.steps.length);
    }
    if (!p.alive) {
      // un fantôme d'équipage peut faire une tâche, mais jamais réparer, ni agir tant que son corps attend
      expect(p.challenge?.purpose).not.toBe('fix');
      if (p.body && !p.body.reported && !p.body.vanished) expect(p.challenge).toBeUndefined();
    }
    if (p.disputed) expect(p.deathCause === 'killed' || p.alive === false).toBe(true);
    if (p.lastStationId) expect(s.terrain.stations.some((x) => x.id === p.lastStationId)).toBe(true);
  }
  if (s.sabotage) for (const h of s.sabotage.holds) expect(s.players.find((p) => p.id === h.playerId)?.alive).toBe(true);
  const codes = s.players.flatMap((p) => [p.body && !p.body.reported && !p.body.vanished ? p.body.code : undefined]).filter(Boolean);
  expect(new Set(codes).size).toBe(codes.length);
}

function viewsAreSafe(s: GameState, now: number) {
  const stationCodes = s.terrain.stations.map((x) => `"${x.code}"`);
  for (const p of s.players.filter((x) => !x.kicked)) {
    const v = viewForPlayer(s, p.id, now);
    const json = JSON.stringify(v);
    expect(json).not.toContain('tokenHash');
    expect(json).not.toContain('privateJwk');
    for (const c of stationCodes) expect(json).not.toContain(c);
    const ghostSees = !p.alive && s.settings.ghostsSeeRoles;
    if (s.phase !== 'ended' && !ghostSees) {
      for (const o of v.players) {
        if (o.id === p.id || !o.role) continue;
        // seuls les imposteurs voient des rôles d'autrui : ceux de leurs alliés
        expect(p.role).toBe('impostor');
        expect(o.role).toBe('impostor');
      }
    }
  }
  const g = JSON.stringify(viewForGm(s, now, new Set()));
  expect(g.length).toBeLessThan(1_500_000);
  expect(JSON.stringify(s).length).toBeLessThan(1_900_000);
}

function pick<T>(r: Rng, a: readonly T[]): T | undefined {
  return a.length ? a[r.int(a.length)] : undefined;
}

/** Choisit une action « plausible » (souvent valide, parfois absurde) pour un joueur. */
function playerMove(s: GameState, pid: string, r: Rng, now: number): PlayerAction {
  const p = s.players.find((x) => x.id === pid)!;
  const st = (kind: string) => pick(r, s.terrain.stations.filter((x) => x.kind === kind))?.code ?? 'ZZZZ';
  const roll = r.int(100);
  if (p.challenge && now >= p.challenge.startedAt + p.challenge.minMs && roll < 85) {
    return { type: 'submit', challengeId: p.challenge.id, answer: r.int(10) ? p.challenge.answer : 'faux' };
  }
  if (s.phase === 'meeting') {
    if (s.meeting?.stage === 'gather' && roll < 60) return { type: 'checkIn' };
    if (s.meeting?.stage === 'discussion' && roll < 40) return { type: 'readyVote' };
    if (s.meeting?.stage === 'voting') {
      const alive = s.players.filter((x) => x.alive && !x.left && x.role);
      const imps = alive.filter((x) => x.role === 'impostor');
      // l'équipage vote parfois juste, parfois au hasard
      const target = roll < 30 && imps.length ? pick(r, imps)!.id : roll < 55 ? 'skip' : pick(r, alive)?.id ?? 'skip';
      return { type: 'vote', target };
    }
  }
  if (p.role === 'impostor') {
    if (roll < 14) {
      // souvent un équipier vivant, parfois n'importe qui (allié, mort, parti, soi-même, inconnu)
      const victim = r.int(4) ? pick(r, s.players.filter((x) => x.alive && x.role === 'crewmate')) : pick(r, s.players);
      return { type: 'kill', target: r.int(20) ? victim?.id ?? 'x' : 'inconnu' };
    }
    if (roll < 20) return { type: 'sabotage', kind: pick(r, SAB)! };
  }
  if (!p.alive && roll < 3) return { type: 'dispute' };
  if (roll < 4) {
    const body = pick(r, s.players.filter((x) => x.body && !x.body.reported && !x.body.vanished));
    return { type: 'report', code: body && r.int(3) ? body.body!.code : String(r.int(10000)).padStart(4, '0') };
  }
  if (roll < 6) return { type: 'callEmergency', code: r.int(4) ? st('emergency') : 'AAAA' };
  if (s.sabotage && roll < 30) {
    if (s.sabotage.kind === 'reactor') return { type: 'hold', code: st('reactor'), on: r.int(8) !== 0 };
    return { type: 'fixStart', code: st(s.sabotage.kind) };
  }
  const next = p.tasks.find((t) => !t.done);
  if (next && roll < 75) {
    const def = s.terrain.tasks.find((d) => d.id === next.taskId)!;
    const station = s.terrain.stations.find((x) => x.id === def.steps[next.step]?.stationId);
    return { type: 'startTask', code: r.int(12) ? station?.code ?? 'ZZZZ' : st('task'), taskId: r.int(15) ? next.taskId : 'inconnue' };
  }
  const junk: PlayerAction[] = [
    { type: 'scan', code: r.int(2) ? st('task') : 'QQQQ' },
    { type: 'scan', code: st('vitals') },
    { type: 'cancelChallenge' },
    { type: 'kill', target: pick(r, s.players)?.id ?? 'x' },
    { type: 'readyVote' },
    { type: 'dispute' },
    { type: 'vote', target: 'skip' },
    { type: 'checkIn' },
    { type: 'alert', message: 'test' },
    { type: 'pushUnsubscribe' },
    { type: 'nimportequoi' } as never,
    { type: 'submit', challengeId: 'faux', answer: 1 },
  ];
  if (r.int(400) === 0) return { type: 'leave' };
  return junk[r.int(junk.length)];
}

function gmMove(s: GameState, r: Rng): GmAction {
  const anyP = pick(r, s.players)?.id ?? 'x';
  const moves: GmAction[] = [
    { type: 'advance' },
    { type: 'extend', seconds: r.int(2) ? 30 : -30 },
    { type: 'ping' },
    { type: 'fixSabotage' },
    { type: 'taskDone', playerId: anyP, taskId: pick(r, s.players.find((p) => p.id === anyP)?.tasks ?? [])?.taskId ?? 'x', done: r.int(2) === 0 },
    { type: 'settings', settings: { impostors: 1 } },
    { type: 'testTask', taskId: pick(r, s.terrain.tasks)!.id },
    { type: 'meeting' },
  ];
  const roll = r.int(100);
  if (roll < 3) return { type: 'kill', playerId: anyP };
  if (roll < 5) return { type: 'revive', playerId: anyP };
  if (roll < 6) return { type: 'kick', playerId: anyP };
  if (roll < 7) return { type: 'markLeft', playerId: anyP };
  return moves[r.int(moves.length)];
}

function simulate(seed: number, n: number, steps: number, terrain: Terrain = exampleTerrain(seededRng(seed + 1))) {
  const r = seededRng(seed);
  let now = 1_000_000;
  const ctx = () => ({ now, rng: r });
  const impostors = Math.max(1, Math.min(Math.floor((n - 1) / 2), 1 + r.int(Math.max(1, Math.floor(n / 6)))));
  const s = createGame('BCDFGH', 'gm', 'sec', now, {
    impostors,
    initialKillCooldownSec: 5,
    killCooldownSec: 10 + r.int(30),
    emergencyCooldownSec: r.int(20),
    emergencyMeetingsPerPlayer: r.int(3),
    gatherSec: 15,
    discussionSec: r.int(2) ? 0 : 15,
    votingSec: 15,
    resultSec: 5,
    sabotageCooldownSec: 10,
    initialSabotageCooldownSec: 5,
    reactorSec: 30,
    oxygenSec: 30,
    bodyTimeoutSec: r.int(2) ? 0 : 40,
    anonymousVotes: r.int(2) === 0,
    confirmEjects: r.int(3) !== 0,
    taskBarUpdates: (['always', 'meetings', 'never'] as const)[r.int(3)],
    ghostsSeeRoles: r.int(4) === 0,
    commonTasks: r.int(3),
    longTasks: r.int(3),
    shortTasks: 1 + r.int(4),
  }, terrain);
  for (let i = 0; i < n; i++) addPlayer(s, `Joueur ${i + 1}`, `t${i}`, now);
  gmAction(s, { type: 'start' }, ctx());
  const outcomes: string[] = [];
  let errors = 0;
  for (let i = 0; i < steps; i++) {
    now += r.int(4) === 0 ? r.int(15_000) : r.int(1500);
    tick(s, now);
    invariants(s, now);
    if (s.phase === 'ended') {
      outcomes.push(`${s.winner}: ${s.endReason}`);
      viewsAreSafe(s, now); // écran de fin : récapitulatif complet pour chaque joueur
      for (const p of s.players.filter((x) => x.role && !x.kicked)) expect(viewForPlayer(s, p.id, now).end?.players.length).toBeGreaterThan(0);
      gmAction(s, { type: 'newGame' }, ctx());
      if (s.players.filter((p) => !p.kicked && !p.left).length < 4) break;
      s.settings.impostors = Math.max(1, Math.min(s.settings.impostors, Math.floor((s.players.length - 1) / 2)));
      gmAction(s, { type: 'start' }, ctx());
      continue;
    }
    try {
      if (r.int(100) < 6) {
        if (r.int(10) === 0 && !s.paused) {
          gmAction(s, { type: 'pause' }, ctx());
          now += r.int(20_000);
          gmAction(s, { type: 'resume' }, ctx());
        } else gmAction(s, gmMove(s, r), ctx());
      } else {
        const actor = pick(r, s.players.filter((p) => !p.kicked))!;
        const before = taskProgress(s).done;
        const a = playerMove(s, actor.id, r, now);
        playerAction(s, actor.id, a, ctx());
        // une tâche simulée par un imposteur ne fait jamais avancer la barre de l'équipage
        if (actor.role === 'impostor' && a.type === 'submit') expect(taskProgress(s).done).toBe(before);
      }
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      errors++;
    }
    invariants(s, now);
    if (i % 60 === 0) viewsAreSafe(s, now);
  }
  return { outcomes, errors, state: s };
}

const GAMES = Number(process.env.SIM_GAMES ?? 40);
const BATCH = 5;

describe(`simulation aléatoire du moteur (${GAMES} séries de parties, 4 à 40 joueurs)`, () => {
  const all: string[] = [];
  let refused = 0;
  for (let b = 0; b < GAMES / BATCH; b++) {
    it(`séries ${b * BATCH + 1} à ${(b + 1) * BATCH} : aucune erreur inattendue, invariants toujours respectés`, async () => {
      for (let seed = b * BATCH + 1; seed <= (b + 1) * BATCH; seed++) {
        const res = simulate(seed, 4 + (seed % 37), 900);
        all.push(...res.outcomes);
        refused += res.errors;
        // rend la main entre deux séries : le processus de test reste joignable (sinon délai RPC de vitest dépassé)
        await new Promise((r) => setTimeout(r, 0));
      }
    }, 120_000);
  }
  it('les parties se terminent réellement, par toutes les voies de victoire', () => {
    const reasons = (re: RegExp) => all.filter((o) => re.test(o)).length;
    const stats = {
      parties: all.length,
      refusees: refused,
      tachesEquipage: reasons(/^crew: Toutes les tâches/),
      ejectionsImposteurs: reasons(/^crew: Tous les imposteurs/),
      pariteImposteurs: reasons(/^impostors: Les imposteurs sont aussi nombreux/),
      sabotageCritique: reasons(/sabotage critique/),
    };
    console.log('Simulation :', stats);
    expect(all.length).toBeGreaterThan(GAMES * 2);
    expect(stats.tachesEquipage).toBeGreaterThan(0);
    expect(stats.ejectionsImposteurs).toBeGreaterThan(0);
    expect(stats.pariteImposteurs).toBeGreaterThan(0);
    expect(stats.sabotageCritique).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(GAMES * 20); // beaucoup d'actions invalides, toutes refusées proprement
  });
});

/** Kit de fiches universel : une partie des fiches appairées au hasard dans une maison au hasard. */
function kitHouse(seed: number): Terrain {
  const r = seededRng(seed);
  const n = 3 + r.int(28);
  let t = kitTerrain({ ...kitTerrain(), rooms: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Salle ${i + 1}`, floor: i % 2 ? 'Étage' : 'RDC', forbidden: false, transit: false, hideAllowed: true, notes: '' })) });
  for (const k of KIT_SHEETS) if (k.kind === 'emergency' || r.int(3) > 0) t = pairSheet(t, k.id, `r${r.int(n)}`);
  return t;
}

describe('simulation aléatoire sur des maisons équipées du kit de fiches universel', () => {
  let ended = 0;
  for (let b = 0; b < 3; b++) {
    it(`séries ${b * BATCH + 1} à ${(b + 1) * BATCH}`, async () => {
      for (let seed = 1000 + b * BATCH; seed < 1000 + (b + 1) * BATCH; seed++) {
        const terrain = kitHouse(seed);
        const res = simulate(seed, 4 + (seed % 37), 900, terrain);
        ended += res.outcomes.length;
        expect(res.state.terrain).toEqual(terrain);
        await new Promise((r) => setTimeout(r, 0));
      }
    }, 120_000);
  }
  it('les parties se terminent réellement', () => expect(ended).toBeGreaterThan(10));
});
