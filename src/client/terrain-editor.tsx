// Onglet Terrain : fiches du kit appairées aux pièces (enregistrées aussitôt), pièces et zones, réunion et
// sécurité, conduits facultatifs. Les tâches se répartissent toutes seules. Aucune programmation nécessaire.

import { useEffect, useState } from 'preact/hooks';
import { GAMES, TASK_TYPE_LABEL } from '../shared/catalog';
import { MAX_ROOMS, newId } from '../shared/terrain';
import type { Terrain } from '../shared/types';
import type { GmView } from '../shared/view';
import { KitPairing } from './kit-pairing';
import type { Connection } from './net';
import { sessions } from './session';
import { ActButton, Collapse, toast } from './ui';

type Conn = Connection<GmView>;

/** Dernière maison enregistrée sur cet appareil, si elle a des fiches appairées. */
function lastHouse(): Terrain | undefined {
  const t = sessions.terrain() as Terrain | undefined;
  return t && Array.isArray(t.rooms) && Array.isArray(t.stations) && t.stations.length > 0 ? t : undefined;
}

export function TerrainEditor({ v, conn }: { v: GmView; conn: Conn }) {
  const editable = v.phase === 'lobby';
  const [t, setT] = useState<Terrain>(v.terrain);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setT(v.terrain);
  }, [v.terrain]);
  const upd = (patch: Partial<Terrain>) => {
    setT({ ...t, ...patch });
    setDirty(true);
  };
  const roomName = (id: string) => t.rooms.find((r) => r.id === id)?.name ?? '?';
  const playable = t.rooms.filter((r) => !r.forbidden && !r.transit);
  const hasSheets = (roomId: string) => t.stations.some((s) => s.roomId === roomId);
  const last = editable && t.rooms.length === 0 && t.stations.length === 0 ? lastHouse() : undefined;

  const save = async (next = t, done = 'Terrain enregistré.') => {
    const r = await conn.act({ type: 'terrain', terrain: next });
    if (r.ok) {
      setT(next);
      setDirty(false);
      sessions.setTerrain(next);
      if (done) toast(done, 'ok');
    }
    return r;
  };
  const setRoom = (i: number, patch: Partial<Terrain['rooms'][number]>) => upd({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  /** Une pièce qui porte des fiches ne peut devenir ni interdite ni un passage. */
  const zone = (i: number, key: 'forbidden' | 'transit', on: boolean, input: HTMLInputElement) => {
    if (on && hasSheets(t.rooms[i].id)) {
      input.checked = false;
      return toast('Des fiches sont posées dans cette pièce : retirez-les ou déplacez-les d’abord.', 'err');
    }
    setRoom(i, key === 'forbidden' ? { forbidden: on, transit: false } : { transit: on, forbidden: false });
  };

  return (
    <div class="stack">
      {!editable && (
        <p class="card warn">
          {v.phase === 'ended' ? 'Manche terminée : touchez « Nouvelle manche » (onglet Partie) pour revenir au salon et changer les fiches.' : 'Le terrain est verrouillé pendant la manche : il se modifie dans le salon, entre deux manches.'}
        </p>
      )}
      {last && (
        <div class="card stack">
          <h2 style={{ margin: 0 }}>Même maison que la dernière fois ?</h2>
          <p style={{ margin: 0 }}>
            Cet appareil a gardé votre dernière maison : {last.rooms.length} pièce(s), {last.stations.length} fiche(s) appairée(s). Reprenez-la seulement si les fiches sont posées aux mêmes endroits ; sinon, appairez-les ci-dessous.
          </p>
          <ActButton class="primary" run={() => save(last, 'Maison reprise : vérifiez les fiches dans l’onglet 🧪 Tests.')}>
            Reprendre cette maison
          </ActButton>
        </div>
      )}
      <KitPairing t={t} editable={editable} save={(next, msg) => save(next, msg)} />
      <fieldset disabled={!editable} style={{ border: 'none', padding: 0, margin: 0 }} class="stack">
        <div class="card stack">
          <div class="row">
            <h2 class="grow" style={{ margin: 0 }}>
              Pièces et zones ({t.rooms.length})
            </h2>
            <button
              class="btn small"
              disabled={t.rooms.length >= MAX_ROOMS}
              onClick={() => upd({ rooms: [...t.rooms, { id: newId('r'), name: 'Nouvelle zone', floor: '', forbidden: false, transit: true, hideAllowed: false, notes: '' }] })}
            >
              + Zone
            </button>
          </div>
          <p class="muted" style={{ margin: 0 }}>
            Les pièces se créent en appairant les fiches. Ajoutez ici les zones sans fiche : « Passage » (escalier, couloir : on y marche, ni élimination ni fiche) ou « Interdite » (personne n’y entre). « Cachette » : on peut s’y cacher.
          </p>
          {t.rooms.length === 0 && <p class="muted">Aucune pièce pour l’instant : appairez une première fiche ci-dessus.</p>}
          {t.rooms.map((r, i) => (
            <div class="card alt stack" key={r.id}>
              <div class="row">
                <input class="grow" style={{ flex: 2 }} value={r.name} aria-label="Nom" onInput={(e) => setRoom(i, { name: (e.target as HTMLInputElement).value })} />
                <input class="grow" style={{ flex: 1 }} value={r.floor} placeholder="Étage" aria-label="Étage" onInput={(e) => setRoom(i, { floor: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="row">
                <label class="check">
                  <input type="checkbox" checked={r.forbidden} onChange={(e) => zone(i, 'forbidden', (e.target as HTMLInputElement).checked, e.target as HTMLInputElement)} /> Interdite
                </label>
                <label class="check">
                  <input type="checkbox" checked={r.transit} onChange={(e) => zone(i, 'transit', (e.target as HTMLInputElement).checked, e.target as HTMLInputElement)} /> Passage
                </label>
                <label class="check">
                  <input type="checkbox" checked={r.hideAllowed} onChange={(e) => setRoom(i, { hideAllowed: (e.target as HTMLInputElement).checked })} /> Cachette
                </label>
                <button
                  class="btn small"
                  onClick={() => {
                    if (hasSheets(r.id)) return toast('Des fiches sont posées dans cette pièce : retirez-les ou déplacez-les d’abord.', 'err');
                    upd({ rooms: t.rooms.filter((x) => x.id !== r.id), passages: t.passages.filter((p) => p.fromRoomId !== r.id && p.toRoomId !== r.id) });
                  }}
                >
                  Supprimer
                </button>
              </div>
              <input value={r.notes} placeholder="Notes (ex. « fenêtre : ne pas s’approcher »)" onInput={(e) => setRoom(i, { notes: (e.target as HTMLInputElement).value })} />
            </div>
          ))}
        </div>

        <div class="card stack">
          <h2 style={{ margin: 0 }}>Réunion et sécurité</h2>
          <label class="field">
            <span>Salle de réunion (elle suit la fiche « Bouton d’urgence » tant que vous n’en choisissez pas une autre)</span>
            <select value={t.meetingRoomId} disabled={!playable.length} onChange={(e) => upd({ meetingRoomId: (e.target as HTMLSelectElement).value })}>
              {!playable.length && <option value="">— appairez d’abord une fiche —</option>}
              {playable.map((r) => (
                <option value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Consignes de sécurité (sorties, escaliers, zones interdites) — affichées à tous</span>
            <textarea rows={4} value={t.safetyNotes} onInput={(e) => upd({ safetyNotes: (e.target as HTMLTextAreaElement).value })} />
          </label>
        </div>

        <Collapse title="Tâches, réparties automatiquement" count={t.tasks.length}>
          <p class="muted" style={{ margin: 0 }}>
            Elles se recalculent à chaque fiche appairée ou retirée : chaque fiche posée en reçoit au moins une, et une tâche dont la fiche attitrée (énigme papier, scan) n’est pas posée n’existe pas.
          </p>
          {t.tasks.length === 0 && <p class="muted">Aucune tâche tant qu’aucune fiche « Poste » n’est appairée.</p>}
          {t.tasks.map((k) => (
            <small key={k.id}>
              <strong>{k.name}</strong> ({TASK_TYPE_LABEL[k.type].toLowerCase()}) :{' '}
              {k.steps.map((st) => `${t.stations.find((x) => x.id === st.stationId)?.name} · ${roomName(t.stations.find((x) => x.id === st.stationId)?.roomId ?? '')} (${GAMES[st.game].label})`).join(' → ')}
            </small>
          ))}
        </Collapse>

        <Collapse title="Conduits des imposteurs (facultatif)" count={t.passages.length}>
          <p class="muted" style={{ margin: 0 }}>
            Équivalent des bouches d’aération : un itinéraire sûr (éclairé, sans obstacle) que seuls les imposteurs ont le droit d’emprunter.
          </p>
          <button class="btn small" disabled={playable.length < 2} onClick={() => upd({ passages: [...t.passages, { id: newId('p'), name: 'Conduit', fromRoomId: playable[0].id, toRoomId: playable[1].id, notes: '' }] })}>
            + Conduit
          </button>
          {t.passages.map((p, i) => (
            <div class="card alt stack" key={p.id}>
              <div class="row">
                <input style={{ flex: 1 }} value={p.name} aria-label="Nom du conduit" onInput={(e) => upd({ passages: t.passages.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)) })} />
                <button class="btn small" aria-label="Supprimer le conduit" onClick={() => upd({ passages: t.passages.filter((x) => x.id !== p.id) })}>
                  ✕
                </button>
              </div>
              <div class="row">
                <select style={{ flex: 1 }} value={p.fromRoomId} onChange={(e) => upd({ passages: t.passages.map((x, j) => (j === i ? { ...x, fromRoomId: (e.target as HTMLSelectElement).value } : x)) })}>
                  {playable.map((r) => (
                    <option value={r.id}>{r.name}</option>
                  ))}
                </select>
                ↔
                <select style={{ flex: 1 }} value={p.toRoomId} onChange={(e) => upd({ passages: t.passages.map((x, j) => (j === i ? { ...x, toRoomId: (e.target as HTMLSelectElement).value } : x)) })}>
                  {playable.map((r) => (
                    <option value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <input value={p.notes} placeholder="Itinéraire et consignes" onInput={(e) => upd({ passages: t.passages.map((x, j) => (j === i ? { ...x, notes: (e.target as HTMLInputElement).value } : x)) })} />
            </div>
          ))}
        </Collapse>
      </fieldset>

      {editable && dirty && (
        <div class="card row save-bar">
          <ActButton class="primary" run={() => save()}>
            💾 Enregistrer
          </ActButton>
          <span class="badge warn grow">modifications non enregistrées</span>
          <button
            class="btn small"
            onClick={() => {
              setT(v.terrain);
              setDirty(false);
            }}
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
