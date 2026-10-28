// Point d'entrée du Worker Cloudflare.
// - Les fichiers statiques (PWA) sont servis directement par Cloudflare (gratuit, sans invoquer ce code).
// - /api/* est traité ici ; chaque partie vit dans son propre Durable Object (GameRoom).

import { GAME_CODE_RE } from '../shared/protocol';
import { CODE_ALPHABET, GAME_CODE_ALPHABET, randomCode, randomToken, sha256 } from '../shared/rng';
import { GameRoom } from './game-room';

export { GameRoom };

export interface Env {
  GAMES: DurableObjectNamespace<GameRoom>;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export function normalizeSecret(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function createGame(req: Request, env: Env): Promise<Response> {
  const text = await req.text();
  if (text.length > 300_000) return json({ error: 'Configuration trop volumineuse.' }, 413);
  let body: { settings?: unknown; terrain?: unknown } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: 'JSON invalide.' }, 400);
  }
  const gmToken = randomToken();
  const gmSecret = randomCode(8, undefined, CODE_ALPHABET);
  const [gmTokenHash, gmSecretHash] = await Promise.all([sha256(gmToken), sha256(gmSecret)]);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode(6, undefined, GAME_CODE_ALPHABET);
    const stub = env.GAMES.get(env.GAMES.idFromName(code));
    const res = await stub.fetch('https://game/init', {
      method: 'POST',
      body: JSON.stringify({ code, gmTokenHash, gmSecretHash, settings: body.settings, terrain: body.terrain, origin: new URL(req.url).origin }),
    });
    if (res.status === 409) continue; // collision : on retente avec un autre code
    if (!res.ok) return json({ error: 'Création impossible.' }, 500);
    return json({ code, gmToken, gmSecret: gmSecret.slice(0, 4) + '-' + gmSecret.slice(4) });
  }
  return json({ error: 'Création impossible, réessayez.' }, 503);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/api/games' && req.method === 'POST') return createGame(req, env);
    const m = url.pathname.match(/^\/api\/games\/([^/]+)\/(ws|info)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!GAME_CODE_RE.test(code)) return json({ exists: false, error: 'Code de partie invalide.' }, 404);
      const stub = env.GAMES.get(env.GAMES.idFromName(code));
      if (m[2] === 'ws') {
        if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket attendu.' }, 426);
        return stub.fetch(new Request('https://game/ws', req));
      }
      return stub.fetch('https://game/info');
    }
    return json({ error: 'Introuvable.' }, 404);
  },
} satisfies ExportedHandler<Env>;
