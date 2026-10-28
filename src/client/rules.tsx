import { marked } from 'marked';
import { useMemo, useState } from 'preact/hooks';
import alertes from '../../docs/alertes-notifications.md?raw';
import equipage from '../../docs/guide-equipage.md?raw';
import limites from '../../docs/limites-mecaniques.md?raw';
import fantomes from '../../docs/guide-fantomes.md?raw';
import imposteurs from '../../docs/guide-imposteurs.md?raw';
import mj from '../../docs/guide-maitre-du-jeu.md?raw';
import reglement from '../../docs/regles-joueurs.md?raw';
import resume from '../../docs/resume-regles.md?raw';
import securite from '../../docs/securite-urgence.md?raw';

// Les règles affichées dans l'application sont exactement les fichiers du dossier docs/ (source unique).
const DOCS = [
  ['Résumé', resume],
  ['Règlement complet', reglement],
  ['Équipage', equipage],
  ['Imposteurs', imposteurs],
  ['Fantômes', fantomes],
  ['Sécurité', securite],
  ['Alertes', alertes],
  ['Maître du jeu', mj],
  ['Adaptations', limites],
] as const;

export function RulesPage() {
  const [i, setI] = useState(0);
  const html = useMemo(() => marked.parse(DOCS[i][1], { async: false }) as string, [i]);
  return (
    <div class="wrap stack">
      <div class="row">
        <button class="btn small" onClick={() => history.back()}>
          ← Retour
        </button>
        <h1 class="grow">Règles</h1>
      </div>
      <div class="row">
        {DOCS.map(([label], k) => (
          <button key={label} class={`btn small ${k === i ? 'primary' : ''}`} onClick={() => setI(k)}>
            {label}
          </button>
        ))}
      </div>
      <article class="card md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
