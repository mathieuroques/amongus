// Connexion temps réel du téléphone : une action faite pendant une reconnexion attend quelques secondes
// (bandeau « Reconnexion… ») au lieu d'être refusée, et n'est jamais envoyée en double ni après le délai.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: (ev: { code: number }) => void;
  onerror?: () => void;
  constructor(public url: string) {
    FakeWS.all.push(this);
  }
  send(d: string) {
    if (this.readyState !== 1) throw new Error('socket fermée');
    this.sent.push(d);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  /** Le serveur accepte la connexion. */
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** Message du serveur. */
  push(m: object | string) {
    this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) });
  }
  acts() {
    return this.sent.filter((x) => x !== 'ping').map((x) => JSON.parse(x)).filter((m) => m.t === 'act');
  }
}

const g = globalThis as any;
let Connection: typeof import('../src/client/net').Connection;
let RECONNECT_GRACE_MS: number;
let STALE_MS: number;

beforeEach(async () => {
  vi.useFakeTimers();
  FakeWS.all = [];
  g.window = globalThis;
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  g.location = { protocol: 'https:', host: 'exemple.test' };
  g.WebSocket = FakeWS;
  ({ Connection, RECONNECT_GRACE_MS, STALE_MS } = await import('../src/client/net'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Connexion établie et authentifiée (« welcome » reçu). */
function online() {
  const c = new Connection('BCDFGH', { kind: 'token', token: 'tok' });
  const ws = FakeWS.all.at(-1)!;
  ws.accept();
  expect(JSON.parse(ws.sent[0])).toEqual({ t: 'hello', token: 'tok' });
  ws.push({ t: 'welcome', as: 'player', playerId: 'p1' });
  expect(c.store.get().status).toBe('online');
  return { c, ws };
}

describe('connexion : actions pendant une reconnexion', () => {
  it('en ligne : l’action part tout de suite et attend l’accusé du serveur', async () => {
    const { c, ws } = online();
    const p = c.act({ type: 'checkIn' });
    await vi.advanceTimersByTimeAsync(0);
    const [m] = ws.acts();
    expect(m.a).toEqual({ type: 'checkIn' });
    ws.push({ t: 'ack', id: m.id, ok: true, data: { ok: true } });
    expect(await p).toEqual({ ok: true, data: { ok: true }, code: undefined, msg: undefined });
    expect(c.store.get().waiting).toBe(0);
  });

  it('coupure puis retour en moins de 5 s : l’action attend (« Reconnexion… ») puis part une seule fois', async () => {
    const { c, ws } = online();
    ws.close(); // coupure (téléphone sorti de veille, Wi-Fi qui change…)
    expect(c.store.get().status).toBe('offline');
    const p = c.act({ type: 'report', code: '1234' });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.get().waiting).toBe(1); // le bandeau « Reconnexion… » s'affiche
    // la reconnexion est lancée immédiatement, sans attendre le prochain essai programmé
    const ws2 = FakeWS.all.at(-1)!;
    expect(ws2).not.toBe(ws);
    await vi.advanceTimersByTimeAsync(1500);
    ws2.accept();
    expect(ws2.acts()).toHaveLength(0); // pas avant la réauthentification
    ws2.push({ t: 'welcome', as: 'player', playerId: 'p1' });
    await vi.advanceTimersByTimeAsync(0);
    const acts = ws2.acts();
    expect(acts).toHaveLength(1);
    expect(acts[0].a).toEqual({ type: 'report', code: '1234' });
    expect(ws.acts()).toHaveLength(0);
    expect(c.store.get().waiting).toBe(0);
    ws2.push({ t: 'ack', id: acts[0].id, ok: true });
    expect((await p).ok).toBe(true);
  });

  it('pas de réseau pendant 5 s : l’action est refusée et n’est JAMAIS envoyée plus tard', async () => {
    const { c, ws } = online();
    ws.close();
    const p = c.act({ type: 'vote', target: 'skip' });
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS + 10);
    const r = await p;
    expect(r).toMatchObject({ ok: false, code: 'offline' });
    expect(c.store.get().waiting).toBe(0);
    // la connexion revient ensuite : l'action abandonnée ne part pas
    const last = FakeWS.all.at(-1)!;
    last.accept();
    last.push({ t: 'welcome', as: 'player', playerId: 'p1' });
    await vi.advanceTimersByTimeAsync(20_000);
    for (const w of FakeWS.all) expect(w.acts()).toHaveLength(0);
  });

  it('connexion « fantôme » au retour de veille (aucun message depuis 20 s) : reconnexion avant d’envoyer', async () => {
    const { c, ws } = online();
    // le téléphone était en veille : plus aucun message, mais la socket se croit encore ouverte
    vi.setSystemTime(Date.now() + STALE_MS + 1000);
    const p = c.act({ type: 'checkIn' });
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.readyState).toBe(3); // ancienne socket fermée
    expect(ws.acts()).toHaveLength(0);
    const ws2 = FakeWS.all.at(-1)!;
    ws2.accept();
    ws2.push({ t: 'state', v: { now: Date.now() } });
    await vi.advanceTimersByTimeAsync(0);
    const acts = ws2.acts();
    expect(acts).toHaveLength(1);
    ws2.push({ t: 'ack', id: acts[0].id, ok: false, code: 'not_now', msg: 'Pas de rassemblement en cours.' });
    expect(await p).toMatchObject({ ok: false, code: 'not_now' });
  });

  it('plusieurs actions en attente : toutes partent au retour, dans l’ordre', async () => {
    const { c, ws } = online();
    ws.close();
    const p1 = c.act({ type: 'checkIn' });
    const p2 = c.act({ type: 'readyVote' });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.get().waiting).toBe(2);
    const ws2 = FakeWS.all.at(-1)!;
    ws2.accept();
    ws2.push({ t: 'welcome', as: 'player', playerId: 'p1' });
    await vi.advanceTimersByTimeAsync(0);
    const acts = ws2.acts();
    expect(acts.map((a) => a.a.type)).toEqual(['checkIn', 'readyVote']);
    for (const a of acts) ws2.push({ t: 'ack', id: a.id, ok: true });
    expect((await p1).ok && (await p2).ok).toBe(true);
    expect(c.store.get().waiting).toBe(0);
  });

  it('connexion fermée volontairement (session transférée) : refus immédiat', async () => {
    const { c } = online();
    c.close();
    expect(await c.act({ type: 'checkIn' })).toMatchObject({ ok: false, code: 'offline' });
  });
});
