// Éditeur du terrain : pièces, postes, tâches, conduits. Aucune programmation nécessaire.

import { useEffect, useState } from 'preact/hooks';
import { GAMES, STATION_KIND_LABEL, TASK_TYPE_LABEL } from '../shared/catalog';
import { CODE_ALPHABET, randomCode } from '../shared/rng';
import { EXAMPLE_NAME, EXAMPLE_ROOMS, generateTerrain, kitTerrain, newId } from '../shared/terrain';
import type { GameKind, StationKind, TaskType, Terrain } from '../shared/types';
import type { GmView } from '../shared/view';
import type { Connection } from './net';
import { KitPairing } from './kit-pairing';
import { sessions } from './session';
import { ActButton, toast } from './ui';

type Conn = Connection<GmView>;

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
  const taskStations = t.stations.filter((s) => s.kind === 'task');

  const save = async (next = t, done = 'Terrain enregistré (et mémorisé sur cet appareil pour les prochaines parties).') => {
    const r = await conn.act({ type: 'terrain', terrain: next });
    if (r.ok) {
      setT(next);
      setDirty(false);
      sessions.setTerrain(next);
      if (done) toast(done, 'ok');
    }
    return r;
  };
  const kitWarning = t.kit ? '\n\nLe terrain quittera le kit de fiches universel : les appairages seront perdus.' : '';
  const hasSheets = (roomId: string) => t.stations.some((s) => s.roomId === roomId);

  return (
    <div class="stack">
      {!editable && <p class="card warn">Le terrain est verrouillé pendant la partie. Il se modifie dans le salon.</p>}
      <p class="muted">Pour vérifier les fiches imprimées et tester chaque tâche : onglet 🧪 Tests.</p>
      {t.kit ? (
        <KitPairing t={t} editable={editable} save={(next, msg) => save(next, msg)} />
      ) : (
        <div class="card stack">
          <h2 style={{ margin: 0 }}>📦 Kit de fiches universel (conseillé)</h2>
          <p style={{ margin: 0 }}>
            40 fiches « Poste » et 8 fiches spéciales imprimées <strong>une fois pour toutes</strong>, valables pour toutes les parties et toutes les maisons. Sur place, vous scannez chaque fiche posée et touchez sa pièce ; les tâches se répartissent toutes
            seules. Les pièces déjà saisies sont gardées.
          </p>
          <div class="row">
            <ActButton
              class="primary"
              disabled={!editable}
              run={async () => {
                if (t.stations.length && t.name !== EXAMPLE_NAME && !confirm('Utiliser le kit de fiches universel ? Les postes actuels et leurs fiches imprimées ne serviront plus (les pièces sont gardées).')) return;
                return save(kitTerrain(t), '');
              }}
            >
              Utiliser le kit
            </ActButton>
            <a class="btn" href="#/kit">
              🖨 Imprimer le kit
            </a>
          </div>
        </div>
      )}
      <fieldset disabled={!editable} style={{ border: 'none', padding: 0, margin: 0 }} class="stack">
        <div class="card stack">
          <h2>Informations générales</h2>
          <label class="field">
            <span>Nom du terrain</span>
            <input value={t.name} onInput={(e) => upd({ name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="field">
            <span>Salle de réunion (où se trouve le bouton d’urgence)</span>
            <select value={t.meetingRoomId} onChange={(e) => upd({ meetingRoomId: (e.target as HTMLSelectElement).value })}>
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

        <div class="card stack">
          <div class="row">
            <h2 class="grow">Pièces et zones ({t.rooms.length})</h2>
            <button class="btn small" onClick={() => upd({ rooms: [...t.rooms, { id: newId('r'), name: 'Nouvelle pièce', floor: '', forbidden: false, transit: false, hideAllowed: true, notes: '' }] })}>
              + Pièce
            </button>
          </div>
          <p class="muted">« Interdite » : personne n’y entre. « Passage » : escalier/couloir où l’on marche sans s’arrêter, sans élimination ni poste. « Cachette » : on peut s’y cacher.</p>
          {t.rooms.map((r, i) => (
            <div class="card alt" key={r.id}>
              <div class="row">
                <input class="grow" style={{ flex: 2 }} value={r.name} aria-label="Nom" onInput={(e) => upd({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)) })} />
                <input class="grow" style={{ flex: 1 }} value={r.floor} placeholder="Étage" aria-label="Étage" onInput={(e) => upd({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, floor: (e.target as HTMLInputElement).value } : x)) })} />
              </div>
              <div class="row">
                <label class="check">
                  <input
                    type="checkbox"
                    checked={r.forbidden}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked;
                      if (on && hasSheets(r.id)) {
                        (e.target as HTMLInputElement).checked = false;
                        return toast('Des fiches sont posées dans cette pièce : retirez-les ou déplacez-les d’abord.', 'err');
                      }
                      upd({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, forbidden: on, transit: false } : x)) });
                    }}
                  />{' '}
                  Interdite
                </label>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={r.transit}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked;
                      if (on && hasSheets(r.id)) {
                        (e.target as HTMLInputElement).checked = false;
                        return toast('Des fiches sont posées dans cette pièce : retirez-les ou déplacez-les d’abord.', 'err');
                      }
                      upd({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, transit: on, forbidden: false } : x)) });
                    }}
                  />{' '}
                  Passage
                </label>
                <label class="check">
                  <input type="checkbox" checked={r.hideAllowed} onChange={(e) => upd({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, hideAllowed: (e.target as HTMLInputElement).checked } : x)) })} /> Cachette
                </label>
                <button
                  class="btn small"
                  onClick={() => {
                    if (t.stations.some((s) => s.roomId === r.id)) return toast('Supprimez ou déplacez d’abord les postes de cette pièce.', 'err');
                    upd({ rooms: t.rooms.filter((x) => x.id !== r.id) });
                  }}
                >
                  Supprimer
                </button>
              </div>
              <input value={r.notes} placeholder="Notes (ex. « fenêtre : ne pas s’approcher »)" onInput={(e) => upd({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, notes: (e.target as HTMLInputElement).value } : x)) })} />
            </div>
          ))}
          <div class="row">
            {!t.kit && (
              <button
                class="btn small warn"
                onClick={() => {
                  if (!confirm('Recréer automatiquement les postes et les tâches à partir de ces pièces ? Les codes changent : il faudra réimprimer les fiches.' + kitWarning)) return;
                  try {
                    const g = generateTerrain(t.rooms.map((r) => ({ name: r.name, floor: r.floor, forbidden: r.forbidden, transit: r.transit })), Math.max(0, t.rooms.findIndex((r) => r.id === t.meetingRoomId)));
                    g.name = t.name;
                    g.safetyNotes = t.safetyNotes;
                    // on conserve les identifiants des pièces existantes pour garder conduits et réglages
                    g.rooms.forEach((r, i) => {
                      const old = t.rooms[i];
                      const oldId = old.id;
                      g.stations.forEach((s) => s.roomId === r.id && (s.roomId = oldId));
                      if (g.meetingRoomId === r.id) g.meetingRoomId = oldId;
                      Object.assign(r, { ...old });
                    });
                    g.passages = t.passages;
                    setT(g);
                    setDirty(true);
                  } catch (e) {
                    toast((e as Error).message, 'err');
                  }
                }}
              >
                ⚙ Générer postes et tâches automatiquement
              </button>
            )}
            <button
              class="btn small"
              onClick={() => {
                if (!confirm('Remplacer par la maison d’exemple ?' + kitWarning)) return;
                setT(generateTerrain(EXAMPLE_ROOMS, 0, undefined, EXAMPLE_NAME));
                setDirty(true);
              }}
            >
              Charger l’exemple
            </button>
          </div>
        </div>

        {t.kit ? (
          <div class="card stack">
            <h2 style={{ margin: 0 }}>Tâches ({t.tasks.length}, réparties automatiquement)</h2>
            <p class="muted" style={{ margin: 0 }}>
              Elles se recalculent à chaque fiche appairée ou retirée : chaque fiche posée en reçoit au moins une, une tâche dont la fiche attitrée (énigme papier, scan) n’est pas posée n’existe pas.
            </p>
            {t.tasks.map((k) => (
              <small key={k.id}>
                {k.name} ({TASK_TYPE_LABEL[k.type].toLowerCase()}) : {k.steps.map((st) => `${t.stations.find((x) => x.id === st.stationId)?.name} · ${roomName(t.stations.find((x) => x.id === st.stationId)?.roomId ?? '')}`).join(' → ')}
              </small>
            ))}
          </div>
        ) : (
          <>
            <div class="card stack">
              <div class="row">
                <h2 class="grow">Postes ({t.stations.length})</h2>
                <button class="btn small" disabled={!playable.length} onClick={() => upd({ stations: [...t.stations, { id: newId('s'), name: 'Nouveau poste', roomId: playable[0].id, kind: 'task', code: uniqueCode(t) }] })}>
                  + Poste
                </button>
              </div>
              <p class="muted">Chaque poste reçoit une fiche imprimée avec un QR code et un code. Il faut : 1 bouton d’urgence, 2 postes Réacteur et 2 postes Oxygène pour les sabotages critiques, 1 poste Énergie et 1 poste Radio.</p>
              {t.stations.map((s, i) => (
                <div class="row card alt" key={s.id}>
                  <input style={{ flex: 2, minWidth: '140px' }} value={s.name} aria-label="Nom du poste" onInput={(e) => upd({ stations: t.stations.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)) })} />
                  <select style={{ flex: 1, minWidth: '120px' }} value={s.roomId} aria-label="Pièce" onChange={(e) => upd({ stations: t.stations.map((x, j) => (j === i ? { ...x, roomId: (e.target as HTMLSelectElement).value } : x)) })}>
                    {playable.map((r) => (
                      <option value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <select style={{ flex: 1, minWidth: '140px' }} value={s.kind} aria-label="Type" onChange={(e) => upd({ stations: t.stations.map((x, j) => (j === i ? { ...x, kind: (e.target as HTMLSelectElement).value as StationKind } : x)) })}>
                    {Object.entries(STATION_KIND_LABEL).map(([k, l]) => (
                      <option value={k}>{l}</option>
                    ))}
                  </select>
                  <code style={{ fontSize: '1.1rem' }}>{s.code}</code>
                  <button class="btn small" title="Nouveau code (réimpression nécessaire)" onClick={() => upd({ stations: t.stations.map((x, j) => (j === i ? { ...x, code: uniqueCode(t) } : x)) })}>
                    ↻
                  </button>
                  <button
                    class="btn small"
                    onClick={() => {
                      if (t.tasks.some((k) => k.steps.some((st) => st.stationId === s.id))) return toast('Des tâches utilisent ce poste : modifiez-les d’abord.', 'err');
                      upd({ stations: t.stations.filter((x) => x.id !== s.id) });
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div class="card stack">
              <div class="row">
                <h2 class="grow">Tâches ({t.tasks.filter((k) => k.enabled).length} actives)</h2>
                <button
                  class="btn small"
                  disabled={!taskStations.length}
                  onClick={() => upd({ tasks: [...t.tasks, { id: newId('t'), name: 'Nouvelle tâche', type: 'short', enabled: true, seed: Math.floor(Math.random() * 2 ** 31), steps: [{ stationId: taskStations[0].id, game: 'wires' }] }] })}
                >
                  + Tâche
                </button>
              </div>
              <p class="muted">Chaque joueur reçoit au hasard le nombre de tâches communes, longues et courtes fixé dans les paramètres. Les tâches « papier » utilisent l’énigme imprimée sur la fiche du poste.</p>
              {t.tasks.map((k, i) => {
                const setTask = (patch: Partial<typeof k>) => upd({ tasks: t.tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div class="card alt stack" key={k.id}>
                    <div class="row">
                      <label class="check">
                        <input type="checkbox" checked={k.enabled} onChange={(e) => setTask({ enabled: (e.target as HTMLInputElement).checked })} />
                      </label>
                      <input style={{ flex: 2, minWidth: '140px' }} value={k.name} aria-label="Nom de la tâche" onInput={(e) => setTask({ name: (e.target as HTMLInputElement).value })} />
                      <select style={{ flex: 1, minWidth: '110px' }} value={k.type} aria-label="Type" onChange={(e) => setTask({ type: (e.target as HTMLSelectElement).value as TaskType })}>
                        {Object.entries(TASK_TYPE_LABEL).map(([key, l]) => (
                          <option value={key}>{l}</option>
                        ))}
                      </select>
                      <button class="btn small" onClick={() => upd({ tasks: t.tasks.filter((x) => x.id !== k.id) })}>
                        ✕
                      </button>
                    </div>
                    {k.steps.map((st, si) => (
                      <div class="row" key={si}>
                        <small>Étape {si + 1}</small>
                        <select style={{ flex: 1, minWidth: '130px' }} value={st.stationId} aria-label="Poste" onChange={(e) => setTask({ steps: k.steps.map((x, j) => (j === si ? { ...x, stationId: (e.target as HTMLSelectElement).value } : x)) })}>
                          {taskStations.map((s) => (
                            <option value={s.id}>
                              {s.name} ({roomName(s.roomId)})
                            </option>
                          ))}
                        </select>
                        <select style={{ flex: 1, minWidth: '130px' }} value={st.game} aria-label="Mini-jeu" onChange={(e) => setTask({ steps: k.steps.map((x, j) => (j === si ? { ...x, game: (e.target as HTMLSelectElement).value as GameKind } : x)) })}>
                          {Object.entries(GAMES).map(([g, info]) => (
                            <option value={g}>{info.label}</option>
                          ))}
                        </select>
                        {k.steps.length > 1 && (
                          <button class="btn small" onClick={() => setTask({ steps: k.steps.filter((_, j) => j !== si) })}>
                            −
                          </button>
                        )}
                      </div>
                    ))}
                    {k.steps.length < 4 && (
                      <button class="btn small" onClick={() => setTask({ steps: [...k.steps, { stationId: taskStations[0].id, game: 'wait' }] })}>
                        + Étape
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div class="card stack">
          <div class="row">
            <h2 class="grow">Conduits des imposteurs ({t.passages.length})</h2>
            <button class="btn small" disabled={playable.length < 2} onClick={() => upd({ passages: [...t.passages, { id: newId('p'), name: 'Conduit', fromRoomId: playable[0].id, toRoomId: playable[1].id, notes: '' }] })}>
              + Conduit
            </button>
          </div>
          <p class="muted">Équivalent des bouches d’aération : un itinéraire sûr (éclairé, sans obstacle) que seuls les imposteurs ont le droit d’emprunter. Facultatif.</p>
          {t.passages.map((p, i) => (
            <div class="card alt stack" key={p.id}>
              <div class="row">
                <input style={{ flex: 1 }} value={p.name} onInput={(e) => upd({ passages: t.passages.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)) })} />
                <button class="btn small" onClick={() => upd({ passages: t.passages.filter((x) => x.id !== p.id) })}>
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
        </div>
      </fieldset>

      <div class="card row" style={{ position: dirty ? 'sticky' : 'static', bottom: 0 }}>
        {editable && (
          <ActButton class="primary" disabled={!dirty} run={() => save()}>
            💾 Enregistrer le terrain
          </ActButton>
        )}
        {dirty && <span class="badge warn">modifications non enregistrées</span>}
        <button
          class="btn small"
          onClick={() => {
            const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `terrain-${t.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
            a.click();
          }}
        >
          Exporter (fichier)
        </button>
        {editable && (
          <label class="btn small">
            Importer
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (!f) return;
                try {
                  setT(JSON.parse(await f.text()));
                  setDirty(true);
                  toast('Fichier chargé : vérifiez puis enregistrez.', 'info');
                } catch {
                  toast('Fichier invalide.', 'err');
                }
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function uniqueCode(t: Terrain): string {
  for (;;) {
    const c = randomCode(4, undefined, CODE_ALPHABET);
    if (!t.stations.some((s) => s.code === c)) return c;
  }
}
