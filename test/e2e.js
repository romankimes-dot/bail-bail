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
  // lots : répartition automatique quand on change le loyer total, puis quand on change une surface
  const lots0 = await p.evaluate(() => APP.sel.lots.map(l => [l.lot, l.type, l.surface, l.montantAnnuelHT])); console.log('lots extraits', JSON.stringify(lots0));
  await p.fill('[data-field="loyerAnnuelHT"]', '130000'); await p.dispatchEvent('[data-field="loyerAnnuelHT"]', 'input'); await p.waitForTimeout(100);
  console.log('lots après total 130000', JSON.stringify(await p.evaluate(() => APP.sel.lots.map(l => [l.lot, l.type, l.surface, l.montantAnnuelHT]))));
  await p.fill('[data-sub="lots"][data-i="0"][data-k="surface"]', '400'); await p.dispatchEvent('[data-sub="lots"][data-i="0"][data-k="surface"]', 'input'); await p.waitForTimeout(100);
  console.log('lots après surface 400', JSON.stringify(await p.evaluate(() => ({ lots: APP.sel.lots.map(l => [l.lot, l.type, l.surface, l.montantAnnuelHT]), total: APP.sel.loyerAnnuelHT, st: APP.sel.surfaceTotale }))));
  await p.fill('[data-field="yardiProperty"]', 'fr100001'); await p.dispatchEvent('[data-field="yardiProperty"]', 'input');
  await p.click('#b-mode'); await p.waitForTimeout(200); await p.screenshot({ path: path.join(shots, '2b-bail-complet.png') }); await p.click('#b-mode'); await p.waitForTimeout(200);
  await p.click('#b-list'); await p.waitForTimeout(300); await p.screenshot({ path: path.join(shots, '2c-bail-sans-liste.png') }); await p.click('#b-list'); await p.waitForTimeout(300);
  // correction d'un champ -> apprentissage, puis sauvegarde + validation
  await p.fill('[data-field="ref"]', '24.001.01'); await p.dispatchEvent('[data-field="ref"]', 'input'); await p.click('#b-save'); await p.waitForTimeout(200);
  await p.click('[data-src="loyerAnnuelHT"]'); await p.waitForTimeout(500); await p.screenshot({ path: path.join(shots, '3-source.png') });
  // indices
  await p.click('#tabs button[data-view="indices"]'); await p.waitForSelector('[data-idx]');
  await p.fill('[data-idx="ILAT"][data-p="2024T4"]', '134,99'); await p.press('[data-idx="ILAT"][data-p="2024T4"]', 'Tab'); await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(shots, '4-indices.png') });
  // quittancement 2025
  await p.click('#tabs button[data-view="quittance"]'); await p.fill('#q-from', '2025-01-01'); await p.fill('#q-to', '2025-12-31'); await p.click('#q-run'); await p.waitForSelector('#q-out table');
  const q = await p.evaluate(() => ({ n: APP.quittance.length, depots: APP.quittance.filter(l => l.type === 'depot').map(l => [l.du, l.libelle, l.ht]), lignes: APP.quittance.slice(0, 5).map(l => [l.du, l.au, l.libelle, l.lot, l.yardiTenant, l.yardiProperty, l.ht, l.coef.toFixed(4)]), warn: document.querySelector('#q-warn').textContent.trim().slice(0, 200) }));
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
  const after = await p.evaluate(() => ({ baux: APP.baux.length, ref: APP.baux[0].ref, lots: APP.baux[0].lots.length, prop: APP.baux[0].yardi.propertyCode, learned: Object.keys(APP.learned) })); console.log('après déverrouillage', JSON.stringify(after));
  const files = await p.evaluate(() => window.__fakeFsList()); console.log('fichiers :', files.join(' | '));
  // paramètres : export excel (download) et sauvegarde chiffrée
  await p.click('#tabs button[data-view="params"]'); await p.waitForSelector('#p-xlsx');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#p-xlsx')]); console.log('excel :', dl.suggestedFilename());
  // classeur de vérification : export, modification hors app, import
  const [dv] = await Promise.all([p.waitForEvent('download'), p.click('#p-verif-exp')]); const vpath = path.join(__dirname, 'tmp', 'verif.xlsx'); fs.mkdirSync(path.dirname(vpath), { recursive: true }); await dv.saveAs(vpath);
  const XLSX = require(path.join(__dirname, '../vendor/xlsx.full.min.js')); const wb = XLSX.read(fs.readFileSync(vpath)); const ws = wb.Sheets['Baux']; const rows = XLSX.utils.sheet_to_json(ws); console.log('colonnes verif :', Object.keys(rows[0]).slice(0, 8).join(' | '), '… total', Object.keys(rows[0]).length);
  rows[0]['Franchise (mois)'] = 2; rows[0]['Tenant id Yardi (t…)'] = 't0000001'; rows[0]['Statut'] = 'Validé'; rows.push({ 'Référence': '24.002.02', 'Preneur': 'NOUVEAU LOCATAIRE', 'Loyer annuel HT total (€)': '50000', "Date d'effet": '01/03/2025', 'Périodicité': 'mensuel', 'Statut': 'À vérifier' });
  wb.Sheets['Baux'] = XLSX.utils.json_to_sheet(rows); fs.writeFileSync(vpath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  await p.setInputFiles('#p-verif-file', vpath); await p.waitForTimeout(800);
  console.log('après import classeur', JSON.stringify(await p.evaluate(() => APP.baux.map(b => [b.ref, b.statut, b.franchiseMois, b.yardi.tenantCodes, b.preneur, b.loyerAnnuelHT]))));
  // actifs paramétrés
  await p.click('#p-actif-fromdata'); await p.waitForTimeout(300); console.log('actifs', JSON.stringify(await p.evaluate(() => APP.actifs)));
  await p.screenshot({ path: path.join(shots, '7-params.png') });
  console.log('erreurs page :', errors); await b.close();
})().catch(e => { console.error('ECHEC', e); process.exit(1); });
