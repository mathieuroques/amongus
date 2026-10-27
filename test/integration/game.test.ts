// Tests d'intégration client ↔ serveur : vrais WebSockets contre le Worker + Durable Object exécutés localement.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemblePuzzle, countPuzzle } from '../../src/shared/puzzles';
import { BASE, createGame, Phone, sleep, startServer, stopServer } from './server';

const N = 40;
const SETTINGS = {
  maxPlayers: 40,
  impostors: 6,
  initialKillCooldownSec: 5,
  killCooldownSec: 10,
  emergencyCooldownSec: 0,
  gatherSec: 15,
  discussionSec: 0,
  votingSec: 15,
  resultSec: 5,
  doorsSec: 10,
  initialSabotageCooldownSec: 5,
  sabotageCooldownSec: 10,
  bodyTimeoutSec: 0,
};

let game: { code: string; gmToken: string; gmSecret: string };
let gm: Phone;
const phones: Phone[] = [];

const byId = (id: string) => phones.find((p) => p.playerId === id)!;
const gmPlayer = (id: string) => gm.state.players.find((p: any) => p.id === id);
const role = (p: Phone) => gmPlayer(p.playerId!)?.role;
const station = (kind: string, i = 0) => gm.state.terrain.stations.filter((s: any) => s.kind === kind)[i];

function solve(ch: any, taskId?: string) {
  const def = gm.state.terrain.tasks.find((t: any) => t.id === taskId);
  switch (ch.game) {
    case 'wires':
      return ch.params.left.map((c: number) => ch.params.right.indexOf(c));
    case 'sequence':
      return ch.params.seq;
    case 'slider':
    case 'tune':
      return ch.params.target;
    case 'pin':
      return ch.params.pin;
    case 'count':
      return countPuzzle(def.seed).answer;
    case 'assemble':
      return assemblePuzzle(def.seed).answer;
    default:
      return 'done';
  }
}

/** Joue l'étape courante d'une tâche comme le ferait un téléphone. */
async function doStep(p: Phone, taskId: string) {
  const t = gmPlayer(p.playerId!).tasks.find((x: any) => x.taskId === taskId);
  const def = gm.state.terrain.tasks.find((x: any) => x.id === taskId);
  const st = gm.state.terrain.stations.find((s: any) => s.id === def.steps[t.step].stationId);
  const r = await p.act({ type: 'startTask', code: st.code, taskId });
  expect(r.ok, r.msg).toBe(true);
  await sleep(r.data.minMs + 50);
  return p.act({ type: 'submit', challengeId: r.data.id, answer: solve(r.data, taskId) });
}

beforeAll(async () => {
  await startServer();
}, 90_000);

afterAll(async () => {
  for (const p of phones) p.close();
  gm?.close();
  await stopServer();
});

describe('parcours complet multi-téléphones', () => {
  it('1. crée une partie avec un code court', async () => {
    game = await createGame({ settings: SETTINGS });
    expect(game.code).toMatch(/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/);
    expect(game.gmSecret).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const info = await (await fetch(`${BASE}/api/games/${game.code}/info`)).json();
    expect(info).toEqual({ exists: true, phase: 'lobby', players: 0, locked: false, maxPlayers: 40 });
    expect((await fetch(`${BASE}/api/games/ZZZZZZ/info`)).status).toBe(404);
  });

  it('2-3. le MJ et 40 téléphones se connectent avec des pseudonymes distincts', async () => {
    gm = await new Phone(game.code).open();
    expect((await gm.hello(game.gmToken)).t).toBe('welcome');
    expect(gm.state.kind).toBe('gm');
    for (let i = 0; i < N; i++) phones.push(await new Phone(game.code).open());
    const res = await Promise.all(phones.slice(0, N - 1).map((p, i) => p.join(`Joueur ${i + 1}`)));
    expect(res.every((m) => m.t === 'token')).toBe(true);
    const dup = await new Phone(game.code).open();
    const m = await dup.join('joueur 1');
    expect(m).toMatchObject({ t: 'error', code: 'name_taken' });
    expect((await phones[N - 1].join(`Joueur ${N}`)).t).toBe('token');
    const full = await dup.join('Quarante et un');
    expect(full).toMatchObject({ t: 'error', code: 'full' });
    dup.close();
    await gm.waitState((s) => s.players.length === N);
    await phones[0].waitState((s) => s.players.length === N);
  }, 60_000);

  it('23. aucun secret sans authentification, jeton invalide refusé, code MJ vérifié', async () => {
    const intruder = await new Phone(game.code).open();
    const r = await intruder.act({ type: 'start' });
    expect(r.ok).toBe(false);
    expect(intruder.state).toBeUndefined();
    const h = await intruder.hello('0'.repeat(48));
    expect(h).toMatchObject({ t: 'error', code: 'bad_token' });
    const bad = intruder.wait((x) => x.t === 'error');
    intruder.send({ t: 'gmLogin', secret: 'AAAA-AAAA' });
    expect(await bad).toMatchObject({ code: 'bad_secret' });
    const good = intruder.wait((x) => x.t === 'token');
    intruder.send({ t: 'gmLogin', secret: game.gmSecret });
    expect(await good).toMatchObject({ as: 'gm' });
    intruder.close();
  });

  it('25. un joueur ne peut pas utiliser les commandes du MJ', async () => {
    const p = phones[0];
    for (const a of [{ type: 'start' }, { type: 'kill', playerId: phones[1].playerId }, { type: 'settings', settings: { impostors: 1 } }, { type: 'end', winner: 'crew' }]) {
      const r = await p.act(a);
      expect(r.ok).toBe(false);
    }
    expect(gm.state.phase).toBe('lobby');
    expect(gm.state.settings.impostors).toBe(6);
  });

  it('4-5. démarrage : rôles distribués sans fuite', async () => {
    const r = await gm.act({ type: 'start' });
    expect(r.ok, r.msg).toBe(true);
    await Promise.all(phones.map((p) => p.waitState((s) => s.phase === 'playing')));
    await gm.waitState((s) => s.phase === 'playing');
    const imps = phones.filter((p) => role(p) === 'impostor');
    expect(imps).toHaveLength(6);
    for (const p of phones) {
      const s = p.state;
      expect(s.me.role).toBe(role(p));
      const json = JSON.stringify(s);
      const othersRoles = s.players.filter((x: any) => x.id !== p.playerId && x.role);
      if (role(p) === 'crewmate') {
        expect(othersRoles).toHaveLength(0);
        expect(s.allies).toBeUndefined();
        expect(json).not.toContain('"role":"impostor"');
      } else {
        expect(othersRoles.map((x: any) => x.id).sort()).toEqual(imps.filter((x) => x !== p).map((x) => x.playerId).sort());
      }
      for (const st of gm.state.terrain.stations) expect(json).not.toContain(`"code":"${st.code}"`);
      expect(json).not.toContain('tokenHash');
      expect(json).not.toContain('"log"');
    }
  });

  it('6-9. tâches différentes, validation, refus et progression synchronisée', async () => {
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const lists = crew.map((p) => p.state.me.tasks.map((t: any) => t.taskId).join());
    expect(new Set(lists).size).toBeGreaterThan(1);
    const a = crew[0];
    const short = gmPlayer(a.playerId!).tasks.find((t: any) => t.type === 'short' && t.steps === 1);
    const r = await doStep(a, short.taskId);
    expect(r.ok, r.msg).toBe(true);
    expect(r.data).toEqual({ taskDone: true });
    // tâche déjà terminée
    const def = gm.state.terrain.tasks.find((x: any) => x.id === short.taskId);
    const st = gm.state.terrain.stations.find((s: any) => s.id === def.steps[0].stationId);
    expect((await a.act({ type: 'startTask', code: st.code, taskId: short.taskId })).code).toBe('task_done');
    // tâche non attribuée
    const notMine = gm.state.terrain.tasks.find((t: any) => !a.state.me.tasks.some((m: any) => m.taskId === t.id));
    expect((await a.act({ type: 'startTask', code: st.code, taskId: notMine.id })).code).toBe('not_your_task');
    // code de poste inventé
    expect((await a.act({ type: 'scan', code: 'QQQQ' })).code).toBe('bad_code');
    // la progression est diffusée à tous
    const total = gm.state.taskBar.total;
    await phones[5].waitState((s) => Math.abs(s.taskBar - 1 / total) < 1e-9);
    await gm.waitState((s) => s.taskBar.done === 1);
    // un imposteur « fait » une tâche : aucune progression
    const imp = phones.find((p) => role(p) === 'impostor')!;
    const fr = await doStep(imp, imp.state.me.tasks[imp.state.me.tasks.length - 1].taskId);
    expect(fr.data).toEqual({ fake: true });
    await sleep(200);
    expect(gm.state.taskBar.done).toBe(1);
  }, 30_000);

  it('24. modification frauduleuse depuis le navigateur : réponse fausse, trop rapide, défi d’autrui', async () => {
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const [a, b] = [crew[1], crew[2]];
    const t = gmPlayer(a.playerId!).tasks.find((x: any) => !x.done);
    const def = gm.state.terrain.tasks.find((x: any) => x.id === t.taskId);
    const st = gm.state.terrain.stations.find((s: any) => s.id === def.steps[0].stationId);
    const ch = await a.act({ type: 'startTask', code: st.code, taskId: t.taskId });
    expect((await a.act({ type: 'submit', challengeId: ch.data.id, answer: solve(ch.data, t.taskId) })).code).toBe('too_fast');
    expect((await b.act({ type: 'submit', challengeId: ch.data.id, answer: 'done' })).code).toBe('no_challenge');
    expect((await a.act({ type: 'vote', target: 'skip' })).code).toBe('not_voting');
    expect((await a.act({ type: 'arm' })).code).toBe('forbidden');
    expect((await a.act({ type: 'sabotage', kind: 'reactor' })).code).toBe('forbidden');
    await a.act({ type: 'cancelChallenge' });
  });

  it('26-bis. validations concurrentes de la même étape : une seule est comptée', async () => {
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const a = crew[3];
    const t = gmPlayer(a.playerId!).tasks.find((x: any) => !x.done && x.steps === 1);
    const def = gm.state.terrain.tasks.find((x: any) => x.id === t.taskId);
    const st = gm.state.terrain.stations.find((s: any) => s.id === def.steps[0].stationId);
    const before = gm.state.taskBar.done;
    const ch = await a.act({ type: 'startTask', code: st.code, taskId: t.taskId });
    await sleep(ch.data.minMs + 50);
    const ans = solve(ch.data, t.taskId);
    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => a.act({ type: 'submit', challengeId: ch.data.id, answer: ans })));
    expect([r1, r2, r3].filter((r) => r.ok)).toHaveLength(1);
    await gm.waitState((s) => s.taskBar.done === before + 1);
    await sleep(200);
    expect(gm.state.taskBar.done).toBe(before + 1);
  }, 20_000);

  it('10-11. sabotage autorisé, refusé, et fin automatique par le minuteur du serveur', async () => {
    const imps = phones.filter((p) => role(p) === 'impostor');
    await sleep(5_200); // délai initial des sabotages
    const room = gm.state.terrain.rooms.find((r: any) => !r.forbidden && !r.transit && r.id !== gm.state.terrain.meetingRoomId);
    const r = await imps[0].act({ type: 'sabotage', kind: 'doors', roomId: room.id });
    expect(r.ok, r.msg).toBe(true);
    expect((await imps[1].act({ type: 'sabotage', kind: 'lights' })).code).toBe('busy');
    await phones[0].waitState((s) => s.sabotage?.kind === 'doors' && s.sabotage.roomId === room.id);
    // aucune action : c'est l'alarme du Durable Object qui doit rouvrir la salle
    await phones[0].waitState((s) => !s.sabotage, 15_000);
    await gm.waitState((s) => s.log.some((l: any) => /Salle condamnée.*terminé/.test(l.msg)));
  }, 30_000);

  it('12-13. délai d’élimination respecté, pas de double élimination', async () => {
    const imps = phones.filter((p) => role(p) === 'impostor');
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const k = imps[0];
    const a1 = await k.act({ type: 'arm' });
    expect(a1.ok, a1.msg).toBe(true);
    const victim = crew[10];
    const r = await victim.act({ type: 'killed', code: a1.data.code });
    expect(r.ok, r.msg).toBe(true);
    await victim.waitState((s) => s.me.alive === false && s.me.bodyPending);
    // le même code ne tue pas une deuxième personne
    expect((await crew[11].act({ type: 'killed', code: a1.data.code })).code).toBe('bad_code');
    // délai entre deux éliminations
    expect((await k.act({ type: 'arm' })).code).toBe('cooldown');
    // un mort ne peut pas être « re-tué »
    const a2 = await imps[1].act({ type: 'arm' });
    expect((await victim.act({ type: 'killed', code: a2.data.code })).code).toBe('dead');
    await imps[1].act({ type: 'disarm' });
    // les autres ignorent encore la mort
    expect(crew[12].state.players.find((x: any) => x.id === victim.playerId).status).toBe('alive');
  });

  it('14-18. signalement, réunion, actions bloquées, vote secret, double vote refusé, résultat', async () => {
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const imps = phones.filter((p) => role(p) === 'impostor');
    const victim = crew[10];
    const bodyCode = victim.state.me.body.code;
    const r = await crew[13].act({ type: 'report', code: bodyCode });
    expect(r.ok, r.msg).toBe(true);
    await Promise.all(phones.map((p) => p.waitState((s) => s.phase === 'meeting')));
    expect(crew[12].state.players.find((x: any) => x.id === victim.playerId).status).toBe('dead');
    expect(crew[12].state.meeting.bodyOfName).toBe(victim.state.me.name);
    // actions interdites pendant la réunion
    await sleep(5_000);
    expect((await imps[2].act({ type: 'arm' })).code).toBe('meeting');
    expect((await crew[1].act({ type: 'scan', code: station('task').code })).code).toBe('meeting');
    // rassemblement : tous les vivants pointent → vote (discussion = 0)
    const alive = phones.filter((p) => p.state.me.alive);
    await Promise.all(alive.map((p) => p.act({ type: 'checkIn' })));
    await gm.waitState((s) => s.meeting?.stage === 'voting');
    expect((await victim.act({ type: 'vote', target: 'skip' })).code).toBe('dead');
    // tout le monde vote contre un imposteur, sauf les imposteurs (passer)
    const target = imps[5];
    const v1 = await crew[0].act({ type: 'vote', target: target.playerId });
    expect(v1.ok).toBe(true);
    expect((await crew[0].act({ type: 'vote', target: 'skip' })).code).toBe('already_voted');
    // vote individuel invisible pour les autres pendant le vote
    await crew[1].waitState((s) => s.meeting.votedIds.includes(crew[0].playerId));
    expect(JSON.stringify(crew[1].state)).not.toContain(`"${crew[0].playerId}":"${target.playerId}"`);
    const rest = alive.filter((p) => p !== crew[0]);
    await Promise.all(rest.map((p) => p.act({ type: 'vote', target: role(p) === 'impostor' ? 'skip' : target.playerId })));
    const s = await crew[1].waitState((x) => x.meeting?.stage === 'result');
    expect(s.meeting.result.ejectedId).toBe(target.playerId);
    expect(s.meeting.result.wasImpostor).toBe(true);
    expect(s.meeting.result.impostorsLeft).toBe(5);
    // l'alarme du serveur fait reprendre la partie après l'affichage du résultat
    await crew[1].waitState((x) => x.phase === 'playing', 10_000);
  }, 60_000);

  it('19. règles des morts : le fantôme ne vote pas, ne signale pas, mais fait ses tâches', async () => {
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const ghost = crew[10];
    await ghost.waitState((s) => !s.me.bodyPending);
    expect((await ghost.act({ type: 'report', code: '1234' })).code).toBe('dead');
    const r = await ghost.act({ type: 'scan', code: station('emergency').code });
    expect(r.data.block).toMatch(/fantômes/);
    const t = gmPlayer(ghost.playerId!).tasks.find((x: any) => !x.done && x.steps === 1);
    const before = gm.state.taskBar.done;
    const res = await doStep(ghost, t.taskId);
    expect(res.ok, res.msg).toBe(true);
    await gm.waitState((s) => s.taskBar.done === before + 1);
  }, 20_000);

  it('21-22. rechargement de page et coupure réseau : l’état est conservé, pas de triche', async () => {
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const ghost = crew[10];
    const token = ghost.token!;
    ghost.close();
    await sleep(300);
    // « actualisation » : nouvelle connexion avec le même jeton
    const reloaded = await new Phone(game.code).open();
    expect((await reloaded.hello(token)).t).toBe('welcome');
    expect(reloaded.state.me.alive).toBe(false);
    expect(reloaded.state.me.id).toBe(ghost.playerId);
    reloaded.token = token;
    phones[phones.indexOf(ghost)] = reloaded;
    // coupure brutale (sans fermeture propre) puis retour
    const p = crew[5];
    const tok = p.token!;
    (p.ws as any)._socket?.destroy?.();
    p.close();
    const back = await new Phone(game.code).open();
    expect((await back.hello(tok)).t).toBe('welcome');
    back.token = tok;
    expect(back.state.me.tasks.map((t: any) => t.done)).toEqual(p.state.me.tasks.map((t: any) => t.done));
    phones[phones.indexOf(p)] = back;
    // une vieille page d'un joueur mort ne peut pas agir comme un vivant
    expect((await reloaded.act({ type: 'killed', code: '0000' })).code).toBe('dead');
  });

  it('20. victoire des imposteurs par parité, puis 27. nouvelle partie propre', async () => {
    // le MJ déclare des morts jusqu'à la parité : 5 imposteurs vivants
    const crewAlive = () => gm.state.players.filter((p: any) => p.role === 'crewmate' && p.alive);
    while (crewAlive().length > 5) {
      const victim = crewAlive()[0];
      const r = await gm.act({ type: 'kill', playerId: victim.id });
      expect(r.ok, r.msg).toBe(true);
      await gm.waitState((s) => s.players.find((p: any) => p.id === victim.id).alive === false);
    }
    const end = await phones[0].waitState((s) => s.phase === 'ended');
    expect(end.end.winner).toBe('impostors');
    expect(end.end.players.filter((p: any) => p.role === 'impostor')).toHaveLength(6);
    const n = await gm.act({ type: 'newGame' });
    expect(n.ok).toBe(true);
    const lobby = await phones[0].waitState((s) => s.phase === 'lobby');
    expect(lobby.players).toHaveLength(N);
    expect(lobby.me.role).toBeUndefined();
    expect(lobby.gameNumber).toBe(2);
  }, 60_000);

  it('persistance : l’état survit au redémarrage du serveur', async () => {
    for (const p of phones) p.close();
    gm.close();
    await stopServer();
    await startServer();
    const again = await new Phone(game.code).open();
    expect((await again.hello(game.gmToken)).t).toBe('welcome');
    expect(again.state.phase).toBe('lobby');
    expect(again.state.players).toHaveLength(N);
    expect(again.state.gameNumber).toBe(2);
    gm = again;
  }, 120_000);
});
