// Tests unitaires du moteur de calcul et des utilitaires (node test/unit.js)
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const ctx = { window: {}, console }; vm.createContext(ctx);
for (const f of ['util', 'indices', 'calc']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js', f + '.js'), 'utf8'), ctx);
const U = vm.runInContext('U', ctx), CALC = vm.runInContext('CALC', ctx), INDICES = vm.runInContext('INDICES', ctx); let n = 0, ko = 0;
const eq = (a, b, msg) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { ko++; console.log('ÉCHEC', msg, '\n  obtenu :', JSON.stringify(a), '\n  attendu:', JSON.stringify(b)); } };
const near = (a, b, msg, eps = 0.01) => { n++; if (Math.abs(a - b) > eps) { ko++; console.log('ÉCHEC', msg, 'obtenu', a, 'attendu', b); } };
INDICES.cache = []; const idx = (t, p, v) => INDICES.cache.push({ type: t, periode: p, valeur: v, verifie: true });
idx('ILAT', '2026T4', 100); idx('ILAT', '2027T4', 110); idx('ILAT', '2028T4', 121); idx('ILAT', '2029T4', 133.1); idx('ILAT', '2027T2', 105);
// --- parseNum / parseDate ---
eq(U.parseNum('150,000.00'), 150000, 'parseNum US'); eq(U.parseNum('1.456,32'), 1456.32, 'parseNum FR'); eq(U.parseNum('1 456,32'), 1456.32, 'parseNum espace');
eq(U.parseNum('206.700'), 206700, 'parseNum milliers point'); eq(U.parseNum('137,42'), 137.42, 'parseNum décimal virgule'); eq(U.parseNum('12.5'), 12.5, 'parseNum 12.5'); eq(U.parseNum('1200.50'), 1200.5, 'parseNum 1200.50'); eq(U.parseNum('1,200'), 1200, 'parseNum 1,200');
eq(U.parseDate('31 decembre 2027'), '2027-12-31', 'date décembre sans accent'); eq(U.parseDate('1er février 2024'), '2024-02-01', 'date 1er février'); eq(U.parseDate('31/02/2027'), null, 'date invalide');
eq(U.parseDate('01/15/2027'), '2027-01-15', 'date US détectée'); eq(U.parseDate('16/10/2026'), '2026-10-16', 'date FR');
// --- indexation ---
const b = { id: 'b', lots: [{ lot: 'A', type: 'bureau', surface: 100, montantAnnuelHT: 12000 }], periodicite: 'trimestriel', prorata: 'jours', tva: { option: true, taux: 20 }, dateEffet: '2027-03-01', dateFin: '2036-02-28', index: { type: 'ILAT', basePeriode: '2026T4', baseValeur: 100, premiereDate: '2028-03-01' }, depot: { montant: 3000, mois: 3 } };
near(CALC.indexCoef(b, '2028-02-28').coef, 1, 'coef avant 1re indexation'); near(CALC.indexCoef(b, '2028-03-01').coef, 1.10, 'coef 1re indexation');
near(CALC.indexCoef(b, '2029-03-01').coef, 1.21, 'coef 2e indexation'); near(CALC.indexCoef(b, '2030-03-01').coef, 1.331, 'coef 3e indexation', 0.001);
near(CALC.indexCoef({ ...b, index: { ...b.index, plafond: 5 } }, '2029-03-01').coef, 1.05 * 1.05, 'plafond 5 %', 0.0001);
near(CALC.indexCoef({ ...b, index: { ...b.index, revisionPeriode: '2027T2' } }, '2028-03-01').coef, 1.05, 'trimestre de révision explicite');
eq(CALC.indexCoef({ ...b, index: { ...b.index, basePeriode: '2025T1', baseValeur: null } }, '2028-03-01').missing, ['2025T1'], 'indice manquant signalé');
// --- périodes et prorata ---
const per = CALC.periodes(b, '2027-01-01', '2027-12-31');
eq(per.map(p => [p.du, p.au, p.partiel]), [['2027-03-01', '2027-03-31', true], ['2027-04-01', '2027-06-30', false], ['2027-07-01', '2027-09-30', false], ['2027-10-01', '2027-12-31', false]], 'périodes trimestrielles avec entrée en cours de trimestre');
near(CALC.prorata(per[0], 'jours'), 31 / 90, 'prorata jours'); near(CALC.prorata(per[0], '30/360'), 30 / 90, 'prorata 30/360');
near(CALC.prorata({ du: '2027-01-01', au: '2027-02-28', fullDu: '2027-01-01', fullAu: '2027-03-31', partiel: true }, '30/360'), 60 / 90, '30/360 fin février');
const mens = CALC.periodes({ ...b, periodicite: 'mensuel', dateEffet: '2027-01-15', dateFin: '2027-03-10' }, '2027-01-01', '2027-12-31');
eq(mens.map(p => [p.du, p.au]), [['2027-01-15', '2027-01-31'], ['2027-02-01', '2027-02-28'], ['2027-03-01', '2027-03-10']], 'périodes mensuelles bornées par le bail');
// --- quittance : découpe à l'anniversaire, montants ---
const q = CALC.quittance(b, '2028-01-01', '2028-06-30', { loyersSeuls: true });
eq(q.lignes.map(l => [l.du, l.au, l.ht]), [['2028-01-01', '2028-02-29', 1978.02], ['2028-03-01', '2028-03-31', 1124.18], ['2028-04-01', '2028-06-30', 3300]], 'découpe à l\'anniversaire (année bissextile)');
near(q.lignes.reduce((s, l) => s + l.ttc, 0), q.lignes.reduce((s, l) => s + l.ht * 1.2, 0), 'TVA 20 %', 0.05);
// franchise de 2 mois à l'entrée
const qf = CALC.quittance({ ...b, franchiseMois: 2 }, '2027-03-01', '2027-06-30', { loyersSeuls: true });
eq(qf.lignes.map(l => l.ht), [0, 2010.99], 'franchise : mars gratuit, avril gratuit, mai-juin dus (prorata jours)');
// paliers découpés en cours de trimestre
const qp = CALC.quittance({ ...b, paliers: [{ du: '2027-05-01', au: '', montantAnnuelHT: 24000 }] }, '2027-04-01', '2027-06-30', { loyersSeuls: true });
eq(qp.lignes.map(l => [l.du, l.au, l.ht]), [['2027-04-01', '2027-04-30', 989.01], ['2027-05-01', '2027-06-30', 4021.98]], 'palier appliqué à partir de sa date');
// dépôt : initial puis réajustement
const qd = CALC.quittance(b, '2027-01-01', '2029-12-31', { loyersSeuls: true, depot: true });
eq(qd.lignes.filter(l => l.type === 'depot').map(l => [l.du, l.ht]), [['2027-03-01', 3000], ['2028-03-01', 300], ['2029-03-01', 330]], 'dépôt initial et réajustements');
eq(CALC.depotLignes({ ...b, depot: { montant: 2400 } }, '2027-01-01', '2028-12-31').map(l => l.ht), [2400, 240], 'dépôt sans mois : indexé sur le montant (pas d\'arrondi en mois)');
// --- répartition des lots ---
const r = { lots: [{ type: 'bureau', surface: 300 }, { type: 'entrepot', surface: 700 }, { type: 'parking', montantAnnuelHT: 1000 }] }; CALC.repartir(r, 11000);
eq(r.lots.map(l => l.montantAnnuelHT), [3000, 7000, 1000], 'répartition prorata m², parking fixe');
// --- avenants : loyer modifié à partir de la date d'effet ---
const av = { id: 'a1', parentId: 'b', dateEffet: '2027-07-01', lots: [{ lot: 'A', type: 'bureau', surface: 100, montantAnnuelHT: 24000 }] };
const qa = CALC.quittanceFamille(b, [av], '2027-04-01', '2027-09-30', { loyersSeuls: true });
eq(qa.lignes.map(l => [l.du, l.ht, !!l.note]), [['2027-04-01', 3000, false], ['2027-07-01', 6000, true]], 'avenant appliqué à partir de sa date d\'effet');
const qa2 = CALC.quittanceFamille(b, [{ ...av, dateEffet: '2027-05-01' }], '2027-04-01', '2027-06-30', { loyersSeuls: true });
eq(qa2.lignes.map(l => [l.du, l.au, l.ht]), [['2027-04-01', '2027-04-30', 989.01], ['2027-05-01', '2027-06-30', 4021.98]], 'avenant en cours de trimestre : découpe');
// --- montantSur (rapprochement) borné à la période ---
eq(CALC.montantSur(b, '2027-04-01', '2027-06-30').parCode, { un_ro_t: 3000 }, 'montant borné au trimestre');
// --- tacite reconduction ---
const br = { ...b, dateEffet: '2020-01-01', dateFin: '2025-12-31', index: {} };
eq(CALC.periodes(br, '2026-01-01', '2026-12-31').length, 0, 'fin ferme : rien après la date de fin');
eq(CALC.periodes({ ...br, reconduction: 'annuelle' }, '2026-01-01', '2026-12-31').map(p => p.du), ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'], 'reconduction annuelle : quittancé après la fin');
eq(CALC.finEffective({ ...br, reconduction: 'annuelle' }, '2027-03-01'), '2027-12-31', 'fin effective prolongée par pas de 12 mois');
eq(CALC.periodes({ ...br, reconduction: 'indeterminee' }, '2030-01-01', '2030-03-31').length, 1, 'durée indéterminée : pas de fin');
eq(CALC.quittance({ ...br, reconduction: 'annuelle' }, '2026-01-01', '2026-03-31', { loyersSeuls: true }).warnings.length, 1, 'avertissement de reconduction');
console.log(`${n - ko}/${n} tests OK`); process.exit(ko ? 1 : 0);
