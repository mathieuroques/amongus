// Génération des mini-jeux (défis) et des énigmes imprimées.
// Les défis sont créés par le serveur ; seule la partie « params » est envoyée au téléphone.

import { ASSEMBLE_WORDS, FIXES, GAMES, SYMBOLS, SYMBOL_NAMES } from './catalog';
import { randomDigits, seededRng, shuffle, type Rng } from './rng';
import type { FixKind, GameKind } from './types';

export const WIRE_COLORS = ['#ff4d4d', '#3d8bff', '#ffd23d', '#d65cff'] as const;

export const COUNT_COLS = 8;
export const COUNT_ROWS = 6;
export const ROW_LABELS = 'ABCDEF';

/** Zones de la grille sur lesquelles porte une question (les lignes sont A à F, les colonnes 1 à 8). */
export const COUNT_SCOPES = {
  all: { label: 'sur toute la grille', has: (_r: number, _c: number) => true },
  top: { label: 'dans la moitié haute (lignes A à C)', has: (r: number) => r < 3 },
  bottom: { label: 'dans la moitié basse (lignes D à F)', has: (r: number) => r >= 3 },
  left: { label: 'dans la moitié gauche (colonnes 1 à 4)', has: (_r: number, c: number) => c < 4 },
  right: { label: 'dans la moitié droite (colonnes 5 à 8)', has: (_r: number, c: number) => c >= 4 },
} as const;
export type CountScope = keyof typeof COUNT_SCOPES;

/**
 * Énigme « inventaire » : une grille de symboles imprimée. La fiche ne porte AUCUNE question :
 * le serveur en tire une au hasard à chaque fois (6 symboles × 5 zones = 30 questions), la réponse
 * ne peut donc pas être retenue d'une fois sur l'autre.
 */
export function countPuzzle(seed: number) {
  const rng = seededRng(seed);
  const grid: number[] = [];
  for (let i = 0; i < COUNT_COLS * COUNT_ROWS; i++) grid.push(rng.int(SYMBOLS.length));
  return { cols: COUNT_COLS, rows: COUNT_ROWS, grid: grid.map((g) => SYMBOLS[g]) };
}

/** Réponse à une question d'inventaire (calculable par la fiche imprimée comme par le serveur). */
export function countAnswer(seed: number, sym: number, scope: CountScope): string {
  const { grid } = countPuzzle(seed);
  let n = 0;
  grid.forEach((g, i) => {
    if (g === SYMBOLS[sym] && COUNT_SCOPES[scope].has(Math.floor(i / COUNT_COLS), i % COUNT_COLS)) n++;
  });
  return String(n);
}

export function countQuestion(sym: number, scope: CountScope): string {
  return `Combien de ${SYMBOL_NAMES[sym]} (${SYMBOLS[sym]}) ${COUNT_SCOPES[scope].label} ?`;
}

/** Toutes les questions possibles d'une fiche, avec leur réponse (onglet Tests du MJ, tests automatisés). */
export function countQuestions(seed: number) {
  const out: { sym: number; scope: CountScope; question: string; answer: string }[] = [];
  for (let sym = 0; sym < SYMBOLS.length; sym++) {
    for (const scope of Object.keys(COUNT_SCOPES) as CountScope[]) out.push({ sym, scope, question: countQuestion(sym, scope), answer: countAnswer(seed, sym, scope) });
  }
  return out;
}

export type AssembleLine = 'top' | 'bottom';
export const ASSEMBLE_LINES: Record<AssembleLine, string> = {
  top: 'lettres du HAUT (noires sur fond blanc)',
  bottom: 'lettres du BAS (blanches sur fond noir)',
};

/**
 * Énigme « puzzle » : des bandes découpées, rangées dans l'ordre du nombre de points.
 * Chaque bande porte DEUX lettres (haut et bas) : remises dans l'ordre, la ligne du haut et
 * celle du bas forment deux mots différents ; le serveur demande l'un des deux au hasard.
 */
export function assemblePuzzle(seed: number) {
  const rng = seededRng(seed ^ 0x9e3779b9);
  const word = ASSEMBLE_WORDS[rng.int(ASSEMBLE_WORDS.length)];
  const partners = ASSEMBLE_WORDS.filter((w) => w.length === word.length && w !== word);
  const word2 = partners[rng.int(partners.length)];
  const letters = word.split('').map((l, i) => ({ letter: l, bottom: word2[i], index: i }));
  const pieces = shuffle(letters, rng);
  return { word, word2, pieces };
}

export function assembleAnswer(seed: number, line: AssembleLine): string {
  const p = assemblePuzzle(seed);
  return line === 'top' ? p.word : p.word2;
}

export function normalizeAnswer(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export interface NewChallenge {
  game: GameKind | FixKind;
  params: Record<string, unknown>;
  answer: unknown;
  minMs: number;
}

/** Crée un défi de tâche. `seed` = graine de la tâche (énigmes papier). */
export function makeTaskChallenge(game: GameKind, seed: number, rng: Rng): NewChallenge {
  const minMs = GAMES[game].minMs;
  switch (game) {
    case 'wires': {
      const right = shuffle([0, 1, 2, 3], rng);
      const left = shuffle([0, 1, 2, 3], rng);
      // answer[i] = index (côté droit) de la couleur left[i]
      const answer = left.map((c) => right.indexOf(c));
      return { game, params: { left, right }, answer, minMs };
    }
    case 'sequence': {
      const seq = Array.from({ length: 5 }, () => rng.int(9));
      return { game, params: { seq }, answer: seq, minMs };
    }
    case 'order': {
      const layout = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rng);
      return { game, params: { layout }, answer: 'done', minMs };
    }
    case 'slider': {
      const target = 10 + rng.int(81);
      return { game, params: { target }, answer: target, minMs };
    }
    case 'count': {
      // une question tirée au hasard parmi celles dont la réponse n'est pas zéro
      const qs = countQuestions(seed).filter((q) => q.answer !== '0');
      const q = qs[rng.int(qs.length)];
      return { game, params: { question: q.question, sym: q.sym, scope: q.scope }, answer: q.answer, minMs };
    }
    case 'assemble': {
      const p = assemblePuzzle(seed);
      const line: AssembleLine = rng.int(2) === 0 ? 'top' : 'bottom';
      return { game, params: { letters: p.word.length, line, lineLabel: ASSEMBLE_LINES[line] }, answer: line === 'top' ? p.word : p.word2, minMs };
    }
    default:
      return { game, params: {}, answer: 'done', minMs };
  }
}

export function makeFixChallenge(kind: FixKind, rng: Rng): NewChallenge {
  const minMs = FIXES[kind].minMs;
  switch (kind) {
    case 'switches': {
      const states = Array.from({ length: 5 }, () => rng.int(2) === 1);
      if (states.every(Boolean)) states[rng.int(5)] = false;
      return { game: kind, params: { states }, answer: 'done', minMs };
    }
    case 'tune': {
      const target = 10 + rng.int(81);
      return { game: kind, params: { target }, answer: target, minMs };
    }
    case 'pin': {
      const pin = randomDigits(5, rng);
      return { game: kind, params: { pin }, answer: pin, minMs };
    }
  }
}

/** Vérifie la réponse d'un défi. */
export function checkAnswer(game: GameKind | FixKind, expected: unknown, given: unknown): boolean {
  switch (game) {
    case 'wires':
    case 'sequence':
      return Array.isArray(given) && Array.isArray(expected) && given.length === expected.length &&
        expected.every((v, i) => Number(given[i]) === v);
    case 'slider':
    case 'tune':
      return Number.isFinite(Number(given)) && Math.abs(Number(given) - Number(expected)) <= 4;
    case 'count':
    case 'assemble':
    case 'pin':
      return normalizeAnswer(given) === normalizeAnswer(expected);
    default:
      return given === 'done';
  }
}
