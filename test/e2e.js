// Test de bout en bout : ouvre dist/index.html en file://, simule le dossier, importe un PDF, vérifie les écrans.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, locale: 'fr-FR', colorScheme: 'light' }); const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 200)); });
  await p.addInitScript({ path: path.join(__dirname, 'fake-fs.js') });
  await p.goto('file://' + path.resolve(__dirname, '../dist/index.html'));
  await p.click('#btn-folder'); await p.waitForSelector('#lock-step-pass:not(.hidden)');
  await p.fill('#pass1', 'motdepasse123'); await p.fill('#pass2', 'motdepasse123'); await p.click('#form-pass button');
  await p.waitForSelector('#app:not(.hidden)'); console.log('ouvert');
  await p.click('#tabs button[data-view="dashboard"]');
  await p.setInputFiles('#in-files', [path.join(__dirname, 'fixtures/bail_test_A.pdf')]);
  await p.waitForFunction(() => window.APP && APP.lastImport && !APP.importing, null, { timeout: 60000 }); console.log(await p.evaluate(() => APP.lastImport));
  await p.waitForTimeout(300); await p.screenshot({ path: path.join(shots, '1-dashboard.png') });
  await p.click('#tabs button[data-view="baux"]'); await p.waitForSelector('.list-item'); await p.click('.list-item'); await p.waitForSelector('#b-save'); await p.waitForTimeout(1500);
  const vals = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-field]')].map(e => [e.dataset.field, [e.value, e.closest('.f').className]])));
  console.log(JSON.stringify(vals, null, 0));
  await p.screenshot({ path: path.join(shots, '2-bail.png') });
  // correction d'un champ -> apprentissage, puis sauvegarde + validation
  await p.fill('[data-field="enseigne"]', 'EXEMPLE'); await p.click('#b-save'); await p.waitForTimeout(200);
  await p.click('[data-src="loyerAnnuelHT"]'); await p.waitForTimeout(500); await p.screenshot({ path: path.join(shots, '3-source.png') });
  // indices
  await p.click('#tabs button[data-view="indices"]'); await p.waitForSelector('[data-idx]');
  await p.fill('[data-idx="ILAT"][data-p="2024T4"]', '134,99'); await p.press('[data-idx="ILAT"][data-p="2024T4"]', 'Tab'); await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(shots, '4-indices.png') });
  // quittancement 2025
  await p.click('#tabs button[data-view="quittance"]'); await p.fill('#q-from', '2025-01-01'); await p.fill('#q-to', '2025-12-31'); await p.click('#q-run'); await p.waitForSelector('#q-out table');
  const q = await p.evaluate(() => ({ n: APP.quittance.length, lignes: APP.quittance.slice(0, 6).map(l => [l.du, l.au, l.libelle, l.ht, l.coef.toFixed(4)]), warn: document.querySelector('#q-warn').textContent.trim().slice(0, 200) }));
  console.log(JSON.stringify(q)); await p.screenshot({ path: path.join(shots, '5-quittance.png') });
  // yardi : collage
  await p.click('#tabs button[data-view="yardi"]'); await p.waitForSelector('#y-paste'); await p.click('#y-paste');
  const tsv = ['Property\tTenant\tUnit\tDescription\tCharge Code\tCurrency\tNet\tVAT\tTax 2\tTotal Amount\tCharge From\tCharge To',
    'Parc des Tests (fr100001)\tSOCIETE EXEMPLE Lot A12 (A12-t0000001)\tA12\tRent Office\tun_ro_t\teur\t11 250,00\t2 250,00\t0,00\t13 500,00\t01/01/2025\t31/03/2025',
    'Parc des Tests (fr100001)\tSOCIETE EXEMPLE Lot A12 (A12-t0000001)\tA12\tRent Warehouse\tun_rw_t\teur\t17 750,00\t3 550,00\t0,00\t21 300,00\t01/01/2025\t31/03/2025',
    'Parc des Tests (fr100001)\tSOCIETE EXEMPLE Lot A12 (A12-t0000001)\tA12\tService Charge Advance\tun_sca_t\teur\t6 000,00\t1 200,00\t0,00\t7 200,00\t01/01/2025\t31/03/2025'].join('\n');
  await p.fill('#y-txt', tsv); await p.click('#y-ok'); await p.waitForTimeout(300); await p.click('#y-match'); await p.waitForTimeout(300);
  await p.click('#y-run'); await p.waitForSelector('#y-out table');
  const r = await p.evaluate(() => APP.rapp.map(x => [x.chargeCode, x.yardi, x.calcul, x.statut])); console.log(JSON.stringify(r));
  await p.screenshot({ path: path.join(shots, '6-yardi.png') });
  // verrouillage / déverrouillage (relecture depuis les fichiers chiffrés)
  await p.keyboard.press('Control+l'); await p.waitForSelector('#lock:not(.hidden)'); await p.fill('#pass1', 'motdepasse123'); await p.click('#form-pass button'); await p.waitForSelector('#app:not(.hidden)'); await p.waitForFunction(() => APP.baux.length > 0, null, { timeout: 15000 });
  const after = await p.evaluate(() => ({ baux: APP.baux.length, enseigne: APP.baux[0].enseigne, learned: Object.keys(APP.learned) })); console.log('après déverrouillage', JSON.stringify(after));
  const files = await p.evaluate(() => window.__fakeFsList()); console.log('fichiers :', files.join(' | '));
  // paramètres : export excel (download) et sauvegarde chiffrée
  await p.click('#tabs button[data-view="params"]'); await p.waitForSelector('#p-xlsx');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#p-xlsx')]); console.log('excel :', dl.suggestedFilename());
  await p.screenshot({ path: path.join(shots, '7-params.png') });
  console.log('erreurs page :', errors); await b.close();
})().catch(e => { console.error('ECHEC', e); process.exit(1); });
