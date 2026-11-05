'use strict';
// ---------- Tables d'indices INSEE (ILC, ILAT, ICC) ----------
// Valeurs pré-remplies de mémoire : À VÉRIFIER sur insee.fr avant usage (case "vérifié" dans l'onglet Indices).
const INDICES = {
  TYPES: { ILC: 'Indice des loyers commerciaux (base 100 T1 2008)', ILAT: 'Indice des loyers des activités tertiaires (base 100 T1 2010)', ICC: 'Indice du coût de la construction (base 100 T4 1953)' },
  PREFILL: {
    ILC: {
      2015: [108.32, 108.38, 108.38, 108.41], 2016: [108.40, 108.40, 108.56, 108.91], 2017: [109.46, 110.00, 110.78, 111.33],
      2018: [111.87, 112.59, 113.45, 114.06], 2019: [114.64, 115.21, 115.60, 116.16], 2020: [116.23, 115.42, 115.70, 115.79],
      2021: [116.73, 118.41, 119.70, 118.59], 2022: [120.61, 123.65, 126.13, 126.05], 2023: [128.68, 131.49, 134.00, 132.63],
      2024: [133.68, 134.07, 135.21, 135.19], 2025: [136.04, 136.69, null, null],
    },
    ILAT: {
      2015: [107.69, 107.86, 107.98, 108.16], 2016: [108.20, 108.41, 108.69, 108.94], 2017: [109.41, 109.89, 110.36, 110.88],
      2018: [111.45, 112.01, 112.74, 113.30], 2019: [113.88, 114.47, 114.85, 115.43], 2020: [115.53, 114.33, 114.23, 114.06],
      2021: [114.87, 116.46, 117.61, 118.97], 2022: [120.73, 122.65, 125.23, 126.50], 2023: [127.46, 128.74, 131.17, 132.07],
      2024: [132.54, 133.28, 134.42, 134.99], 2025: [135.70, 136.34, null, null],
    },
    ICC: {
      2015: [1632, 1614, 1608, 1629], 2016: [1615, 1622, 1643, 1645], 2017: [1650, 1664, 1670, 1667],
      2018: [1671, 1699, 1733, 1703], 2019: [1728, 1746, 1746, 1769], 2020: [1770, 1753, 1765, 1795],
      2021: [1821, 1825, 1886, 1886], 2022: [1948, 1966, 2037, 2077], 2023: [2144, 2146, 2106, 2162],
      2024: [2227, 2183, 2144, 2160], 2025: [2193, null, null, null],
    },
  },
  cache: null,
  async load() { INDICES.cache = await DB.all('indices'); return INDICES.cache; },
  async seedIfEmpty() {
    const rows = await DB.all('indices'); if (rows.length) return false;
    const out = [];
    for (const [type, years] of Object.entries(INDICES.PREFILL)) for (const [y, vals] of Object.entries(years)) vals.forEach((v, i) => { if (v !== null) out.push({ id: `${type}:${y}T${i + 1}`, type, periode: `${y}T${i + 1}`, valeur: v, verifie: false, source: 'pré-rempli (à vérifier)' }); });
    await DB.putMany('indices', out); INDICES.cache = out; return true;
  },
  get(type, periode) { return (INDICES.cache || []).find(r => r.type === type && r.periode === periode) || null; },
  async set(type, periode, valeur, verifie = true, source = 'saisie manuelle') {
    const row = { id: `${type}:${periode}`, type, periode, valeur: +valeur, verifie: !!verifie, source };
    await DB.put('indices', row); await INDICES.load(); return row;
  },
  async remove(type, periode) { await DB.del('indices', `${type}:${periode}`); await INDICES.load(); },
  // Import CSV : colonnes type;periode;valeur  (periode "2024T1" ou "2024-T1" ou "T1 2024"), séparateur ; , ou tab
  async importCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()); let n = 0, errs = [];
    for (const line of lines) {
      const cells = line.split(/[;\t,]/).map(c => c.trim().replace(/^"|"$/g, ''));
      if (cells.length < 3) continue;
      const type = cells[0].toUpperCase(); if (!INDICES.TYPES[type]) { if (n === 0 && errs.length === 0) continue; errs.push(line); continue; }
      const p = INDICES.normPeriode(cells[1]); const v = U.parseNum(cells[2]);
      if (!p || v === null) { errs.push(line); continue; }
      await DB.put('indices', { id: `${type}:${p}`, type, periode: p, valeur: v, verifie: true, source: 'import CSV' }); n++;
    }
    await INDICES.load(); return { n, errs };
  },
  normPeriode(s) {
    s = String(s).toUpperCase().replace(/\s|-|_/g, '');
    let m = /^(\d{4})T([1-4])$/.exec(s); if (m) return `${m[1]}T${m[2]}`;
    m = /^T([1-4])(\d{4})$/.exec(s); if (m) return `${m[2]}T${m[1]}`;
    m = /^([1-4])(?:ER|E|EME)?T(?:RIM(?:ESTRE)?)?(\d{4})$/.exec(s); if (m) return `${m[2]}T${m[1]}`;
    return null;
  },
};
