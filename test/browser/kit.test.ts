// Kit de fiches universel dans de vrais navigateurs : page d'impression sans partie (QR codes = code seul,
// valables quelle que soit l'adresse du site), appairage par la caméra (simulée, filmant un vrai QR code)
// et par saisie, puis un joueur qui filme une fiche non appairée pendant la partie.
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_SHEETS, kitSheet } from '../../src/shared/kit';
import { recommendedImpostors } from '../../src/shared/settings';
import { BASE, Phone, startServer, stopServer } from '../integration/server';
import { browserFilming } from './camera';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');
const { chromium, devices } = require('playwright');

const browsers: any[] = [];
const errors: string[] = [];
let gm: any;
let gmWs: Phone;
let code = '';

function watch(page: any, label: string) {
  page.on('pageerror', (e: Error) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m: any) => {
    if (m.type() === 'error' && !/WebSocket|net::ERR|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`);
  });
  page.on('dialog', (d: any) => void d.accept());
}

beforeAll(async () => {
  await startServer();
}, 120_000);

afterAll(async () => {
  gmWs?.close();
  for (const b of browsers) await b.close();
  await stopServer();
});

describe('kit de fiches universel (navigateur)', () => {
  it('page d’impression sans partie : 48 fiches, QR codes contenant le code seul, aucune adresse ni réglage', async () => {
    const b = await chromium.launch();
    browsers.push(b);
    const page = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    watch(page, 'Kit');
    await page.goto(`${BASE}/`);
    // accueil → « J’organise » : étape 1 de la préparation
    await page.getByRole('button', { name: /J’organise/ }).click();
    await page.getByRole('link', { name: /Imprimer le kit/ }).click();
    await page.getByText('Mode d’emploi du maître du jeu').first().waitFor();
    const root = page.locator('.printroot');
    // guide (1) + 40 postes + 8 spéciales + 12 étiquettes + 3 interdites + 3 passages + 2 pages de badges + aide-mémoire + affiche
    expect(await root.locator('.sheet').count()).toBe(1 + 40 + 8 + 18 + 2 + 1 + 1);
    const text: string = await root.innerText();
    for (const k of KIT_SHEETS) expect(text).toContain(k.code);
    expect(text).not.toMatch(/Tâches possibles ici|Imposteurs \(\d|Délai : \d/);
    // le QR code de chaque fiche est exactement celui du code seul (même bibliothèque, mêmes options)
    const qrs: string[] = await root.locator('.sheet .qr').evaluateAll((els: Element[]) => els.map((e) => e.querySelector('path[stroke]')?.getAttribute('d') ?? ''));
    const modules = async (text: string) => /stroke="#000000" d="([^"]+)"/.exec(await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))![1];
    for (const k of KIT_SHEETS) expect(qrs).toContain(await modules(k.code));
    expect(qrs).not.toContain(await modules(`${new URL(BASE).origin}/#/s/${KIT_SHEETS[0].code}`));
    // fiche 05 : croix du scan ; fiches 01 à 04 : grilles et bandes
    const sheet = (n: string) => root.locator('.sheet', { has: page.locator('h1', { hasText: new RegExp(`^${n}$`) }) });
    expect(await sheet('Poste 05').innerText()).toContain('tenez-vous immobile sur la croix');
    expect(await sheet('Poste 01').locator('.count-grid').count()).toBe(1);
    expect(await sheet('Poste 02').locator('.strips').count()).toBe(1);
    expect(await sheet('Poste 06').locator('.count-grid, .strips').count()).toBe(0);
    // moins de fiches « Poste » à imprimer
    await page.getByLabel(/Nombre de fiches « Poste »/).fill('12');
    expect(await root.locator('.sheet h1', { hasText: /^Poste \d\d$/ }).count()).toBe(12);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    expect(pdf.length).toBeGreaterThan(100_000);
  }, 120_000);

  it('appairage : la caméra lit la fiche « Poste 07 », le MJ crée la pièce ; les autres fiches par leur code', async () => {
    const b = await browserFilming(kitSheet('k07')!.code);
    browsers.push(b);
    const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, permissions: ['camera'] });
    gm = await ctx.newPage();
    watch(gm, 'MJ');
    await gm.goto(`${BASE}/`);
    await gm.getByRole('button', { name: /J’organise/ }).click();
    await gm.getByRole('button', { name: /Créer une nouvelle partie/ }).click();
    await gm.waitForURL(/#\/gm/);
    code = (await gm.locator('.big-code').first().textContent()).trim();
    gmWs = await new Phone(code).open();
    await gmWs.hello(await gm.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.gm')!).token));
    await gm.getByRole('button', { name: /Terrain/ }).first().click();
    expect(gmWs.state.terrain.rooms).toEqual([]);
    await gm.getByRole('button', { name: /Appairer des fiches/ }).click();
    // la caméra simulée filme la fiche « Poste 07 »
    await gm.getByText('Pas encore appairée').first().waitFor({ timeout: 20_000 });
    expect(await gm.getByText(/Poste 07/).first().isVisible()).toBe(true);
    await gm.getByLabel('Nouvelle pièce', { exact: true }).fill('Salon');
    await gm.getByRole('button', { name: 'Créer et appairer' }).click();
    await gmWs.waitState((s) => s.terrain.stations.some((x: any) => x.id === 'k07'));
    // la caméra voit toujours la même fiche : elle n'est pas proposée à nouveau
    await gm.waitForTimeout(2500);
    expect(await gm.getByText(/Appairée : Salon/).count()).toBe(0);
    const typed = async (id: string, roomName: string, create = false) => {
      await gm.getByLabel('Code imprimé sur la fiche').fill(kitSheet(id)!.code);
      await gm.getByRole('button', { name: 'Valider le code' }).click();
      await gm.locator('.card.alt strong', { hasText: kitSheet(id)!.name }).waitFor();
      if (create) {
        await gm.getByLabel('Nouvelle pièce', { exact: true }).fill(roomName);
        await gm.getByRole('button', { name: 'Créer et appairer' }).click();
      } else await gm.locator('.grid-buttons').getByRole('button', { name: new RegExp(`^${roomName}`) }).click();
      await gmWs.waitState((s) => s.terrain.stations.some((x: any) => x.id === id && s.terrain.rooms.find((r: any) => r.id === x.roomId)?.name === roomName));
      await gm.getByText(`✔ ${kitSheet(id)!.name} → ${roomName}`).waitFor();
    };
    await typed('kurg', 'Salon');
    await typed('k01', 'Cuisine', true);
    await typed('k02', 'Cuisine');
    await typed('k03', 'Bureau', true);
    await typed('k04', 'Grenier', true);
    await typed('krea1', 'Bureau');
    await typed('krea2', 'Grenier');
    const t = gmWs.state.terrain;
    expect(t.stations.map((s: any) => s.id)).toEqual(['k01', 'k02', 'k03', 'k04', 'k07', 'kurg', 'krea1', 'krea2']);
    // partie neuve : la maison d'exemple n'est pas reprise, seules les pièces créées pendant l'appairage existent
    expect(t.rooms.map((r: any) => r.name).sort()).toEqual(['Bureau', 'Cuisine', 'Grenier', 'Salon']);
    expect(t.meetingRoomId).toBe(t.rooms.find((r: any) => r.name === 'Salon').id);
    // la liste par pièce et le résumé des tâches sont à jour
    await gm.getByText(/Fiches posées : 8\/48/).waitFor();
    await gm.locator('summary', { hasText: 'Tâches, réparties automatiquement' }).getByText(String(t.tasks.length)).waitFor();
    // retrait d'une fiche par la liste
    await gm.getByRole('button', { name: 'Retirer Poste 02 du jeu' }).click();
    await gmWs.waitState((s) => !s.terrain.stations.some((x: any) => x.id === 'k02'));
    expect(gmWs.state.terrain.tasks.some((k: any) => k.name === 'Puzzle')).toBe(false);
  }, 120_000);

  it('en partie : un joueur qui filme une fiche du kit non appairée reçoit un message clair, sans pénalité', async () => {
    expect((await gmWs.act({ type: 'settings', settings: { autoImpostors: true } })).ok).toBe(true);
    const b = await browserFilming(kitSheet('k20')!.code);
    browsers.push(b);
    const ctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
    const page = await ctx.newPage();
    watch(page, 'Joueur');
    await page.goto(`${BASE}/#/j/${code}`);
    await page.getByPlaceholder('ex. Lucie').fill('Zoé');
    await page.getByRole('button', { name: 'Entrer dans le salon' }).click();
    await page.getByText(/Vous êtes inscrit·e/).first().waitFor();
    for (let i = 0; i < 4; i++) await (await new Phone(code).open()).join(`Invité ${i + 1}`);
    const r = await gmWs.act({ type: 'start' });
    expect(r.ok, r.msg).toBe(true);
    expect((await gmWs.waitState((s) => s.phase === 'playing')).settings.impostors).toBe(recommendedImpostors(5));
    await page.locator('button.veil').first().waitFor();
    await page.locator('button.veil').click();
    await page.getByRole('button', { name: /J’ai compris/ }).click();
    await page.locator('nav.tabs').getByRole('button', { name: /Poste/ }).click();
    await page.getByText(/ne sert pas dans cette partie/).first().waitFor({ timeout: 20_000 });
    const me = gmWs.state.players.find((p: any) => p.name === 'Zoé');
    expect(me.blockedUntil ?? 0).toBe(0);
    expect(errors).toEqual([]);
  }, 120_000);

  it('nouvelle partie sur le même téléphone : aucune maison d’office, « Reprendre cette maison » remet les mêmes fiches', async () => {
    const before = gmWs.state.terrain;
    await gm.goto(`${BASE}/`);
    await gm.getByRole('button', { name: /J’organise/ }).click();
    await gm.getByRole('button', { name: /Créer une nouvelle partie/ }).click();
    await gm.waitForURL(/#\/gm/);
    await gm.waitForFunction((c: string) => !document.body.innerText.includes(c), code);
    const code2 = (await gm.locator('.big-code').first().textContent()).trim();
    expect(code2).not.toBe(code);
    const ws = await new Phone(code2).open();
    await ws.hello(await gm.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.gm')!).token));
    expect(ws.state.terrain.stations).toEqual([]);
    expect(ws.state.terrain.rooms).toEqual([]);
    await gm.getByRole('button', { name: /Terrain/ }).first().click();
    await gm.getByText('Même maison que la dernière fois ?').waitFor();
    await gm.getByRole('button', { name: 'Reprendre cette maison' }).click();
    const s = await ws.waitState((x) => x.terrain.stations.length > 0);
    expect(s.terrain.stations).toEqual(before.stations);
    expect(s.terrain.rooms).toEqual(before.rooms);
    await gm.getByText('Même maison que la dernière fois ?').waitFor({ state: 'detached' });
    ws.close();
    expect(errors).toEqual([]);
  }, 60_000);
});
