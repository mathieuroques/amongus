// Durable Object : une instance par partie. Il détient l'état officiel, applique les règles
// (moteur partagé), persiste l'état dans SQLite et diffuse à chaque appareil sa vue filtrée.
// Les WebSockets utilisent l'API « hibernation » : pas de facturation de durée quand tout est calme.

import { DurableObject } from 'cloudflare:workers';
import {
  addPlayer, createGame, GameError, gmAction, log, nextWakeup, playerAction, tick, type GmAction, type PlayerAction,
} from '../shared/engine';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { cryptoRng, randomCode, randomToken, sha256 } from '../shared/rng';
import type { GameState } from '../shared/types';
import { viewForGm, viewForPlayer } from '../shared/view';
import type { Env } from './index';

interface Attachment {
  k: 'anon' | 'p' | 'gm';
  pid?: string;
}

const MAX_MSG = 400_000;
const RATE_WINDOW = 10_000;
const RATE_MAX = 60;

export class GameRoom extends DurableObject<Env> {
  private state?: GameState;
  private rate = new WeakMap<WebSocket, number[]>();
  private anonTries = new WeakMap<WebSocket, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Le « ping » applicatif du client reçoit « pong » sans réveiller l'objet (ni consommer de quota de durée).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get<GameState>('state');
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      if (this.state) return new Response('exists', { status: 409 });
      const body = (await req.json()) as { code: string; gmTokenHash: string; gmSecretHash: string; settings?: unknown; terrain?: unknown };
      this.state = createGame(body.code, body.gmTokenHash, body.gmSecretHash, Date.now(), body.settings, body.terrain);
      await this.save();
      return new Response('ok');
    }
    if (url.pathname === '/info') {
      const s = this.state;
      if (!s) return Response.json({ exists: false }, { status: 404 });
      return Response.json({ exists: true, phase: s.phase, players: s.players.filter((p) => !p.kicked).length, locked: s.lobbyLocked, maxPlayers: s.settings.maxPlayers });
    }
    if (url.pathname === '/ws') {
      if (!this.state) return new Response('Partie introuvable', { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ k: 'anon' } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  private async save() {
    if (!this.state) return;
    this.state.seq++;
    await this.ctx.storage.put('state', this.state);
    await this.scheduleAlarm();
  }

  private async scheduleAlarm() {
    if (!this.state) return;
    const now = Date.now();
    const next = nextWakeup(this.state, now);
    if (next !== undefined) await this.ctx.storage.setAlarm(Math.max(next, now + 50));
    else await this.ctx.storage.deleteAlarm();
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket fermée */
    }
  }

  private att(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { k: 'anon' };
  }

  private connectedIds(exclude?: WebSocket): Set<string> {
    const set = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const a = this.att(ws);
      if (a.k === 'p' && a.pid) set.add(a.pid);
    }
    return set;
  }

  private viewFor(ws: WebSocket, now: number, connected: Set<string>): ServerMsg | undefined {
    const s = this.state!;
    const a = this.att(ws);
    if (a.k === 'gm') return { t: 'state', v: viewForGm(s, now, connected) };
    if (a.k === 'p' && a.pid) {
      const p = s.players.find((x) => x.id === a.pid);
      if (!p || p.kicked) return { t: 'kicked' };
      return { t: 'state', v: viewForPlayer(s, a.pid, now) };
    }
    return undefined;
  }

  private broadcast(exclude?: WebSocket) {
    if (!this.state) return;
    const now = Date.now();
    const connected = this.connectedIds(exclude);
    const cache = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const a = this.att(ws);
      const key = a.k === 'gm' ? 'gm' : a.pid ?? '';
      if (!key) continue;
      let text = cache.get(key);
      if (!text) {
        const msg = this.viewFor(ws, now, connected);
        if (!msg) continue;
        text = JSON.stringify(msg);
        cache.set(key, text);
      }
      try {
        ws.send(text);
        if (text === '{"t":"kicked"}') ws.close(4001, 'exclu');
      } catch {
        /* ignore */
      }
    }
  }

  private rateLimited(ws: WebSocket, now: number): boolean {
    const arr = (this.rate.get(ws) ?? []).filter((t) => t > now - RATE_WINDOW);
    arr.push(now);
    this.rate.set(ws, arr);
    return arr.length > RATE_MAX;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const s = this.state;
    if (!s) return ws.close(4004, 'partie introuvable');
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    const now = Date.now();
    if (this.rateLimited(ws, now)) return this.send(ws, { t: 'error', code: 'rate', msg: 'Trop de messages, ralentissez.' });
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const a = this.att(ws);

    // Avant tout traitement, les minuteurs échus sont appliqués (une action ne peut pas « passer » après la fin d'un délai).
    if (tick(s, now)) await this.save();

    switch (msg.t) {
      case 'hello': {
        const h = await sha256(String(msg.token ?? ''));
        if (s.gmTokenHashes.includes(h)) {
          ws.serializeAttachment({ k: 'gm' } satisfies Attachment);
          this.send(ws, { t: 'welcome', as: 'gm' });
        } else {
          const p = s.players.find((x) => x.tokenHash === h);
          if (!p) return this.send(ws, { t: 'error', code: 'bad_token', msg: 'Session inconnue pour cette partie.' });
          if (p.kicked) return this.send(ws, { t: 'kicked' });
          ws.serializeAttachment({ k: 'p', pid: p.id } satisfies Attachment);
          this.send(ws, { t: 'welcome', as: 'player', playerId: p.id });
        }
        this.broadcast(); // met aussi à jour l'indicateur de connexion côté MJ
        return;
      }
      case 'join': {
        if (a.k !== 'anon') return this.send(ws, { t: 'error', code: 'already', msg: 'Déjà connecté.' });
        const token = randomToken();
        try {
          const p = addPlayer(s, msg.name, await sha256(token), now);
          ws.serializeAttachment({ k: 'p', pid: p.id } satisfies Attachment);
          this.send(ws, { t: 'token', token, as: 'player', playerId: p.id });
          await this.save();
          this.broadcast();
        } catch (e) {
          this.sendError(ws, e);
        }
        return;
      }
      case 'gmLogin': {
        s.gmFailures = s.gmFailures.filter((t) => t > now - 600_000);
        if (s.gmFailures.length >= 8) return this.send(ws, { t: 'error', code: 'blocked', msg: 'Trop d’essais. Réessayez dans 10 minutes.' });
        const h = await sha256(String(msg.secret ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
        if (h !== s.gmSecretHash) {
          s.gmFailures.push(now);
          await this.save();
          return this.send(ws, { t: 'error', code: 'bad_secret', msg: 'Code maître du jeu incorrect.' });
        }
        const token = randomToken();
        s.gmTokenHashes = [...s.gmTokenHashes.slice(-4), await sha256(token)];
        log(s, now, 'gm', 'Le maître du jeu s’est connecté depuis un nouvel appareil.');
        await this.save();
        ws.serializeAttachment({ k: 'gm' } satisfies Attachment);
        this.send(ws, { t: 'token', token, as: 'gm' });
        this.broadcast();
        return;
      }
      case 'reclaim': {
        const tries = (this.anonTries.get(ws) ?? 0) + 1;
        this.anonTries.set(ws, tries);
        if (tries > 5) return this.send(ws, { t: 'error', code: 'blocked', msg: 'Trop d’essais.' });
        const h = await sha256(String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
        const entry = s.reclaim.find((r) => r.codeHash === h && r.expiresAt > now);
        const p = entry && s.players.find((x) => x.id === entry.playerId && !x.kicked);
        if (!entry || !p) return this.send(ws, { t: 'error', code: 'bad_reclaim', msg: 'Code de reconnexion invalide ou expiré.' });
        const token = randomToken();
        p.tokenHash = await sha256(token); // l'ancien appareil est déconnecté
        s.reclaim = s.reclaim.filter((r) => r !== entry);
        log(s, now, 'gm', `${p.name} a récupéré sa session sur un autre appareil.`);
        for (const other of this.ctx.getWebSockets()) {
          const oa = this.att(other);
          if (oa.k === 'p' && oa.pid === p.id && other !== ws) {
            other.serializeAttachment({ k: 'anon' } satisfies Attachment);
            this.send(other, { t: 'error', code: 'bad_token', msg: 'Votre session a été transférée sur un autre appareil.' });
          }
        }
        ws.serializeAttachment({ k: 'p', pid: p.id } satisfies Attachment);
        this.send(ws, { t: 'token', token, as: 'player', playerId: p.id });
        await this.save();
        this.broadcast();
        return;
      }
      case 'act': {
        const id = Number(msg.id) || 0;
        if (a.k === 'anon') return this.send(ws, { t: 'ack', id, ok: false, code: 'auth', msg: 'Non connecté.' });
        try {
          let data: unknown;
          const ctx = { now, rng: cryptoRng };
          if (a.k === 'gm') {
            const act = msg.a as GmAction | { type: 'reclaimCode'; playerId: string };
            if (act?.type === 'reclaimCode') data = await this.makeReclaim(act.playerId, now);
            else data = gmAction(s, act as GmAction, ctx);
          } else {
            data = playerAction(s, a.pid!, msg.a as PlayerAction, ctx);
          }
          tick(s, now);
          await this.save();
          this.send(ws, { t: 'ack', id, ok: true, data });
          this.broadcast();
        } catch (e) {
          // Une action refusée peut quand même avoir modifié l'état (ex. compteur de codes erronés).
          await this.save();
          this.sendError(ws, e, id);
          this.broadcast();
        }
        return;
      }
    }
  }

  private async makeReclaim(playerId: string, now: number) {
    const s = this.state!;
    const p = s.players.find((x) => x.id === playerId && !x.kicked);
    if (!p) throw new GameError('no_player', 'Joueur introuvable.');
    const code = randomCode(6, cryptoRng);
    s.reclaim = s.reclaim.filter((r) => r.playerId !== playerId && r.expiresAt > now);
    s.reclaim.push({ playerId, codeHash: await sha256(code), expiresAt: now + 15 * 60_000 });
    log(s, now, 'gm', `Code de reconnexion créé pour ${p.name}.`);
    return { code, expiresAt: now + 15 * 60_000 };
  }

  private sendError(ws: WebSocket, e: unknown, id?: number) {
    const code = e instanceof GameError ? e.code : 'internal';
    const msg = e instanceof GameError ? e.message : 'Erreur interne du serveur.';
    if (!(e instanceof GameError)) console.error(e);
    if (id !== undefined) this.send(ws, { t: 'ack', id, ok: false, code, msg });
    else this.send(ws, { t: 'error', code, msg });
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      /* déjà fermée */
    }
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcast(ws);
  }

  async alarm() {
    const s = this.state;
    if (!s) return;
    if (tick(s, Date.now())) {
      await this.save();
      this.broadcast();
    } else {
      await this.scheduleAlarm();
    }
  }
}

