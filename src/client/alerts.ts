// Alertes des joueurs : son, vibration, écran d'alerte plein écran et notifications push.
//
// Trois niveaux, du plus fiable au moins fiable :
//  1. application ouverte et écran allumé : son + vibration (Android) + écran d'alerte ;
//  2. application en arrière-plan / écran verrouillé : notification push (si activée) ;
//  3. dans tous les cas : annonce à voix haute par le maître du jeu (recommandé).

import { useEffect, useRef } from 'preact/hooks';
import type { GmView, PlayerView } from '../shared/view';
import { unb64u } from '../shared/webpush';
import type { Connection } from './net';
import { Store } from './store';
import { buzz, sound, type SoundName } from './ui';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export type PushSupport = 'ok' | 'insecure' | 'needs-install' | 'unsupported';

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install';
  return 'ok';
}

export const canVibrate = () => typeof navigator.vibrate === 'function';

async function swRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready.then(() => reg);
}

function sameKey(sub: PushSubscription, key: string) {
  const k = sub.options?.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  const b = unb64u(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Notifications déjà actives sur cet appareil pour cette partie ? */
export async function pushActive(key?: string): Promise<boolean> {
  if (!key || pushSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  const reg = await swRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return !!sub && sameKey(sub, key);
}

/** Demande l'autorisation (geste de l'utilisateur obligatoire) puis enregistre l'abonnement sur le serveur. */
export async function enablePush(conn: Connection<PlayerView> | Connection<GmView>, key: string | undefined): Promise<{ ok: boolean; msg: string }> {
  const sup = pushSupport();
  if (sup === 'insecure') return { ok: false, msg: 'Notifications impossibles sans connexion sécurisée (https).' };
  if (sup === 'needs-install') return { ok: false, msg: 'Sur iPhone, ajoutez d’abord l’application à l’écran d’accueil (Partager → « Sur l’écran d’accueil »), ouvrez-la depuis l’icône, puis réessayez.' };
  if (sup === 'unsupported') return { ok: false, msg: 'Ce navigateur ne gère pas les notifications. Gardez l’application ouverte.' };
  if (!key) return { ok: false, msg: 'Le serveur n’a pas encore fourni sa clé, réessayez dans un instant.' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, msg: 'Notifications refusées. Vous pouvez les autoriser dans les réglages du navigateur pour ce site.' };
  try {
    const reg = (await swRegistration())!;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) as BufferSource });
    const r = await conn.act({ type: 'pushSubscribe', subscription: sub.toJSON() });
    return r.ok ? { ok: true, msg: 'Notifications activées.' } : { ok: false, msg: r.msg ?? 'Refusé par le serveur.' };
  } catch (e) {
    return { ok: false, msg: `Activation impossible : ${(e as Error).message}` };
  }
}

// --- Écran d'alerte plein écran ------------------------------------------------------
export interface AlertScreen {
  id: number;
  kind: 'meeting' | 'critical' | 'sabotage' | 'stop' | 'ping' | 'start' | 'safety';
  title: string;
  body: string;
}
export const alertStore = new Store<{ current?: AlertScreen }>({});
let alertSeq = 1;

export function raiseAlert(kind: AlertScreen['kind'], title: string, body: string, snd: SoundName, vib: number[]) {
  alertStore.update({ current: { id: alertSeq++, kind, title, body } });
  sound(snd);
  buzz(vib);
}

const VIB = {
  meeting: [500, 150, 500, 150, 500],
  critical: [250, 100, 250, 100, 250, 100, 250],
  sabotage: [200, 100, 200],
  stop: [800, 200, 800],
  ping: [200, 100, 200],
  start: [300],
  killed: [400, 120, 400],
};

/** Déclenche les alertes lors des changements importants de l'état reçu du serveur. */
export function usePlayerAlerts(v?: PlayerView) {
  const prev = useRef<{ phase?: string; sab?: string; meetingId?: number; stop?: boolean; ping?: number; body?: boolean }>();
  useEffect(() => {
    if (!v) return;
    const p = prev.current;
    prev.current = { phase: v.phase, sab: v.sabotage?.kind, meetingId: v.meeting?.id, stop: v.emergencyStop, ping: v.pingId, body: v.me.bodyPending };
    if (!p) return; // premier état reçu (chargement de la page) : pas d'alerte rétroactive
    // éliminé·e à l'instant : vibration seulement (un son attirerait l'attention des témoins)
    if (v.me.bodyPending && !p.body) buzz(VIB.killed);
    const room = v.terrain.rooms.find((r) => r.id === v.terrain.meetingRoomId)?.name ?? 'la salle de réunion';
    if (v.emergencyStop && !p.stop) return raiseAlert('stop', 'STOP', 'Arrêt d’urgence : arrêtez-vous et écoutez le maître du jeu.', 'stop', VIB.stop);
    if (v.phase === 'meeting' && v.meeting && v.meeting.id !== p.meetingId) {
      const what = v.meeting.kind === 'report' ? `Corps de ${v.meeting.bodyOfName} signalé` : v.meeting.kind === 'emergency' ? 'Réunion d’urgence' : 'Réunion convoquée par le MJ';
      return raiseAlert('meeting', 'RÉUNION !', `${what}. Rejoignez la salle de réunion (${room}) en marchant.`, 'meeting', VIB.meeting);
    }
    if (v.sabotage && v.sabotage.kind !== p.sab) {
      if (v.sabotage.critical) return raiseAlert('critical', v.sabotage.label, 'Sabotage critique : il faut réparer avant la fin du compte à rebours !', 'critical', VIB.critical);
      sound('sabotage');
      buzz(VIB.sabotage);
    }
    if (v.pingId > (p.ping ?? 0)) return raiseAlert('ping', 'Test d’alerte', 'Le maître du jeu teste les alertes : votre téléphone sonne et vibre correctement.', 'ping', VIB.ping);
    if (v.phase === 'playing' && p.phase === 'lobby') {
      sound('start');
      buzz(VIB.start);
    }
    if (p.phase === 'meeting' && v.phase === 'playing') alertStore.update({ current: undefined });
  }, [v]);

  // Sirène répétée tant qu'un sabotage critique est actif (application ouverte uniquement).
  const critical = v?.phase === 'playing' && v.sabotage?.critical && !v.paused;
  useEffect(() => {
    if (!critical) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        sound('critical', 0.12);
        buzz(200);
      }
    }, 7000);
    return () => clearInterval(id);
  }, [critical]);
}

/** Alertes du maître du jeu : nouvelles alertes sécurité. */
export function useGmAlerts(v?: GmView) {
  const last = useRef<number>();
  useEffect(() => {
    if (!v) return;
    const max = Math.max(0, ...v.alerts.map((a) => a.id));
    if (last.current !== undefined && max > last.current) {
      const a = v.alerts.find((x) => x.id === max)!;
      raiseAlert('safety', a.kind === 'dispute' ? 'ÉLIMINATION À VÉRIFIER' : 'ALERTE SÉCURITÉ', `${a.playerName} : ${a.message}`, 'stop', VIB.stop);
    }
    last.current = max;
  }, [v?.alerts]);
}
