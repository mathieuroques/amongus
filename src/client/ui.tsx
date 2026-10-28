import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { NetStatus } from './net';
import { Store, useStore } from './store';

// --- Notifications éphémères (toasts) ----------------------------------------
const toastStore = new Store<{ msg?: string; kind: 'ok' | 'err' | 'info'; id: number }>({ kind: 'info', id: 0 });
let toastTimer: number | undefined;
export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info') {
  clearTimeout(toastTimer);
  toastStore.update({ msg, kind, id: toastStore.get().id + 1 });
  toastTimer = window.setTimeout(() => toastStore.update({ msg: undefined }), kind === 'err' ? 5000 : 3200);
  if (kind === 'err') {
    buzz([60, 40, 60]);
    sound('error');
  } else if (kind === 'ok') sound('success');
}
export function Toasts() {
  const t = useStore(toastStore);
  if (!t.msg) return null;
  return (
    <div class={`toast ${t.kind}`} role="status" aria-live="polite" onClick={() => toastStore.update({ msg: undefined })}>
      {t.kind === 'ok' ? '✔ ' : t.kind === 'err' ? '✖ ' : ''}
      {t.msg}
    </div>
  );
}

// --- Son & vibration ------------------------------------------------------------
// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur : unlockAudio() est
// appelé sur chaque bouton. Sur iPhone, on demande une session audio « lecture » pour que
// le son passe malgré le bouton silencieux (Safari récent uniquement).
let audio: AudioContext | undefined;
export function unlockAudio() {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    /* pas d'audio */
  }
}
export const audioReady = () => !!audio && audio.state === 'running';

type Note = [freq: number, ms: number, gapMs?: number];
const SOUNDS = {
  meeting: [[523, 160, 40], [659, 160, 40], [784, 260, 120], [523, 160, 40], [659, 160, 40], [784, 260]],
  critical: [[880, 220, 60], [660, 220, 60], [880, 220, 60], [660, 220]],
  sabotage: [[440, 200, 80], [440, 200]],
  stop: [[330, 500, 150], [330, 500, 150], [330, 700]],
  ping: [[988, 120, 60], [1319, 220]],
  start: [[392, 140, 30], [523, 140, 30], [659, 140, 30], [784, 320]],
  success: [[784, 90, 20], [1046, 140]],
  error: [[220, 160]],
  tick: [[1200, 40]],
} satisfies Record<string, Note[]>;
export type SoundName = keyof typeof SOUNDS;

export function sound(name: SoundName, volume = 0.22) {
  try {
    if (!audio || audio.state !== 'running') return;
    let t = audio.currentTime + 0.02;
    for (const [freq, ms, gap = 0] of SOUNDS[name]) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = freq;
      o.type = name === 'stop' || name === 'critical' ? 'sawtooth' : 'square';
      g.gain.setValueAtTime(volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + ms / 1000);
      t += (ms + gap) / 1000;
    }
  } catch {
    /* ignore */
  }
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* iOS : pas de vibration depuis une page web */
  }
}

// --- Confirmation (remplace window.confirm, illisible sur mobile) ------------------
interface ConfirmReq {
  message: string;
  ok: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}
const confirmStore = new Store<{ req?: ConfirmReq }>({});
export function confirmDialog(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => confirmStore.update({ req: { message, ok: opts.ok ?? 'Confirmer', danger: opts.danger, resolve } }));
}
export function ConfirmHost() {
  const { req } = useStore(confirmStore);
  if (!req) return null;
  const close = (v: boolean) => {
    confirmStore.update({ req: undefined });
    req.resolve(v);
  };
  return (
    <div class="modal-bg" style={{ zIndex: 130 }} onClick={(e) => e.target === e.currentTarget && close(false)}>
      <div class="modal stack" role="alertdialog" aria-modal="true">
        <p style={{ fontSize: '1.1rem', fontWeight: 600, whiteSpace: 'pre-wrap' }}>{req.message}</p>
        <div class="row">
          <button class="btn grow" onClick={() => close(false)}>
            Annuler
          </button>
          <button class={`btn grow ${req.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
            {req.ok}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Composants -------------------------------------------------------------------
export function NetBadge({ status }: { status: NetStatus }) {
  const label = status === 'online' ? 'En ligne' : status === 'connecting' ? 'Connexion…' : 'Hors ligne';
  return (
    <span class={`net ${status}`} role="status">
      ● {label}
    </span>
  );
}

export function OfflineBanner({ status, waiting = 0 }: { status: NetStatus; waiting?: number }) {
  const [show, setShow] = useState(false);
  // on évite le clignotement lors des micro-coupures : bandeau après 1,5 s
  useEffect(() => {
    if (status === 'online') return setShow(false);
    const t = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(t);
  }, [status]);
  // une action attend la reconnexion : on le dit tout de suite
  if (waiting > 0 && status !== 'online')
    return (
      <div class="offline-banner waiting" role="status">
        <span class="spinner" /> Reconnexion… votre action part dès que la connexion revient.
      </div>
    );
  if (!show || status === 'online') return null;
  return (
    <div class="offline-banner" role="alert">
      📡 {status === 'connecting' ? 'Reconnexion au serveur…' : 'Connexion perdue'} — vos actions ne sont pas envoyées tant que ce bandeau est affiché.
    </div>
  );
}

export function fmtSec(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}

export function Countdown({ until, now }: { until: number; now: number }) {
  return <span class="countdown">{fmtSec(until - now)}</span>;
}

export function Bar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div class="bar" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Modal({ children, onClose, title }: { children: ComponentChildren; onClose?: () => void; title?: string }) {
  return (
    <div class="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div class="modal stack" role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div class="row">
            <h2 class="grow" style={{ margin: 0 }}>
              {title}
            </h2>
            {onClose && (
              <button class="btn small" onClick={onClose} aria-label="Fermer">
                ✕
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Bouton qui exécute une action, se désactive pendant l'envoi et affiche la réponse du serveur. */
export function ActButton(props: {
  class?: string;
  children: ComponentChildren;
  run: () => Promise<{ ok: boolean; msg?: string } | void>;
  okMsg?: string;
  confirm?: string;
  confirmOk?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      class={`btn ${props.class ?? ''}`}
      disabled={busy || props.disabled}
      title={props.title}
      onClick={async () => {
        unlockAudio();
        if (props.confirm && !(await confirmDialog(props.confirm, { ok: props.confirmOk, danger: /danger/.test(props.class ?? '') }))) return;
        setBusy(true);
        try {
          const r = await props.run();
          if (r && !r.ok) toast(r.msg ?? 'Action refusée.', 'err');
          else if (r && props.okMsg) toast(props.okMsg, 'ok');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <span class="spinner" aria-label="Envoi" /> : props.children}
    </button>
  );
}

/** Saisie d'un code court (chiffres ou lettres) en très gros caractères. */
export function CodeForm(props: { label: string; digits?: boolean; length?: number; submit: (code: string) => Promise<boolean | void>; button: string; btnClass?: string; autoFocus?: boolean }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, []);
  const clean = (x: string) => (props.digits ? x.replace(/\D/g, '') : x.toUpperCase().replace(/\s/g, ''));
  return (
    <form
      class="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        unlockAudio();
        if (!v.trim()) return;
        setBusy(true);
        const ok = await props.submit(v.trim());
        setBusy(false);
        if (ok !== false) setV('');
      }}
    >
      <label class="field">
        <span>{props.label}</span>
        <input
          ref={ref}
          class="code"
          value={v}
          inputMode={props.digits ? 'numeric' : 'text'}
          pattern={props.digits ? '[0-9]*' : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          spellcheck={false}
          maxLength={props.length ?? 8}
          placeholder={props.digits ? '• • • •' : ''}
          onInput={(e) => setV(clean((e.target as HTMLInputElement).value))}
        />
      </label>
      <button class={`btn block big ${props.btnClass ?? 'primary'}`} disabled={busy || !v.trim() || (!!props.digits && !!props.length && v.length !== props.length)}>
        {busy ? 'Envoi…' : props.button}
      </button>
    </form>
  );
}

/** Contenu masqué tant qu'on n'appuie pas (discrétion en public). */
export function Reveal({ children, label }: { children: ComponentChildren; label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), 10_000);
    const hide = () => document.visibilityState !== 'visible' && setShown(false);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [shown]);
  return shown ? (
    <div class="stack">
      {children}
      <button class="btn block" onClick={() => setShown(false)}>
        🙈 Masquer
      </button>
    </div>
  ) : (
    <button class="veil" style={{ width: '100%', border: 'none', color: 'inherit' }} onClick={() => setShown(true)}>
      <div>
        <div style={{ fontSize: '2rem' }}>👁</div>
        <strong>{label}</strong>
        <div class="muted">Touchez pour afficher (se masque seul après 10 s). Cachez votre écran.</div>
      </div>
    </button>
  );
}

/** Garde l'écran allumé pendant la partie (si le navigateur le permet). */
let wakeLock: { release: () => Promise<void> } | undefined;
const wakeStore = new Store<{ on: boolean }>({ on: false });
export const wakeLockOn = () => wakeStore.get().on;
export async function setWakeLock(on: boolean): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return false;
    if (on) {
      wakeLock = await nav.wakeLock.request('screen');
      wakeStore.update({ on: true });
    } else {
      await wakeLock?.release();
      wakeLock = undefined;
      wakeStore.update({ on: false });
    }
    return true;
  } catch {
    return false;
  }
}
// le verrou est perdu quand on quitte l'onglet : on le reprend au retour
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeStore.get().on) void setWakeLock(true);
});
export function WakeLockToggle() {
  const { on } = useStore(wakeStore);
  if (!('wakeLock' in navigator)) return null;
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const want = (e.target as HTMLInputElement).checked;
          if (!(await setWakeLock(want))) toast('Impossible de garder l’écran allumé sur cet appareil.', 'err');
        }}
      />
      Garder l’écran allumé pendant la partie (consomme de la batterie)
    </label>
  );
}

export function Collapse({ title, children, open, count }: { title: ComponentChildren; children: ComponentChildren; open?: boolean; count?: number | string }) {
  return (
    <details class="card collapse" open={open}>
      <summary>
        <span class="grow">{title}</span>
        {count !== undefined && <span class="badge">{count}</span>}
      </summary>
      <div class="stack" style={{ marginTop: '12px' }}>
        {children}
      </div>
    </details>
  );
}
