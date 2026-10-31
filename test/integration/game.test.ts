// Tests d'intégration client ↔ serveur : vrais WebSockets contre le Worker + Durable Object exécutés localement.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleAnswer, countAnswer } from '../../src/shared/puzzles';
import { exampleTerrain } from '../fixtures';
import { BASE, createGame, Phone, sleep, startServer, stopServer } from './server';

const N = 40;
const SETTINGS = {
  maxPlayers: 40,
  impostors: 6,
  initialKillCooldownSec: 5,
  killCooldownSec: 10,
  emergencyCooldownSec: 0,
  gatherSec: 60,
  discussionSec: 0,
  votingSec: 15,
  resultSec: 5,
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
    // énigmes papier : comme un joueur devant la fiche imprimée (la réponse n'est jamais envoyée au téléphone)
    case 'count':
      return countAnswer(def.seed, ch.params.sym, ch.params.scope);
    case 'assemble':
      return assembleAnswer(def.seed, ch.params.line);
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
    game = await createGame({ settings: SETTINGS, terrain: exampleTerrain() });
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
    // un imposteur « fait » une tâche : même réponse et même progression de SA liste, aucune progression de la barre
    const imp = phones.find((p) => role(p) === 'impostor')!;
    const shortImp = imp.state.me.tasks.find((t: any) => t.type === 'short' && t.steps === 1);
    const fr = await doStep(imp, shortImp.taskId);
    expect(fr.data).toEqual({ taskDone: true });
    await imp.waitState((s) => s.me.tasks.find((t: any) => t.taskId === shortImp.taskId).done);
    await sleep(200);
    expect(gm.state.taskBar.done).toBe(1);
    // la prochaine étape conseillée tient compte de la dernière tâche faite
    const after = a.state;
    const next = after.me.tasks.find((t: any) => t.taskId === after.me.nextTaskId);
    expect(next.done).toBe(false);
    expect(Math.min(...after.me.tasks.filter((t: any) => !t.done).map((t: any) => t.near))).toBe(next.near);
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
    expect((await a.act({ type: 'kill', target: b.playerId })).code).toBe('unknown'); // l'imposteur ne saisit plus rien
    expect((await a.act({ type: 'arm' })).code).toBe('unknown'); // ancienne action supprimée : refusée proprement
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

  it('10-11. sabotage autorisé, refusé (doublon, équipier, « salle condamnée » supprimée), réparation', async () => {
    const imps = phones.filter((p) => role(p) === 'impostor');
    const crew = phones.filter((p) => role(p) === 'crewmate');
    await sleep(5_200); // délai initial des sabotages
    expect((await imps[0].act({ type: 'sabotage', kind: 'doors' })).code).toBe('unavailable');
    expect((await crew[0].act({ type: 'sabotage', kind: 'comms' })).code).toBe('forbidden');
    const r = await imps[0].act({ type: 'sabotage', kind: 'comms' });
    expect(r.ok, r.msg).toBe(true);
    expect((await imps[1].act({ type: 'sabotage', kind: 'lights' })).code).toBe('busy');
    const hidden = await crew[1].waitState((s) => s.sabotage?.kind === 'comms');
    expect(hidden.me.tasks).toBeUndefined();
    // réparation au poste Radio par un équipier
    const fix = await crew[1].act({ type: 'fixStart', code: station('comms').code });
    expect(fix.ok, fix.msg).toBe(true);
    await sleep(fix.data.minMs + 50);
    expect((await crew[1].act({ type: 'submit', challengeId: fix.data.id, answer: fix.data.params.target })).data).toEqual({ fixed: true });
    await crew[2].waitState((s) => !s.sabotage && s.me.tasks);
  }, 30_000);

  it('panne de courant : tâches possibles, signalement refusé, réparation', async () => {
    const imps = phones.filter((p) => role(p) === 'impostor');
    const crew = phones.filter((p) => role(p) === 'crewmate');
    await sleep(10_200); // délai entre deux sabotages
    const r = await imps[1].act({ type: 'sabotage', kind: 'lights' });
    expect(r.ok, r.msg).toBe(true);
    await crew[4].waitState((s) => s.sabotage?.kind === 'lights');
    expect(crew[4].state.me.tasks).toBeDefined(); // la liste reste visible
    const t = gmPlayer(crew[4].playerId!).tasks.find((x: any) => !x.done && x.steps === 1);
    expect((await doStep(crew[4], t.taskId)).ok).toBe(true);
    expect((await crew[4].act({ type: 'report', code: '1234' })).code).toBe('dark');
    const fix = await crew[4].act({ type: 'fixStart', code: station('lights').code });
    expect(fix.ok, fix.msg).toBe(true);
    await sleep(fix.data.minMs + 50);
    expect((await crew[4].act({ type: 'submit', challengeId: fix.data.id, answer: 'done' })).data).toEqual({ fixed: true });
    await crew[5].waitState((s) => !s.sabotage);
  }, 40_000);

  it('outils du MJ : test d’une tâche via le serveur, test d’alerte, abonnements push', async () => {
    const t = gm.state.terrain.tasks.find((x: any) => x.enabled && x.steps[0].game === 'count');
    const r = await gm.act({ type: 'testTask', taskId: t.id, stepIndex: 0 });
    expect(r.ok, r.msg).toBe(true);
    expect(r.data.expected).toBe(countAnswer(t.seed, r.data.params.sym, r.data.params.scope));
    await sleep(r.data.minMs + 50);
    expect((await gm.act({ type: 'testSubmit', challengeId: r.data.id, answer: '999' })).code).toBe('wrong');
    expect((await gm.act({ type: 'testSubmit', challengeId: r.data.id, answer: r.data.expected })).ok).toBe(true);
    // la partie n'est pas affectée
    expect(gm.state.phase).toBe('playing');
    // test d'alerte : tous les téléphones reçoivent le nouveau compteur
    const before = phones[0].state.pingId;
    expect((await gm.act({ type: 'ping' })).ok).toBe(true);
    await Promise.all(phones.map((p) => p.waitState((s) => s.pingId === before + 1)));
    // abonnement push : hôte inconnu refusé, service officiel accepté, visible du MJ uniquement
    const keys = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
    expect((await phones[3].act({ type: 'pushSubscribe', subscription: { endpoint: 'https://attaquant.example/x', keys } })).code).toBe('bad_push');
    expect((await phones[3].act({ type: 'pushSubscribe', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys } })).ok).toBe(true);
    await gm.waitState((s) => s.players.find((p: any) => p.id === phones[3].playerId).push === true);
    expect(phones[3].state.pushOn).toBe(true);
    expect(phones[3].state.pushKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(JSON.stringify(phones[4].state)).not.toContain('fcm.googleapis.com');
    await phones[3].act({ type: 'pushUnsubscribe' });
    // message de visibilité (application en arrière-plan) accepté sans effet de bord
    phones[5].send({ t: 'vis', visible: false });
    phones[5].send({ t: 'vis', visible: true });
    expect((await phones[5].act({ type: 'cancelChallenge' })).ok).toBe(true);
  }, 30_000);

  it('12-13. élimination déclarée par la victime : délai respecté, nom du tueur jamais sur son téléphone, cas douteux au MJ', async () => {
    const imps = phones.filter((p) => role(p) === 'impostor');
    const crew = phones.filter((p) => role(p) === 'crewmate');
    const k = imps[0];
    const victim = crew[10];
    // un imposteur ne peut pas se déclarer éliminé
    expect((await imps[1].act({ type: 'killedBy', killer: k.playerId })).code).toBe('forbidden');
    const r = await victim.act({ type: 'killedBy', killer: k.playerId });
    expect(r.ok, r.msg).toBe(true);
    // le téléphone de la victime passe en écran « corps », sans jamais le nom du tueur
    await victim.waitState((s) => s.me.alive === false && s.me.bodyPending && /^\d{4}$/.test(s.me.body.code));
    expect(JSON.stringify(victim.state.me)).not.toContain(k.state.me.name);
    // le délai du tueur repart
    const g0 = await gm.waitState((s) => s.players.find((x: any) => x.id === victim.playerId).killedByName === k.state.me.name);
    expect(g0.players.find((x: any) => x.id === k.playerId).killCooldownUntil).toBeGreaterThan(Date.now());
    expect(g0.alerts.some((a: any) => a.kind === 'dispute' && a.playerId === victim.playerId)).toBe(false);
    // un mort ne peut pas se re-déclarer, ni être désigné
    expect((await victim.act({ type: 'killedBy', killer: k.playerId })).code).toBe('dead');
    expect((await crew[11].act({ type: 'killedBy', killer: victim.playerId })).code).toBe('bad_target');
    // les autres ignorent encore la mort
    expect(crew[12].state.players.find((x: any) => x.id === victim.playerId).status).toBe('alive');
    // nom d'un équipier : mort quand même (rien à « tester »), le MJ est prévenu (et lui seul)
    const v2 = crew[9];
    expect((await v2.act({ type: 'killedBy', killer: crew[12].playerId })).ok).toBe(true);
    const g = await gm.waitState((s) => s.alerts.some((a: any) => a.kind === 'dispute' && a.playerId === v2.playerId));
    const al = g.alerts.find((a: any) => a.kind === 'dispute' && a.playerId === v2.playerId);
    expect(al.message).toContain(crew[12].state.me.name);
    expect(JSON.stringify(crew[12].state)).not.toContain(al.message);
    await gm.act({ type: 'ackAlert', id: al.id });
    // le MJ annule cette mort injustifiée
    expect((await gm.act({ type: 'revive', playerId: v2.playerId })).ok).toBe(true);
    await v2.waitState((s) => s.me.alive === true);
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
    expect((await crew[1].act({ type: 'killedBy', killer: imps[2].playerId })).code).toBe('meeting');
    expect((await crew[1].act({ type: 'scan', code: station('task').code })).code).toBe('meeting');
    // rassemblement : la majorité pointe → l'alarme du serveur ouvre la suite 15 s plus tard (au lieu de 60 s)
    const alive = phones.filter((p) => p.state.me.alive);
    const majority = Math.floor(alive.length / 2) + 1;
    const t0 = Date.now();
    await Promise.all(alive.slice(0, majority).map((p) => p.act({ type: 'checkIn' })));
    const g = await gm.waitState((s) => s.meeting?.stage === 'gather' && s.meeting.checkedInCount === majority);
    expect(g.meeting.stageEndsAt - g.now).toBeLessThanOrEqual(15_000);
    await gm.waitState((s) => s.meeting?.stage === 'voting', 20_000); // discussion = 0 → vote
    expect(Date.now() - t0).toBeLessThan(25_000);
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
    expect((await reloaded.act({ type: 'report', code: '0000' })).code).toBe('dead');
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
