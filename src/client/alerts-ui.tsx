import { useEffect, useState } from 'preact/hooks';
import type { GmView, PlayerView } from '../shared/view';
import { alertStore, canVibrate, enablePush, isIOS, pushActive, pushSupport } from './alerts';
import type { Connection } from './net';
import { useStore } from './store';
import { audioReady, buzz, sound, toast, unlockAudio, WakeLockToggle } from './ui';

const COLORS: Record<string, string> = {
  meeting: '#c4142c',
  critical: '#c4142c',
  stop: '#c4142c',
  safety: '#c4142c',
  sabotage: '#a26a00',
  ping: '#1d5fd0',
  start: '#1d5fd0',
};

/** Écran d'alerte plein écran : impossible à manquer, se ferme d'un geste. */
export function AlertOverlay() {
  const { current } = useStore(alertStore);
  if (!current) return null;
  return (
    <div class="alert-screen" style={{ background: COLORS[current.kind] }} role="alertdialog" aria-live="assertive">
      <div class="alert-icon">{current.kind === 'meeting' ? '📣' : current.kind === 'ping' ? '🔔' : current.kind === 'start' ? '🎭' : '🚨'}</div>
      <h1>{current.title}</h1>
      <p>{current.body}</p>
      <button class="btn big block" style={{ background: '#fff', color: '#111', maxWidth: '420px' }} onClick={() => alertStore.update({ current: undefined })}>
        {current.kind === 'meeting' ? 'J’y vais' : 'OK'}
      </button>
    </div>
  );
}

/** Réglage des alertes (salon des joueurs, tableau de bord du MJ). */
export function AlertSetup({ conn, pushKey, pushOnServer, compact }: { conn: Connection<PlayerView> | Connection<GmView>; pushKey?: string; pushOnServer?: boolean; compact?: boolean }) {
  const [soundOk, setSoundOk] = useState(audioReady());
  const [pushOk, setPushOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const sup = pushSupport();
  useEffect(() => {
    void pushActive(pushKey).then(setPushOk);
  }, [pushKey, pushOnServer]);
  const allOk = soundOk && (pushOk || sup !== 'ok');
  return (
    <div class={`card stack ${allOk ? 'ok' : 'warn'}`}>
      <h3 style={{ margin: 0 }}>🔔 Alertes de ce téléphone {allOk ? '— prêtes' : ''}</h3>
      {!compact && <p class="muted" style={{ margin: 0 }}>Pour ne rater ni une réunion ni un sabotage, réglez votre téléphone maintenant.</p>}
      <div class="row">
        <span class="grow">{soundOk ? '✅' : '⬜'} Son {isIOS() ? '(désactivez le mode silencieux)' : ''}</span>
        <button
          class="btn small"
          onClick={() => {
            unlockAudio();
            setTimeout(() => {
              sound('meeting');
              buzz([300, 100, 300]);
              setSoundOk(audioReady());
            }, 60);
          }}
        >
          Tester
        </button>
      </div>
      <div class="row">
        <span class="grow">{canVibrate() ? '✅ Vibration disponible' : '➖ Vibration indisponible sur ce navigateur (iPhone)'}</span>
      </div>
      <div class="row">
        <span class="grow">
          {pushOk ? '✅' : '⬜'} Notifications quand l’écran est verrouillé
          {sup === 'needs-install' && <small class="muted"> — sur iPhone : Partager → « Sur l’écran d’accueil », puis ouvrez l’application depuis l’icône.</small>}
          {sup === 'insecure' && <small class="muted"> — indisponibles sans https (serveur local).</small>}
          {sup === 'unsupported' && <small class="muted"> — non gérées par ce navigateur.</small>}
        </span>
        {sup === 'ok' && !pushOk && (
          <button
            class="btn small primary"
            disabled={busy}
            onClick={async () => {
              unlockAudio();
              setBusy(true);
              const r = await enablePush(conn, pushKey);
              setBusy(false);
              toast(r.msg, r.ok ? 'ok' : 'err');
              setPushOk(r.ok);
            }}
          >
            Activer
          </button>
        )}
      </div>
      <WakeLockToggle />
    </div>
  );
}
