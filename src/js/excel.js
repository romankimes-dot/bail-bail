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
      'Référence': b.ref, 'Statut': b.statut, 'Type': b.type, 'Actif': b.actif, 'Bâtiment': b.batiment, 'Adresse': b.adresse, 'Lots': b.lots, 'Surface totale m²': b.surfaceTotale,
      'Parkings': b.parkingsNombre, 'N° parkings': b.parkingsNumeros, 'Bailleur': b.bailleur, 'Preneur': b.preneur, 'Enseigne': b.enseigne, 'SIREN': b.siren, 'Email facturation': b.emailFacturation,
      'Date signature': b.dateSignature, "Date d'effet": b.dateEffet, 'Date fin': b.dateFin, 'Durée (mois)': b.dureeMois, 'Loyer annuel HT': CALC.loyerAnnuel(b), 'Périodicité': b.periodicite, 'Terme': b.terme, 'Prorata': b.prorata,
      'Franchise (mois)': b.franchiseMois, 'Indice': ix.type, 'Indice base période': ix.basePeriode, 'Indice base valeur': ix.baseValeur, 'Première indexation': ix.premiereDate, 'Plafond %': ix.plafond,
      'Dépôt €': dp.montant, 'Dépôt mois': dp.mois, 'Charges mode': ch.mode, 'Charges annuelles HT': ch.montantAnnuelHT, 'Charges périodicité': ch.periodicite, 'Taxe foncière refacturée': ch.taxeFonciere ? 'oui' : 'non', 'Taxe foncière €': ch.taxeFonciereMontant,
      'TVA option': tv.option === false ? 'non' : 'oui', 'TVA taux': tv.taux ?? 20, 'Destination': b.destination, 'Résiliation anticipée': b.resiliation, 'Codes locataire Yardi': (b.yardi && b.yardi.tenantCodes || []).join(', '), 'Codes lot Yardi': (b.yardi && b.yardi.unitCodes || []).join(', '),
      'Anomalies': (b.anomalies || []).join(' ; '), 'Commentaires': b.commentaires, 'Fichier PDF': b.pdfName, 'OCR': b.ocr ? 'oui' : 'non', 'Mis à jour': b.updated,
    };
  },
  async exportBase(baux, indices, quittance, rapprochement) {
    const wb = XLSX.utils.book_new();
    EXCEL.sheet(wb, 'Baux', baux.map(EXCEL.flatBail));
    const lignes = baux.flatMap(b => (b.lignes || []).map(l => ({ 'Référence': b.ref, 'Preneur': b.preneur, 'Libellé': l.libelle, 'Type': l.type, 'Code Yardi': CALC.code(l.type), 'Montant annuel HT': l.montantAnnuelHT, 'Surface m²': l.surface })));
    if (lignes.length) EXCEL.sheet(wb, 'Lignes de loyer', lignes);
    const surfaces = baux.flatMap(b => (b.surfaces || []).map(s => ({ 'Référence': b.ref, 'Preneur': b.preneur, 'Usage': s.usage, 'Surface m²': s.surface })));
    if (surfaces.length) EXCEL.sheet(wb, 'Surfaces', surfaces);
    const paliers = baux.flatMap(b => (b.paliers || []).map(p => ({ 'Référence': b.ref, 'Du': p.du, 'Au': p.au, 'Loyer annuel HT': p.montantAnnuelHT })));
    if (paliers.length) EXCEL.sheet(wb, 'Paliers', paliers);
    const avenants = baux.flatMap(b => (b.avenants || []).map(a => ({ 'Référence': b.ref, 'Date': a.date, 'Objet': a.objet, 'Détail': a.texte })));
    if (avenants.length) EXCEL.sheet(wb, 'Avenants', avenants);
    if (indices) EXCEL.sheet(wb, 'Indices', indices.sort((a, b) => a.type.localeCompare(b.type) || a.periode.localeCompare(b.periode)).map(i => ({ 'Indice': i.type, 'Période': i.periode, 'Valeur': i.valeur, 'Vérifié': i.verifie ? 'oui' : 'non', 'Source': i.source })));
    if (quittance && quittance.length) EXCEL.sheet(wb, 'Quittancement', quittance.map(EXCEL.flatQ));
    if (rapprochement && rapprochement.length) EXCEL.sheet(wb, 'Rapprochement Yardi', rapprochement.map(EXCEL.flatR));
    XLSX.writeFile(wb, `baux_${U.toISO(new Date())}.xlsx`);
  },
  flatQ(l) { return { 'Référence': l.ref, 'Preneur': l.preneur, 'Actif': l.actif, 'Du': l.du, 'Au': l.au, 'Type': l.type, 'Code Yardi': l.chargeCode, 'Libellé': l.libelle, 'Base période HT': l.base !== undefined ? U.round2(l.base) : '', 'Coef. indexation': U.round2(l.coef * 10000) / 10000, 'Prorata': U.round2(l.prorata * 10000) / 10000, 'Franchise': l.franchise ? U.round2(l.franchise * 100) + ' %' : '', 'HT': l.ht, 'Taux TVA': l.tauxTva, 'TVA': l.tva, 'TTC': l.ttc, 'Note': l.note || '' }; },
  flatR(r) { return { 'Référence': r.ref, 'Preneur': r.preneur, 'Actif': r.actif, 'Codes Yardi': r.tenantCodes, 'Code charge': r.chargeCode, 'Période': r.mois, 'Yardi HT': r.yardi, 'Calcul HT': r.calcul, 'Écart': r.ecart, 'Statut': r.statut, 'Avertissements': r.warnings || r.note || '' }; },
  exportQuittance(lignes) { const wb = XLSX.utils.book_new(); EXCEL.sheet(wb, 'Quittancement', lignes.map(EXCEL.flatQ)); XLSX.writeFile(wb, `quittancement_${U.toISO(new Date())}.xlsx`); },
  exportRapprochement(rows) { const wb = XLSX.utils.book_new(); EXCEL.sheet(wb, 'Rapprochement', rows.map(EXCEL.flatR)); const corr = rows.filter(r => r.statut !== 'OK'); if (corr.length) EXCEL.sheet(wb, 'Corrections à faire', corr.map(EXCEL.flatR)); XLSX.writeFile(wb, `rapprochement_yardi_${U.toISO(new Date())}.xlsx`); },
};
