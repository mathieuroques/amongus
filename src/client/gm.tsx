// Tableau de bord du maître du jeu.

import { useEffect, useRef, useState } from 'preact/hooks';
import { SABOTAGE_INFO, TASK_TYPE_LABEL } from '../shared/catalog';
import { DEFAULT_SETTINGS, maxImpostorsFor, recommendedImpostors } from '../shared/settings';
import { startProblems } from '../shared/terrain';
import type { Settings } from '../shared/types';
import type { GmPlayer, GmView } from '../shared/view';
import { dropGm, go } from './conn';
import type { Connection } from './net';
import { EndRecap } from './player';
import { joinUrl, QR } from './qr';
import { sessions } from './session';
import { useStore, useTick } from './store';
import { TerrainEditor } from './terrain-editor';
import { ActButton, Bar, beep, buzz, Countdown, Modal, NetBadge, OfflineBanner, toast, unlockAudio } from './ui';

type Conn = Connection<GmView>;
type Tab = 'game' | 'players' | 'terrain' | 'settings' | 'log';

export function GmApp({ conn }: { conn: Conn }) {
  const st = useStore(conn.store);
  const v = st.view;
  const [tab, setTab] = useState<Tab>('game');
  const lastAlert = useRef(0);
  useEffect(() => {
    if (!v) return;
    const pending = v.alerts.filter((a) => !a.acked);
    const max = Math.max(0, ...pending.map((a) => a.id));
    if (max > lastAlert.current) {
      beep(880, 300, 4);
      buzz([500, 200, 500, 200, 500]);
    }
    lastAlert.current = max;
  }, [v?.alerts]);

  if (!v)
    return (
      <div class="wrap stack center">
        <h2>Connexion au tableau de bord {conn.code}…</h2>
        {st.error && <p class="card danger">{st.error.msg}</p>}
        {st.error?.code === 'bad_token' && (
          <button class="btn block" onClick={() => (dropGm(), go('/'))}>
            Retour à l’accueil
          </button>
        )}
      </div>
    );

  const alerts = v.alerts.filter((a) => !a.acked);
  return (
    <div onClick={unlockAudio}>
      <div class="topbar">
        <span class="title grow">🎬 Maître du jeu · {v.code}</span>
        <NetBadge status={st.status} />
      </div>
      <OfflineBanner status={st.status} />
      {alerts.map((a) => (
        <div class="alarm critical" key={a.id}>
          <span class="grow">
            ⚠️ ALERTE de {a.playerName} : {a.message}
          </span>
          <ActButton class="small" run={() => conn.act({ type: 'ackAlert', id: a.id })}>
            Vu
          </ActButton>
        </div>
      ))}
      <div class="wrap wide stack">
        <div class="row">
          {(
            [
              ['game', 'Partie'],
              ['players', `Joueurs (${v.players.filter((p) => !p.kicked).length})`],
              ['terrain', 'Terrain'],
              ['settings', 'Paramètres'],
              ['log', 'Journal'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} class={`btn small ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
          <a class="btn small" href="#/print">
            🖨 Imprimer
          </a>
          <a class="btn small" href="#/regles">
            📖 Règles
          </a>
        </div>
        {tab === 'game' && <GameTab v={v} conn={conn} />}
        {tab === 'players' && <PlayersTab v={v} conn={conn} />}
        {tab === 'terrain' && <TerrainEditor v={v} conn={conn} />}
        {tab === 'settings' && <SettingsTab v={v} conn={conn} />}
        {tab === 'log' && <LogTab v={v} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Partie
function GameTab({ v, conn }: { v: GmView; conn: Conn }) {
  useTick(500);
  const now = conn.serverNow();
  if (v.phase === 'lobby') return <LobbyPanel v={v} conn={conn} />;
  if (v.phase === 'ended')
    return (
      <div class="stack">
        {v.end && <EndRecap end={v.end} />}
        <ActButton class="block big primary" run={() => conn.act({ type: 'newGame' })} okMsg="Retour au salon avec les mêmes joueurs et réglages.">
          🔁 Nouvelle partie (mêmes joueurs, terrain et réglages)
        </ActButton>
      </div>
    );
  const alive = v.players.filter((p) => p.role && !p.left && p.alive);
  const imp = alive.filter((p) => p.role === 'impostor').length;
  return (
    <div class="stack">
      <div class="grid2">
        <div class="card stack">
          <h2>{v.phase === 'meeting' ? '📣 Réunion en cours' : '🎮 Partie en cours'}</h2>
          <p>
            Vivants : {alive.length} dont {imp} imposteur(s) · Manche n°{v.gameNumber}
          </p>
          <div>
            Tâches : {v.taskBar.done}/{v.taskBar.total}
            <Bar value={v.taskBar.total ? v.taskBar.done / v.taskBar.total : 0} />
          </div>
          {v.paused ? (
            <ActButton class="block big crew" confirm="Reprendre la partie ? Tous les minuteurs repartent." run={() => conn.act({ type: 'resume' })}>
              ▶ Reprendre
            </ActButton>
          ) : (
            <ActButton class="block big warn" run={() => conn.act({ type: 'pause' })}>
              ⏸ Pause générale
            </ActButton>
          )}
          <ActButton class="block big danger" disabled={v.emergencyStop} run={() => conn.act({ type: 'stop' })}>
            🛑 ARRÊT D’URGENCE
          </ActButton>
          {v.emergencyStop && <p class="card danger">Arrêt d’urgence actif : tous les téléphones affichent STOP. « Reprendre » relance la partie.</p>}
        </div>
        <SabotagePanel v={v} conn={conn} now={now} />
        {v.meeting ? <MeetingPanel v={v} conn={conn} now={now} /> : <CallMeetingPanel v={v} conn={conn} />}
        <div class="card stack">
          <h3>Fin de partie manuelle</h3>
          <p class="muted">À n’utiliser qu’en cas de nécessité : le jeu détecte normalement seul les victoires.</p>
          <div class="row">
            <ActButton class="small crew" confirm="Déclarer la victoire de l’équipage ? Cela termine la partie." run={() => conn.act({ type: 'end', winner: 'crew' })}>
              Victoire équipage
            </ActButton>
            <ActButton class="small danger" confirm="Déclarer la victoire des imposteurs ? Cela termine la partie." run={() => conn.act({ type: 'end', winner: 'impostors' })}>
              Victoire imposteurs
            </ActButton>
            <ActButton class="small" confirm="Arrêter la partie sans vainqueur ?" run={() => conn.act({ type: 'end', winner: 'none' })}>
              Sans vainqueur
            </ActButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function LobbyPanel({ v, conn }: { v: GmView; conn: Conn }) {
  const players = v.players.filter((p) => !p.kicked);
  const problems = startProblems(v.terrain, v.settings, players.length);
  const secret = sessions.gm()?.secret;
  const url = joinUrl(v.code);
  return (
    <div class="grid2">
      <div class="card stack center">
        <h2>Invitation</h2>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <QR text={url} size={240} />
        </div>
        <div class="big-code" style={{ fontSize: '2.6rem' }}>
          {v.code}
        </div>
        <p style={{ wordBreak: 'break-all' }}>
          <a href={url}>{url}</a>
        </p>
        <div class="row" style={{ justifyContent: 'center' }}>
          <button
            class="btn small"
            onClick={async () => {
              try {
                if (navigator.share) await navigator.share({ title: 'Rejoindre la partie', text: `Code ${v.code}`, url });
                else {
                  await navigator.clipboard.writeText(url);
                  toast('Lien copié.', 'ok');
                }
              } catch {
                /* annulé */
              }
            }}
          >
            Partager le lien
          </button>
          <ActButton class="small" run={() => conn.act({ type: 'lock', locked: !v.lobbyLocked })}>
            {v.lobbyLocked ? '🔒 Salon verrouillé' : '🔓 Salon ouvert'}
          </ActButton>
        </div>
      </div>
      <div class="card stack">
        <h2>Démarrage</h2>
        <p>
          {players.length} joueur(s) · {v.settings.impostors} imposteur(s) (conseillé : {recommendedImpostors(players.length)})
        </p>
        {problems.length > 0 && (
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <ActButton
          class="block big crew"
          disabled={problems.length > 0}
          confirm="Démarrer la partie ? Les rôles vont être distribués. Avez-vous présenté les règles de sécurité (zones interdites, escaliers, sorties) ?"
          run={() => conn.act({ type: 'start' })}
          okMsg="Partie lancée !"
        >
          ▶ Démarrer la partie
        </ActButton>
        {secret && (
          <div class="card alt">
            <strong>Code maître du jeu : {secret}</strong>
            <p class="muted">Notez-le : il permet de reprendre ce tableau de bord depuis un autre appareil. Ne le montrez pas aux joueurs.</p>
          </div>
        )}
        <p class="muted">Avant de démarrer : imprimez et placez les postes (bouton « Imprimer »), présentez la sécurité et faites un essai de scan.</p>
      </div>
    </div>
  );
}

function SabotagePanel({ v, conn, now }: { v: GmView; conn: Conn; now: number }) {
  const s = v.sabotage;
  return (
    <div class={`card stack ${s ? (s.critical ? 'danger' : 'warn') : ''}`}>
      <h3>Sabotage</h3>
      {s ? (
        <>
          <p>
            <strong>{s.label}</strong>
            {s.roomName ? ` — ${s.roomName}` : ''} (par {s.byName})
            {s.deadline && (
              <>
                {' '}
                — reste <Countdown until={s.deadline} now={now} />
              </>
            )}
            {s.endsAt && (
              <>
                {' '}
                — fin dans <Countdown until={s.endsAt} now={now} />
              </>
            )}
          </p>
          {s.stations.map((x) => (
            <div key={x.name}>
              {x.fixed ? '✅' : x.held ? '✋' : '⬜'} {x.name} ({x.roomName})
            </div>
          ))}
          {s.holds.length > 0 && <small>Mains posées : {s.holds.map((h) => `${h.playerName} @ ${h.stationName}`).join(', ')}</small>}
          <ActButton class="small" confirm="Annuler ce sabotage ? (modifie l’équilibre de la partie)" run={() => conn.act({ type: 'fixSabotage' })}>
            Annuler le sabotage
          </ActButton>
        </>
      ) : (
        <p class="muted">
          Aucun. {now < v.sabotageCooldownUntil ? <>Prochain possible dans <Countdown until={v.sabotageCooldownUntil} now={now} />.</> : 'Les imposteurs peuvent saboter.'}
        </p>
      )}
    </div>
  );
}

function MeetingPanel({ v, conn, now }: { v: GmView; conn: Conn; now: number }) {
  const m = v.meeting!;
  const label = { gather: 'Rassemblement', discussion: 'Discussion', voting: 'Vote', result: 'Résultat' }[m.stage];
  return (
    <div class="card stack">
      <h3>
        Réunion n°{m.id} — {label} (<Countdown until={m.stageEndsAt} now={now} />)
      </h3>
      <p>
        {m.kind === 'report' ? `Corps de ${m.bodyOfName} signalé par ${m.calledByName}` : m.kind === 'emergency' ? `Urgence : ${m.calledByName}` : 'Convoquée par vous'}
        {m.newlyDead.length > 0 && ` · morts : ${m.newlyDead.map((d) => d.name).join(', ')}`}
      </p>
      {m.stage === 'gather' && (
        <p>
          Arrivés : {m.checkedInCount}/{m.aliveCount}
        </p>
      )}
      {(m.stage === 'voting' || m.stage === 'result') && (
        <p>
          Votes : {m.votes.length}/{m.aliveCount} {m.votes.length > 0 && <small>({m.votes.map((x) => `${x.voter}→${x.target}`).join(', ')})</small>}
        </p>
      )}
      {m.result && <p>Résultat : {m.result.ejectedName ? `${m.result.ejectedName} éjecté·e` : m.result.tie ? 'égalité' : 'personne'}</p>}
      <div class="row">
        <ActButton class="small primary" run={() => conn.act({ type: 'advance' })}>
          Étape suivante ⏭
        </ActButton>
        <ActButton class="small" run={() => conn.act({ type: 'extend', seconds: 30 })}>
          +30 s
        </ActButton>
        <ActButton class="small" run={() => conn.act({ type: 'extend', seconds: -30 })}>
          −30 s
        </ActButton>
      </div>
    </div>
  );
}

function CallMeetingPanel({ v, conn }: { v: GmView; conn: Conn }) {
  const [body, setBody] = useState('');
  const dead = v.players.filter((p) => p.role && !p.alive && !p.left && p.body && !p.body.reported && !p.body.vanished);
  return (
    <div class="card stack">
      <h3>Convoquer une réunion</h3>
      <p class="muted">Pour un corps dont le téléphone ne fonctionne plus, ou en cas de litige.</p>
      <select value={body} onChange={(e) => setBody((e.target as HTMLSelectElement).value)}>
        <option value="">Sans corps (réunion du MJ)</option>
        {dead.map((p) => (
          <option value={p.id}>Corps de {p.name}</option>
        ))}
      </select>
      <ActButton class="block" confirm="Convoquer une réunion maintenant ?" run={() => conn.act({ type: 'meeting', bodyOf: body || undefined })}>
        📣 Convoquer
      </ActButton>
    </div>
  );
}

// ------------------------------------------------------------------- Joueurs
function PlayersTab({ v, conn }: { v: GmView; conn: Conn }) {
  const [showRoles, setShowRoles] = useState(false);
  const [sel, setSel] = useState<string>();
  const now = conn.serverNow();
  const p = v.players.find((x) => x.id === sel);
  return (
    <div class="card stack">
      <div class="row">
        <h2 class="grow">Joueurs</h2>
        <label class="check">
          <input type="checkbox" checked={showRoles} onChange={(e) => setShowRoles((e.target as HTMLInputElement).checked)} /> Afficher les rôles (écran caché des joueurs !)
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nom</th>
              <th>Statut</th>
              {showRoles && <th>Rôle</th>}
              <th>Tâches</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {v.players.map((x) => (
              <tr key={x.id} style={{ opacity: x.kicked || x.left ? 0.5 : 1 }}>
                <td>{x.num}</td>
                <td>
                  <span title={x.connected ? 'connecté' : 'déconnecté'}>{x.connected ? '🟢' : '⚪'}</span> {x.name}
                </td>
                <td>{statusText(x)}</td>
                {showRoles && <td>{x.role ? <span class={`badge ${x.role === 'impostor' ? 'imp' : 'crew'}`}>{x.role === 'impostor' ? 'Imposteur' : 'Équipage'}</span> : '—'}</td>}
                <td>
                  {x.tasks.filter((t) => t.done).length}/{x.tasks.length}
                  {x.blockedUntil > now && <span class="badge warn">bloqué</span>}
                </td>
                <td>
                  <button class="btn small" onClick={() => setSel(x.id)}>
                    Gérer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p && <PlayerModal v={v} p={p} conn={conn} close={() => setSel(undefined)} showRole={showRoles} />}
    </div>
  );
}

function statusText(p: GmPlayer) {
  if (p.kicked) return 'exclu·e';
  if (p.left) return 'parti·e';
  if (!p.role) return 'salon';
  if (p.alive) return 'vivant·e';
  const cause = p.deathCause === 'ejected' ? 'éjecté·e' : p.deathCause === 'gm' ? 'mort·e (MJ)' : `tué·e${p.killedByName ? ' par ' + p.killedByName : ''}`;
  const body = p.body && !p.body.reported && !p.body.vanished ? ` · corps ${p.body.code} non trouvé` : '';
  return cause + body + (p.deathRevealed ? '' : ' (secret)');
}

function PlayerModal({ v, p, conn, close, showRole }: { v: GmView; p: GmPlayer; conn: Conn; close: () => void; showRole: boolean }) {
  const [reclaim, setReclaim] = useState<string>();
  const inGame = (v.phase === 'playing' || v.phase === 'meeting') && !!p.role;
  return (
    <Modal title={`#${p.num} ${p.name}`} onClose={close}>
      <p>
        {statusText(p)} · {p.connected ? 'connecté·e' : 'non connecté·e'}
        {showRole && p.role && ` · ${p.role === 'impostor' ? 'Imposteur' : 'Équipage'}`}
      </p>
      <div class="card alt stack">
        <strong>Reconnexion</strong>
        <p class="muted">Si le joueur a changé de téléphone ou effacé son navigateur : générez un code, il le saisit sur l’accueil (« Récupérer ma session »).</p>
        {reclaim ? (
          <div class="big-code" style={{ fontSize: '2rem' }}>
            {reclaim}
          </div>
        ) : (
          <ActButton
            class="small"
            run={async () => {
              const r = await conn.act<{ code: string }>({ type: 'reclaimCode', playerId: p.id });
              if (r.ok) setReclaim(r.data!.code);
              return r;
            }}
          >
            Générer un code de reconnexion (15 min)
          </ActButton>
        )}
      </div>
      {inGame && (
        <div class="card warn stack">
          <strong>Corrections (modifient l’équilibre de la partie)</strong>
          <div class="row">
            {p.alive ? (
              <ActButton class="small danger" confirm={`Déclarer ${p.name} mort·e ? (ex. élimination validée oralement, téléphone en panne)`} run={() => conn.act({ type: 'kill', playerId: p.id })}>
                Déclarer mort·e
              </ActButton>
            ) : !p.left ? (
              <ActButton class="small crew" confirm={`Annuler la mort de ${p.name} ? Utilisez-le seulement pour une élimination injustifiée.`} run={() => conn.act({ type: 'revive', playerId: p.id })}>
                Annuler la mort
              </ActButton>
            ) : null}
            {!p.left && (
              <ActButton class="small" confirm={`Déclarer que ${p.name} quitte la partie ? Ses tâches sont retirées.`} run={() => conn.act({ type: 'markLeft', playerId: p.id })}>
                A quitté la partie
              </ActButton>
            )}
          </div>
          <strong>Tâches</strong>
          <ul class="list">
            {p.tasks.map((t) => (
              <li key={t.taskId}>
                <span class="grow">
                  {t.done ? '✅' : '⬜'} {t.name} <small>({TASK_TYPE_LABEL[t.type]}, {t.step}/{t.steps})</small>
                </span>
                <ActButton class="small" confirm={t.done ? 'Réinitialiser cette tâche ?' : 'Valider cette tâche manuellement ?'} run={() => conn.act({ type: 'taskDone', playerId: p.id, taskId: t.taskId, done: !t.done })}>
                  {t.done ? 'Annuler' : 'Valider'}
                </ActButton>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!p.kicked && (
        <ActButton class="block danger" confirm={`Exclure ${p.name} ? Il ne pourra plus agir dans cette partie.`} run={async () => {
          const r = await conn.act({ type: 'kick', playerId: p.id });
          if (r.ok) close();
          return r;
        }}>
          Exclure le joueur
        </ActButton>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------- Paramètres
const FIELDS: { key: keyof Settings; label: string; unit?: string; official?: string; group: string }[] = [
  { key: 'maxPlayers', label: 'Nombre maximum de joueurs', group: 'Joueurs et rôles' },
  { key: 'impostors', label: 'Nombre d’imposteurs', group: 'Joueurs et rôles', official: '1 à 3 (15 joueurs max)' },
  { key: 'killCooldownSec', label: 'Délai entre deux éliminations', unit: 's', official: '45 s', group: 'Éliminations' },
  { key: 'initialKillCooldownSec', label: 'Délai avant la 1re élimination', unit: 's', official: '10 s', group: 'Éliminations' },
  { key: 'killCodeTtlSec', label: 'Validité d’un code d’élimination', unit: 's', group: 'Éliminations' },
  { key: 'emergencyMeetingsPerPlayer', label: 'Réunions d’urgence par joueur', official: '1', group: 'Réunions' },
  { key: 'emergencyCooldownSec', label: 'Délai du bouton d’urgence', unit: 's', official: '15 s', group: 'Réunions' },
  { key: 'gatherSec', label: 'Temps pour rejoindre la salle', unit: 's', group: 'Réunions' },
  { key: 'discussionSec', label: 'Temps de discussion', unit: 's', official: '15 s', group: 'Réunions' },
  { key: 'votingSec', label: 'Temps de vote', unit: 's', official: '120 s', group: 'Réunions' },
  { key: 'resultSec', label: 'Affichage du résultat', unit: 's', group: 'Réunions' },
  { key: 'commonTasks', label: 'Tâches communes', official: '1', group: 'Tâches' },
  { key: 'longTasks', label: 'Tâches longues', official: '1', group: 'Tâches' },
  { key: 'shortTasks', label: 'Tâches courtes', official: '2', group: 'Tâches' },
  { key: 'sabotageCooldownSec', label: 'Délai entre deux sabotages', unit: 's', official: '30 s', group: 'Sabotages' },
  { key: 'initialSabotageCooldownSec', label: 'Délai avant le 1er sabotage', unit: 's', official: '10 s', group: 'Sabotages' },
  { key: 'reactorSec', label: 'Compte à rebours du réacteur', unit: 's', official: '30–60 s', group: 'Sabotages' },
  { key: 'oxygenSec', label: 'Compte à rebours de l’oxygène', unit: 's', official: '30–45 s', group: 'Sabotages' },
  { key: 'doorsSec', label: 'Durée de condamnation d’une salle', unit: 's', official: '10 s', group: 'Sabotages' },
  { key: 'bodyTimeoutSec', label: 'Un corps non trouvé disparaît après (0 = à la réunion)', unit: 's', group: 'Corps et fantômes' },
];

function SettingsTab({ v, conn }: { v: GmView; conn: Conn }) {
  const editable = v.phase === 'lobby';
  const [d, setD] = useState<Settings>(v.settings);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setD(v.settings);
  }, [v.settings]);
  const set = (patch: Partial<Settings>) => {
    setD({ ...d, ...patch });
    setDirty(true);
  };
  const n = v.players.filter((p) => !p.kicked && !p.left).length;
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  return (
    <div class="stack">
      {!editable && <p class="card warn">Les paramètres sont verrouillés pendant la partie (ils se modifient dans le salon).</p>}
      <div class="grid2">
        {groups.map((g) => (
          <div class="card stack" key={g}>
            <h3>{g}</h3>
            {FIELDS.filter((f) => f.group === g).map((f) => (
              <label class="field" key={f.key}>
                <span>
                  {f.label}
                  {f.unit ? ` (${f.unit})` : ''}
                  {f.official ? ` — jeu officiel : ${f.official}` : ''}
                </span>
                <input type="number" inputMode="numeric" disabled={!editable} value={d[f.key] as number} onInput={(e) => set({ [f.key]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>)} />
              </label>
            ))}
            {g === 'Joueurs et rôles' && (
              <small>
                Avec {n} joueur(s) : conseillé {recommendedImpostors(n)}, maximum {maxImpostorsFor(n)}.
              </small>
            )}
            {g === 'Réunions' && (
              <>
                <label class="check">
                  <input type="checkbox" disabled={!editable} checked={d.anonymousVotes} onChange={(e) => set({ anonymousVotes: (e.target as HTMLInputElement).checked })} /> Votes anonymes (officiel : non)
                </label>
                <label class="check">
                  <input type="checkbox" disabled={!editable} checked={d.confirmEjects} onChange={(e) => set({ confirmEjects: (e.target as HTMLInputElement).checked })} /> Confirmer le rôle de l’éjecté (officiel : oui)
                </label>
              </>
            )}
            {g === 'Tâches' && (
              <>
                <label class="field">
                  <span>Mise à jour de la barre (officiel : toujours)</span>
                  <select disabled={!editable} value={d.taskBarUpdates} onChange={(e) => set({ taskBarUpdates: (e.target as HTMLSelectElement).value as Settings['taskBarUpdates'] })}>
                    <option value="always">Toujours</option>
                    <option value="meetings">Pendant les réunions</option>
                    <option value="never">Jamais</option>
                  </select>
                </label>
                <label class="check">
                  <input type="checkbox" disabled={!editable} checked={d.visualTasks} onChange={(e) => set({ visualTasks: (e.target as HTMLInputElement).checked })} /> Tâches visuelles (officiel : oui)
                </label>
              </>
            )}
            {g === 'Corps et fantômes' && (
              <label class="check">
                <input type="checkbox" disabled={!editable} checked={d.ghostsSeeRoles} onChange={(e) => set({ ghostsSeeRoles: (e.target as HTMLInputElement).checked })} /> Les fantômes voient les rôles (déconseillé en vrai : risque de fuite)
              </label>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div class="row">
          <ActButton
            class="primary"
            disabled={!dirty}
            run={async () => {
              const r = await conn.act({ type: 'settings', settings: d });
              if (r.ok) {
                setDirty(false);
                sessions.setSettings(d);
                toast('Paramètres enregistrés.', 'ok');
              }
              return r;
            }}
          >
            Enregistrer
          </ActButton>
          <button class="btn" onClick={() => (setD(DEFAULT_SETTINGS), setDirty(true))}>
            Valeurs par défaut
          </button>
          {dirty && <span class="badge warn">non enregistré</span>}
        </div>
      )}
      <p class="muted">Les sabotages disponibles dépendent des postes du terrain : {v.sabotageOptions.map((k) => SABOTAGE_INFO[k].label).join(', ') || 'aucun'}.</p>
    </div>
  );
}

// ------------------------------------------------------------------- Journal
function LogTab({ v }: { v: GmView }) {
  const [secrets, setSecrets] = useState(false);
  const start = v.startedAt ?? v.log[0]?.at ?? 0;
  return (
    <div class="card stack">
      <div class="row">
        <h2 class="grow">Journal des événements</h2>
        <label class="check">
          <input type="checkbox" checked={secrets} onChange={(e) => setSecrets((e.target as HTMLInputElement).checked)} /> Afficher les événements secrets
        </label>
      </div>
      <ul class="list">
        {[...v.log].reverse().map((l, i) =>
          l.secret && !secrets ? null : (
            <li key={i}>
              <small style={{ minWidth: '54px' }}>{fmtClock(l.at - start)}</small>
              <span>
                {l.secret && <span class="badge imp">secret</span>} {l.msg}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function fmtClock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
