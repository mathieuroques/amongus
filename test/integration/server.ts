// Démarre un vrai serveur local (wrangler dev = même moteur que la production : workerd + Durable Objects SQLite)
// et fournit des clients WebSocket qui se comportent comme des téléphones.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PORT = Number(process.env.IT_PORT ?? 8799);
export const BASE = `http://127.0.0.1:${PORT}`;
export const persistDir = mkdtempSync(join(tmpdir(), 'imposteurs-it-'));

let proc: ChildProcess | undefined;

export async function startServer() {
  proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistDir, '--show-interactive-dev-session=false'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
  });
  let out = '';
  proc.stdout!.on('data', (d) => (out += d));
  proc.stderr!.on('data', (d) => (out += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await sleep(300);
  }
  throw new Error('Le serveur local n’a pas démarré :\n' + out.slice(-3000));
}

export async function stopServer() {
  if (!proc) return;
  const p = proc;
  proc = undefined;
  p.kill('SIGTERM');
  await new Promise((r) => {
    p.once('exit', r);
    setTimeout(r, 5000);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Msg = Record<string, any>;

/** Un « téléphone » : socket + dernier état reçu + envoi d'actions avec accusé de réception. */
export class Phone {
  ws!: WebSocket;
  state: any;
  token?: string;
  playerId?: string;
  errors: Msg[] = [];
  received: Msg[] = [];
  private nextId = 1;
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];

  constructor(public code: string) {}

  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/games/${this.code}/ws`);
    await new Promise<void>((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(e);
    });
    this.ws.onmessage = (ev) => {
      if (ev.data === 'pong') return this.feed({ t: 'pong' });
      const m = JSON.parse(String(ev.data));
      if (m.t === 'state') this.state = m.v;
      if (m.t === 'token') {
        this.token = m.token;
        this.playerId = m.playerId;
      }
      if (m.t === 'welcome') this.playerId = m.playerId ?? this.playerId;
      if (m.t === 'error') this.errors.push(m);
      this.received.push(m);
      this.feed(m);
    };
    return this;
  }

  private feed(m: Msg) {
    for (const w of [...this.waiters]) {
      if (w.pred(m)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  }

  wait(pred: (m: Msg) => boolean, ms = 10_000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('délai dépassé en attendant un message')), ms);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }

  /** Attend un état qui satisfait la condition (ou le prend tout de suite s'il la satisfait déjà). */
  async waitState(pred: (s: any) => boolean, ms = 10_000) {
    if (this.state && pred(this.state)) return this.state;
    const m = await this.wait((x) => x.t === 'state' && pred(x.v), ms);
    return m.v;
  }

  send(m: Msg) {
    this.ws.send(JSON.stringify(m));
  }

  async act(a: Msg): Promise<{ ok: boolean; data?: any; code?: string; msg?: string }> {
    const id = this.nextId++;
    const p = this.wait((m) => m.t === 'ack' && m.id === id);
    this.send({ t: 'act', id, a });
    return (await p) as any;
  }

  async join(name: string) {
    const p = this.wait((m) => m.t === 'token' || m.t === 'error');
    this.send({ t: 'join', name });
    const m = await p;
    if (m.t === 'token') await this.waitState(() => true);
    return m;
  }

  async hello(token: string) {
    const p = this.wait((m) => m.t === 'welcome' || m.t === 'error' || m.t === 'kicked');
    this.send({ t: 'hello', token });
    const m = await p;
    if (m.t === 'welcome') await this.wait((x) => x.t === 'state');
    return m;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export async function createGame(body: unknown = {}) {
  const r = await fetch(`${BASE}/api/games`, { method: 'POST', body: JSON.stringify(body) });
  return (await r.json()) as { code: string; gmToken: string; gmSecret: string };
}
