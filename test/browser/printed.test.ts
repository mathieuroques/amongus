// Fiches imprimées avant de connaître la maison, dans un vrai navigateur : bouton de l'onglet Terrain,
// page d'impression (rien de ce qui peut changer sur place n'est imprimé), installation, retrait des fiches
// non posées, remise des fiches retirées, code de récupération, puis partie lancée et vue par un joueur.
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePrintCode, PLACEHOLDER_ROOM } from '../../src/shared/terrain';
import { BASE, Phone, startServer, stopServer } from '../integration/server';

const { chromium, devices } = createRequire(import.meta.url)('playwright');

let browser: any;
let gm: any;
let gmWs: Phone;
let code = '';
let printCode = '';
const errors: string[] = [];
const dialogs: string[] = [];
const answers: string[] = [];
const REAL = ['Salon', 'Cuisine', 'Bureau', 'Véranda', 'Chambre bleue', 'Chambre verte', 'Salle de jeux', 'Bibliothèque', 'Atelier', 'Grenier', 'Cave', 'Lingerie', 'Buanderie', 'Bureau 2'];

function watch(page: any, label: string) {
  page.on('pageerror', (e: Error) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m: any) => {
    if (m.type() === 'error' && !/WebSocket|net::ERR|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`);
  });
  // invites et confirmations natives de l'onglet Terrain : on note le message et on répond
  page.on('dialog', (d: any) => {
    dialogs.push(d.message());
    void d.accept(d.type() === 'prompt' ? answers.shift() : undefined);
  });
}

const terrainTab = () => gm.getByRole('button', { name: /Terrain/ }).first().click();
const roomInputs = () => gm.getByLabel('Nom', { exact: true });
const roomNames = (): Promise<string[]> => roomInputs().evaluateAll((els: HTMLInputElement[]) => els.map((e) => e.value));
const serverTerrain = () => gmWs.state.terrain;

beforeAll(async () => {
  await startServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  gm = await ctx.newPage();
  watch(gm, 'MJ');
}, 120_000);

afterAll(async () => {
  gmWs?.close();
  await browser?.close();
  await stopServer();
});

describe('fiches imprimées à l’avance (navigateur)', () => {
  it('le MJ prépare 30 fiches : terrain enregistré aussitôt, code de récupération affiché, démarrage bloqué', async () => {
    await gm.goto(`${BASE}/`);
    await gm.getByRole('button', { name: /J’organise/ }).click();
    await gm.getByRole('button', { name: /Créer une nouvelle partie/ }).click();
    await gm.waitForURL(/#\/gm/);
    code = (await gm.locator('.big-code').first().textContent()).trim();
    gmWs = await new Phone(code).open();
    await gmWs.hello(await gm.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.gm')!).token));
    await terrainTab();
    answers.push('30');
    await gm.getByRole('button', { name: /Imprimer avant de connaître la maison/ }).click();
    await gm.getByText(/Code de récupération : \d+-/).first().waitFor();
    await gmWs.waitState((s) => s.terrain.rooms.length === 30);
    printCode = serverTerrain().printCode;
    expect(parsePrintCode(printCode)?.count).toBe(30);
    expect(dialogs.some((d) => /Remplacer le terrain actuel/.test(d))).toBe(true);
    await gm.getByText(`code de récupération ${printCode}`).first().waitFor();
    // mémorisé sur l'appareil pour les prochaines parties
    expect(await gm.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.terrain')!).printCode)).toBe(printCode);
    expect(await gm.getByText(/modifications non enregistrées/).count()).toBe(0);
    // 4 joueurs : seul le nom provisoire des pièces empêche de démarrer
    for (let i = 0; i < 4; i++) await (await new Phone(code).open()).join(`Invité ${i + 1}`);
    const r = await gmWs.act({ type: 'start' });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/nom provisoire/);
  });

  it('impression : aucune information qui pourrait changer sur place (pièce, tâches, code de partie, réglages)', async () => {
    await gm.goto(`${BASE}/#/print`);
    await gm.getByText('Fiche du maître du jeu').first().waitFor();
    expect(await gm.getByLabel(/Imprimer avant de connaître la maison/).isChecked()).toBe(true);
    const root = gm.locator('.printroot');
    // la fiche du MJ (gardée par lui) explique justement les noms provisoires : on vérifie toutes les autres
    const text: string = (await root.locator('.sheet').allInnerTexts()).slice(1).join('\n');
    const t = serverTerrain();
    expect(text).not.toContain(code); // code de la partie : écrit à la main sur l'affiche
    expect(text).not.toMatch(/Tâches possibles ici/);
    expect(text).not.toMatch(/SALLE DE RÉUNION/);
    expect(text).not.toMatch(/Pièce [A-Z]{1,2}\b/);
    expect(text).not.toMatch(/Imposteurs \(\d/);
    expect(text).not.toMatch(/Délai : \d|\(\d+ s,|par joueur, impossible/); // aucun réglage modifiable sur place
    expect(await root.locator('.sheet').first().innerText()).toContain(printCode);
    // une fiche par poste et par fiche spéciale, toutes avec leur code
    for (const s of t.stations) expect(text).toContain(s.code);
    const sheets = await root.locator('.sheet').count();
    // MJ (1) + invitation (1) + 30 postes + 8 spéciales (urgence, 2 réacteurs, 2 oxygène, énergie, radio, moniteur)
    // + 30 étiquettes + 2 interdites + 2 passages + badges (1) + aide-mémoire (1)
    expect(t.stations).toHaveLength(38);
    expect(sheets).toBe(1 + 1 + 30 + 8 + 30 + 4 + 1 + 1);
    // la croix au sol est annoncée sur la fiche du poste qui a le scan médical, et seulement là
    const scanStation = t.stations.find((s: any) => t.tasks.some((k: any) => k.steps.some((st: any) => st.stationId === s.id && st.game === 'scan')));
    const scanSheets = root.locator('.sheet', { hasText: 'tenez-vous immobile sur la croix' });
    expect(await scanSheets.count()).toBe(1);
    expect(await scanSheets.first().innerText()).toContain(scanStation.code);
    // plan de pose : les fiches spéciales vont avec les postes B à F, le bouton d'urgence avec A
    const plan = await root.locator('.gm-plan').innerText();
    expect(plan).toMatch(/Poste A\s+\S+\s+Bouton d’urgence/);
    expect(plan).toMatch(/Poste B\s+\S+\s+Réacteur A/);
    const pdf = await gm.pdf({ format: 'A4', printBackground: true });
    expect(pdf.length).toBeGreaterThan(100_000);
  }, 120_000);

  it('sur place : 14 pièces renommées, retrait des fiches non posées, enregistrement', async () => {
    await gm.goto(`${BASE}/#/gm`);
    await terrainTab();
    // pièces A à F puis huit autres, dans le désordre des lettres
    const idx = [0, 1, 2, 3, 4, 5, 8, 11, 14, 17, 20, 23, 26, 29];
    for (let j = 0; j < idx.length; j++) await roomInputs().nth(idx[j]).fill(REAL[j]);
    await gm.getByRole('button', { name: /Retirer les fiches non posées \(16\)/ }).click();
    expect(dialogs.at(-1)).toMatch(/Retirer du jeu Pièce G, Pièce H/);
    expect(await roomInputs().count()).toBe(14);
    await gm.getByRole('button', { name: /Enregistrer le terrain/ }).click();
    const s = await gmWs.waitState((x) => x.terrain.rooms.length === 14);
    expect(s.terrain.rooms.map((r: any) => r.name).sort()).toEqual([...REAL].sort());
    expect(s.terrain.stations.filter((x: any) => x.kind === 'task')).toHaveLength(14);
    expect(s.terrain.printCode).toBe(printCode);
    await gm.getByText(/Fiches imprimées à l’avance · code de récupération/).first().waitFor();
  });

  it('une fiche oubliée : « Remettre les fiches retirées » puis nouveau retrait, sans perdre les pièces renommées', async () => {
    await gm.getByRole('button', { name: /Remettre les fiches retirées \(16\)/ }).click();
    expect(await roomInputs().count()).toBe(30);
    const names = await roomNames();
    for (const name of REAL) expect(names.filter((x) => x === name)).toHaveLength(1);
    // la fiche « Poste G » était en fait posée dans l'arrière-cuisine
    await roomInputs().nth(names.indexOf('Pièce G')).fill('Arrière-cuisine');
    await gm.getByRole('button', { name: /Retirer les fiches non posées \(15\)/ }).click();
    await gm.getByRole('button', { name: /Enregistrer le terrain/ }).click();
    const s = await gmWs.waitState((x) => x.terrain.rooms.length === 15);
    expect(s.terrain.rooms.some((r: any) => PLACEHOLDER_ROOM.test(r.name))).toBe(false);
    expect(s.terrain.stations.find((x: any) => x.name === 'Poste G')).toBeTruthy();
  });

  it('code de récupération saisi à la main (autre appareil, partie effacée) : toutes les fiches reviennent', async () => {
    const before = serverTerrain();
    answers.push(printCode.toLowerCase().replace('-', ' '));
    await gm.getByRole('button', { name: /Code de récupération/ }).click();
    await gm.getByText('Fiches imprimées retrouvées').first().waitFor();
    await gmWs.waitState((x) => x.terrain.stations.length === 38);
    const s = serverTerrain();
    // même code : les pièces déjà renommées sont gardées
    for (const r of before.rooms) expect(s.rooms).toContainEqual(r);
    // et on revient à l'état installé
    await gm.getByRole('button', { name: /Retirer les fiches non posées \(15\)/ }).click();
    await gm.getByRole('button', { name: /Enregistrer le terrain/ }).click();
    const back = await gmWs.waitState((x) => x.terrain.rooms.length === 15);
    expect(back.terrain.stations.map((x: any) => x.code).sort()).toEqual(before.stations.map((x: any) => x.code).sort());
  });

  it('la partie démarre ; le téléphone d’un joueur ne montre que des pièces et postes réels', async () => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    watch(page, 'Joueur');
    await page.goto(`${BASE}/#/j/${code}`);
    await page.getByPlaceholder('ex. Lucie').fill('Zoé');
    await page.getByRole('button', { name: 'Entrer dans le salon' }).click();
    await page.getByText(/Vous êtes inscrit·e/).first().waitFor();
    expect((await gmWs.act({ type: 'settings', settings: { impostors: 1 } })).ok).toBe(true);
    const r = await gmWs.act({ type: 'start' });
    expect(r.ok, r.msg).toBe(true);
    await page.locator('button.veil').first().waitFor();
    await page.locator('button.veil').click();
    await page.getByRole('button', { name: /J’ai compris/ }).click();
    const body: string = await page.locator('body').innerText();
    expect(body).not.toMatch(/Pièce [A-Z]{1,2}\b/);
    const t = serverTerrain();
    const removed = ['Poste H', 'Poste J', 'Poste K', 'Poste AB'];
    for (const name of removed) expect(t.stations.some((s: any) => s.name === name)).toBe(false);
    for (const name of removed) expect(body).not.toContain(name);
    expect(errors).toEqual([]);
  }, 60_000);
});
