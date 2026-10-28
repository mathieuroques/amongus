// Supports imprimables générés à partir du terrain : fiches de postes (QR + code + énigmes),
// affiche d'invitation, étiquettes de pièces, panneaux d'interdiction, badges fantômes, aide-mémoire.

import { useState } from 'preact/hooks';
import { GAMES, SABOTAGE_INFO } from '../shared/catalog';
import { assemblePuzzle, countPuzzle, ROW_LABELS } from '../shared/puzzles';
import type { Station, Terrain } from '../shared/types';
import type { GmView } from '../shared/view';
import type { Connection } from './net';
import { joinUrl, QR, stationUrl } from './qr';
import { useStore } from './store';

const SECTIONS = {
  invite: 'Affiche d’invitation',
  stations: 'Fiches des postes de tâches',
  special: 'Fiches bouton d’urgence, sabotages et moniteur',
  rooms: 'Étiquettes des pièces et zones interdites',
  ghosts: 'Badges fantômes',
  summary: 'Aide-mémoire des règles',
} as const;
type Section = keyof typeof SECTIONS;

export function PrintPage({ conn }: { conn: Connection<GmView> }) {
  const st = useStore(conn.store);
  const v = st.view;
  const [on, setOn] = useState<Record<Section, boolean>>({ invite: true, stations: true, special: true, rooms: true, ghosts: true, summary: true });
  if (!v) return <div class="wrap">Connexion…</div>;
  const t = v.terrain;
  return (
    <div>
      <div class="wrap noprint stack">
        <div class="row">
          <a class="btn small" href="#/gm">
            ← Tableau de bord
          </a>
          <h1 class="grow">Impression</h1>
        </div>
        <p>Choisissez les documents puis utilisez « Imprimer » (ou « Enregistrer en PDF »). Les codes restent valables tant que vous ne régénérez pas les postes.</p>
        {(Object.keys(SECTIONS) as Section[]).map((k) => (
          <label class="check" key={k}>
            <input type="checkbox" checked={on[k]} onChange={(e) => setOn({ ...on, [k]: (e.target as HTMLInputElement).checked })} /> {SECTIONS[k]}
          </label>
        ))}
        <button class="btn big primary" onClick={() => window.print()}>
          🖨 Imprimer
        </button>
        <p class="muted">Conseil : posez chaque fiche à hauteur des yeux, dans un endroit éclairé et dégagé, jamais dans un escalier.</p>
      </div>
      <div class="printroot">
        {on.invite && <InviteSheet code={v.code} terrain={t} />}
        {on.stations && t.stations.filter((s) => s.kind === 'task').map((s) => <StationSheet key={s.id} s={s} t={t} />)}
        {on.special && t.stations.filter((s) => s.kind !== 'task').map((s) => <SpecialSheet key={s.id} s={s} t={t} />)}
        {on.rooms && <RoomSheets t={t} />}
        {on.ghosts && <GhostSheet />}
        {on.summary && <SummarySheet v={v} />}
      </div>
    </div>
  );
}

const room = (t: Terrain, id: string) => t.rooms.find((r) => r.id === id);

function InviteSheet({ code, terrain }: { code: string; terrain: Terrain }) {
  return (
    <section class="sheet" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '40pt' }}>Rejoignez la partie !</h1>
      <p style={{ fontSize: '16pt' }}>Scannez avec l’appareil photo de votre téléphone</p>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8mm 0' }}>
        <QR text={joinUrl(code)} size={340} />
      </div>
      <p style={{ fontSize: '18pt' }}>ou ouvrez <strong>{location.host}</strong> et saisissez le code</p>
      <div class="scode" style={{ fontSize: '54pt' }}>
        {code}
      </div>
      <p style={{ fontSize: '13pt', marginTop: '10mm' }}>Aucune application à installer · aucun compte · terrain : {terrain.name}</p>
    </section>
  );
}

function StationSheet({ s, t }: { s: Station; t: Terrain }) {
  const r = room(t, s.roomId);
  const tasksHere = t.tasks.filter((k) => k.enabled && k.steps.some((st) => st.stationId === s.id));
  const paper = tasksHere.flatMap((k) => k.steps.map((st, i) => ({ k, st, i })).filter((x) => x.st.stationId === s.id && GAMES[x.st.game].paper));
  return (
    <section class="sheet">
      <div style={{ display: 'flex', gap: '8mm', alignItems: 'center' }}>
        <QR text={stationUrl(s.code)} size={250} />
        <div>
          <h1>{s.name}</h1>
          <p style={{ fontSize: '16pt' }}>
            Pièce : <strong>{r?.name}</strong> {r?.floor ? `(${r.floor})` : ''}
          </p>
          <p>Code du poste :</p>
          <div class="scode">{s.code}</div>
        </div>
      </div>
      <p style={{ marginTop: '6mm' }}>Scannez ce QR code dans l’onglet « Poste » de l’application (ou saisissez le code). Tâches possibles ici :</p>
      <ul>
        {tasksHere.map((k) => (
          <li key={k.id}>
            {k.name}
            {k.steps.filter((st) => st.stationId === s.id).some((st) => GAMES[st.game].label !== k.name) &&
              ` — ${k.steps.filter((st) => st.stationId === s.id).map((st) => GAMES[st.game].label).join(', ')}`}
          </li>
        ))}
      </ul>
      {paper.map(({ k, st }) =>
        st.game === 'count' ? <CountBlock key={k.id + 'c'} seed={k.seed} name={k.name} /> : <AssembleBlock key={k.id + 'a'} seed={k.seed} name={k.name} />,
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
        Découpez les bandes le long des pointillés et posez-les en vrac sur le poste. Les joueurs les rangent dans l’ordre du nombre de points (1 point, 2 points…), lisent la ligne
        demandée par leur téléphone (lettres du HAUT ou lettres du BAS : deux mots différents), la saisissent, puis remélangent les bandes.
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

function SpecialSheet({ s, t }: { s: Station; t: Terrain }) {
  const r = room(t, s.roomId);
  return (
    <section class="sheet" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '34pt' }}>{s.name}</h1>
      <p style={{ fontSize: '16pt' }}>
        {r?.name} {r?.floor ? `(${r.floor})` : ''}
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6mm 0' }}>
        <QR text={stationUrl(s.code)} size={300} />
      </div>
      <div class="scode">{s.code}</div>
      <p style={{ fontSize: '14pt', maxWidth: '150mm', margin: '6mm auto' }}>{SPECIAL_HELP[s.kind]}</p>
    </section>
  );
}

function RoomSheets({ t }: { t: Terrain }) {
  return (
    <>
      {t.rooms.map((r) => (
        <section class="sheet" key={r.id}>
          {r.forbidden ? (
            <>
              <div class="bigname" style={{ color: '#c00' }}>
                ⛔ ZONE INTERDITE
              </div>
              <p style={{ textAlign: 'center', fontSize: '22pt' }}>{r.name} — personne n’entre, même pour se cacher ou poursuivre quelqu’un.</p>
            </>
          ) : r.transit ? (
            <>
              <div class="bigname">⚠️ {r.name}</div>
              <p style={{ textAlign: 'center', fontSize: '20pt' }}>Zone de passage : on marche, on ne court pas, on ne s’arrête pas. Aucune élimination ici.</p>
            </>
          ) : (
            <>
              <div class="bigname">{r.name}</div>
              <p style={{ textAlign: 'center', fontSize: '16pt' }}>
                {r.floor}
                {r.id === t.meetingRoomId ? ' · SALLE DE RÉUNION' : ''}
                {r.hideAllowed ? ' · cachette autorisée' : ''}
              </p>
              {r.notes && <p style={{ textAlign: 'center' }}>{r.notes}</p>}
            </>
          )}
        </section>
      ))}
    </>
  );
}

function GhostSheet() {
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

function SummarySheet({ v }: { v: GmView }) {
  const s = v.settings;
  return (
    <section class="sheet">
      <h1>Aide-mémoire</h1>
      <ul style={{ fontSize: '12.5pt' }}>
        <li>
          <strong>Équipage</strong> : faire ses tâches aux postes (scanner le QR code), démasquer les imposteurs. Victoire : toutes les tâches faites ou tous les imposteurs éjectés.
        </li>
        <li>
          <strong>Imposteurs ({s.impostors})</strong> : éliminer et saboter sans être démasqués. Victoire : autant d’imposteurs que d’équipiers vivants, ou sabotage critique non réparé.
        </li>
        <li>
          <strong>Élimination</strong> : l’imposteur touche l’épaule (ou se place à portée de bras) puis choisit le pseudonyme de sa victime sur son téléphone ; la victime n’a rien à saisir et peut contester auprès du MJ. Délai : {s.killCooldownSec} s (premier : {s.initialKillCooldownSec} s). Jamais dans un escalier ou un passage.
        </li>
        <li>
          <strong>Corps</strong> : la victime s’assoit sur place, silencieuse, téléphone montrant son code de corps en très gros et un QR code. Celui qui la trouve scanne ce QR code (onglet Poste) ou tape le code (onglet Urgence) → réunion.
        </li>
        <li>
          <strong>Réunion d’urgence</strong> : au bouton d’urgence ({s.emergencyMeetingsPerPlayer} par joueur, impossible pendant un sabotage).
        </li>
        <li>
          <strong>Réunion</strong> : rassemblement ({s.gatherSec} s, 15 s de plus seulement une fois la majorité arrivée), discussion ({s.discussionSec} s, ou moins si la majorité touche « Prêt à voter »), vote ({s.votingSec} s). Vote pour un joueur ou « passer ». Égalité ou « passer » majoritaire : personne n’est éjecté. {s.confirmEjects ? 'Le rôle de l’éjecté est annoncé.' : 'Le rôle de l’éjecté n’est pas annoncé.'} {s.anonymousVotes ? 'Votes anonymes.' : 'Votes visibles après le décompte.'}
        </li>
        <li>
          <strong>Fantômes</strong> : silence total avec les vivants, badge visible dès l’annonce de la mort. L’équipage fantôme finit ses tâches ; l’imposteur fantôme peut saboter. Pas de vote, pas de signalement, pas de réparation.
        </li>
        <li>
          <strong>Sabotages</strong> : réacteur ({s.reactorSec} s, 2 personnes en même temps), oxygène ({s.oxygenSec} s, 2 postes), panne de courant (impossible de signaler un corps), communications (liste des tâches masquée).
        </li>
        <li>
          <strong>Sécurité</strong> : on ne court jamais, aucune porte verrouillée, zones interdites respectées, aucun contact brusque. Bouton « Alerte sécurité » dans l’onglet Urgence. Le maître du jeu peut tout arrêter.
        </li>
      </ul>
    </section>
  );
}
