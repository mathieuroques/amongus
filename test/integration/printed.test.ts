// Fiches imprimées avant de connaître la maison, de bout en bout contre le vrai serveur :
// préparation à l'avance, pose d'une partie des fiches, retrait des autres, partie jouée jusqu'à la victoire
// par les tâches, puis récupération des fiches dans une nouvelle partie avec le seul code de récupération.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleAnswer, countAnswer } from '../../src/shared/puzzles';
import { BLANK_CORE, blankTerrain, PLACEHOLDER_ROOM, removeUnplacedRooms, restorePrinted } from '../../src/shared/terrain';
import type { Terrain } from '../../src/shared/types';
import { createGame, Phone, sleep, startServer, stopServer } from './server';

const PRINTED = blankTerrain(30, 424242);
const POSTED = 12;
const PLAYERS = 10;
let gm: Phone;
const phones: Phone[] = [];
let installed: Terrain;

beforeAll(async () => {
  await startServer();
}, 90_000);

afterAll(async () => {
  for (const p of phones) p.close();
  gm?.close();
  await stopServer();
});

function solve(ch: any, def: any) {
  switch (ch.game) {
    case 'wires':
      return ch.params.left.map((c: number) => ch.params.right.indexOf(c));
    case 'sequence':
      return ch.params.seq;
    case 'slider':
      return ch.params.target;
    case 'count':
      return countAnswer(def.seed, ch.params.sym, ch.params.scope);
    case 'assemble':
      return assembleAnswer(def.seed, ch.params.line);
    default:
      return 'done';
  }
}

describe('fiches imprimées à l’avance, contre le vrai serveur', () => {
  it('avant de partir : le terrain provisoire est enregistré tel quel, la partie ne peut pas encore démarrer', async () => {
    const game = await createGame({ settings: { impostors: 2, initialKillCooldownSec: 600, killCooldownSec: 600, initialSabotageCooldownSec: 600 } });
    gm = await new Phone(game.code).open();
    await gm.hello(game.gmToken);
    expect((await gm.act({ type: 'terrain', terrain: PRINTED })).ok).toBe(true);
    await gm.waitState((s) => s.terrain.printCode === PRINTED.printCode);
    expect(gm.state.terrain).toEqual(PRINTED);
    for (let i = 0; i < PLAYERS; i++) {
      const p = await new Phone(game.code).open();
      expect((await p.join(`Invité ${i + 1}`)).t).toBe('token');
      phones.push(p);
    }
    await gm.waitState((s) => s.players.length === PLAYERS);
    const r = await gm.act({ type: 'start' });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/nom provisoire/);
  });

  it('sur place : 12 fiches posées sur 30, pièces renommées, fiches non posées retirées', async () => {
    const t: Terrain = JSON.parse(JSON.stringify(gm.state.terrain));
    // le MJ pose A à F et six autres fiches prises au hasard parmi G à AD
    const posted = [0, 1, 2, 3, 4, 5, 9, 13, 17, 22, 26, 29];
    expect(posted).toHaveLength(POSTED);
    posted.forEach((i, j) => Object.assign(t.rooms[i], { name: ['Salon', 'Cuisine', 'Bureau', 'Véranda', 'Chambre bleue', 'Chambre verte', 'Salle de jeux', 'Bibliothèque', 'Atelier', 'Grenier', 'Cave', 'Lingerie'][j], floor: j % 2 ? 'Étage' : 'RDC' }));
    t.rooms.push({ id: 'rescalier', name: 'Escalier', floor: '', forbidden: false, transit: true, hideAllowed: false, notes: '' });
    installed = removeUnplacedRooms(t);
    expect((await gm.act({ type: 'terrain', terrain: installed })).ok).toBe(true);
    const saved = await gm.waitState((s) => !s.terrain.rooms.some((x: any) => PLACEHOLDER_ROOM.test(x.name)));
    expect(saved.terrain).toEqual(installed);
    expect(saved.terrain.stations.filter((s: any) => s.kind === 'task')).toHaveLength(POSTED);
    expect((await gm.act({ type: 'start' })).ok).toBe(true);
    await Promise.all(phones.map((p) => p.waitState((s) => s.phase === 'playing')));
  });

  it('une fiche non posée n’existe pas pour le jeu ; les fiches posées fonctionnent', async () => {
    const kept = new Set(installed.stations.map((s) => s.code));
    const removed = PRINTED.stations.filter((s) => !kept.has(s.code));
    expect(removed).toHaveLength(30 - POSTED);
    for (const s of removed.slice(0, 5)) expect((await phones[0].act({ type: 'scan', code: s.code })).code).toBe('bad_code');
    for (const p of phones) {
      const json = JSON.stringify(p.state);
      expect(json).not.toMatch(/Pièce [A-Z]{1,2}\b/);
      for (const s of removed) expect(json).not.toContain(s.code);
      for (const k of p.state.me.tasks ?? []) expect(['Salon', 'Cuisine', 'Bureau', 'Véranda', 'Chambre bleue', 'Chambre verte', 'Salle de jeux', 'Bibliothèque', 'Atelier', 'Grenier', 'Cave', 'Lingerie']).toContain(k.next.roomName);
    }
    expect((await phones[0].act({ type: 'scan', code: installed.stations.find((s) => s.kind === 'task')!.code })).ok).toBe(true);
  });

  it('l’équipage termine toutes ses tâches sur les seules fiches posées et gagne', async () => {
    const roleOf = (p: Phone) => gm.state.players.find((x: any) => x.id === p.playerId).role;
    const crew = phones.filter((p) => roleOf(p) === 'crewmate');
    expect(crew.length).toBe(PLAYERS - 2);
    await Promise.all(
      crew.map(async (p) => {
        for (;;) {
          const mine = gm.state.players.find((x: any) => x.id === p.playerId).tasks.find((t: any) => !t.done);
          if (!mine || gm.state.phase !== 'playing') return;
          const def = gm.state.terrain.tasks.find((x: any) => x.id === mine.taskId);
          const st = gm.state.terrain.stations.find((s: any) => s.id === def.steps[mine.step].stationId);
          expect(installed.stations.some((s) => s.code === st.code)).toBe(true);
          const r = await p.act({ type: 'startTask', code: st.code, taskId: mine.taskId });
          expect(r.ok, r.msg).toBe(true);
          await sleep(r.data.minMs + 50);
          const done = await p.act({ type: 'submit', challengeId: r.data.id, answer: solve(r.data, def) });
          expect(done.ok, done.msg).toBe(true);
          await gm.waitState((s) => s.phase !== 'playing' || s.players.find((x: any) => x.id === p.playerId).tasks.find((t: any) => t.taskId === mine.taskId).step > mine.step);
        }
      }),
    );
    const end = await gm.waitState((s) => s.phase === 'ended');
    expect(end.end.winner).toBe('crew');
    expect(end.end.reason).toMatch(/tâches/);
  }, 240_000);

  it('nouvelle partie sur un autre appareil : le code de récupération seul remet toutes les fiches imprimées', async () => {
    const game = await createGame();
    const gm2 = await new Phone(game.code).open();
    await gm2.hello(game.gmToken);
    const restored = restorePrinted(gm2.state.terrain, PRINTED.printCode);
    expect((await gm2.act({ type: 'terrain', terrain: restored })).ok).toBe(true);
    const s = await gm2.waitState((x) => x.terrain.printCode === PRINTED.printCode);
    expect(s.terrain.stations.map((x: any) => x.code)).toEqual(PRINTED.stations.map((x) => x.code));
    // puis la même pose donne exactement le même terrain que la première fois
    const t = JSON.parse(JSON.stringify(s.terrain));
    for (const r of installed.rooms) {
      const i = t.rooms.findIndex((x: any) => x.id === r.id);
      if (i >= 0) t.rooms[i] = r;
      else t.rooms.push(r);
    }
    expect(removeUnplacedRooms(t)).toEqual({ ...installed, safetyNotes: t.safetyNotes });
    expect(BLANK_CORE).toBe(6);
    gm2.close();
  });
});
