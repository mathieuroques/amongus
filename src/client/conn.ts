import type { GmView, PlayerView } from '../shared/view';
import { Connection, type Auth } from './net';
import { sessions } from './session';

let player: Connection<PlayerView> | undefined;
let gm: Connection<GmView> | undefined;

export function playerConn(): Connection<PlayerView> | undefined {
  if (player) return player;
  const s = sessions.player();
  if (!s) return undefined;
  player = new Connection<PlayerView>(s.code, { kind: 'token', token: s.token });
  player.onToken = (token) => sessions.setPlayer({ code: s.code, token });
  player.onAuthFailed = (code) => {
    if (code === 'bad_token') {
      sessions.setPlayer(undefined);
    }
  };
  return player;
}

export function startPlayerConn(code: string, auth: Auth): Connection<PlayerView> {
  player?.close();
  player = new Connection<PlayerView>(code, auth);
  player.onToken = (token) => sessions.setPlayer({ code, token });
  player.onAuthFailed = (c) => c === 'bad_token' && sessions.setPlayer(undefined);
  return player;
}

export function dropPlayer() {
  player?.close();
  player = undefined;
  sessions.setPlayer(undefined);
}

export function gmConn(): Connection<GmView> | undefined {
  if (gm) return gm;
  const s = sessions.gm();
  if (!s) return undefined;
  gm = new Connection<GmView>(s.code, { kind: 'token', token: s.token });
  gm.onToken = (token) => sessions.setGm({ ...s, token });
  gm.onAuthFailed = (code) => {
    if (code === 'bad_token') sessions.setGm(undefined);
  };
  return gm;
}

export function startGmConn(code: string, auth: Auth, secret?: string): Connection<GmView> {
  gm?.close();
  gm = new Connection<GmView>(code, auth);
  gm.onToken = (token) => sessions.setGm({ code, token, secret: secret ?? sessions.gm()?.secret });
  gm.onAuthFailed = (c) => c === 'bad_token' && sessions.setGm(undefined);
  return gm;
}

export function dropGm() {
  gm?.close();
  gm = undefined;
  sessions.setGm(undefined);
}

export function go(hash: string) {
  location.hash = hash;
}
