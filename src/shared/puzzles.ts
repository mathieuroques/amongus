// Génération des mini-jeux (défis) et des énigmes imprimées.
// Les défis sont créés par le serveur ; seule la partie « params » est envoyée au téléphone.

import { ASSEMBLE_WORDS, FIXES, GAMES, SYMBOLS, SYMBOL_NAMES } from './catalog';
import { randomDigits, seededRng, shuffle, type Rng } from './rng';
import type { FixKind, GameKind } from './types';

export const WIRE_COLORS = ['#ff4d4d', '#3d8bff', '#ffd23d', '#d65cff'] as const;

/** Énigme « inventaire » : grille de symboles imprimée + question, réponse dérivée de la graine. */
export function countPuzzle(seed: number) {
  const rng = seededRng(seed);
  const cols = 8;
  const rows = 6;
  const grid: number[] = [];
  for (let i = 0; i < cols * rows; i++) grid.push(rng.int(SYMBOLS.length));
  const target = rng.int(SYMBOLS.length);
  const answer = grid.filter((g) => g === target).length;
  return {
    cols,
    rows,
    grid: grid.map((g) => SYMBOLS[g]),
    question: `Combien de ${SYMBOL_NAMES[target]} (${SYMBOLS[target]}) sur la fiche ?`,
    answer: String(answer),
  };
}

/** Énigme « puzzle » : un mot découpé en bandes imprimées dans le désordre. */
export function assemblePuzzle(seed: number) {
  const rng = seededRng(seed ^ 0x9e3779b9);
  const word = ASSEMBLE_WORDS[rng.int(ASSEMBLE_WORDS.length)];
  // Chaque bande porte une lettre et un morceau de motif : remises dans l'ordre, elles forment une flèche continue.
  const letters = word.split('').map((l, i) => ({ letter: l, index: i }));
  const pieces = shuffle(letters, rng);
  return { word, pieces, answer: word };
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
      const p = countPuzzle(seed);
      return { game, params: { question: p.question }, answer: p.answer, minMs };
    }
    case 'assemble': {
      const p = assemblePuzzle(seed);
      return { game, params: { letters: p.word.length }, answer: p.answer, minMs };
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
