'use strict';
// ---------- Utilitaires généraux ----------
const U = {
  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
  pad(n) { return String(n).padStart(2, '0'); },
  // Dates manipulées en ISO (AAAA-MM-JJ), sans fuseau.
  toISO(d) { if (!d) return ''; if (typeof d === 'string') return d.slice(0, 10); return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`; },
  fromISO(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  fmtDate(s) { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; },
  addDays(s, n) { const d = U.fromISO(s); d.setDate(d.getDate() + n); return U.toISO(d); },
  addMonths(s, n) { const d = U.fromISO(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return U.toISO(d); },
  daysBetween(a, b) { return Math.round((U.fromISO(b) - U.fromISO(a)) / 86400000); }, // b - a
  daysInYear(s) { const y = +s.slice(0, 4); return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365; },
  endOfMonth(s) { const d = U.fromISO(s); return U.toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); },
  startOfMonth(s) { return s.slice(0, 8) + '01'; },
  quarterOf(s) { const d = U.fromISO(s); return `${d.getFullYear()}T${Math.floor(d.getMonth() / 3) + 1}`; },
  // Trimestre "AAAATn" -> {y, q}
  parseTrim(t) { const m = /^(\d{4})T([1-4])$/.exec(t || ''); return m ? { y: +m[1], q: +m[2] } : null; },
  trimAdd(t, nq) { const p = U.parseTrim(t); if (!p) return null; let idx = p.y * 4 + (p.q - 1) + nq; return `${Math.floor(idx / 4)}T${(idx % 4) + 1}`; },
  // Montants
  round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; },
  fmtMoney(x, dec = 2) { if (x === null || x === undefined || isNaN(x)) return ''; return Number(x).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }); },
  fmtNum(x, dec = 2) { if (x === null || x === undefined || x === '' || isNaN(x)) return ''; return Number(x).toLocaleString('fr-FR', { maximumFractionDigits: dec }); },
  // Parse un nombre à la française ou anglaise : "206.700", "1 456,32", "17.225,00", "137,42", "1200"
  parseNum(s) {
    if (s === null || s === undefined) return null; if (typeof s === 'number') return s;
    let t = String(s).replace(/ | /g, ' ').replace(/€|eur|euros?/gi, '').trim();
    if (!t) return null;
    t = t.replace(/\s+/g, '');
    const hasComma = t.includes(','), hasDot = t.includes('.');
    if (hasComma && hasDot) {
      // le dernier séparateur suivi de 1 ou 2 chiffres est la décimale : "1.456,32" (FR) ou "1,456.32" (US)
      const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.')); const dec = t.slice(last + 1);
      if (dec.length <= 2) t = t.slice(0, last).replace(/[.,]/g, '') + '.' + dec; else t = t.replace(/[.,]/g, '');
    }
    else if (hasComma) { const parts = t.split(','); if (parts.length === 2 && parts[1].length !== 3) t = parts.join('.'); else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) t = parts.join(''); else t = parts.join('.'); }
    else if (hasDot) {
      // "206.700" = 206700 (séparateur de milliers) sauf si 1 ou 2 décimales "137.42"
      const parts = t.split('.');
      if (parts.length === 2 && parts[1].length !== 3) { /* décimal */ }
      else t = t.replace(/\./g, '');
    }
    const v = parseFloat(t); return isNaN(v) ? null : v;
  },
  MOIS: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  // Parse une date française "16 octobre 2026", "16/10/2026", "1er janvier 2027", "2026-10-16"
  validDate(y, m, d) { if (m < 1 || m > 12 || d < 1) return null; const last = new Date(y, m, 0).getDate(); if (d > last) return null; return `${y}-${U.pad(m)}-${U.pad(d)}`; },
  parseDate(s) {
    if (!s) return null; if (s instanceof Date) return isNaN(s) ? null : U.toISO(s); s = String(s).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return U.validDate(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; const a = +m[1], b = +m[2]; return U.validDate(y, b, a) || (a <= 12 ? U.validDate(y, a, b) : null); } // JJ/MM/AAAA, sinon MM/JJ/AAAA si seul ce sens est valide
    m = /(\d{1,2})(?:er|e)?\s+([a-zéèêû]+)\s+(\d{4})/i.exec(s.normalize('NFC'));
    if (m) { const mot = U.norm(m[2]).slice(0, 4); const mi = U.MOIS.findIndex(x => U.norm(x).startsWith(mot)); if (mi >= 0) return U.validDate(+m[3], mi + 1, +m[1]); }
    return null;
  },
  // Nombres écrits en lettres (durées) : "trois" -> 3
  motsNombre: { 'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10, 'onze': 11, 'douze': 12, 'quinze': 15, 'dix-huit': 18, 'vingt': 20, 'vingt-quatre': 24, 'trente': 30, 'trente-six': 36 },
  parseInt(s) { if (s === null || s === undefined) return null; const t = String(s).trim().toLowerCase(); if (/^\d+$/.test(t)) return +t; return U.motsNombre[t] ?? null; },
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  // Normalisation pour recherche : minuscules, sans accents, espaces simples
  norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[  ]/g, ' ').replace(/\s+/g, ' '); },
  clone(o) { return JSON.parse(JSON.stringify(o)); },
  download(name, data, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  },
  readFile(file, mode = 'arrayBuffer') { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; if (mode === 'text') r.readAsText(file); else r.readAsArrayBuffer(file); }); },
  b64ToBytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; },
  blobUrl(text, type = 'application/javascript') { return URL.createObjectURL(new Blob([text], { type })); },
  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
};
