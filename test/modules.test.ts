// Tests des modules partagés : mini-jeux, énigmes, terrain, paramètres, codes, notifications.
import { describe, expect, it } from 'vitest';
import { ASSEMBLE_WORDS, FIXES, GAMES, SYMBOLS } from '../src/shared/catalog';
import { addPlayer, createGame, gmAction, GameError, playerAction } from '../src/shared/engine';
import { pushEvents, snapshot } from '../src/shared/notify';
import {
  assembleAnswer, assemblePuzzle, checkAnswer, countAnswer, countPuzzle, countQuestion, countQuestions, makeFixChallenge, makeTaskChallenge, normalizeAnswer,
  type AssembleLine, type CountScope,
} from '../src/shared/puzzles';
import { CODE_ALPHABET, cryptoRng, normalizeCode, randomCode, randomDigits, seededRng, sha256, shuffle } from '../src/shared/rng';
import { DEFAULT_SETTINGS, maxImpostorsFor, recommendedImpostors, sanitizeSettings, SETTING_BOUNDS } from '../src/shared/settings';
import { availableSabotages, EXAMPLE_ROOMS, exampleTerrain, generateTerrain, sanitizeTerrain, startProblems, terrainWarnings } from '../src/shared/terrain';
import type { FixKind, GameKind } from '../src/shared/types';
import { viewForGm, viewForPlayer } from '../src/shared/view';

const rng = seededRng(3);
const GAME_KINDS = Object.keys(GAMES) as GameKind[];
const FIX_KINDS = Object.keys(FIXES) as FixKind[];

describe('mini-jeux : chaque défi accepte sa bonne réponse et refuse les mauvaises', () => {
  for (const g of GAME_KINDS) {
    it(`tâche « ${GAMES[g].label} »`, () => {
      for (let i = 0; i < 30; i++) {
        const c = makeTaskChallenge(g, 1000 + i, rng);
        expect(c.minMs).toBeGreaterThanOrEqual(2000);
        expect(checkAnswer(g, c.answer, c.answer)).toBe(true);
        for (const bad of [undefined, null, '', 'faux', 12345, [], [9, 9, 9, 9, 9], { x: 1 }]) {
          if (JSON.stringify(bad) === JSON.stringify(c.answer)) continue;
          if ((g === 'slider') && typeof bad === 'number') continue;
          expect(checkAnswer(g, c.answer, bad)).toBe(false);
        }
        // les réponses des énigmes papier ne sont jamais dans les paramètres envoyés au téléphone
        // (inventaire : seule la question part — symbole et zone — ; la réponse exige la grille imprimée)
        if (g === 'assemble') expect(JSON.stringify(c.params)).not.toContain(String(c.answer));
        if (g === 'count') expect(Object.keys(c.params).sort()).toEqual(['question', 'scope', 'sym']);
      }
    });
  }
  for (const f of FIX_KINDS) {
    it(`réparation « ${FIXES[f].label} »`, () => {
      for (let i = 0; i < 30; i++) {
        const c = makeFixChallenge(f, rng);
        expect(checkAnswer(f, c.answer, c.answer)).toBe(true);
        expect(checkAnswer(f, c.answer, 'xx')).toBe(false);
        if (f === 'switches') expect((c.params.states as boolean[]).every(Boolean)).toBe(false);
      }
    });
  }
  it('curseurs : tolérance de ±4', () => {
    expect(checkAnswer('slider', 50, 54)).toBe(true);
    expect(checkAnswer('slider', 50, 46)).toBe(true);
    expect(checkAnswer('slider', 50, 55)).toBe(false);
    expect(checkAnswer('tune', 50, 'abc')).toBe(false);
  });
  it('câbles : la réponse relie chaque couleur à la prise de même couleur', () => {
    for (let i = 0; i < 50; i++) {
      const c = makeTaskChallenge('wires', 1, rng);
      const { left, right } = c.params as { left: number[]; right: number[] };
      (c.answer as number[]).forEach((r, li) => expect(right[r]).toBe(left[li]));
    }
  });
  it('inventaire : 30 questions par fiche (6 symboles × 5 zones), réponses exactes, moitiés cohérentes', () => {
    for (let seed = 0; seed < 200; seed++) {
      const p = countPuzzle(seed);
      expect(p.grid).toHaveLength(48);
      const qs = countQuestions(seed);
      expect(qs).toHaveLength(30);
      expect(new Set(qs.map((q) => q.question)).size).toBe(30);
      for (let sym = 0; sym < SYMBOLS.length; sym++) {
        const at = (r: number, c: number) => p.grid[r * 8 + c] === SYMBOLS[sym];
        let all = 0, top = 0, left = 0;
        for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) if (at(r, c)) {
          all++;
          if (r < 3) top++;
          if (c < 4) left++;
        }
        expect(countAnswer(seed, sym, 'all')).toBe(String(all));
        expect(countAnswer(seed, sym, 'top')).toBe(String(top));
        expect(countAnswer(seed, sym, 'left')).toBe(String(left));
        expect(Number(countAnswer(seed, sym, 'top')) + Number(countAnswer(seed, sym, 'bottom'))).toBe(all);
        expect(Number(countAnswer(seed, sym, 'left')) + Number(countAnswer(seed, sym, 'right'))).toBe(all);
      }
    }
    // la grille imprimée est la même qu'avant (anciennes fiches toujours lisibles)
    expect(countPuzzle(5).grid.join('')).toMatchSnapshot();
  });
  it('inventaire : le serveur tire la question au hasard, jamais une réponse nulle, réponse jamais envoyée', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = makeTaskChallenge('count', 77, rng);
      const p = c.params as { question: string; sym: number; scope: CountScope };
      expect(c.answer).toBe(countAnswer(77, p.sym, p.scope));
      expect(c.answer).not.toBe('0');
      expect(p.question).toBe(countQuestion(p.sym, p.scope));
      seen.add(p.question);
    }
    expect(seen.size).toBeGreaterThan(20);
  });
  it('puzzle : deux mots par jeu de bandes (haut et bas), de même longueur, demandés au hasard', () => {
    const lines = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const a = assemblePuzzle(seed);
      const sorted = [...a.pieces].sort((x, y) => x.index - y.index);
      expect(sorted.map((x) => x.letter).join('')).toBe(a.word);
      expect(sorted.map((x) => x.bottom).join('')).toBe(a.word2);
      expect(a.word2).not.toBe(a.word);
      expect(a.word2).toHaveLength(a.word.length);
      expect(assembleAnswer(seed, 'top')).toBe(a.word);
      expect(assembleAnswer(seed, 'bottom')).toBe(a.word2);
      const c = makeTaskChallenge('assemble', seed, rng);
      const line = (c.params as { line: AssembleLine }).line;
      lines.add(line);
      expect(c.answer).toBe(assembleAnswer(seed, line));
      expect(JSON.stringify(c.params)).not.toContain(a.word);
      expect(JSON.stringify(c.params)).not.toContain(a.word2);
    }
    expect([...lines].sort()).toEqual(['bottom', 'top']);
  });
  it('chaque mot du puzzle a au moins un partenaire de même longueur', () => {
    for (const w of ASSEMBLE_WORDS) expect(ASSEMBLE_WORDS.filter((x) => x.length === w.length && x !== w).length).toBeGreaterThan(0);
  });
  it('réponses texte : accents, espaces et casse ignorés', () => {
    expect(normalizeAnswer(' comète ')).toBe('COMETE');
    expect(checkAnswer('assemble', 'COMETE', 'Comète')).toBe(true);
    expect(checkAnswer('count', '7', ' 7 ')).toBe(true);
  });
});

describe('codes et aléatoire', () => {
  it('normalise les codes saisis ou lus dans un QR code (URL)', () => {
    expect(normalizeCode('https://x.workers.dev/#/s/ab3k')).toBe('AB3K');
    expect(normalizeCode(' a-b 3 k ')).toBe('AB3K');
    expect(normalizeCode('O1l')).toBe('011');
    expect(normalizeCode(undefined as never)).toBe('');
  });
  it('génère des codes dans l’alphabet sans ambiguïté', () => {
    for (let i = 0; i < 200; i++) for (const ch of randomCode(6)) expect(CODE_ALPHABET).toContain(ch);
    expect(randomDigits(4)).toMatch(/^\d{4}$/);
  });
  it('tirage cryptographique uniforme (khi-deux grossier)', () => {
    const n = 6;
    const counts = new Array(n).fill(0);
    for (let i = 0; i < 60_000; i++) counts[cryptoRng.int(n)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(600);
    expect(() => cryptoRng.int(0)).toThrow();
  });
  it('mélange : permutation complète', () => {
    const a = shuffle([1, 2, 3, 4, 5], rng);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('SHA-256', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('paramètres', () => {
  it('borne chaque valeur numérique et ignore les clés inconnues', () => {
    const big: Record<string, unknown> = { evil: 1, taskBarUpdates: 'hack', anonymousVotes: 'oui' };
    for (const k of Object.keys(SETTING_BOUNDS)) big[k] = 1e9;
    const s = sanitizeSettings(big);
    for (const [k, [, hi]] of Object.entries(SETTING_BOUNDS)) expect(s[k as keyof typeof s]).toBe(hi);
    expect(s.taskBarUpdates).toBe('always');
    expect(s.anonymousVotes).toBe(true);
    expect('evil' in s).toBe(false);
    const low: Record<string, unknown> = {};
    for (const k of Object.keys(SETTING_BOUNDS)) low[k] = -5;
    const l = sanitizeSettings(low);
    for (const [k, [lo]] of Object.entries(SETTING_BOUNDS)) expect(l[k as keyof typeof l]).toBe(lo);
    expect(sanitizeSettings({ killCooldownSec: 'abc' }).killCooldownSec).toBe(DEFAULT_SETTINGS.killCooldownSec);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('nombre d’imposteurs conseillé et maximum', () => {
    for (let n = 4; n <= 60; n++) {
      expect(recommendedImpostors(n)).toBeLessThanOrEqual(maxImpostorsFor(n));
      expect(maxImpostorsFor(n) * 2).toBeLessThan(n);
    }
    expect(recommendedImpostors(12)).toBe(3);
    expect(recommendedImpostors(40)).toBe(6);
  });
});

describe('terrain', () => {
  it('le terrain d’exemple est jouable de 4 à 40 joueurs avec les réglages par défaut', () => {
    const t = exampleTerrain(seededRng(1));
    for (const n of [7, 12, 20, 30, 40]) {
      expect(startProblems(t, { ...DEFAULT_SETTINGS, impostors: Math.min(3, maxImpostorsFor(n)) }, n)).toEqual([]);
    }
    expect(availableSabotages(t)).toEqual(['reactor', 'oxygen', 'lights', 'comms']);
    expect(terrainWarnings(t)).toEqual([]);
  });
  it('génération automatique pour des maisons de 1 à 25 pièces', () => {
    for (let n = 1; n <= 25; n++) {
      const rooms = Array.from({ length: n }, (_, i) => ({ name: `Pièce ${i + 1}`, floor: i % 2 ? 'Étage' : 'RDC' }));
      const t = generateTerrain(rooms, 0, seededRng(n));
      expect(t.stations.filter((s) => s.kind === 'emergency')).toHaveLength(1);
      expect(new Set(t.stations.map((s) => s.code)).size).toBe(t.stations.length);
      expect(() => sanitizeTerrain(JSON.parse(JSON.stringify(t)))).not.toThrow();
      for (const k of t.tasks) for (const st of k.steps) expect(t.stations.find((s) => s.id === st.stationId)?.kind).toBe('task');
    }
    expect(() => generateTerrain([{ name: 'A', forbidden: true }])).toThrow();
  });
  it('aucun poste dans une zone interdite ou de passage', () => {
    const t = generateTerrain(EXAMPLE_ROOMS, 0, seededRng(9));
    for (const s of t.stations) {
      const r = t.rooms.find((x) => x.id === s.roomId)!;
      expect(r.forbidden || r.transit).toBe(false);
    }
  });
  it('données malformées : erreur lisible ou terrain valide, jamais de plantage', () => {
    const r = seededRng(77);
    const junk = () => {
      const pool = [null, undefined, 1, 'x', [], {}, { id: 'a' }, [{ id: 'a' }], true, { name: 'a'.repeat(5000) }];
      return pool[r.int(pool.length)];
    };
    for (let i = 0; i < 500; i++) {
      const t = exampleTerrain(seededRng(i));
      const o = JSON.parse(JSON.stringify(t));
      const keys = ['rooms', 'stations', 'tasks', 'passages', 'meetingRoomId', 'name', 'safetyNotes'];
      o[keys[r.int(keys.length)]] = junk();
      if (r.int(2) && Array.isArray(o.stations) && typeof o.stations[0] === 'object' && o.stations[0]) o.stations[0].roomId = junk();
      try {
        const out = sanitizeTerrain(o);
        expect(out.name.length).toBeLessThanOrEqual(60);
        for (const s of out.stations) expect(out.rooms.some((x) => x.id === s.roomId)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message.length).toBeGreaterThan(5);
      }
    }
  });
  it('avertissements utiles au MJ', () => {
    const t = exampleTerrain(seededRng(2));
    t.stations = t.stations.filter((s) => s.kind !== 'reactor');
    t.tasks[2].steps[1].stationId = t.tasks[2].steps[0].stationId;
    const w = terrainWarnings(t).join('\n');
    expect(w).toMatch(/Réacteur/);
    expect(w).toMatch(/même pièce/);
  });
});

describe('notifications : événements publics uniquement', () => {
  function game() {
    const s = createGame('BCDFGH', 'h', 'h', 0, { impostors: 2 }, exampleTerrain(seededRng(4)));
    for (let i = 0; i < 8; i++) addPlayer(s, `Joueur ${i}`, `t${i}`, 0);
    return s;
  }
  const ctx = (now: number) => ({ now, rng });
  it('début, réunion, sabotage critique, STOP, reprise, fin, test d’alerte, alerte sécurité', () => {
    const s = game();
    let b = snapshot(s);
    gmAction(s, { type: 'start' }, ctx(1));
    expect(pushEvents(b, s).players.map((m) => m.tag)).toEqual(['start']);
    b = snapshot(s);
    const imp = s.players.find((p) => p.role === 'impostor')!;
    playerAction(s, imp.id, { type: 'sabotage', kind: 'reactor' }, ctx(20_000));
    expect(pushEvents(b, s).players.map((m) => m.tag)).toEqual(['sabotage']);
    b = snapshot(s);
    gmAction(s, { type: 'fixSabotage' }, ctx(21_000));
    playerAction(s, imp.id, { type: 'sabotage', kind: 'lights' }, ctx(60_000));
    expect(pushEvents(b, s).players).toEqual([]); // sabotage non critique : pas de notification
    b = snapshot(s);
    gmAction(s, { type: 'meeting' }, ctx(61_000));
    const m = pushEvents(b, s).players;
    expect(m.map((x) => x.tag)).toEqual(['meeting']);
    expect(m[0].body).toContain('Salon');
    b = snapshot(s);
    gmAction(s, { type: 'stop' }, ctx(62_000));
    expect(pushEvents(b, s).players.map((x) => x.tag)).toEqual(['stop']);
    b = snapshot(s);
    gmAction(s, { type: 'resume' }, ctx(63_000));
    expect(pushEvents(b, s).players[0].title).toMatch(/Reprise/);
    b = snapshot(s);
    gmAction(s, { type: 'ping' }, ctx(64_000));
    expect(pushEvents(b, s).players.map((x) => x.tag)).toEqual(['ping']);
    b = snapshot(s);
    playerAction(s, s.players[0].id, { type: 'alert', message: 'Je me suis blessé·e' }, ctx(65_000));
    const ev = pushEvents(b, s);
    expect(ev.players).toEqual([]);
    expect(ev.gm[0].body).toContain('Je me suis blessé·e');
    b = snapshot(s);
    gmAction(s, { type: 'end', winner: 'crew' }, ctx(66_000));
    expect(pushEvents(b, s).players.map((x) => x.tag)).toEqual(['end']);
  });
  it('aucune notification ne nomme un imposteur ni une victime avant la réunion', () => {
    const s = game();
    gmAction(s, { type: 'start' }, ctx(1));
    const b = snapshot(s);
    const imp = s.players.find((p) => p.role === 'impostor')!;
    const crew = s.players.filter((p) => p.role === 'crewmate');
    playerAction(s, imp.id, { type: 'kill', target: crew[0].id }, ctx(100_000));
    expect(pushEvents(b, s).players).toEqual([]); // aucune notification d'élimination (même pas à la victime)
    playerAction(s, crew[0].id, { type: 'dispute' }, ctx(100_001));
    const d = pushEvents(b, s);
    expect(d.players).toEqual([]);
    expect(d.gm[0].title).toMatch(/Contestation/);
    playerAction(s, crew[1].id, { type: 'report', code: crew[0].body!.code }, ctx(100_002));
    const txt = JSON.stringify(pushEvents(b, s).players);
    for (const p of s.players) expect(txt).not.toContain(p.name);
    // même la notification du MJ (écran verrouillé) ne nomme pas l'imposteur accusé
    expect(JSON.stringify(pushEvents(b, s).gm)).not.toContain(imp.name);
  });
});

describe('outils du MJ : tests des tâches, test d’alerte, abonnements', () => {
  const ctx = (now: number) => ({ now, rng });
  it('chaque étape de chaque tâche et chaque réparation se teste via le serveur, sans toucher à la partie', () => {
    const s = createGame('BCDFGH', 'h', 'h', 0, {}, exampleTerrain(seededRng(5)));
    let now = 1000;
    for (const t of s.terrain.tasks) {
      t.steps.forEach((_, i) => {
        const v = gmAction(s, { type: 'testTask', taskId: t.id, stepIndex: i }, ctx(now)) as { id: string; expected?: string; game: string };
        if (GAMES[v.game as GameKind].paper) expect(v.expected).toBe(String(s.gmChallenge!.answer));
        else expect(v.expected).toBeUndefined();
        expect(viewForGm(s, now, new Set()).gmChallenge?.id).toBe(v.id);
        expect(() => gmAction(s, { type: 'testSubmit', challengeId: v.id, answer: s.gmChallenge!.answer }, ctx(now))).toThrow(GameError);
        now += 11_000;
        expect(() => gmAction(s, { type: 'testSubmit', challengeId: v.id, answer: '__faux__' }, ctx(now))).toThrow(/refusée/);
        expect(gmAction(s, { type: 'testSubmit', challengeId: v.id, answer: s.gmChallenge!.answer }, ctx(now))).toMatchObject({ ok: true });
        expect(s.gmChallenge).toBeUndefined();
      });
    }
    for (const k of FIX_KINDS) {
      const v = gmAction(s, { type: 'testFix', kind: k }, ctx(now)) as { id: string };
      now += 3000;
      expect(gmAction(s, { type: 'testSubmit', challengeId: v.id, answer: s.gmChallenge!.answer }, ctx(now))).toMatchObject({ ok: true });
    }
    expect(() => gmAction(s, { type: 'testFix', kind: 'nope' as FixKind }, ctx(now))).toThrow(GameError);
    expect(() => gmAction(s, { type: 'testTask', taskId: 'inconnu' }, ctx(now))).toThrow(GameError);
    expect(s.phase).toBe('lobby');
    expect(s.players).toHaveLength(0);
  });
  it('abonnements push : validés, jamais renvoyés aux autres, clé privée jamais exposée', () => {
    const s = createGame('BCDFGH', 'h', 'h', 0);
    s.vapid = { publicKey: 'PUB', privateJwk: { d: 'SECRET-D' } };
    const p = addPlayer(s, 'Alice', 't', 0);
    const q = addPlayer(s, 'Bob', 't2', 0);
    const keys = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
    expect(() => playerAction(s, p.id, { type: 'pushSubscribe', subscription: { endpoint: 'https://evil.example/x', keys } }, ctx(1))).toThrow(GameError);
    playerAction(s, p.id, { type: 'pushSubscribe', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys } }, ctx(1));
    expect(viewForPlayer(s, p.id, 1).pushOn).toBe(true);
    const vq = JSON.stringify(viewForPlayer(s, q.id, 1));
    expect(vq).not.toContain('fcm.googleapis.com');
    expect(vq).not.toContain('SECRET-D');
    expect(JSON.stringify(viewForGm(s, 1, new Set()))).not.toContain('SECRET-D');
    expect(viewForPlayer(s, q.id, 1).pushKey).toBe('PUB');
    playerAction(s, p.id, { type: 'pushUnsubscribe' }, ctx(2));
    expect(viewForPlayer(s, p.id, 2).pushOn).toBe(false);
    gmAction(s, { type: 'pushSubscribe', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/gm', keys } }, ctx(3));
    expect(s.gmPush).toHaveLength(1);
  });
  it('test d’alerte : le compteur est diffusé à tous les joueurs', () => {
    const s = createGame('BCDFGH', 'h', 'h', 0);
    const p = addPlayer(s, 'Alice', 't', 0);
    gmAction(s, { type: 'ping' }, ctx(1));
    gmAction(s, { type: 'ping' }, ctx(2));
    expect(viewForPlayer(s, p.id, 3).pingId).toBe(2);
  });
});

describe('lecture des QR codes (téléphone)', () => {
  it('corps : QR code affiché par le téléphone du corps, lien profond, rien d’autre', async () => {
    const { bodyCodeOf, bodyUrl } = await import('../src/client/codes');
    expect(bodyCodeOf(bodyUrl('0420', 'https://x.workers.dev'))).toBe('0420');
    expect(bodyCodeOf('c:1234')).toBe('1234');
    for (const bad of ['https://x.workers.dev/#/s/AB3K', 'https://x.workers.dev/#/j/BCDFGH', '1234', '#/c/12345', '#/c/12a4', '']) expect(bodyCodeOf(bad)).toBeUndefined();
  });
  it('postes : QR code de fiche ou code tapé ; l’affiche d’invitation et les QR inconnus sont ignorés sans rien envoyer', async () => {
    const { stationCodeOf } = await import('../src/client/codes');
    expect(stationCodeOf('https://x.workers.dev/#/s/AB3K')).toBe('AB3K');
    expect(stationCodeOf(' ab3k ')).toBe('ab3k');
    expect(normalizeCode(stationCodeOf('https://x.workers.dev/#/s/ab3k')!)).toBe('AB3K');
    for (const bad of ['https://x.workers.dev/#/j/BCDFGH', 'https://exemple.com/page', 'WIFI:S:maison;T:WPA;P:secret;;', 'https://x.workers.dev/#/c/1234', '']) expect(stationCodeOf(bad)).toBeUndefined();
  });
});
