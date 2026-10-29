// Types partagés entre le serveur (Durable Object) et le client.
import type { PushSubscriptionData, VapidKeys } from './webpush';

// Le serveur est la seule source de vérité : le client ne reçoit que des « vues »
// filtrées selon ce que le joueur a le droit de savoir.

export type Role = 'crewmate' | 'impostor';
export type Phase = 'lobby' | 'playing' | 'meeting' | 'ended';
export type MeetingStage = 'gather' | 'discussion' | 'voting' | 'result';
export type TaskType = 'common' | 'long' | 'short';
export type Winner = 'crew' | 'impostors' | 'none';

/** Mini-jeux disponibles pour une étape de tâche. */
export type GameKind =
  | 'wires' // relier des fils de couleur
  | 'sequence' // reproduire une séquence
  | 'order' // toucher les nombres dans l'ordre
  | 'calibrate' // arrêter un curseur dans la zone
  | 'slider' // aligner un curseur sur une cible
  | 'wait' // transfert de données (rester sur place)
  | 'scan' // scan médical (tâche visuelle)
  | 'swipe' // glisser un badge
  | 'targets' // toucher des cibles
  | 'count' // énigme papier : compter des symboles sur la fiche imprimée
  | 'assemble'; // énigme papier : reconstituer un mot découpé

/** Mini-jeux de réparation des sabotages. */
export type FixKind = 'switches' | 'tune' | 'pin';

export type StationKind = 'task' | 'emergency' | 'reactor' | 'oxygen' | 'lights' | 'comms' | 'vitals';
export type SabotageKind = 'reactor' | 'oxygen' | 'lights' | 'comms';

export interface Room {
  id: string;
  name: string;
  floor: string;
  /** Zone interdite : personne n'y entre (affichée en rouge, aucun poste possible). */
  forbidden: boolean;
  /** Zone de passage (escalier, couloir) : on n'y court pas, on ne s'y arrête pas, aucune élimination. */
  transit: boolean;
  /** Le maître du jeu autorise-t-il à s'y cacher ? (information affichée) */
  hideAllowed: boolean;
  notes: string;
}

export interface Station {
  id: string;
  name: string;
  roomId: string;
  kind: StationKind;
  /** Code imprimé sur la fiche du poste (et dans son QR code). Jamais envoyé aux joueurs. */
  code: string;
}

export interface TaskStep {
  stationId: string;
  game: GameKind;
}

export interface TaskDef {
  id: string;
  name: string;
  type: TaskType;
  steps: TaskStep[];
  enabled: boolean;
  /** Graine des énigmes papier (count/assemble) : la fiche imprimée et le serveur en dérivent la même réponse. */
  seed: number;
}

export interface Passage {
  id: string;
  name: string;
  fromRoomId: string;
  toRoomId: string;
  notes: string;
}

export interface Terrain {
  name: string;
  rooms: Room[];
  stations: Station[];
  tasks: TaskDef[];
  /** « Conduits » : itinéraires réservés aux imposteurs (équivalent des bouches d'aération). */
  passages: Passage[];
  meetingRoomId: string;
  /** Consignes de sécurité affichées à tous avant le démarrage (sorties, escaliers, zones interdites…). */
  safetyNotes: string;
  /** Code de récupération des fiches imprimées avant de connaître la maison (voir blankTerrain). */
  printCode?: string;
}

export interface Settings {
  maxPlayers: number;
  impostors: number;
  killCooldownSec: number;
  initialKillCooldownSec: number;
  emergencyMeetingsPerPlayer: number;
  emergencyCooldownSec: number;
  gatherSec: number;
  discussionSec: number;
  votingSec: number;
  resultSec: number;
  anonymousVotes: boolean;
  confirmEjects: boolean;
  taskBarUpdates: 'always' | 'meetings' | 'never';
  commonTasks: number;
  longTasks: number;
  shortTasks: number;
  visualTasks: boolean;
  sabotageCooldownSec: number;
  initialSabotageCooldownSec: number;
  reactorSec: number;
  oxygenSec: number;
  /** Durée pendant laquelle un corps non découvert reste signalable (0 = jusqu'à la prochaine réunion). */
  bodyTimeoutSec: number;
  /** Les fantômes voient-ils le rôle des autres joueurs ? (désactivé par défaut pour limiter les fuites) */
  ghostsSeeRoles: boolean;
}

export interface AssignedTask {
  taskId: string;
  /** Nombre d'étapes terminées. */
  step: number;
  done: boolean;
  doneAt?: number;
}

export interface Challenge {
  id: string;
  /** 'task' = étape de tâche, 'fake' = tâche simulée par un imposteur, 'fix' = réparation de sabotage. */
  purpose: 'task' | 'fake' | 'fix';
  taskId?: string;
  stepIndex?: number;
  stationId: string;
  game: GameKind | FixKind;
  params: Record<string, unknown>;
  /** Réponse attendue — reste sur le serveur. */
  answer: unknown;
  startedAt: number;
  minMs: number;
}

export interface Body {
  code: string;
  at: number;
  reported: boolean;
  vanished: boolean;
  vanishAt?: number;
}

export interface PlayerState {
  id: string;
  name: string;
  num: number;
  tokenHash: string;
  joinedAt: number;
  role?: Role;
  alive: boolean;
  left: boolean;
  kicked: boolean;
  deathRevealed: boolean;
  diedAt?: number;
  deathCause?: 'killed' | 'ejected' | 'gm' | 'left';
  killedBy?: string;
  tasks: AssignedTask[];
  emergencyLeft: number;
  killCooldownUntil: number;
  /** Contestation de son élimination déjà envoyée au MJ (une seule par mort). */
  disputed?: boolean;
  /** Poste de la dernière étape de tâche réussie (sert à proposer une prochaine étape proche). */
  lastStationId?: string;
  body?: Body;
  challenge?: Challenge;
  failures: number[];
  blockedUntil: number;
  checkedIn: boolean;
  kills: number;
  /** Abonnement aux notifications push (téléphone en veille). */
  push?: PushSubscriptionData;
}

export interface ActiveSabotage {
  kind: SabotageKind;
  by: string;
  startedAt: number;
  /** Fin du compte à rebours des sabotages critiques. */
  deadline?: number;
  /** Postes déjà réparés (oxygène). */
  fixed: string[];
  /** Mains posées sur les postes du réacteur. */
  holds: { stationId: string; playerId: string; since: number; beat: number }[];
}

export interface VoteResult {
  ejectedId?: string;
  tally: Record<string, number>;
  skips: number;
  abstentions: number;
  tie: boolean;
  wasImpostor?: boolean;
  impostorsLeft?: number;
  /** Votes individuels (révélés seulement si les votes ne sont pas anonymes). */
  votes?: Record<string, string>;
}

export interface Meeting {
  id: number;
  kind: 'emergency' | 'report' | 'gm';
  calledBy?: string;
  bodyOf?: string;
  startedAt: number;
  stage: MeetingStage;
  stageEndsAt: number;
  votes: Record<string, string>;
  /** Joueurs vivants qui ont touché « Prêt à voter » pendant la discussion. */
  ready?: string[];
  /** Instant où la majorité est arrivée au rassemblement (le minuteur n'est raccourci qu'une fois : une prolongation du MJ tient). */
  majorityAt?: number;
  deadAtStart: string[];
  newlyDead: string[];
  result?: VoteResult;
  endedSabotage?: SabotageKind;
}

export interface MeetingRecord {
  id: number;
  kind: Meeting['kind'];
  calledBy?: string;
  bodyOf?: string;
  at: number;
  newlyDead: string[];
  result?: VoteResult;
  votes: Record<string, string>;
}

export interface LogEntry {
  at: number;
  type: string;
  msg: string;
  /** Visible uniquement par le maître du jeu tant que la partie n'est pas terminée. */
  secret?: boolean;
}

export interface SafetyAlert {
  id: number;
  /** 'dispute' = un joueur conteste son élimination (sinon alerte sécurité). */
  kind?: 'safety' | 'dispute';
  at: number;
  playerId: string;
  message: string;
  acked: boolean;
}

export interface GameState {
  v: 1;
  code: string;
  createdAt: number;
  gmTokenHashes: string[];
  gmSecretHash: string;
  gameNumber: number;
  phase: Phase;
  paused: boolean;
  pausedAt?: number;
  emergencyStop: boolean;
  lobbyLocked: boolean;
  settings: Settings;
  terrain: Terrain;
  players: PlayerState[];
  nextNum: number;
  startedAt?: number;
  emergencyCooldownUntil: number;
  sabotageCooldownUntil: number;
  sabotage?: ActiveSabotage;
  /** Progression affichée quand la barre ne se met à jour qu'en réunion. */
  taskBarSnapshot: number;
  sabotageHistory: { kind: SabotageKind; by: string; at: number; outcome: string }[];
  meeting?: Meeting;
  meetings: MeetingRecord[];
  winner?: Winner;
  endReason?: string;
  endedAt?: number;
  log: LogEntry[];
  alerts: SafetyAlert[];
  nextAlertId: number;
  reclaim: { playerId: string; codeHash: string; expiresAt: number }[];
  gmFailures: number[];
  /** Clés VAPID de la partie (la clé privée ne quitte jamais le serveur). */
  vapid?: VapidKeys;
  /** Adresse du site, utilisée comme identité VAPID. */
  origin?: string;
  /** Abonnements push des appareils du MJ (alertes sécurité). */
  gmPush: PushSubscriptionData[];
  /** Compteur des « tests d'alerte » envoyés par le MJ. */
  pingId: number;
  /** Mini-jeu en cours de test par le MJ (n'affecte pas la partie). */
  gmChallenge?: Challenge;
  seq: number;
  /** Dernière modification (pour l'effacement automatique après inactivité). */
  updatedAt?: number;
}
