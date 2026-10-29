// Kit de fiches universel, de bout en bout contre le vrai serveur : appairage des fiches pièce par pièce,
// manche jouée jusqu'à la victoire par les tâches (énigmes papier et scan compris), puis entre deux manches :
// fiches retirées, ajoutées dans une nouvelle pièce, joueurs partis et arrivés, imposteurs recalculés.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kitSheet, pairSheet } from '../../src/shared/kit';
import { assembleAnswer, countAnswer } from '../../src/shared/puzzles';
import { recommendedImpostors } from '../../src/shared/settings';
import { emptyTerrain } from '../../src/shared/terrain';
import type { Room, Terrain } from '../../src/shared/types';
import { createGame, Phone, sleep, startServer, stopServer } from './server';

let gm: Phone;
const phones: Phone[] = [];
const room = (id: string, name: string): Room => ({ id, name, floor: '', forbidden: false, transit: false, hideAllowed: true, notes: '' });
const ROOMS = ['Salon', 'Cuisine', 'Bureau', 'Grenier', 'Cave', 'Atelier', 'Chambre bleue', 'Chambre verte', 'Bibliothèque', 'Lingerie'].map((n, i) => room(`r${i}`, n));

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

/** Le MJ appaire une fiche : comme le téléphone du MJ, il envoie le terrain mis à jour (enregistré aussitôt). */
async function pair(sheetId: string, roomId?: string, newRoom?: Room) {
  const next: Terrain = pairSheet(gm.state.terrain, sheetId, roomId, newRoom);
  const r = await gm.act({ type: 'terrain', terrain: next });
  expect(r.ok, r.msg).toBe(true);
  const key = (t: Terrain) => t.stations.map((x) => `${x.id}@${x.roomId}`).join(',');
  return gm.waitState((s) => key(s.terrain) === key(next));
}

/** Chaque équipier fait toutes ses tâches, sur les seules fiches appairées ; l'équipage gagne. */
async function crewDoesAllTasks() {
  const paired = new Set(gm.state.terrain.stations.map((s: any) => s.code));
  const active = phones.filter((p) => gm.state.players.some((x: any) => x.id === p.playerId && x.role === 'crewmate'));
  await Promise.all(
    active.map(async (p) => {
      for (;;) {
        const mine = gm.state.players.find((x: any) => x.id === p.playerId).tasks.find((t: any) => !t.done);
        if (!mine || gm.state.phase !== 'playing') return;
        const def = gm.state.terrain.tasks.find((x: any) => x.id === mine.taskId);
        const st = gm.state.terrain.stations.find((s: any) => s.id === def.steps[mine.step].stationId);
        expect(paired.has(st.code)).toBe(true);
        const r = await p.act({ type: 'startTask', code: st.code, taskId: mine.taskId });
        expect(r.ok, r.msg).toBe(true);
        await sleep(r.data.minMs + 50);
        const done = await p.act({ type: 'submit', challengeId: r.data.id, answer: solve(r.data, def) });
        expect(done.ok, done.msg).toBe(true);
        await gm.waitState((s) => s.phase !== 'playing' || s.players.find((x: any) => x.id === p.playerId).tasks.find((t: any) => t.taskId === mine.taskId).step > mine.step);
      }
    }),
  );
  const end = await gm.waitState((s) => s.phase === 'ended', 20_000);
  expect(end.end.winner).toBe('crew');
}

async function join(name: string) {
  const p = await new Phone(gm.code).open();
  expect((await p.join(name)).t).toBe('token');
  phones.push(p);
  return p;
}

describe('kit de fiches universel, contre le vrai serveur', () => {
  it('nouvelle partie sans maison ; le MJ appaire 19 fiches dans 10 pièces, chacune enregistrée aussitôt', async () => {
    const game = await createGame({ settings: { initialKillCooldownSec: 600, killCooldownSec: 600, initialSabotageCooldownSec: 600, autoImpostors: true } });
    gm = await new Phone(game.code).open();
    await gm.hello(game.gmToken);
    // nouvelle partie : aucune maison par défaut
    expect(gm.state.terrain).toEqual(emptyTerrain());
    expect((await gm.act({ type: 'terrain', terrain: { ...emptyTerrain(), rooms: ROOMS } })).ok).toBe(true);
    await gm.waitState((s) => s.terrain.rooms.length === ROOMS.length);
    const plan: [string, string][] = [
      ['kurg', 'r0'], ['kradio', 'r0'], ['krea1', 'r1'], ['krea2', 'r3'], ['koxy1', 'r2'], ['koxy2', 'r4'], ['kener', 'r5'], ['kvie', 'r6'],
      ['k01', 'r1'], ['k02', 'r2'], ['k03', 'r3'], ['k04', 'r4'], ['k05', 'r5'], ['k06', 'r6'], ['k07', 'r7'], ['k08', 'r8'], ['k09', 'r9'], ['k10', 'r0'], ['k11', 'r7'],
    ];
    for (const [id, r] of plan) await pair(id, r);
    const t = gm.state.terrain;
    expect(t.stations).toHaveLength(19);
    expect(t.meetingRoomId).toBe('r0');
    for (const s of t.stations) expect(s.code).toBe(kitSheet(s.id)!.code);
    // toutes les tâches du kit existent (fiches 01 à 05 posées) et chaque fiche « Poste » en a au moins une
    expect(t.tasks).toHaveLength(36);
    for (const s of t.stations.filter((x: any) => x.kind === 'task')) expect(t.tasks.some((k: any) => k.steps.some((st: any) => st.stationId === s.id))).toBe(true);
  });

  it('10 joueurs, nombre d’imposteurs automatique ; une fiche du kit non appairée ne pénalise personne', async () => {
    for (let i = 0; i < 10; i++) await join(`Invité ${i + 1}`);
    expect((await gm.act({ type: 'start' })).ok).toBe(true);
    const s = await gm.waitState((x) => x.phase === 'playing');
    expect(s.settings.impostors).toBe(recommendedImpostors(10));
    const p = phones[0];
    for (let i = 0; i < 8; i++) {
      const r = await p.act({ type: 'scan', code: kitSheet('k25')!.code });
      expect(r.code).toBe('unused_sheet');
      expect(r.msg).toMatch(/ne sert pas dans cette partie/);
    }
    // jamais bloqué : une fiche appairée fonctionne aussitôt après
    expect((await p.act({ type: 'scan', code: kitSheet('k06')!.code })).ok).toBe(true);
    const log = await gm.waitState((x) => x.log.some((l: any) => /Poste 25.*pas appairée/.test(l.msg)));
    expect(log).toBeTruthy();
  });

  it('manche 1 : l’équipage termine toutes ses tâches (énigmes papier et scan médical compris) et gagne', async () => {
    await crewDoesAllTasks();
  }, 240_000);

  it('entre deux manches : 3 fiches retirées, 2 ajoutées dans une nouvelle pièce, 2 joueurs partis, 3 arrivés', async () => {
    expect((await gm.act({ type: 'newGame' })).ok).toBe(true);
    await gm.waitState((s) => s.phase === 'lobby');
    await pair('k09');
    await pair('k10');
    await pair('k05'); // plus de scan médical : la tâche n'existe plus
    await pair('k30', 'r10', room('r10', 'Véranda'));
    await pair('k31', 'r10');
    const t = gm.state.terrain;
    expect(t.rooms.some((r: any) => r.name === 'Véranda')).toBe(true);
    expect(t.tasks.some((k: any) => k.name === 'Scan médical')).toBe(false);
    expect(t.stations.map((s: any) => s.id)).not.toContain('k09');
    for (const p of phones.slice(0, 2)) {
      expect((await gm.act({ type: 'kick', playerId: p.playerId })).ok).toBe(true);
      p.close();
    }
    phones.splice(0, 2);
    for (let i = 0; i < 3; i++) await join(`Nouveau ${i + 1}`);
    await gm.waitState((s) => s.players.filter((x: any) => !x.kicked && !x.left).length === 11);
  });

  it('manche 2 : imposteurs recalculés, tâches seulement sur les fiches appairées, l’équipage gagne encore', async () => {
    expect((await gm.act({ type: 'start' })).ok).toBe(true);
    const s = await gm.waitState((x) => x.phase === 'playing');
    expect(s.settings.impostors).toBe(recommendedImpostors(11));
    for (const id of ['k09', 'k10', 'k05']) expect((await phones[0].act({ type: 'scan', code: kitSheet(id)!.code })).code).toBe('unused_sheet');
    for (const p of phones) {
      const json = JSON.stringify(p.state);
      for (const id of ['k09', 'k10', 'k05']) expect(json).not.toContain(kitSheet(id)!.code);
    }
    await crewDoesAllTasks();
  }, 240_000);
});
