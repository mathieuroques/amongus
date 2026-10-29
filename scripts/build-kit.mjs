// Génère le PDF du kit de fiches universel (docs/pdf/kit-fiches.pdf) depuis la page « #/kit » du site construit.
// Les fiches ne dépendent ni de la partie ni de l'adresse du site (QR codes = code seul) : ce PDF reste valable.
// Usage : npm run kit:pdf  (construit le site, puis utilise le Chromium de Playwright installé sur la machine)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright est nécessaire : npx playwright install chromium');
  process.exit(1);
}

const dist = new URL('../dist/', import.meta.url).pathname;
if (!existsSync(join(dist, 'index.html'))) {
  console.error('Site non construit : lancez d’abord « npm run build ».');
  process.exit(1);
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
// petit serveur de fichiers statiques : la page « #/kit » n'a besoin d'aucun serveur de jeu
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/#/kit`);
await page.getByText('Mode d’emploi du maître du jeu').first().waitFor();
// l'affiche d'invitation contient l'adresse du site : elle s'imprime depuis votre site, pas depuis ce PDF
await page.getByLabel(/Affiche d’invitation/).uncheck();
await page.waitForFunction(() => document.querySelectorAll('.printroot .qr svg').length >= 48);
await page.emulateMedia({ media: 'print' });
const out = new URL('../docs/pdf/kit-fiches.pdf', import.meta.url).pathname;
await page.pdf({ path: out, format: 'A4', printBackground: true });
console.log('docs/pdf/kit-fiches.pdf');
await browser.close();
server.close();
