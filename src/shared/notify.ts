// Événements qui méritent une notification push vers les téléphones en veille.
// Ne contiennent QUE des informations publiques (elles peuvent s'afficher sur l'écran verrouillé).

import { SABOTAGE_INFO } from './catalog';
import type { GameState, SabotageKind } from './types';
import type { PushMessage } from './webpush';

export interface Snapshot {
  phase: GameState['phase'];
  gameNumber: number;
  meetingId?: number;
  sabotage?: SabotageKind;
  stop: boolean;
  pingId: number;
  alertMax: number;
}

export function snapshot(s: GameState): Snapshot {
  return {
    phase: s.phase,
    gameNumber: s.gameNumber,
    meetingId: s.meeting?.id,
    sabotage: s.sabotage?.kind,
    stop: s.emergencyStop,
    pingId: s.pingId ?? 0,
    alertMax: Math.max(0, ...s.alerts.map((a) => a.id)),
  };
}

export function pushEvents(before: Snapshot, s: GameState): { players: PushMessage[]; gm: PushMessage[] } {
  const players: PushMessage[] = [];
  const gm: PushMessage[] = [];
  const room = s.terrain.rooms.find((r) => r.id === s.terrain.meetingRoomId)?.name ?? 'la salle de réunion';
  if (before.phase === 'lobby' && s.phase === 'playing') {
    players.push({ title: '🎭 La partie commence !', body: 'Cachez votre écran et découvrez votre rôle.', tag: 'start', urgent: true });
  }
  if (s.meeting && s.meeting.id !== before.meetingId) {
    const what = s.meeting.kind === 'report' ? 'Corps signalé' : s.meeting.kind === 'emergency' ? 'Réunion d’urgence' : 'Réunion convoquée';
    players.push({ title: '📣 RÉUNION !', body: `${what} : rejoignez la salle de réunion (${room}) en marchant.`, tag: 'meeting', urgent: true });
  }
  if (s.sabotage && s.sabotage.kind !== before.sabotage && SABOTAGE_INFO[s.sabotage.kind].critical) {
    players.push({ title: '🚨 Sabotage critique', body: `${SABOTAGE_INFO[s.sabotage.kind].label} : à réparer d’urgence !`, tag: 'sabotage', urgent: true });
  }
  if (s.emergencyStop && !before.stop) {
    const m = { title: '🛑 STOP — arrêt d’urgence', body: 'Arrêtez-vous sur place et écoutez le maître du jeu.', tag: 'stop', urgent: true };
    players.push(m);
  }
  if (!s.emergencyStop && before.stop) players.push({ title: '▶ Reprise', body: 'Le maître du jeu a relancé la partie.', tag: 'stop' });
  if (s.phase === 'ended' && before.phase !== 'ended') {
    const w = s.winner === 'crew' ? 'Victoire de l’équipage' : s.winner === 'impostors' ? 'Victoire des imposteurs' : 'Partie arrêtée';
    players.push({ title: '🏁 Fin de partie', body: `${w}. Ouvrez l’application pour voir les rôles.`, tag: 'end' });
  }
  if ((s.pingId ?? 0) > before.pingId) {
    players.push({ title: '🔔 Test d’alerte', body: 'Le maître du jeu teste les alertes : votre téléphone est prêt.', tag: 'ping' });
  }
  for (const a of s.alerts) {
    if (a.id > before.alertMax) {
      const who = s.players.find((p) => p.id === a.playerId)?.name ?? 'Un joueur';
      gm.push({ title: '⚠️ ALERTE SÉCURITÉ', body: `${who} : ${a.message}`, tag: `alert${a.id}`, urgent: true });
    }
  }
  return { players, gm };
}
