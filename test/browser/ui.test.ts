// Test de bout en bout dans de vrais navigateurs (Chromium, écrans de téléphone) contre le serveur local.
// Joue chaque mini-jeu via l'interface, une partie complète, et vérifie qu'aucune erreur JavaScript ne survient.
// Produit aussi les captures d'écran de la documentation (docs/captures/).
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleAnswer, countAnswer } from '../../src/shared/puzzles';
import { exampleTerrain } from '../fixtures';
import { BASE, Phone, sleep, startServer, stopServer } from '../integration/server';
import { browserFilming } from './camera';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const SHOTS = new URL('../../docs/captures/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(SHOTS + f);

let browser: any;
let gmPage: any;
let gmWs: Phone;
const players: { page: any; name: string; id?: string; token?: string }[] = [];
const extraBrowsers: any[] = [];
const pageErrors: string[] = [];
let code = '';

const shot = (page: any, name: string) => page.screenshot({ path: `${SHOTS}${name}.png` });
const byText = (page: any, text: string | RegExp) => page.getByText(text).first();
const role = (p: { id?: string }) => gmWs.state.players.find((x: any) => x.id === p.id)?.role;

function watch(page: any, label: string) {
  page.on('pageerror', (e: Error) => pageErrors.push(`${label}: ${e.message}`));
  page.on('console', (m: any) => {
    if (m.type() === 'error' && !/WebSocket|net::ERR|Failed to load resource/.test(m.text())) pageErrors.push(`${label}: ${m.text()}`);
  });
}

async function noHorizontalScroll(page: any, what: string) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `défilement horizontal sur ${what}`).toBeLessThanOrEqual(cw + 1);
}

/** Enregistre les vibrations demandées par la page (navigator.vibrate) dans window.__vib. */
const recordVibrations = () => {
  (window as any).__vib = [];
  navigator.vibrate = (p: VibratePattern) => {
    (window as any).__vib.push(p);
    return true;
  };
};
const vibrations = (page: any): Promise<number[][]> => page.evaluate(() => (window as any).__vib.map((p: number | number[]) => (Array.isArray(p) ? p : [p])));

/** Ouvre une session de joueur existante (jeton) dans une autre page, comme un 2e appareil. */
async function openAs(ctx: any, p: { token?: string; name: string }) {
  const page = await ctx.newPage();
  watch(page, `${p.name} (2e appareil)`);
  await page.goto(`${BASE}/`);
  await page.evaluate(([c, t]: string[]) => localStorage.setItem('imposteurs.player', JSON.stringify({ code: c, token: t })), [code, p.token!]);
  await page.goto(`${BASE}/#/play`);
  await page.locator('button.veil').first().waitFor();
  if (await page.getByText('Touchez ici pour découvrir votre rôle').count()) {
    await page.locator('button.veil').click();
    await page.getByRole('button', { name: /J’ai compris/ }).click();
  }
  return page;
}

/** Lit le défi en cours d'un joueur (2e connexion avec son jeton) : ce que son téléphone a reçu. */
/** Onglet Urgence → « On vient de m'éliminer ». */
async function openKilled(page: any) {
  await page.locator('nav.tabs').getByRole('button', { name: /Urgence/ }).click();
  await page.getByRole('button', { name: /On vient de m’éliminer/ }).click();
  await page.locator('.modal .name-grid').waitFor();
}

async function challengeOf(p: { token?: string }) {
  const spy = await new Phone(code).open();
  await spy.hello(p.token!);
  const st = await spy.waitState((s) => !!s.me.challenge);
  spy.close();
  return st.me.challenge;
}

/** Réponse d'une énigme papier, comme un joueur devant la fiche imprimée (la réponse n'est jamais envoyée au téléphone). */
function paperAnswer(ch: any, taskId: string) {
  const def = gmWs.state.terrain.tasks.find((d: any) => d.id === taskId);
  if (ch.game === 'count') return countAnswer(def.seed, ch.params.sym, ch.params.scope);
  if (ch.game === 'assemble') return assembleAnswer(def.seed, ch.params.line);
  return undefined;
}

/** Étape courante d'une tâche d'un joueur, et nombre de ses tâches qui se font au même poste. */
function currentStep(p: { id?: string }, taskId?: string) {
  const me = gmWs.state.players.find((x: any) => x.id === p.id);
  const t = taskId ? me.tasks.find((x: any) => x.taskId === taskId) : me.tasks.find((x: any) => !x.done);
  const def = gmWs.state.terrain.tasks.find((d: any) => d.id === t.taskId);
  const st = gmWs.state.terrain.stations.find((s: any) => s.id === def.steps[t.step].stationId);
  const here = me.tasks.filter((x: any) => {
    if (x.done) return false;
    const d = gmWs.state.terrain.tasks.find((y: any) => y.id === x.taskId);
    return d.steps[x.step].stationId === st.id;
  });
  return { t, def, st, here: here.length };
}

/** Joue une étape de tâche par l'interface (code du poste tapé à la main) ; retourne le message affiché. */
async function playStepByHand(p: { page: any; id?: string; token?: string }, shotName?: string) {
  const { t, def, st, here } = currentStep(p);
  await p.page.locator('nav.tabs').getByRole('button', { name: /Poste/ }).click();
  await p.page.locator('input.code').fill(st.code);
  await p.page.getByRole('button', { name: 'Valider le code' }).click();
  if (here === 1) {
    // une seule tâche à ce poste : le mini-jeu s'ouvre d'office, sans écran intermédiaire
    await p.page.locator('.overlay').waitFor();
    expect(await p.page.getByText('Poste scanné').count()).toBe(0);
  } else {
    await byText(p.page, 'Poste scanné').waitFor();
    if (shotName) await shot(p.page, shotName);
    await p.page.getByRole('button', { name: new RegExp(def.name) }).click();
    await p.page.locator('.overlay').waitFor();
  }
  const ch = await challengeOf(p);
  expect(JSON.stringify(ch)).not.toContain('"answer"');
  await solve(p.page, ch.game, ch.params, paperAnswer(ch, t.taskId));
  const flash = p.page.locator('.flash');
  await flash.waitFor({ timeout: 20_000 });
  // après validation : retour direct à l'onglet Tâches avec la prochaine étape
  expect(await p.page.locator('nav.tabs button.on').textContent()).toContain('Tâches');
  // le mini-jeu réussi n'est jamais relancé ni renvoyé (ancien message « ce mini-jeu n'est plus actif »)
  await sleep(500);
  expect(await p.page.locator('.toast', { hasText: 'plus actif' }).count()).toBe(0);
  return { game: ch.game, msg: (await flash.locator('strong').textContent()).trim(), taskId: t.taskId };
}

/** Clique le bouton de la fenêtre de confirmation intégrée. */
async function confirm(page: any, label: string | RegExp) {
  await page.locator('.modal-bg .modal').last().getByRole('button', { name: label }).click();
}

/** Résout le mini-jeu affiché, en s'aidant des paramètres envoyés par le serveur. */
async function solve(page: any, game: string, params: any, expected?: string) {
  const ov = page.locator('.overlay').last();
  // attendre que le mini-jeu soit réellement affiché avant d'agir
  await ov.locator('.game, .scan-visual').first().waitFor({ timeout: 10_000 });
  switch (game) {
    case 'wires': {
      const btns = ov.locator('.wires button');
      for (let i = 0; i < 4; i++) {
        await btns.nth(2 * i).click();
        const color = params.left[i];
        const j = params.right.indexOf(color);
        await btns.nth(2 * j + 1).click();
      }
      break;
    }
    case 'sequence': {
      await ov.locator('.pad button:not([disabled])').first().waitFor({ timeout: 10_000 });
      for (const k of params.seq) await ov.locator('.pad button').nth(k).click();
      break;
    }
    case 'order':
      for (let n = 1; n <= 10; n++) await ov.locator('.order button', { hasText: new RegExp(`^${n}$`) }).click();
      break;
    case 'calibrate':
      // boucle dans la page : on touche STOP quand le curseur est dans la zone verte
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let hits = 0;
            const loop = () => {
              const zone = document.querySelector('.overlay .track .zone') as HTMLElement | null;
              const cur = document.querySelector('.overlay .track .cursor') as HTMLElement | null;
              const btn = [...document.querySelectorAll('.overlay button')].find((b) => b.textContent?.trim() === 'STOP') as HTMLButtonElement | undefined;
              if (!zone || !cur || !btn) return resolve();
              const z0 = parseFloat(zone.style.left);
              const zw = parseFloat(zone.style.width);
              const c = parseFloat(cur.style.left);
              if (c > z0 + 2 && c < z0 + zw - 2) {
                btn.click();
                hits++;
                if (hits >= 3) return resolve();
                return setTimeout(() => requestAnimationFrame(loop), 120);
              }
              requestAnimationFrame(loop);
            };
            loop();
          }),
      );
      break;
    case 'slider':
    case 'tune':
      await ov.locator('input[type=range]').evaluate((el: HTMLInputElement, v: number) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, params.target);
      await ov.getByRole('button', { name: 'Valider' }).click();
      break;
    case 'swipe': {
      const box = await ov.locator('.swipe-slot').boundingBox();
      await page.mouse.move(box.x + 40, box.y + 40);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(box.x + 40 + (box.width * i) / 20, box.y + 40);
        await sleep(45);
      }
      await page.mouse.up();
      break;
    }
    case 'targets':
      for (let n = 0; n < 8; n++) await ov.locator('.arena .t').click();
      break;
    case 'count':
    case 'assemble':
      await ov.locator('input.code').fill(expected!);
      await ov.getByRole('button', { name: 'Valider' }).click();
      break;
    case 'switches':
      while ((await ov.locator('.switches button.off').count()) > 0) {
        await ov.locator('.switches button.off').first().click();
        await sleep(120); // un humain ne touche pas un interrupteur pendant son changement d'état
      }
      break;
    case 'pin':
      for (const d of String(params.pin)) await ov.locator('.pad button', { hasText: new RegExp(`^${d}$`) }).click();
      await ov.locator('.pad button', { hasText: /^OK$/ }).click();
      break;
    // wait, scan : se terminent seuls
  }
}

beforeAll(async () => {
  await startServer();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  for (const b of extraBrowsers) await b.close().catch(() => {});
  await browser?.close();
  gmWs?.close();
  await stopServer();
});

describe('interface sur téléphone', () => {
  it('accueil, création par le MJ, 5 téléphones rejoignent via le lien (pseudonyme seulement)', async () => {
    const gmCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    gmPage = await gmCtx.newPage();
    watch(gmPage, 'MJ');
    await gmPage.goto(`${BASE}/`);
    await shot(gmPage, '01-accueil');
    await gmPage.getByRole('button', { name: /J’organise/ }).click();
    await gmPage.getByRole('button', { name: /Créer une nouvelle partie/ }).click();
    await gmPage.waitForURL(/#\/gm/);
    await byText(gmPage, 'Préparer la partie').waitFor();
    code = (await gmPage.locator('.big-code').first().textContent()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const token = await gmPage.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.gm')!).token);
    gmWs = await new Phone(code).open();
    await gmWs.hello(token);
    // nouvelle partie : aucune maison ; on installe la maison d'exemple (fiches du kit déjà appairées)
    expect(gmWs.state.terrain.stations).toEqual([]);
    expect((await gmWs.act({ type: 'terrain', terrain: exampleTerrain() })).ok).toBe(true);
    await gmWs.waitState((s) => s.terrain.stations.length > 0);

    for (const name of ['Alice', 'Bilal', 'Chloé', 'Dmitri', 'Emma']) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'] });
      await ctx.addInitScript(recordVibrations);
      const page = await ctx.newPage();
      watch(page, name);
      await page.goto(`${BASE}/#/j/${code}`);
      await byText(page, `Rejoindre la partie ${code}`).waitFor();
      await page.getByPlaceholder('ex. Lucie').fill(name);
      await page.getByRole('button', { name: 'Entrer dans le salon' }).click();
      await byText(page, /Vous êtes inscrit·e/).waitFor();
      players.push({ page, name });
    }
    await gmWs.waitState((s) => s.players.length === 5);
    for (const p of players) {
      p.id = gmWs.state.players.find((x: any) => x.name === p.name).id;
      p.token = await p.page.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.player')!).token);
    }
    await shot(players[0].page, '02-salon-joueur');
    await noHorizontalScroll(players[0].page, 'salon');
    await byText(gmPage, '5 inscrits').waitFor();
    await shot(gmPage, '03-mj-preparation');
  }, 120_000);

  it('salon : test du son, entraînement local à un mini-jeu', async () => {
    const page = players[0].page;
    await page.locator('.card', { hasText: 'Alertes de ce téléphone' }).getByRole('button', { name: 'Tester' }).click();
    await page.getByText('S’entraîner aux mini-jeux').click();
    await page.getByRole('button', { name: 'Déverrouillage' }).click();
    for (let n = 1; n <= 10; n++) await page.locator('.modal .order button', { hasText: new RegExp(`^${n}$`) }).click();
    await byText(page, /Bravo/).waitFor();
  }, 30_000);

  it('MJ : chaque tâche et chaque réparation fonctionne (onglet Tests, validé par le serveur)', async () => {
    await gmPage.getByRole('button', { name: /Tests/ }).click();
    await byText(gmPage, 'Tester avant la partie').waitFor();
    await shot(gmPage, '04-mj-tests');
    const rows = gmPage.locator('.card', { hasText: 'Toutes les tâches' }).locator('li');
    const total = await rows.count();
    expect(total).toBeGreaterThan(15);
    const games = new Set<string>();
    for (let i = 0; i < total; i++) {
      await rows.nth(i).getByRole('button', { name: 'Tester' }).click();
      const st = await gmWs.waitState((s) => !!s.gmChallenge).catch(async (e) => {
        await shot(gmPage, `echec-test-ligne-${i + 1}`);
        throw new Error(`ligne ${i + 1}/${total} (${await rows.nth(i).textContent()}) : le test ne démarre pas — ${e.message}`);
      });
      const c = st.gmChallenge;
      games.add(c.game);
      await gmPage.locator('.overlay').waitFor();
      if (i === 0) await shot(gmPage, `05-mj-test-${c.game}`);
      try {
        await solve(gmPage, c.game, c.params, c.expected);
        await gmWs.waitState((s) => !s.gmChallenge, 20_000);
        await gmPage.locator('.overlay').waitFor({ state: 'detached' });
      } catch (e) {
        await shot(gmPage, `echec-test-${c.game}`);
        throw new Error(`mini-jeu « ${c.game} » (ligne ${i + 1}) : ${(e as Error).message}`);
      }
    }
    const trace: string[] = [];
    gmWs.ws.addEventListener('message', (ev: any) => {
      if (ev.data === 'pong') return;
      const m = JSON.parse(String(ev.data));
      if (m.t === 'state') trace.push(`${Date.now() % 100000} ${m.v.gmChallenge?.game ?? '-'}:${m.v.gmChallenge?.id ?? ''}`);
    });
    for (const k of ['Rétablir le courant', 'Régler la radio', 'Code oxygène']) {
      trace.push(`${Date.now() % 100000} CLIC ${k}`);
      await gmPage.locator('li', { hasText: k }).getByRole('button', { name: 'Tester' }).click();
      const c = (await gmWs.waitState((s) => !!s.gmChallenge)).gmChallenge;
      games.add(c.game);
      try {
        await solve(gmPage, c.game, c.params);
        const toasts: string[] = [];
        const poll = setInterval(async () => toasts.push(String(await gmPage.locator('.toast').textContent({ timeout: 200 }).catch(() => ''))), 250);
        await gmWs.waitState((s) => !s.gmChallenge, 10_000).finally(() => clearInterval(poll)).catch((e) => {
          throw new Error(`${e.message} ; messages : ${[...new Set(toasts)].join(' | ')}`);
        });
      } catch (e) {
        await shot(gmPage, `echec-reparation-${c.game}`);
        throw new Error(`réparation « ${c.game} » : ${(e as Error).message}\n${trace.slice(-15).join('\n')}`);
      }
    }
    // les 11 mini-jeux et les 3 réparations ont été joués par l'interface
    expect([...games].sort()).toEqual(['assemble', 'calibrate', 'count', 'order', 'pin', 'scan', 'sequence', 'slider', 'swipe', 'switches', 'targets', 'tune', 'wait', 'wires']);
    const badge = (await gmPage.locator('.badge', { hasText: 'vérifiés' }).textContent()).trim();
    const [done, all] = badge.split(' ')[0].split('/').map(Number);
    expect(done).toBe(all);
  }, 300_000);

  it('MJ : préréglage, paramètres, test d’alerte reçu par les joueurs', async () => {
    await gmPage.getByRole('button', { name: /Paramètres/ }).click();
    await gmPage.getByRole('button', { name: /Petit groupe/ }).click();
    await gmPage.getByLabel(/Délai avant la 1re élimination/).fill('5');
    await gmPage.getByLabel(/Délai entre deux éliminations/).fill('10');
    await gmPage.getByLabel(/Temps de discussion/).fill('120');
    await gmPage.getByRole('button', { name: /Enregistrer/ }).click();
    await gmWs.waitState((s) => s.settings.impostors === 1 && s.settings.discussionSec === 120 && s.settings.initialKillCooldownSec === 5 && s.settings.killCooldownSec === 10);
    await shot(gmPage, '06-mj-parametres');
    await gmPage.getByRole('button', { name: /Partie/ }).first().click();
    await gmPage.getByRole('button', { name: /Faire sonner/ }).click();
    for (const p of players) {
      await byText(p.page, 'Test d’alerte').waitFor();
      if (p === players[0]) await shot(p.page, '07-alerte-test');
      await p.page.locator('.alert-screen').getByRole('button', { name: 'OK' }).click();
    }
  }, 60_000);

  it('démarrage et révélation des rôles', async () => {
    await gmPage.getByRole('button', { name: /Démarrer la partie/ }).click();
    await confirm(gmPage, /^Démarrer$/);
    await gmWs.waitState((s) => s.phase === 'playing');
    for (const p of players) await byText(p.page, 'Touchez ici pour découvrir votre rôle').waitFor();
    await shot(players[0].page, '08-revelation-voile');
    for (const p of players) {
      await p.page.locator('button.veil').click();
      if (p === players[0]) await shot(p.page, '09-carte-role');
      await p.page.getByRole('button', { name: /J’ai compris/ }).click();
      await byText(p.page, 'Prochaine étape :').waitFor();
    }
    const crew = players.find((p) => role(p) === 'crewmate')!;
    await shot(crew.page, '10-taches');
    await noHorizontalScroll(crew.page, 'tâches');
    // personne n'est envoyé d'abord à la tâche commune, et la prochaine étape affichée est celle conseillée par le serveur
    const common = gmWs.state.terrain.tasks.filter((t: any) => t.type === 'common').map((t: any) => t.name);
    for (const p of players) {
      const card = (await p.page.locator('.next-step').textContent()) as string;
      for (const name of common) expect(card, `${p.name} : ${card}`).not.toContain(name);
    }
    // l'onglet Rôle a la même apparence pour tous : deux voiles, aucune couleur d'imposteur
    for (const p of players) {
      await p.page.locator('nav.tabs').getByRole('button', { name: /Rôle/ }).click();
      expect(await p.page.locator('button.veil').count()).toBe(2);
      expect(await p.page.locator('.role-card, .card.danger').count()).toBe(0);
      await p.page.locator('nav.tabs').getByRole('button', { name: /Tâches/ }).click();
    }
  }, 60_000);

  it('un équipier fait une vraie tâche : mini-jeu lancé d’office, puis directement la prochaine étape', async () => {
    const p = players.filter((x) => role(x) === 'crewmate')[0];
    const before = gmWs.state.taskBar.done;
    const r = await playStepByHand(p, '11-poste-scanne');
    await shot(p.page, `12-apres-tache-${r.game}`);
    expect(r.msg).toMatch(/Tâche terminée|Étape validée/);
    await gmWs.waitState((s) => s.taskBar.done > before || s.players.find((x: any) => x.id === p.id).tasks.some((y: any) => y.step > 0));
    await noHorizontalScroll(p.page, 'après une tâche');
  }, 60_000);

  it('un imposteur fait une fausse tâche : exactement le même écran qu’un équipier, la barre ne bouge pas', async () => {
    const imp = players.find((x) => role(x) === 'impostor')!;
    const badge = async () => Number((await imp.page.locator('nav.tabs .tab-badge').textContent().catch(() => '0')) || 0);
    const left = await badge();
    const bar = gmWs.state.taskBar.done;
    const { t, def } = currentStep(imp);
    const r = await playStepByHand(imp);
    expect(r.msg).toBe(def.steps.length - t.step === 1 ? 'Tâche terminée !' : `Étape validée ! Étape ${t.step + 2} : voir ci-dessous.`);
    // sa liste avance comme celle d'un équipier (compteur de l'onglet, étape suivante)…
    await gmWs.waitState((s) => s.players.find((x: any) => x.id === imp.id).tasks.find((y: any) => y.taskId === r.taskId).step === t.step + 1);
    if (def.steps.length - t.step === 1) await imp.page.waitForFunction((n: number) => Number(document.querySelector('nav.tabs .tab-badge')?.textContent ?? 0) === n, left - 1);
    // … mais seule la barre de l'équipage compte
    await sleep(300);
    expect(gmWs.state.taskBar.done).toBe(bar);
  }, 60_000);

  it('caméra : le QR code filmé d’un poste ouvre tout seul la bonne tâche (lecteur réel, sans saisie)', async () => {
    const p = players.filter((x) => role(x) === 'crewmate')[1];
    // un poste où ce joueur a exactement une tâche à faire : le mini-jeu doit s'ouvrir d'office
    const me = gmWs.state.players.find((x: any) => x.id === p.id);
    const options = me.tasks.filter((t: any) => !t.done).map((t: any) => currentStep(p, t.taskId));
    const pickOne = options.find((o: any) => o.here === 1) ?? options[0];
    const cam = await browserFilming(`${BASE}/#/s/${pickOne.st.code}`);
    extraBrowsers.push(cam);
    const ctx = await cam.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
    const page = await openAs(ctx, p);
    await page.locator('nav.tabs').getByRole('button', { name: /Poste/ }).click();
    // aucune touche « Scanner » : la caméra s'ouvre seule sur l'onglet Poste
    await page.locator('video.scanner').waitFor({ timeout: 10_000 });
    if (pickOne.here === 1) {
      await page.locator('.overlay .game, .overlay .scan-visual').first().waitFor({ timeout: 15_000 });
      await shot(page, '11b-camera-tache-lancee');
      const ch = await challengeOf(p);
      expect(ch.taskName).toBe(pickOne.def.name);
      // abandon confirmé : un toucher égaré ne fait pas perdre la tâche
      await page.getByRole('button', { name: 'Abandonner ce mini-jeu' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler' }).click();
      expect(await page.locator('.overlay .game, .overlay .scan-visual').count()).toBe(1);
      await page.getByRole('button', { name: 'Abandonner ce mini-jeu' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Abandonner' }).click();
      await page.locator('.overlay').waitFor({ state: 'detached' });
    } else {
      await byText(page, 'Poste scanné').waitFor({ timeout: 15_000 });
    }
    await ctx.close();
    // la caméra filme l'affiche d'invitation (un QR code qui n'est pas un poste) pendant 8 s :
    // message clair, rien n'est envoyé au serveur, donc aucun « code erroné » et aucun blocage
    const cam2 = await browserFilming(`${BASE}/#/j/${code}`);
    extraBrowsers.push(cam2);
    const ctx2 = await cam2.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
    const page2 = await openAs(ctx2, p);
    await page2.locator('nav.tabs').getByRole('button', { name: /Poste/ }).click();
    await byText(page2, 'Ce QR code n’est pas celui d’un poste ni d’un corps').waitFor({ timeout: 15_000 });
    await sleep(8_000);
    const me2 = gmWs.state.players.find((x: any) => x.id === p.id);
    expect(me2.blockedUntil).toBe(0);
    expect(gmWs.state.log.filter((l: any) => l.type === 'bad_code' && l.msg.startsWith(p.name))).toHaveLength(0);
    await ctx2.close();
  }, 60_000);

  it('reconnexion : une action faite pendant une coupure attend (« Reconnexion… ») puis part une seule fois', async () => {
    const p = players[4];
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    // coupures réseau réelles : chaque WebSocket passe par ce relais, que le test ouvre ou ferme
    const gate = { open: true, waiting: [] as (() => void)[] };
    const routes: any[] = [];
    await ctx.routeWebSocket(/\/api\/games\/.+\/ws$/, (ws: any) => {
      routes.push(ws);
      let server: any;
      const buf: any[] = [];
      ws.onMessage((m: any) => (server ? server.send(m) : buf.push(m)));
      ws.onClose(() => server?.close());
      const connect = () => {
        server = ws.connectToServer();
        server.onMessage((m: any) => ws.send(m));
        server.onClose(() => ws.close());
        for (const m of buf.splice(0)) server.send(m);
      };
      if (gate.open) connect();
      else gate.waiting.push(connect);
    });
    const page = await openAs(ctx, p);
    const cut = async () => {
      gate.open = false;
      await routes.at(-1).close();
      await page.locator('.net:not(.online)').waitFor();
    };
    const restore = () => {
      gate.open = true;
      for (const f of gate.waiting.splice(0)) f();
    };
    const sendAlert = async (msg: string) => {
      await page.locator('nav.tabs').getByRole('button', { name: /Urgence/ }).click();
      await page.getByRole('button', { name: /Alerte sécurité \/ je dois arrêter/ }).click();
      await page.getByPlaceholder('Précisions (facultatif)').fill(msg);
      await page.getByRole('button', { name: 'Envoyer l’alerte' }).click();
    };
    const alertsWith = (msg: string) => gmWs.state.alerts.filter((a: any) => a.message === msg);

    // 1. coupure de 2 s : l'action attend, le bandeau le dit tout de suite, puis elle part
    await cut();
    await sendAlert('test reconnexion 1');
    await page.locator('.offline-banner.waiting').waitFor({ timeout: 2_000 });
    await shot(page, '28-reconnexion');
    await sleep(2_000);
    restore();
    await byText(page, 'Alerte envoyée au maître du jeu').waitFor({ timeout: 6_000 });
    await gmWs.waitState((s) => s.alerts.some((a: any) => a.message === 'test reconnexion 1'));
    await page.locator('.offline-banner').waitFor({ state: 'detached' });

    // 2. coupure de plus de 5 s : l'action est refusée avec un message clair et ne part JAMAIS ensuite
    await cut();
    await sendAlert('test reconnexion 2');
    await byText(page, /Hors connexion : action non envoyée/).waitFor({ timeout: 8_000 });
    restore();
    await page.locator('.net.online').waitFor({ timeout: 15_000 });
    await sleep(1_500);
    expect(alertsWith('test reconnexion 2')).toHaveLength(0);
    expect(alertsWith('test reconnexion 1')).toHaveLength(1);
    // nettoyage : alertes vues par le MJ, écran d'alerte du MJ fermé
    for (const a of gmWs.state.alerts.filter((x: any) => !x.acked)) await gmWs.act({ type: 'ackAlert', id: a.id });
    while (await gmPage.locator('.alert-screen').count()) await gmPage.locator('.alert-screen').getByRole('button').first().click();
    await ctx.close();
  }, 90_000);

  it('élimination déclarée par la victime, vibrations, corps scanné à la caméra, réunion, prêt à voter, vote, victoire', async () => {
    const imp = players.find((p) => role(p) === 'impostor')!;
    const crew = players.filter((p) => p !== imp);
    const [victim, reporter] = crew;
    const meImp = () => gmWs.state.players.find((x: any) => x.id === imp.id);
    if (Date.now() < meImp().killCooldownUntil) await sleep(meImp().killCooldownUntil - Date.now() + 300);
    // panneau d'actions : neutre, sans la carte de rôle
    await imp.page.locator('nav.tabs').getByRole('button', { name: /Rôle/ }).click();
    await imp.page.locator('button.veil', { hasText: 'Actions' }).click();
    const panel = imp.page.locator('.actions-panel');
    await panel.waitFor();
    expect(await panel.locator('.role-card').count()).toBe(0);
    expect(await panel.locator('.danger, .imp').count()).toBe(0);
    expect(await panel.textContent()).not.toMatch(/IMPOSTEUR/);
    expect(await panel.locator('.status-lines').textContent()).toContain('prête');
    // plus aucune liste de victimes : l'imposteur n'a rien à saisir
    expect(await panel.locator('.name-grid').count()).toBe(0);
    expect(await panel.textContent()).toContain('c’est elle qui déclare');
    await shot(imp.page, '13-actions-imposteur');
    await noHorizontalScroll(imp.page, 'panneau imposteur');
    const vibBefore = (await vibrations(imp.page)).length;
    // la victime déclare elle-même qui l'a touchée (tous les vivants sont proposés, rien ne trahit un rôle)
    await openKilled(victim.page);
    for (const c of players.filter((x) => x !== victim)) await victim.page.locator('.modal .name-grid button', { hasText: c.name }).waitFor();
    await victim.page.locator('.modal .name-grid button', { hasText: imp.name }).click();
    await shot(victim.page, '14-confirmation-elimination');
    await noHorizontalScroll(victim.page, 'déclaration d’élimination');
    await victim.page.getByRole('button', { name: 'Valider mon élimination' }).click();
    await victim.page.getByRole('alertdialog').getByRole('button', { name: 'Je suis éliminé·e' }).click();
    // son écran devient un corps, avec vibration, sans jamais le nom du tueur
    await byText(victim.page, 'Vous avez été éliminé·e').waitFor({ timeout: 10_000 });
    expect(await victim.page.locator('body').textContent()).not.toContain(imp.name);
    const bodyCode = (await victim.page.locator('.body-code').textContent()).trim();
    expect(bodyCode).toMatch(/^\d{4}$/);
    expect(await victim.page.locator('.body-screen .qr svg').count()).toBe(1);
    expect(await vibrations(victim.page)).toContainEqual([400, 120, 400]);
    await shot(victim.page, '16-corps');
    await noHorizontalScroll(victim.page, 'écran du corps');
    // l'imposteur sent une courte vibration quand son élimination redevient possible (délai : 10 s)
    await imp.page.waitForFunction((n: number) => (window as any).__vib.slice(n).some((p: any) => JSON.stringify(p) === '[90]'), vibBefore, { timeout: 15_000 });

    // le corps est signalé en filmant le QR code affiché par son téléphone
    const cam = await browserFilming(`${BASE}/#/c/${bodyCode}`);
    extraBrowsers.push(cam);
    const ctx = await cam.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
    const rpage = await openAs(ctx, reporter);
    await rpage.locator('nav.tabs').getByRole('button', { name: /Poste/ }).click();
    await byText(rpage, 'Signaler ce corps ?').waitFor({ timeout: 15_000 });
    await confirm(rpage, 'Signaler le corps');
    await gmWs.waitState((s) => s.phase === 'meeting' && s.meeting.kind === 'report');
    await ctx.close();
    expect(gmWs.state.meeting.calledByName).toBe(reporter.name);
    expect(gmWs.state.meeting.bodyOfName).toBe(victim.name);

    for (const p of players) {
      await p.page.locator('.alert-screen', { hasText: 'RÉUNION' }).waitFor();
      if (p === crew[2]) await shot(p.page, '17-alerte-reunion');
      await p.page.locator('.alert-screen').getByRole('button', { name: 'J’y vais' }).click();
    }
    await byText(victim.page, 'accrochez votre badge FANTÔME').waitFor();
    await shot(crew[2].page, '18-reunion-rassemblement');
    const alive = players.filter((x) => x !== victim);
    for (const p of alive) await p.page.getByRole('button', { name: 'Je suis arrivé·e' }).click();
    await gmWs.waitState((s) => s.meeting?.stage === 'discussion');
    // discussion de 120 s : la majorité (3 sur 4) touche « Prêt à voter » et le vote s'ouvre aussitôt
    await alive[0].page.getByRole('button', { name: /Prêt à voter/ }).click();
    await byText(alive[0].page, 'Vous êtes prêt·e à voter').waitFor();
    await shot(alive[0].page, '18b-pret-a-voter');
    await alive[1].page.getByRole('button', { name: /Prêt à voter/ }).click();
    expect(gmWs.state.meeting.stage).toBe('discussion');
    await alive[2].page.getByRole('button', { name: /Prêt à voter/ }).click();
    await gmWs.waitState((s) => s.meeting?.stage === 'voting');
    for (const p of alive) {
      if (p === imp) await p.page.getByRole('button', { name: /Passer \(ne pas éjecter\)/ }).click();
      else await p.page.locator('.vote', { hasText: imp.name }).click();
      if (p === crew[2]) await shot(p.page, '19-vote');
      await p.page.locator('.confirm-bar').getByRole('button', { name: 'Confirmer mon vote' }).click();
    }
    await byText(crew[2].page, `${imp.name} était un imposteur`).waitFor();
    await shot(crew[2].page, '20-resultat-vote');
    await byText(crew[2].page, 'Vous avez gagné').waitFor({ timeout: 15_000 });
    await shot(crew[2].page, '21-fin-gagne');
    await byText(imp.page, 'Vous avez perdu').waitFor();
    await byText(gmPage, 'Victoire de l’équipage').waitFor();
    await shot(gmPage, '22-mj-fin');
  }, 150_000);

  it('nouvelle partie, rechargement de page, pause, arrêt d’urgence, cartes joueurs du MJ', async () => {
    await gmPage.getByRole('button', { name: /Nouvelle partie/ }).click();
    for (const p of players) await byText(p.page, /Vous êtes inscrit·e/).waitFor();
    await gmPage.getByRole('button', { name: /Démarrer la partie/ }).click();
    await confirm(gmPage, /^Démarrer$/);
    const p = players[1];
    await p.page.locator('button.veil').click();
    await p.page.getByRole('button', { name: /J’ai compris/ }).click();
    const roleBefore = role(p);
    await p.page.reload();
    await byText(p.page, 'Prochaine étape').waitFor();
    await p.page.locator('nav.tabs').getByRole('button', { name: /Rôle/ }).click();
    await p.page.locator('button.veil', { hasText: 'Mon rôle' }).click();
    await byText(p.page, roleBefore === 'impostor' ? 'IMPOSTEUR' : 'ÉQUIPAGE').waitFor();
    await gmPage.locator('.status-bar').getByRole('button', { name: /Pause/ }).click();
    await byText(p.page, 'Le maître du jeu a mis la partie en pause').waitFor();
    await shot(p.page, '23-pause');
    await gmPage.locator('.status-bar').getByRole('button', { name: /STOP/ }).click();
    await byText(p.page, 'Arrêt d’urgence').waitFor();
    await shot(p.page, '24-arret-urgence');
    await gmPage.locator('.status-bar').getByRole('button', { name: /Reprendre/ }).click();
    await confirm(gmPage, /^Reprendre$/);
    await p.page.locator('.stop').waitFor({ state: 'detached' });
    await p.page.locator('.pause').waitFor({ state: 'detached' });
    await gmPage.getByRole('button', { name: /Joueurs/ }).click();
    await shot(gmPage, '25-mj-joueurs');
    await gmPage.locator('.pcard', { hasText: players[2].name }).click();
    await byText(gmPage, 'Générer un code de reconnexion').waitFor();
    await gmPage.keyboard.press('Escape');
  }, 60_000);

  it('petits écrans (360×640) : accueil, règles, tableau de bord du MJ sans défilement horizontal', async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    watch(page, 'petit écran');
    await page.goto(`${BASE}/`);
    await noHorizontalScroll(page, 'accueil');
    await shot(page, '26-accueil-petit-ecran');
    await page.goto(`${BASE}/#/regles`);
    await byText(page, 'Règles').waitFor();
    await noHorizontalScroll(page, 'règles');
    const token = await gmPage.evaluate(() => localStorage.getItem('imposteurs.gm'));
    await page.evaluate((t: string) => localStorage.setItem('imposteurs.gm', t), token);
    await page.goto(`${BASE}/#/gm`);
    await page.reload();
    await byText(page, 'Maître du jeu').waitFor();
    await noHorizontalScroll(page, 'tableau de bord MJ');
    await shot(page, '27-mj-telephone');
    await ctx.close();
  }, 60_000);

  it('petits écrans (360×640) : chaque onglet de chaque joueur, panneau imposteur, écran du corps, sans débordement', async () => {
    await gmWs.waitState((s) => s.phase === 'playing' && !s.paused);
    const small: { p: (typeof players)[number]; page: any; ctx: any }[] = [];
    for (const p of players) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      small.push({ p, ctx, page: await openAs(ctx, p) });
    }
    for (const { p, page } of small) {
      for (const tab of ['Tâches', 'Poste', 'Urgence', 'Rôle']) {
        await page.locator('nav.tabs').getByRole('button', { name: new RegExp(tab) }).click();
        await noHorizontalScroll(page, `${p.name}, onglet ${tab} (360 px)`);
      }
      await page.locator('button.veil', { hasText: 'Actions' }).click();
      await page.locator('.actions-panel').waitFor();
      await noHorizontalScroll(page, `${p.name}, panneau d’actions (360 px)`);
      await page.locator('button.veil', { hasText: 'Mon rôle' }).click();
      await noHorizontalScroll(page, `${p.name}, carte de rôle (360 px)`);
    }
    // élimination depuis le petit écran, puis écran du corps de la victime en 360 px
    const imp = small.find((x) => role(x.p) === 'impostor')!;
    const victim = small.find((x) => role(x.p) === 'crewmate')!;
    const ready = () => gmWs.state.players.find((x: any) => x.id === imp.p.id).killCooldownUntil;
    if (Date.now() < ready()) await sleep(ready() - Date.now() + 300);
    await imp.page.locator('nav.tabs').getByRole('button', { name: /Rôle/ }).click();
    if (!(await imp.page.locator('.actions-panel').count())) await imp.page.locator('button.veil', { hasText: 'Actions' }).click();
    await shot(imp.page, '29-actions-imposteur-360');
    await openKilled(victim.page);
    await noHorizontalScroll(victim.page, 'déclaration d’élimination (360 px)');
    await victim.page.locator('.modal .name-grid button', { hasText: imp.p.name }).click();
    await victim.page.getByRole('button', { name: 'Valider mon élimination' }).click();
    await victim.page.getByRole('alertdialog').getByRole('button', { name: 'Je suis éliminé·e' }).click();
    await byText(victim.page, 'Vous avez été éliminé·e').waitFor({ timeout: 10_000 });
    await noHorizontalScroll(victim.page, 'écran du corps (360 px)');
    // le code du corps tient sur une seule ligne, en très gros
    const box = await victim.page.locator('.body-code').boundingBox();
    const fontPx = await victim.page.locator('.body-code').evaluate((el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontPx).toBeGreaterThanOrEqual(56);
    expect(box.height).toBeLessThan(fontPx * 1.6 + 40);
    await shot(victim.page, '30-corps-360');
    for (const { ctx } of small) await ctx.close();
  }, 90_000);

  it('aucune erreur JavaScript sur aucune page pendant tout le test', () => {
    expect(pageErrors).toEqual([]);
  });
});
