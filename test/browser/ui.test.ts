// Test de bout en bout dans de vrais navigateurs (Chromium, écrans de téléphone) contre le serveur local.
// Joue chaque mini-jeu via l'interface, une partie complète, et vérifie qu'aucune erreur JavaScript ne survient.
// Produit aussi les captures d'écran de la documentation (docs/captures/).
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE, Phone, sleep, startServer, stopServer } from '../integration/server';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const SHOTS = new URL('../../docs/captures/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(SHOTS + f);

let browser: any;
let gmPage: any;
let gmWs: Phone;
const players: { page: any; name: string; id?: string }[] = [];
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

    for (const name of ['Alice', 'Bilal', 'Chloé', 'Dmitri', 'Emma']) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'] });
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
    for (const p of players) p.id = gmWs.state.players.find((x: any) => x.name === p.name).id;
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
    await gmPage.getByLabel(/Temps de discussion/).fill('0');
    await gmPage.getByRole('button', { name: /Enregistrer/ }).click();
    await gmWs.waitState((s) => s.settings.impostors === 1 && s.settings.discussionSec === 0 && s.settings.initialKillCooldownSec === 5);
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
      await byText(p.page, 'Prochaine étape').waitFor();
    }
    const crew = players.find((p) => role(p) === 'crewmate')!;
    await shot(crew.page, '10-taches');
    await noHorizontalScroll(crew.page, 'tâches');
  }, 60_000);

  it('un équipier fait une vraie tâche en saisissant le code du poste', async () => {
    const crew = players.filter((p) => role(p) === 'crewmate');
    const p = crew[0];
    const me = gmWs.state.players.find((x: any) => x.id === p.id);
    const t = me.tasks.find((x: any) => !x.done);
    const def = gmWs.state.terrain.tasks.find((d: any) => d.id === t.taskId);
    const st = gmWs.state.terrain.stations.find((s: any) => s.id === def.steps[t.step].stationId);
    await p.page.locator('nav.tabs').getByRole('button', { name: /Poste/ }).click();
    await p.page.locator('input.code').fill(st.code);
    await p.page.getByRole('button', { name: 'Valider le code' }).click();
    await byText(p.page, 'Poste scanné').waitFor();
    await shot(p.page, '11-poste-scanne');
    await p.page.getByRole('button', { name: new RegExp(def.name) }).click();
    await p.page.locator('.overlay').waitFor();
    const game = def.steps[t.step].game;
    // les paramètres du défi sont ceux reçus par ce téléphone : on ouvre une 2e connexion avec le même jeton pour les lire
    const tok = await p.page.evaluate(() => JSON.parse(localStorage.getItem('imposteurs.player')!).token);
    const spy = await new Phone(code).open();
    await spy.hello(tok);
    const ch = spy.state.me.challenge;
    spy.close();
    // énigmes papier : la réponse n'est jamais envoyée au téléphone, on la recalcule depuis la graine (comme la fiche imprimée)
    const { countPuzzle, assemblePuzzle } = await import('../../src/shared/puzzles');
    const expected = game === 'count' ? countPuzzle(def.seed).answer : game === 'assemble' ? assemblePuzzle(def.seed).answer : undefined;
    expect(JSON.stringify(ch)).not.toContain('"answer"');
    await shot(p.page, `12-mini-jeu-${game}`);
    await solve(p.page, game, ch?.params ?? {}, expected);
    await byText(p.page, /Tâche terminée|Étape validée/).waitFor({ timeout: 20_000 });
    await gmWs.waitState((s) => s.taskBar.done >= 1 || s.players.find((x: any) => x.id === p.id).tasks.some((y: any) => y.step > 0));
  }, 60_000);

  it('élimination par code, corps signalé, réunion, vote et victoire', async () => {
    const imp = players.find((p) => role(p) === 'impostor')!;
    const crew = players.filter((p) => p !== imp);
    const [victim, reporter] = crew;
    await sleep(5_500);
    await imp.page.locator('nav.tabs').getByRole('button', { name: /Rôle/ }).click();
    await imp.page.locator('button.veil').click();
    await shot(imp.page, '13-actions-imposteur');
    await imp.page.getByRole('button', { name: /Préparer un code d’élimination/ }).click();
    const killCode = (await imp.page.locator('.modal .big-code').textContent()).trim();
    await shot(imp.page, '14-code-elimination');
    await victim.page.locator('nav.tabs').getByRole('button', { name: /Urgence/ }).click();
    await shot(victim.page, '15-onglet-urgence');
    await victim.page.getByRole('button', { name: /On vient de m’éliminer/ }).click();
    await victim.page.locator('.modal input.code').fill(killCode);
    await victim.page.getByRole('button', { name: 'Je suis éliminé·e' }).click();
    await byText(victim.page, 'Vous avez été éliminé·e').waitFor();
    const bodyCode = (await victim.page.locator('.big-code').textContent()).trim();
    await shot(victim.page, '16-corps');
    await reporter.page.locator('nav.tabs').getByRole('button', { name: /Urgence/ }).click();
    await reporter.page.getByRole('button', { name: /J’ai trouvé un corps/ }).click();
    await reporter.page.locator('.modal input.code').fill(bodyCode);
    await reporter.page.getByRole('button', { name: 'Signaler le corps' }).click();
    for (const p of players) {
      await p.page.locator('.alert-screen', { hasText: 'RÉUNION' }).waitFor();
      if (p === crew[2]) await shot(p.page, '17-alerte-reunion');
      await p.page.locator('.alert-screen').getByRole('button', { name: 'J’y vais' }).click();
    }
    await shot(crew[2].page, '18-reunion-rassemblement');
    for (const p of players.filter((x) => x !== victim)) await p.page.getByRole('button', { name: 'Je suis arrivé·e' }).click();
    await gmWs.waitState((s) => s.meeting?.stage === 'voting');
    for (const p of players.filter((x) => x !== victim)) {
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
  }, 120_000);

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
    await p.page.locator('button.veil').click();
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

  it('supports imprimables : génération du PDF d’exemple', async () => {
    await gmPage.goto(`${BASE}/#/print`);
    await byText(gmPage, 'Rejoignez la partie').waitFor();
    await gmPage.waitForTimeout(800);
    await gmPage.emulateMedia({ media: 'print' });
    await gmPage.pdf({ path: new URL('../../docs/pdf/exemple-supports-imprimables.pdf', import.meta.url).pathname, format: 'A4', printBackground: true });
    await gmPage.emulateMedia({ media: 'screen' });
  }, 60_000);

  it('aucune erreur JavaScript sur aucune page pendant tout le test', () => {
    expect(pageErrors).toEqual([]);
  });
});
