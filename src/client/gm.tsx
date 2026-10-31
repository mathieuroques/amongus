// Tableau de bord du maître du jeu.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { SABOTAGE_INFO, TASK_TYPE_LABEL } from '../shared/catalog';
import { DEFAULT_SETTINGS, maxImpostorsFor, recommendedImpostors, startSettings } from '../shared/settings';
import { startProblems, terrainWarnings } from '../shared/terrain';
import type { Settings } from '../shared/types';
import type { GmPlayer, GmView } from '../shared/view';
import { useGmAlerts } from './alerts';
import { AlertOverlay, AlertSetup } from './alerts-ui';
import { dropGm, go } from './conn';
import { GmTests, testedCount } from './gm-tests';
import type { Connection } from './net';
import { EndRecap } from './player';
import { joinUrl, QR } from './qr';
import { sessions } from './session';
import { useStore, useTick } from './store';
import { TerrainEditor } from './terrain-editor';
import { ActButton, Bar, Countdown, fmtSec, Modal, NetBadge, OfflineBanner, toast, unlockAudio } from './ui';

type Conn = Connection<GmView>;
type Tab = 'game' | 'players' | 'terrain' | 'settings' | 'tests' | 'log';

export function GmApp({ conn }: { conn: Conn }) {
  const st = useStore(conn.store);
  const v = st.view;
  const [tab, setTab] = useState<Tab>('game');
  useGmAlerts(v);
  useEffect(() => window.scrollTo(0, 0), [tab]);

  if (!v)
    return (
      <div class="wrap stack center" style={{ paddingTop: '20vh' }}>
        <span class="spinner big" />
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
  const inGame = v.phase === 'playing' || v.phase === 'meeting';
  const TABS: [Tab, string][] = [
    ['game', '🎮 Partie'],
    ['players', `👥 Joueurs (${v.players.filter((p) => !p.kicked).length})`],
    ['terrain', '🏠 Terrain'],
    ['settings', '⚙️ Paramètres'],
    ['tests', '🧪 Tests'],
    ['log', '📜 Journal'],
  ];
  return (
    <div onClick={unlockAudio}>
      <div class="topbar">
        <span class="title grow">🎬 Maître du jeu · {v.code}</span>
        <NetBadge status={st.status} />
      </div>
      <OfflineBanner status={st.status} waiting={st.waiting} />
      <AlertOverlay />
      {inGame && <StatusBar v={v} conn={conn} />}
      {alerts.map((a) => (
        <div class="alarm critical" key={a.id}>
          <span class="grow">
            {a.kind === 'dispute' ? `⚖️ ÉLIMINATION À VÉRIFIER — ${a.playerName}` : `⚠️ ALERTE de ${a.playerName}`} : {a.message}
            {a.kind === 'dispute' && <small style={{ display: 'block', color: 'inherit' }}>Erreur de nom ou tricherie ? Écoutez les joueurs en privé ; si besoin : onglet Joueurs → {a.playerName} → « Annuler la mort ».</small>}
          </span>
          <ActButton class="small" run={() => conn.act({ type: 'ackAlert', id: a.id })}>
            Vu
          </ActButton>
        </div>
      ))}
      <div class="wrap wide stack">
        <nav class="scroll-tabs" aria-label="Sections">
          {TABS.map(([k, l]) => (
            <button key={k} class={`btn small ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
              {l}
            </button>
          ))}
          <a class="btn small" href="#/regles">
            📖 Règles
          </a>
        </nav>
        {tab === 'game' && <GameTab v={v} conn={conn} goTab={setTab} />}
        {tab === 'players' && <PlayersTab v={v} conn={conn} />}
        {tab === 'terrain' && <TerrainEditor v={v} conn={conn} />}
        {tab === 'settings' && <SettingsTab v={v} conn={conn} />}
        {tab === 'tests' && <GmTests v={v} conn={conn} />}
        {tab === 'log' && <LogTab v={v} />}
      </div>
    </div>
  );
}

/** Barre d'état toujours visible pendant la partie : phase, chrono, effectifs, pause et arrêt d'urgence. */
function StatusBar({ v, conn }: { v: GmView; conn: Conn }) {
  useTick(500);
  const now = conn.serverNow();
  const alive = v.players.filter((p) => p.role && !p.left && p.alive);
  const imp = alive.filter((p) => p.role === 'impostor').length;
  const stage = v.meeting ? { gather: 'Rassemblement', discussion: 'Discussion', voting: 'Vote', result: 'Résultat' }[v.meeting.stage] : undefined;
  return (
    <div class="status-bar">
      <span class={`badge ${v.paused ? 'warn' : v.meeting ? 'imp' : 'crew'}`}>{v.emergencyStop ? '🛑 STOP' : v.paused ? '⏸ Pause' : v.meeting ? `📣 ${stage} ${fmtSec(v.meeting.stageEndsAt - now)}` : '🎮 En jeu'}</span>
      {v.sabotage && (
        <span class="badge imp">
          🚨 {v.sabotage.label}
          {v.sabotage.deadline ? ` ${fmtSec(v.sabotage.deadline - now)}` : ''}
        </span>
      )}
      <span class="badge">
        Vivants {alive.length} · imp. {imp}
      </span>
      <span class="badge">Tâches {v.taskBar.total ? Math.round((100 * v.taskBar.done) / v.taskBar.total) : 0} %</span>
      <span class="grow" />
      {v.paused ? (
        <ActButton class="small crew" confirm="Reprendre la partie ? Tous les minuteurs repartent." confirmOk="Reprendre" run={() => conn.act({ type: 'resume' })}>
          ▶ Reprendre
        </ActButton>
      ) : (
        <ActButton class="small warn" run={() => conn.act({ type: 'pause' })}>
          ⏸ Pause
        </ActButton>
      )}
      <ActButton class="small danger" disabled={v.emergencyStop} run={() => conn.act({ type: 'stop' })}>
        🛑 STOP
      </ActButton>
    </div>
  );
}

// ------------------------------------------------------------------- Partie
function GameTab({ v, conn, goTab }: { v: GmView; conn: Conn; goTab: (t: Tab) => void }) {
  useTick(500);
  const now = conn.serverNow();
  if (v.phase === 'lobby') return <LobbyPanel v={v} conn={conn} goTab={goTab} />;
  if (v.phase === 'ended')
    return (
      <div class="stack">
        {v.end && <EndRecap end={v.end} />}
        <ActButton class="block big primary" run={() => conn.act({ type: 'newGame' })} okMsg="Retour au salon avec les mêmes joueurs et réglages.">
          🔁 Nouvelle partie (mêmes joueurs, terrain et réglages)
        </ActButton>
      </div>
    );
  return (
    <div class="grid2">
      <div class="card stack">
        <h2 style={{ margin: 0 }}>{v.phase === 'meeting' ? '📣 Réunion en cours' : '🎮 Partie en cours'}</h2>
        <div>
          Tâches de l’équipage : {v.taskBar.done}/{v.taskBar.total}
          <Bar value={v.taskBar.total ? v.taskBar.done / v.taskBar.total : 0} />
        </div>
        <p class="muted" style={{ margin: 0 }}>
          Manche n°{v.gameNumber}. Pause et STOP sont toujours accessibles dans la barre du haut.
        </p>
        {v.emergencyStop && <p class="card danger">Arrêt d’urgence actif : tous les téléphones affichent STOP. « Reprendre » relance la partie.</p>}
        <ActButton class="block" run={() => conn.act({ type: 'ping' })} okMsg="Tous les téléphones sonnent.">
          🔔 Faire sonner tous les téléphones
        </ActButton>
      </div>
      <SabotagePanel v={v} conn={conn} now={now} />
      {v.meeting ? <MeetingPanel v={v} conn={conn} now={now} /> : <CallMeetingPanel v={v} conn={conn} />}
      <div class="card stack">
        <h3 style={{ margin: 0 }}>Fin de partie manuelle</h3>
        <p class="muted" style={{ margin: 0 }}>
          À n’utiliser qu’en cas de nécessité : le jeu détecte seul les victoires.
        </p>
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
  );
}

function useCheck(key: string): [boolean, (b: boolean) => void] {
  const k = `imposteurs.check.${key}`;
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  });
  return [
    v,
    (b) => {
      setV(b);
      try {
        localStorage.setItem(k, b ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
  ];
}

function LobbyPanel({ v, conn, goTab }: { v: GmView; conn: Conn; goTab: (t: Tab) => void }) {
  const players = v.players.filter((p) => !p.kicked);
  const settings = startSettings(v.settings, players.length);
  const problems = startProblems(v.terrain, settings, players.length);
  const terrainProblems = startProblems(v.terrain, settings, Math.max(players.length, 2 * settings.impostors + 1)).filter((p) => !/joueurs|imposteurs/.test(p));
  const warnings = terrainWarnings(v.terrain);
  const [safety, setSafety] = useCheck(`${v.code}.${v.gameNumber}.safety`);
  const tested = testedCount(v);
  const secret = sessions.gm()?.secret;
  const url = joinUrl(v.code);
  const connected = players.filter((p) => p.connected).length;
  const pushCount = players.filter((p) => p.push).length;
  const rec = recommendedImpostors(players.length);
  const Step = ({ ok, n, children }: { ok: boolean; n: number; children: ComponentChildren }) => (
    <li class={ok ? 'ok' : 'ko'}>
      <span class="dot">{ok ? '✓' : n}</span>
      <div class="grow">{children}</div>
    </li>
  );
  return (
    <div class="grid2">
      <div class="card stack">
        <h2 style={{ margin: 0 }}>Préparer la partie</h2>
        <ol class="steps">
          <Step ok={terrainProblems.length === 0} n={1}>
            <strong>Fiches posées et appairées</strong> : {v.terrain.stations.length} fiche(s) dans {new Set(v.terrain.stations.map((x) => x.roomId)).size} pièce(s), {v.terrain.tasks.length} tâches.{' '}
            <button class="btn link" onClick={() => goTab('terrain')}>
              Appairer
            </button>
            {terrainProblems.map((p) => (
              <div key={p} class="muted">
                ⚠️ {p}
              </div>
            ))}
            {terrainProblems.length === 0 && warnings.length > 0 && (
              <div class="muted">
                {warnings.length} conseil(s) dans l’onglet Terrain.
              </div>
            )}
          </Step>
          <Step ok={settings.impostors <= maxImpostorsFor(players.length) && players.length >= 4} n={2}>
            <strong>Réglages</strong> : {settings.impostors} imposteur(s) {v.settings.autoImpostors ? '(automatique selon le nombre de joueurs)' : `(conseillé pour ${players.length} joueurs : ${rec})`}, élimination toutes les {v.settings.killCooldownSec} s.{' '}
            <button class="btn link" onClick={() => goTab('settings')}>
              Modifier
            </button>
          </Step>
          <Step ok={tested.done >= tested.total && tested.total > 0} n={3}>
            <strong>Tâches testées</strong> : {tested.done}/{tested.total}{' '}
            <button class="btn link" onClick={() => goTab('tests')}>
              Tester
            </button>
          </Step>
          <Step ok={players.length >= 4 && connected === players.length} n={4}>
            <strong>Joueurs</strong> : {players.length} inscrits, {connected} connectés, {pushCount} avec notifications.{' '}
            <ActButton class="small" run={() => conn.act({ type: 'ping' })} okMsg="Les téléphones des joueurs sonnent.">
              🔔 Faire sonner
            </ActButton>
          </Step>
          <Step ok={safety} n={5}>
            <strong>Sécurité présentée</strong> (zones interdites, escaliers, sorties, on ne court pas, STOP)
            <label class="check">
              <input type="checkbox" checked={safety} onChange={(e) => setSafety((e.target as HTMLInputElement).checked)} /> c’est fait
            </label>
          </Step>
        </ol>
        {problems.length > 0 && (
          <div class="card warn">
            {problems.map((p) => (
              <div key={p}>⛔ {p}</div>
            ))}
          </div>
        )}
        <ActButton
          class="block big crew"
          disabled={problems.length > 0}
          confirm={safety ? 'Démarrer la partie ? Les rôles vont être distribués.' : 'Vous n’avez pas coché « Sécurité présentée ». Démarrer quand même ?'}
          confirmOk="Démarrer"
          run={() => conn.act({ type: 'start' })}
          okMsg="Partie lancée !"
        >
          ▶ Démarrer la partie
        </ActButton>
      </div>
      <div class="stack">
        <div class="card stack center">
          <h2 style={{ margin: 0 }}>Invitation</h2>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <QR text={url} size={220} />
          </div>
          <div class="big-code" style={{ fontSize: '2.4rem' }}>
            {v.code}
          </div>
          <p style={{ wordBreak: 'break-all', margin: 0 }}>
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
        {secret && (
          <div class="card alt">
            <strong>Code maître du jeu : {secret}</strong>
            <p class="muted" style={{ margin: 0 }}>
              Notez-le : il permet de reprendre ce tableau de bord depuis un autre appareil. Ne le montrez pas.
            </p>
          </div>
        )}
        <AlertSetup conn={conn} pushKey={v.pushKey} compact />
      </div>
    </div>
  );
}

function SabotagePanel({ v, conn, now }: { v: GmView; conn: Conn; now: number }) {
  const s = v.sabotage;
  return (
    <div class={`card stack ${s ? (s.critical ? 'danger' : 'warn') : ''}`}>
      <h3 style={{ margin: 0 }}>Sabotage</h3>
      {s ? (
        <>
          <p style={{ margin: 0 }}>
            <strong>{s.label}</strong> (par {s.byName})
            {s.deadline && (
              <>
                {' '}
                — reste <Countdown until={s.deadline} now={now} />
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
        <p class="muted" style={{ margin: 0 }}>
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
      <h3 style={{ margin: 0 }}>
        Réunion n°{m.id} — {label} (<Countdown until={m.stageEndsAt} now={now} />)
      </h3>
      <p style={{ margin: 0 }}>
        {m.kind === 'report' ? `Corps de ${m.bodyOfName} signalé par ${m.calledByName}` : m.kind === 'emergency' ? `Urgence : ${m.calledByName}` : 'Convoquée par vous'}
        {m.newlyDead.length > 0 && ` · morts : ${m.newlyDead.map((d) => d.name).join(', ')}`}
      </p>
      {m.stage === 'gather' && (
        <p style={{ margin: 0 }}>
          Arrivés : {m.checkedInCount}/{m.aliveCount}
        </p>
      )}
      {m.stage === 'discussion' && (
        <p style={{ margin: 0 }}>
          Prêts à voter : {m.readyCount}/{m.aliveCount} (vote dès {Math.floor(m.aliveCount / 2) + 1})
        </p>
      )}
      {(m.stage === 'voting' || m.stage === 'result') && (
        <p style={{ margin: 0 }}>
          Votes : {m.votes.length}/{m.aliveCount} {m.votes.length > 0 && <small>({m.votes.map((x) => `${x.voter}→${x.target}`).join(', ')})</small>}
        </p>
      )}
      {m.result && <p style={{ margin: 0 }}>Résultat : {m.result.ejectedName ? `${m.result.ejectedName} éjecté·e` : m.result.tie ? 'égalité' : 'personne'}</p>}
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
      <h3 style={{ margin: 0 }}>Convoquer une réunion</h3>
      <p class="muted" style={{ margin: 0 }}>
        Pour un corps dont le téléphone ne fonctionne plus, ou en cas de litige.
      </p>
      <select value={body} onChange={(e) => setBody((e.target as HTMLSelectElement).value)} aria-label="Corps à signaler">
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
type Filter = 'all' | 'alive' | 'dead' | 'offline';

function PlayersTab({ v, conn }: { v: GmView; conn: Conn }) {
  const [showRoles, setShowRoles] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<string>();
  const now = conn.serverNow();
  const p = v.players.find((x) => x.id === sel);
  const list = v.players.filter((x) => (filter === 'alive' ? x.alive && !x.left : filter === 'dead' ? !x.alive || x.left : filter === 'offline' ? !x.connected : true));
  return (
    <div class="card stack">
      <div class="row">
        <h2 class="grow" style={{ margin: 0 }}>
          Joueurs
        </h2>
        <label class="check">
          <input type="checkbox" checked={showRoles} onChange={(e) => setShowRoles((e.target as HTMLInputElement).checked)} /> Afficher les rôles (écran caché !)
        </label>
      </div>
      <div class="row">
        {(
          [
            ['all', 'Tous'],
            ['alive', 'Vivants'],
            ['dead', 'Morts / partis'],
            ['offline', 'Déconnectés'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} class={`btn small ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      <div class="grid2">
        {list.map((x) => (
          <button key={x.id} class={`pcard ${!x.alive || x.left ? 'dead' : ''}`} style={{ textAlign: 'left', color: 'inherit' }} onClick={() => setSel(x.id)}>
            <span class="num">{x.num}</span>
            <div class="grow">
              <strong>
                <span title={x.connected ? 'connecté' : 'déconnecté'}>{x.connected ? '🟢' : '⚪'}</span> {x.name}
              </strong>{' '}
              {showRoles && x.role && <span class={`badge ${x.role === 'impostor' ? 'imp' : 'crew'}`}>{x.role === 'impostor' ? 'Imposteur' : 'Équipage'}</span>}
              <div class="muted" style={{ fontSize: '0.88rem' }}>
                {statusText(x)} · tâches {x.tasks.filter((t) => t.done).length}/{x.tasks.length}
                {x.push ? ' · 🔔' : ''}
                {x.blockedUntil > now ? ' · ⛔ bloqué' : ''}
              </div>
            </div>
            <span>›</span>
          </button>
        ))}
      </div>
      {list.length === 0 && <p class="muted">Aucun joueur dans cette catégorie.</p>}
      {p && <PlayerModal v={v} p={p} conn={conn} close={() => setSel(undefined)} showRole={showRoles} />}
    </div>
  );
}

function statusText(p: GmPlayer) {
  if (p.kicked) return 'exclu·e';
  if (p.left) return 'parti·e';
  if (!p.role) return 'dans le salon';
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
      <p style={{ margin: 0 }}>
        {statusText(p)} · {p.connected ? 'connecté·e' : 'non connecté·e'} · notifications {p.push ? 'activées' : 'non'}
        {showRole && p.role && ` · ${p.role === 'impostor' ? 'Imposteur' : 'Équipage'}`}
      </p>
      <div class="card alt stack">
        <strong>Reconnexion</strong>
        <p class="muted" style={{ margin: 0 }}>
          Si le joueur a changé de téléphone ou vidé son navigateur : générez un code, il le saisit sur l’accueil (« Récupérer ma session »).
        </p>
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
              <ActButton class="small danger" confirm={`Déclarer ${p.name} mort·e ? (élimination validée oralement, téléphone en panne…)`} run={() => conn.act({ type: 'kill', playerId: p.id })}>
                Déclarer mort·e
              </ActButton>
            ) : !p.left ? (
              <ActButton class="small crew" confirm={`Annuler la mort de ${p.name} ? Seulement pour une élimination injustifiée.`} run={() => conn.act({ type: 'revive', playerId: p.id })}>
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
                  {t.done ? '✅' : '⬜'} {t.name}{' '}
                  <small>
                    ({TASK_TYPE_LABEL[t.type]}, {t.step}/{t.steps})
                  </small>
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
        <ActButton
          class="block danger"
          confirm={`Exclure ${p.name} ? Il ne pourra plus agir dans cette partie.`}
          confirmOk="Exclure"
          run={async () => {
            const r = await conn.act({ type: 'kick', playerId: p.id });
            if (r.ok) close();
            return r;
          }}
        >
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
  { key: 'bodyTimeoutSec', label: 'Un corps non trouvé disparaît après (0 = à la réunion)', unit: 's', group: 'Corps et fantômes' },
];

/** Préréglages selon la taille du groupe (valeurs du guide du MJ). */
export function preset(kind: 'small' | 'medium' | 'large', players: number): Partial<Settings> {
  const impostors = Math.max(1, Math.min(maxImpostorsFor(Math.max(players, 4)), recommendedImpostors(players)));
  if (kind === 'small') return { impostors, killCooldownSec: 60, initialKillCooldownSec: 30, discussionSec: 90, votingSec: 90, gatherSec: 90, commonTasks: 1, longTasks: 1, shortTasks: 2 };
  if (kind === 'medium') return { impostors, killCooldownSec: 60, initialKillCooldownSec: 30, discussionSec: 120, votingSec: 90, gatherSec: 90, commonTasks: 1, longTasks: 1, shortTasks: 3 };
  return { impostors, killCooldownSec: 90, initialKillCooldownSec: 45, discussionSec: 150, votingSec: 120, gatherSec: 120, commonTasks: 1, longTasks: 2, shortTasks: 3 };
}

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
      {editable && (
        <div class="card stack">
          <h3 style={{ margin: 0 }}>Préréglages rapides ({n} joueurs inscrits)</h3>
          <div class="grid-buttons">
            <button class="btn" onClick={() => set(preset('small', n))}>
              Petit groupe (≤ 12)
            </button>
            <button class="btn" onClick={() => set(preset('medium', n))}>
              Groupe moyen (13–24)
            </button>
            <button class="btn" onClick={() => set(preset('large', n))}>
              Grande partie (25–40)
            </button>
          </div>
          <small class="muted">Le nombre d’imposteurs est ajusté au nombre de joueurs inscrits : refaites-le si d’autres arrivent.</small>
        </div>
      )}
      <div class="grid2">
        {groups.map((g) => (
          <div class="card stack" key={g}>
            <h3 style={{ margin: 0 }}>{g}</h3>
            {FIELDS.filter((f) => f.group === g).map((f) => (
              <label class="field" key={f.key}>
                <span>
                  {f.label}
                  {f.unit ? ` (${f.unit})` : ''}
                  {f.official ? ` — jeu officiel : ${f.official}` : ''}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  disabled={!editable || (f.key === 'impostors' && !!d.autoImpostors)}
                  value={f.key === 'impostors' && d.autoImpostors ? startSettings(d, n).impostors : (d[f.key] as number)}
                  onInput={(e) => set({ [f.key]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>)}
                />
              </label>
            ))}
            {g === 'Joueurs et rôles' && (
              <label class="check">
                <input type="checkbox" disabled={!editable} checked={!!d.autoImpostors} onChange={(e) => set({ autoImpostors: (e.target as HTMLInputElement).checked })} /> Automatique : nombre conseillé, recalculé à chaque manche selon les joueurs présents
              </label>
            )}
            {g === 'Joueurs et rôles' && !d.autoImpostors && (
              <small>
                Avec {n} joueur(s) : conseillé {recommendedImpostors(n)}, maximum {maxImpostorsFor(n)}.{' '}
                {editable && (
                  <button class="btn link" onClick={() => set({ impostors: Math.max(1, Math.min(maxImpostorsFor(Math.max(n, 4)), recommendedImpostors(n))) })}>
                    Appliquer le conseil
                  </button>
                )}
              </small>
            )}
            {g === 'Réunions' && (
              <>
                <label class="check">
                  <input type="checkbox" disabled={!editable} checked={d.anonymousVotes} onChange={(e) => set({ anonymousVotes: (e.target as HTMLInputElement).checked })} /> Votes anonymes (officiel : non)
                </label>
                <label class="check">
                  <input type="checkbox" disabled={!editable} checked={d.confirmEjects} onChange={(e) => set({ confirmEjects: (e.target as HTMLInputElement).checked })} /> Annoncer le rôle de l’éjecté (officiel : oui)
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
                <input type="checkbox" disabled={!editable} checked={d.ghostsSeeRoles} onChange={(e) => set({ ghostsSeeRoles: (e.target as HTMLInputElement).checked })} /> Les fantômes voient les rôles (déconseillé : risque de fuite)
              </label>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div class="card row save-bar">
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
            💾 Enregistrer
          </ActButton>
          <button class="btn" onClick={() => (setD(DEFAULT_SETTINGS), setDirty(true))}>
            Valeurs par défaut
          </button>
          {dirty && <span class="badge warn">non enregistré</span>}
        </div>
      )}
      <p class="muted">Sabotages disponibles avec ce terrain : {v.sabotageOptions.map((k) => SABOTAGE_INFO[k].label).join(', ') || 'aucun'}.</p>
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
        <h2 class="grow" style={{ margin: 0 }}>
          Journal des événements
        </h2>
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
