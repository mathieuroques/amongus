// Mini-jeux affichés sur le téléphone. Le serveur fournit les paramètres et vérifie la réponse :
// ces composants ne décident jamais seuls qu'une tâche est accomplie.

import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FIXES, GAMES } from '../shared/catalog';
import type { ChallengeView } from '../shared/engine';
import { WIRE_COLORS } from '../shared/puzzles';
import { buzz, fmtSec } from './ui';

export interface GameProps {
  c: ChallengeView;
  done: (answer: unknown) => void;
  serverNow: () => number;
}

function Wires({ c, done }: GameProps) {
  const left = c.params.left as number[];
  const right = c.params.right as number[];
  const [links, setLinks] = useState<(number | undefined)[]>([undefined, undefined, undefined, undefined]);
  const [sel, setSel] = useState<number>();
  const used = new Set(links.filter((x) => x !== undefined));
  return (
    <div class="game">
      <div class="wires">
        {left.map((color, i) => (
          <Fragment key={i}>
            <button
              class={`wire ${sel === i ? 'sel' : ''} ${links[i] !== undefined ? 'done' : ''}`}
              style={{ background: WIRE_COLORS[color] }}
              aria-label={`Fil gauche ${i + 1}`}
              onClick={() => links[i] === undefined && setSel(i)}
            />
            <button
              class={`wire ${used.has(i) ? 'done' : ''}`}
              style={{ background: WIRE_COLORS[right[i]] }}
              aria-label={`Prise droite ${i + 1}`}
              onClick={() => {
                if (sel === undefined || used.has(i)) return;
                if (right[i] !== left[sel]) {
                  buzz(80);
                  setSel(undefined);
                  return;
                }
                const next = links.slice();
                next[sel] = i;
                setLinks(next);
                setSel(undefined);
                if (next.every((x) => x !== undefined)) done(next);
              }}
            />
          </Fragment>
        ))}
      </div>
      <p class="muted center">Touchez un fil à gauche, puis la prise de même couleur à droite.</p>
    </div>
  );
}

function Sequence({ c, done }: GameProps) {
  const seq = c.params.seq as number[];
  const [lit, setLit] = useState<number>();
  const [showing, setShowing] = useState(true);
  const [input, setInput] = useState<number[]>([]);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setShowing(true);
    setInput([]);
    let i = 0;
    const id = setInterval(() => {
      if (i >= seq.length * 2) {
        clearInterval(id);
        setLit(undefined);
        setShowing(false);
        return;
      }
      setLit(i % 2 === 0 ? seq[i / 2] : undefined);
      i++;
    }, 380);
    return () => clearInterval(id);
  }, [round]);
  return (
    <div class="game">
      <p class="center">{showing ? 'Mémorisez…' : `À vous : ${input.length}/${seq.length}`}</p>
      <div class="pad">
        {Array.from({ length: 9 }, (_, k) => (
          <button
            key={k}
            class={lit === k ? 'lit' : ''}
            disabled={showing}
            onClick={() => {
              const next = [...input, k];
              if (seq[next.length - 1] !== k) {
                buzz(120);
                setRound(round + 1);
                return;
              }
              setInput(next);
              if (next.length === seq.length) done(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Order({ c, done }: GameProps) {
  const layout = c.params.layout as number[];
  const [next, setNext] = useState(1);
  return (
    <div class="game">
      <div class="order">
        {layout.map((n) => (
          <button
            key={n}
            class={n < next ? 'ok' : ''}
            onClick={() => {
              if (n !== next) {
                if (n >= next) {
                  buzz(100);
                  setNext(1);
                }
                return;
              }
              if (n === 10) done('done');
              setNext(n + 1);
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Calibrate({ done }: GameProps) {
  const zone = useMemo(() => ({ from: 30 + Math.random() * 40, w: 16 }), []);
  const [pos, setPos] = useState(0);
  const [hits, setHits] = useState(0);
  const posRef = useRef(0);
  useEffect(() => {
    let dir = 1;
    let p = 0;
    const id = setInterval(() => {
      p += dir * (2.2 + hits * 0.6);
      if (p >= 100 || p <= 0) dir = -dir;
      p = Math.min(100, Math.max(0, p));
      posRef.current = p;
      setPos(p);
    }, 30);
    return () => clearInterval(id);
  }, [hits]);
  return (
    <div class="game">
      <div class="track">
        <div class="zone" style={{ left: `${zone.from}%`, width: `${zone.w}%` }} />
        <div class="cursor" style={{ left: `${pos}%` }} />
      </div>
      <p class="center">Réussites : {hits}/3</p>
      <button
        class="btn big block primary"
        onClick={() => {
          const p = posRef.current;
          if (p >= zone.from && p <= zone.from + zone.w) {
            const h = hits + 1;
            setHits(h);
            if (h >= 3) done('done');
          } else {
            buzz(100);
            setHits(0);
          }
        }}
      >
        STOP
      </button>
    </div>
  );
}

function SliderGame({ c, done, wave }: GameProps & { wave?: boolean }) {
  const target = c.params.target as number;
  const [v, setV] = useState(target > 50 ? 5 : 95);
  const close = Math.abs(v - target) <= 4;
  const path = (freq: number) => {
    let d = 'M0 40';
    for (let x = 0; x <= 300; x += 5) d += ` L${x} ${40 + 28 * Math.sin((x / 300) * Math.PI * 2 * (1 + freq / 25))}`;
    return d;
  };
  return (
    <div class="game">
      {wave ? (
        <svg viewBox="0 0 300 80" style={{ width: '100%', background: '#0e1426', borderRadius: '12px' }}>
          <path d={path(target)} stroke="#ffbf3d" fill="none" stroke-width="3" />
          <path d={path(v)} stroke={close ? '#3ee08f' : '#39d5f5'} fill="none" stroke-width="3" />
        </svg>
      ) : (
        <div class="track">
          <div class="target-mark" style={{ left: `${target}%` }} />
          <div class="cursor" style={{ left: `${v}%`, background: close ? '#3ee08f' : '#fff' }} />
        </div>
      )}
      <input type="range" min={0} max={100} value={v} onInput={(e) => setV(Number((e.target as HTMLInputElement).value))} aria-label="Réglage" />
      <button class="btn big block primary" disabled={!close} onClick={() => done(v)}>
        {close ? 'Valider' : 'Pas encore aligné…'}
      </button>
    </div>
  );
}

function Timed({ c, done, serverNow, scan }: GameProps & { scan?: boolean }) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 200);
    return () => clearInterval(id);
  }, []);
  const total = c.minMs;
  const left = c.startedAt + total - now;
  const pct = Math.min(1, Math.max(0, 1 - left / total));
  const finished = left <= 0;
  useEffect(() => {
    if (finished) done('done');
  }, [finished]);
  if (scan) {
    const visual = !!c.params.visual;
    return (
      <div class={`scan-visual ${visual ? 'on' : 'off'}`}>
        <div>
          {visual ? 'SCAN MÉDICAL EN COURS' : 'Scan en cours'}
          <div style={{ fontSize: '1rem', marginTop: '10px' }}>{finished ? 'Terminé' : `Restez immobile… ${fmtSec(left)}`}</div>
          <div style={{ fontSize: '2.4rem' }}>{Math.round(pct * 100)} %</div>
        </div>
      </div>
    );
  }
  return (
    <div class="game">
      <div class="bar" style={{ height: '28px' }}>
        <div style={{ width: `${pct * 100}%` }} />
      </div>
      <p class="center">{finished ? 'Transfert terminé.' : `Transfert… ${fmtSec(left)}`}</p>
    </div>
  );
}

function Swipe({ done }: GameProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [msg, setMsg] = useState('Faites glisser le badge vers la droite.');
  const start = useRef<{ t: number; x0: number } | null>(null);
  const max = () => (slot.current ? slot.current.clientWidth - 126 : 200);
  return (
    <div class="game">
      <div
        class="swipe-slot"
        ref={slot}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { t: performance.now(), x0: e.clientX };
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          setX(Math.min(max(), Math.max(0, e.clientX - start.current.x0)));
        }}
        onPointerUp={() => {
          if (!start.current) return;
          const dt = performance.now() - start.current.t;
          start.current = null;
          if (x < max() - 10) setMsg('Glissez jusqu’au bout.');
          else if (dt < 500) setMsg('Trop rapide, recommencez.');
          else if (dt > 2500) setMsg('Trop lent, recommencez.');
          else {
            setMsg('Badge accepté.');
            done('done');
            return;
          }
          buzz(80);
          setX(0);
        }}
      >
        <div class="swipe-card" style={{ transform: `translateX(${x}px)` }}>
          BADGE
        </div>
      </div>
      <p class="center">{msg}</p>
    </div>
  );
}

function Targets({ done }: GameProps) {
  const [n, setN] = useState(0);
  const pos = useMemo(() => ({ x: 12 + Math.random() * 76, y: 12 + Math.random() * 76 }), [n]);
  return (
    <div class="game">
      <div class="arena">
        {n < 8 && (
          <button
            class="t"
            aria-label="Cible"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onClick={() => {
              if (n + 1 >= 8) done('done');
              setN(n + 1);
            }}
          />
        )}
      </div>
      <p class="center">Cibles : {n}/8</p>
    </div>
  );
}

function TextAnswer({ c, done, numeric }: GameProps & { numeric?: boolean }) {
  const [v, setV] = useState('');
  return (
    <form
      class="game"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) done(v.trim());
      }}
    >
      <p>
        <strong>{numeric ? String(c.params.question) : `Mot de ${c.params.letters} lettres formé par les bandes du poste :`}</strong>
      </p>
      <input class="code" inputMode={numeric ? 'numeric' : 'text'} value={v} autoComplete="off" onInput={(e) => setV((e.target as HTMLInputElement).value)} />
      <button class="btn big block primary" disabled={!v.trim()}>
        Valider
      </button>
    </form>
  );
}

function Switches({ c, done }: GameProps) {
  const [st, setSt] = useState<boolean[]>(c.params.states as boolean[]);
  return (
    <div class="game">
      <div class="switches">
        {st.map((on, i) => (
          <button
            key={i}
            class={on ? 'on' : 'off'}
            onClick={() => {
              const next = st.slice();
              next[i] = !on;
              setSt(next);
              if (next.every(Boolean)) done('done');
            }}
          >
            {on ? 'MARCHE' : 'ARRÊT'}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pin({ c, done }: GameProps) {
  const pin = String(c.params.pin);
  const [v, setV] = useState('');
  return (
    <div class="game">
      <p class="center">
        Code affiché : <strong style={{ fontSize: '1.6rem', letterSpacing: '0.2em' }}>{pin}</strong>
      </p>
      <div class="big-code" style={{ fontSize: '2.4rem', minHeight: '3rem' }}>{v || '·····'}</div>
      <div class="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
          <button
            key={k}
            onClick={() => {
              if (k === '⌫') setV(v.slice(0, -1));
              else if (k === 'OK') done(v);
              else if (v.length < 5) setV(v + k);
            }}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GameView(p: GameProps) {
  switch (p.c.game) {
    case 'wires':
      return <Wires {...p} />;
    case 'sequence':
      return <Sequence {...p} />;
    case 'order':
      return <Order {...p} />;
    case 'calibrate':
      return <Calibrate {...p} />;
    case 'slider':
      return <SliderGame {...p} />;
    case 'tune':
      return <SliderGame {...p} wave />;
    case 'wait':
      return <Timed {...p} />;
    case 'scan':
      return <Timed {...p} scan />;
    case 'swipe':
      return <Swipe {...p} />;
    case 'targets':
      return <Targets {...p} />;
    case 'count':
      return <TextAnswer {...p} numeric />;
    case 'assemble':
      return <TextAnswer {...p} />;
    case 'switches':
      return <Switches {...p} />;
    case 'pin':
      return <Pin {...p} />;
    default:
      return <p>Mini-jeu inconnu.</p>;
  }
}

export function gameInfo(game: string) {
  return (GAMES as Record<string, { label: string; hint: string }>)[game] ?? (FIXES as Record<string, { label: string; hint: string }>)[game];
}
