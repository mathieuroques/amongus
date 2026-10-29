// Application installée sur iPhone (plein écran) : l'encoche, la caméra / Face ID occupent le haut de l'écran
// et la barre d'accueil le bas. Chromium ne simule pas ces zones : on impose leur taille (variables --sat / --sab,
// qui valent env(safe-area-inset-*) sur un vrai téléphone) et on vérifie, écran par écran, qu'aucun bouton,
// lien ou champ n'est dessous, y compris après défilement et dans les écrans plein écran.
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kitSheet } from '../../src/shared/kit';
import { exampleTerrain } from '../fixtures';
import { BASE, Phone, startServer, stopServer } from '../integration/server';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const TOP = 59; // Dynamic Island d'un iPhone récent (le pire cas), en pixels CSS
const BOTTOM = 34;

let browser: any;
let gmWs: Phone;
let code = '';
const errors: string[] = [];

async function phone(label: string) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(([t, b]: number[]) => {
    const set = () => {
      document.documentElement.style.setProperty('--sat', `${t}px`);
      document.documentElement.style.setProperty('--sab', `${b}px`);
    };
    if (document.documentElement) set();
    document.addEventListener('DOMContentLoaded', set);
  }, [TOP, BOTTOM]);
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d: any) => void d.accept());
  return page;
}

/**
 * Aucun élément interactif visible ne doit être sous l'encoche ni sous la barre d'accueil quand il est
 * fixe ou collant ; en haut de page, rien du tout sous l'encoche. Vérifié en haut puis tout en bas de la page.
 */
async function clearOfNotch(page: any, what: string) {
  await page.waitForTimeout(150);
  const check = (atTop: boolean) =>
    page.evaluate(
      ([top, bottom, atTop]: [number, number, boolean]) => {
        const bad: string[] = [];
        const h = window.innerHeight;
        const pinned = (el: Element | null): boolean => {
          for (let e = el; e && e !== document.body; e = e.parentElement) {
            const p = getComputedStyle(e).position;
            if (p === 'fixed' || p === 'sticky') return true;
          }
          return false;
        };
        for (const el of document.querySelectorAll('button, a[href], input, select, textarea, summary, label.check')) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || r.bottom <= 0 || r.top >= h) continue;
          if (el.closest('details:not([open])') && el.tagName !== 'SUMMARY') continue;
          const name = `${el.tagName.toLowerCase()} « ${(el.textContent || (el as HTMLInputElement).placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 40)} »`;
          if ((atTop || pinned(el)) && r.top < top - 0.5) bad.push(`${name} sous l’encoche (haut à ${Math.round(r.top)} px)`);
          if (pinned(el) && r.bottom > h - bottom + 0.5) bad.push(`${name} sous la barre d’accueil (bas à ${Math.round(r.bottom)} px sur ${h})`);
        }
        return bad;
      },
      [TOP, BOTTOM, atTop],
    );
  // les écrans plein écran ont leur propre défilement : on fait défiler la page et chacun d'eux
  const scrollAll = (y: 'top' | 'bottom') =>
    page.evaluate((y: string) => {
      const targets = [document.scrollingElement!, ...document.querySelectorAll('.overlay, .modal, .stop, .pause, .alert-screen')] as HTMLElement[];
      for (const t of targets) t.scrollTop = y === 'top' ? 0 : t.scrollHeight;
    }, y);
  await scrollAll('top');
  const top = await check(true);
  await scrollAll('bottom');
  const bottom = await check(false);
  await scrollAll('top');
  expect([...new Set([...top, ...bottom])], what).toEqual([]);
}

beforeAll(async () => {
  await startServer();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  gmWs?.close();
  await browser?.close();
  await stopServer();
});

describe('iPhone en plein écran : rien sous l’encoche ni sous la barre d’accueil', () => {
  let gm: any;
  let player: any;

  it('accueil, mode d’emploi du MJ, page du kit', async () => {
    const page = await phone('Accueil');
    await page.goto(`${BASE}/`);
    await clearOfNotch(page, 'accueil');
    await page.getByRole('button', { name: /J’organise/ }).click();
    await clearOfNotch(page, 'accueil, préparer une partie');
    await page.getByRole('link', { name: /Imprimer le kit/ }).click();
    await page.getByText('Mode d’emploi du maître du jeu').first().waitFor();
    await clearOfNotch(page, 'page du kit');
    await page.goto(`${BASE}/#/regles`);
    await page.waitForTimeout(300);
    await clearOfNotch(page, 'règles');
  });

  it('tableau de bord du MJ : chaque onglet, appairage ouvert', async () => {
    gm = await phone('MJ');
    await gm.goto(`${BASE}/`);
    await gm.getByRole('button', { name: /J’organise/ }).click();
    await gm.getByRole('button', { name: /Créer une nouvelle partie/ }).click();
    await gm.waitForURL(/#\/gm/);
    code = (await gm.locator('.big-code').first().textContent()).trim();
    gmWs = await new Phone(code).open();
    await gmWs.hello(await gm.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.gm')!).token));
    await clearOfNotch(gm, 'MJ : Partie');
    await gm.getByRole('button', { name: /Terrain/ }).first().click();
    await clearOfNotch(gm, 'MJ : Terrain vide');
    await gm.getByRole('button', { name: /Appairer des fiches/ }).click();
    await gm.getByLabel('Code imprimé sur la fiche').fill(kitSheet('kurg')!.code);
    await gm.getByRole('button', { name: 'Valider le code' }).click();
    await clearOfNotch(gm, 'MJ : choix de la pièce');
    expect((await gmWs.act({ type: 'terrain', terrain: exampleTerrain() })).ok).toBe(true);
    await gmWs.waitState((s) => s.terrain.stations.length > 0);
    await gm.getByRole('button', { name: 'Annuler' }).first().click();
    await clearOfNotch(gm, 'MJ : Terrain rempli');
    for (const tab of ['Joueurs', 'Paramètres', 'Tests', 'Journal']) {
      const b = gm.locator('nav.scroll-tabs').getByRole('button', { name: new RegExp(tab) });
      if (!(await b.count())) continue;
      await b.click();
      await clearOfNotch(gm, `MJ : ${tab}`);
    }
  }, 90_000);

  it('joueur : salon, rôle, tâches, poste, mini-jeu', async () => {
    player = await phone('Joueur');
    await player.goto(`${BASE}/#/j/${code}`);
    await clearOfNotch(player, 'rejoindre');
    await player.getByPlaceholder('ex. Lucie').fill('Zoé');
    await player.getByRole('button', { name: 'Entrer dans le salon' }).click();
    await player.getByText(/Vous êtes inscrit·e/).first().waitFor();
    await clearOfNotch(player, 'salon du joueur');
    for (let i = 0; i < 4; i++) await (await new Phone(code).open()).join(`Invité ${i + 1}`);
    expect((await gmWs.act({ type: 'settings', settings: { impostors: 1, initialKillCooldownSec: 600, initialSabotageCooldownSec: 600 } })).ok).toBe(true);
    expect((await gmWs.act({ type: 'start' })).ok).toBe(true);
    await player.locator('button.veil').first().waitFor();
    await clearOfNotch(player, 'voile du rôle');
    await player.locator('button.veil').click();
    await clearOfNotch(player, 'carte du rôle');
    await player.getByRole('button', { name: /J’ai compris/ }).click();
    await clearOfNotch(player, 'tâches');
    const me = gmWs.state.players.find((p: any) => p.name === 'Zoé');
    const mine = me.tasks[0];
    const def = gmWs.state.terrain.tasks.find((k: any) => k.id === mine.taskId);
    const st = gmWs.state.terrain.stations.find((s: any) => s.id === def.steps[0].stationId);
    await player.locator('nav.tabs').getByRole('button', { name: /Poste/ }).click();
    await clearOfNotch(player, 'onglet Poste');
    await player.locator('input.code').fill(st.code);
    await player.getByRole('button', { name: 'Valider le code' }).click();
    await player.waitForTimeout(600);
    await clearOfNotch(player, 'mini-jeu ou choix de la tâche');
  }, 90_000);

  it('écrans plein écran : réunion, pause, STOP', async () => {
    expect((await gmWs.act({ type: 'meeting' })).ok).toBe(true);
    await player.locator('.alert-screen').first().waitFor();
    await clearOfNotch(player, 'alerte de réunion');
    await player.locator('.alert-screen').first().click();
    await player.waitForTimeout(400);
    await clearOfNotch(player, 'réunion');
    expect((await gmWs.act({ type: 'pause' })).ok).toBe(true);
    await player.locator('.pause').waitFor();
    await clearOfNotch(player, 'pause');
    expect((await gmWs.act({ type: 'stop' })).ok).toBe(true);
    await player.locator('.stop').waitFor();
    await clearOfNotch(player, 'STOP');
    await clearOfNotch(gm, 'MJ pendant STOP');
    expect(errors).toEqual([]);
  }, 90_000);
});
