// Génère les PDF imprimables de la documentation (docs/pdf/) à partir des fichiers Markdown de docs/.
// Usage : npm run docs:pdf  (utilise le Chromium de Playwright installé sur la machine)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { marked } from 'marked';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright est nécessaire : npx playwright install chromium');
  process.exit(1);
}

const DOCS = [
  ['resume-regles', 'Résumé des règles'],
  ['regles-joueurs', 'Règlement complet'],
  ['guide-equipage', 'Guide de l’équipage'],
  ['guide-imposteurs', 'Guide des imposteurs'],
  ['guide-fantomes', 'Guide des fantômes'],
  ['securite-urgence', 'Sécurité et procédure d’urgence'],
  ['guide-maitre-du-jeu', 'Guide du maître du jeu'],
  ['installation-terrain', 'Installation de la maison'],
  ['checklists', 'Checklists'],
  ['taches-et-supports', 'Tâches et supports imprimables'],
  ['alertes-notifications', 'Alertes, sons et notifications'],
  ['limites-mecaniques', 'Mécaniques impossibles en vrai'],
  ['recherche-regles', 'Recherche et matrice des règles'],
  ['conception', 'Conception technique'],
  ['tests', 'Rapport de tests'],
];

const css = `
  body { font: 11pt/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20pt; border-bottom: 3px solid #e2394f; padding-bottom: 4px; }
  h2 { font-size: 14pt; margin-top: 18pt; color: #1b2b5a; }
  h3 { font-size: 12pt; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 8pt 0; }
  th, td { border: 1px solid #999; padding: 3pt 5pt; vertical-align: top; text-align: left; }
  th { background: #eef; }
  code, pre { background: #f2f2f2; font-size: 9pt; }
  pre { padding: 6pt; white-space: pre-wrap; }
  blockquote { border-left: 4px solid #39d5f5; margin: 6pt 0; padding: 2pt 10pt; background: #f4fbfd; }
  li { margin: 2pt 0; }
  .foot { margin-top: 20pt; font-size: 8pt; color: #666; }
`;

const out = new URL('../docs/pdf/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, title] of DOCS) {
  const md = readFileSync(new URL(`../docs/${file}.md`, import.meta.url), 'utf8');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head>
    <body>${marked.parse(md)}<p class="foot">Imposteurs — jeu grandeur nature inspiré d’Among Us (projet de fans, non affilié à Innersloth).</p></body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: `${out}${file}.pdf`, format: 'A4', margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' }, printBackground: true });
  console.log(`docs/pdf/${file}.pdf`);
}
await browser.close();
