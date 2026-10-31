// Interface des joueurs (équipage, imposteurs, fantômes).
// Principe d'ergonomie : à chaque instant, l'écran dit quoi faire ensuite, en gros, en une ligne.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { GAMES, SABOTAGE_INFO, TASK_TYPE_LABEL } from '../shared/catalog';
import type { ChallengeView } from '../shared/engine';
import { GATHER_MAJORITY_SEC } from '../shared/settings';
import type { MyTask, PlayerView } from '../shared/view';
import { usePlayerAlerts } from './alerts';
import { AlertOverlay, AlertSetup } from './alerts-ui';
import { dropPlayer, go } from './conn';
import { GameView, gameInfo } from './games';
import type { Connection } from './net';
import { bodyCodeOf, bodyUrl, stationCodeOf } from './codes';
import { Practice } from './practice';
import { QR } from './qr';
import { Scanner } from './scanner';
import { useStore, useTick } from './store';
import { ActButton, Bar, buzz, CodeForm, Collapse, confirmDialog, Countdown, fmtSec, Modal, NetBadge, OfflineBanner, Reveal, setWakeLock, sound, toast, unlockAudio, wakeLockOn } from './ui';

type Conn = Connection<PlayerView>;

const roleLabel = (r?: string) => (r === 'impostor' ? 'Imposteur' : 'Équipage');

export function PlayerApp({ conn }: { conn: Conn }) {
  const st = useStore(conn.store);
  const v = st.view;
  usePlayerAlerts(v);

  if (st.kicked)
    return (
      <div class="wrap stack center">
        <h1>Vous avez été retiré·e de la partie</h1>
        <p>Le maître du jeu vous a exclu·e, ou votre session a été transférée sur un autre appareil.</p>
        <button class="btn block big" onClick={() => (dropPlayer(), go('/'))}>
          Retour à l’accueil
        </button>
      </div>
    );
  if (!v)
    return (
      <div class="wrap stack center" style={{ paddingTop: '20vh' }}>
        <span class="spinner big" />
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
        <span class="num" aria-label="Votre numéro">
          {v.me.num}
        </span>
        <span class="title grow">{v.me.name}</span>
        {!v.me.alive && v.phase !== 'lobby' && v.phase !== 'ended' && <span class="badge dead">👻 fantôme</span>}
        <NetBadge status={st.status} />
      </div>
      <OfflineBanner status={st.status} waiting={st.waiting} />
      <AlertOverlay />
      {v.emergencyStop && <StopScreen />}
      {v.paused && !v.emergencyStop && (
        <div class="pause">
          <div style={{ fontSize: '3rem' }}>⏸</div>
          <h1>Pause</h1>
          <p>Le maître du jeu a mis la partie en pause. Restez où vous êtes : toutes les actions et tous les comptes à rebours sont suspendus.</p>
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

function PlayerBody({ v, conn }: { v: PlayerView; conn: Conn }) {
  const seenKey = `imposteurs.seen.${v.code}.${v.gameNumber}.${v.me.id}`;
  const read = () => {
    try {
      return !!localStorage.getItem(seenKey);
    } catch {
      return false;
    }
  };
  const [seen, setSeen] = useState(read);
  useEffect(() => setSeen(read()), [seenKey]);

  if (v.phase === 'lobby') return <Lobby v={v} conn={conn} />;
  if (v.phase === 'ended') return <EndScreen v={v} />;
  if (!v.me.role)
    return (
      <div class="wrap stack">
        <div class="card">
          <h2>Partie en cours</h2>
          <p>Vous ne participez pas à cette manche. Restez connecté·e : vous serez automatiquement dans le salon de la prochaine partie.</p>
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
        <div style={{ fontSize: '2.2rem' }}>✅</div>
        <h2 style={{ margin: '4px 0' }}>Vous êtes inscrit·e, {v.me.name} !</h2>
        <p style={{ margin: 0 }}>
          Partie <strong>{v.code}</strong> · {v.players.length} joueur(s) · en attente du lancement par le maître du jeu.
        </p>
      </div>
      <h3 style={{ marginBottom: 0 }}>En attendant, préparez votre téléphone :</h3>
      <AlertSetup conn={conn} pushKey={v.pushKey} pushOnServer={v.pushOn} />
      <Collapse title="📷 Tester l’appareil photo (lecture des QR codes)">
        <Scanner
          onCode={async (raw) => {
            toast(`QR code lu (${raw.slice(-20)}) : votre téléphone est prêt !`, 'ok');
            return true;
          }}
        />
      </Collapse>
      <Collapse title="🎮 S’entraîner aux mini-jeux">
        <p class="muted">Pour découvrir les tâches avant la partie (rien n’est compté).</p>
        <Practice />
      </Collapse>
      <a class="btn block big" href="#/regles">
        📖 Les règles en 2 minutes
      </a>
      <SafetyCard v={v} />
      <Collapse title={`🏠 Le terrain : ${v.terrain.name}`}>
        <p>
          Salle de réunion : <strong>{meeting?.name}</strong>
        </p>
        {forbidden.length > 0 && (
          <p>
            <span class="badge imp">⛔ Interdit</span> {forbidden.map((r) => r.name).join(', ')}
          </p>
        )}
        {transit.length > 0 && (
          <p>
            <span class="badge warn">🚶 Passages : on marche, aucune élimination</span> {transit.map((r) => r.name).join(', ')}
          </p>
        )}
      </Collapse>
      <Collapse title="👥 Joueurs inscrits" count={v.players.length}>
        <ul class="list">
          {v.players.map((p) => (
            <li key={p.id}>
              <span class="num">{p.num}</span>
              {p.name}
              {p.id === v.me.id && <span class="badge">vous</span>}
            </li>
          ))}
        </ul>
      </Collapse>
      <ActButton
        class="block"
        confirm="Quitter le salon ?"
        confirmOk="Quitter"
        run={async () => {
          const r = await conn.act({ type: 'leave' });
          if (r.ok) {
            dropPlayer();
            go('/');
          }
          return r;
        }}
      >
        Quitter le salon
      </ActButton>
    </div>
  );
}

function SafetyCard({ v }: { v: PlayerView }) {
  return (
    <div class="card warn">
      <h3 style={{ marginTop: 0 }}>⚠️ Sécurité</h3>
      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{v.terrain.safetyNotes || 'Ne courez pas, ne verrouillez aucune porte, respectez les zones interdites.'}</p>
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
          <button class="veil" style={{ width: '100%', minHeight: '70dvh', border: 'none', color: 'inherit' }} onClick={() => (unlockAudio(), setShown(true))}>
            <div>
              <div style={{ fontSize: '3.5rem' }}>🤫</div>
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
          <p>Éliminez l’équipage sans vous faire démasquer, et sabotez pour semer le chaos (bouton « Actions » de l’onglet Rôle).</p>
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
  useTick(500);
  const now = conn.serverNow();
  const s = v.sabotage;
  if (!s || v.phase !== 'playing') return null;
  return (
    <div class={`alarm ${s.critical ? 'critical' : 'normal'}`} role="alert">
      <span style={{ fontSize: '1.5rem' }}>{s.critical ? '🚨' : '⚠️'}</span>
      <div class="grow">
        <div>
          {s.label}
          {s.deadline && (
            <>
              {' '}
              — <Countdown until={s.deadline} now={now} />
            </>
          )}
        </div>
        <small style={{ color: 'inherit' }}>
          {SABOTAGE_INFO[s.kind].short} {s.stations.map((x) => `${x.name} (${x.roomName})${x.fixed ? ' ✓' : x.held ? ' ✋' : ''}`).join(' · ')}
        </small>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Jeu
type Tab = 'tasks' | 'scan' | 'urgent' | 'role';

export interface Flash {
  /** Instant de la réussite (sert aussi d'identifiant). */
  id: number;
  msg: string;
}
const FLASH_MS = 6000;

function InGame({ v, conn }: { v: PlayerView; conn: Conn }) {
  const [tab, setTab] = useState<Tab>('tasks');
  const [flash, setFlash] = useState<Flash>();
  const [pending, setPending] = useState<string | undefined>(() => {
    const c = sessionStorage.getItem('imposteurs.pendingScan') ?? undefined;
    if (c) sessionStorage.removeItem('imposteurs.pendingScan');
    return c;
  });
  useEffect(() => {
    if (pending) setTab('scan');
  }, [pending]);
  useEffect(() => window.scrollTo(0, 0), [tab]);
  useReadyBuzz(v, conn);

  if (v.me.challenge)
    return (
      <ChallengeScreen
        v={v}
        c={v.me.challenge}
        conn={conn}
        onSuccess={(msg) => {
          // après une réussite : directement la prochaine étape, sans repasser par le poste
          setFlash({ id: Date.now(), msg });
          setTab('tasks');
        }}
      />
    );
  if (v.me.bodyPending) return <BodyScreen v={v} conn={conn} />;
  const left = v.me.tasks?.filter((t) => !t.done).length;

  return (
    <>
      <div class="wrap stack">
        {!v.me.alive && <GhostCard v={v} />}
        {tab === 'tasks' && <TasksTab v={v} flash={flash} goScan={() => setTab('scan')} />}
        {tab === 'scan' && <ScanTab v={v} conn={conn} initial={pending} onConsumed={() => setPending(undefined)} />}
        {tab === 'urgent' && <UrgentTab v={v} conn={conn} goScan={() => setTab('scan')} />}
        {tab === 'role' && <RoleTab v={v} conn={conn} />}
      </div>
      <nav class="tabs" aria-label="Navigation">
        {(
          [
            ['tasks', '📋', 'Tâches', left ? String(left) : undefined],
            ['scan', '📷', 'Poste', undefined],
            ['urgent', '🚨', 'Urgence', undefined],
            ['role', '🎭', 'Rôle', undefined],
          ] as const
        ).map(([k, ico, label, badge]) => (
          <button key={k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
            <span class="ico">
              {ico}
              {badge && <span class="tab-badge">{badge}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

/** Imposteur : courte vibration quand l'élimination ou le sabotage redevient disponible (plus besoin d'ouvrir l'écran pour vérifier). */
function useReadyBuzz(v: PlayerView, conn: Conn) {
  useTick(1000);
  const now = conn.serverNow();
  const imp = v.me.role === 'impostor' && v.phase === 'playing';
  const kill = imp && v.me.alive && now >= (v.me.killCooldownUntil ?? Infinity);
  const sab = imp && !v.sabotage && (v.sabotageOptions?.length ?? 0) > 0 && now >= (v.sabotageCooldownUntil ?? Infinity);
  const prev = useRef<{ kill: boolean; sab: boolean }>();
  useEffect(() => {
    if (v.paused || v.emergencyStop) return; // en pause, on garde l'état précédent : pas de vibration à la reprise
    const p = prev.current;
    prev.current = { kill, sab };
    if (!p) return;
    if (kill && !p.kill) buzz(READY_BUZZ.kill);
    else if (sab && !p.sab) buzz(READY_BUZZ.sabotage);
  }, [kill, sab, v.paused, v.emergencyStop]);
}
export const READY_BUZZ = { kill: [90], sabotage: [40, 70, 40] };

function GhostCard({ v }: { v: PlayerView }) {
  const imp = v.me.role === 'impostor';
  return (
    <div class="card ghost stack">
      {v.me.deathRevealed ? (
        <p style={{ margin: 0 }}>
          <strong>👻 Vous êtes un fantôme.</strong> Badge FANTÔME bien visible, silence total avec les vivants.{' '}
          {imp ? 'Vous pouvez encore saboter (onglet Rôle → Actions), mais plus éliminer.' : 'Terminez vos tâches pour aider l’équipage.'}
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          <strong>👻 Vous êtes mort·e, mais personne ne le sait encore.</strong> Ne portez pas encore le badge FANTÔME : il s’accroche à la prochaine réunion, quand votre mort
          sera annoncée. D’ici là, silence total, ne répondez à personne{imp ? ' ; vous pouvez encore saboter.' : ' ; faites vos tâches discrètement.'} Si votre
          élimination vous semble injuste, parlez-en au maître du jeu, en privé.
        </p>
      )}
    </div>
  );
}

function TaskBarCard({ v }: { v: PlayerView }) {
  if (v.taskBar === undefined) {
    if (v.sabotage?.kind === 'comms') return <div class="card warn">📡 Communications coupées : progression indisponible.</div>;
    return null;
  }
  return (
    <div class="card">
      <div class="row">
        <strong class="grow">Progression de l’équipage</strong>
        <span class="big-num">{Math.round(v.taskBar * 100)} %</span>
      </div>
      <Bar value={v.taskBar} label="Progression de l’équipage" />
      {v.settings.taskBarUpdates === 'meetings' && <small>Mise à jour uniquement pendant les réunions.</small>}
    </div>
  );
}

function where(t: MyTask) {
  return t.next ? `${t.next.roomName}${t.next.floor ? ` (${t.next.floor})` : ''}` : '';
}

function TasksTab({ v, goScan, flash }: { v: PlayerView; goScan: () => void; flash?: Flash }) {
  const tasks = v.me.tasks ?? [];
  // ordre d'affichage : les plus proches d'abord (même pièce, puis même étage), puis l'ordre personnel du joueur
  const todo = tasks.map((t, i) => ({ t, i })).filter((x) => !x.t.done).sort((a, b) => (a.t.near ?? 2) - (b.t.near ?? 2) || a.i - b.i).map((x) => x.t);
  const done = tasks.filter((t) => t.done);
  const next = todo.find((t) => t.taskId === v.me.nextTaskId) ?? todo[0];
  // regroupement par pièce : on voit d'un coup d'œil où aller (la pièce de la prochaine étape en premier)
  const rooms = new Map<string, MyTask[]>();
  if (next) rooms.set(where(next), []);
  for (const t of todo) rooms.set(where(t), [...(rooms.get(where(t)) ?? []), t]);
  // le message de réussite reste 6 s, et ne réapparaît pas en revenant plus tard sur l'onglet
  const fresh = !!flash && Date.now() - flash.id < FLASH_MS;
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => redraw((n) => n + 1), FLASH_MS - (Date.now() - flash!.id) + 20);
    return () => clearTimeout(t);
  }, [flash?.id]);
  return (
    <>
      {flash && fresh && (
        <div class="card ok flash" role="status">
          ✅ <strong>{flash.msg}</strong>
        </div>
      )}
      {v.me.tasksHidden ? (
        <div class="card warn">
          <h2 style={{ marginTop: 0 }}>📡 Communications coupées</h2>
          <p>Votre liste de tâches est indisponible. Vous pouvez faire une tâche dont vous vous souvenez du poste, ou aller réparer au poste Radio.</p>
        </div>
      ) : next ? (
        <button class="card next-step" onClick={goScan}>
          <small>Prochaine étape : {where(next)}</small>
          <strong>{next.next?.stationName}</strong>
          <span>
            {next.name}
            {next.steps > 1 ? ` (étape ${next.step + 1}/${next.steps})` : ''}
            {next.near === 0 ? ' · ici même' : next.near === 1 ? ' · même étage' : ''}
          </span>
          <span class="muted">Une fois sur place, touchez ici : la caméra s’ouvre →</span>
        </button>
      ) : (
        <div class="card ok center">
          <h2 style={{ margin: 0 }}>✅ Toutes vos tâches sont faites !</h2>
          {/* texte identique pour tous les rôles : l'écran d'un imposteur ne doit rien trahir */}
          <p style={{ margin: 0 }}>Observez, protégez les autres et aidez à réparer les sabotages.</p>
        </div>
      )}
      <TaskBarCard v={v} />
      {!v.me.tasksHidden && tasks.length > 0 && (
        <div class="card">
          <div class="row">
            <h2 class="grow" style={{ margin: 0 }}>
              Mes tâches
            </h2>
            <span class="badge">
              {done.length}/{tasks.length} faites
            </span>
          </div>
          {[...rooms.entries()].map(([room, list]) => (
            <div key={room}>
              <h3 class="room-title">📍 {room}</h3>
              <ul class="list">
                {list.map((t) => (
                  <li key={t.taskId}>
                    <span style={{ fontSize: '1.3rem' }}>⬜</span>
                    <div class="grow">
                      <strong>{t.name}</strong>{' '}
                      <small>
                        ({TASK_TYPE_LABEL[t.type]}
                        {t.steps > 1 ? `, étape ${t.step + 1}/${t.steps}` : ''})
                      </small>
                      <div class="muted">{t.next?.stationName}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {done.length > 0 && (
            <ul class="list">
              {done.map((t) => (
                <li key={t.taskId} class="done">
                  <span style={{ fontSize: '1.3rem' }}>✅</span>
                  <span class="grow">{t.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p class="muted center" style={{ fontSize: '0.9rem' }}>
        Marchez jusqu’au poste, puis onglet « Poste » pour scanner son QR code. Ne regardez pas votre écran dans l’escalier.
      </p>
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

/** Signale un corps après confirmation. Retourne undefined si le joueur a renoncé. */
export async function reportBody(conn: Conn, code: string): Promise<boolean | undefined> {
  if (!(await confirmDialog('Signaler ce corps ? Une réunion commence pour tout le monde.', { ok: 'Signaler le corps', danger: true }))) return undefined;
  const r = await conn.act({ type: 'report', code });
  if (!r.ok) toast(r.msg ?? 'Refusé', 'err');
  return r.ok;
}

function ScanTab({ v, conn, initial, onConsumed }: { v: PlayerView; conn: Conn; initial?: string; onConsumed: () => void }) {
  const [station, setStation] = useState<{ code: string; info: ScanResult }>();
  const status = useStore(conn.store).status;
  const scan = async (raw: string) => {
    const body = bodyCodeOf(raw);
    if (body) return reportBody(conn, body);
    const code = stationCodeOf(raw);
    if (!code) {
      toast('Ce QR code n’est pas celui d’un poste ni d’un corps.', 'err');
      return false;
    }
    raw = code;
    const r = await conn.act<ScanResult>({ type: 'scan', code: raw });
    if (!r.ok) {
      toast(r.msg ?? 'Code refusé.', 'err');
      return false;
    }
    buzz(40);
    const info = r.data!;
    // une seule tâche à faire ici : on la lance tout de suite (un toucher de moins)
    if (info.kind === 'task' && !info.block && info.tasks?.length === 1) {
      const t = await conn.act({ type: 'startTask', code: raw, taskId: info.tasks[0].taskId });
      if (t.ok) return true;
      toast(t.msg ?? 'Refusé', 'err');
    }
    setStation({ code: raw, info });
    return true;
  };
  useEffect(() => {
    if (initial && status === 'online') {
      onConsumed();
      void scan(initial);
    }
  }, [initial, status]);

  if (station) return <StationPanel v={v} conn={conn} code={station.code} info={station.info} close={() => setStation(undefined)} rescan={() => scan(station.code)} />;
  return (
    <div class="card stack">
      <h2 style={{ margin: 0 }}>Utiliser un poste</h2>
      <p class="muted" style={{ margin: 0 }}>
        Tâches, bouton d’urgence, réparations, moniteur de vie : tout se fait en scannant la fiche du poste, sur place. Pour signaler un corps, scannez le QR code affiché par son téléphone.
      </p>
      <Scanner onCode={scan} autoStart />
    </div>
  );
}

function StationPanel({ v, conn, code, info, close, rescan }: { v: PlayerView; conn: Conn; code: string; info: ScanResult; close: () => void; rescan: () => void }) {
  // les informations du poste sont rafraîchies quand l'état de la partie change
  const key = `${v.sabotage?.kind}-${v.sabotage?.stations.map((s) => s.fixed).join()}-${v.me.tasks?.map((t) => t.step).join()}-${v.me.alive}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    rescan();
  }, [key]);
  return (
    <div class="card stack">
      <div class="row">
        <div class="grow">
          <small class="muted">Poste scanné</small>
          <h2 style={{ margin: 0 }}>{info.name}</h2>
          <small>📍 {info.roomName}</small>
        </div>
      </div>
      {info.block && <p class="card warn">{info.block}</p>}
      {info.kind === 'task' &&
        (info.tasks && info.tasks.length > 0 ? (
          <>
            <p style={{ margin: 0 }}>Choisissez la tâche à faire ici :</p>
            {info.tasks.map((t) => (
              <ActButton key={t.taskId} class="block big primary" disabled={!!info.block} run={() => conn.act({ type: 'startTask', code, taskId: t.taskId })}>
                ▶ {t.name}
                {t.steps > 1 ? ` (étape ${t.step}/${t.steps})` : ''}
                <small style={{ display: 'block', fontWeight: 500 }}>{GAMES[t.game as keyof typeof GAMES]?.label}</small>
              </ActButton>
            ))}
          </>
        ) : (
          <p>Aucune de vos tâches ne se fait à ce poste pour l’instant. Vérifiez l’onglet Tâches.</p>
        ))}
      {info.kind === 'emergency' && (
        <>
          <p style={{ margin: 0 }}>Réunions d’urgence restantes : {info.emergencyLeft ?? 0}</p>
          <ActButton
            class="block big danger"
            disabled={!!info.block}
            confirm="Convoquer une réunion d’urgence ? Tout le monde sera appelé en salle de réunion."
            confirmOk="Convoquer"
            run={() => conn.act({ type: 'callEmergency', code })}
          >
            🚨 RÉUNION D’URGENCE
          </ActButton>
        </>
      )}
      {info.kind === 'vitals' && info.vitals && (
        <ul class="list">
          {info.vitals.map((p) => (
            <li key={p.id} class={p.status !== 'alive' ? 'done' : ''}>
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
      <button class="btn block" onClick={close}>
        📷 Scanner un autre poste
      </button>
    </div>
  );
}

function ReactorHold({ v, conn, code }: { v: PlayerView; conn: Conn; code: string }) {
  const [on, setOn] = useState(false);
  const holding = useRef(false);
  const timer = useRef<number>();
  const stop = () => {
    clearInterval(timer.current);
    if (holding.current) void conn.act({ type: 'hold', code, on: false });
    holding.current = false;
    setOn(false);
  };
  const beat = async () => {
    const r = await conn.act<{ fixed?: boolean }>({ type: 'hold', code, on: true });
    if (!holding.current) return;
    if (!r.ok) {
      toast(r.msg ?? 'Refusé', 'err');
      stop();
    } else if (r.data?.fixed) {
      toast('Réacteur stabilisé !', 'ok');
      holding.current = false;
      stop();
    }
  };
  const start = () => {
    if (holding.current) return;
    unlockAudio();
    holding.current = true;
    setOn(true);
    void beat();
    timer.current = window.setInterval(() => void beat(), 1000);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  if (v.sabotage?.kind !== 'reactor') return <p>Le réacteur fonctionne normalement.</p>;
  const held = v.sabotage.stations.filter((s) => s.held).length;
  return (
    <div class="stack">
      <p style={{ margin: 0 }}>
        Maintenez le bouton appuyé. Une autre personne doit faire de même <strong>en même temps</strong> à l’autre poste Réacteur (criez-vous « prêt ? »).
      </p>
      <div class="center big-num">Postes tenus : {held}/2</div>
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
/**
 * Mini-jeu en cours. Après une réponse acceptée, il n'est plus jamais réaffiché : sans cela, il se relançait
 * le temps que l'écran se ferme (un mini-jeu à durée renvoyait même sa réponse, refusée par le serveur
 * avec « ce mini-jeu n'est plus actif », alors que la tâche venait d'être validée).
 * `onBusy` signale l'envoi en cours : le bouton « Abandonner » est alors masqué (il remontait sous le doigt).
 */
export function ChallengeBody({ c, submit, serverNow, onBusy }: { c: ChallengeView; submit: (answer: unknown) => Promise<boolean>; serverNow: () => number; onBusy?: (busy: boolean) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<'play' | 'sending' | 'ok'>('play');
  const busy = useRef(false);
  useEffect(() => onBusy?.(stage !== 'play'), [stage]);
  if (stage === 'ok')
    return (
      <div class="card ok center" role="status">
        ✅ Validé
      </div>
    );
  return stage === 'sending' ? (
    <div class="card center">
      <span class="spinner" /> Validation par le serveur…
    </div>
  ) : (
    <GameView
      key={attempt}
      c={c}
      serverNow={serverNow}
      done={async (answer) => {
        if (busy.current) return;
        busy.current = true;
        setStage('sending');
        const wait = c.startedAt + c.minMs - serverNow();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait + 150));
        const ok = await submit(answer);
        busy.current = false;
        if (ok) return setStage('ok');
        setStage('play');
        setAttempt((a) => a + 1);
      }}
    />
  );
}

function ChallengeScreen({ v, c, conn, onSuccess }: { v: PlayerView; c: ChallengeView; conn: Conn; onSuccess: (msg: string) => void }) {
  const info = gameInfo(c.game);
  const [busy, setBusy] = useState(false);
  return (
    <div class="overlay">
      <div class="wrap stack">
        <div>
          <small class="muted">
            {c.stationName} · {info?.label}
          </small>
          <h2 style={{ margin: 0 }}>{c.purpose === 'fix' ? info?.label : c.taskName}</h2>
        </div>
        <p class="hint">{info?.hint}</p>
        {v.sabotage && v.sabotage.critical && c.purpose !== 'fix' && <p class="card danger">🚨 {v.sabotage.label} en cours !</p>}
        <ChallengeBody
          key={c.id}
          c={c}
          serverNow={() => conn.serverNow()}
          onBusy={setBusy}
          submit={async (answer) => {
            const r = await conn.act<{ taskDone?: boolean; fixed?: boolean; partial?: boolean; nextStep?: number }>({ type: 'submit', challengeId: c.id, answer });
            if (!r.ok) {
              toast(r.msg ?? 'Refusé', 'err');
              return false;
            }
            const d = r.data ?? {};
            // messages identiques pour une vraie tâche et une tâche simulée par un imposteur
            const msg = d.taskDone
              ? 'Tâche terminée !'
              : d.nextStep
                ? `Étape validée ! Étape ${d.nextStep} : voir ci-dessous.`
                : d.fixed
                  ? 'Sabotage réparé !'
                  : d.partial
                    ? 'Poste réparé : il faut aussi réparer l’autre poste !'
                    : 'Terminé.';
            sound('success');
            buzz(60);
            onSuccess(msg);
            return true;
          }}
        />
        {/* séparé du mini-jeu et confirmé : un toucher égaré (cibles, STOP…) ne doit pas faire perdre la tâche */}
        {!busy && (
          <div style={{ marginTop: '28px' }}>
            <ActButton
              class="block small"
              confirm="Abandonner ce mini-jeu ? L’étape n’est pas validée : il faudra rescanner le poste pour la refaire."
              confirmOk="Abandonner"
              run={() => conn.act({ type: 'cancelChallenge' })}
            >
              Abandonner ce mini-jeu
            </ActButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Corps
function BodyScreen({ v, conn }: { v: PlayerView; conn: Conn }) {
  useTick(1000);
  const now = conn.serverNow();
  const b = v.me.body!;
  // l'écran doit rester allumé pour que le code reste lisible par celui qui découvre le corps
  useEffect(() => {
    const before = wakeLockOn();
    void setWakeLock(true);
    return () => {
      if (!before) void setWakeLock(false);
    };
  }, []);
  return (
    <div class="wrap stack center body-screen">
      <div class="card danger">
        <h1 style={{ marginTop: 0 }}>💀 Vous avez été éliminé·e</h1>
        <p style={{ margin: 0 }}>
          <strong>Asseyez-vous calmement sur place</strong> (jamais dans un escalier ni un passage), silencieux·se et immobile, écran tourné vers l’extérieur. Ne révélez jamais qui
          vous a éliminé·e.
        </p>
      </div>
      <div class="card stack">
        <p style={{ margin: 0 }}>Code du corps — lisible de loin, ou QR code à scanner (onglet Poste) :</p>
        <div class="body-code" aria-label={`Code du corps ${b.code}`}>
          {b.code}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <QR text={bodyUrl(b.code)} size={210} />
        </div>
      </div>
      {v.sabotage?.kind === 'lights' && <p class="card warn">Panne de courant : personne ne peut vous signaler tant qu’elle n’est pas réparée.</p>}
      {b.vanishAt && (
        <p class="muted">
          Si personne ne vous trouve, votre corps disparaît dans <Countdown until={b.vanishAt} now={now} /> : vous deviendrez un fantôme, sans badge jusqu’à la prochaine réunion.
        </p>
      )}
      <ActButton class="block" run={() => conn.act({ type: 'alert', message: 'Alerte envoyée par un corps' })} okMsg="Le maître du jeu est prévenu.">
        ⚠️ Alerte sécurité
      </ActButton>
    </div>
  );
}

// ------------------------------------------------------------------- Urgence
function UrgentTab({ v, conn, goScan }: { v: PlayerView; conn: Conn; goScan: () => void }) {
  const [modal, setModal] = useState<'body' | 'alert' | 'meeting' | 'killed'>();
  useTick(1000);
  const now = conn.serverNow();
  const meetingRoom = v.terrain.rooms.find((r) => r.id === v.terrain.meetingRoomId)?.name;
  return (
    <>
      <h2 style={{ margin: '4px 0' }}>Que se passe-t-il ?</h2>
      {v.me.alive && (
        <>
          {/* bouton présent sur tous les téléphones (imposteurs compris) : l'écran ne trahit aucun rôle */}
          <button class="btn big block danger action" onClick={() => setModal('killed')}>
            <span>🗡</span> On vient de m’éliminer
          </button>
          <button class="btn big block danger action" onClick={() => setModal('body')}>
            <span>💀</span> J’ai trouvé un corps
          </button>
          <button class="btn big block action" onClick={() => setModal('meeting')}>
            <span>🚨</span> Je veux une réunion d’urgence
          </button>
        </>
      )}
      <button class="btn big block action" onClick={() => setModal('alert')}>
        <span>⚠️</span> Alerte sécurité / je dois arrêter
      </button>
      {modal === 'body' && (
        <Modal title="💀 Signaler un corps" onClose={() => setModal(undefined)}>
          {v.sabotage?.kind === 'lights' && <p class="card warn">Panne de courant : dans le noir, impossible de signaler un corps. Réparez d’abord au poste Énergie.</p>}
          <button class="btn big block primary" onClick={() => (setModal(undefined), goScan())}>
            📷 Scanner le QR code du corps
          </button>
          <p class="muted center" style={{ margin: '4px 0' }}>
            — ou tapez le code en gros sur son écran —
          </p>
          <CodeForm
            label="Code du corps (4 chiffres)"
            digits
            length={4}
            autoFocus
            button="Signaler le corps"
            btnClass="danger"
            submit={async (code) => {
              const r = await conn.act({ type: 'report', code });
              if (!r.ok) toast(r.msg ?? 'Refusé', 'err');
              else setModal(undefined);
              return r.ok;
            }}
          />
        </Modal>
      )}
      {modal === 'meeting' && (
        <Modal title="🚨 Réunion d’urgence" onClose={() => setModal(undefined)}>
          <p>
            Allez au <strong>bouton d’urgence</strong> ({meetingRoom}) et scannez-le. Il vous reste <strong>{v.me.emergencyLeft}</strong> réunion(s).
          </p>
          {now < v.emergencyCooldownUntil && (
            <p class="card warn">
              Bouton disponible dans <Countdown until={v.emergencyCooldownUntil} now={now} />.
            </p>
          )}
          {v.sabotage && <p class="card warn">Impossible pendant un sabotage : réparez-le d’abord.</p>}
          <button class="btn big block primary" onClick={() => (setModal(undefined), goScan())}>
            📷 Je suis au bouton : scanner
          </button>
        </Modal>
      )}
      {modal === 'alert' && <AlertModal conn={conn} close={() => setModal(undefined)} />}
      {modal === 'killed' && v.me.alive && <KilledModal v={v} conn={conn} close={() => setModal(undefined)} />}
      <div class="spacer" />
      <ActButton
        class="block small"
        confirm="Quitter définitivement la partie ? Vous serez compté·e comme parti·e (vos tâches sont retirées)."
        confirmOk="Quitter la partie"
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

/**
 * La victime déclare elle-même son élimination en choisissant qui l'a touchée. Tous les joueurs vivants sont
 * proposés (rien n'indique qui est imposteur) et, une fois validé, ce nom n'est plus jamais affiché sur ce
 * téléphone : celui qui découvre le corps (ou qui regarde par-dessus l'épaule) ne peut pas le lire.
 */
function KilledModal({ v, conn, close }: { v: PlayerView; conn: Conn; close: () => void }) {
  const [killer, setKiller] = useState<string>();
  const [filter, setFilter] = useState('');
  const others = v.players.filter((p) => p.status === 'alive' && p.id !== v.me.id).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const shown = filter ? others.filter((p) => norm(p.name).includes(norm(filter))) : others;
  return (
    <Modal title="🗡 On vient de m’éliminer" onClose={close}>
      <p style={{ margin: 0 }}>
        Un imposteur vous a touché·e ? Choisissez discrètement qui, cachez votre écran. Ce nom ne s’affichera plus jamais sur votre téléphone.
      </p>
      {v.phase !== 'playing' || v.paused || v.emergencyStop ? (
        <p class="card warn">Impossible pendant une réunion ou une pause : parlez-en au maître du jeu.</p>
      ) : (
        <>
          {others.length > 8 && <input type="search" placeholder="Rechercher un pseudonyme" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} aria-label="Rechercher un pseudonyme" />}
          <div class="name-grid">
            {shown.map((p) => (
              <button key={p.id} class={`btn name ${killer === p.id ? 'sel' : ''}`} onClick={() => setKiller(p.id)}>
                {p.name}
              </button>
            ))}
            <button class={`btn name ${killer === 'unknown' ? 'sel' : ''}`} onClick={() => setKiller('unknown')}>
              Je n’ai pas vu qui
            </button>
          </div>
          <ActButton
            class="block big danger"
            disabled={!killer}
            confirm="Confirmer votre élimination ? C’est définitif : vous devenez un corps."
            confirmOk="Je suis éliminé·e"
            run={async () => {
              const r = await conn.act({ type: 'killedBy', killer });
              if (r.ok) {
                buzz(60);
                close();
              }
              return r;
            }}
          >
            {killer ? 'Valider mon élimination' : 'Choisissez qui vous a touché·e'}
          </ActButton>
        </>
      )}
    </Modal>
  );
}

function AlertModal({ conn, close }: { conn: Conn; close: () => void }) {
  const [msg, setMsg] = useState('');
  return (
    <Modal title="⚠️ Alerte sécurité" onClose={close}>
      <p>Le maître du jeu reçoit immédiatement votre alerte (sonnerie). Urgence vitale : appelez le 112.</p>
      <div class="grid-buttons">
        {['Je me suis blessé·e', 'Je ne me sens pas bien', 'Je veux arrêter', 'Problème de sécurité'].map((m) => (
          <button key={m} class={`btn ${msg === m ? 'primary' : ''}`} onClick={() => setMsg(m)}>
            {m}
          </button>
        ))}
      </div>
      <textarea rows={2} placeholder="Précisions (facultatif)" value={msg} onInput={(e) => setMsg((e.target as HTMLTextAreaElement).value)} />
      <ActButton
        class="block big danger"
        okMsg="Alerte envoyée au maître du jeu."
        run={async () => {
          const r = await conn.act({ type: 'alert', message: msg || 'Alerte sécurité' });
          if (r.ok) close();
          return r;
        }}
      >
        Envoyer l’alerte
      </ActButton>
    </Modal>
  );
}

// ------------------------------------------------------------------- Rôle (et actions d'imposteur)
function RoleTab({ v, conn }: { v: PlayerView; conn: Conn }) {
  const imp = v.me.role === 'impostor';
  return (
    <>
      {/* Deux voiles identiques pour tous les rôles : l'onglet ne trahit rien tant qu'on ne touche pas. */}
      <ActionsVeil>{imp ? <ImpostorActions v={v} conn={conn} /> : <CrewActions v={v} />}</ActionsVeil>
      <Reveal label="Mon rôle">
        <RoleCard v={v} />
        {!imp && !v.me.alive && <p class="card ghost">Fantôme d’équipage : terminez vos tâches. Vous ne pouvez plus voter, signaler ni réparer.</p>}
      </Reveal>
      <FacadeButton v={v} />
      <a class="btn block" href="#/regles">
        📖 Règles du jeu
      </a>
      <Collapse title="🔔 Alertes de ce téléphone">
        <AlertSetup conn={conn} pushKey={v.pushKey} pushOnServer={v.pushOn} compact />
      </Collapse>
      <SafetyCard v={v} />
    </>
  );
}

/** Masquage du panneau d'actions après 30 s sans le toucher, ou dès que l'application passe en arrière-plan. */
export const ACTIONS_IDLE_MS = 30_000;

function ActionsVeil({ children }: { children: ComponentChildren }) {
  const [shown, setShown] = useState(false);
  const [poke, setPoke] = useState(0);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), ACTIONS_IDLE_MS);
    const hide = () => document.visibilityState !== 'visible' && setShown(false);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [shown, poke]);
  return shown ? (
    <div class="card stack actions-panel" onPointerDown={() => setPoke((n) => n + 1)} onInput={() => setPoke((n) => n + 1)}>
      {children}
      <button class="btn block small" onClick={() => setShown(false)}>
        🙈 Masquer
      </button>
    </div>
  ) : (
    <button class="veil veil-small" style={{ width: '100%', border: 'none', color: 'inherit' }} onClick={() => setShown(true)}>
      <div>
        <strong>⚙️ Actions</strong>
        <div class="muted">Touchez pour afficher. Cachez votre écran.</div>
      </div>
    </button>
  );
}

function CrewActions({ v }: { v: PlayerView }) {
  return (
    <p style={{ margin: 0 }}>
      Pas d’action secrète : {v.me.alive ? 'faites vos tâches, signalez les corps et réparez les sabotages.' : 'terminez vos tâches en silence.'}
    </p>
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
            <RoleCard v={{ ...v, me: { ...v.me, role: 'crewmate' } }} />
            <p class="muted center">Touchez pour fermer</p>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Panneau d'actions des imposteurs : couleurs neutres, sans la carte de rôle, pour qu'un regard
 * par-dessus l'épaule ne voie qu'une liste de noms et de boutons ordinaires.
 */
function ImpostorActions({ v, conn }: { v: PlayerView; conn: Conn }) {
  useTick(1000);
  const now = conn.serverNow();
  const cd = v.me.killCooldownUntil ?? 0;
  const sabCd = v.sabotageCooldownUntil ?? 0;
  const killReady = v.me.alive && now >= cd;
  return (
    <div class="stack">
      <div class="status-lines">
        {v.me.alive && (
          <div class="row">
            <span class="grow">Élimination</span>
            <strong>{killReady ? 'prête' : fmtSec(cd - now)}</strong>
          </div>
        )}
        <div class="row">
          <span class="grow">Sabotage</span>
          <strong>{v.sabotage ? 'en cours' : now >= sabCd ? 'prêt' : fmtSec(sabCd - now)}</strong>
        </div>
      </div>
      {v.me.alive && (
        <p class="muted" style={{ margin: 0 }}>
          {killReady ? 'Touchez l’épaule de la personne : c’est elle qui déclare son élimination sur son téléphone. Vous n’avez rien à saisir.' : 'Attendez la fin du délai avant de toucher quelqu’un.'}{' '}
          Jamais dans un escalier ou un passage.
        </p>
      )}
      <div class="stack">
        {v.sabotage ? (
          <p style={{ margin: 0 }}>En cours : {v.sabotage.label}.</p>
        ) : (
          v.sabotageOptions?.map((k) => (
            <ActButton
              key={k}
              class="block"
              disabled={now < sabCd}
              confirm={`Déclencher « ${SABOTAGE_INFO[k].label} » ?\n${SABOTAGE_INFO[k].short}`}
              confirmOk="Déclencher"
              run={() => conn.act({ type: 'sabotage', kind: k })}
              okMsg="Déclenché."
            >
              {SABOTAGE_INFO[k].label}
              {SABOTAGE_INFO[k].critical ? ' (critique)' : ''}
            </ActButton>
          ))
        )}
        <small>Délai partagé entre tous les imposteurs. Votre téléphone vibre brièvement quand une action redevient possible (Android).</small>
      </div>
      {v.terrain.passages && v.terrain.passages.length > 0 && v.me.alive && (
        <Collapse title="🕳 Conduits">
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
          <small>En marchant. Être vu sortir d’un conduit est une preuve !</small>
        </Collapse>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Réunion
const STAGES = [
  ['gather', 'Rassemblement'],
  ['discussion', 'Discussion'],
  ['voting', 'Vote'],
  ['result', 'Résultat'],
] as const;

function MeetingScreen({ v, conn }: { v: PlayerView; conn: Conn }) {
  useTick(500);
  const now = conn.serverNow();
  const m = v.meeting!;
  const [choice, setChoice] = useState<string>();
  useEffect(() => setChoice(undefined), [m.stage]);
  const room = v.terrain.rooms.find((r) => r.id === v.terrain.meetingRoomId)?.name;
  const alive = v.players.filter((p) => p.status === 'alive');
  const dead = v.players.filter((p) => p.status === 'dead');
  const name = (id?: string) => (id === 'skip' ? 'Passer' : v.players.find((p) => p.id === id)?.name);
  const left = m.stageEndsAt - now;
  return (
    <div class="wrap stack" style={{ paddingBottom: choice ? '160px' : undefined }}>
      <div class="meeting-head">
        <div class="row">
          <span style={{ fontSize: '1.8rem' }}>{m.kind === 'report' ? '💀' : m.kind === 'emergency' ? '🚨' : '📣'}</span>
          <div class="grow">
            <strong>{m.kind === 'report' ? 'Corps signalé' : m.kind === 'emergency' ? 'Réunion d’urgence' : 'Réunion'}</strong>
            <div class="muted" style={{ fontSize: '0.9rem' }}>
              {m.kind === 'report' && `${m.calledByName} a trouvé le corps de ${m.bodyOfName}`}
              {m.kind === 'emergency' && `convoquée par ${m.calledByName}`}
              {m.kind === 'gm' && (m.bodyOfName ? `corps de ${m.bodyOfName} (signalé par le MJ)` : 'convoquée par le maître du jeu')}
            </div>
          </div>
          <span class={`big-num ${left < 10_000 ? 'hot' : ''}`}>{fmtSec(left)}</span>
        </div>
        <div class="stepper">
          {STAGES.map(([k, l]) => (
            <span key={k} class={k === m.stage ? 'on' : STAGES.findIndex((x) => x[0] === k) < STAGES.findIndex((x) => x[0] === m.stage) ? 'past' : ''}>
              {l}
            </span>
          ))}
        </div>
      </div>
      {m.endedSabotage && <p class="card">Le sabotage « {m.endedSabotage} » est interrompu.</p>}
      {m.newlyDead.length > 0 && (
        <div class="card danger">
          <strong>💀 Morts depuis la dernière réunion :</strong> {m.newlyDead.map((d) => d.name).join(', ')}
        </div>
      )}
      {!v.me.alive && (
        <div class="card ghost">
          👻 Fantôme : votre mort est maintenant annoncée, <strong>accrochez votre badge FANTÔME</strong>. Assistez en silence, sans aucun signe. Vous ne votez pas.
        </div>
      )}

      {m.stage === 'gather' && (
        <div class="card stack center">
          <p style={{ margin: 0 }}>
            Rejoignez la salle de réunion : <strong>{room}</strong>, en marchant.
          </p>
          <div class="big-num">
            {m.checkedInCount}/{m.aliveCount} arrivé·es
          </div>
          {2 * m.checkedInCount > m.aliveCount && m.checkedInCount < m.aliveCount && (
            <p class="muted" style={{ margin: 0 }}>
              La majorité est là : la discussion commence dans {GATHER_MAJORITY_SEC} s au plus, même sans les retardataires.
            </p>
          )}
          {v.me.alive &&
            (v.me.checkedIn ? (
              <p class="card ok">✅ Vous êtes signalé·e présent·e. La discussion commence quand tout le monde est là.</p>
            ) : (
              <ActButton class="block big primary" run={() => conn.act({ type: 'checkIn' })}>
                Je suis arrivé·e
              </ActButton>
            ))}
        </div>
      )}

      {m.stage === 'discussion' && (
        <div class="card stack">
          <p style={{ margin: 0 }}>
            <strong>Discutez !</strong> Qui était où ? Qu’avez-vous vu ? Le vote s’ouvre dès que la majorité est prête, ou à la fin du compte à rebours.
          </p>
          {v.me.alive &&
            (m.myReady ? (
              <p class="card ok" style={{ margin: 0 }}>
                ✅ Vous êtes prêt·e à voter ({m.readyCount}/{Math.floor(m.aliveCount / 2) + 1} nécessaires).
              </p>
            ) : (
              <ActButton class="block big primary" run={() => conn.act({ type: 'readyVote' })}>
                ✋ Prêt à voter ({m.readyCount}/{Math.floor(m.aliveCount / 2) + 1})
              </ActButton>
            ))}
          {!v.me.alive && (
            <small class="center">
              Prêts à voter : {m.readyCount}/{Math.floor(m.aliveCount / 2) + 1}
            </small>
          )}
          <PlayerChips alive={alive} dead={dead} meId={v.me.id} />
        </div>
      )}

      {m.stage === 'voting' && (
        <div class="card stack">
          {m.myVote ? (
            <p class="card ok" style={{ margin: 0 }}>
              ✅ Vote enregistré : <strong>{name(m.myVote)}</strong>. Il ne peut plus être modifié.
            </p>
          ) : v.me.alive ? (
            <p style={{ margin: 0 }}>
              <strong>Votez :</strong> touchez un joueur, ou « Passer ». Sans vote, vous vous abstenez.
            </p>
          ) : null}
          <div class="vote-grid">
            {alive.map((p) => (
              <button
                key={p.id}
                class={`vote ${choice === p.id ? 'sel' : ''} ${m.myVote === p.id ? 'mine' : ''}`}
                disabled={!v.me.alive || !!m.myVote}
                onClick={() => setChoice(p.id)}
              >
                <span class="num">{p.num}</span>
                <span class="grow">
                  {p.name}
                  {p.id === v.me.id ? ' (vous)' : ''}
                </span>
                {m.votedIds.includes(p.id) && <span title="a voté">🗳</span>}
              </button>
            ))}
          </div>
          {v.me.alive && !m.myVote && (
            <button class={`btn block ${choice === 'skip' ? 'primary' : ''}`} onClick={() => setChoice('skip')}>
              ⏭ Passer (ne pas éjecter)
            </button>
          )}
          <small class="center">
            {m.votedIds.length}/{alive.length} votes · 🗳 = a déjà voté
          </small>
          {dead.length > 0 && <small class="muted">Morts : {dead.map((p) => p.name).join(', ')}</small>}
        </div>
      )}
      {choice && m.stage === 'voting' && !m.myVote && (
        <div class="confirm-bar">
          <div>{choice === 'skip' ? 'Passer : personne n’est éjecté ?' : `Voter contre ${name(choice)} ?`}</div>
          <div class="row">
            <button class="btn grow" onClick={() => setChoice(undefined)}>
              Changer
            </button>
            <ActButton
              class="grow danger"
              run={async () => {
                const r = await conn.act({ type: 'vote', target: choice });
                setChoice(undefined);
                return r;
              }}
            >
              Confirmer mon vote
            </ActButton>
          </div>
        </div>
      )}

      {m.stage === 'result' && m.result && <VoteResultCard v={v} />}
    </div>
  );
}

function PlayerChips({ alive, dead, meId }: { alive: PlayerView['players']; dead: PlayerView['players']; meId: string }) {
  return (
    <div class="chips">
      {alive.map((p) => (
        <span key={p.id} class="chip">
          #{p.num} {p.name}
          {p.id === meId ? ' (vous)' : ''}
        </span>
      ))}
      {dead.map((p) => (
        <span key={p.id} class="chip dead">
          💀 {p.name}
        </span>
      ))}
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
    <div class={`card stack center ${r.ejectedId ? (r.wasImpostor ? 'ok' : r.wasImpostor === false ? 'danger' : '') : ''}`}>
      <h2 style={{ margin: 0 }}>{headline}</h2>
      {r.impostorsLeft !== undefined && <p class="big-num">{r.impostorsLeft} imposteur(s) restant(s)</p>}
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
        <Collapse title="Détail des votes">
          <ul class="list">
            {Object.entries(r.votes).map(([voter, t]) => (
              <li key={voter}>
                {name(voter)} → {name(t)}
              </li>
            ))}
          </ul>
        </Collapse>
      )}
      <p class="muted" style={{ margin: 0 }}>
        La partie reprend dans quelques secondes…
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- Fin de partie
export function EndRecap({ end }: { end: NonNullable<PlayerView['end']> }) {
  return (
    <>
      <div class={`card center ${end.winner === 'crew' ? 'ok' : end.winner === 'impostors' ? 'danger' : ''}`}>
        <h1 style={{ margin: 0 }}>{end.winner === 'crew' ? 'Victoire de l’équipage' : end.winner === 'impostors' ? 'Victoire des imposteurs' : 'Partie arrêtée'}</h1>
        <p>{end.reason}</p>
        <p class="muted" style={{ margin: 0 }}>
          Durée : {fmtSec(end.durationSec * 1000)} — tâches : {Math.round(end.taskBar * 100)} %
        </p>
      </div>
      <div class="card">
        <h3 style={{ marginTop: 0 }}>Rôles</h3>
        <ul class="list">
          {end.players.map((p) => (
            <li key={p.id}>
              <span class="num">{p.num}</span>
              <div class="grow">
                <strong>{p.name}</strong>{' '}
                <span class={`badge ${p.role === 'impostor' ? 'imp' : 'crew'}`}>{roleLabel(p.role)}</span>
                <div class="muted" style={{ fontSize: '0.88rem' }}>
                  {p.status === 'alive' ? 'vivant·e' : p.deathCause === 'ejected' ? 'éjecté·e' : p.deathCause === 'left' ? 'parti·e' : p.killedByName ? `tué·e par ${p.killedByName}` : 'mort·e'} ·{' '}
                  {p.role === 'impostor' ? `${p.kills} élimination(s)` : `${p.tasksDone}/${p.tasksTotal} tâches`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {end.kills.length > 0 && (
        <Collapse title="🗡 Éliminations" count={end.kills.length}>
          <ul class="list">
            {end.kills.map((k, i) => (
              <li key={i}>
                {k.killer} → {k.victim}
              </li>
            ))}
          </ul>
        </Collapse>
      )}
      {end.meetings.length > 0 && (
        <Collapse title="📣 Réunions et votes" count={end.meetings.length}>
          <ul class="list">
            {end.meetings.map((m) => (
              <li key={m.id}>
                <div>
                  <strong>n°{m.id}</strong> {m.kind === 'report' ? `corps de ${m.bodyOfName} signalé par ${m.calledByName}` : m.kind === 'emergency' ? `urgence (${m.calledByName})` : 'convoquée par le MJ'}
                  {m.newlyDead.length > 0 && <div class="muted">Morts annoncés : {m.newlyDead.join(', ')}</div>}
                  <div>
                    {m.ejectedName ? `Éjecté·e : ${m.ejectedName} (${m.wasImpostor ? 'imposteur' : 'innocent·e'})` : m.tie ? 'Égalité' : 'Personne éjecté'} —{' '}
                    {m.tally.map((t) => `${t.name} ${t.votes}`).join(', ')}
                    {m.skips ? `, passer ${m.skips}` : ''}
                  </div>
                  {m.votes && <div class="muted">{m.votes.map((x) => `${x.voter}→${x.target}`).join(' · ')}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Collapse>
      )}
      {end.sabotages.length > 0 && (
        <Collapse title="🔧 Sabotages" count={end.sabotages.length}>
          <ul class="list">
            {end.sabotages.map((s, i) => (
              <li key={i}>
                {s.label} par {s.byName} — {s.outcome}
              </li>
            ))}
          </ul>
        </Collapse>
      )}
    </>
  );
}

function EndScreen({ v }: { v: PlayerView }) {
  const end = v.end;
  const mine = end?.players.find((p) => p.id === v.me.id);
  const won = end && mine && ((end.winner === 'crew' && mine.role === 'crewmate') || (end.winner === 'impostors' && mine.role === 'impostor'));
  return (
    <div class="wrap stack">
      {end && mine && end.winner !== 'none' && (
        <div class={`role-card ${won ? 'crew' : 'imp'}`}>
          <div style={{ fontSize: '3rem' }}>{won ? '🎉' : '😵'}</div>
          <h1>{won ? 'Vous avez gagné !' : 'Vous avez perdu…'}</h1>
          <p style={{ margin: 0 }}>Vous étiez {mine.role === 'impostor' ? 'imposteur' : 'membre d’équipage'}.</p>
        </div>
      )}
      {end && <EndRecap end={end} />}
      <p class="card center">Restez connecté·e : si le maître du jeu relance une partie, vous serez automatiquement dans le nouveau salon.</p>
    </div>
  );
}
