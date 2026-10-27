// Interface des joueurs (équipage, imposteurs, fantômes).

import { useEffect, useRef, useState } from 'preact/hooks';
import { GAMES, SABOTAGE_INFO, TASK_TYPE_LABEL } from '../shared/catalog';
import type { ChallengeView } from '../shared/engine';
import type { PlayerView } from '../shared/view';
import { dropPlayer, go } from './conn';
import { GameView, gameInfo } from './games';
import type { Connection } from './net';
import { Scanner } from './scanner';
import { useStore, useTick } from './store';
import {
  ActButton, Bar, beep, buzz, CodeForm, Countdown, fmtSec, Modal, NetBadge, OfflineBanner, Reveal, toast, unlockAudio, WakeLockToggle,
} from './ui';

type Conn = Connection<PlayerView>;

const roleLabel = (r?: string) => (r === 'impostor' ? 'Imposteur' : 'Membre d’équipage');

export function PlayerApp({ conn }: { conn: Conn }) {
  const st = useStore(conn.store);
  const v = st.view;
  useAlerts(v);

  if (st.kicked)
    return (
      <div class="wrap stack center">
        <h1>Vous avez été retiré·e de la partie</h1>
        <p>Le maître du jeu vous a exclu·e, ou votre session a été transférée sur un autre appareil.</p>
        <button class="btn block" onClick={() => (dropPlayer(), go('/'))}>
          Retour à l’accueil
        </button>
      </div>
    );
  if (!v)
    return (
      <div class="wrap stack center">
        <h2>Connexion à la partie {conn.code}…</h2>
        {st.error && <p class="card danger">{st.error.msg}</p>}
        {st.error?.code === 'bad_token' && (
          <button class="btn block" onClick={() => (dropPlayer(), go('/'))}>
            Revenir à l’accueil
          </button>
        )}
      </div>
    );

  return (
    <>
      <div class="topbar">
        <span class="num">{v.me.num}</span>
        <span class="title grow">{v.me.name}</span>
        <small>{v.code}</small>
        <NetBadge status={st.status} />
      </div>
      <OfflineBanner status={st.status} />
      {v.emergencyStop && <StopScreen />}
      {v.paused && !v.emergencyStop && (
        <div class="pause">
          <h1>⏸ Pause</h1>
          <p>Le maître du jeu a mis la partie en pause. Restez où vous êtes, toutes les actions sont suspendues.</p>
        </div>
      )}
      <PlayerBody v={v} conn={conn} />
    </>
  );
}

function StopScreen() {
  return (
    <div class="stop" role="alertdialog">
      <h1>STOP</h1>
      <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>Arrêt d’urgence. Arrêtez-vous, ne courez pas.</p>
      <p>Écoutez les consignes du maître du jeu et rejoignez calmement le point de rassemblement s’il le demande.</p>
    </div>
  );
}

/** Sons et vibrations lors des événements importants. */
function useAlerts(v?: PlayerView) {
  const prev = useRef<{ phase?: string; sab?: string; meetingId?: number; stop?: boolean }>({});
  useEffect(() => {
    if (!v) return;
    const p = prev.current;
    if (v.phase === 'meeting' && v.meeting && p.meetingId !== v.meeting.id) {
      beep(660, 220, 3);
      buzz([400, 150, 400, 150, 400]);
    }
    const sab = v.sabotage?.kind;
    if (sab && p.sab !== sab) {
      if (v.sabotage!.critical) {
        beep(990, 160, 4);
        buzz([200, 100, 200, 100, 200, 100, 200]);
      } else {
        beep(520, 160, 2);
        buzz([150, 80, 150]);
      }
    }
    if (v.emergencyStop && !p.stop) {
      beep(440, 400, 3);
      buzz([600, 200, 600]);
    }
    if (v.phase === 'playing' && p.phase === 'lobby') buzz(300);
    prev.current = { phase: v.phase, sab, meetingId: v.meeting?.id, stop: v.emergencyStop };
  }, [v]);
}

function PlayerBody({ v, conn }: { v: PlayerView; conn: Conn }) {
  const seenKey = `imposteurs.seen.${v.code}.${v.gameNumber}.${v.me.id}`;
  const [seen, setSeen] = useState(() => {
    try {
      return !!localStorage.getItem(seenKey);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setSeen(!!localStorage.getItem(seenKey));
    } catch {
      /* ignore */
    }
  }, [seenKey]);

  if (v.phase === 'lobby') return <Lobby v={v} conn={conn} />;
  if (v.phase === 'ended') return <EndScreen v={v} conn={conn} />;
  if (!v.me.role)
    return (
      <div class="wrap stack">
        <div class="card">
          <h2>Partie en cours</h2>
          <p>Vous ne participez pas à cette manche. Attendez la prochaine partie : le maître du jeu vous y ajoutera automatiquement.</p>
        </div>
      </div>
    );
  if (!seen)
    return (
      <RoleReveal
        v={v}
        onDone={() => {
          try {
            localStorage.setItem(seenKey, '1');
          } catch {
            /* ignore */
          }
          setSeen(true);
        }}
      />
    );
  return (
    <>
      <SabotageAlarm v={v} conn={conn} />
      {v.phase === 'meeting' ? <MeetingScreen v={v} conn={conn} /> : <InGame v={v} conn={conn} />}
    </>
  );
}

// ------------------------------------------------------------------- Salon
function Lobby({ v, conn }: { v: PlayerView; conn: Conn }) {
  const meeting = v.terrain.rooms.find((r) => r.id === v.terrain.meetingRoomId);
  const forbidden = v.terrain.rooms.filter((r) => r.forbidden);
  const transit = v.terrain.rooms.filter((r) => r.transit);
  return (
    <div class="wrap stack">
      <div class="card ok center">
        <h2>Vous êtes dans le salon</h2>
        <p>
          Partie <strong>{v.code}</strong> — en attente du lancement par le maître du jeu.
        </p>
      </div>
      <div class="card">
        <h3>Joueurs ({v.players.length})</h3>
        <ul class="list">
          {v.players.map((p) => (
            <li key={p.id}>
              <span class="num">{p.num}</span>
              {p.name}
              {p.id === v.me.id && <span class="badge">vous</span>}
            </li>
          ))}
        </ul>
      </div>
      <SafetyCard v={v} />
      <div class="card">
        <h3>Le terrain : {v.terrain.name}</h3>
        <p>
          Salle de réunion : <strong>{meeting?.name}</strong>
        </p>
        {forbidden.length > 0 && (
          <p>
            <span class="badge imp">Zones interdites</span> {forbidden.map((r) => r.name).join(', ')}
          </p>
        )}
        {transit.length > 0 && (
          <p>
            <span class="badge warn">Passages (on marche, aucune élimination)</span> {transit.map((r) => r.name).join(', ')}
          </p>
        )}
      </div>
      <a class="btn block" href="#/regles">
        📖 Lire les règles
      </a>
      <details class="card">
        <summary>📷 Tester mon appareil photo (lecture de QR code)</summary>
        <div style={{ marginTop: '12px' }}>
          <Scanner
            onCode={async (raw) => {
              toast(`QR code lu : ${raw.slice(-24)}. Votre téléphone est prêt !`, 'ok');
              return true;
            }}
          />
        </div>
      </details>
      <ActButton class="block" confirm="Quitter le salon ?" run={async () => {
        const r = await conn.act({ type: 'leave' });
        if (r.ok) {
          dropPlayer();
          go('/');
        }
        return r;
      }}>
        Quitter le salon
      </ActButton>
    </div>
  );
}

function SafetyCard({ v }: { v: PlayerView }) {
  return (
    <div class="card warn">
      <h3>⚠️ Sécurité</h3>
      <p style={{ whiteSpace: 'pre-wrap' }}>{v.terrain.safetyNotes || 'Ne courez pas, ne verrouillez aucune porte, respectez les zones interdites.'}</p>
    </div>
  );
}

// ------------------------------------------------------------------- Révélation du rôle
function RoleReveal({ v, onDone }: { v: PlayerView; onDone: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div class="overlay">
      <div class="wrap stack">
        {!shown ? (
          <button class="veil" style={{ width: '100%', minHeight: '60dvh', border: 'none', color: 'inherit' }} onClick={() => (unlockAudio(), setShown(true))}>
            <div>
              <div style={{ fontSize: '3rem' }}>🤫</div>
              <h2>La partie commence !</h2>
              <p>Cachez votre écran des autres joueurs, puis touchez ici pour découvrir votre rôle.</p>
            </div>
          </button>
        ) : (
          <>
            <RoleCard v={v} />
            <button class="btn big block primary" onClick={onDone}>
              J’ai compris — commencer
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RoleCard({ v }: { v: PlayerView }) {
  const imp = v.me.role === 'impostor';
  return (
    <div class={`role-card ${imp ? 'imp' : 'crew'}`}>
      <small>Votre rôle</small>
      <h1>{imp ? 'IMPOSTEUR' : 'ÉQUIPAGE'}</h1>
      {imp ? (
        <>
          <p>Éliminez l’équipage sans vous faire démasquer, et sabotez pour semer le chaos.</p>
          <p>Vous gagnez si les imposteurs sont aussi nombreux que l’équipage vivant, ou si un sabotage critique n’est pas réparé à temps.</p>
          {v.allies && v.allies.length > 0 ? (
            <p>
              <strong>Vos alliés :</strong> {v.allies.map((a) => `#${a.num} ${a.name}${a.status !== 'alive' ? ' (†)' : ''}`).join(', ')}
            </p>
          ) : (
            <p>Vous êtes le seul imposteur.</p>
          )}
          <p class="muted">Vos tâches sont factices : faites semblant de les accomplir pour vous fondre dans l’équipage.</p>
        </>
      ) : (
        <>
          <p>Accomplissez vos tâches dans la maison et démasquez les imposteurs.</p>
          <p>Vous gagnez si toutes les tâches de l’équipage sont terminées ou si tous les imposteurs sont éjectés.</p>
          <p class="muted">Il y a {v.settings.impostors} imposteur(s) parmi vous.</p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Sabotages
function SabotageAlarm({ v, conn }: { v: PlayerView; conn: Conn }) {
  const now = conn.serverNow();
  useTick(500);
  const s = v.sabotage;
  if (!s || v.phase !== 'playing') return null;
  return (
    <div class={`alarm ${s.critical ? 'critical' : 'normal'}`} role="alert">
      <span style={{ fontSize: '1.4rem' }}>{s.critical ? '🚨' : '⚠️'}</span>
      <div class="grow">
        <div>
          {s.label}
          {s.roomName ? ` : ${s.roomName}` : ''}
          {s.deadline && (
            <>
              {' '}
              — <Countdown until={s.deadline} now={now} />
            </>
          )}
          {s.endsAt && (
            <>
              {' '}
              — <Countdown until={s.endsAt} now={now} />
            </>
          )}
        </div>
        <small style={{ color: 'inherit' }}>
          {s.kind === 'doors'
            ? 'Personne n’entre dans cette salle. Les portes restent ouvertes : on peut toujours en sortir.'
            : s.stations.map((x) => `${x.name} (${x.roomName})${x.fixed ? ' ✓' : x.held ? ' ✋' : ''}`).join(' · ')}
        </small>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Jeu
type Tab = 'tasks' | 'scan' | 'urgent' | 'role';

function InGame({ v, conn }: { v: PlayerView; conn: Conn }) {
  const [tab, setTab] = useState<Tab>('tasks');
  const [pending, setPending] = useState<string | undefined>(() => {
    const c = sessionStorage.getItem('imposteurs.pendingScan') ?? undefined;
    if (c) sessionStorage.removeItem('imposteurs.pendingScan');
    return c;
  });
  useEffect(() => {
    if (pending) setTab('scan');
  }, [pending]);

  if (v.me.challenge) return <ChallengeScreen v={v} c={v.me.challenge} conn={conn} />;
  if (v.me.bodyPending) return <BodyScreen v={v} conn={conn} />;

  return (
    <>
      <div class="wrap stack">
        {!v.me.alive && (
          <div class="card ghost">
            <strong>👻 Vous êtes un fantôme.</strong>{' '}
            {v.me.role === 'impostor'
              ? 'Vous pouvez encore saboter (onglet Rôle), mais plus éliminer.'
              : 'Terminez vos tâches pour aider l’équipage.'}{' '}
            Silence total avec les vivants : ni parole, ni geste, ni regard appuyé.
          </div>
        )}
        {tab === 'tasks' && <TasksTab v={v} />}
        {tab === 'scan' && <ScanTab v={v} conn={conn} initial={pending} onConsumed={() => setPending(undefined)} />}
        {tab === 'urgent' && <UrgentTab v={v} conn={conn} />}
        {tab === 'role' && <RoleTab v={v} conn={conn} />}
      </div>
      <nav class="tabs" aria-label="Navigation">
        {(
          [
            ['tasks', '📋', 'Tâches'],
            ['scan', '📷', 'Poste'],
            ['urgent', '🚨', 'Urgence'],
            ['role', '🎭', 'Rôle'],
          ] as const
        ).map(([k, ico, label]) => (
          <button key={k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <span class="ico">{ico}</span>
            {label}
          </button>
        ))}
      </nav>
      <ArmedCode v={v} conn={conn} />
    </>
  );
}

function TaskBarCard({ v }: { v: PlayerView }) {
  if (v.taskBar === undefined) {
    if (v.sabotage?.kind === 'comms') return <div class="card warn">📡 Communications coupées : progression indisponible.</div>;
    return v.settings.taskBarUpdates === 'never' ? null : null;
  }
  return (
    <div class="card">
      <div class="row">
        <strong class="grow">Progression de l’équipage</strong>
        <span>{Math.round(v.taskBar * 100)} %</span>
      </div>
      <Bar value={v.taskBar} />
      {v.settings.taskBarUpdates === 'meetings' && <small>Mise à jour uniquement pendant les réunions.</small>}
    </div>
  );
}

function TasksTab({ v }: { v: PlayerView }) {
  const tasks = v.me.tasks;
  return (
    <>
      <TaskBarCard v={v} />
      <div class="card">
        <h2>Mes tâches</h2>
        {v.me.tasksHidden ? (
          <p>📡 Communications coupées : votre liste de tâches est indisponible. Vous pouvez toujours accomplir une tâche si vous vous souvenez de son poste.</p>
        ) : (
          <ul class="list">
            {tasks?.map((t) => (
              <li key={t.taskId} class={t.done ? 'dead' : ''}>
                <span style={{ fontSize: '1.3rem' }}>{t.done ? '✅' : '⬜'}</span>
                <div class="grow">
                  <strong>{t.name}</strong>{' '}
                  <small>
                    ({TASK_TYPE_LABEL[t.type]}
                    {t.steps > 1 ? `, étape ${Math.min(t.step + 1, t.steps)}/${t.steps}` : ''})
                  </small>
                  {t.next && !t.done && (
                    <div class="muted">
                      📍 {t.next.roomName}
                      {t.next.floor ? ` (${t.next.floor})` : ''} — {t.next.stationName}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p class="muted" style={{ fontSize: '0.9rem' }}>
          Rendez-vous au poste en marchant, puis ouvrez l’onglet « Poste » et scannez son QR code.
        </p>
      </div>
    </>
  );
}

// ------------------------------------------------------------------- Postes
interface ScanResult {
  stationId: string;
  name: string;
  kind: string;
  roomName: string;
  block?: string;
  tasks?: { taskId: string; name: string; step: number; steps: number; game: string }[];
  emergencyLeft?: number;
  vitals?: { id: string; name: string; num: number; status: string }[];
  fix?: boolean;
}

function ScanTab({ v, conn, initial, onConsumed }: { v: PlayerView; conn: Conn; initial?: string; onConsumed: () => void }) {
  const [station, setStation] = useState<{ code: string; info: ScanResult }>();
  const scan = async (raw: string) => {
    const r = await conn.act<ScanResult>({ type: 'scan', code: raw });
    if (!r.ok) {
      toast(r.msg ?? 'Code refusé.', 'err');
      return false;
    }
    buzz(40);
    setStation({ code: raw, info: r.data! });
    return true;
  };
  useEffect(() => {
    if (initial && conn.store.get().status === 'online') {
      onConsumed();
      void scan(initial);
    }
  }, [initial, conn.store.get().status]);

  if (station) return <StationPanel v={v} conn={conn} code={station.code} info={station.info} close={() => setStation(undefined)} rescan={() => scan(station.code)} />;
  return (
    <div class="card stack">
      <h2>Utiliser un poste</h2>
      <p class="muted">Tâches, bouton d’urgence, réparations et moniteur : tout se déclenche en scannant le poste sur place.</p>
      <Scanner onCode={scan} />
    </div>
  );
}

function StationPanel({ v, conn, code, info, close, rescan }: { v: PlayerView; conn: Conn; code: string; info: ScanResult; close: () => void; rescan: () => void }) {
  // les informations du poste sont rafraîchies quand l'état de la partie change
  const sabKey = `${v.sabotage?.kind}-${v.sabotage?.stations.map((s) => s.fixed).join()}-${v.me.tasks?.map((t) => t.step).join()}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    rescan();
  }, [sabKey]);
  return (
    <div class="card stack">
      <div class="row">
        <div class="grow">
          <h2 style={{ margin: 0 }}>{info.name}</h2>
          <small>{info.roomName}</small>
        </div>
        <button class="btn small" onClick={close}>
          Fermer
        </button>
      </div>
      {info.block && <p class="card warn">{info.block}</p>}
      {info.kind === 'task' &&
        (info.tasks && info.tasks.length > 0 ? (
          info.tasks.map((t) => (
            <ActButton
              key={t.taskId}
              class="block big primary"
              disabled={!!info.block}
              run={() => conn.act({ type: 'startTask', code, taskId: t.taskId })}
            >
              ▶ {t.name}
              {t.steps > 1 ? ` (${t.step}/${t.steps})` : ''} — {GAMES[t.game as keyof typeof GAMES]?.label}
            </ActButton>
          ))
        ) : (
          <p>Aucune de vos tâches ne se fait à ce poste pour l’instant.</p>
        ))}
      {info.kind === 'emergency' && (
        <>
          <p>Réunions d’urgence restantes : {info.emergencyLeft ?? 0}</p>
          <ActButton
            class="block big danger"
            disabled={!!info.block}
            confirm="Convoquer une réunion d’urgence ? Tout le monde sera appelé en salle de réunion."
            run={() => conn.act({ type: 'callEmergency', code })}
          >
            🚨 RÉUNION D’URGENCE
          </ActButton>
        </>
      )}
      {info.kind === 'vitals' && info.vitals && (
        <ul class="list">
          {info.vitals.map((p) => (
            <li key={p.id} class={p.status !== 'alive' ? 'dead' : ''}>
              <span class="num">{p.num}</span>
              <span class="grow">{p.name}</span>
              <span class={`badge ${p.status === 'alive' ? 'crew' : 'dead'}`}>{p.status === 'alive' ? 'vivant·e' : p.status === 'dead' ? 'mort·e' : 'parti·e'}</span>
            </li>
          ))}
        </ul>
      )}
      {info.kind === 'reactor' && <ReactorHold v={v} conn={conn} code={code} />}
      {(info.kind === 'lights' || info.kind === 'comms' || info.kind === 'oxygen') && info.fix && (
        <ActButton class="block big crew" run={() => conn.act({ type: 'fixStart', code })}>
          🔧 Réparer
        </ActButton>
      )}
    </div>
  );
}

function ReactorHold({ v, conn, code }: { v: PlayerView; conn: Conn; code: string }) {
  const [on, setOn] = useState(false);
  const timer = useRef<number>();
  const send = async (state: boolean) => {
    const r = await conn.act<{ fixed?: boolean; holders?: number }>({ type: 'hold', code, on: state });
    if (!r.ok && state) {
      toast(r.msg ?? 'Refusé', 'err');
      stop();
    }
    if (r.data?.fixed) {
      toast('Réacteur stabilisé !', 'ok');
      stop();
    }
  };
  const start = () => {
    if (on) return;
    unlockAudio();
    setOn(true);
    void send(true);
    timer.current = window.setInterval(() => void send(true), 1000);
  };
  const stop = () => {
    clearInterval(timer.current);
    if (on) void send(false);
    setOn(false);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  const active = v.sabotage?.kind === 'reactor';
  if (!active) return <p>Le réacteur fonctionne normalement.</p>;
  const held = v.sabotage!.stations.filter((s) => s.held).length;
  return (
    <div class="stack">
      <p>
        Maintenez le bouton appuyé. Une autre personne doit faire de même <strong>en même temps</strong> à l’autre poste Réacteur. Postes tenus : {held}/2
      </p>
      <button
        class={`hold ${on ? 'on' : ''}`}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
      >
        {on ? '✋ MAINTENEZ…' : '✋ APPUYER ET MAINTENIR'}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------- Mini-jeu en cours
function ChallengeScreen({ v, c, conn }: { v: PlayerView; c: ChallengeView; conn: Conn }) {
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const info = gameInfo(c.game);
  const submit = async (answer: unknown) => {
    setSending(true);
    const wait = c.startedAt + c.minMs - conn.serverNow();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait + 150));
    const r = await conn.act<{ taskDone?: boolean; fixed?: boolean; partial?: boolean; fake?: boolean; nextStep?: number }>({ type: 'submit', challengeId: c.id, answer });
    setSending(false);
    if (!r.ok) {
      toast(r.msg ?? 'Refusé', 'err');
      setAttempt(attempt + 1);
      return;
    }
    const d = r.data ?? {};
    if (d.taskDone) toast('Tâche terminée ✔', 'ok');
    else if (d.nextStep) toast(`Étape validée. Rendez-vous au poste suivant (étape ${d.nextStep}).`, 'ok');
    else if (d.fixed) toast('Sabotage réparé !', 'ok');
    else if (d.partial) toast('Poste réparé : il faut aussi réparer l’autre poste !', 'ok');
    else toast('Terminé.', 'ok');
    buzz(60);
  };
  return (
    <div class="overlay">
      <div class="wrap stack">
        <div class="row">
          <div class="grow">
            <h2 style={{ margin: 0 }}>{c.purpose === 'fix' ? info?.label : c.taskName}</h2>
            <small>
              {c.stationName} — {info?.label}
            </small>
          </div>
        </div>
        <p>{info?.hint}</p>
        {v.sabotage && v.sabotage.critical && c.purpose !== 'fix' && <p class="card danger">🚨 {v.sabotage.label} en cours !</p>}
        {sending ? (
          <p class="card center">Validation par le serveur…</p>
        ) : (
          <GameView key={attempt} c={c} done={submit} serverNow={() => conn.serverNow()} />
        )}
        <ActButton class="block" run={() => conn.act({ type: 'cancelChallenge' })}>
          Abandonner
        </ActButton>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Corps
function BodyScreen({ v, conn }: { v: PlayerView; conn: Conn }) {
  useTick(1000);
  const now = conn.serverNow();
  const b = v.me.body!;
  return (
    <div class="wrap stack center">
      <div class="card danger">
        <h1>💀 Vous avez été éliminé·e</h1>
        {v.me.killedByName && <p class="muted">Gardez pour vous l’identité de la personne qui vous a éliminé·e.</p>}
        <p>
          <strong>Asseyez-vous calmement sur place</strong> (jamais dans un escalier ni un passage : décalez-vous de quelques pas si besoin). Restez silencieux·se et immobile.
        </p>
      </div>
      <div class="card">
        <p>Code de votre corps — montrez-le à la personne qui vous découvre :</p>
        <div class="big-code">{b.code}</div>
      </div>
      {b.vanishAt && (
        <p class="muted">
          Si personne ne vous trouve, votre corps disparaît dans <Countdown until={b.vanishAt} now={now} /> : vous deviendrez alors un fantôme libre de vos mouvements.
        </p>
      )}
      <ActButton class="block" run={() => conn.act({ type: 'alert', message: 'Alerte envoyée par un corps' })} okMsg="Le maître du jeu est prévenu.">
        ⚠️ Alerte sécurité
      </ActButton>
    </div>
  );
}

// ------------------------------------------------------------------- Urgence
function UrgentTab({ v, conn }: { v: PlayerView; conn: Conn }) {
  const [alert, setAlert] = useState(false);
  const now = conn.serverNow();
  useTick(1000);
  const meetingRoom = v.terrain.rooms.find((r) => r.id === v.terrain.meetingRoomId)?.name;
  return (
    <>
      {v.me.alive && (
        <div class="card stack">
          <h2>💀 Vous avez trouvé un corps ?</h2>
          <CodeForm
            label="Code affiché sur le téléphone du corps"
            digits
            length={4}
            button="Signaler le corps"
            btnClass="danger"
            submit={async (code) => {
              const r = await conn.act({ type: 'report', code });
              if (!r.ok) toast(r.msg ?? 'Refusé', 'err');
              return r.ok;
            }}
          />
        </div>
      )}
      {v.me.alive && (
        <div class="card stack">
          <h2>🗡 Un imposteur vous a éliminé·e ?</h2>
          <p class="muted">Il vous montre un code à 4 chiffres : saisissez-le immédiatement.</p>
          <CodeForm
            label="Code montré par l’imposteur"
            digits
            length={4}
            button="Je suis éliminé·e"
            btnClass="warn"
            submit={async (code) => {
              const r = await conn.act({ type: 'killed', code });
              if (!r.ok) toast(r.msg ?? 'Refusé', 'err');
              return r.ok;
            }}
          />
        </div>
      )}
      <div class="card">
        <h3>Réunion d’urgence</h3>
        <p>
          Allez au bouton d’urgence ({meetingRoom}) et scannez-le dans l’onglet « Poste ». Il vous reste {v.me.emergencyLeft} réunion(s).
          {now < v.emergencyCooldownUntil && (
            <>
              {' '}
              Disponible dans <Countdown until={v.emergencyCooldownUntil} now={now} />.
            </>
          )}
        </p>
      </div>
      <button class="btn block big warn" onClick={() => setAlert(true)}>
        ⚠️ Alerte sécurité / je dois arrêter
      </button>
      {alert && <AlertModal conn={conn} close={() => setAlert(false)} />}
      <ActButton
        class="block"
        confirm="Quitter définitivement la partie ? Vous serez compté·e comme parti·e (vos tâches sont retirées)."
        run={async () => {
          const r = await conn.act({ type: 'leave' });
          if (r.ok) {
            dropPlayer();
            go('/');
          }
          return r;
        }}
      >
        Quitter la partie
      </ActButton>
    </>
  );
}

function AlertModal({ conn, close }: { conn: Conn; close: () => void }) {
  const [msg, setMsg] = useState('');
  return (
    <Modal title="Alerte sécurité" onClose={close}>
      <p>Le maître du jeu reçoit immédiatement votre alerte. Pour une urgence vitale, appelez le 112.</p>
      <div class="row">
        {['Je me suis blessé·e', 'Je ne me sens pas bien', 'Je veux arrêter', 'Problème de sécurité'].map((m) => (
          <button class={`btn small ${msg === m ? 'primary' : ''}`} onClick={() => setMsg(m)}>
            {m}
          </button>
        ))}
      </div>
      <textarea rows={2} placeholder="Précisions (facultatif)" value={msg} onInput={(e) => setMsg((e.target as HTMLTextAreaElement).value)} />
      <ActButton class="block big danger" okMsg="Alerte envoyée au maître du jeu." run={async () => {
        const r = await conn.act({ type: 'alert', message: msg || 'Alerte sécurité' });
        if (r.ok) close();
        return r;
      }}>
        Envoyer l’alerte
      </ActButton>
    </Modal>
  );
}

// ------------------------------------------------------------------- Rôle (et actions d'imposteur)
function RoleTab({ v, conn }: { v: PlayerView; conn: Conn }) {
  useTick(1000);
  const now = conn.serverNow();
  const imp = v.me.role === 'impostor';
  return (
    <>
      <Reveal label="Mon rôle et mes actions secrètes">
        <div class="stack">
          <RoleCard v={v} />
          {imp && <ImpostorActions v={v} conn={conn} now={now} />}
          {!imp && !v.me.alive && <p class="card ghost">Fantôme d’équipage : terminez vos tâches. Vous ne pouvez plus voter, signaler ni réparer.</p>}
        </div>
      </Reveal>
      <FacadeButton v={v} />
      <a class="btn block" href="#/regles">
        📖 Règles du jeu
      </a>
      <WakeLockToggle />
      <SafetyCard v={v} />
    </>
  );
}

/** Carte « Équipage » de façade, disponible pour TOUS : montrer son téléphone ne prouve donc rien. */
function FacadeButton({ v }: { v: PlayerView }) {
  const [on, setOn] = useState(false);
  if (!v.me.alive) return null;
  return (
    <>
      <button class="btn block" onClick={() => setOn(true)}>
        🃏 Carte de façade « Équipage » (bluff)
      </button>
      {on && (
        <div class="overlay" onClick={() => setOn(false)}>
          <div class="wrap stack">
            <div class="stack">
              <RoleCard v={{ ...v, me: { ...v.me, role: 'crewmate' } }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ImpostorActions({ v, conn, now }: { v: PlayerView; conn: Conn; now: number }) {
  const [doorRoom, setDoorRoom] = useState('');
  const cd = v.me.killCooldownUntil ?? 0;
  const sabCd = v.sabotageCooldownUntil ?? 0;
  const doorsRooms = v.terrain.rooms.filter((r) => !r.forbidden && !r.transit && r.id !== v.terrain.meetingRoomId);
  return (
    <>
      {v.me.alive && (
        <div class="card danger stack">
          <h3>🗡 Élimination</h3>
          <p class="muted">Touchez l’épaule de la victime (avec son accord pour le jeu), montrez-lui le code : elle le saisit sur son téléphone. Interdit dans les escaliers et passages.</p>
          {now < cd ? (
            <p>
              Prochaine élimination possible dans <Countdown until={cd} now={now} />
            </p>
          ) : (
            <ActButton class="block big danger" run={() => conn.act({ type: 'arm' })}>
              Préparer un code d’élimination
            </ActButton>
          )}
        </div>
      )}
      <div class="card stack">
        <h3>🔧 Sabotages</h3>
        {v.sabotage ? (
          <p>Sabotage en cours : {v.sabotage.label}.</p>
        ) : now < sabCd ? (
          <p>
            Sabotage disponible dans <Countdown until={sabCd} now={now} />
          </p>
        ) : (
          <>
            {v.sabotageOptions?.filter((k) => k !== 'doors').map((k) => (
              <ActButton key={k} class={`block ${SABOTAGE_INFO[k].critical ? 'danger' : 'warn'}`} confirm={`Déclencher « ${SABOTAGE_INFO[k].label} » ?`} run={() => conn.act({ type: 'sabotage', kind: k })} okMsg="Sabotage déclenché.">
                {SABOTAGE_INFO[k].label}
                {SABOTAGE_INFO[k].critical ? ' (critique)' : ''}
              </ActButton>
            ))}
            {v.sabotageOptions?.includes('doors') && (
              <div class="row">
                <select class="grow" value={doorRoom} onChange={(e) => setDoorRoom((e.target as HTMLSelectElement).value)} style={{ flex: 1 }}>
                  <option value="">Condamner une salle…</option>
                  {doorsRooms.map((r) => (
                    <option value={r.id}>{r.name}</option>
                  ))}
                </select>
                <ActButton class="warn" disabled={!doorRoom} run={() => conn.act({ type: 'sabotage', kind: 'doors', roomId: doorRoom })} okMsg="Salle condamnée.">
                  OK
                </ActButton>
              </div>
            )}
          </>
        )}
        <small>Délai partagé entre tous les imposteurs. Les fantômes imposteurs peuvent aussi saboter.</small>
      </div>
      {v.terrain.passages && v.terrain.passages.length > 0 && v.me.alive && (
        <div class="card">
          <h3>🕳 Conduits (réservés aux imposteurs)</h3>
          <ul class="list">
            {v.terrain.passages.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong> : {v.terrain.rooms.find((r) => r.id === p.fromRoomId)?.name} ↔ {v.terrain.rooms.find((r) => r.id === p.toRoomId)?.name}
                  {p.notes && <div class="muted">{p.notes}</div>}
                </div>
              </li>
            ))}
          </ul>
          <small>En marchant, sans vous cacher dans un endroit dangereux. Être vu sortir d’un conduit est une preuve !</small>
        </div>
      )}
    </>
  );
}

function ArmedCode({ v, conn }: { v: PlayerView; conn: Conn }) {
  useTick(500);
  const k = v.me.killCode;
  if (!k || v.phase !== 'playing') return null;
  const now = conn.serverNow();
  return (
    <Modal title="Code d’élimination">
      <p>Montrez ce code à votre victime. Il expire dans <Countdown until={k.expiresAt} now={now} />.</p>
      <div class="big-code" style={{ color: 'var(--imp)' }}>
        {k.code}
      </div>
      <ActButton class="block" run={() => conn.act({ type: 'disarm' })}>
        Annuler
      </ActButton>
    </Modal>
  );
}

// ------------------------------------------------------------------- Réunion
function MeetingScreen({ v, conn }: { v: PlayerView; conn: Conn }) {
  useTick(500);
  const now = conn.serverNow();
  const m = v.meeting!;
  const [choice, setChoice] = useState<string>();
  const room = v.terrain.rooms.find((r) => r.id === v.terrain.meetingRoomId)?.name;
  const alivePlayers = v.players.filter((p) => p.status === 'alive');
  const stageLabel = { gather: 'Rassemblement', discussion: 'Discussion', voting: 'Vote', result: 'Résultat' }[m.stage];
  return (
    <div class="wrap stack">
      <div class="card danger center">
        <h1>{m.kind === 'report' ? '💀 Corps signalé !' : m.kind === 'emergency' ? '🚨 Réunion d’urgence' : '📣 Réunion'}</h1>
        <p>
          {m.kind === 'report' && `${m.calledByName} a trouvé le corps de ${m.bodyOfName}.`}
          {m.kind === 'emergency' && `${m.calledByName} a convoqué une réunion.`}
          {m.kind === 'gm' && (m.bodyOfName ? `Le maître du jeu signale le corps de ${m.bodyOfName}.` : 'Convoquée par le maître du jeu.')}
        </p>
        {m.endedSabotage && <p>Le sabotage « {m.endedSabotage} » est interrompu.</p>}
      </div>
      <div class="card center">
        <div class="muted">{stageLabel}</div>
        <div style={{ fontSize: '2.4rem' }}>
          <Countdown until={m.stageEndsAt} now={now} />
        </div>
      </div>
      {m.newlyDead.length > 0 && (
        <div class="card">
          <strong>Morts depuis la dernière réunion :</strong> {m.newlyDead.map((d) => d.name).join(', ')}
        </div>
      )}
      {!v.me.alive && <div class="card ghost">👻 Vous êtes un fantôme : assistez en silence, sans aucun signe. Vous ne votez pas.</div>}

      {m.stage === 'gather' && (
        <div class="card stack">
          <p>
            Rejoignez <strong>{room}</strong> en marchant. Arrivé·es : {m.checkedInCount}/{m.aliveCount}
          </p>
          {v.me.alive &&
            (v.me.checkedIn ? (
              <p class="card ok">Vous êtes signalé·e présent·e.</p>
            ) : (
              <ActButton class="block big primary" run={() => conn.act({ type: 'checkIn' })}>
                Je suis arrivé·e
              </ActButton>
            ))}
        </div>
      )}

      {m.stage === 'discussion' && <p class="card">Discutez : qui était où ? Qu’avez-vous vu ? Le vote s’ouvre à la fin du compte à rebours.</p>}

      {m.stage === 'voting' && (
        <div class="card stack">
          <h2>Votez</h2>
          {m.myVote ? (
            <p class="card ok">Vote enregistré ({m.myVote === 'skip' ? 'passer' : v.players.find((p) => p.id === m.myVote)?.name}). Il ne peut plus être modifié.</p>
          ) : v.me.alive ? (
            <p class="muted">Touchez un joueur pour voter contre lui, ou « Passer ». Sans vote, vous vous abstenez.</p>
          ) : null}
          <ul class="list">
            {v.players
              .filter((p) => p.status !== 'left')
              .map((p) => (
                <li key={p.id} class={p.status === 'dead' ? 'dead' : ''}>
                  <span class="num">{p.num}</span>
                  <span class="grow">
                    {p.name}
                    {p.id === v.me.id ? ' (vous)' : ''}
                  </span>
                  {m.votedIds.includes(p.id) && <span class="badge">a voté</span>}
                  {p.status === 'alive' && v.me.alive && !m.myVote && (
                    <button class="btn small danger" onClick={() => setChoice(p.id)}>
                      Voter
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {v.me.alive && !m.myVote && (
            <button class="btn block" onClick={() => setChoice('skip')}>
              Passer (ne pas éjecter)
            </button>
          )}
          <small>
            {m.votedIds.length}/{alivePlayers.length} votes
          </small>
        </div>
      )}
      {choice && (
        <Modal title="Confirmer le vote" onClose={() => setChoice(undefined)}>
          <p>
            {choice === 'skip' ? 'Voter pour passer (personne n’est éjecté) ?' : `Voter contre ${v.players.find((p) => p.id === choice)?.name} ?`} Le vote est définitif.
          </p>
          <ActButton class="block big danger" run={async () => {
            const r = await conn.act({ type: 'vote', target: choice });
            setChoice(undefined);
            return r;
          }}>
            Confirmer
          </ActButton>
        </Modal>
      )}

      {m.stage === 'result' && m.result && <VoteResultCard v={v} />}
    </div>
  );
}

function VoteResultCard({ v }: { v: PlayerView }) {
  const r = v.meeting!.result!;
  const name = (id: string) => (id === 'skip' ? 'Passer' : v.players.find((p) => p.id === id)?.name ?? '?');
  let headline: string;
  if (r.ejectedId) {
    if (r.wasImpostor === undefined) headline = `${r.ejectedName} a été éjecté·e.`;
    else headline = `${r.ejectedName} ${r.wasImpostor ? 'était un imposteur' : 'n’était pas un imposteur'}.`;
  } else headline = r.tie ? 'Personne n’a été éjecté (égalité).' : 'Personne n’a été éjecté (vote passé).';
  return (
    <div class="card stack center">
      <h2>{headline}</h2>
      {r.impostorsLeft !== undefined && <p>{r.impostorsLeft} imposteur(s) restant(s).</p>}
      <table>
        <tbody>
          {Object.entries(r.tally)
            .sort((a, b) => b[1] - a[1])
            .map(([id, n]) => (
              <tr key={id}>
                <td>{name(id)}</td>
                <td>{n} voix</td>
              </tr>
            ))}
          <tr>
            <td>Passer</td>
            <td>{r.skips}</td>
          </tr>
          <tr>
            <td>Abstentions</td>
            <td>{r.abstentions}</td>
          </tr>
        </tbody>
      </table>
      {r.votes && (
        <details>
          <summary>Détail des votes</summary>
          <ul class="list">
            {Object.entries(r.votes).map(([voter, t]) => (
              <li key={voter}>
                {name(voter)} → {name(t)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p class="muted">Reprise de la partie dans quelques secondes…</p>
    </div>
  );
}

// ------------------------------------------------------------------- Fin de partie
export function EndRecap({ end }: { end: NonNullable<PlayerView['end']> }) {
  return (
    <>
      <div class={`card center ${end.winner === 'crew' ? 'ok' : end.winner === 'impostors' ? 'danger' : ''}`}>
        <h1>{end.winner === 'crew' ? 'Victoire de l’équipage' : end.winner === 'impostors' ? 'Victoire des imposteurs' : 'Partie arrêtée'}</h1>
        <p>{end.reason}</p>
        <p class="muted">
          Durée : {fmtSec(end.durationSec * 1000)} — tâches : {Math.round(end.taskBar * 100)} %
        </p>
      </div>
      <div class="card">
        <h3>Rôles</h3>
        <table>
          <thead>
            <tr>
              <th>Joueur</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Tâches</th>
            </tr>
          </thead>
          <tbody>
            {end.players.map((p) => (
              <tr key={p.id}>
                <td>
                  #{p.num} {p.name}
                </td>
                <td>
                  <span class={`badge ${p.role === 'impostor' ? 'imp' : 'crew'}`}>{roleLabel(p.role)}</span>
                </td>
                <td>
                  {p.status === 'alive' ? 'vivant·e' : p.deathCause === 'ejected' ? 'éjecté·e' : p.deathCause === 'left' ? 'parti·e' : p.killedByName ? `tué·e par ${p.killedByName}` : 'mort·e'}
                </td>
                <td>{p.role === 'impostor' ? `${p.kills} élim.` : `${p.tasksDone}/${p.tasksTotal}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {end.kills.length > 0 && (
        <div class="card">
          <h3>Éliminations</h3>
          <ul class="list">
            {end.kills.map((k, i) => (
              <li key={i}>
                {k.killer} → {k.victim}
              </li>
            ))}
          </ul>
        </div>
      )}
      {end.meetings.length > 0 && (
        <div class="card">
          <h3>Réunions</h3>
          <ul class="list">
            {end.meetings.map((m) => (
              <li key={m.id}>
                <div>
                  <strong>n°{m.id}</strong> {m.kind === 'report' ? `corps de ${m.bodyOfName} signalé par ${m.calledByName}` : m.kind === 'emergency' ? `urgence (${m.calledByName})` : 'convoquée par le MJ'}
                  {m.newlyDead.length > 0 && <div class="muted">Morts annoncés : {m.newlyDead.join(', ')}</div>}
                  <div>
                    {m.ejectedName ? `Éjecté·e : ${m.ejectedName} (${m.wasImpostor ? 'imposteur' : 'innocent·e'})` : m.tie ? 'Égalité' : 'Personne éjecté'} — {m.tally.map((t) => `${t.name} ${t.votes}`).join(', ')}
                    {m.skips ? `, passer ${m.skips}` : ''}
                  </div>
                  {m.votes && <div class="muted">{m.votes.map((x) => `${x.voter}→${x.target}`).join(' · ')}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {end.sabotages.length > 0 && (
        <div class="card">
          <h3>Sabotages</h3>
          <ul class="list">
            {end.sabotages.map((s, i) => (
              <li key={i}>
                {s.label}
                {s.roomName ? ` (${s.roomName})` : ''} par {s.byName} — {s.outcome}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function EndScreen({ v }: { v: PlayerView; conn: Conn }) {
  return (
    <div class="wrap stack">
      {v.end && <EndRecap end={v.end} />}
      <p class="card center">Restez connecté·e : si le maître du jeu relance une partie, vous serez automatiquement dans le nouveau salon.</p>
      <button class="btn block" onClick={() => go('/')}>
        Accueil
      </button>
    </div>
  );
}
