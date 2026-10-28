// Onglet « Tests » du maître du jeu : vérifier, avant la partie, que chaque fiche, chaque tâche,
// chaque réparation et les alertes fonctionnent réellement — en passant par le serveur, sans toucher à la partie.

import { useEffect, useState } from 'preact/hooks';
import { FIXES, GAMES, STATION_KIND_LABEL } from '../shared/catalog';
import { normalizeCode } from '../shared/rng';
import type { FixKind, Station } from '../shared/types';
import type { GmView } from '../shared/view';
import { gameInfo } from './games';
import type { Connection } from './net';
import { ChallengeBody } from './player';
import { Scanner } from './scanner';
import { ActButton, Collapse, toast } from './ui';

type Conn = Connection<GmView>;

const key = (code: string) => `imposteurs.tested.${code}`;
function readTested(code: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(code)) ?? '[]'));
  } catch {
    return new Set();
  }
}
function writeTested(code: string, s: Set<string>) {
  try {
    localStorage.setItem(key(code), JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Toutes les vérifications attendues : chaque étape de chaque tâche active + les 3 réparations disponibles. */
export function allChecks(v: GmView): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const t of v.terrain.tasks.filter((x) => x.enabled)) t.steps.forEach((s, i) => out.push({ id: `${t.id}:${i}:${s.game}:${s.stationId}`, label: `${t.name} — étape ${i + 1}` }));
  for (const [k, st] of [['switches', 'lights'], ['tune', 'comms'], ['pin', 'oxygen']] as const) {
    if (v.terrain.stations.some((s) => s.kind === st)) out.push({ id: `fix:${k}`, label: FIXES[k].label });
  }
  return out;
}

export function testedCount(v: GmView) {
  const t = readTested(v.code);
  const all = allChecks(v);
  return { done: all.filter((c) => t.has(c.id)).length, total: all.length };
}

export function GmTests({ v, conn }: { v: GmView; conn: Conn }) {
  const [tested, setTested] = useState(() => readTested(v.code));
  const [pending, setPending] = useState<string>();
  const [scanned, setScanned] = useState<Station>();
  const checks = allChecks(v);
  const done = checks.filter((c) => tested.has(c.id)).length;
  const mark = (id: string) => {
    const n = new Set(tested);
    n.add(id);
    setTested(n);
    writeTested(v.code, n);
  };
  const start = async (id: string, a: object) => {
    const r = await conn.act(a);
    if (r.ok) setPending(id);
    return r;
  };
  const stationTasks = (s: Station) => v.terrain.tasks.filter((t) => t.enabled && t.steps.some((st) => st.stationId === s.id));
  const room = (id: string) => v.terrain.rooms.find((r) => r.id === id)?.name ?? '?';
  const players = v.players.filter((p) => !p.kicked && !p.left);

  return (
    <div class="stack">
      <div class="card stack">
        <div class="row">
          <h2 class="grow" style={{ margin: 0 }}>
            🧪 Tester avant la partie
          </h2>
          <span class={`badge ${done === checks.length ? 'crew' : 'warn'}`}>
            {done}/{checks.length} vérifiés
          </span>
        </div>
        <p class="muted" style={{ margin: 0 }}>
          Chaque test lance le vrai mini-jeu, vérifié par le serveur, sans aucun effet sur la partie. Pour les énigmes papier, la réponse attendue est affichée : comparez-la à la fiche imprimée.
        </p>
      </div>

      <div class="card stack">
        <h3 style={{ margin: 0 }}>🔔 Alertes des téléphones</h3>
        <p style={{ margin: 0 }}>
          {players.filter((p) => p.connected).length}/{players.length} joueurs connectés · {players.filter((p) => p.push).length} avec notifications écran verrouillé.
        </p>
        <ActButton class="block primary" run={() => conn.act({ type: 'ping' })} okMsg="Test envoyé : les téléphones ouverts sonnent, les autres reçoivent une notification.">
          Faire sonner tous les téléphones
        </ActButton>
        <small class="muted">Demandez à chacun de lever la main quand son téléphone sonne : ceux qui ne sonnent pas doivent régler leurs alertes (salon → « Alertes de ce téléphone »).</small>
      </div>

      <Collapse title="🔍 Vérifier une fiche posée dans la maison" open>
        <p class="muted" style={{ margin: 0 }}>
          Scannez le QR code d’une fiche : l’application indique le poste correspondant et ce qu’on peut y tester.
        </p>
        <Scanner
          manualLabel="Code imprimé sur la fiche"
          onCode={async (raw) => {
            const c = normalizeCode(raw);
            const s = v.terrain.stations.find((x) => x.code === c);
            if (!s) {
              toast(`Code ${c} inconnu : cette fiche ne correspond pas au terrain enregistré (réimprimez-la).`, 'err');
              return false;
            }
            setScanned(s);
            toast(`Fiche correcte : ${s.name} (${room(s.roomId)})`, 'ok');
            return true;
          }}
        />
        {scanned && (
          <div class="card alt stack">
            <strong>
              ✔ {scanned.name} — {room(scanned.roomId)} ({STATION_KIND_LABEL[scanned.kind]})
            </strong>
            {stationTasks(scanned).flatMap((t) =>
              t.steps.map((st, i) =>
                st.stationId === scanned.id ? (
                  <ActButton key={`${t.id}${i}`} class="small" run={() => start(`${t.id}:${i}:${st.game}:${st.stationId}`, { type: 'testTask', taskId: t.id, stepIndex: i })}>
                    Tester « {t.name} » ({GAMES[st.game].label})
                  </ActButton>
                ) : null,
              ),
            )}
          </div>
        )}
      </Collapse>

      <div class="card stack">
        <div class="row">
          <h3 class="grow" style={{ margin: 0 }}>
            📋 Toutes les tâches
          </h3>
          <button
            class="btn small"
            onClick={() => {
              const n = new Set<string>();
              setTested(n);
              writeTested(v.code, n);
            }}
          >
            Remettre à zéro
          </button>
        </div>
        {v.terrain.stations
          .filter((s) => s.kind === 'task' && stationTasks(s).length > 0)
          .map((s) => (
            <div key={s.id}>
              <h4 class="room-title">
                📍 {room(s.roomId)} · {s.name} <code>{s.code}</code>
              </h4>
              <ul class="list">
                {stationTasks(s).flatMap((t) =>
                  t.steps.map((st, i) => {
                    if (st.stationId !== s.id) return null;
                    const id = `${t.id}:${i}:${st.game}:${st.stationId}`;
                    return (
                      <li key={id}>
                        <span>{tested.has(id) ? '✅' : '⬜'}</span>
                        <span class="grow">
                          {t.name}
                          {t.steps.length > 1 ? ` (étape ${i + 1}/${t.steps.length})` : ''} <small class="muted">{GAMES[st.game].label}</small>
                        </span>
                        <ActButton class="small" run={() => start(id, { type: 'testTask', taskId: t.id, stepIndex: i })}>
                          Tester
                        </ActButton>
                      </li>
                    );
                  }),
                )}
              </ul>
            </div>
          ))}
        {v.terrain.tasks.some((t) => t.enabled) ? null : <p>Aucune tâche active : configurez le terrain.</p>}
      </div>

      <div class="card stack">
        <h3 style={{ margin: 0 }}>🔧 Réparations des sabotages</h3>
        <ul class="list">
          {(['switches', 'tune', 'pin'] as FixKind[]).map((k) => {
            const id = `fix:${k}`;
            if (!checks.some((c) => c.id === id)) return null;
            return (
              <li key={k}>
                <span>{tested.has(id) ? '✅' : '⬜'}</span>
                <span class="grow">{FIXES[k].label}</span>
                <ActButton class="small" run={() => start(id, { type: 'testFix', kind: k })}>
                  Tester
                </ActButton>
              </li>
            );
          })}
        </ul>
        <small class="muted">Le réacteur se teste à deux pendant une partie d’essai : il faut deux téléphones de joueurs vivants qui maintiennent le bouton en même temps.</small>
      </div>

      {v.gmChallenge && <TestOverlay v={v} conn={conn} onPassed={() => pending && mark(pending)} />}
    </div>
  );
}

function TestOverlay({ v, conn, onPassed }: { v: GmView; conn: Conn; onPassed: () => void }) {
  const c = v.gmChallenge!;
  const info = gameInfo(c.game);
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(false), [c.id]);
  return (
    <div class="overlay" style={{ zIndex: 70 }}>
      <div class="wrap stack">
        <div>
          <small class="muted">Test du MJ · {c.stationName || 'poste'} · aucun effet sur la partie</small>
          <h2 style={{ margin: 0 }}>{c.taskName}</h2>
        </div>
        <p class="hint">{info?.hint}</p>
        {c.expected && (
          <p class="card warn" style={{ margin: 0 }}>
            Réponse attendue (à vérifier sur la fiche imprimée) : <span class="answer">{c.expected}</span>
          </p>
        )}
        {!ok && (
          <ChallengeBody
            c={c}
            serverNow={() => conn.serverNow()}
            submit={async (answer) => {
              const r = await conn.act({ type: 'testSubmit', challengeId: c.id, answer });
              if (!r.ok) {
                toast(r.msg ?? 'Refusé', 'err');
                return false;
              }
              setOk(true);
              onPassed();
              toast('Fonctionne : réponse validée par le serveur.', 'ok');
              return true;
            }}
          />
        )}
        <ActButton class="block" run={() => conn.act({ type: 'testCancel' })}>
          Fermer le test
        </ActButton>
      </div>
    </div>
  );
}
