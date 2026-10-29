// Appairage des fiches du kit universel : le MJ scanne une fiche posée puis touche la pièce où elle se trouve
// (ou la crée). Chaque geste est enregistré aussitôt ; les tâches se répartissent sur les fiches appairées.
// Une fiche non appairée n'existe pas pour le jeu.

import { useRef, useState } from 'preact/hooks';
import { STATION_KIND_LABEL } from '../shared/catalog';
import { KIT_SHEETS, kitSheet, kitSheetByCode, pairSheet } from '../shared/kit';
import { normalizeCode } from '../shared/rng';
import { MAX_ROOMS, newId } from '../shared/terrain';
import type { Room, Terrain } from '../shared/types';
import { kitPreparation } from './kit-print';
import { Scanner } from './scanner';
import { ActButton, toast } from './ui';

type Save = (next: Terrain, msg: string) => Promise<{ ok: boolean; msg?: string }>;

export function KitPairing({ t, editable, save }: { t: Terrain; editable: boolean; save: Save }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string>();
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('');
  const playable = t.rooms.filter((r) => !r.forbidden && !r.transit);
  const where = (id: string) => t.stations.find((s) => s.id === id)?.roomId;
  const roomName = (id?: string) => t.rooms.find((r) => r.id === id)?.name;
  const sheet = sel ? kitSheet(sel) : undefined;
  // la caméra relit la fiche qu'on vient d'appairer tant qu'on la vise encore : on l'ignore un moment
  const last = useRef<{ id: string; at: number }>();
  // confirmation affichée dans la carte (une notification masquerait le champ de code, touché fiche après fiche)
  const [confirmed, setConfirmed] = useState('');
  // un seul enregistrement à la fois : deux gestes rapides partiraient du même terrain et le second effacerait le premier
  const [busy, setBusy] = useState(false);

  const choose = async (raw: string) => {
    const k = kitSheetByCode(normalizeCode(raw));
    if (!k) {
      toast('Ce code n’est pas celui d’une fiche du kit.', 'err');
      return false;
    }
    setSel(k.id);
    return true;
  };

  /** Enregistre aussitôt ; en cas d'échec, le message est affiché ici (aussi pour les boutons ✕ sans ActButton). */
  const done = async (next: Terrain, msg: string, paired?: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const r = await save(next, '');
      if (r.ok) {
        if (paired) last.current = { id: paired, at: Date.now() };
        setSel(undefined);
        setConfirmed(msg);
      } else toast(r.msg ?? 'Enregistrement refusé.', 'err');
      return r.ok;
    } finally {
      setBusy(false);
    }
  };

  const createRoom = async () => {
    if (!sheet || !name.trim()) return;
    const existing = t.rooms.find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (existing && (existing.forbidden || existing.transit)) return toast(`« ${existing.name} » est une zone interdite ou de passage : aucune fiche n’y va.`, 'err');
    if (!existing && t.rooms.length >= MAX_ROOMS) return toast(`${MAX_ROOMS} pièces au maximum : supprimez une pièce inutile (liste des pièces).`, 'err');
    const room: Room | undefined = existing ? undefined : { id: newId('r'), name: name.trim().slice(0, 40), floor: floor.trim().slice(0, 30), forbidden: false, transit: false, hideAllowed: true, notes: '' };
    if (await done(pairSheet(t, sheet.id, existing?.id ?? room!.id, room), `${sheet.name} → ${existing?.name ?? room!.name}`, sheet.id)) {
      setName('');
      setFloor('');
    }
  };

  return (
    <div class="card stack">
      <div class="row">
        <h2 class="grow" style={{ margin: 0 }}>
          📦 Fiches posées : {t.stations.length}/{KIT_SHEETS.length}
        </h2>
        <a class="btn small" href="#/kit">
          🖨 Imprimer le kit
        </a>
      </div>
      <p class="muted" style={{ margin: 0 }}>
        Scannez chaque fiche posée et touchez sa pièce : c’est enregistré aussitôt et les tâches se répartissent toutes seules. Une fiche non appairée n’existe pas pour le jeu. Entre deux manches, ajoutez, déplacez ou retirez des fiches de la même façon.
      </p>
      {confirmed && (
        <p class="card ok" role="status" style={{ margin: 0 }}>
          ✔ {confirmed}
        </p>
      )}
      {editable && !open && !sheet && (
        <button class="btn big block primary" onClick={() => setOpen(true)}>
          📷 Appairer des fiches
        </button>
      )}
      {editable && open && !sheet && (
        <div class="card alt stack">
          <Scanner
            autoStart
            manualLabel="Code imprimé sur la fiche"
            onCode={choose}
            ignore={(raw) => {
              const l = last.current;
              return !!l && kitSheetByCode(normalizeCode(raw))?.id === l.id && Date.now() - l.at < 10_000;
            }}
          />
          <label class="field">
            <span>… ou choisissez la fiche dans la liste</span>
            <select value="" onChange={(e) => (e.target as HTMLSelectElement).value && setSel((e.target as HTMLSelectElement).value)}>
              <option value="">—</option>
              {KIT_SHEETS.map((k) => (
                <option value={k.id}>
                  {k.name} ({k.code}){where(k.id) ? ` — ${roomName(where(k.id))}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button class="btn" onClick={() => setOpen(false)}>
            Terminer
          </button>
        </div>
      )}
      {editable && sheet && (
        <div class="card alt stack">
          <div>
            <strong style={{ fontSize: '1.2rem' }}>
              {sheet.name} <code>{sheet.code}</code>
            </strong>{' '}
            <span class="muted">· {STATION_KIND_LABEL[sheet.kind]}</span>
          </div>
          <p style={{ margin: 0 }}>{where(sheet.id) ? `Appairée : ${roomName(where(sheet.id))}. Touchez une autre pièce pour la déplacer.` : 'Pas encore appairée. Dans quelle pièce est-elle posée ?'}</p>
          {kitPreparation(sheet.id) && <p class="card warn" style={{ margin: 0 }}>À préparer : {kitPreparation(sheet.id)}</p>}
          <div class="grid-buttons">
            {playable.map((r) => (
              <ActButton key={r.id} class={where(sheet.id) === r.id ? 'primary' : ''} disabled={busy} run={async () => void (await done(pairSheet(t, sheet.id, r.id), `${sheet.name} → ${r.name}`, sheet.id))}>
                {r.name}
                {r.floor ? ` (${r.floor})` : ''}
              </ActButton>
            ))}
          </div>
          <form
            class="row"
            onSubmit={(e) => {
              e.preventDefault();
              void createRoom();
            }}
          >
            <input class="grow" placeholder="Nouvelle pièce (ex. Salon)" aria-label="Nouvelle pièce" enterKeyHint="done" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <input style={{ width: '8rem' }} placeholder="Étage" aria-label="Étage de la nouvelle pièce" value={floor} onInput={(e) => setFloor((e.target as HTMLInputElement).value)} />
            <button class="btn primary" type="submit" disabled={!name.trim() || busy}>
              Créer et appairer
            </button>
          </form>
          <div class="row">
            {where(sheet.id) && (
              <ActButton class="small warn" disabled={busy} run={async () => void (await done(pairSheet(t, sheet.id), `${sheet.name} retirée du jeu`))}>
                Retirer cette fiche du jeu
              </ActButton>
            )}
            <button class="btn small" onClick={() => setSel(undefined)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {t.rooms
        .filter((r) => t.stations.some((s) => s.roomId === r.id))
        .map((r) => (
          <div class="row" key={r.id}>
            <strong style={{ minWidth: '9rem' }}>
              📍 {r.name}
              {r.id === t.meetingRoomId ? ' (réunion)' : ''}
            </strong>
            {t.stations
              .filter((s) => s.roomId === r.id)
              .map((s) => (
                <span class="badge" key={s.id}>
                  {s.name}
                  {editable && (
                    <button class="btn link" disabled={busy} title={`Retirer ${s.name} du jeu`} aria-label={`Retirer ${s.name} du jeu`} onClick={() => void done(pairSheet(t, s.id), `${s.name} retirée du jeu`)}>
                      ✕
                    </button>
                  )}
                </span>
              ))}
          </div>
        ))}
    </div>
  );
}
