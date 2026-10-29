// Supports imprimables générés à partir du terrain : fiches de postes (QR + code + énigmes),
// affiche d'invitation, étiquettes de pièces, panneaux d'interdiction, badges fantômes, aide-mémoire.
// Les fiches du kit universel (indépendantes de la partie) s'impriment depuis la page « Kit » (kit-print.tsx).

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { GAMES, SABOTAGE_INFO } from '../shared/catalog';
import { assemblePuzzle, countPuzzle, ROW_LABELS } from '../shared/puzzles';
import type { GameKind, Settings, Station, Terrain } from '../shared/types';
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
  // terrain du kit : les fiches de postes sont celles du kit, imprimées une fois pour toutes
  const sections = (Object.keys(SECTIONS) as Section[]).filter((k) => !t.kit || (k !== 'stations' && k !== 'special'));
  const room = (id: string) => t.rooms.find((r) => r.id === id);
  const roomLabel = (s: Station) => (
    <>
      <strong>{room(s.roomId)?.name}</strong> {room(s.roomId)?.floor ? `(${room(s.roomId)!.floor})` : ''}
    </>
  );
  return (
    <div>
      <div class="wrap noprint stack">
        <div class="row">
          <a class="btn small" href="#/gm">
            ← Tableau de bord
          </a>
          <h1 class="grow">Impression</h1>
        </div>
        {t.kit ? (
          <p class="card">
            Ce terrain utilise le <strong>kit de fiches universel</strong> : ses fiches de postes s’impriment une fois pour toutes, sans lien avec cette partie.{' '}
            <a class="btn link" href="#/kit">
              Imprimer le kit
            </a>
          </p>
        ) : (
          <p>Choisissez les documents puis utilisez « Imprimer » (ou « Enregistrer en PDF »). Les codes restent valables tant que vous ne régénérez pas les postes.</p>
        )}
        {sections.map((k) => (
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
        {on.invite && <InviteSheet code={v.code} terrainName={t.name} />}
        {!t.kit &&
          on.stations &&
          t.stations
            .filter((s) => s.kind === 'task')
            .map((s) => {
              const here = t.tasks.filter((k) => k.enabled && k.steps.some((x) => x.stationId === s.id));
              return (
                <StationSheet
                  key={s.id}
                  name={s.name}
                  code={s.code}
                  qr={stationUrl(s.code)}
                  room={roomLabel(s)}
                  tasks={here.map((k) => {
                    const labels = k.steps.filter((x) => x.stationId === s.id).map((x) => GAMES[x.game].label);
                    return labels.some((l) => l !== k.name) ? `${k.name} — ${labels.join(', ')}` : k.name;
                  })}
                  extras={here.flatMap((k) => k.steps.filter((x) => x.stationId === s.id).map((x) => ({ game: x.game, seed: k.seed, task: k.name })))}
                />
              );
            })}
        {!t.kit && on.special && t.stations.filter((s) => s.kind !== 'task').map((s) => <SpecialSheet key={s.id} name={s.name} kind={s.kind} code={s.code} qr={stationUrl(s.code)} room={roomLabel(s)} />)}
        {on.rooms && <RoomSheets t={t} />}
        {on.ghosts && <GhostSheet />}
        {on.summary && <SummarySheet settings={v.settings} />}
      </div>
    </div>
  );
}

export const BLANK_LINE = '______________________';

/** Sans code de partie : l'affiche mène à l'accueil du site, le MJ écrit le code à la main. */
export function InviteSheet({ code, terrainName }: { code?: string; terrainName?: string }) {
  return (
    <section class="sheet" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '40pt' }}>Rejoignez la partie !</h1>
      <p style={{ fontSize: '16pt' }}>Scannez avec l’appareil photo de votre téléphone</p>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8mm 0' }}>
        <QR text={code ? joinUrl(code) : `${location.origin}/`} size={340} />
      </div>
      <p style={{ fontSize: '18pt' }}>
        ou ouvrez <strong>{location.host}</strong>, touchez « Je rejoins une partie » et saisissez le code{code ? '' : ' de la partie'}
      </p>
      <div class="scode" style={{ fontSize: '54pt' }}>
        {code ?? '__________'}
      </div>
      <p style={{ fontSize: '13pt', marginTop: '10mm' }}>Aucune application à installer · aucun compte{code && terrainName ? ` · terrain : ${terrainName}` : ''}</p>
    </section>
  );
}

/**
 * Fiche d'un poste de tâches. room : pièce imprimée (sinon ligne à remplir à la main) ; tasks : liste imprimée
 * (absente pour le kit, dont les tâches changent avec les fiches posées) ; extras : énigmes papier et scan de ce poste.
 */
export function StationSheet({ name, code, qr, room, tasks, extras }: { name: string; code: string; qr: string; room?: ComponentChildren; tasks?: string[]; extras: { game: GameKind; seed: number; task: string }[] }) {
  return (
    <section class="sheet">
      <div style={{ display: 'flex', gap: '8mm', alignItems: 'center' }}>
        <QR text={qr} size={250} />
        <div>
          <h1>{name}</h1>
          <p style={{ fontSize: '16pt' }}>Pièce : {room ?? BLANK_LINE}</p>
          <p>Code du poste :</p>
          <div class="scode">{code}</div>
        </div>
      </div>
      {tasks ? (
        <>
          <p style={{ marginTop: '6mm' }}>Scannez ce QR code dans l’onglet « Poste » de l’application (ou saisissez le code). Tâches possibles ici :</p>
          <ul>
            {tasks.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ marginTop: '6mm' }}>Scannez ce QR code dans l’onglet « Poste » de l’application (ou saisissez le code) : votre téléphone indique la tâche à faire ici.</p>
      )}
      {extras.some((x) => x.game === 'scan') && (
        <p style={{ border: '2px solid #000', padding: '3mm', marginTop: '4mm' }}>
          <strong>Scan médical</strong> : tenez-vous immobile sur la croix collée au sol devant cette fiche.
        </p>
      )}
      {extras.map((x) => (x.game === 'count' ? <CountBlock key={x.task + 'c'} seed={x.seed} name={x.task} /> : x.game === 'assemble' ? <AssembleBlock key={x.task + 'a'} seed={x.seed} name={x.task} /> : null))}
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

export const SPECIAL_HELP: Record<string, string> = {
  emergency: 'Pour convoquer une réunion d’urgence : scannez ce poste puis appuyez sur le bouton rouge. Impossible pendant un sabotage.',
  reactor: `${SABOTAGE_INFO.reactor.short} Scannez ce poste puis maintenez le bouton appuyé jusqu’à la réparation.`,
  oxygen: `${SABOTAGE_INFO.oxygen.short} Scannez ce poste et recopiez le code affiché sur votre téléphone.`,
  lights: `${SABOTAGE_INFO.lights.short} Ceci est un poste FICTIF : ne touchez jamais au vrai tableau électrique.`,
  comms: `${SABOTAGE_INFO.comms.short}`,
  vitals: 'Moniteur de vie : scannez ce poste pour voir qui est vivant ou mort (indisponible quand les communications sont coupées).',
};

export function SpecialSheet({ name, kind, code, qr, room }: { name: string; kind: string; code: string; qr: string; room?: ComponentChildren }) {
  return (
    <section class="sheet" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '34pt' }}>{name}</h1>
      <p style={{ fontSize: '16pt' }}>{room ?? `Pièce : ${BLANK_LINE}`}</p>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6mm 0' }}>
        <QR text={qr} size={300} />
      </div>
      <div class="scode">{code}</div>
      <p style={{ fontSize: '14pt', maxWidth: '150mm', margin: '6mm auto' }}>{SPECIAL_HELP[kind]}</p>
    </section>
  );
}

/** Panneaux génériques (kit) : étiquettes de pièces à compléter, zones interdites, zones de passage. */
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

/** Sans réglages (kit) : rien de ce que le MJ ajuste à chaque partie (nombre d'imposteurs, délais) n'est imprimé. */
export function SummarySheet({ settings }: { settings?: Settings }) {
  const generic = !settings;
  const s = settings ?? ({} as Settings);
  return (
    <section class="sheet">
      <h1>Aide-mémoire</h1>
      <ul style={{ fontSize: '12.5pt' }}>
        <li>
          <strong>Équipage</strong> : faire ses tâches aux postes (scanner le QR code), démasquer les imposteurs. Victoire : toutes les tâches faites ou tous les imposteurs éjectés.
        </li>
        <li>
          <strong>Imposteurs{generic ? '' : ` (${s.impostors})`}</strong> : éliminer et saboter sans être démasqués. Victoire : autant d’imposteurs que d’équipiers vivants, ou sabotage critique non réparé.
        </li>
        <li>
          <strong>Élimination</strong> : l’imposteur touche l’épaule (ou se place à portée de bras) puis choisit le pseudonyme de sa victime sur son téléphone ; la victime n’a rien à saisir et peut contester auprès du MJ.{' '}
          {generic ? 'Un délai fixé par le MJ sépare deux éliminations.' : `Délai : ${s.killCooldownSec} s (premier : ${s.initialKillCooldownSec} s).`} Jamais dans un escalier ou un passage.
        </li>
        <li>
          <strong>Corps</strong> : la victime s’assoit sur place, silencieuse, téléphone montrant son code de corps en très gros et un QR code. Celui qui la trouve scanne ce QR code (onglet Poste) ou tape le code (onglet Urgence) → réunion.
        </li>
        <li>
          <strong>Réunion d’urgence</strong> : au bouton d’urgence ({generic ? 'nombre par joueur fixé par le MJ' : `${s.emergencyMeetingsPerPlayer} par joueur`}, impossible pendant un sabotage).
        </li>
        <li>
          {generic ? (
            <>
              <strong>Réunion</strong> : rassemblement (15 s de plus seulement une fois la majorité arrivée), discussion (plus courte si la majorité touche « Prêt à voter »), puis vote ; les durées s’affichent sur le téléphone. Vote pour un joueur ou « passer
              ». Égalité ou « passer » majoritaire : personne n’est éjecté. Le MJ annonce si le rôle de l’éjecté est révélé et si les votes sont anonymes.
            </>
          ) : (
            <>
              <strong>Réunion</strong> : rassemblement ({s.gatherSec} s, 15 s de plus seulement une fois la majorité arrivée), discussion ({s.discussionSec} s, ou moins si la majorité touche « Prêt à voter »), vote ({s.votingSec} s). Vote pour un joueur ou «
              passer ». Égalité ou « passer » majoritaire : personne n’est éjecté. {s.confirmEjects ? 'Le rôle de l’éjecté est annoncé.' : 'Le rôle de l’éjecté n’est pas annoncé.'} {s.anonymousVotes ? 'Votes anonymes.' : 'Votes visibles après le décompte.'}
            </>
          )}
        </li>
        <li>
          <strong>Fantômes</strong> : silence total avec les vivants, badge visible dès l’annonce de la mort. L’équipage fantôme finit ses tâches ; l’imposteur fantôme peut saboter. Pas de vote, pas de signalement, pas de réparation.
        </li>
        <li>
          <strong>Sabotages</strong> : réacteur ({generic ? 'compte à rebours sur le téléphone' : `${s.reactorSec} s`}, 2 personnes en même temps), oxygène ({generic ? 'compte à rebours' : `${s.oxygenSec} s`}, 2 postes), panne de courant (impossible de
          signaler un corps), communications (liste des tâches masquée).
        </li>
        <li>
          <strong>Sécurité</strong> : on ne court jamais, aucune porte verrouillée, zones interdites respectées, aucun contact brusque. Bouton « Alerte sécurité » dans l’onglet Urgence. Le maître du jeu peut tout arrêter.
        </li>
      </ul>
    </section>
  );
}
