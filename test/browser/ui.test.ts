// Test de bout en bout dans de vrais navigateurs (Chromium, écrans de téléphone) contre le serveur local.
// Produit aussi les captures d'écran de la documentation (docs/captures/).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE, Phone, sleep, startServer, stopServer } from '../integration/server';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const SHOTS = new URL('../../docs/captures/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let browser: any;
let gmPage: any;
let gmWs: Phone;
const players: { page: any; name: string; id?: string }[] = [];
let code = '';

const shot = (page: any, name: string) => page.screenshot({ path: `${SHOTS}${name}.png` });
const byText = (page: any, text: string | RegExp) => page.getByText(text).first();

async function noHorizontalScroll(page: any) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw + 1);
}

beforeAll(async () => {
  await startServer();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  gmWs?.close();
  await stopServer();
});

describe('interface sur téléphone', () => {
  it('le MJ crée une partie et 5 téléphones rejoignent via le lien', async () => {
    const gmCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    gmPage = await gmCtx.newPage();
    gmPage.on('dialog', (d: any) => d.accept());
    await gmPage.goto(`${BASE}/`);
    await shot(gmPage, '01-accueil-ordinateur');
    await gmPage.getByRole('button', { name: 'Maître du jeu' }).click();
    await gmPage.getByRole('button', { name: /Créer une nouvelle partie/ }).click();
    await gmPage.waitForURL(/#\/gm/);
    await byText(gmPage, 'Invitation').waitFor();
    code = (await gmPage.locator('.big-code').first().textContent()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const token = await gmPage.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.gm')!).token);
    gmWs = await new Phone(code).open();
    await gmWs.hello(token);

    const names = ['Alice', 'Bilal', 'Chloé', 'Dmitri', 'Emma'];
    for (const name of names) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'] });
      const page = await ctx.newPage();
      page.on('dialog', (d: any) => d.accept());
      await page.goto(`${BASE}/#/j/${code}`);
      await page.getByPlaceholder('ex. Lucie').fill(name);
      await page.getByRole('button', { name: 'Entrer dans le salon' }).click();
      await byText(page, 'Vous êtes dans le salon').waitFor();
      players.push({ page, name });
    }
    await gmWs.waitState((s) => s.players.length === 5);
    for (const p of players) p.id = gmWs.state.players.find((x: any) => x.name === p.name).id;
    await shot(players[0].page, '02-salon-telephone');
    await noHorizontalScroll(players[0].page);
    await byText(gmPage, '5 joueur(s)').waitFor();
    await shot(gmPage, '03-mj-salon');
  }, 120_000);

  it('le MJ règle les paramètres depuis l’interface puis démarre', async () => {
    await gmPage.getByRole('button', { name: 'Paramètres' }).click();
    await gmPage.getByLabel(/Nombre d’imposteurs/).fill('1');
    await gmPage.getByLabel(/Délai avant la 1re élimination/).fill('5');
    await gmPage.getByLabel(/Temps de discussion/).fill('0');
    await gmPage.getByRole('button', { name: 'Enregistrer' }).click();
    await gmWs.waitState((s) => s.settings.impostors === 1 && s.settings.discussionSec === 0);
    await shot(gmPage, '04-mj-parametres');
    await gmPage.getByRole('button', { name: 'Partie' }).click();
    await gmPage.getByRole('button', { name: /Démarrer la partie/ }).click();
    await gmWs.waitState((s) => s.phase === 'playing');
    for (const p of players) {
      await byText(p.page, 'Touchez ici pour découvrir votre rôle').waitFor();
    }
    await shot(players[0].page, '05-revelation-voile');
    for (const p of players) {
      await p.page.locator('button.veil').click();
      await p.page.getByRole('button', { name: /J’ai compris/ }).click();
      await byText(p.page, 'Mes tâches').waitFor();
    }
    const imp = players.find((p) => gmWs.state.players.find((x: any) => x.id === p.id).role === 'impostor')!;
    const crew = players.find((p) => p !== imp)!;
    await shot(crew.page, '06-taches-equipage');
    await noHorizontalScroll(crew.page);
    // la page d'un équipier ne contient jamais le mot IMPOSTEUR attribué à quelqu'un d'autre
    const html = await crew.page.content();
    expect(html).not.toContain(imp.name + ' (imposteur)');
  }, 60_000);

  it('un équipier accomplit une tâche en saisissant le code du poste', async () => {
    const crew = players.filter((p) => gmWs.state.players.find((x: any) => x.id === p.id).role === 'crewmate');
    const easy = ['order', 'swipe', 'wait', 'count', 'assemble', 'slider', 'targets'];
    let chosen: { p: (typeof players)[0]; task: any; def: any; st: any } | undefined;
    for (const p of crew) {
      for (const t of gmWs.state.players.find((x: any) => x.id === p.id).tasks) {
        const def = gmWs.state.terrain.tasks.find((d: any) => d.id === t.taskId);
        if (def.steps.length === 1 && easy.includes(def.steps[0].game)) {
          chosen = { p, task: t, def, st: gmWs.state.terrain.stations.find((s: any) => s.id === def.steps[0].stationId) };
          break;
        }
      }
      if (chosen) break;
    }
    expect(chosen).toBeDefined();
    const { p, def, st } = chosen!;
    const page = p.page;
    await page.getByRole('button', { name: /Poste/ }).click();
    await page.locator('input.code').fill(st.code);
    await page.getByRole('button', { name: 'Valider le code' }).click();
    await byText(page, st.name).waitFor();
    await shot(page, '07-poste-scanne');
    await page.getByRole('button', { name: new RegExp(def.name) }).click();
    await page.locator('.overlay').waitFor();
    await shot(page, `08-mini-jeu-${def.steps[0].game}`);
    const game = def.steps[0].game;
    if (game === 'order') for (let n = 1; n <= 10; n++) await page.locator('.order button', { hasText: new RegExp(`^${n}$`) }).click();
    else if (game === 'targets') for (let n = 0; n < 8; n++) await page.locator('.arena .t').click();
    else if (game === 'slider') {
      const target = await page.evaluate(() => parseFloat((document.querySelector('.target-mark') as HTMLElement).style.left));
      await page.locator('input[type=range]').evaluate((el: HTMLInputElement, v: number) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, target);
      await page.getByRole('button', { name: 'Valider' }).click();
    } else if (game === 'count' || game === 'assemble') {
      const { countPuzzle, assemblePuzzle } = await import('../../src/shared/puzzles');
      const ans = game === 'count' ? countPuzzle(def.seed).answer : assemblePuzzle(def.seed).answer;
      await page.locator('.overlay input.code').fill(ans);
      await page.getByRole('button', { name: 'Valider' }).click();
    } else if (game === 'swipe') {
      const box = await page.locator('.swipe-slot').boundingBox();
      await page.mouse.move(box.x + 40, box.y + 40);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(box.x + 40 + (box.width * i) / 20, box.y + 40);
        await sleep(45);
      }
      await page.mouse.up();
    }
    // 'wait' se termine seul
    await byText(page, /Tâche terminée/).waitFor({ timeout: 20_000 });
    await gmWs.waitState((s) => s.taskBar.done === 1);
  }, 60_000);

  it('élimination par code, corps signalé, réunion et vote dans les navigateurs', async () => {
    const imp = players.find((p) => gmWs.state.players.find((x: any) => x.id === p.id).role === 'impostor')!;
    const crew = players.filter((p) => p !== imp);
    const [victim, reporter] = crew;
    await sleep(5_500);
    await imp.page.getByRole('button', { name: /Rôle/ }).click();
    await imp.page.locator('button.veil').click();
    await shot(imp.page, '09-role-imposteur');
    await imp.page.getByRole('button', { name: /Préparer un code d’élimination/ }).click();
    const killCode = (await imp.page.locator('.modal .big-code').textContent()).trim();
    await shot(imp.page, '10-code-elimination');
    await victim.page.getByRole('button', { name: /Urgence/ }).click();
    await victim.page.getByLabel('Code montré par l’imposteur').fill(killCode);
    await victim.page.getByRole('button', { name: 'Je suis éliminé·e' }).click();
    await byText(victim.page, 'Vous avez été éliminé·e').waitFor();
    const bodyCode = (await victim.page.locator('.big-code').textContent()).trim();
    await shot(victim.page, '11-corps');
    await reporter.page.getByRole('button', { name: /Urgence/ }).click();
    await shot(reporter.page, '12-onglet-urgence');
    await reporter.page.getByLabel('Code affiché sur le téléphone du corps').fill(bodyCode);
    await reporter.page.getByRole('button', { name: 'Signaler le corps' }).click();
    for (const p of players) await byText(p.page, 'Corps signalé').waitFor();
    await shot(crew[2].page, '13-reunion-rassemblement');
    for (const p of players.filter((x) => x !== victim)) await p.page.getByRole('button', { name: 'Je suis arrivé·e' }).click();
    await gmWs.waitState((s) => s.meeting?.stage === 'voting');
    await byText(crew[2].page, 'Votez').waitFor();
    // tout le monde vote contre l'imposteur
    for (const p of players.filter((x) => x !== victim)) {
      const row = p.page.locator('li', { hasText: imp.name });
      if (p === imp) await p.page.getByRole('button', { name: /Passer \(ne pas éjecter\)/ }).click();
      else await row.getByRole('button', { name: 'Voter' }).click();
      await p.page.getByRole('button', { name: 'Confirmer' }).click();
      if (p === crew[2]) await shot(p.page, '14-vote');
    }
    await byText(crew[2].page, `${imp.name} était un imposteur`).waitFor();
    await shot(crew[2].page, '15-resultat-vote');
    await byText(crew[2].page, 'Victoire de l’équipage').waitFor({ timeout: 15_000 });
    await shot(crew[2].page, '16-fin-de-partie');
    await byText(gmPage, 'Victoire de l’équipage').waitFor();
    await shot(gmPage, '17-mj-fin');
  }, 90_000);

  it('rechargement, pause et arrêt d’urgence, nouvelle partie', async () => {
    await gmPage.getByRole('button', { name: /Nouvelle partie/ }).click();
    for (const p of players) await byText(p.page, 'Vous êtes dans le salon').waitFor();
    await gmPage.getByRole('button', { name: /Démarrer la partie/ }).click();
    const p = players[1];
    await p.page.locator('button.veil').click();
    await p.page.getByRole('button', { name: /J’ai compris/ }).click();
    const roleBefore = gmWs.state.players.find((x: any) => x.id === p.id).role;
    await p.page.reload();
    await byText(p.page, 'Mes tâches').waitFor();
    await p.page.getByRole('button', { name: /Rôle/ }).click();
    await p.page.locator('button.veil').click();
    await byText(p.page, roleBefore === 'impostor' ? 'IMPOSTEUR' : 'ÉQUIPAGE').waitFor();
    await gmPage.getByRole('button', { name: /Pause générale/ }).click();
    await byText(p.page, 'Le maître du jeu a mis la partie en pause').waitFor();
    await shot(p.page, '18-pause');
    await gmPage.getByRole('button', { name: /ARRÊT D’URGENCE/ }).click();
    await byText(p.page, 'Arrêt d’urgence').waitFor();
    await shot(p.page, '19-arret-urgence');
    await gmPage.getByRole('button', { name: /Reprendre/ }).click();
    await p.page.locator('.stop').waitFor({ state: 'detached' });
    await p.page.locator('.pause').waitFor({ state: 'detached' });
    await gmPage.getByRole('button', { name: /Joueurs/ }).click();
    await shot(gmPage, '20-mj-joueurs');
  }, 60_000);

  it('petit écran (360×640) : pas de défilement horizontal', async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await noHorizontalScroll(page);
    await shot(page, '21-accueil-petit-ecran');
    await page.goto(`${BASE}/#/regles`);
    await byText(page, 'Règles').waitFor();
    await noHorizontalScroll(page);
    await ctx.close();
  });

  it('supports imprimables : génération du PDF d’exemple', async () => {
    await gmPage.goto(`${BASE}/#/print`);
    await byText(gmPage, 'Rejoignez la partie').waitFor();
    await gmPage.waitForTimeout(800);
    await gmPage.emulateMedia({ media: 'print' });
    await gmPage.pdf({ path: new URL('../../docs/pdf/exemple-supports-imprimables.pdf', import.meta.url).pathname, format: 'A4', printBackground: true });
    await gmPage.emulateMedia({ media: 'screen' });
  }, 60_000);
});
