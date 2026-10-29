// Fiches imprimées avant de connaître la maison : génération figée par le code de récupération,
// pose sur place d'une partie seulement des fiches, retrait des autres, récupération.
// On vérifie qu'à aucun moment le jeu ne mentionne une fiche non posée ni ne contredit une fiche posée.
import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/shared/catalog';
import { addPlayer, createGame, gmAction } from '../src/shared/engine';
import { seededRng, type Rng } from '../src/shared/rng';
import { DEFAULT_SETTINGS, maxImpostorsFor } from '../src/shared/settings';
import {
  availableSabotages, BLANK_CORE, BLANK_MAX, blankTerrain, isFixedGame, makePrintCode, parsePrintCode, PLACEHOLDER_ROOM, removeUnplacedRooms, restorePrinted, sanitizeTerrain, startProblems,
  terrainWarnings,
} from '../src/shared/terrain';
import type { Room, Settings, Terrain } from '../src/shared/types';
import { viewForGm, viewForPlayer } from '../src/shared/view';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const letterOf = (t: Terrain, roomId: string) => t.rooms.find((r) => r.id === roomId)!.name.replace('Pièce ', '');
const PRESETS: Partial<Settings>[] = [
  { commonTasks: 1, longTasks: 1, shortTasks: 2 },
  { commonTasks: 1, longTasks: 1, shortTasks: 3 },
  { commonTasks: 1, longTasks: 2, shortTasks: 3 },
  { commonTasks: 2, longTasks: 3, shortTasks: 5 },
];

/** Ce que fait le MJ sur place : pose `posted` fiches (A à F comprises), renomme leurs pièces, ajoute escalier et zone interdite. */
function install(printed: Terrain, r: Rng, opts: { posted: number[]; merge?: boolean; moveSpecial?: boolean }) {
  const t = clone(printed);
  opts.posted.forEach((i, j) => Object.assign(t.rooms[i], { name: `Pièce réelle ${j + 1}`, floor: j % 3 ? 'Étage' : 'Rez-de-chaussée' }));
  const extra: Room[] = [
    { id: 'rescalier', name: 'Escalier', floor: '', forbidden: false, transit: true, hideAllowed: false, notes: '' },
    { id: 'rinterdite', name: 'Chambre des parents', floor: 'Étage', forbidden: true, transit: false, hideAllowed: false, notes: '' },
  ];
  t.rooms.push(...extra);
  const optional = opts.posted.filter((i) => i >= BLANK_CORE);
  if (opts.merge && optional.length) {
    // deux fiches dans une grande pièce : le poste est rattaché à une pièce déjà renommée, sa pièce provisoire reste
    const i = optional[r.int(optional.length)];
    const st = t.stations.find((s) => s.kind === 'task' && s.roomId === t.rooms[i].id)!;
    st.roomId = t.rooms[opts.posted.filter((x) => x !== i)[r.int(opts.posted.length - 1)]].id;
    t.rooms[i].name = printed.rooms[i].name;
  }
  if (opts.moveSpecial) {
    // une fiche spéciale posée ailleurs que prévu : le MJ corrige sa pièce dans la liste des postes
    const renamed = t.rooms.filter((x) => !PLACEHOLDER_ROOM.test(x.name) && !x.forbidden && !x.transit);
    t.stations.find((s) => s.kind === 'reactor')!.roomId = renamed[r.int(renamed.length)].id;
  }
  return t;
}

/** Tous les invariants d'un terrain prêt à jouer issu de fiches imprimées. */
function checkReady(printed: Terrain, out: Terrain, players: number[]) {
  // aucune trace des fiches non posées
  expect(out.rooms.some((r) => PLACEHOLDER_ROOM.test(r.name))).toBe(false);
  for (const s of out.stations) expect(printed.stations).toContainEqual({ ...s, roomId: expect.any(String) });
  for (const k of out.tasks) for (const st of k.steps) expect(out.stations.find((s) => s.id === st.stationId)?.kind).toBe('task');
  // le serveur accepte le terrain tel quel
  expect(sanitizeTerrain(clone(out))).toEqual(out);
  // chaque fiche posée a au moins une tâche ; tous les sabotages restent possibles
  for (const s of out.stations.filter((x) => x.kind === 'task')) expect(out.tasks.some((k) => k.enabled && k.steps.some((st) => st.stationId === s.id))).toBe(true);
  expect(availableSabotages(out)).toEqual(['reactor', 'oxygen', 'lights', 'comms']);
  // une énigme imprimée ou une croix au sol reste exactement là où la fiche l'annonce
  for (const k of out.tasks)
    k.steps.forEach((st, i) => {
      const orig = printed.tasks.find((x) => x.id === k.id)!.steps[i];
      expect(st.game).toBe(orig.game);
      if (isFixedGame(st.game)) expect(st).toEqual(orig);
    });
  for (const n of players)
    for (const preset of PRESETS) {
      const settings = { ...DEFAULT_SETTINGS, ...preset, impostors: Math.max(1, Math.min(3, maxImpostorsFor(n))) };
      expect(startProblems(out, settings, n)).toEqual([]);
    }
}

describe('code de récupération', () => {
  it('aller-retour exact, saisie tolérante, codes invalides refusés', () => {
    const r = seededRng(1);
    for (let i = 0; i < 2000; i++) {
      const count = 1 + r.int(BLANK_MAX);
      const seed = r.int(31 ** 6);
      const code = makePrintCode(count, seed);
      expect(code).toMatch(/^\d{1,2}-[A-Z2-9]{6}$/);
      expect(parsePrintCode(code)).toEqual({ count, seed });
      expect(parsePrintCode(` ${code.toLowerCase().replace('-', ' ')} `)).toEqual({ count, seed });
      expect(parsePrintCode(code.replace('-', ''))).toEqual({ count, seed });
    }
    for (const bad of ['', '30', '30-ABCDE', '30-ABCDEFG', '0-ABCDEF', '41-ABCDEF', '30-ABCDE1', '30-ABCDEI', '30-ABCDEO', 'XX-ABCDEF', undefined as any, null as any])
      expect(parsePrintCode(bad)).toBeUndefined();
  });

  it('un même code recrée toujours exactement les mêmes fiches (génération figée)', () => {
    for (let i = 0; i < 50; i++) {
      const t = blankTerrain(1 + (i % BLANK_MAX));
      const p = parsePrintCode(t.printCode!)!;
      expect(blankTerrain(p.count, p.seed)).toEqual(t);
    }
    // si ce test échoue, des fiches déjà imprimées ne fonctionneraient plus : ne changez pas la génération
    const t = blankTerrain(30, 123456);
    expect(t.printCode).toBe('30-AAEERR');
    expect({ codes: t.stations.map((s) => `${s.name}:${s.code}:${letterOf(t, s.roomId)}`), tasks: t.tasks.map((k) => `${k.name}:${k.seed}:${k.steps.map((st) => `${letterOf(t, t.stations.find((s) => s.id === st.stationId)!.roomId)}/${st.game}`).join(',')}`) }).toMatchSnapshot();
  });
});

describe('fiches imprimées : génération', () => {
  it('de 1 à 40 fiches : terrain valide, aucune fiche sans tâche, tout ce qui dépend de la fiche est sur A à F', () => {
    for (let n = 1; n <= BLANK_MAX; n++)
      for (let seed = 0; seed < 25; seed++) {
        const t = blankTerrain(n, seed * 7919 + n);
        expect(sanitizeTerrain(clone(t))).toEqual(t);
        expect(t.rooms).toHaveLength(n);
        expect(new Set(t.stations.map((s) => s.code)).size).toBe(t.stations.length);
        const tasksSt = t.stations.filter((s) => s.kind === 'task');
        expect(tasksSt.map((s) => s.name)).toEqual(t.rooms.map((r) => r.name.replace('Pièce', 'Poste')));
        for (const s of tasksSt) expect(t.tasks.some((k) => k.steps.some((st) => st.stationId === s.id))).toBe(true);
        const core = new Set(t.rooms.slice(0, BLANK_CORE).map((r) => r.id));
        for (const s of t.stations.filter((x) => x.kind !== 'task')) expect(core.has(s.roomId)).toBe(true);
        expect(t.stations.find((s) => s.kind === 'emergency')!.roomId).toBe(t.meetingRoomId);
        expect(t.meetingRoomId).toBe(t.rooms[0].id);
        if (n >= BLANK_CORE) {
          const [ra, rb] = t.stations.filter((s) => s.kind === 'reactor');
          const [oa, ob] = t.stations.filter((s) => s.kind === 'oxygen');
          expect(ra.roomId).not.toBe(rb.roomId);
          expect(oa.roomId).not.toBe(ob.roomId);
          for (const s of t.stations.filter((x) => x.kind !== 'task' && x.kind !== 'emergency')) expect(s.roomId).not.toBe(t.meetingRoomId);
        }
        for (const k of t.tasks) {
          if (k.steps.length > 1 && n > 1) expect(new Set(k.steps.map((st) => st.stationId)).size).toBe(k.steps.length);
          for (const st of k.steps) if (isFixedGame(st.game)) expect(core.has(t.stations.find((s) => s.id === st.stationId)!.roomId)).toBe(true);
        }
        // tant que les pièces sont provisoires, la partie ne peut pas démarrer
        expect(startProblems(t, DEFAULT_SETTINGS, 10).some((p) => /nom provisoire/.test(p))).toBe(true);
        if (n > 1) expect(terrainWarnings(t)).toEqual([]);
      }
  });

  it('chaque mini-jeu des tâches existe et les noms de tâches sont uniques', () => {
    const t = blankTerrain(40, 1);
    expect(new Set(t.tasks.map((k) => k.name)).size).toBe(t.tasks.length);
    for (const k of t.tasks) for (const st of k.steps) expect(GAMES[st.game]).toBeDefined();
    expect(t.tasks.reduce((n, k) => n + k.steps.length, 0)).toBeGreaterThanOrEqual(BLANK_MAX);
  });
});

describe('fiches imprimées : pose sur place et retrait des fiches non posées', () => {
  it('toutes les combinaisons réalistes (10 à 40 fiches imprimées, 6 à toutes posées, dans le désordre)', () => {
    const r = seededRng(42);
    let cases = 0;
    for (let n = 10; n <= BLANK_MAX; n++)
      for (let trial = 0; trial < 12; trial++) {
        const printed = blankTerrain(n, r.int(31 ** 6));
        const count = BLANK_CORE + r.int(n - BLANK_CORE + 1);
        const others = Array.from({ length: n - BLANK_CORE }, (_, i) => i + BLANK_CORE).sort(() => r.int(3) - 1);
        const posted = [...Array.from({ length: BLANK_CORE }, (_, i) => i), ...others.slice(0, count - BLANK_CORE)].sort(() => r.int(3) - 1);
        const merge = trial % 4 === 1;
        const onSite = install(printed, r, { posted, merge, moveSpecial: trial % 3 === 2 });
        const out = removeUnplacedRooms(onSite);
        checkReady(printed, out, [4, 10, 20, 30, 40]);
        const keptRooms = out.rooms.filter((x) => !x.forbidden && !x.transit);
        expect(keptRooms).toHaveLength(merge && count > BLANK_CORE ? count - 1 : count);
        expect(out.stations.filter((s) => s.kind === 'task')).toHaveLength(count);
        // les tâches longues gardent leurs étapes dans des pièces différentes (sauf deux fiches que le MJ a mises dans la même pièce)
        if (!merge) expect(terrainWarnings(out)).toEqual([]);
        else for (const w of terrainWarnings(out)) expect(w).toMatch(/plusieurs étapes dans la même pièce/);
        // retirer deux fois ne change rien
        expect(removeUnplacedRooms(out)).toEqual(out);
        // « Remettre les fiches retirées » puis retirer à nouveau : on retrouve exactement le même terrain
        const restored = restorePrinted(out);
        expect(restored.stations.map((s) => s.code).sort()).toEqual(printed.stations.map((s) => s.code).sort());
        for (const room of out.rooms) expect(restored.rooms).toContainEqual(room);
        expect(sanitizeTerrain(clone(restored))).toEqual(restored);
        expect(removeUnplacedRooms(restored)).toEqual(out);
        cases++;
      }
    expect(cases).toBe(31 * 12);
  });

  it('les fiches A à F sont indispensables : message clair si l’une manque, rien n’est retiré', () => {
    const printed = blankTerrain(20, 99);
    for (let missing = 0; missing < BLANK_CORE; missing++) {
      const posted = Array.from({ length: 12 }, (_, i) => i).filter((i) => i !== missing);
      const onSite = install(printed, seededRng(missing), { posted });
      if (missing === 0) {
        // la fiche A ne porte que le bouton d'urgence
        expect(() => removeUnplacedRooms(onSite)).toThrow(/Bouton d’urgence/);
      } else expect(() => removeUnplacedRooms(onSite)).toThrow(/indispensables/);
    }
    // aucune pièce renommée
    expect(() => removeUnplacedRooms({ ...printed, stations: printed.stations.filter((s) => s.kind === 'task') })).toThrow(/Aucun poste/);
  });

  it('une fiche spéciale posée hors de A à F est acceptée si le MJ indique sa pièce', () => {
    const printed = blankTerrain(15, 5);
    const onSite = install(printed, seededRng(1), { posted: [0, 1, 2, 3, 4, 5, 6, 7] });
    // la fiche F n'est pas posée, ses fiches spéciales sont mises dans la pièce G
    const f = printed.rooms[5].id;
    const fTask = onSite.stations.find((s) => s.kind === 'task' && s.roomId === f)!;
    onSite.rooms[5].name = printed.rooms[5].name;
    for (const s of onSite.stations) if (s.roomId === f && s.kind !== 'task') s.roomId = onSite.rooms[6].id;
    const out = removeUnplacedRooms(onSite);
    expect(out.stations.some((s) => s.id === fTask.id)).toBe(false);
    expect(sanitizeTerrain(clone(out))).toEqual(out);
    // une tâche dont l'énigme ou la croix est sur la fiche F non posée n'existe plus ; les autres tâches sont intactes
    for (const k of printed.tasks) {
      const onF = k.steps.some((st) => st.stationId === fTask.id && isFixedGame(st.game));
      expect(out.tasks.some((x) => x.id === k.id)).toBe(!onF);
    }
    for (const s of out.stations.filter((x) => x.kind === 'task')) expect(out.tasks.some((k) => k.enabled && k.steps.some((st) => st.stationId === s.id))).toBe(true);
  });

  it('récupération sur un autre appareil ou une nouvelle partie : le code seul suffit', () => {
    const printed = blankTerrain(30, 777);
    const other = blankTerrain(12, 1);
    expect(restorePrinted(other, printed.printCode)).toEqual({ ...printed, safetyNotes: other.safetyNotes });
    expect(() => restorePrinted(other, '30-IIIIII')).toThrow(/invalide/);
    // pièce provisoire transformée en zone interdite : ses fiches reviennent dans une pièce provisoire, la zone reste interdite
    const t = clone(printed);
    Object.assign(t.rooms[20], { name: 'Garage', forbidden: true });
    t.stations = t.stations.filter((s) => s.roomId !== t.rooms[20].id);
    const back = restorePrinted(t);
    expect(back.rooms.find((x) => x.id === t.rooms[20].id)).toMatchObject({ name: 'Garage', forbidden: true });
    expect(sanitizeTerrain(clone(back))).toEqual(back);
    expect(back.stations).toHaveLength(printed.stations.length);
  });
});

describe('fiches imprimées : partie réelle sur le terrain obtenu', () => {
  it('chaque joueur ne reçoit que des tâches sur des fiches posées, et le jeu ne cite que des pièces réelles', () => {
    const r = seededRng(8);
    for (let trial = 0; trial < 40; trial++) {
      const n = 10 + r.int(31);
      const printed = blankTerrain(n, r.int(31 ** 6));
      const count = BLANK_CORE + r.int(n - BLANK_CORE + 1);
      const posted = Array.from({ length: count }, (_, i) => i);
      const terrain = removeUnplacedRooms(install(printed, r, { posted }));
      const players = 4 + r.int(37);
      const s = createGame('BCDFGH', 'gm', 'sec', 1_000_000, { maxPlayers: 40, impostors: Math.max(1, Math.min(3, maxImpostorsFor(players))), ...PRESETS[trial % PRESETS.length] }, terrain);
      for (let i = 0; i < players; i++) addPlayer(s, `Joueur ${i + 1}`, `tok${i}`, 1_000_000);
      gmAction(s, { type: 'start' }, { now: 1_000_000, rng: r });
      expect(s.phase).toBe('playing');
      const postedCodes = new Set(terrain.stations.map((x) => x.code));
      const removedCodes = printed.stations.filter((x) => !postedCodes.has(x.code)).map((x) => x.code);
      for (const p of s.players) {
        if (p.role === 'crewmate') expect(p.tasks.length).toBeGreaterThan(0);
        for (const a of p.tasks) {
          const def = s.terrain.tasks.find((k) => k.id === a.taskId)!;
          for (const st of def.steps) expect(postedCodes.has(s.terrain.stations.find((x) => x.id === st.stationId)!.code)).toBe(true);
        }
        const json = JSON.stringify(viewForPlayer(s, p.id, 1_000_000));
        expect(json).not.toMatch(/Pièce [A-Z]{1,2}\b/);
        for (const c of removedCodes) expect(json).not.toContain(`"${c}"`);
      }
      expect(JSON.stringify(viewForGm(s, 1_000_000, new Set()))).not.toMatch(/"Pièce [A-Z]{1,2}"/);
    }
  });
});
