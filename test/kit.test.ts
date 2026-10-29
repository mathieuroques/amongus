// Kit de fiches universel : fiches figées pour toujours, appairage avec les pièces, tâches recalculées,
// changements de fiches et de joueurs entre deux manches. Une fiche non appairée n'existe pas pour le jeu.
import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/shared/catalog';
import { addPlayer, createGame, gmAction, GameError, playerAction } from '../src/shared/engine';
import { KIT_SHEETS, KIT_TASK_SHEETS, KIT_TASKS, kitSheet, kitSheetByCode, kitSheetExtras, kitTasks, pairSheet } from '../src/shared/kit';
import { CODE_ALPHABET, normalizeCode, seededRng, type Rng } from '../src/shared/rng';
import { DEFAULT_SETTINGS, maxImpostorsFor, recommendedImpostors, sanitizeSettings, startSettings } from '../src/shared/settings';
import { availableSabotages, emptyTerrain, sanitizeTerrain, startProblems, terrainWarnings } from '../src/shared/terrain';
import type { Room, Settings, Terrain } from '../src/shared/types';
import { viewForGm, viewForPlayer } from '../src/shared/view';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const PRESETS: Partial<Settings>[] = [
  { commonTasks: 1, longTasks: 1, shortTasks: 2 },
  { commonTasks: 1, longTasks: 1, shortTasks: 3 },
  { commonTasks: 1, longTasks: 2, shortTasks: 3 },
];
const room = (id: string, name: string, extra: Partial<Room> = {}): Room => ({ id, name, floor: '', forbidden: false, transit: false, hideAllowed: true, notes: '', ...extra });
const SPECIALS = KIT_SHEETS.filter((k) => k.kind !== 'task');
const POSTS = KIT_SHEETS.filter((k) => k.kind === 'task');

/** Une maison au hasard (pièces jouables, escalier, zone interdite) et une pose au hasard d'une partie des fiches. */
function randomInstall(r: Rng, opts: { withSpecials?: boolean } = {}) {
  const nRooms = 1 + r.int(30);
  let t: Terrain = { ...emptyTerrain(), rooms: [...Array.from({ length: nRooms }, (_, i) => room(`r${i}`, `Pièce réelle ${i + 1}`, { floor: i % 2 ? 'Étage' : 'RDC' })), room('rstairs', 'Escalier', { transit: true }), room('rno', 'Parents', { forbidden: true })] };
  const posts = POSTS.filter(() => r.int(3) > 0).slice(0, 1 + r.int(KIT_TASK_SHEETS));
  for (const k of posts.length ? posts : [POSTS[r.int(POSTS.length)]]) t = pairSheet(t, k.id, `r${r.int(nRooms)}`);
  if (opts.withSpecials !== false) for (const k of SPECIALS) if (k.kind === 'emergency' || r.int(4) > 0) t = pairSheet(t, k.id, `r${r.int(nRooms)}`);
  return t;
}

describe('kit : fiches figées', () => {
  it('48 fiches, codes uniques, valides, jamais confondus avec un code de corps (4 chiffres)', () => {
    expect(KIT_SHEETS).toHaveLength(48);
    expect(POSTS).toHaveLength(KIT_TASK_SHEETS);
    expect(new Set(KIT_SHEETS.map((k) => k.code)).size).toBe(48);
    expect(new Set(KIT_SHEETS.map((k) => k.id)).size).toBe(48);
    for (const k of KIT_SHEETS) {
      expect(k.code).toMatch(/^[A-Z2-9]{4}$/);
      expect([...k.code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
      expect(k.code).not.toMatch(/^\d{4}$/);
      expect(normalizeCode(k.code.toLowerCase())).toBe(k.code);
      expect(kitSheetByCode(k.code)).toBe(k);
      expect(kitSheet(k.id)).toBe(k);
    }
    expect(SPECIALS.map((k) => k.kind).sort()).toEqual(['comms', 'emergency', 'lights', 'oxygen', 'oxygen', 'reactor', 'reactor', 'vitals']);
  });

  it('valeurs figées : si ce test échoue, des fiches déjà imprimées ne fonctionneraient plus', () => {
    expect({ sheets: KIT_SHEETS.map((k) => `${k.id}:${k.name}:${k.kind}:${k.code}`), tasks: KIT_TASKS.map((k) => `${k.id}:${k.name}:${k.type}:${k.seed}:${k.steps.map((s) => s.game + (s.sheet ? '@' + s.sheet : '')).join(',')}`) }).toMatchSnapshot();
  });

  it('énigmes papier et scan médical : chacun sur sa fiche attitrée (01 à 05), les autres fiches n’ont rien à préparer', () => {
    expect(kitSheetExtras('k01').map((x) => x.game)).toEqual(['count']);
    expect(kitSheetExtras('k02').map((x) => x.game)).toEqual(['assemble']);
    expect(kitSheetExtras('k03').map((x) => x.game)).toEqual(['count']);
    expect(kitSheetExtras('k04').map((x) => x.game)).toEqual(['assemble']);
    expect(kitSheetExtras('k05').map((x) => x.game)).toEqual(['scan']);
    for (const k of KIT_SHEETS.slice(5)) expect(kitSheetExtras(k.id)).toEqual([]);
    // même graine pour les deux étapes de l'énigme du coffre (grille et bandes imprimées ensemble)
    expect(kitSheetExtras('k03')[0].seed).toBe(kitSheetExtras('k04')[0].seed);
    // aucune autre tâche n'utilise de papier ni de croix au sol
    for (const k of KIT_TASKS) for (const st of k.steps) if (GAMES[st.game].paper || st.game === 'scan') expect(st.sheet).toBeDefined();
    expect(new Set(KIT_TASKS.map((k) => k.name)).size).toBe(KIT_TASKS.length);
    expect(KIT_TASKS.reduce((n, k) => n + k.steps.length, 0)).toBe(KIT_TASK_SHEETS);
  });
});

describe('kit : appairage et tâches', () => {
  it('2 000 maisons et poses au hasard : terrain identique côté téléphone du MJ et côté serveur, aucune fiche non appairée nulle part', () => {
    const r = seededRng(2024);
    for (let i = 0; i < 2000; i++) {
      const t = randomInstall(r);
      const server = sanitizeTerrain(clone({ ...t, tasks: [{ id: 'triche', name: 'x', type: 'short', steps: [{ stationId: 'k01', game: 'wires' }] }] }));
      expect(server).toEqual(t);
      expect(sanitizeTerrain(clone(server))).toEqual(server);
      const paired = new Set(t.stations.map((s) => s.id));
      for (const k of t.tasks) for (const st of k.steps) expect(paired.has(st.stationId) && t.stations.find((s) => s.id === st.stationId)!.kind === 'task').toBe(true);
      // chaque fiche « Poste » appairée a au moins une tâche
      for (const s of t.stations.filter((x) => x.kind === 'task')) expect(t.tasks.some((k) => k.steps.some((st) => st.stationId === s.id))).toBe(true);
      // une tâche liée à une fiche (énigme, croix) n'existe que si cette fiche est posée, et y reste
      for (const kt of KIT_TASKS) {
        const fixed = kt.steps.filter((st) => st.sheet);
        const present = t.tasks.find((k) => k.id === kt.id);
        expect(!!present).toBe(fixed.every((st) => paired.has(st.sheet!)));
        if (present) kt.steps.forEach((st, j) => st.sheet && expect(present.steps[j].stationId).toBe(st.sheet));
        if (present) expect(present.steps.map((x) => x.game)).toEqual(kt.steps.map((x) => x.game));
      }
      // tâches longues dans deux pièces différentes dès qu'il y a deux pièces avec une fiche
      const roomsWithPosts = new Set(t.stations.filter((s) => s.kind === 'task').map((s) => s.roomId));
      const free = (id: string) => KIT_TASKS.find((x) => x.id === id)!.steps.every((st) => !st.sheet);
      if (roomsWithPosts.size > 1)
        for (const k of t.tasks.filter((x) => x.steps.length > 1 && free(x.id))) expect(new Set(k.steps.map((st) => t.stations.find((s) => s.id === st.stationId)!.roomId)).size).toBe(k.steps.length);
      // le jeu démarre dès que le bouton d'urgence et une fiche sont appairés, pour 4 à 40 joueurs et chaque préréglage
      for (const n of [4, 12, 25, 40])
        for (const preset of PRESETS) expect(startProblems(t, startSettings({ ...DEFAULT_SETTINGS, ...preset, autoImpostors: true }, n), n)).toEqual([]);
      expect(t.meetingRoomId).toBe(t.stations.find((s) => s.kind === 'emergency')!.roomId);
    }
  }, 120_000);

  it('toutes les fiches posées, une par pièce : chacune a exactement une tâche, aucun conseil', () => {
    let t: Terrain = { ...emptyTerrain(), rooms: Array.from({ length: 48 }, (_, i) => room(`r${i}`, `Salle ${i + 1}`)) };
    KIT_SHEETS.forEach((k, i) => (t = pairSheet(t, k.id, `r${i}`)));
    for (const s of t.stations.filter((x) => x.kind === 'task')) expect(t.tasks.flatMap((k) => k.steps).filter((st) => st.stationId === s.id)).toHaveLength(1);
    expect(availableSabotages(t)).toEqual(['reactor', 'oxygen', 'lights', 'comms']);
    expect(terrainWarnings(t)).toEqual([]);
    expect(t.tasks).toHaveLength(KIT_TASKS.length);
  });

  it('nouvelle partie : aucune maison par défaut, même avec un terrain reçu illisible', () => {
    for (const terrain of [undefined, null, 'x', { rooms: 'x' }, { rooms: [{ id: 'a' }, { id: 'a' }] }]) {
      const s = createGame('BCDFGH', 'gm', 'sec', 1000, {}, terrain);
      expect(s.terrain).toEqual(emptyTerrain());
    }
    // une maison reçue (« Reprendre cette maison ») : seules les fiches du kit sont gardées
    const s = createGame('BCDFGH', 'gm', 'sec', 1000, {}, { rooms: [room('a', 'Salon')], stations: [{ id: 'kurg', roomId: 'a' }, { id: 'perso', roomId: 'a', code: 'ZZZZ' }] });
    expect(s.terrain.stations.map((x) => x.id)).toEqual(['kurg']);
  });

  it('ce qui manque est dit clairement', () => {
    const empty = emptyTerrain();
    const p = startProblems(empty, DEFAULT_SETTINGS, 10);
    expect(p).toContain('Appairez au moins une fiche « Poste » (onglet Terrain).');
    expect(p).toContain('Appairez la fiche « Bouton d’urgence » (onglet Terrain).');
    let t: Terrain = { ...empty, rooms: [room('a', 'Salon'), room('b', 'Cuisine')] };
    t = pairSheet(pairSheet(pairSheet(t, 'kurg', 'a'), 'k10', 'b'), 'krea1', 'a');
    t = pairSheet(t, 'krea2', 'a');
    expect(terrainWarnings(t)).toContain('Les fiches Réacteur sont dans la même pièce : le sabotage est trop facile à réparer, éloignez-les.');
    expect(terrainWarnings(t).some((w) => /Oxygène appairées : le sabotage « Fuite d’oxygène » est désactivé/.test(w))).toBe(true);
  });

  it('le serveur impose les fiches du kit : codes et noms non modifiables, doublons ignorés, zones interdites refusées', () => {
    const base: Terrain = { ...emptyTerrain(), rooms: [room('a', 'Salon'), room('x', 'Garage', { forbidden: true })] };
    const out = sanitizeTerrain({ ...base, stations: [{ id: 'k07', name: 'Triche', code: 'AAAA', kind: 'emergency', roomId: 'a' }, { id: 'k07', roomId: 'a' }, { id: 'inconnue', roomId: 'a' }] });
    expect(out.stations).toEqual([{ id: 'k07', name: 'Poste 07', code: kitSheet('k07')!.code, kind: 'task', roomId: 'a' }]);
    expect(() => sanitizeTerrain({ ...base, stations: [{ id: 'k07', roomId: 'x' }] })).toThrow(/zone interdite/);
    expect(() => sanitizeTerrain({ ...base, stations: [{ id: 'k07', roomId: 'nulle-part' }] })).toThrow(/aucune pièce/);
  });

  it('la salle de réunion suit le bouton d’urgence, sauf si le MJ en a choisi une autre', () => {
    let t: Terrain = { ...emptyTerrain(), rooms: [room('a', 'Salon'), room('b', 'Cuisine'), room('c', 'Bureau')] };
    t = pairSheet(t, 'kurg', 'b');
    expect(t.meetingRoomId).toBe('b');
    t = pairSheet(t, 'kurg', 'c');
    expect(t.meetingRoomId).toBe('c');
    t = { ...t, meetingRoomId: 'a' };
    t = pairSheet(t, 'kurg', 'b');
    expect(t.meetingRoomId).toBe('a');
  });

  it('changer les fiches à la volée : 500 suites d’appairages, déplacements et retraits restent toujours cohérentes', () => {
    const r = seededRng(77);
    let t: Terrain = { ...emptyTerrain(), rooms: Array.from({ length: 12 }, (_, i) => room(`r${i}`, `Salle ${i + 1}`)) };
    for (let i = 0; i < 500; i++) {
      const k = KIT_SHEETS[r.int(KIT_SHEETS.length)];
      t = r.int(4) === 0 ? pairSheet(t, k.id) : pairSheet(t, k.id, `r${r.int(12)}`);
      expect(sanitizeTerrain(clone(t))).toEqual(t);
      expect(t.tasks).toEqual(kitTasks(t.stations, t.rooms));
    }
  });
});

describe('kit : partie réelle, changements entre deux manches', () => {
  const ctx = (now: number) => ({ now, rng: seededRng(now) });

  it('fiche du kit non appairée : message clair, signalée au MJ, jamais comptée comme code erroné', () => {
    let t: Terrain = { ...emptyTerrain(), rooms: [room('a', 'Salon'), room('b', 'Cuisine')] };
    t = pairSheet(pairSheet(pairSheet(t, 'kurg', 'a'), 'k10', 'a'), 'k11', 'b');
    const s = createGame('BCDFGH', 'gm', 'sec', 1000, { impostors: 1 }, t);
    for (let i = 0; i < 5; i++) addPlayer(s, `J${i}`, `t${i}`, 1000);
    gmAction(s, { type: 'start' }, ctx(1000));
    const p = s.players[0];
    for (let i = 0; i < 10; i++) {
      for (const a of [{ type: 'scan', code: kitSheet('k12')!.code }, { type: 'callEmergency', code: kitSheet('k12')!.code }, { type: 'fixStart', code: kitSheet('krea1')!.code }] as const) {
        try {
          playerAction(s, p.id, a as any, ctx(2000 + i));
          throw new Error('accepté à tort');
        } catch (e) {
          expect(e).toBeInstanceOf(GameError);
          expect((e as GameError).code).toBe('unused_sheet');
        }
      }
    }
    expect(p.failures).toEqual([]);
    expect(p.blockedUntil).toBe(0);
    expect(viewForGm(s, 3000, new Set()).log.some((l: any) => /Poste 12.*pas appairée/.test(l.msg))).toBe(true);
    // un code qui n'est pas une fiche du kit reste un code erroné
    expect(() => playerAction(s, p.id, { type: 'scan', code: 'QQQQ' }, ctx(3000))).toThrow();
    expect(p.failures).toHaveLength(1);
    // une fiche appairée fonctionne
    expect(() => playerAction(s, p.id, { type: 'scan', code: kitSheet('k10')!.code }, ctx(3001))).not.toThrow();
  });

  it('entre deux manches : fiches ajoutées, déplacées, retirées, joueurs qui partent et arrivent, imposteurs automatiques', () => {
    const r = seededRng(5);
    let t: Terrain = { ...emptyTerrain(), rooms: Array.from({ length: 15 }, (_, i) => room(`r${i}`, `Salle ${i + 1}`)) };
    for (const k of KIT_SHEETS.slice(0, 20)) t = pairSheet(t, k.id, `r${r.int(15)}`);
    t = pairSheet(t, 'kurg', 'r0');
    const s = createGame('BCDFGH', 'gm', 'sec', 1000, { autoImpostors: true, impostors: 9 }, t);
    let now = 1000;
    let next = 0;
    const join = (n: number) => {
      for (let i = 0; i < n; i++) addPlayer(s, `Invité ${next++}`, `tok${next}`, now);
    };
    join(6);
    for (let round = 0; round < 12; round++) {
      const present = s.players.filter((p) => !p.kicked && !p.left).length;
      gmAction(s, { type: 'start' }, ctx(now));
      expect(s.phase).toBe('playing');
      expect(s.settings.impostors).toBe(Math.max(1, Math.min(maxImpostorsFor(present), recommendedImpostors(present))));
      expect(s.players.filter((p) => p.role === 'impostor')).toHaveLength(s.settings.impostors);
      const codes = new Set(s.terrain.stations.map((x) => x.id));
      for (const p of s.players.filter((x) => x.role))
        for (const a of p.tasks) for (const st of s.terrain.tasks.find((k) => k.id === a.taskId)!.steps) expect(codes.has(st.stationId)).toBe(true);
      for (const p of s.players.filter((x) => x.role)) {
        const json = JSON.stringify(viewForPlayer(s, p.id, now));
        for (const k of KIT_SHEETS.filter((x) => !codes.has(x.id))) expect(json).not.toContain(`"${k.code}"`);
      }
      // le terrain est verrouillé pendant la manche
      expect(() => gmAction(s, { type: 'terrain', terrain: pairSheet(s.terrain, 'k30', 'r1') }, ctx(now))).toThrow();
      now += 60_000;
      gmAction(s, { type: 'end', winner: r.int(2) ? 'crew' : 'impostors' }, ctx(now));
      gmAction(s, { type: 'newGame' }, ctx(now));
      // changements entre deux manches
      let nt = s.terrain;
      for (let i = 0; i < 6; i++) {
        const k = KIT_SHEETS[r.int(KIT_SHEETS.length)];
        if (k.kind === 'emergency') continue;
        nt = r.int(3) === 0 ? pairSheet(nt, k.id) : pairSheet(nt, k.id, `r${r.int(15)}`);
      }
      if (!nt.stations.some((x) => x.kind === 'task')) nt = pairSheet(nt, 'k01', 'r2');
      gmAction(s, { type: 'terrain', terrain: clone(nt) }, ctx(now));
      expect(s.terrain).toEqual(nt);
      const active = s.players.filter((p) => !p.kicked && !p.left);
      for (const p of active.slice(0, r.int(Math.max(0, active.length - 4)))) gmAction(s, { type: 'kick', playerId: p.id }, ctx(now));
      join(r.int(8));
      if (s.players.filter((p) => !p.kicked && !p.left).length < 4) join(4);
    }
  });

  it('réglage « imposteurs automatique » : enregistré, borné, appliqué au démarrage seulement', () => {
    expect(sanitizeSettings({ autoImpostors: 1 }).autoImpostors).toBe(true);
    expect(sanitizeSettings({}).autoImpostors).toBe(false);
    for (let n = 4; n <= 40; n++) {
      const st = startSettings({ ...DEFAULT_SETTINGS, autoImpostors: true, impostors: 10 }, n);
      expect(st.impostors).toBeGreaterThanOrEqual(1);
      expect(st.impostors * 2).toBeLessThan(n);
      expect(st.impostors).toBe(Math.min(maxImpostorsFor(n), recommendedImpostors(n)));
    }
    expect(startSettings({ ...DEFAULT_SETTINGS, impostors: 5 }, 12).impostors).toBe(5);
  });
});
