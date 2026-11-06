'use strict';
// ---------- Composants d'interface ----------
const STATUT_LABEL = { extrait: 'Extrait', a_verifier: 'À vérifier', valide: 'Validé', anomalie: 'Anomalie' };
const UI = {
  $: (s, el = document) => el.querySelector(s), $$: (s, el = document) => [...el.querySelectorAll(s)],
  toast(msg, ms = 2500) { const t = UI.$('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(UI._tt); UI._tt = setTimeout(() => t.classList.remove('show'), ms); },
  modal(html, onMount) { const m = UI.$('#modal'), b = UI.$('#modal-box'); b.innerHTML = html; m.classList.remove('hidden'); if (onMount) onMount(b); const close = () => m.classList.add('hidden'); UI.$$('[data-close]', b).forEach(x => x.onclick = close); return close; },
  closeModal() { UI.$('#modal').classList.add('hidden'); },
  confirm(msg, { ok = 'Confirmer', danger = false } = {}) { return new Promise(res => { const close = UI.modal(`<p>${msg}</p><div class="row" style="justify-content:flex-end"><button data-close>Annuler</button><button id="m-ok" class="${danger ? 'danger' : 'primary'}">${ok}</button></div>`); UI.$('#m-ok').onclick = () => { close(); res(true); }; UI.$$('[data-close]').forEach(x => x.addEventListener('click', () => res(false))); }); },
  prompt(msg, { type = 'text', value = '' } = {}) { return new Promise(res => { const close = UI.modal(`<p>${msg}</p><form id="m-f"><input id="m-in" type="${type}" value="${U.esc(value)}" autocomplete="off" style="width:100%"><div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" data-close>Annuler</button><button class="primary">OK</button></div></form>`, b => UI.$('#m-in', b).focus()); UI.$('#m-f').onsubmit = e => { e.preventDefault(); const v = UI.$('#m-in').value; close(); res(v); }; UI.$$('[data-close]').forEach(x => x.addEventListener('click', () => res(null))); }); },
  // Tableau triable
  table(cols, rows, { onRow, keyField, sortKey, sortDir = 1, cls = '' } = {}) {
    if (sortKey) rows = [...rows].sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (x === y) return 0; if (x === undefined || x === null || x === '') return 1; if (y === undefined || y === null || y === '') return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * sortDir; });
    const th = cols.map(c => `<th class="${c.num ? 'num' : ''}" data-sort="${c.key}">${U.esc(c.label)}${sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const tr = rows.map((r, i) => `<tr data-i="${i}" ${keyField ? `data-key="${U.esc(r[keyField])}"` : ''}>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r[c.key], r) : (c.num ? U.fmtNum(r[c.key], c.dec ?? 2) : U.esc(r[c.key] ?? ''))}</td>`).join('')}</tr>`).join('');
    const html = `<table class="${cls}"><thead><tr>${th}</tr></thead><tbody>${tr || `<tr><td colspan="${cols.length}" class="muted">Aucune ligne</td></tr>`}</tbody></table>`;
    return { html, rows, bind(el) { if (onRow) UI.$$('tbody tr[data-i]', el).forEach(t => t.onclick = () => onRow(rows[+t.dataset.i], t)); } };
  },
  statutLabel: STATUT_LABEL,
  tag(s) { return `<span class="tag ${s}">${UI.statutLabel[s] || s}</span>`; },
  opts(list, value, labels) { return list.map(v => `<option value="${U.esc(v)}" ${v === value ? 'selected' : ''}>${U.esc(labels ? labels[v] || v : v)}</option>`).join(''); },
  // Définition du formulaire bail : clé, libellé, type, chemin dans l'objet
  FORM: [
    { group: 'Identification' },
    { key: 'ref', ess: true, label: 'Référence', type: 'text' }, { key: 'type', label: 'Type de bail', type: 'enum', opts: ['commercial', 'derogatoire', 'precaire', 'professionnel', 'civil', 'autre'], labels: { commercial: 'Commercial 3/6/9', derogatoire: 'Dérogatoire', precaire: 'Précaire', professionnel: 'Professionnel', civil: 'Civil', autre: 'Autre' } },
    { key: 'statut', ess: true, label: 'Statut', type: 'enum', opts: ['extrait', 'a_verifier', 'valide', 'anomalie'], labels: STATUT_LABEL },
    { key: 'bailleur', label: 'Bailleur', type: 'text' }, { key: 'gestionnaire', label: 'Gestionnaire', type: 'text' },
    { key: 'preneur', ess: true, label: 'Preneur', type: 'text' }, { key: 'enseigne', label: 'Enseigne', type: 'text' }, { key: 'siren', label: 'SIREN preneur', type: 'text' }, { key: 'emailFacturation', label: 'Email facturation', type: 'text' },
    { group: 'Lieux loués' },
    { key: 'actif', ess: true, label: 'Actif / immeuble', type: 'text', list: 'actifs' }, { key: 'adresse', label: 'Adresse', type: 'text' }, { key: 'batiment', label: 'Bâtiment', type: 'text' }, { key: 'lots', label: 'Lot(s) (texte du bail)', type: 'text', path: 'lotsTexte' },
    { key: 'surfaceTotale', ess: true, label: 'Surface totale (m²)', type: 'num' }, { key: 'parkingsNombre', ess: true, label: 'Parkings (nombre)', type: 'int' }, { key: 'parkingsNumeros', ess: true, label: 'Parkings (n°)', type: 'text' },
    { key: 'destination', label: 'Destination', type: 'textarea' }, { key: 'stockageICPE', label: 'Stockage combustible max', type: 'text' },
    { group: 'Durée' },
    { key: 'dateSignature', ess: true, label: 'Date de signature', type: 'date' }, { key: 'dateEffet', ess: true, label: "Date d'effet", type: 'date' }, { key: 'dateFin', ess: true, label: "Date d'expiration", type: 'date' }, { key: 'dureeMois', ess: true, label: 'Durée (mois)', type: 'int' },
    { key: 'resiliation', label: 'Résiliation anticipée', type: 'textarea' },
    { group: 'Loyer et facturation' },
    { key: 'loyerAnnuelHT', ess: true, label: 'Loyer annuel HT total (€)', type: 'num', hint: 'réparti sur les lots au prorata des m²' },
    { key: 'periodicite', ess: true, label: 'Périodicité', type: 'enum', opts: ['mensuel', 'trimestriel', 'semestriel', 'annuel'] }, { key: 'terme', label: 'Terme', type: 'enum', opts: ['echoir', 'echu'], labels: { echoir: 'À échoir (d\'avance)', echu: 'Échu' } },
    { key: 'prorata', label: 'Prorata', type: 'enum', opts: ['jours', '30/360'], labels: { jours: 'Jours réels', '30/360': '30/360' } }, { key: 'franchiseMois', ess: true, label: 'Franchise (mois)', type: 'int' }, { key: 'franchiseDebut', ess: true, label: 'Début franchise', type: 'date', hint: 'vide = date d\'effet' },
    { key: 'tvaOption', label: 'Option TVA', type: 'bool', path: 'tva.option' }, { key: 'tvaTaux', label: 'Taux TVA (%)', type: 'num', path: 'tva.taux' },
    { group: 'Indexation' },
    { key: 'indexType', ess: true, label: 'Indice', type: 'enum', opts: ['ILAT', 'ILC', 'ICC', 'IRL', 'aucun'], path: 'index.type' }, { key: 'indexBasePeriode', ess: true, label: 'Indice de base (trim.)', type: 'text', path: 'index.basePeriode', hint: 'ex. 2026T1' },
    { key: 'indexBaseValeur', ess: true, label: 'Indice de base (valeur)', type: 'num', path: 'index.baseValeur' }, { key: 'indexPremiereDate', ess: true, label: 'Première indexation', type: 'date', path: 'index.premiereDate' },
    { key: 'indexRevisionPeriode', ess: true, label: 'Indice de révision (trim.)', type: 'text', path: 'index.revisionPeriode', hint: 'vide = même trimestre, année suivante' }, { key: 'indexPlafond', label: 'Plafond (%)', type: 'num', path: 'index.plafond' }, { key: 'indexPlancher', label: 'Pas de baisse', type: 'bool', path: 'index.plancher' }, { key: 'indexCondition', label: 'Condition', type: 'text', path: 'index.condition' },
    { group: 'Dépôt de garantie' },
    { key: 'depotMontant', ess: true, label: 'Montant (€)', type: 'num', path: 'depot.montant' }, { key: 'depotMois', label: 'Mois de loyer', type: 'int', path: 'depot.mois' }, { key: 'depotReajust', label: 'Réajusté chaque année', type: 'bool', path: 'depot.reajustement' },
    { group: 'Charges et taxes' },
    { key: 'chargesMode', label: 'Mode', type: 'enum', opts: ['forfait', 'provision'], path: 'charges.mode' }, { key: 'chargesMontant', label: 'Montant annuel HT (€)', type: 'num', path: 'charges.montantAnnuelHT' }, { key: 'chargesPeriodicite', label: 'Périodicité', type: 'enum', opts: ['mensuel', 'trimestriel', 'semestriel', 'annuel'], path: 'charges.periodicite' },
    { key: 'taxeFonciere', label: 'Taxe foncière refacturée', type: 'bool', path: 'charges.taxeFonciere' }, { key: 'taxeFonciereMontant', label: 'Taxe foncière annuelle (€)', type: 'num', path: 'charges.taxeFonciereMontant' }, { key: 'teom', label: 'TEOM refacturée', type: 'bool', path: 'charges.teom' }, { key: 'honorairesInclus', label: 'Honoraires gestion inclus', type: 'bool', path: 'charges.honorairesInclus' },
    { group: 'Yardi' },
    { key: 'yardiTenant', ess: true, label: 'Tenant id Yardi (t…)', type: 'text', path: 'yardi.tenantCodesText', hint: 'ex. t0000859 ; plusieurs : virgules' }, { key: 'yardiProperty', ess: true, label: 'N° actif Yardi', type: 'text', path: 'yardi.propertyCode', hint: 'ex. fr101901' },
    { group: 'Suivi' },
    { key: 'commentaires', label: 'Commentaires', type: 'textarea' },
  ],
  getPath(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); },
  setPath(o, p, v) { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; } x[ks[ks.length - 1]] = v; },
  fieldHtml(f, bail, lists) {
    const path = f.path || f.key; let v = UI.getPath(bail, path); const meta = (bail.fields || {})[f.key] || {};
    const conf = meta.conf || (v !== undefined && v !== null && v !== '' ? 'manuel' : 'absent');
    const src = meta.page ? `<button class="src" data-src="${f.key}" title="Voir dans le PDF (p.${meta.page}) : ${U.esc(meta.snippet || '')}">👁</button>` : '<span></span>';
    let input;
    const common = `data-field="${f.key}" data-path="${path}" ${f.readonly ? 'readonly' : ''}`;
    if (f.type === 'enum') input = `<select ${common}><option value="">—</option>${UI.opts(f.opts, v, f.labels)}</select>`;
    else if (f.type === 'bool') input = `<select ${common}><option value="">—</option><option value="1" ${v === true ? 'selected' : ''}>Oui</option><option value="0" ${v === false ? 'selected' : ''}>Non</option></select>`;
    else if (f.type === 'textarea') input = `<textarea rows="2" ${common}>${U.esc(v ?? '')}</textarea>`;
    else if (f.type === 'num') input = `<input type="text" inputmode="decimal" ${common} value="${v == null ? '' : U.fmtNum(v, 2)}" ${f.hint ? `placeholder="${U.esc(f.hint)}"` : ''}>`;
    else if (f.type === 'int') input = `<input type="number" step="1" ${common} value="${v ?? ''}">`;
    else if (f.type === 'date') input = `<input type="date" ${common} value="${v ?? ''}" ${f.hint ? `placeholder="${U.esc(f.hint)}"` : ''}>`;
    else input = `<input type="text" ${common} value="${U.esc(v ?? '')}" ${f.list ? `list="dl-${f.list}"` : ''} ${f.hint ? `placeholder="${U.esc(f.hint)}"` : ''}>`;
    const note = meta.note || (meta.deduit ? 'déduit' : meta.learned ? 'appris' : '');
    return `<div class="f ${conf}" title="${U.esc(note)}"><label title="${U.esc(f.label)}">${U.esc(f.label)}${note ? ` <span class="muted small">(${U.esc(note)})</span>` : ''}</label>${input}${src}</div>`;
  },
  readField(f, el) {
    const raw = el.value;
    if (f.type === 'enum' || f.type === 'text' || f.type === 'textarea' || f.type === 'date') return raw === '' ? null : raw;
    if (f.type === 'bool') return raw === '' ? null : raw === '1';
    if (f.type === 'int') return raw === '' ? null : parseInt(raw, 10);
    if (f.type === 'num') return raw === '' ? null : U.parseNum(raw);
    return raw;
  },
  // Sous-tableaux éditables : lignes de loyer, surfaces, paliers, avenants
  subTable(name, title, cols, rows) {
    const head = cols.map(c => `<th>${c.label}</th>`).join('') + '<th></th>';
    const body = rows.map((r, i) => `<tr data-i="${i}">${cols.map(c => `<td>${c.type === 'enum' ? `<select data-sub="${name}" data-i="${i}" data-k="${c.key}">${UI.opts(c.opts, r[c.key], c.labels)}</select>` : `<input type="${c.type === 'date' ? 'date' : 'text'}" data-sub="${name}" data-i="${i}" data-k="${c.key}" value="${U.esc(c.type === 'num' ? U.fmtNum(r[c.key], 2) : (r[c.key] ?? ''))}">`}</td>`).join('')}<td><button class="danger" data-subdel="${name}" data-i="${i}" title="Supprimer">×</button></td></tr>`).join('');
    return `<div class="sub"><div class="row" style="justify-content:space-between"><b>${title}</b><button data-subadd="${name}">+ Ajouter</button></div><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  },
  SUB: {
    lots: { title: 'Lots (surface et loyer annuel HT)', cols: [{ key: 'lot', label: 'N° lot' }, { key: 'type', label: 'Type', type: 'enum', opts: ['bureau', 'entrepot', 'activite', 'parking', 'autre'], labels: { bureau: 'Bureau', entrepot: 'Entrepôt', activite: 'Activité', parking: 'Parking', autre: 'Autre' } }, { key: 'surface', label: 'm²', type: 'num' }, { key: 'montantAnnuelHT', label: '€ HT/an', type: 'num' }, { key: 'unitCode', label: 'Code lot Yardi' }], blank: () => ({ lot: '', type: 'bureau', surface: null, montantAnnuelHT: null, unitCode: '' }) },
    paliers: { title: 'Paliers de loyer', cols: [{ key: 'du', label: 'Du', type: 'date' }, { key: 'au', label: 'Au', type: 'date' }, { key: 'montantAnnuelHT', label: '€ HT/an', type: 'num' }], blank: () => ({ du: '', au: '', montantAnnuelHT: null }) },
    avenants: { title: 'Avenants', cols: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'objet', label: 'Objet' }, { key: 'texte', label: 'Détail' }], blank: () => ({ date: '', objet: '', texte: '' }) },
  },
};
