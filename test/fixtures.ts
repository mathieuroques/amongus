// Maison d'exemple pour les tests : une maison typique équipée des fiches du kit universel.
// (L'application n'a aucune maison par défaut : le MJ appaire les fiches sur place.)
import { pairSheet } from '../src/shared/kit';
import { cryptoRng, type Rng } from '../src/shared/rng';
import { emptyTerrain, newId } from '../src/shared/terrain';
import type { Room, Terrain } from '../src/shared/types';

export const EXAMPLE_ROOMS: { name: string; floor: string; forbidden?: boolean; transit?: boolean }[] = [
  { name: 'Salon', floor: 'Rez-de-chaussée' },
  { name: 'Cuisine', floor: 'Rez-de-chaussée' },
  { name: 'Salle à manger', floor: 'Rez-de-chaussée' },
  { name: 'Entrée', floor: 'Rez-de-chaussée' },
  { name: 'Bureau', floor: 'Rez-de-chaussée' },
  { name: 'Buanderie', floor: 'Rez-de-chaussée' },
  { name: 'Escalier', floor: 'Entre les étages', transit: true },
  { name: 'Couloir de l’étage', floor: 'Étage', transit: true },
  { name: 'Chambre 1', floor: 'Étage' },
  { name: 'Chambre 2', floor: 'Étage' },
  { name: 'Salle de jeux', floor: 'Étage' },
  { name: 'Salle de bain', floor: 'Étage' },
  { name: 'Chambre parentale', floor: 'Étage', forbidden: true },
];

/** Une fiche « Poste » par pièce jouable, bouton d'urgence au salon, fiches spéciales dans des pièces distinctes. */
export function exampleTerrain(rng: Rng = cryptoRng): Terrain {
  const rooms: Room[] = EXAMPLE_ROOMS.map((r) => ({ id: newId('r', rng), name: r.name, floor: r.floor, forbidden: !!r.forbidden, transit: !!r.transit, hideAllowed: !r.forbidden && !r.transit, notes: '' }));
  const room = (name: string) => rooms.find((r) => r.name === name)!.id;
  let t: Terrain = { ...emptyTerrain(), name: 'Maison d’exemple', rooms };
  t = pairSheet(t, 'kurg', room('Salon'));
  rooms.filter((r) => !r.forbidden && !r.transit).forEach((r, i) => (t = pairSheet(t, `k${String(i + 1).padStart(2, '0')}`, r.id)));
  const specials: [string, string][] = [
    ['krea1', 'Cuisine'], ['krea2', 'Chambre 1'], ['koxy1', 'Salle à manger'], ['koxy2', 'Chambre 2'], ['kener', 'Entrée'], ['kradio', 'Bureau'], ['kvie', 'Salle de jeux'],
  ];
  for (const [id, name] of specials) t = pairSheet(t, id, room(name));
  return t;
}
