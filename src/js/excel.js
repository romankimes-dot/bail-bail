'use strict';
// ---------- Export Excel (SheetJS) ----------
const EXCEL = {
  sheet(wb, name, rows, header) {
    const ws = XLSX.utils.json_to_sheet(rows, header ? { header } : undefined);
    const widths = (header || Object.keys(rows[0] || {})).map(h => ({ wch: Math.min(50, Math.max(h.length + 2, ...rows.slice(0, 200).map(r => String(r[h] ?? '').length + 2))) }));
    ws['!cols'] = widths; XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  },
  flatBail(b) {
    const ix = b.index || {}, ch = b.charges || {}, dp = b.depot || {}, tv = b.tva || {};
    return {
      'Référence': b.ref, 'Statut': b.statut, 'Type': b.type, 'Actif': b.actif, 'Bâtiment': b.batiment, 'Adresse': b.adresse, 'Surface totale m²': b.surfaceTotale,
      'Lots': (Array.isArray(b.lots) ? b.lots.map(l => l.lot).filter(Boolean).join(', ') : b.lotsTexte), 'Parkings': b.parkingsNombre, 'N° parkings': b.parkingsNumeros, 'Bailleur': b.bailleur, 'Preneur': b.preneur, 'Enseigne': b.enseigne, 'SIREN': b.siren, 'Email facturation': b.emailFacturation,
      'Date signature': b.dateSignature, "Date d'effet": b.dateEffet, 'Date fin': b.dateFin, 'Durée (mois)': b.dureeMois, 'Loyer annuel HT': CALC.loyerAnnuel(b), 'Périodicité': b.periodicite, 'Terme': b.terme, 'Prorata': b.prorata,
      'Franchise (mois)': b.franchiseMois, 'Indice': ix.type, 'Indice base période': ix.basePeriode, 'Indice base valeur': ix.baseValeur, 'Indice révision période': ix.revisionPeriode, 'Première indexation': ix.premiereDate, 'Plafond %': ix.plafond,
      'Dépôt €': dp.montant, 'Dépôt mois': dp.mois, 'Charges mode': ch.mode, 'Charges annuelles HT': ch.montantAnnuelHT, 'Charges périodicité': ch.periodicite, 'Taxe foncière refacturée': ch.taxeFonciere ? 'oui' : 'non', 'Taxe foncière €': ch.taxeFonciereMontant,
      'TVA option': tv.option === false ? 'non' : 'oui', 'TVA taux': tv.taux ?? 20, 'Destination': b.destination, 'Résiliation anticipée': b.resiliation, 'Tenant id Yardi': (b.yardi && b.yardi.tenantCodes || []).join(', '), 'N° actif Yardi': b.yardi && b.yardi.propertyCode || '',
      'Anomalies': (b.anomalies || []).join(' ; '), 'Commentaires': b.commentaires, 'Fichier PDF': b.pdfName, 'OCR': b.ocr ? 'oui' : 'non', 'Mis à jour': b.updated,
    };
  },
  async exportBase(baux, indices, quittance, rapprochement, app) {
    const wb = XLSX.utils.book_new();
    const rows = baux.map(b => { const o = EXCEL.flatBail(b); if (app) { o['Avenant de'] = b.parentId ? ((app.baux.find(p => p.id === b.parentId) || {}).ref || '') : ''; o['État'] = b.parentId ? '' : (app.etatOf(b) === 'sorti' ? 'sorti' : 'en cours'); } return o; });
    EXCEL.sheet(wb, 'Baux', rows);
    const lots = baux.flatMap(b => (Array.isArray(b.lots) ? b.lots : []).map(l => ({ 'Référence': b.ref, 'Preneur': b.preneur, 'Actif': b.actif, 'N° lot': l.lot, 'Type': l.type, 'Surface m²': l.surface, 'Loyer annuel HT': l.montantAnnuelHT, 'Code lot Yardi': l.unitCode, 'Code charge': CALC.code(l.type) })));
    if (lots.length) EXCEL.sheet(wb, 'Lots', lots);
    const paliers = baux.flatMap(b => (b.paliers || []).map(p => ({ 'Référence': b.ref, 'Du': p.du, 'Au': p.au, 'Loyer annuel HT': p.montantAnnuelHT })));
    if (paliers.length) EXCEL.sheet(wb, 'Paliers', paliers);
    const avenants = baux.flatMap(b => (b.avenants || []).map(a => ({ 'Référence': b.ref, 'Date': a.date, 'Objet': a.objet, 'Détail': a.texte })));
    if (avenants.length) EXCEL.sheet(wb, 'Avenants', avenants);
    if (indices) EXCEL.sheet(wb, 'Indices', indices.sort((a, b) => a.type.localeCompare(b.type) || a.periode.localeCompare(b.periode)).map(i => ({ 'Indice': i.type, 'Période': i.periode, 'Valeur': i.valeur, 'Vérifié': i.verifie ? 'oui' : 'non', 'Source': i.source })));
    if (quittance && quittance.length) EXCEL.sheet(wb, 'Quittancement', quittance.map(EXCEL.flatQ));
    if (rapprochement && rapprochement.length) EXCEL.sheet(wb, 'Rapprochement Yardi', rapprochement.map(EXCEL.flatR));
    XLSX.writeFile(wb, `baux_${U.toISO(new Date())}.xlsx`);
  },
  // CSV (séparateur ; UTF-8 BOM) des tables de calcul, avec le détail de l'indexation et des jours
  csvQuittance(lignes, name) {
    const cols = ['Référence', 'Preneur', 'Tenant id', 'Actif', 'N° actif', 'N° lot', 'Code lot', 'Du', 'Au', 'Jours', 'Jours période', 'Libellé', 'Code charge', 'Base période HT', 'Détail indexation', 'Coef. indexation', 'Prorata', 'Franchise', 'HT', 'Taux TVA', 'TVA', 'TTC', 'Note'];
    const row = l => [l.ref, l.preneur, l.tenantCode, l.actif, l.propertyCode, l.lot, l.unitCode, U.fmtDate(l.du), U.fmtDate(l.au), l.jours, l.joursPeriode, l.libelle, l.chargeCode, l.base !== undefined ? U.round2(l.base) : '', l.indexDetail || '', U.round2(l.coef * 10000) / 10000, U.round2(l.prorata * 10000) / 10000, l.franchise ? U.round2(l.franchise * 100) + ' %' : '', l.ht, l.tauxTva, l.tva, l.ttc, l.note || ''];
    const esc = v => { const s = String(v ?? '').replace(/\r?\n/g, ' '); return typeof v === 'number' ? String(v).replace('.', ',') : /[;"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const txt = [cols, ...lignes.map(row)].map(r => r.map(esc).join(';')).join('\r\n');
    U.download(name, '\ufeff' + txt, 'text/csv;charset=utf-8');
  },
  flatQ(l) { return { 'Référence': l.ref, 'Preneur': l.preneur, 'Tenant id': l.tenantCode, 'Actif': l.actif, 'N° actif': l.propertyCode, 'Property (Yardi)': l.yardiProperty, 'Tenant (Yardi)': l.yardiTenant, 'N° lot': l.lot, 'Code lot': l.unitCode, 'Du': l.du, 'Au': l.au, 'Type': l.type, 'Code charge': l.chargeCode, 'Libellé': l.libelle, 'Base période HT': l.base !== undefined ? U.round2(l.base) : '', 'Coef. indexation': U.round2(l.coef * 10000) / 10000, 'Prorata': U.round2(l.prorata * 10000) / 10000, 'Franchise': l.franchise ? U.round2(l.franchise * 100) + ' %' : '', 'HT': l.ht, 'Taux TVA': l.tauxTva, 'TVA': l.tva, 'TTC': l.ttc, 'Note': l.note || '' }; },
  flatR(r) { return { 'Référence': r.ref, 'Preneur': r.preneur, 'Actif': r.actif, 'Codes Yardi': r.tenantCodes, 'Code charge': r.chargeCode, 'Période': r.mois, 'Yardi HT': r.yardi, 'Calcul HT': r.calcul, 'Écart': r.ecart, 'Statut': r.statut, 'Avertissements': r.warnings || r.note || '' }; },
  // ----- Classeur de vérification : colonnes essentielles d'abord, puis non essentielles (marquées) -----
  verifCols() { return UI.FORM.filter(f => !f.group && f.key !== 'statut').sort((a, b) => (b.ess ? 1 : 0) - (a.ess ? 1 : 0)).map(f => ({ ...f, col: f.ess ? f.label : `${f.label} (non essentiel)` })); },
  verifValue(f, b) { if (f.key === 'yardiTenant') return (b.yardi && b.yardi.tenantCodes || []).join(', '); const v = UI.getPath(b, f.path || f.key); if (v === null || v === undefined) return ''; if (f.type === 'bool') return v ? 'oui' : 'non'; if (f.type === 'enum' && f.labels) return f.labels[v] || v; return v; },
  exportVerif(baux, vide) {
    const wb = XLSX.utils.book_new(); const cols = EXCEL.verifCols();
    const rows = (vide ? [{}] : baux).map(b => { const o = { 'Référence': b.ref || '', 'Statut': UI.statutLabel[b.statut] || b.statut || '' }; for (const f of cols) if (f.key !== 'ref') o[f.col] = EXCEL.verifValue(f, b); o['Commentaire vérificateur'] = ''; return o; });
    EXCEL.sheet(wb, 'Baux', rows, Object.keys(rows[0]));
    const lots = (vide ? [{ ref: 'REF', lots: [{}] }] : baux).flatMap(b => (Array.isArray(b.lots) ? b.lots : []).map(l => ({ 'Référence': b.ref, 'N° lot': l.lot ?? '', 'Type': l.type ?? 'bureau', 'Surface m²': l.surface ?? '', 'Loyer annuel HT': l.montantAnnuelHT ?? '', 'Code lot Yardi': l.unitCode ?? '' })));
    EXCEL.sheet(wb, 'Lots', lots.length ? lots : [{ 'Référence': '', 'N° lot': '', 'Type': '', 'Surface m²': '', 'Loyer annuel HT': '', 'Code lot Yardi': '' }]);
    const aide = [
      { 'Consigne': 'Une ligne par bail dans l\'onglet Baux ; la colonne Référence sert de clé pour mettre à jour le bail correspondant dans l\'application.' },
      { 'Consigne': 'Colonnes essentielles en premier ; les colonnes marquées « (non essentiel) » sont facultatives.' },
      { 'Consigne': 'Dates au format JJ/MM/AAAA ; montants en euros HT ; trimestres d\'indice au format AAAATn (ex. 2024T4).' },
      { 'Consigne': 'Périodicité : mensuel / trimestriel / semestriel / annuel. Type de bail : commercial, derogatoire, precaire, professionnel, civil, autre. Oui/non pour les cases à cocher.' },
      { 'Consigne': 'Statut : Validé, À vérifier, Extrait, Anomalie. Mettre « Validé » une fois le bail contrôlé.' },
      { 'Consigne': 'Onglet Lots : une ligne par lot (type : bureau, entrepot, activite, parking, autre). Une Référence absente de l\'application crée un nouveau bail sans PDF.' },
    ]; EXCEL.sheet(wb, 'Aide', aide);
    XLSX.writeFile(wb, vide ? 'modele_verification_baux.xlsx' : `verification_baux_${U.toISO(new Date())}.xlsx`);
  },
  // Lecture d'un classeur de vérification -> [{ref, statut, champs:{key:value}, lots:[...]}]
  parseVerif(ab) {
    const wb = XLSX.read(ab, { type: 'array', cellDates: true }); const cols = EXCEL.verifCols();
    const norm = h => U.norm(h).replace(/\s*\(non essentiel\)\s*$/, '').trim();
    const byLabel = new Map(cols.map(f => [norm(f.label), f]));
    const wsB = wb.Sheets['Baux'] || wb.Sheets[wb.SheetNames[0]]; if (!wsB) throw new Error('Onglet Baux introuvable');
    const rowsB = XLSX.utils.sheet_to_json(wsB, { header: 1, raw: true }); const head = (rowsB[0] || []).map(h => norm(String(h || ''))); const out = [];
    const iRef = head.indexOf('reference'), iSt = head.indexOf('statut'); if (iRef < 0) throw new Error('Colonne Référence introuvable dans l\'onglet Baux');
    const stMap = Object.fromEntries(Object.entries(UI.statutLabel).map(([k, v]) => [U.norm(v), k]));
    for (const r of rowsB.slice(1)) {
      const ref = String(r[iRef] || '').trim(); if (!ref) continue; const rec = { ref, champs: {}, lots: null };
      if (iSt >= 0 && r[iSt]) rec.statut = stMap[U.norm(r[iSt])] || null;
      head.forEach((h, i) => { const f = byLabel.get(h); if (!f || f.key === 'ref' || r[i] === undefined || r[i] === null || r[i] === '') return; rec.champs[f.key] = EXCEL.parseCell(f, r[i]); });
      out.push(rec);
    }
    const wsL = wb.Sheets['Lots'];
    if (wsL) { const rowsL = XLSX.utils.sheet_to_json(wsL, { raw: true }); for (const l of rowsL) { const ref = String(l['Référence'] || '').trim(); const rec = out.find(x => x.ref === ref); if (!rec) continue; (rec.lots ||= []).push({ lot: String(l['N° lot'] ?? ''), type: U.norm(l['Type'] || 'bureau') || 'bureau', surface: U.parseNum(l['Surface m²']), montantAnnuelHT: U.parseNum(l['Loyer annuel HT']), unitCode: String(l['Code lot Yardi'] ?? '') }); } }
    return out;
  },
  parseCell(f, v) {
    if (typeof v === 'number') { if (f.type === 'num') return v; if (f.type === 'int') return Math.round(v); if (f.type === 'date') { const d = XLSX.SSF.parse_date_code(v); return d ? U.validDate(d.y, d.m, d.d) : null; } v = String(v); }
    if (v instanceof Date) return f.type === 'date' ? U.parseDate(v) : U.toISO(v);
    v = String(v).trim();
    if (f.type === 'num') return U.parseNum(v); if (f.type === 'int') return U.parseInt(v) ?? (U.parseNum(v) !== null ? Math.round(U.parseNum(v)) : null);
    if (f.type === 'date') return U.parseDate(v); if (f.type === 'bool') return /^(oui|o|yes|y|1|true|x)$/i.test(v) ? true : /^(non|n|no|0|false)$/i.test(v) ? false : null;
    if (f.type === 'enum') { const n = U.norm(v); const hit = (f.opts || []).find(o => U.norm(o) === n || (f.labels && U.norm(f.labels[o]) === n)); return hit || null; }
    if (f.type === 'trim') return INDICES.normPeriode(v) || v;
    return v;
  },
  // Modèle d'export Yardi attendu pour l'import
  yardiTemplate() {
    const wb = XLSX.utils.book_new();
    const rows = [{ 'Property': 'Nom du parc (fr101901)', 'Tenant': 'NOM LOCATAIRE Lot B1 (A00OF030-t0000859)', 'Unit': 'A00OF030', 'Description': 'Rent Office', 'Charge Code': 'un_ro_t', 'Currency': 'eur', 'Net': '1 456,32', 'VAT': '291,26', 'Tax 2': '0,00', 'Total Amount': '1 747,58', 'Charge From': '01/01/2027', 'Charge To': '31/03/2027', 'Last Period': '', 'Variance': '' }];
    EXCEL.sheet(wb, 'Export Yardi', rows); XLSX.writeFile(wb, 'modele_export_yardi.xlsx');
  },
  exportQuittance(lignes) { const wb = XLSX.utils.book_new(); EXCEL.sheet(wb, 'Quittancement', lignes.map(EXCEL.flatQ)); XLSX.writeFile(wb, `quittancement_${U.toISO(new Date())}.xlsx`); },
  exportRapprochement(rows) { const wb = XLSX.utils.book_new(); EXCEL.sheet(wb, 'Rapprochement', rows.map(EXCEL.flatR)); const corr = rows.filter(r => r.statut !== 'OK'); if (corr.length) EXCEL.sheet(wb, 'Corrections à faire', corr.map(EXCEL.flatR)); XLSX.writeFile(wb, `rapprochement_yardi_${U.toISO(new Date())}.xlsx`); },
};
