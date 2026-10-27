// Messages échangés sur le WebSocket.
import type { GmAction, PlayerAction } from './engine';
import type { GmView, PlayerView } from './view';

export type ClientMsg =
  | { t: 'hello'; token: string }
  | { t: 'join'; name: string }
  | { t: 'gmLogin'; secret: string }
  | { t: 'reclaim'; code: string }
  | { t: 'act'; id: number; a: PlayerAction | GmAction | { type: 'reclaimCode'; playerId: string } };

export type ServerMsg =
  | { t: 'welcome'; as: 'player' | 'gm'; playerId?: string }
  | { t: 'token'; token: string; as: 'player' | 'gm'; playerId?: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'ack'; id: number; ok: boolean; data?: unknown; code?: string; msg?: string }
  | { t: 'state'; v: PlayerView | GmView }
  | { t: 'kicked' };

/** Format du code de partie : 6 caractères sans ambiguïté. */
export const GAME_CODE_RE = /^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/;
