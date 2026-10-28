import type { FixKind, GameKind, SabotageKind, StationKind, TaskType } from './types';

export interface GameInfo {
  label: string;
  /** Consigne affichée au joueur. */
  hint: string;
  /** Durée minimale (ms) entre l'ouverture du mini-jeu et sa validation : empêche les validations instantanées. */
  minMs: number;
  /** Énigme imprimée sur la fiche du poste (la réponse n'est jamais envoyée au téléphone). */
  paper?: boolean;
  /** Tâche visuelle : l'écran est reconnaissable de loin quand l'option est active. */
  visual?: boolean;
}

export const GAMES: Record<GameKind, GameInfo> = {
  wires: { label: 'Réparer les câbles', hint: 'Reliez chaque fil à la prise de même couleur.', minMs: 3000 },
  sequence: { label: 'Séquence de démarrage', hint: 'Mémorisez la séquence puis reproduisez-la.', minMs: 4000 },
  order: { label: 'Déverrouillage', hint: 'Touchez les nombres de 1 à 10 dans l’ordre.', minMs: 4000 },
  calibrate: { label: 'Calibrage', hint: 'Touchez « Stop » quand le curseur est dans la zone verte (3 fois).', minMs: 3000 },
  slider: { label: 'Alignement', hint: 'Placez le curseur exactement sur la cible.', minMs: 2000 },
  wait: { label: 'Transfert de données', hint: 'Restez au poste pendant le transfert.', minMs: 8000 },
  scan: { label: 'Scan médical', hint: 'Restez immobile sur la marque au sol pendant le scan.', minMs: 10000, visual: true },
  swipe: { label: 'Badge d’accès', hint: 'Faites glisser le badge d’un trait, ni trop vite ni trop lentement.', minMs: 2000 },
  targets: { label: 'Nettoyage', hint: 'Touchez toutes les cibles qui apparaissent.', minMs: 4000 },
  count: { label: 'Inventaire (fiche papier)', hint: 'Comptez le symbole demandé, dans la zone demandée, sur la grille de la fiche du poste.', minMs: 3000, paper: true },
  assemble: { label: 'Puzzle (fiche papier)', hint: 'Rangez les bandes découpées du poste dans l\u2019ordre du nombre de points, lisez la ligne demandée (haut ou bas) puis remélangez les bandes.', minMs: 5000, paper: true },
};

export const FIXES: Record<FixKind, GameInfo> = {
  switches: { label: 'Rétablir le courant', hint: 'Basculez tous les interrupteurs sur MARCHE.', minMs: 2000 },
  tune: { label: 'Régler la radio', hint: 'Ajustez la fréquence jusqu’à ce que les ondes coïncident.', minMs: 2000 },
  pin: { label: 'Code oxygène', hint: 'Recopiez le code affiché sur le clavier.', minMs: 2000 },
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  common: 'Commune',
  long: 'Longue',
  short: 'Courte',
};

export const STATION_KIND_LABEL: Record<StationKind, string> = {
  task: 'Poste de tâches',
  emergency: 'Bouton d’urgence',
  reactor: 'Réacteur (sabotage critique)',
  oxygen: 'Oxygène (sabotage critique)',
  lights: 'Énergie (panne de courant)',
  comms: 'Radio (communications)',
  vitals: 'Moniteur de vie',
};

export const SABOTAGE_INFO: Record<SabotageKind, { label: string; critical: boolean; short: string }> = {
  reactor: {
    label: 'Fusion du réacteur',
    critical: true,
    short: 'Deux joueurs vivants doivent maintenir le bouton en même temps aux DEUX postes Réacteur.',
  },
  oxygen: {
    label: 'Fuite d’oxygène',
    critical: true,
    short: 'Le code doit être saisi aux DEUX postes Oxygène (une ou plusieurs personnes).',
  },
  lights: {
    label: 'Panne de courant',
    critical: false,
    short: 'Dans le noir, impossible de signaler un corps (et le bouton d’urgence est bloqué). Les tâches continuent. Réparez au poste Énergie.',
  },
  comms: {
    label: 'Communications coupées',
    critical: false,
    short: 'Liste des tâches, barre de progression et moniteur masqués. Réparez au poste Radio.',
  },
};

export const SYMBOLS = ['▲', '●', '■', '★', '♦', '✚'] as const;
export const SYMBOL_NAMES = ['triangles', 'ronds', 'carrés', 'étoiles', 'losanges', 'croix'] as const;
export const ASSEMBLE_WORDS = [
  'NAVIRE', 'FUSEE', 'ORBITE', 'COMETE', 'GALAXIE', 'METEORE', 'SATURNE', 'PLANETE', 'CAPSULE', 'MODULE',
  'ETOILE', 'ANTENNE', 'RADAR', 'SONDE', 'NEPTUNE', 'ECLIPSE', 'BOUSSOLE', 'LANTERNE', 'CRISTAL', 'TURBINE',
];
