// Fiches du kit universel (voir kit-print.tsx) : postes (QR + code + énigmes papier), fiches spéciales,
// étiquettes et panneaux à compléter, badges fantômes, aide-mémoire et affiche d'invitation.
// Rien n'y dépend d'une partie : pièces écrites à la main, aucun réglage, aucun code de partie.

import { SABOTAGE_INFO } from '../shared/catalog';
import { assemblePuzzle, countPuzzle, ROW_LABELS } from '../shared/puzzles';
import type { GameKind } from '../shared/types';
import { QR } from './qr';

export const BLANK_LINE = '______________________';

/** L'affiche mène à l'accueil du site (adresse de ce site) ; le MJ écrit le code de la partie à la main. */
export function InviteSheet() {
  return (
    <section class="sheet" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '40pt' }}>Rejoignez la partie !</h1>
      <p style={{ fontSize: '16pt' }}>Scannez avec l’appareil photo de votre téléphone</p>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8mm 0' }}>
        <QR text={`${location.origin}/`} size={340} />
      </div>
      <p style={{ fontSize: '18pt' }}>
        ou ouvrez <strong>{location.host}</strong>, touchez « Je rejoins une partie » et saisissez le code de la partie
      </p>
      <div class="scode" style={{ fontSize: '54pt' }}>
        __________
      </div>
      <p style={{ fontSize: '13pt', marginTop: '10mm' }}>Aucune application à installer · aucun compte</p>
    </section>
  );
}

/** Fiche « Poste » : le QR code ne contient que le code ; extras : énigmes papier et scan médical de ce poste. */
export function StationSheet({ name, code, extras }: { name: string; code: string; extras: { game: GameKind; seed: number; task: string }[] }) {
  return (
    <section class="sheet">
      <div style={{ display: 'flex', gap: '8mm', alignItems: 'center' }}>
        <QR text={code} size={250} />
        <div>
          <h1>{name}</h1>
          <p style={{ fontSize: '16pt' }}>Pièce : {BLANK_LINE}</p>
          <p>Code du poste :</p>
          <div class="scode">{code}</div>
        </div>
      </div>
      <p style={{ marginTop: '6mm' }}>Scannez ce QR code dans l’onglet « Poste » de l’application (ou saisissez le code) : votre téléphone indique la tâche à faire ici.</p>
      {extras.some((x) => x.game === 'scan') && (
        <p style={{ border: '2px solid #000', padding: '3mm', marginTop: '4mm' }}>
          <strong>Scan médical</strong> : tenez-vous immobile sur la croix collée au sol devant cette fiche.
        </p>
      )}
      {extras.map((x) =>
        x.game === 'count' ? <CountBlock key={x.task + 'c'} seed={x.seed} name={x.task} /> : x.game === 'assemble' ? <AssembleBlock key={x.task + 'a'} seed={x.seed} name={x.task} /> : null,
      )}
      <p style={{ fontSize: '10pt', marginTop: '6mm' }}>Ne déplacez pas cette fiche. Ne la photographiez pas pour l’utiliser à distance : c’est de la triche.</p>
    </section>
  );
}

function CountBlock({ seed, name }: { seed: number; name: string }) {
  const p = countPuzzle(seed);
  const rows = Array.from({ length: p.rows }, (_, r) => p.grid.slice(r * p.cols, (r + 1) * p.cols));
  return (
    <div style={{ border: '2px solid #000', padding: '4mm', marginTop: '4mm' }}>
      <strong>Énigme « {name} » — inventaire</strong>
      <p>La question s’affiche sur votre téléphone et change à chaque fois (quel symbole, sur toute la grille ou sur une moitié). Comptez sur cette grille :</p>
      <table class="count-grid">
        <thead>
          <tr>
            <th />
            {rows[0].map((_, c) => (
              <th key={c} class={c === p.cols / 2 ? 'vsplit' : ''}>
                {c + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} class={r === p.rows / 2 ? 'hsplit' : ''}>
              <th>{ROW_LABELS[r]}</th>
              {row.map((g, c) => (
                <td key={c} class={c === p.cols / 2 ? 'vsplit' : ''}>
                  {g}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <small>Les traits épais séparent les moitiés : haut (A à C) / bas (D à F), gauche (1 à 4) / droite (5 à 8).</small>
    </div>
  );
}

function AssembleBlock({ seed, name }: { seed: number; name: string }) {
  const p = assemblePuzzle(seed);
  return (
    <div style={{ border: '2px solid #000', padding: '4mm', marginTop: '4mm' }}>
      <strong>Énigme « {name} » — puzzle</strong>
      <p>
        Découpez les bandes le long des pointillés et posez-les en vrac sur le poste. Les joueurs les rangent dans l’ordre du nombre de points (1 point, 2 points…), lisent la ligne demandée par leur téléphone (lettres du HAUT ou lettres du BAS : deux mots
        différents), la saisissent, puis remélangent les bandes.
      </p>
      <div class="strips">
        {p.pieces.map((piece, i) => (
          <div class="strip" key={i}>
            <span class="top">{piece.letter}</span>
            <span class="dots">{'·'.repeat(piece.index + 1)}</span>
            <span class="bottom">{piece.bottom}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SPECIAL_HELP: Record<string, string> = {
  emergency: 'Pour convoquer une réunion d’urgence : scannez ce poste puis appuyez sur le bouton rouge. Impossible pendant un sabotage.',
  reactor: `${SABOTAGE_INFO.reactor.short} Scannez ce poste puis maintenez le bouton appuyé jusqu’à la réparation.`,
  oxygen: `${SABOTAGE_INFO.oxygen.short} Scannez ce poste et recopiez le code affiché sur votre téléphone.`,
  lights: `${SABOTAGE_INFO.lights.short} Ceci est un poste FICTIF : ne touchez jamais au vrai tableau électrique.`,
  comms: `${SABOTAGE_INFO.comms.short}`,
  vitals: 'Moniteur de vie : scannez ce poste pour voir qui est vivant ou mort (indisponible quand les communications sont coupées).',
};

export function SpecialSheet({ name, kind, code }: { name: string; kind: string; code: string }) {
  return (
    <section class="sheet" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '34pt' }}>{name}</h1>
      <p style={{ fontSize: '16pt' }}>Pièce : {BLANK_LINE}</p>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6mm 0' }}>
        <QR text={code} size={300} />
      </div>
      <div class="scode">{code}</div>
      <p style={{ fontSize: '14pt', maxWidth: '150mm', margin: '6mm auto' }}>{SPECIAL_HELP[kind]}</p>
    </section>
  );
}

export function BlankRoomSheets({ labels, forbidden, transit }: { labels: number; forbidden: number; transit: number }) {
  return (
    <>
      {Array.from({ length: labels }, (_, i) => (
        <section class="sheet" key={'l' + i}>
          <p style={{ textAlign: 'center', fontSize: '14pt', marginTop: '25mm' }}>Nom de la pièce :</p>
          <div class="bigname" style={{ marginTop: '4mm' }}>
            {BLANK_LINE}
          </div>
        </section>
      ))}
      {Array.from({ length: forbidden }, (_, i) => (
        <section class="sheet" key={'f' + i}>
          <div class="bigname" style={{ color: '#c00' }}>
            ⛔ ZONE INTERDITE
          </div>
          <p style={{ textAlign: 'center', fontSize: '22pt' }}>Personne n’entre, même pour se cacher ou poursuivre quelqu’un.</p>
        </section>
      ))}
      {Array.from({ length: transit }, (_, i) => (
        <section class="sheet" key={'p' + i}>
          <div class="bigname">⚠️ Zone de passage</div>
          <p style={{ textAlign: 'center', fontSize: '20pt' }}>On marche, on ne court pas, on ne s’arrête pas. Aucune élimination ici.</p>
        </section>
      ))}
    </>
  );
}

export function GhostSheet() {
  return (
    <section class="sheet">
      <h1>Badges fantômes</h1>
      <p>À découper. Un joueur mort accroche son badge bien en vue (pince, ruban) seulement quand sa mort est annoncée (à la réunion qui suit, ou dès son éjection). Avant, il reste discret et silencieux, sans badge. Les vivants ignorent les fantômes.</p>
      <div class="badges">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i}>👻 FANTÔME</div>
        ))}
      </div>
    </section>
  );
}

/** Aide-mémoire sans réglages : rien de ce que le MJ ajuste à chaque partie (nombre d’imposteurs, délais) n’y figure. */
export function SummarySheet() {
  return (
    <section class="sheet">
      <h1>Aide-mémoire</h1>
      <ul style={{ fontSize: '12.5pt' }}>
        <li>
          <strong>Équipage</strong> : faire ses tâches aux postes (scanner le QR code), démasquer les imposteurs. Victoire : toutes les tâches faites ou tous les imposteurs éjectés.
        </li>
        <li>
          <strong>Imposteurs</strong> : éliminer et saboter sans être démasqués. Victoire : autant d’imposteurs que d’équipiers vivants, ou sabotage critique non réparé.
        </li>
        <li>
          <strong>Élimination</strong> : l’imposteur touche l’épaule (ou se place à portée de bras) ; la victime déclare aussitôt son élimination sur son téléphone (onglet Urgence → « On vient de m’éliminer ») en choisissant discrètement qui l’a touchée. L’imposteur n’a rien à saisir.{' '}
          Un délai fixé par le MJ sépare deux éliminations. Jamais dans un escalier ou un passage.
        </li>
        <li>
          <strong>Corps</strong> : la victime s’assoit sur place, silencieuse, téléphone montrant son code de corps en très gros et un QR code. Celui qui la trouve scanne ce QR code (onglet Poste) ou tape le code (onglet Urgence) → réunion.
        </li>
        <li>
          <strong>Réunion d’urgence</strong> : au bouton d’urgence (nombre par joueur fixé par le MJ, impossible pendant un sabotage).
        </li>
        <li>
          <strong>Réunion</strong> : rassemblement (15 s de plus seulement une fois la majorité arrivée), discussion (plus courte si la majorité touche « Prêt à voter »), puis vote ; les durées s’affichent sur le téléphone. Vote pour un joueur ou « passer
          ». Égalité ou « passer » majoritaire : personne n’est éjecté. Le MJ annonce si le rôle de l’éjecté est révélé et si les votes sont anonymes.
            
        </li>
        <li>
          <strong>Fantômes</strong> : silence total avec les vivants, badge visible dès l’annonce de la mort. L’équipage fantôme finit ses tâches ; l’imposteur fantôme peut saboter. Pas de vote, pas de signalement, pas de réparation.
        </li>
        <li>
          <strong>Sabotages</strong> : réacteur (compte à rebours sur le téléphone, 2 personnes en même temps), oxygène (compte à rebours, 2 postes), panne de courant (impossible de
          signaler un corps), communications (liste des tâches masquée).
        </li>
        <li>
          <strong>Sécurité</strong> : on ne court jamais, aucune porte verrouillée, zones interdites respectées, aucun contact brusque. Bouton « Alerte sécurité » dans l’onglet Urgence. Le maître du jeu peut tout arrêter.
        </li>
      </ul>
    </section>
  );
}
