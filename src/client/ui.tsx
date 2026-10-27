import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { NetStatus } from './net';
import { Store, useStore } from './store';

// --- Notifications éphémères -------------------------------------------------
const toastStore = new Store<{ msg?: string; kind: 'ok' | 'err' | 'info'; id: number }>({ kind: 'info', id: 0 });
let toastTimer: number | undefined;
export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info') {
  clearTimeout(toastTimer);
  toastStore.update({ msg, kind, id: toastStore.get().id + 1 });
  toastTimer = window.setTimeout(() => toastStore.update({ msg: undefined }), kind === 'err' ? 5000 : 3000);
  if (kind === 'err') buzz([60, 40, 60]);
}
export function Toasts() {
  const t = useStore(toastStore);
  if (!t.msg) return null;
  return (
    <div class={`toast ${t.kind}`} role="status" aria-live="polite" onClick={() => toastStore.update({ msg: undefined })}>
      {t.msg}
    </div>
  );
}

// --- Son & vibration ------------------------------------------------------------
let audio: AudioContext | undefined;
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    /* pas d'audio */
  }
}
export function beep(freq = 880, ms = 180, times = 1) {
  try {
    if (!audio) return;
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = freq;
      o.type = 'square';
      g.gain.value = 0.06;
      o.connect(g).connect(audio.destination);
      const t0 = audio.currentTime + i * (ms / 1000) * 1.6;
      o.start(t0);
      o.stop(t0 + ms / 1000);
    }
  } catch {
    /* ignore */
  }
}
export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* iOS : pas de vibration web */
  }
}

// --- Composants -------------------------------------------------------------------
export function NetBadge({ status }: { status: NetStatus }) {
  const label = status === 'online' ? 'En ligne' : status === 'connecting' ? 'Connexion…' : 'Hors ligne';
  return <span class={`net ${status}`}>{label}</span>;
}

export function OfflineBanner({ status }: { status: NetStatus }) {
  if (status === 'online') return null;
  return (
    <div class="offline-banner" role="alert">
      {status === 'connecting' ? 'Reconnexion au serveur…' : 'Connexion perdue — vos actions ne sont pas envoyées. Reconnexion automatique…'}
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

export function Bar({ value }: { value: number }) {
  return (
    <div class="bar" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

export function Modal({ children, onClose, title }: { children: ComponentChildren; onClose?: () => void; title?: string }) {
  return (
    <div class="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div class="modal stack" role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div class="row">
            <h2 class="grow">{title}</h2>
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

/** Bouton qui exécute une action asynchrone, se désactive pendant l'envoi et affiche le résultat serveur. */
export function ActButton(props: {
  class?: string;
  children: ComponentChildren;
  run: () => Promise<{ ok: boolean; msg?: string } | void>;
  okMsg?: string;
  confirm?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      class={`btn ${props.class ?? ''}`}
      disabled={busy || props.disabled}
      onClick={async () => {
        unlockAudio();
        if (props.confirm && !window.confirm(props.confirm)) return;
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
      {busy ? '…' : props.children}
    </button>
  );
}

/** Saisie d'un code court (chiffres ou lettres). */
export function CodeForm(props: { label: string; digits?: boolean; length?: number; submit: (code: string) => Promise<boolean | void>; button: string; btnClass?: string }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
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
          class="code"
          value={v}
          inputMode={props.digits ? 'numeric' : 'text'}
          autoComplete="off"
          autoCapitalize="characters"
          spellcheck={false}
          maxLength={props.length ?? 8}
          onInput={(e) => setV((e.target as HTMLInputElement).value)}
        />
      </label>
      <button class={`btn block big ${props.btnClass ?? 'primary'}`} disabled={busy || !v.trim()}>
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
    const t = setTimeout(() => setShown(false), 8000);
    return () => clearTimeout(t);
  }, [shown]);
  return shown ? (
    <div onClick={() => setShown(false)}>{children}</div>
  ) : (
    <button class="veil" style={{ width: '100%', border: 'none', color: 'inherit' }} onClick={() => setShown(true)}>
      <div>
        <div style={{ fontSize: '2rem' }}>👁</div>
        <strong>{label}</strong>
        <div class="muted">Touchez pour afficher (masqué à nouveau après 8 s). Cachez votre écran.</div>
      </div>
    </button>
  );
}

export function WakeLockToggle() {
  const [on, setOn] = useState(false);
  const [lock, setLock] = useState<any>();
  const supported = 'wakeLock' in navigator;
  if (!supported) return null;
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const want = (e.target as HTMLInputElement).checked;
          try {
            if (want) setLock(await (navigator as any).wakeLock.request('screen'));
            else await lock?.release();
            setOn(want);
          } catch {
            toast('Impossible de garder l’écran allumé sur cet appareil.', 'err');
          }
        }}
      />
      Garder l’écran allumé (consomme de la batterie)
    </label>
  );
}
