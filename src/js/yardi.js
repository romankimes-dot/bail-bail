'use strict';
// ---------- Import d'un export Yardi et rapprochement ----------
const YARDI = {
  COLS: { property: ['property', 'propriete', 'immeuble'], tenant: ['tenant', 'locataire'], unit: ['unit', 'lot'], description: ['description', 'libelle'], chargeCode: ['charge code', 'chargecode', 'code'], net: ['net', 'ht', 'montant ht'], vat: ['vat', 'tva'], total: ['total amount', 'total', 'ttc'], from: ['charge from', 'from', 'du', 'debut'], to: ['charge to', 'to', 'au', 'fin'], lastPeriod: ['last period'], variance: ['variance', 'ecart'] },
  // Texte collé (TSV / CSV) ou classeur xlsx -> lignes normalisées
  parseText(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()); if (!lines.length) return [];
    const sep = (lines[0].match(/\t/g) || []).length >= 3 ? '\t' : (lines[0].match(/;/g) || []).length >= 3 ? ';' : ',';
    const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    return YARDI.fromRows(rows);
  },
  parseWorkbook(ab) {
    const wb = XLSX.read(ab, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'dd/mm/yyyy' });
    return YARDI.fromRows(rows.map(r => r.map(c => c === undefined ? '' : String(c))));
  },
  fromRows(rows) {
    // repère la ligne d'en-tête
    let hi = rows.findIndex(r => r.some(c => /charge code|tenant/i.test(c))); if (hi < 0) hi = 0;
    const head = rows[hi].map(h => U.norm(h)); const col = {};
    for (const [k, names] of Object.entries(YARDI.COLS)) { const i = head.findIndex(h => names.includes(h)); if (i >= 0) col[k] = i; }
    if (col.tenant === undefined || col.net === undefined) throw new Error('Colonnes Tenant / Net introuvables dans l\'export');
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      if (!r[col.tenant]) continue;
      const g = k => col[k] !== undefined ? (r[col[k]] || '') : '';
      const tenant = g('tenant'), unit = g('unit'), property = g('property');
      out.push({
        id: U.uid(), property, propertyCode: (/\(([a-z]{2}\d{3,})\)/i.exec(property) || [])[1] || '', tenant, tenantCode: (/\b(t\d{5,})\b/i.exec(tenant) || [])[1] || '', unit, unitCode: unit || (/\(([a-z0-9]+)-t\d+\)/i.exec(tenant) || [])[1] || '',
        description: g('description'), chargeCode: g('chargeCode').toLowerCase(), net: U.parseNum(g('net')) || 0, vat: U.parseNum(g('vat')) || 0, total: U.parseNum(g('total')) || 0,
        du: U.parseDate(g('from')) || '', au: U.parseDate(g('to')) || '', lastPeriod: U.parseNum(g('lastPeriod')), variance: U.parseNum(g('variance')),
      });
    }
    return out;
  },
  // Score de similarité de noms (préneur du bail <-> tenant Yardi)
  FORMES: /\b(sas|sasu|sarl|sa|sci|snc|eurl|sc|scp|sca|selarl|societe|ste|lot|lots|bat|batiment)\b/g,
  similar(a, b) { const cl = x => U.norm(x).replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(YARDI.FORMES, ' ').replace(/\b[a-z]?\d+[a-z]?\b/g, ' ').replace(/\s+/g, ' ').trim(); a = cl(a); b = cl(b); if (!a || !b) return 0; if (b.includes(a) || a.includes(b)) return 1; const wa = new Set(a.split(' ').filter(w => w.length > 2)), wb = new Set(b.split(' ').filter(w => w.length > 2)); let n = 0; for (const w of wa) if (wb.has(w)) n++; return n / Math.max(1, Math.min(wa.size, wb.size)); },
  // Propose les codes locataire Yardi pour un bail (par nom)
  suggest(bail, rows) {
    const byTenant = new Map(); for (const r of rows) if (r.tenantCode && !byTenant.has(r.tenantCode)) byTenant.set(r.tenantCode, r.tenant);
    return [...byTenant].map(([code, name]) => ({ code, name, score: YARDI.similar(bail.preneur || bail.enseigne || '', name.replace(/\(.*\)/, '')) })).filter(x => x.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 5);
  },
  // Rapprochement : chaque ligne Yardi est comparée au calcul sur SA période (Charge From → Charge To).
  // Mode global : agrégation par bail et code de charge sur l'ensemble des périodes Yardi ; mode détail : une ligne par ligne Yardi.
  reconcile(baux, rows, mode = 'global') {
    const out = []; const byTenant = {};
    for (const r of rows) { (byTenant[r.tenantCode] ||= []).push(r); }
    for (const bail of baux) {
      const codes = (bail.yardi && bail.yardi.tenantCodes) || []; if (!codes.length) continue;
      const yrows = codes.flatMap(c => byTenant[c] || []); if (!yrows.length) { out.push({ bailId: bail.id, ref: bail.ref, preneur: bail.preneur, actif: bail.actif, tenantCodes: codes.join(', '), statut: 'Yardi absent', note: `Aucune ligne Yardi pour ${codes.join(', ')}` }); continue; }
      const base = { bailId: bail.id, ref: bail.ref, preneur: bail.preneur, actif: bail.actif, tenantCodes: codes.join(', ') };
      const details = []; const warns = new Set();
      for (const r of yrows) {
        if (!r.du || !r.au) { details.push({ ...base, chargeCode: r.chargeCode, mois: '?', yardi: r.net, calcul: null, ecart: null, statut: 'Période manquante', note: 'Charge From / Charge To illisibles' }); continue; }
        const calc = CALC.montantSur(bail, r.du, r.au); calc.warnings.forEach(w => warns.add(w));
        const c = calc.parCode[r.chargeCode]; const known = c !== undefined;
        details.push({ ...base, chargeCode: r.chargeCode, du: r.du, au: r.au, mois: `${U.fmtDate(r.du)} → ${U.fmtDate(r.au)}`, yardi: U.round2(r.net), calcul: known ? c : 0, ecart: U.round2(r.net - (known ? c : 0)), statut: !known ? 'Yardi seul' : Math.abs(r.net - c) <= 1 ? 'OK' : 'Écart', warnings: [...warns].join(' ; ') });
      }
      // codes calculés mais absents de Yardi sur la plage couverte
      const dated = yrows.filter(r => r.du && r.au);
      if (dated.length) {
        const from = dated.reduce((m, r) => r.du < m ? r.du : m, dated[0].du), to = dated.reduce((m, r) => r.au > m ? r.au : m, dated[0].au);
        const calc = CALC.montantSur(bail, from, to); const ycodes = new Set(yrows.map(r => r.chargeCode));
        for (const [code, c] of Object.entries(calc.parCode)) if (!ycodes.has(code) && c) details.push({ ...base, chargeCode: code, du: from, au: to, mois: `${U.fmtDate(from)} → ${U.fmtDate(to)}`, yardi: 0, calcul: c, ecart: U.round2(-c), statut: 'Calcul seul', warnings: [...warns].join(' ; ') });
      }
      if (mode === 'detail') { out.push(...details); continue; }
      const agg = new Map();
      for (const d of details) { const k = d.chargeCode; const g = agg.get(k) || { ...base, chargeCode: k, yardi: 0, calcul: 0, n: 0, from: d.du, to: d.au, manquant: 0, warnings: d.warnings }; g.yardi = U.round2(g.yardi + (d.yardi || 0)); g.calcul = U.round2(g.calcul + (d.calcul || 0)); g.n++; if (d.du && (!g.from || d.du < g.from)) g.from = d.du; if (d.au && (!g.to || d.au > g.to)) g.to = d.au; if (d.statut === 'Période manquante') g.manquant++; agg.set(k, g); }
      for (const g of agg.values()) { g.ecart = U.round2(g.yardi - g.calcul); g.mois = `${g.from ? U.fmtDate(g.from) : '?'} → ${g.to ? U.fmtDate(g.to) : '?'} (${g.n} ligne${g.n > 1 ? 's' : ''})`; g.statut = g.manquant ? 'Période manquante' : !g.yardi && g.calcul ? 'Calcul seul' : g.yardi && !g.calcul ? 'Yardi seul' : Math.abs(g.ecart) <= 1 ? 'OK' : 'Écart'; out.push(g); }
    }
    return out.sort((a, b) => (a.ref || '').localeCompare(b.ref || '') || (a.chargeCode || '').localeCompare(b.chargeCode || '') || (a.du || '').localeCompare(b.du || ''));
  },
};
