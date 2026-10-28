// Entraînement aux mini-jeux, entièrement sur le téléphone (aucun envoi au serveur, aucun effet sur la partie).

import { useState } from 'preact/hooks';
import { GAMES } from '../shared/catalog';
import { checkAnswer, makeTaskChallenge } from '../shared/puzzles';
import { cryptoRng } from '../shared/rng';
import type { GameKind } from '../shared/types';
import { GameView } from './games';
import { Modal, toast } from './ui';

const DIGITAL = (Object.keys(GAMES) as GameKind[]).filter((g) => !GAMES[g].paper);

export function Practice() {
  const [game, setGame] = useState<GameKind>();
  const [round, setRound] = useState(0);
  const [ch, setCh] = useState<ReturnType<typeof make>>();
  function make(g: GameKind) {
    const c = makeTaskChallenge(g, 1, cryptoRng);
    if (g === 'scan') c.params = { visual: true };
    return { id: 'essai', purpose: 'task' as const, game: g, params: c.params, startedAt: Date.now(), minMs: c.minMs, stationName: 'Entraînement', taskName: GAMES[g].label, answer: c.answer };
  }
  return (
    <>
      <div class="grid-buttons">
        {DIGITAL.map((g) => (
          <button
            key={g}
            class="btn"
            onClick={() => {
              setGame(g);
              setCh(make(g));
              setRound(round + 1);
            }}
          >
            {GAMES[g].label}
          </button>
        ))}
      </div>
      {game && ch && (
        <Modal title={`Entraînement : ${GAMES[game].label}`} onClose={() => setGame(undefined)}>
          <p class="muted">{GAMES[game].hint}</p>
          <GameView
            key={round}
            c={ch}
            serverNow={() => Date.now()}
            done={(answer) => {
              if (!checkAnswer(game, ch.answer, answer)) return toast('Raté, recommencez !', 'err');
              toast('Bravo ! En partie, cette étape serait validée.', 'ok');
              setGame(undefined);
            }}
          />
        </Modal>
      )}
    </>
  );
}
