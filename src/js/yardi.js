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
  // Rapprochement : pour chaque bail relié, compare par (code charge, mois) les montants HT Yardi et calculés
  reconcile(baux, rows, mode = 'global') {
    const out = []; const byTenant = {};
    for (const r of rows) { (byTenant[r.tenantCode] ||= []).push(r); }
    for (const bail of baux) {
      const codes = (bail.yardi && bail.yardi.tenantCodes) || []; if (!codes.length) continue;
      const yrows = codes.flatMap(c => byTenant[c] || []); if (!yrows.length) { out.push({ bailId: bail.id, ref: bail.ref, preneur: bail.preneur, statut: 'Yardi absent', note: `Aucune ligne Yardi pour ${codes.join(', ')}` }); continue; }
      const dates = yrows.filter(r => r.du && r.au); const from = dates.reduce((m, r) => r.du < m ? r.du : m, dates[0] ? dates[0].du : bail.dateEffet), to = dates.reduce((m, r) => r.au > m ? r.au : m, dates[0] ? dates[0].au : bail.dateFin);
      const q = CALC.quittance(bail, from, to);
      const keyOf = (code, du) => mode === 'global' ? code : `${code}|${(du || '').slice(0, 7)}`;
      const agg = (list, fnKey, fnAmt) => { const m = new Map(); for (const x of list) { const k = fnKey(x); m.set(k, (m.get(k) || 0) + fnAmt(x)); } return m; };
      const Y = agg(yrows, r => keyOf(r.chargeCode, r.du), r => r.net), C = agg(q.lignes, l => keyOf(l.chargeCode, l.du), l => l.ht);
      const keys = new Set([...Y.keys(), ...C.keys()]);
      for (const k of keys) {
        const [code, mois] = k.split('|'); const y = U.round2(Y.get(k) || 0), c = U.round2(C.get(k) || 0); const ecart = U.round2(y - c);
        out.push({ bailId: bail.id, ref: bail.ref, preneur: bail.preneur, actif: bail.actif, tenantCodes: codes.join(', '), chargeCode: code, mois: mois || `${from} → ${to}`, yardi: y, calcul: c, ecart, statut: !C.has(k) ? 'Yardi seul' : !Y.has(k) ? 'Calcul seul' : Math.abs(ecart) <= 1 ? 'OK' : 'Écart', warnings: q.warnings.join(' ; ') });
      }
    }
    return out.sort((a, b) => (a.ref || '').localeCompare(b.ref || '') || (a.chargeCode || '').localeCompare(b.chargeCode || '') || (a.mois || '').localeCompare(b.mois || ''));
  },
};
