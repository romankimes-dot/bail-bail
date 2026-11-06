'use strict';
// ---------- Calculs : indexation, périodes, prorata, quittancement ----------
const CALC = {
  // Codes Yardi par type de ligne (modifiables dans Paramètres)
  DEFAULT_CODES: { bureau: 'un_ro_t', entrepot: 'un_rw_t', activite: 'un_rw_t', parking: 'un_rp_t', autre: 'un_ro_t', charges: 'un_sca_t', taxeFonciere: 'un_pt_e', depot: 'un_rd_e' },
  codes: null,
  LABELS: { bureau: 'Rent Office', entrepot: 'Rent Warehouse', activite: 'Rent Warehouse', parking: 'Rent Parking', autre: 'Rent', charges: 'Service Charge Advance', taxeFonciere: 'Property Tax (VATex)', depot: 'Rent Deposit (VATex)' },
  NB: { mensuel: 12, trimestriel: 4, semestriel: 2, annuel: 1 },
  MONTHS: { mensuel: 1, trimestriel: 3, semestriel: 6, annuel: 12 },
  code(type) { return String((CALC.codes || CALC.DEFAULT_CODES)[type] || '').trim().toLowerCase(); },
  loyerAnnuel(bail) { const lots = Array.isArray(bail.lots) ? bail.lots : []; return lots.reduce((s, l) => s + (+l.montantAnnuelHT || 0), 0) || (+bail.loyerAnnuelHT || 0); },
  // Répartit le loyer total sur les lots au prorata des surfaces ; les parkings (ou lots marqués fixes) gardent leur montant
  repartir(bail, total) {
    const lots = Array.isArray(bail.lots) ? bail.lots : []; if (!lots.length) return;
    const fixes = lots.filter(l => l.type === 'parking' || l.fixe), vars = lots.filter(l => !(l.type === 'parking' || l.fixe));
    const reste = Math.max(0, (+total || 0) - fixes.reduce((s, l) => s + (+l.montantAnnuelHT || 0), 0));
    const surf = vars.reduce((s, l) => s + (+l.surface || 0), 0);
    if (!vars.length) return;
    let cum = 0; vars.forEach((l, i) => { const part = surf > 0 ? (+l.surface || 0) / surf : 1 / vars.length; l.montantAnnuelHT = i === vars.length - 1 ? U.round2(reste - cum) : U.round2(reste * part); cum += l.montantAnnuelHT; });
  },
  // Libellés Yardi : "Actif (fr101901)" et "PRENEUR Lot B1 (A00OF030-t0000859)"
  yardiProperty(bail) { const c = bail.yardi && bail.yardi.propertyCode; return `${bail.actif || ''}${c ? ` (${c})` : ''}`.trim(); },
  yardiTenant(bail, lot) { const t = (bail.yardi && bail.yardi.tenantCodes || [])[0] || ''; const u = lot && lot.unitCode || ''; const ids = [u, t].filter(Boolean).join('-'); return `${bail.preneur || ''}${lot && lot.lot ? ` Lot ${lot.lot}` : ''}${ids ? ` (${ids})` : ''}`.trim(); },
  // Palier applicable à une date (loyer annuel HT de base, hors indexation)
  loyerBaseAt(bail, date, montantLigne) {
    const p = (bail.paliers || []).find(p => p.du && p.du <= date && (!p.au || date <= p.au));
    if (p && p.montantAnnuelHT) { const tot = CALC.loyerAnnuel(bail); return tot ? montantLigne * (p.montantAnnuelHT / tot) : montantLigne; }
    return montantLigne;
  },
  // Coefficient d'indexation cumulé applicable à une date
  indexCoef(bail, date) {
    const ix = bail.index || {}; const res = { coef: 1, steps: [], missing: [], unverified: [] };
    if (!ix.type || ix.type === 'aucun' || !ix.premiereDate || !ix.basePeriode) return res;
    let prev = +ix.baseValeur || null; const baseRow = INDICES.get(ix.type, ix.basePeriode);
    if (!prev && baseRow) prev = baseRow.valeur;
    if (!prev) { res.missing.push(ix.basePeriode); return res; }
    if (baseRow && !baseRow.verifie && !ix.baseValeur) res.unverified.push(ix.basePeriode);
    const rev0 = U.parseTrim(ix.revisionPeriode) ? ix.revisionPeriode : U.trimAdd(ix.basePeriode, 4); // trimestre de la première révision
    let k = 1; let anniv = ix.premiereDate;
    while (anniv <= date && k < 60) {
      const periode = U.trimAdd(rev0, 4 * (k - 1)); const row = INDICES.get(ix.type, periode);
      if (!row) { res.missing.push(periode); break; }
      if (!row.verifie) res.unverified.push(periode);
      let c = row.valeur / prev;
      if (ix.plafond) c = Math.min(c, 1 + ix.plafond / 100);
      if (ix.plancher) c = Math.max(c, 1); // pas de baisse si clause de non-diminution
      res.steps.push({ date: anniv, periode, base: prev, revision: row.valeur, coef: c });
      res.coef *= c; prev = row.valeur; anniv = U.addMonths(ix.premiereDate, 12 * k); k++;
    }
    return res;
  },
  // Date de fin effective : prolongée par tacite reconduction annuelle (par pas de 12 mois) ou sans fin si durée indéterminée
  finEffective(bail, to) {
    if (!bail.dateFin) return null; if (bail.reconduction === 'indeterminee') return null;
    if (bail.reconduction === 'annuelle') { let fin = bail.dateFin, n = 0; while (fin < to && n < 60) { fin = U.addMonths(fin, 12); n++; } return fin; }
    return bail.dateFin;
  },
  // Périodes de facturation (calendaires) couvrant [from, to] ∩ [dateEffet, dateFin effective]
  periodes(bail, from, to, periodicite) {
    const per = periodicite || bail.periodicite || 'trimestriel'; const nbm = CALC.MONTHS[per] || 3;
    const start = bail.dateEffet && bail.dateEffet > from ? bail.dateEffet : from;
    const finEff = CALC.finEffective(bail, to); const end = finEff && finEff < to ? finEff : to;
    if (!start || !end || start > end) return [];
    const out = []; let cur = U.startOfMonth(start);
    // aligne sur le début de trimestre/semestre civil
    const d = U.fromISO(cur); d.setMonth(Math.floor(d.getMonth() / nbm) * nbm); cur = U.toISO(d);
    while (cur <= end) {
      const fullEnd = U.addDays(U.addMonths(cur, nbm), -1);
      const du = cur > start ? cur : start, au = fullEnd < end ? fullEnd : end;
      out.push({ du, au, fullDu: cur, fullAu: fullEnd, partiel: du !== cur || au !== fullEnd });
      cur = U.addMonths(cur, nbm);
    }
    return out;
  },
  // Découpe les périodes contenant une date anniversaire d'indexation : l'ancien loyer s'applique avant, le nouveau après
  splitAtAnniversaries(bail, periodes, extraCuts = []) {
    const ix = bail.index || {}; const hasIx = ix.premiereDate && ix.type && ix.type !== 'aucun';
    const fixed = [...extraCuts, ...(bail.paliers || []).map(p => p.du), ...(bail.paliers || []).map(p => p.au ? U.addDays(p.au, 1) : null)].filter(Boolean);
    const out = [];
    for (const p of periodes) {
      let cuts = fixed.filter(d => d > p.du && d <= p.au); let d = hasIx ? ix.premiereDate : null; let n = 0;
      while (d && d <= p.au && n < 80) { if (d > p.du) cuts.push(d); d = U.addMonths(ix.premiereDate, 12 * ++n); }
      cuts = [...new Set(cuts)].sort();
      if (!cuts.length) { out.push(p); continue; }
      let start = p.du;
      for (const c of cuts) { out.push({ ...p, du: start, au: U.addDays(c, -1), partiel: true, indexCut: true }); start = c; }
      out.push({ ...p, du: start, partiel: true, indexCut: true });
    }
    return out;
  },
  // Prorata d'une période partielle
  prorata(p, mode) {
    if (!p.partiel) return 1;
    if (mode === '30/360') { const d30 = (a, b) => { const A = U.fromISO(a), B = U.fromISO(b); const eom = x => x.getMonth() === 1 && x.getDate() === new Date(x.getFullYear(), 2, 0).getDate(); const da = eom(A) ? 30 : Math.min(A.getDate(), 30), db = eom(B) ? 30 : Math.min(B.getDate(), 30); return (B.getFullYear() - A.getFullYear()) * 360 + (B.getMonth() - A.getMonth()) * 30 + (db - da) + 1; }; return d30(p.du, p.au) / d30(p.fullDu, p.fullAu); }
    return (U.daysBetween(p.du, p.au) + 1) / (U.daysBetween(p.fullDu, p.fullAu) + 1);
  },
  inFranchise(bail, p) {
    if (!bail.franchiseMois || !bail.dateEffet) return 0;
    const fStart = bail.franchiseDebut || bail.dateEffet, fEnd = U.addDays(U.addMonths(fStart, bail.franchiseMois), -1);
    if (p.au < fStart || p.du > fEnd) return 0;
    const a = p.du > fStart ? p.du : fStart, b = p.au < fEnd ? p.au : fEnd;
    return (U.daysBetween(a, b) + 1) / (U.daysBetween(p.du, p.au) + 1); // part de la période en franchise
  },
  // Quittancement d'un bail sur [from, to] : lignes par période
  // Lignes de dépôt de garantie : versement initial puis réajustements à chaque anniversaire d'indexation
  depotLignes(bail, from, to) {
    const dp = bail.depot || {}; if (!dp.montant && !dp.mois) return [];
    const out = []; const mk = (date, libelle, montant, note) => out.push({ bailId: bail.id, ref: bail.ref, preneur: bail.preneur, tenantCode: (bail.yardi && bail.yardi.tenantCodes || []).join(', '), actif: bail.actif, propertyCode: bail.yardi && bail.yardi.propertyCode || '', yardiProperty: CALC.yardiProperty(bail), yardiTenant: CALC.yardiTenant(bail, null), lot: '', unitCode: '', du: date, au: date, periode: date.slice(0, 7), type: 'depot', chargeCode: CALC.code('depot'), libelle, ht: U.round2(montant), tauxTva: 0, tva: 0, ttc: U.round2(montant), coef: 1, prorata: 1, franchise: 0, note });
    const la = CALC.loyerAnnuel(bail); let mois = dp.mois || null;
    if (!mois && la && dp.montant) { const r = dp.montant / (la / 12); if (Math.abs(r - Math.round(r)) < 0.05) mois = Math.round(r); }
    const cible = (date) => { const ix = CALC.indexCoef(bail, date); return mois ? U.round2(CALC.loyerAnnuel(bail) * ix.coef / 12 * mois) : U.round2((dp.montant || 0) * ix.coef); };
    let courant = dp.montant || cible(bail.dateEffet || from);
    if (bail.dateEffet && bail.dateEffet >= from && bail.dateEffet <= to) mk(bail.dateEffet, `Dépôt de garantie initial${mois ? ` (${mois} mois)` : ''}`, courant);
    if (dp.reajustement === false) return out;
    const ix = bail.index || {}; if (!ix.premiereDate || !ix.type || ix.type === 'aucun') return out;
    let d = ix.premiereDate, n = 0;
    while (d <= to && n < 80) {
      if (d >= from && d > (bail.dateEffet || '')) { const c = cible(d); const diff = U.round2(c - courant); if (Math.abs(diff) >= 0.01) mk(d, `Réajustement dépôt de garantie (${U.fmtMoney(courant)} → ${U.fmtMoney(c)})`, diff, `cible ${U.fmtMoney(c)} €`); courant = c; }
      else if (d > (bail.dateEffet || '')) courant = cible(d);
      d = U.addMonths(ix.premiereDate, 12 * ++n);
    }
    return out;
  },
  // Montant HT des loyers calculés sur une plage quelconque [du, au], par code de charge
  montantSur(bail, du, au, avenants = []) { const r = CALC.quittanceFamille(bail, avenants, du, au, { loyersSeuls: false, depot: true }); const m = {}; for (const l of r.lignes) m[l.chargeCode] = U.round2((m[l.chargeCode] || 0) + l.ht); return { parCode: m, warnings: r.warnings }; },
  // Avenants : fiche en vigueur à une date (le bail ou l'avenant le plus récent dont la date d'effet est passée)
  avenantsDe(bail, tous) { return (tous || []).filter(a => a.parentId === bail.id && a.dateEffet).sort((a, b) => a.dateEffet.localeCompare(b.dateEffet)); },
  enVigueur(bail, avenants, date) { let cur = bail; for (const a of avenants) if (a.dateEffet <= date) cur = a; return cur; },
  // Quittancement d'un bail et de ses avenants : chaque sous-période prend les conditions de la fiche en vigueur
  quittanceFamille(bail, avenants, from, to, opts) {
    const avs = CALC.avenantsDe(bail, avenants); if (!avs.length) return CALC.quittance(bail, from, to, opts);
    const lignes = [], warn = new Set();
    // bornes : le bail (ou le dernier avenant qui prolonge) ; découpe aux dates d'effet des avenants
    const last = avs[avs.length - 1]; const finBase = [bail.dateFin, ...avs.map(a => a.dateFin)].filter(Boolean).sort().pop() || null;
    const fin = CALC.finEffective({ dateFin: finBase, reconduction: last.reconduction || bail.reconduction }, to) || to;
    const cuts = avs.map(a => a.dateEffet);
    for (const p of CALC.splitAtAnniversaries(bail, CALC.periodes({ ...bail, dateFin: fin }, from, to), cuts)) {
      const eff = CALC.enVigueur(bail, avs, p.du);
      // la fiche en vigueur hérite des bornes et des champs non renseignés du bail
      const merged = { ...bail, ...Object.fromEntries(Object.entries(eff).filter(([k, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length))), id: bail.id, ref: bail.ref, parentId: undefined, dateEffet: bail.dateEffet, dateFin: fin, statut: bail.statut };
      merged.index = { ...(bail.index || {}), ...Object.fromEntries(Object.entries(eff.index || {}).filter(([k, v]) => v !== null && v !== undefined && v !== '')) };
      const r = CALC.quittance(merged, p.du, p.au, { ...opts, _noSplit: true });
      r.lignes.forEach(l => { if (eff !== bail) l.note = `${l.note ? l.note + ' · ' : ''}avenant ${eff.ref || U.fmtDate(eff.dateEffet)}`; }); lignes.push(...r.lignes); r.warnings.forEach(w => warn.add(w));
    }
    if (opts && opts.depot) { const dl = CALC.depotLignes(bail, from, to); for (const d of dl) if (!lignes.some(l => l.type === 'depot' && l.du === d.du)) lignes.push(d); }
    lignes.sort((a, b) => a.du.localeCompare(b.du) || (a.type === 'depot') - (b.type === 'depot'));
    return { lignes, warnings: [...warn] };
  },
  quittance(bail, from, to, { loyersSeuls = false, depot = false, _noSplit = false } = {}) {
    const tva = bail.tva && bail.tva.option === false ? 0 : (bail.tva && bail.tva.taux != null ? +bail.tva.taux : 20);
    const mode = bail.prorata || 'jours'; const lignes = []; const warn = new Set();
    const nb = CALC.NB[bail.periodicite || 'trimestriel'];
    if (bail.dateFin && bail.dateFin < to && bail.reconduction === 'annuelle') warn.add(`Bail reconduit tacitement au-delà du ${U.fmtDate(bail.dateFin)} (reconduction annuelle)`);
    if (bail.dateFin && bail.dateFin < to && bail.reconduction === 'indeterminee') warn.add(`Bail à durée indéterminée au-delà du ${U.fmtDate(bail.dateFin)}`);
    for (const p of (_noSplit ? CALC.periodes(bail, from, to) : CALC.splitAtAnniversaries(bail, CALC.periodes(bail, from, to)))) {
      const pr = CALC.prorata(p, mode); const fr = CALC.inFranchise(bail, p);
      const ix = CALC.indexCoef(bail, p.du); ix.missing.forEach(m => warn.add(`Indice ${bail.index.type} ${m} manquant`)); ix.unverified.forEach(m => warn.add(`Indice ${bail.index.type} ${m} non vérifié`));
      const tenantCode = (bail.yardi && bail.yardi.tenantCodes || []).join(', '), propertyCode = bail.yardi && bail.yardi.propertyCode || '';
      const push = (type, libelle, ht, extra = {}) => { ht = U.round2(ht); const t = extra.tva === 0 ? 0 : tva; const tv = U.round2(ht * t / 100); lignes.push({ bailId: bail.id, ref: bail.ref, preneur: bail.preneur, tenantCode, actif: bail.actif, propertyCode, yardiProperty: CALC.yardiProperty(bail), yardiTenant: CALC.yardiTenant(bail, extra.lotObj), lot: extra.lotObj ? extra.lotObj.lot : '', unitCode: extra.lotObj ? extra.lotObj.unitCode || '' : '', du: p.du, au: p.au, periode: p.du.slice(0, 7), type, chargeCode: CALC.code(type), libelle, ht, tauxTva: t, tva: tv, ttc: U.round2(ht + tv), coef: ix.coef, prorata: pr, franchise: fr, base: extra.base, note: extra.note, jours: U.daysBetween(p.du, p.au) + 1, joursPeriode: U.daysBetween(p.fullDu, p.fullAu) + 1, indexDetail: ix.steps.map(s => `${bail.index.type} ${s.periode}=${s.revision} / ${s.base} (×${s.coef.toFixed(4)})`).join(' ; ') }); };
      const lots = Array.isArray(bail.lots) && bail.lots.length ? bail.lots : [{ lot: bail.lotsTexte || '', type: 'bureau', montantAnnuelHT: bail.loyerAnnuelHT }];
      for (const l of lots) {
        const base = CALC.loyerBaseAt(bail, p.du, +l.montantAnnuelHT || 0);
        push(l.type || 'bureau', `Loyer${l.lot ? ' lot ' + l.lot : ''}`, base / nb * ix.coef * pr * (1 - fr), { base: base / nb, lotObj: l });
      }
      if (loyersSeuls) continue;
      const ch = bail.charges || {};
      if (ch.montantAnnuelHT) { const nbc = CALC.NB[ch.periodicite || bail.periodicite || 'trimestriel']; if (nbc === nb) push('charges', ch.mode === 'forfait' ? 'Forfait charges' : 'Provision charges', ch.montantAnnuelHT / nb * pr); else push('charges', 'Charges (périodicité différente)', ch.montantAnnuelHT / nb * pr, { note: `charges ${ch.periodicite}` }); }
      if (ch.taxeFonciereMontant) push('taxeFonciere', 'Taxe foncière', ch.taxeFonciereMontant / nb * pr, { tva: 0 });
      if (!depot && bail.depot && bail.depot.montant && bail.dateEffet >= p.du && bail.dateEffet <= p.au) push('depot', 'Dépôt de garantie', bail.depot.montant, { tva: 0, prorata: 1 });
    }
    if (depot && !_noSplit) lignes.push(...CALC.depotLignes(bail, from, to));
    lignes.sort((a, b) => a.du.localeCompare(b.du) || (a.type === 'depot') - (b.type === 'depot'));
    return { lignes, warnings: [...warn] };
  },
  // Loyer annuel indexé en vigueur à une date
  loyerIndexeAt(bail, date) { const ix = CALC.indexCoef(bail, date); return { montant: U.round2(CALC.loyerAnnuel(bail) * ix.coef), ...ix }; },
  // Échéances triennales / fin
  echeances(bail) {
    if (!bail.dateEffet) return []; const out = []; const type = bail.type || 'commercial';
    if (type === 'commercial') for (let k = 3; k < (bail.dureeMois || 108) / 12; k += 3) out.push({ libelle: `Faculté de résiliation triennale`, date: U.addDays(U.addMonths(bail.dateEffet, k * 12), -1), preavis: U.addMonths(U.addMonths(bail.dateEffet, k * 12), -6) });
    if (bail.dateFin) { const today = U.toISO(new Date()); let fin = bail.dateFin, n = 0; if (bail.reconduction === 'annuelle') while (fin < today && n < 60) { fin = U.addMonths(fin, 12); n++; } out.push({ libelle: bail.reconduction === 'indeterminee' ? 'Fin initiale (durée indéterminée)' : n ? `Fin de reconduction annuelle (initiale ${U.fmtDate(bail.dateFin)})` : 'Fin du bail', date: fin, preavis: type === 'commercial' ? U.addMonths(fin, -6) : null, fin: true }); }
    if (bail.index && bail.index.premiereDate) { let d = bail.index.premiereDate; const today = U.toISO(new Date()); let n = 0; while (d < today && n < 40) { d = U.addMonths(d, 12); n++; } out.push({ libelle: 'Prochaine indexation', date: d }); }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },
};
