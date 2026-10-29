// Impression du kit de fiches universel (page « #/kit », sans partie ni connexion) : les fiches ne dépendent
// ni de la partie, ni de la maison, ni des réglages ; le PDF du dépôt (docs/pdf/kit-fiches.pdf) vient de cette page.
// Les QR codes ne contiennent que le code de la fiche : ils restent valables même si l'adresse du site change.

import { useState } from 'preact/hooks';
import { GAMES } from '../shared/catalog';
import { KIT_SHEETS, KIT_TASK_SHEETS, kitSheetExtras } from '../shared/kit';
import { BlankRoomSheets, GhostSheet, InviteSheet, SpecialSheet, StationSheet, SummarySheet } from './print';

const SECTIONS = {
  guide: 'Mode d’emploi du maître du jeu et liste des fiches (à garder pour vous)',
  stations: 'Fiches « Poste »',
  special: '8 fiches spéciales : bouton d’urgence, réacteurs, oxygène, énergie, radio, moniteur',
  rooms: 'Étiquettes de pièces à compléter (12), zones interdites (3), zones de passage (3)',
  ghosts: 'Badges fantômes (24)',
  summary: 'Aide-mémoire des règles (sans réglages)',
  invite: 'Affiche d’invitation (adresse de ce site, code de partie à écrire à la main)',
} as const;
type Section = keyof typeof SECTIONS;

/** Ce qu'il faut préparer avec une fiche du kit. */
export function kitPreparation(id: string): string {
  return kitSheetExtras(id)
    .map((x) => (x.game === 'count' ? `grille « ${x.task} » imprimée` : x.game === 'assemble' ? `bandes « ${x.task} » à découper` : x.game === 'scan' ? 'croix au sol devant la fiche (scan médical)' : GAMES[x.game].label))
    .join(' ; ');
}

export function KitPrintPage() {
  const [on, setOn] = useState<Record<Section, boolean>>({ guide: true, stations: true, special: true, rooms: true, ghosts: true, summary: true, invite: true });
  const [count, setCount] = useState(KIT_TASK_SHEETS);
  const posts = KIT_SHEETS.filter((k) => k.kind === 'task').slice(0, count);
  return (
    <div>
      <div class="wrap noprint stack">
        <div class="row">
          <button class="btn small" onClick={() => (history.length > 1 ? history.back() : (location.hash = '#/'))}>
            ← Retour
          </button>
          <h1 class="grow">Kit de fiches universel</h1>
        </div>
        <p>
          Ces fiches servent <strong>pour toutes vos parties, dans n’importe quelle maison</strong> : imprimez-les une fois, gardez-les. Sur place, le maître du jeu appaire chaque fiche posée avec sa pièce ; une fiche non posée n’existe pas pour le jeu.
        </p>
        {(Object.keys(SECTIONS) as Section[]).map((k) => (
          <label class="check" key={k}>
            <input type="checkbox" checked={on[k]} onChange={(e) => setOn({ ...on, [k]: (e.target as HTMLInputElement).checked })} /> {k === 'stations' ? `${count} fiches « Poste » (01 à ${String(count).padStart(2, '0')})` : SECTIONS[k]}
          </label>
        ))}
        <label class="field">
          <span>Nombre de fiches « Poste » à imprimer (les suivantes pourront l’être plus tard)</span>
          <input type="number" min={1} max={KIT_TASK_SHEETS} value={count} onInput={(e) => setCount(Math.max(1, Math.min(KIT_TASK_SHEETS, Number((e.target as HTMLInputElement).value) || 1)))} />
        </label>
        <button class="btn big primary" onClick={() => window.print()}>
          🖨 Imprimer
        </button>
        <p class="muted">Conseil : papier épais ou pochettes plastiques, les fiches resserviront. Les postes 01 à 05 portent les énigmes papier et le scan médical : imprimez-les toujours.</p>
      </div>
      <div class="printroot">
        {on.guide && <KitGuide />}
        {on.stations && posts.map((k) => <StationSheet key={k.id} name={k.name} code={k.code} extras={kitSheetExtras(k.id)} />)}
        {on.special && KIT_SHEETS.filter((k) => k.kind !== 'task').map((k) => <SpecialSheet key={k.id} name={k.name} kind={k.kind} code={k.code} />)}
        {on.rooms && <BlankRoomSheets labels={12} forbidden={3} transit={3} />}
        {on.ghosts && (
          <>
            <GhostSheet />
            <GhostSheet />
          </>
        )}
        {on.summary && <SummarySheet />}
        {on.invite && <InviteSheet />}
      </div>
    </div>
  );
}

function KitGuide() {
  return (
    <section class="sheet">
      <h1>Kit de fiches — mode d’emploi du maître du jeu</h1>
      <p style={{ fontSize: '10.5pt' }}>
        <strong>À garder pour vous, ne pas afficher.</strong> Ces fiches servent pour toutes les parties et toutes les maisons. Une fiche que vous ne posez pas n’existe pas pour le jeu.
      </p>
      <ol style={{ fontSize: '10.5pt' }}>
        <li>
          <strong>Poser</strong> : une fiche « Poste » par pièce jouable (deux dans une grande pièce si besoin), à hauteur des yeux, jamais dans un escalier. Bouton d’urgence dans la salle de réunion ; Réacteur A loin de Réacteur B, Oxygène A loin d’Oxygène B
          ; Énergie loin du vrai tableau électrique. Préparez les postes 01 à 05 (colonne « À préparer »).
        </li>
        <li>
          <strong>Appairer</strong> : créez la partie (accueil → « J’organise »), puis onglet Terrain → « 📷 Appairer des fiches ». Scannez chaque fiche posée et touchez sa pièce (ou créez-la). Les tâches se répartissent toutes seules sur les fiches appairées.
        </li>
        <li>
          <strong>Vérifier</strong> : onglet 🧪 Tests, scannez chaque fiche (l’application affiche sa pièce) et testez les tâches.
        </li>
        <li>
          <strong>Entre deux manches</strong> : ajoutez, déplacez ou retirez des fiches, appairez à nouveau ; les joueurs entrent ou sortent dans le salon. Avec « Imposteurs : automatique » (onglet Paramètres), leur nombre suit celui des joueurs.
        </li>
      </ol>
      <table class="gm-plan">
        <thead>
          <tr>
            <th>Fiche</th>
            <th>Code</th>
            <th>À préparer</th>
            <th>Pièce</th>
          </tr>
        </thead>
        <tbody>
          {KIT_SHEETS.map((k) => (
            <tr key={k.id}>
              <td>{k.name}</td>
              <td>{k.code}</td>
              <td>{kitPreparation(k.id)}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
