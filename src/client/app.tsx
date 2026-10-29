import { useEffect, useState } from 'preact/hooks';
import { GAME_CODE_RE } from '../shared/protocol';
import { gmConn, go, playerConn, startGmConn, startPlayerConn } from './conn';
import { GmApp } from './gm';
import { PlayerApp } from './player';
import { KitPrintPage } from './kit-print';
import { RulesPage } from './rules';
import { sessions, storageAvailable } from './session';
import { isIOS, isStandalone } from './alerts';
import { Collapse, ConfirmHost, toast, Toasts, unlockAudio } from './ui';

function useHash(): string {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setH(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

export function App() {
  const h = useHash();
  let page;
  if (h.startsWith('/s/') || h.startsWith('/c/')) {
    // QR code d'un poste (/s/) ou d'un corps (/c/) lu avec l'appareil photo du téléphone
    sessionStorage.setItem('imposteurs.pendingScan', h.startsWith('/c/') ? `c:${h.slice(3)}` : h.slice(3));
    go(sessions.player() ? '/play' : '/');
    page = null;
  } else if (h === '/play') {
    const c = playerConn();
    page = c ? <PlayerApp conn={c} /> : <Home />;
  } else if (h === '/gm') {
    const c = gmConn();
    page = c ? <GmApp conn={c} /> : <Home />;
  } else if (h === '/kit' || h === '/print') {
    page = <KitPrintPage />;
  } else if (h.startsWith('/regles')) {
    page = <RulesPage />;
  } else if (h.startsWith('/j/')) {
    page = <Home presetCode={h.slice(3)} />;
  } else page = <Home />;
  return (
    <>
      {page}
      <Toasts />
      <ConfirmHost />
    </>
  );
}

function Home({ presetCode }: { presetCode?: string }) {
  const ps = sessions.player();
  const gs = sessions.gm();
  const [mode, setMode] = useState<'join' | 'gm' | 'reclaim' | undefined>(presetCode ? 'join' : undefined);
  return (
    <div class="wrap stack">
      <div class="center" style={{ paddingTop: '8px' }}>
        <img src="/icons/icon.svg" alt="" width={76} height={76} />
        <h1 style={{ fontSize: '2rem', margin: '4px 0 0' }}>IMPOSTEURS</h1>
        <p class="muted" style={{ marginTop: 0 }}>
          Le jeu de rôles cachés grandeur nature, inspiré d’Among Us.
        </p>
      </div>
      {!storageAvailable() && <p class="card warn">Votre navigateur bloque le stockage local (navigation privée ?) : en cas de rechargement, demandez un code de reconnexion au maître du jeu.</p>}
      {ps && (
        <a class="btn big block crew" href="#/play">
          ▶ Reprendre ma partie ({ps.code})
        </a>
      )}
      {gs && (
        <a class="btn big block" href="#/gm">
          🎬 Mon tableau de bord MJ ({gs.code})
        </a>
      )}
      {!mode && (
        <div class="stack">
          <button class="btn big block primary action" onClick={() => setMode('join')}>
            <span>🙋</span> Je rejoins une partie
          </button>
          <button class="btn big block action" onClick={() => setMode('gm')}>
            <span>🎬</span> J’organise (maître du jeu)
          </button>
        </div>
      )}
      {mode && (
        <button class="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => setMode(undefined)}>
          ← Retour
        </button>
      )}
      {mode === 'join' && <JoinForm preset={presetCode} />}
      {mode === 'gm' && <GmForms />}
      {mode === 'reclaim' && <ReclaimForm />}
      {mode !== 'reclaim' && (
        <button class="btn link" onClick={() => setMode('reclaim')}>
          J’ai changé de téléphone / perdu ma session
        </button>
      )}
      <InstallHint />
      <a class="btn block" href="#/regles">
        📖 Règles du jeu
      </a>
      <p class="muted center" style={{ fontSize: '0.85rem' }}>
        Aucun compte, aucune publicité. Seul un identifiant aléatoire de session est gardé sur ce téléphone. Projet de fans non affilié à Innersloth.
      </p>
    </div>
  );
}

let installEvent: (Event & { prompt: () => Promise<void> }) | undefined;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as typeof installEvent;
});

function InstallHint() {
  if (isStandalone()) return null;
  return (
    <Collapse title="📲 Installer l’application (facultatif)">
      <p style={{ margin: 0 }}>Une icône sur l’écran d’accueil ouvre le jeu en plein écran et permet de recevoir les notifications quand l’écran est verrouillé.</p>
      {isIOS() ? (
        <p style={{ margin: 0 }}>
          <strong>iPhone / iPad (Safari)</strong> : touchez <strong>Partager</strong> (carré avec une flèche) → <strong>Sur l’écran d’accueil</strong> → Ajouter. Ouvrez ensuite le jeu depuis l’icône.
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            <strong>Android (Chrome)</strong> : menu <strong>⋮</strong> → <strong>Installer l’application</strong> (ou « Ajouter à l’écran d’accueil »).
          </p>
          <button
            class="btn"
            onClick={async () => {
              if (installEvent) await installEvent.prompt();
              else toast('Utilisez le menu du navigateur : « Installer l’application ».', 'info');
            }}
          >
            Installer maintenant
          </button>
        </>
      )}
    </Collapse>
  );
}

async function gameInfo(code: string): Promise<{ exists: boolean; phase?: string; locked?: boolean }> {
  try {
    const r = await fetch(`/api/games/${code}/info`);
    return await r.json();
  } catch {
    return { exists: false };
  }
}

function JoinForm({ preset }: { preset?: string }) {
  const [code, setCode] = useState(normalizeGame(preset ?? ''));
  const [fromLink, setFromLink] = useState(GAME_CODE_RE.test(normalizeGame(preset ?? '')));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <form
      class="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        unlockAudio();
        setErr(undefined);
        const c = normalizeGame(code);
        if (!GAME_CODE_RE.test(c)) return setErr('Le code de partie fait 6 caractères.');
        setBusy(true);
        const info = await gameInfo(c);
        if (!info.exists) {
          setBusy(false);
          return setErr('Aucune partie avec ce code.');
        }
        if (info.phase !== 'lobby') {
          setBusy(false);
          return setErr('La partie a déjà commencé. Si vous en faisiez partie, utilisez « Récupérer ma session » avec un code donné par le maître du jeu.');
        }
        const conn = startPlayerConn(c, { kind: 'join', name: name.trim() });
        const prev = conn.onAuthFailed;
        const off = conn.store.subscribe((s) => {
          if (s.view) {
            off();
            conn.onAuthFailed = prev;
            setBusy(false);
            go('/play');
          }
        });
        conn.onAuthFailed = (_code, msg) => {
          off();
          conn.close();
          setBusy(false);
          setErr(msg);
        };
      }}
    >
      <h2 style={{ margin: 0 }}>{fromLink ? `Rejoindre la partie ${code}` : 'Rejoindre une partie'}</h2>
      {fromLink ? (
        <button type="button" class="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => setFromLink(false)}>
          Ce n’est pas le bon code ?
        </button>
      ) : (
        <label class="field">
          <span>Code de la partie (6 caractères, sur l’affiche)</span>
          <input class="code" value={code} maxLength={6} autoComplete="off" autoCapitalize="characters" onInput={(e) => setCode(normalizeGame((e.target as HTMLInputElement).value))} />
        </label>
      )}
      <label class="field">
        <span>Votre pseudonyme (visible par tous, 2 à 16 caractères)</span>
        <input class="name-input" value={name} maxLength={16} autoFocus={fromLink} autoComplete="nickname" enterKeyHint="go" onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="ex. Lucie" />
      </label>
      {err && <p class="card danger">{err}</p>}
      <button class="btn big block primary" disabled={busy || name.trim().length < 2 || code.length !== 6}>
        {busy ? 'Connexion…' : 'Entrer dans le salon'}
      </button>
    </form>
  );
}

function normalizeGame(s: string) {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function GmForms() {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string>();
  return (
    <>
      <div class="card stack">
        <h2 style={{ margin: 0 }}>Préparer une partie</h2>
        <ol class="steps prep">
          <li>
            <span class="dot">1</span>
            <div class="grow stack">
              <span>
                <strong>Imprimer le kit de fiches</strong> : une seule fois, il resservira pour toutes vos parties, dans n’importe quelle maison.
              </span>
              <a class="btn block" href="#/kit">
                🖨 Imprimer le kit
              </a>
            </div>
          </li>
          <li>
            <span class="dot">2</span>
            <div class="grow stack">
              <span>
                <strong>Créer la partie</strong> : vous êtes le maître du jeu (vous ne jouez pas).
              </span>
              <button
                class="btn big block primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await fetch('/api/games', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ settings: sessions.settings() }),
                    });
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.error ?? 'Erreur');
                    sessions.setGm({ code: d.code, token: d.gmToken, secret: d.gmSecret });
                    startGmConn(d.code, { kind: 'token', token: d.gmToken }, d.gmSecret);
                    go('/gm');
                  } catch (e) {
                    toast(`Création impossible : ${(e as Error).message}. Vérifiez la connexion.`, 'err');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Création…' : '＋ Créer une nouvelle partie'}
              </button>
            </div>
          </li>
          <li>
            <span class="dot">3</span>
            <div class="grow">
              <strong>Poser et appairer les fiches</strong> : une fiche « Poste » par pièce, le bouton d’urgence dans la salle de réunion. Puis, dans votre tableau de bord, onglet Terrain → « 📷 Appairer des fiches » : scannez chaque fiche et touchez sa
              pièce. Une fiche non appairée n’existe pas pour le jeu.
            </div>
          </li>
          <li>
            <span class="dot">4</span>
            <div class="grow">
              <strong>Inviter les joueurs</strong> : ils scannent le QR code affiché sur votre tableau de bord (ou tapent son code).
            </div>
          </li>
          <li>
            <span class="dot">5</span>
            <div class="grow">
              <strong>Tester et démarrer</strong> : l’onglet Partie du tableau de bord vous guide (tests des fiches, réglages, sécurité, démarrage).
            </div>
          </li>
        </ol>
      </div>
      <form
        class="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(undefined);
          const c = normalizeGame(code);
          const conn = startGmConn(c, { kind: 'gmLogin', secret }, secret);
          const prev = conn.onAuthFailed;
          const off = conn.store.subscribe((s) => {
            if (s.view) {
              off();
              conn.onAuthFailed = prev;
              go('/gm');
            }
          });
          conn.onAuthFailed = (_c, msg) => {
            off();
            conn.close();
            setErr(msg);
          };
        }}
      >
        <h2>Reprendre une partie sur cet appareil</h2>
        <label class="field">
          <span>Code de la partie</span>
          <input class="code" value={code} maxLength={6} onInput={(e) => setCode(normalizeGame((e.target as HTMLInputElement).value))} />
        </label>
        <label class="field">
          <span>Code maître du jeu (affiché à la création)</span>
          <input class="code" value={secret} maxLength={9} onInput={(e) => setSecret((e.target as HTMLInputElement).value.toUpperCase())} />
        </label>
        {err && <p class="card danger">{err}</p>}
        <button class="btn block" disabled={code.length !== 6 || secret.length < 8}>
          Ouvrir le tableau de bord
        </button>
      </form>
    </>
  );
}

function ReclaimForm() {
  const [code, setCode] = useState('');
  const [rc, setRc] = useState('');
  const [err, setErr] = useState<string>();
  return (
    <form
      class="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(undefined);
        const c = normalizeGame(code);
        const conn = startPlayerConn(c, { kind: 'reclaim', code: rc.replace(/[^A-Z0-9]/g, '') });
        const prev = conn.onAuthFailed;
        const off = conn.store.subscribe((s) => {
          if (s.view) {
            off();
            conn.onAuthFailed = prev;
            go('/play');
          }
        });
        conn.onAuthFailed = (_c, msg) => {
          off();
          conn.close();
          setErr(msg);
        };
      }}
    >
      <h2>Récupérer ma session</h2>
      <p class="muted">Vous avez changé de téléphone ou effacé votre navigateur ? Demandez un code de reconnexion au maître du jeu.</p>
      <label class="field">
        <span>Code de la partie</span>
        <input class="code" value={code} maxLength={6} onInput={(e) => setCode(normalizeGame((e.target as HTMLInputElement).value))} />
      </label>
      <label class="field">
        <span>Code de reconnexion</span>
        <input class="code" value={rc} maxLength={6} onInput={(e) => setRc((e.target as HTMLInputElement).value.toUpperCase())} />
      </label>
      {err && <p class="card danger">{err}</p>}
      <button class="btn block primary" disabled={code.length !== 6 || rc.length < 6}>
        Récupérer
      </button>
    </form>
  );
}
