'use strict';
// ---------- Extraction des informations clés d'un bail (règles + apprentissage) ----------
// Le texte complet (pages concaténées) est normalisé ; chaque règle propose une valeur avec une confiance
// ('ok' | 'doute' | 'absent'). Les ancres apprises (corrections de l'utilisateur) sont essayées en priorité.
const EXTRACT = {
  NUM: '(?<![a-z0-9])(\\d{1,3}(?:[ .\\u00a0\\u202f]?\\d{3})*(?:[,.]\\d{1,2})?)',
  CUR: '(?:\\s*(?:€|euros?|eur)|\\s*\\()',
  DATE: '(\\d{1,2}(?:er)?\\s+(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4})',
  // Définition des champs : clé, libellé, type de valeur, règles (regex sur texte normalisé)
  FIELDS: [
    { key: 'type', label: 'Type de bail', type: 'enum', rules: [
      { re: /bail\s+derogatoire/, value: 'derogatoire' }, { re: /convention\s+d'?occupation\s+precaire/, value: 'precaire' },
      { re: /bail\s+professionnel/, value: 'professionnel' }, { re: /bail\s+civil/, value: 'civil' }, { re: /bail\s+commercial/, value: 'commercial' }] },
    { key: 'bailleur', label: 'Bailleur', type: 'text', rules: [
      { re: /entre\s*:?\s*\n\s*(?:la\s+societe\s+)?([^\n]{3,80}?)\s*,?\s*\n(?:[^\n]*\n){0,2}?\s*en qualite de bailleur/, g: 1, nl: true },
      { re: /(?:la\s+societe\s+)?([a-z0-9][a-z0-9 &'.-]{2,60}?)\s*,\s*(?:sci|sas|sarl|sa|snc|sasu|scpi|opci|sppicav|societe)[^\n]{0,400}?(?:ci-apres|denommee?)[^\n]{0,30}?bailleur/, g: 1, conf: 'doute' }] },
    { key: 'preneur', label: 'Preneur', type: 'text', rules: [
      { re: /\bet\s*:?\s*\n\s*(?:la\s+societe\s+)?([^\n]{2,80}?)\s*,?\s*\n(?:[^\n]*\n){0,2}?\s*en qualite de preneur/, g: 1, nl: true },
      { re: /(?:la\s+societe\s+)?([a-z0-9][a-z0-9 &'.-]{2,60}?)\s*,\s*(?:sci|sas|sarl|sa|snc|sasu|eurl|societe)[^\n]{0,400}?(?:ci-apres|denommee?)[^\n]{0,30}?preneur/, g: 1, conf: 'doute' }] },
    { key: 'siren', label: 'SIREN preneur', type: 'text', rules: [
      { re: /sous le numero\s+(\d{3}\s?\d{3}\s?\d{3})/g, fnAll: (ms, norm) => { const c = ms.filter(m => /preneur/.test(norm.slice(m.index, m.index + 500)) && !/bailleur/.test(norm.slice(m.index, m.index + 200))); if (c.length) { c[0].sure = true; return c[0]; } return ms.length ? ms[ms.length - 1] : null; }, g: 1, conf: 'doute' }] },
    { key: 'dateSignature', label: 'Date de signature', type: 'date', rules: [
      { re: /date de signature\s*:?\s*(\d{1,2})[-\/ ]([a-z]{3,9})[-\/ ](\d{4})/, fn: m => EXTRACT.dateEn(m) },
      { re: /fait a [^\n]{0,60}le\s+DATE/, g: 1 }, { re: /signe (?:electroniquement )?le\s+DATE/, g: 1 }] },
    { key: 'dateEffet', label: "Date d'effet", type: 'date', rules: [
      { re: /a compter du\s+DATE\s*\(\s*(?:la|ci-apres)?\s*[«"']?\s*date d'effet/, g: 1 },
      { re: /date d'effet[^\n]{0,80}?\s+(?:le|du|au)\s+DATE/, g: 1 }, { re: /prendra effet (?:le|a compter du)\s+DATE/, g: 1 },
      { re: /a compter du\s+DATE/, g: 1, conf: 'doute' }, { re: /bail derogatoire\s*:\s*DATE/, g: 1, conf: 'doute' }] },
    { key: 'dateFin', label: "Date d'expiration", type: 'date', rules: [
      { re: /pour (?:expirer|se terminer|prendre fin)(?: effectivement)?(?: le| au)?\s+DATE/, g: 1 },
      { re: /expirera (?:automatiquement )?(?:et de plein droit )?le\s+DATE/, g: 1 }, { re: /jusqu'au\s+DATE/, g: 1, conf: 'doute' }] },
    { key: 'dureeMois', label: 'Durée (mois)', type: 'int', rules: [
      { re: /duree de\s+(\d+|[a-z-]+)\s*\((?:[a-z-]+|\d+)\)\s*(?:annees?|ans)(?:\s*(?:entieres?|entiers)(?: et consecutives?| et consecutifs)?)?/, fn: m => (U.parseInt(m[1]) || 0) * 12 },
      { re: /duree de\s+(\d+|[a-z-]+)\s*\((?:[a-z-]+|\d+)\)\s*mois(?:\s*et\s*(\d+|[a-z-]+)\s*\([^)]*\)\s*jours)?/, fn: m => U.parseInt(m[1]) },
      { re: /duree de\s+(\d+|[a-z-]+)\s*(?:annees?|ans)\b/, fn: m => (U.parseInt(m[1]) || 0) * 12, conf: 'doute' },
      { re: /duree de\s+(\d+|[a-z-]+)\s*mois/, fn: m => U.parseInt(m[1]), conf: 'doute' }] },
    { key: 'actif', label: 'Actif / immeuble', type: 'text', rules: [
      { re: /(?:ensemble immobilier|immeuble|parc(?: d'activites?)?|batiment)\s+(?:denomme|dit|a usage[^\n]{0,40})?\s*[«"']?\s*([^\n«»"']{3,60}?)\s*[»"']?\s+(?:situe|sis)\s+(?:au\s+)?([^\n]{5,120}?)\s*(?:\(|,|sur la commune)/, fn: m => `${m.o(1).trim()} - ${m.o(2).trim()}`, conf: 'doute' },
      { re: /parc\s+(?:des|de|du)\s+([a-z' -]{3,40}?)\s+situe\s+(?:au\s+)?([^\n]{5,120}?)\s*(?:\(|,|sur la commune)/, fn: m => `Parc ${m.o(1).trim()} - ${m.o(2).trim()}`, conf: 'doute' }] },
    { key: 'adresse', label: 'Adresse', type: 'text', rules: [
      { re: /(?:situe|sis)\s+(?:au\s+)?(\d{1,4}(?:\s?(?:bis|ter|\/\d+))?\s+(?:avenue|rue|boulevard|bd|chemin|route|allee|place|impasse|zac|zi|za)[^\n]{3,80}?)\s*(?:,|\(|sur la commune de|a\s+[A-Z])/, g: 1, conf: 'doute' }] },
    { key: 'lots', label: 'Lot(s)', type: 'text', rules: [
      { re: /porte sur\s+(?:le|les)\s+lots?\s+([a-z0-9][a-z0-9 ,&-]{0,40}?)\s*[,(]?\s*(?:situe|d'une|au sein|dependant|,)/, g: 1 },
      { re: /\blots?\s+(?:n°|numero)?\s*([a-z]?\d{1,4}[a-z]?(?:\s*(?:,|et|&)\s*[a-z]?\d{1,4}[a-z]?)*)/, g: 1, conf: 'doute' }] },
    { key: 'batiment', label: 'Bâtiment', type: 'text', rules: [{ re: /\bbatiment\s+([a-z0-9]{1,3})\b/, g: 1, conf: 'doute' }] },
    { key: 'surfaceTotale', label: 'Surface totale (m²)', type: 'num', rules: [
      { re: /surface (?:totale|globale)[^\n]{0,60}?NUM\s*m[²2]/, g: 1 }, { re: /NUM\s*m[²2]\s*(?:environ\s*)?(?:quote-part|de surface|shon|sup)/, g: 1, conf: 'doute' },
      { re: /total\s+(?:shon|sup|surface)?[^\n]{0,80}?NUM\s*m[²2]\s*$/m, g: 1, conf: 'doute' }, { re: /NUM\s*m[²2]/, g: 1, conf: 'doute' }] },
    { key: 'parkingsNombre', label: 'Parkings (nombre)', type: 'int', rules: [
      { re: /(\d+|[a-z-]+)\s*\((?:[a-z-]+|\d+)\)\s*(?:emplacements? de (?:stationnement|parking)|places? de (?:stationnement|parking)|parkings?)/, fn: m => U.parseInt(m[1]) },
      { re: /(\d+)\s*(?:emplacements? de (?:stationnement|parking)|places? de (?:stationnement|parking)|parkings?)/, fn: m => +m[1], conf: 'doute' }] },
    { key: 'parkingsNumeros', label: 'Parkings (numéros)', type: 'text', rules: [{ re: /(?:stationnement|parking)s?\s+(?:exterieurs?|interieurs?|couverts?)?\s*(?:numerotes?|n°)\s+([0-9][0-9 ,&et-]{0,40}\d)/, g: 1 }] },
    { key: 'loyerAnnuelHT', label: 'Loyer annuel HT (€)', type: 'num', rules: [
      { re: /loyer annuel(?: en principal)?[^\n]{0,80}?(?:hors taxes? et hors charges|ht\s*(?:et\s*)?hc|hors taxes?)[^\n]{0,40}?(?:de|a)\s*NUMCUR/, g: 1 },
      { re: /loyer annuel[^\n]{0,120}?NUMCUR/, g: 1, conf: 'doute' },
      { re: /moyennant un loyer[^\n]{0,160}?NUMCUR/, g: 1, conf: 'doute' }] },
    { key: 'periodicite', label: 'Périodicité', type: 'enum', rules: [
      { re: /loyer[^\n]{0,120}?payable\s+(?:par\s+)?mensuellement|payable\s+mensuellement|par mois et d'avance|chaque mois/, value: 'mensuel' },
      { re: /loyer[^\n]{0,120}?payable\s+(?:par\s+)?trimestriellement|payable\s+trimestriellement|par trimestre|chaque trimestre/, value: 'trimestriel' },
      { re: /payable\s+semestriellement|par semestre/, value: 'semestriel' }, { re: /payable\s+annuellement/, value: 'annuel' },
      { re: /1er janvier, 1er fevrier, 1er mars/, value: 'mensuel' }, { re: /1er janvier, 1er avril, 1er juillet et 1er octobre/, value: 'trimestriel', conf: 'doute' }] },
    { key: 'terme', label: 'Terme', type: 'enum', rules: [{ re: /terme (?:a )?echoir|d'avance|par avance/, value: 'echoir' }, { re: /terme echu/, value: 'echu' }] },
    { key: 'indexType', label: 'Indice', type: 'enum', rules: [
      { re: /indice des loyers des activites tertiaires|\bilat\b/, value: 'ILAT' }, { re: /indice des loyers commerciaux|\bilc\b/, value: 'ILC' },
      { re: /indice (?:national )?du cout de la construction|\bicc\b/, value: 'ICC' }, { re: /indice de reference des loyers|\birl\b/, value: 'IRL' }] },
    { key: 'indexBasePeriode', label: 'Indice de base (trimestre)', type: 'trim', rules: [
      { re: /indice de base[^\n]{0,200}?(\d)(?:er|eme|e)?\s*trimestre\s*(?:de\s*)?(?:l'annee\s*)?(\d{4})/, fn: m => `${m[2]}T${m[1]}` },
      { re: /(\d)(?:er|eme|e)?\s*trimestre\s*(?:de\s*)?(?:l'annee\s*)?(\d{4})\s*,?\s*soit\s*NUM/, fn: m => `${m[2]}T${m[1]}` },
      { re: /(\d)(?:er|eme|e)?\s*trimestre\s*(?:de\s*)?(?:l'annee\s*)?(\d{4})/, fn: m => `${m[2]}T${m[1]}`, conf: 'doute' }] },
    { key: 'indexBaseValeur', label: 'Indice de base (valeur)', type: 'num', rules: [
      { re: /trimestre\s*(?:de\s*)?(?:l'annee\s*)?\d{4}\s*,?\s*soit\s*NUM/, g: 1 }, { re: /indice de base[^\n]{0,200}?soit\s*NUM/, g: 1 },
      { re: /indice de base[^\n]{0,120}?(?:de|a|egal a)\s*NUM/, g: 1, conf: 'doute' }] },
    { key: 'indexRevisionPeriode', label: 'Indice de révision (trimestre)', type: 'trim', rules: [
      { re: /indice de (?:revision|comparaison|reference)[^\n]{0,120}?(\d)(?:er|eme|e)?\s*trimestre\s*(?:de\s*)?(?:l'annee\s*)?(\d{4})/, fn: m => `${m[2]}T${m[1]}` }] },
    { key: 'indexPremiereDate', label: 'Première indexation', type: 'date', rules: [
      { re: /pour la premiere fois le\s+DATE/, g: 1 }, { re: /premiere (?:indexation|revision)[^\n]{0,80}?le\s+DATE/, g: 1 },
      { re: /indexe[^\n]{0,120}?a compter du\s+DATE/, g: 1, conf: 'doute' }] },
    { key: 'indexPlafond', label: 'Plafonnement indexation (%)', type: 'num', rules: [{ re: /(?:plafonn|limit)[a-z]*\s+a\s+NUM\s*%/, g: 1 }, { re: /(?:hausse|variation)[^\n]{0,60}?(?:ne pourra|limitee)[^\n]{0,60}?NUM\s*%/, g: 1, conf: 'doute' }] },
    { key: 'depotMontant', label: 'Dépôt de garantie (€)', type: 'num', rules: [
      { re: /depot de garantie[^\n]{0,120}?(?:somme de|fixe a|de|a)\s*NUMCUR/, g: 1 }, { re: /depot de garantie[^\n]{0,200}?NUMCUR/, g: 1, conf: 'doute' }] },
    { key: 'depotMois', label: 'Dépôt (mois de loyer)', type: 'int', rules: [
      { re: /depot de garantie[^\n]{0,300}?correspondant a\s+(\d+|[a-z-]+)\s*(?:\([^)]*\)\s*)?mois de loyer/, fn: m => U.parseInt(m[1]) },
      { re: /depot de garantie[^\n]{0,300}?(\d+|[a-z-]+)\s*(?:\([^)]*\)\s*)?mois de loyer/, fn: m => U.parseInt(m[1]), conf: 'doute' }] },
    { key: 'chargesMontant', label: 'Charges annuelles (€ HT)', type: 'num', rules: [
      { re: /(?:forfait|provision)[^\n]{0,80}?charges[^\n]{0,200}?(?:montant (?:forfaitaire|annuel|provisionnel)\s*(?:de|d'))?\s*NUM\s*(?:€|euros?|eur)/, g: 1 },
      { re: /charges[^\n]{0,200}?montant (?:forfaitaire|annuel|provisionnel)[^\n]{0,40}?NUM\s*(?:€|euros?|eur)/, g: 1 },
      { re: /charges[^\n]{0,300}?NUM\s*(?:€|euros?|eur)\s*(?:ht|hors taxes?)?\s*(?:\/|par)\s*m[²2]/, g: 1, conf: 'doute', perM2: true },
      { re: /charges[^\n]{0,200}?NUM\s*(?:€|euros?|eur)/, g: 1, conf: 'doute' }] },
    { key: 'chargesMode', label: 'Charges : mode', type: 'enum', rules: [{ re: /forfait de charges|montant forfaitaire|charges[^\n]{0,60}forfaitaire/, value: 'forfait' }, { re: /provision (?:pour|sur) charges|provision[^\n]{0,40}charges/, value: 'provision' }] },
    { key: 'chargesPeriodicite', label: 'Charges : périodicité', type: 'enum', rules: [
      { re: /(?:forfait|provision)[^\n]{0,200}?(?:appel\w*|pay\w*|vers\w*|factur\w*)[^\n]{0,40}?mensuellement/, value: 'mensuel' }, { re: /(?:forfait|provision)[^\n]{0,200}?(?:appel\w*|pay\w*|vers\w*|factur\w*)[^\n]{0,40}?trimestriellement/, value: 'trimestriel' },
      { re: /charges[^\n]{0,120}?mensuellement/, value: 'mensuel', conf: 'doute' }, { re: /charges[^\n]{0,120}?trimestriellement/, value: 'trimestriel', conf: 'doute' }] },
    { key: 'taxeFonciere', label: 'Taxe foncière refacturée', type: 'bool', rules: [{ re: /(?:impot|taxe) fonci[eè]re?[^\n]{0,200}?(?:rembours|refactur|a la charge du preneur|supporte)/, value: true }, { re: /taxe fonciere/, value: true, conf: 'doute' }] },
    { key: 'tvaOption', label: 'Option TVA', type: 'bool', rules: [{ re: /opte[^\n]{0,80}?(?:pour le paiement de la )?tva|assujetti[e]? a la tva|soumis a la tva|majore[es]? de la tva/, value: true }, { re: /exonere[es]? de tva|non soumis a la tva/, value: false }] },
    { key: 'franchiseMois', label: 'Franchise (mois)', type: 'int', rules: [
      { re: /franchise (?:de loyer|totale)?[^\n]{0,80}?(\d+|[a-z-]+)\s*(?:\([^)]*\)\s*)?mois/, fn: m => U.parseInt(m[1]) }, { re: /(\d+|[a-z-]+)\s*(?:\([^)]*\)\s*)?mois de franchise/, fn: m => U.parseInt(m[1]) }] },
    { key: 'destination', label: 'Destination', type: 'text', rules: [
      { re: /(?:sont (?:donnes a bail|loues)|a usage)[^\n]{0,80}?(?:usage|activite)[^\n]{0,40}?:\s*\n?\s*([^\n.]{10,250})/, g: 1, conf: 'doute' },
      { re: /(?:destination|activite autorisee)[^\n]{0,40}\n+(?:[^\n]{0,80}\n)?\s*([^\n]{10,250})/, g: 1, conf: 'doute', nl: true }] },
    { key: 'emailFacturation', label: 'Email facturation', type: 'text', rules: [{ re: /factures?[^\n]{0,120}?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/, g: 1 }, { re: /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/, g: 1, conf: 'doute' }] },
    { key: 'resiliation', label: 'Résiliation anticipée', type: 'text', rules: [{ re: /(faculte de (?:resilier|resiliation)[^\n]{10,250})/, g: 1, conf: 'doute' }, { re: /(resiliation anticipee[^\n]{10,250})/, g: 1, conf: 'doute' }] },
    { key: 'stockageICPE', label: 'Stockage combustible max', type: 'text', rules: [{ re: /quantite maximale de matieres combustibles[^\n]{0,80}?est de\s*(\d[^\n]{0,30}?)(?:\s+dans|\s+par|\.|$)/m, g: 1, conf: 'doute' }] },
  ],
  MOIS_EN: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
  dateEn(m) { const mi = EXTRACT.MOIS_EN[m[2].slice(0, 3)] || (U.MOIS.findIndex(x => x.startsWith(m[2].slice(0, 3))) + 1); return mi ? `${m[3]}-${U.pad(mi)}-${U.pad(+m[1])}` : null; },
  // Construit le texte complet + table offset -> page
  buildText(pages) {
    let orig = '', norm = ''; const pageStarts = [];
    for (const p of pages) { pageStarts.push({ num: p.num, start: norm.length }); const t = p.text + '\n'; orig += t; norm += EXTRACT.normKeepLen(t); }
    // flat : sauts de ligne remplacés par des espaces (même longueur) pour les règles qui ne s'appuient pas sur les lignes
    return { orig, norm, flat: norm.replace(/\n/g, ' '), pageStarts };
  },
  // Normalisation qui conserve la longueur (1 caractère -> 1 caractère) pour garder les offsets alignés
  normKeepLen(s) { return s.normalize('NFC').toLowerCase().replace(/[àâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[îï]/g, 'i').replace(/[ôö]/g, 'o').replace(/[ùûü]/g, 'u').replace(/ç/g, 'c').replace(/œ/g, 'o').replace(/[  ]/g, ' ').replace(/[’‘`´]/g, "'").replace(/[«»“”]/g, '"'); },
  pageAt(ctx, off) { let p = 1; for (const ps of ctx.pageStarts) if (off >= ps.start) p = ps.num; return p; },
  compileRe(re) { const src = re.source.replace(/NUMCUR/g, EXTRACT.NUM + EXTRACT.CUR).replace(/NUM/g, EXTRACT.NUM).replace(/DATE/g, EXTRACT.DATE); return new RegExp(src, re.flags + (re.flags.includes('d') ? '' : 'd')); },
  hayFor(r, ctx) { return r.nl ? ctx.norm : ctx.flat; },
  convert(type, raw, rule) {
    if (raw === null || raw === undefined) return null;
    switch (type) {
      case 'num': return U.parseNum(String(raw));
      case 'int': return typeof raw === 'number' ? raw : U.parseInt(raw);
      case 'date': return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : U.parseDate(raw);
      case 'bool': return !!raw;
      default: return String(raw).replace(/\s+/g, ' ').trim();
    }
  },
  // Exécute toutes les règles ; renvoie {champ: {value, conf, page, snippet, offset}}
  run(pages, learned = {}) {
    const ctx = EXTRACT.buildText(pages); const out = {};
    for (const f of EXTRACT.FIELDS) {
      let res = null;
      // 1. ancres apprises
      for (const a of (learned[f.key] || [])) { res = EXTRACT.tryAnchor(ctx, f, a); if (res) { res.conf = 'ok'; res.learned = true; break; } }
      // 2. règles
      if (!res) for (const r of f.rules) {
        const re = EXTRACT.compileRe(r.re); const hay = EXTRACT.hayFor(r, ctx); let m;
        if (r.fnAll) { const ms = []; let x; while ((x = re.exec(hay)) && ms.length < 50) ms.push(x); m = r.fnAll(ms, hay); }
        else m = re.exec(hay);
        if (!m) continue;
        if (/\.{5,}/.test(m[0])) continue; // ligne de sommaire
        m.o = (g) => m.indices && m.indices[g] ? ctx.orig.slice(m.indices[g][0], m.indices[g][1]) : m[g]; // texte original d'un groupe
        let raw;
        if (r.fn) raw = r.fn(m); else if (r.value !== undefined) raw = r.value;
        else { const g = r.g || 1; raw = m[g]; if (f.type === 'text' && raw) { const gi = m.indices && m.indices[g] ? m.indices[g][0] : m.index + m[0].indexOf(raw); raw = ctx.orig.slice(gi, gi + raw.length); } }
        let value = EXTRACT.convert(f.type, raw, r);
        if (value === null || value === '' || (typeof value === 'number' && isNaN(value))) continue;
        if (r.perM2) value = { perM2: value };
        res = { value, conf: m.sure ? 'ok' : (r.conf || 'ok'), offset: m.index, page: EXTRACT.pageAt(ctx, m.index), snippet: EXTRACT.snippet(ctx.orig, m.index, m[0].length) };
        break;
      }
      out[f.key] = res || { value: null, conf: 'absent' };
    }
    EXTRACT.postProcess(out, ctx);
    return { fields: out, ctx };
  },
  snippet(orig, off, len) { const a = Math.max(0, off - 60), b = Math.min(orig.length, off + len + 60); return (a > 0 ? '…' : '') + orig.slice(a, b).replace(/\s+/g, ' ') + (b < orig.length ? '…' : ''); },
  // Ancre apprise : {before: texte normalisé précédant la valeur (≈40 car.), type}
  tryAnchor(ctx, f, a) {
    const i = ctx.flat.indexOf(a.before); if (i < 0) return null;
    const start = i + a.before.length; const rest = ctx.flat.slice(start, start + 200);
    let re; switch (f.type) {
      case 'num': re = new RegExp('^\\s*' + EXTRACT.NUM); break; case 'int': re = /^\s*(\d+|[a-z-]+)/; break;
      case 'date': re = new RegExp('^\\s*' + EXTRACT.DATE); break; case 'trim': re = /^\s*(\d)(?:er|eme|e)?\s*trimestre\s*(?:de\s*)?(?:l'annee\s*)?(\d{4})/; break;
      default: re = /^\s*([^\n]{1,80})/; }
    const m = re.exec(rest); if (!m) return null;
    let value = f.type === 'trim' ? `${m[2]}T${m[1]}` : EXTRACT.convert(f.type, f.type === 'text' ? ctx.orig.slice(start + m.index, start + m.index + m[0].length) : m[1]);
    if (f.type === 'enum') value = a.value; if (f.type === 'bool') value = a.value;
    if (value === null) return null;
    return { value, conf: 'ok', offset: start, page: EXTRACT.pageAt(ctx, start), snippet: EXTRACT.snippet(ctx.orig, i, a.before.length + m[0].length) };
  },
  // Apprend une ancre à partir d'une valeur corrigée par l'utilisateur
  learn(learned, field, value, pages) {
    const f = EXTRACT.FIELDS.find(x => x.key === field); if (!f || value === null || value === '' || !pages) return learned;
    const ctx = EXTRACT.buildText(pages); const cands = EXTRACT.valueForms(f.type, value);
    for (const c of cands) {
      const i = ctx.flat.indexOf(c); if (i < 0) continue;
      const before = ctx.flat.slice(Math.max(0, i - 40), i).replace(/^\S*\s/, ''); if (before.length < 8) continue;
      learned[field] = (learned[field] || []).filter(a => a.before !== before); learned[field].unshift({ before, value: (f.type === 'enum' || f.type === 'bool') ? value : undefined });
      learned[field] = learned[field].slice(0, 12); break;
    }
    return learned;
  },
  valueForms(type, v) {
    if (type === 'num') { const n = +v; const fr = n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ | /g, ' '); return [fr, fr.replace(/ /g, '.'), fr.replace(/ /g, ''), n.toFixed(2).replace('.', ','), fr.replace(/ /g, '.') + ',00', String(n)]; }
    if (type === 'date') { const [y, m, d] = v.split('-'); return [`${+d}${+d === 1 ? 'er' : ''} ${EXTRACT.normKeepLen(U.MOIS[+m - 1])} ${y}`, `${+d} ${EXTRACT.normKeepLen(U.MOIS[+m - 1])} ${y}`, `${d}/${m}/${y}`]; }
    if (type === 'trim') { const p = U.parseTrim(v); return p ? [`${p.q}er trimestre ${p.y}`, `${p.q}eme trimestre ${p.y}`, `${p.q}e trimestre ${p.y}`, `${p.q}eme trimestre de l'annee ${p.y}`, `${p.q}er trimestre de l'annee ${p.y}`] : []; }
    if (type === 'int') { const n = +v; const mot = Object.entries(U.motsNombre).find(([k, x]) => x === n); return [String(n), mot ? mot[0] : null].filter(Boolean); }
    return [EXTRACT.normKeepLen(String(v))];
  },
  // Cohérence et déductions
  postProcess(out, ctx) {
    const g = k => out[k] && out[k].value;
    if (!g('terme') && g('periodicite')) out.terme = { value: 'echoir', conf: 'doute', deduit: true };
    if (g('dateEffet') && !g('dateFin') && g('dureeMois')) out.dateFin = { value: U.addDays(U.addMonths(g('dateEffet'), g('dureeMois')), -1), conf: 'doute', deduit: true };
    if (g('dateEffet') && g('dateFin') && !g('dureeMois')) { const d = U.fromISO(g('dateEffet')), e = U.fromISO(g('dateFin')); const m = (e.getFullYear() - d.getFullYear()) * 12 + e.getMonth() - d.getMonth() + (e.getDate() >= d.getDate() - 1 ? 1 : 0); out.dureeMois = { value: m, conf: 'doute', deduit: true }; }
    if (!g('indexRevisionPeriode') && g('indexBasePeriode')) out.indexRevisionPeriode = { value: U.trimAdd(g('indexBasePeriode'), 4), conf: 'doute', deduit: true };
    if (!g('indexPremiereDate') && g('dateEffet')) out.indexPremiereDate = { value: U.addMonths(g('dateEffet'), 12), conf: 'doute', deduit: true };
    if (g('chargesMontant') && typeof g('chargesMontant') === 'object') { const s = g('surfaceTotale'); out.chargesMontant = { ...out.chargesMontant, value: s ? U.round2(g('chargesMontant').perM2 * s) : null, conf: 'doute', note: `${g('chargesMontant').perM2} €/m²` }; }
    if (g('depotMontant') && g('loyerAnnuelHT') && !g('depotMois')) { const r = g('depotMontant') / (g('loyerAnnuelHT') / 12); if (Math.abs(r - Math.round(r)) < 0.05) out.depotMois = { value: Math.round(r), conf: 'doute', deduit: true }; }
    // Anomalies détectées
    const anomalies = [];
    if (g('depotMontant') && g('depotMois') && g('loyerAnnuelHT')) { const attendu = g('loyerAnnuelHT') / 12 * g('depotMois'); if (Math.abs(attendu - g('depotMontant')) > 1) anomalies.push(`Dépôt de garantie ${U.fmtMoney(g('depotMontant'))} € ≠ ${g('depotMois')} mois de loyer (${U.fmtMoney(attendu)} €)`); }
    if (/trois\s*\(?3?\)?\s*mois de loyer/.test(ctx.norm) && g('depotMois') && g('depotMois') !== 3) anomalies.push('Le texte mentionne aussi un dépôt de trois mois (contradiction conditions particulières / générales ?)');
    if (g('loyerAnnuelHT') && g('surfaceTotale')) { const pm2 = g('loyerAnnuelHT') / g('surfaceTotale'); if (pm2 < 20 || pm2 > 1200) anomalies.push(`Loyer au m² inhabituel : ${U.fmtMoney(pm2)} €/m²/an`); }
    if (g('dateEffet') && g('dateFin') && g('dateFin') < g('dateEffet')) anomalies.push('Date de fin antérieure à la date d\'effet');
    if (g('type') === 'derogatoire' && g('dureeMois') > 36) anomalies.push('Bail dérogatoire de plus de 36 mois');
    out._anomalies = anomalies;
  },
  // Lignes de loyer : lit la décomposition "- 204.000 € ... lot B1 / - 2.700 € ... parkings"
  rentLines(pages, total) {
    const ctx = EXTRACT.buildText(pages); const lines = [];
    const re = new RegExp('(?:^|\\n)\\s*[-•]\\s*' + EXTRACT.NUM + '\\s*(?:€|euros?|eur)?[^\\n]{0,20}?(?:au titre d[eu]s?|pour|correspondant a[ux]*)?\\s*([^\\n]{3,80})', 'g');
    let m, i = 0; const start = ctx.norm.search(/se decomposant comme suit|decompose comme suit|ventile comme suit/); const zone = start >= 0 ? ctx.norm.slice(start, start + 800) : '';
    while (zone && (m = re.exec(zone)) && i < 8) {
      const v = U.parseNum(m[1]); if (!v) continue; i++; const libN = m[2].trim(); const gi = start + m.index + m[0].lastIndexOf(m[2]); const lib = ctx.orig.slice(gi, gi + m[2].length).trim().replace(/^(au titre d[eu]s?|pour|correspondant aux?)\s+/i, '');
      const lotM = /\blots?\s+(?:n°\s*)?([a-z]?\d{1,4}[a-z]?(?:\s*(?:,|et|&)\s*[a-z]?\d{1,4}[a-z]?)*)/.exec(libN);
      lines.push({ libelle: lib, lot: lotM ? lotM[1].toUpperCase().replace(/\s+/g, ' ') : '', type: /parking|stationnement/.test(libN) ? 'parking' : /entrepot|activite|stockage/.test(libN) ? 'entrepot' : 'bureau', montantAnnuelHT: v });
    }
    const sum = lines.reduce((s, l) => s + l.montantAnnuelHT, 0);
    if (lines.length && total && Math.abs(sum - total) > 1) lines.forEach(l => l.doute = true);
    return lines;
  },
  // Tableau des lots : fusionne lignes de loyer, surfaces par usage et numéros de lot
  lots(pages, total, lotsTexte) {
    const lines = EXTRACT.rentLines(pages, total); const surfaces = EXTRACT.surfaces(pages);
    const lotNums = String(lotsTexte || '').toUpperCase().split(/\s*(?:,|ET|&)\s*/).map(x => x.trim()).filter(Boolean);
    const typeOf = u => /bureau/.test(u) ? 'bureau' : /parking|stationnement/.test(u) ? 'parking' : 'entrepot';
    const out = [];
    if (lines.length) {
      for (const l of lines) {
        const sf = surfaces.find(sx => !sx.used && typeOf(sx.usage) === l.type); if (sf) sf.used = true;
        out.push({ lot: l.lot || (l.type === 'parking' ? '' : lotNums[0] || ''), type: l.type, surface: sf ? sf.surface : null, montantAnnuelHT: l.montantAnnuelHT, unitCode: '', libelle: l.libelle, doute: l.doute });
      }
    } else if (lotNums.length) {
      lotNums.forEach((n, i) => { const sf = surfaces[i]; out.push({ lot: n, type: sf ? typeOf(sf.usage) : 'bureau', surface: sf ? sf.surface : null, montantAnnuelHT: null, unitCode: '' }); });
    } else if (surfaces.length) surfaces.forEach(sx => out.push({ lot: '', type: typeOf(sx.usage), surface: sx.surface, montantAnnuelHT: null, unitCode: '' }));
    else if (total) out.push({ lot: '', type: 'bureau', surface: null, montantAnnuelHT: total, unitCode: '' });
    // Surfaces restantes non rattachées -> lots supplémentaires sans montant
    for (const sx of surfaces) if (!sx.used && !out.some(o => o.surface === sx.surface)) out.push({ lot: '', type: typeOf(sx.usage), surface: sx.surface, montantAnnuelHT: null, unitCode: '' });
    if (total && out.some(o => o.montantAnnuelHT === null)) CALC.repartir({ lots: out }, total);
    return out;
  },
  // Surfaces par usage : cherche des paires "NNN m²" avec libellé proche
  surfaces(pages) {
    const ctx = EXTRACT.buildText(pages); const out = []; const re = /(bureaux?|activite|entrepot|stockage|archives?|local technique|mezzanine|showroom|commerce|laboratoire)[^\n]{0,60}?(?<![a-z0-9])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,2})?)\s*m[²2]/g; let m, n = 0;
    while ((m = re.exec(ctx.norm)) && n < 12) { const v = U.parseNum(m[2]); if (v && v > 5) { out.push({ usage: m[1], surface: v }); n++; } }
    return out;
  },
};
