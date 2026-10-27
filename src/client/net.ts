// Connexion temps réel au serveur. Aucune action n'est considérée comme enregistrée
// tant que le serveur ne l'a pas confirmée (accusé de réception « ack »).

import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { GmView, PlayerView } from '../shared/view';
import { Store } from './store';

export type NetStatus = 'connecting' | 'online' | 'offline';

export interface NetState<V> {
  status: NetStatus;
  view?: V;
  /** Décalage horloge serveur − horloge locale (ms). */
  skew: number;
  error?: { code: string; msg: string };
  kicked?: boolean;
  lastMessageAt: number;
}

export interface ActResult<T = any> {
  ok: boolean;
  data?: T;
  code?: string;
  msg?: string;
}

export type Auth = { kind: 'token'; token: string } | { kind: 'join'; name: string } | { kind: 'gmLogin'; secret: string } | { kind: 'reclaim'; code: string };

export class Connection<V extends PlayerView | GmView> {
  readonly store: Store<NetState<V>>;
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: ActResult) => void; timer: number }>();
  private retry = 0;
  private closed = false;
  private pingTimer?: number;
  private reconnectTimer?: number;
  private auth: Auth;
  onToken?: (token: string, as: 'player' | 'gm', playerId?: string) => void;
  onAuthFailed?: (code: string, msg: string) => void;

  constructor(readonly code: string, auth: Auth) {
    this.auth = auth;
    this.store = new Store<NetState<V>>({ status: 'connecting', skew: 0, lastMessageAt: Date.now() });
    this.connect();
    window.addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private wake = () => {
    if (this.closed) return;
    if (!this.ws || this.ws.readyState > 1) this.connect();
  };

  private onVisible = () => {
    if (document.visibilityState === 'visible') {
      // au retour de veille, on vérifie immédiatement la connexion
      if (Date.now() - this.store.get().lastMessageAt > 20_000) this.reconnectNow();
      else this.wake();
    }
  };

  private reconnectNow() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    clearTimeout(this.reconnectTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/games/${this.code}/ws`);
    this.ws = ws;
    this.store.update({ status: 'connecting' });
    ws.onopen = () => {
      this.retry = 0;
      const a = this.auth;
      if (a.kind === 'token') this.raw({ t: 'hello', token: a.token });
      else if (a.kind === 'join') this.raw({ t: 'join', name: a.name });
      else if (a.kind === 'gmLogin') this.raw({ t: 'gmLogin', secret: a.secret });
      else this.raw({ t: 'reclaim', code: a.code });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState !== 1) return;
        ws.send('ping');
        // pas de message depuis 35 s malgré les pings : connexion morte
        if (Date.now() - this.store.get().lastMessageAt > 35_000) this.reconnectNow();
      }, 12_000);
    };
    ws.onmessage = (ev) => {
      this.store.update({ lastMessageAt: Date.now() });
      if (ev.data === 'pong') return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.failPending('Connexion perdue : action non confirmée par le serveur. Vérifiez puis réessayez.');
      if (ev.code === 4001) {
        this.store.update({ status: 'offline', kicked: true });
        this.closed = true;
        return;
      }
      if (ev.code === 4004) {
        this.store.update({ status: 'offline', error: { code: 'not_found', msg: 'Partie introuvable.' } });
        this.closed = true;
        return;
      }
      this.store.update({ status: 'offline' });
      const delay = Math.min(10_000, 500 * 2 ** this.retry++) + Math.random() * 400;
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {
      /* onclose suit */
    };
  }

  private handle(msg: ServerMsg) {
    switch (msg.t) {
      case 'state':
        this.store.update({ status: 'online', view: msg.v as V, skew: msg.v.now - Date.now(), error: undefined });
        break;
      case 'welcome':
        this.store.update({ status: 'online' });
        break;
      case 'token':
        this.auth = { kind: 'token', token: msg.token };
        this.onToken?.(msg.token, msg.as, msg.playerId);
        break;
      case 'error':
        if (['bad_token', 'bad_secret', 'bad_reclaim', 'name_taken', 'bad_name', 'started', 'locked', 'full', 'blocked', 'already'].includes(msg.code)) {
          this.onAuthFailed?.(msg.code, msg.msg);
          if (msg.code === 'bad_token') this.close();
        }
        this.store.update({ error: { code: msg.code, msg: msg.msg } });
        break;
      case 'kicked':
        this.store.update({ kicked: true, status: 'offline' });
        this.close();
        break;
      case 'ack': {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve({ ok: msg.ok, data: msg.data, code: msg.code, msg: msg.msg });
        }
        break;
      }
    }
  }

  private raw(m: ClientMsg) {
    this.ws?.send(JSON.stringify(m));
  }

  private failPending(msg: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, code: 'network', msg });
      this.pending.delete(id);
    }
  }

  /** Envoie une action et attend la confirmation du serveur (jamais d'affichage « réussi » sans elle). */
  act<T = any>(a: object): Promise<ActResult<T>> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== 1 || this.store.get().status !== 'online') {
        resolve({ ok: false, code: 'offline', msg: 'Hors connexion : action non envoyée. Attendez la reconnexion.' });
        return;
      }
      const id = this.nextId++;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: 'timeout', msg: 'Pas de réponse du serveur : l’action n’a peut-être pas été enregistrée.' });
      }, 10_000);
      this.pending.set(id, { resolve, timer });
      this.raw({ t: 'act', id, a: a as never });
    });
  }

  /** Change le mode d'authentification (ex. nouveau pseudonyme après un refus) et le renvoie. */
  setAuth(a: Auth) {
    this.auth = a;
    this.store.update({ error: undefined });
    if (this.ws?.readyState === 1) {
      if (a.kind === 'join') this.raw({ t: 'join', name: a.name });
      else if (a.kind === 'gmLogin') this.raw({ t: 'gmLogin', secret: a.secret });
      else if (a.kind === 'reclaim') this.raw({ t: 'reclaim', code: a.code });
      else this.raw({ t: 'hello', token: a.token });
    }
  }

  serverNow(): number {
    return Date.now() + this.store.get().skew;
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    window.removeEventListener('online', this.wake);
    document.removeEventListener('visibilitychange', this.onVisible);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
