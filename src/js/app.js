'use strict';
// ---------- Application ----------
const APP = {
  view: 'dashboard', baux: [], learned: {}, sel: null, doc: null, docId: null, filters: { actif: '', preneur: '', q: '' }, importing: false, quittance: null, yardiRows: [], rapp: null, sort: {},
  // ===== Démarrage / verrouillage =====
  async boot() {
    const lock = UI.$('#lock');
    if (!DB.supported()) { UI.$('#lock-unsupported').classList.remove('hidden'); UI.$('#btn-folder').disabled = true; return; }
    UI.$('#btn-folder').onclick = async () => {
      try { await DB.chooseFolder(); } catch (e) { if (e.name !== 'AbortError') UI.$('#lock-error').textContent = 'Dossier inaccessible : ' + e.message; return; }
      UI.$('#lock-step-folder').classList.add('hidden'); UI.$('#lock-step-pass').classList.remove('hidden');
      const has = await SESSION.hasPassword();
      UI.$('#lock-pass-msg').textContent = has ? `Dossier : ${DB.root.name}. Entrez le mot de passe maître.` : `Dossier : ${DB.root.name}. Aucune base trouvée : choisissez un mot de passe maître pour créer la base chiffrée.`;
      UI.$('#pass2').classList.toggle('hidden', has); UI.$('#pass1').focus();
    };
    UI.$('#form-pass').onsubmit = async (e) => {
      e.preventDefault(); const has = await SESSION.hasPassword(); const p1 = UI.$('#pass1').value, p2 = UI.$('#pass2').value; const err = UI.$('#lock-error'); err.textContent = '';
      try {
        if (!has) { if (p1.length < 8) { err.textContent = 'Au moins 8 caractères.'; return; } if (p1 !== p2) { err.textContent = 'Les deux saisies diffèrent.'; return; } await SESSION.create(p1); }
        else if (!(await SESSION.unlock(p1))) { err.textContent = 'Mot de passe incorrect.'; return; }
      } catch (ex) { err.textContent = 'Erreur : ' + ex.message; return; }
      UI.$('#pass1').value = ''; UI.$('#pass2').value = '';
      await APP.start();
    };
    document.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); if (!SESSION.locked) SESSION.lock(); } SESSION.touch(); });
    ['mousemove', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (!SESSION.locked) SESSION.touch(); }, { passive: true }));
  },
  onLock() { UI.$('#app').classList.add('hidden'); UI.$('#lock').classList.remove('hidden'); UI.$('#lock-step-folder').classList.add('hidden'); UI.$('#lock-step-pass').classList.remove('hidden'); UI.$('#lock-pass-msg').textContent = 'Session verrouillée. Entrez le mot de passe.'; UI.$('#pass2').classList.add('hidden'); APP.baux = []; APP.doc = null; APP.sel = null; UI.$('#view').innerHTML = ''; setTimeout(() => UI.$('#pass1').focus(), 50); },
  async start() {
    UI.$('#lock').classList.add('hidden'); UI.$('#app').classList.remove('hidden');
    const seeded = await INDICES.seedIfEmpty(); await INDICES.load();
    if (seeded) UI.toast('Tables d\'indices pré-remplies : à vérifier avant usage', 5000);
    APP.learned = await DB.getSetting('learned', {}); CALC.codes = await DB.getSetting('codes', null) || { ...CALC.DEFAULT_CODES };
    SESSION.delayMin = await DB.getSetting('lockDelay', 15); SESSION.touch();
    APP.baux = await DB.all('baux');
    UI.$$('#tabs button').forEach(b => b.onclick = () => APP.go(b.dataset.view));
    UI.$('#btn-lock').onclick = () => SESSION.lock();
    UI.$('#f-actif').onchange = e => { APP.filters.actif = e.target.value; APP.render(); };
    UI.$('#f-preneur').onchange = e => { APP.filters.preneur = e.target.value; APP.render(); };
    UI.$('#f-search').oninput = U.debounce(e => { APP.filters.q = e.target.value; APP.render(); }, 200);
    if (!APP._keysBound) { document.addEventListener('keydown', APP.keys); APP._keysBound = true; }
    APP.go(APP.baux.length ? 'baux' : 'dashboard');
  },
  go(view) { APP.view = view; UI.$$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view)); APP.render(); },
  keys(e) {
    if (SESSION.locked) return; const inInput = /input|textarea|select/i.test(e.target.tagName);
    if (APP.view === 'baux' && e.ctrlKey) {
      if (e.key === 'ArrowDown') { e.preventDefault(); APP.selectOffset(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); APP.selectOffset(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); APP.validate(); } else if (e.key.toLowerCase() === 's') { e.preventDefault(); APP.saveSel(true); }
    }
    if (e.key === 'Escape' && !inInput) UI.closeModal();
  },
  // ===== Filtres =====
  refreshFilterLists() {
    const actifs = [...new Set(APP.baux.map(b => b.actif).filter(Boolean))].sort(), pren = [...new Set(APP.baux.map(b => b.preneur).filter(Boolean))].sort();
    const fa = UI.$('#f-actif'), fp = UI.$('#f-preneur');
    fa.innerHTML = '<option value="">Tous les actifs</option>' + UI.opts(actifs, APP.filters.actif); fp.innerHTML = '<option value="">Tous les locataires</option>' + UI.opts(pren, APP.filters.preneur);
  },
  filtered() {
    const q = U.norm(APP.filters.q);
    return APP.baux.filter(b => (!APP.filters.actif || b.actif === APP.filters.actif) && (!APP.filters.preneur || b.preneur === APP.filters.preneur) && (!q || U.norm([b.ref, b.preneur, b.enseigne, b.actif, b.lots, b.bailleur, b.pdfName, b.commentaires].join(' ')).includes(q)))
      .sort((a, b) => (a.actif || '').localeCompare(b.actif || '') || (a.preneur || '').localeCompare(b.preneur || ''));
  },
  render() { APP.refreshFilterLists(); const v = UI.$('#view'); v.innerHTML = ''; ({ dashboard: APP.vDashboard, baux: APP.vBaux, indices: APP.vIndices, quittance: APP.vQuittance, yardi: APP.vYardi, params: APP.vParams })[APP.view](v); },
  // ===== Tableau de bord =====
  vDashboard(v) {
    const L = APP.filtered(); const n = s => L.filter(b => b.statut === s).length;
    const today = U.toISO(new Date()), in6m = U.addMonths(today, 6);
    const ech = L.flatMap(b => CALC.echeances(b).map(e => ({ ...e, ref: b.ref, preneur: b.preneur, actif: b.actif }))).filter(e => e.date >= today && e.date <= in6m).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
    const missingIdx = L.filter(b => b.index && b.index.type && b.index.type !== 'aucun' && b.index.basePeriode && !INDICES.get(b.index.type, b.index.basePeriode) && !b.index.baseValeur);
    v.innerHTML = `
      <div class="cards">
        <div class="card clickable" data-st=""><div class="muted">Baux</div><div class="big">${L.length}</div></div>
        <div class="card clickable" data-st="extrait"><div class="muted">Extraits, non vérifiés</div><div class="big" style="color:var(--accent)">${n('extrait')}</div></div>
        <div class="card clickable" data-st="a_verifier"><div class="muted">À vérifier</div><div class="big" style="color:var(--doute)">${n('a_verifier')}</div></div>
        <div class="card clickable" data-st="anomalie"><div class="muted">Anomalies</div><div class="big" style="color:var(--absent)">${n('anomalie')}</div></div>
        <div class="card clickable" data-st="valide"><div class="muted">Validés</div><div class="big" style="color:var(--ok)">${n('valide')}</div></div>
        <div class="card"><div class="muted">Loyer annuel HT (validés + autres)</div><div class="big">${U.fmtMoney(L.reduce((s, b) => s + CALC.loyerAnnuel(b), 0), 0)} €</div></div>
      </div>
      <div class="panel"><h2>Importer des baux (PDF)</h2>
        <div id="drop" class="dropzone">Glissez-déposez ici des fichiers PDF ou un dossier entier<br><br>
          <button id="btn-files">Choisir des fichiers…</button> <button id="btn-dir">Choisir un dossier…</button>
          <input type="file" id="in-files" accept="application/pdf" multiple class="hidden"><input type="file" id="in-dir" webkitdirectory class="hidden"></div>
        <div id="imp-progress" class="hidden"><div class="progress"><div id="imp-bar" style="width:0"></div></div><div id="imp-msg" class="muted"></div></div>${APP.lastImport ? `<p class="ok small">${U.esc(APP.lastImport)}</p>` : ''}
        <p class="muted small">Le texte est extrait avec pdf.js ; si une page ne contient pas de texte (scan), l'OCR Tesseract est lancé automatiquement. Les fichiers déjà importés (même nom et même taille) sont ignorés.</p>
      </div>
      ${missingIdx.length ? `<div class="panel anoms"><b>${missingIdx.length} bail(s) avec un indice de base absent de la table</b> : ${missingIdx.slice(0, 10).map(b => `${U.esc(b.ref || b.preneur)} (${b.index.type} ${b.index.basePeriode})`).join(', ')}${missingIdx.length > 10 ? '…' : ''}. <a href="#" id="go-indices">Compléter les indices</a></div>` : ''}
      <div class="panel"><h2>Échéances des 6 prochains mois</h2>${UI.table([{ key: 'date', label: 'Date', render: U.fmtDate }, { key: 'libelle', label: 'Échéance' }, { key: 'preavis', label: 'Préavis avant le', render: U.fmtDate }, { key: 'ref', label: 'Réf.' }, { key: 'preneur', label: 'Preneur' }, { key: 'actif', label: 'Actif' }], ech).html}</div>`;
    UI.$$('.card[data-st]', v).forEach(c => c.onclick = () => { APP.filters.statut = c.dataset.st; APP.go('baux'); });
    const gi = UI.$('#go-indices', v); if (gi) gi.onclick = e => { e.preventDefault(); APP.go('indices'); };
    const drop = UI.$('#drop', v);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = async e => { e.preventDefault(); drop.classList.remove('over'); const files = await APP.filesFromDrop(e.dataTransfer); APP.importFiles(files); };
    UI.$('#btn-files', v).onclick = () => UI.$('#in-files', v).click(); UI.$('#btn-dir', v).onclick = () => UI.$('#in-dir', v).click();
    UI.$('#in-files', v).onchange = e => APP.importFiles([...e.target.files]); UI.$('#in-dir', v).onchange = e => APP.importFiles([...e.target.files]);
  },
  async filesFromDrop(dt) {
    const out = []; const walk = async (entry) => { if (entry.isFile) { await new Promise(r => entry.file(f => { out.push(f); r(); })); } else if (entry.isDirectory) { const reader = entry.createReader(); let batch; do { batch = await new Promise(r => reader.readEntries(r)); for (const e of batch) await walk(e); } while (batch.length); } };
    for (const it of dt.items || []) { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) await walk(en); else if (it.getAsFile()) out.push(it.getAsFile()); }
    if (!out.length) out.push(...dt.files); return out;
  },
  // ===== Import =====
  async importFiles(files) {
    files = files.filter(f => /\.pdf$/i.test(f.name)); if (!files.length) { UI.toast('Aucun PDF'); return; }
    if (APP.importing) { UI.toast('Import déjà en cours'); return; } APP.importing = true;
    const prog = UI.$('#imp-progress'), bar = UI.$('#imp-bar'), msg = UI.$('#imp-msg'); if (prog) prog.classList.remove('hidden');
    let done = 0, skipped = 0, errors = 0, ocrN = 0;
    for (const f of files) {
      const upd = (t) => { if (bar) bar.style.width = `${Math.round(done / files.length * 100)}%`; if (msg) msg.textContent = `${done}/${files.length} – ${f.name} : ${t}`; };
      try {
        if (APP.baux.some(b => b.pdfName === f.name && b.pdfSize === f.size)) { skipped++; done++; upd('déjà importé'); continue; }
        upd('lecture'); const ab = await U.readFile(f); const doc = await PDF.open(ab);
        let pages = await PDF.extractText(doc, (i, n) => upd(`texte page ${i}/${n}`));
        let ocr = false;
        const emptyPages = pages.filter(p => p.text.replace(/\s/g, '').length < 80);
        if (emptyPages.length > pages.length / 2) { ocr = true; ocrN++; pages = await OCR.ocrDocument(doc, (i, n) => upd(`OCR page ${i}/${n}`)); }
        else if (emptyPages.length) { ocr = true; ocrN++; const worker = await OCR.get(); const canvas = document.createElement('canvas'); for (const p of emptyPages) { upd(`OCR page ${p.num}`); await PDF.render(doc, p.num, canvas, 2); const r = await worker.recognize(canvas); p.text = r.data.text; p.ocr = true; } }
        upd('extraction'); const bail = APP.buildBail(f, ab, pages, ocr);
        await DB.put('pdfs', { id: bail.pdfId, name: f.name, data: ab, pages, ocr });
        await DB.put('baux', bail); APP.baux.push(bail); doc.destroy();
      } catch (e) { console.error(e); errors++; UI.toast(`Erreur ${f.name} : ${e.message}`, 4000); }
      done++; upd('terminé');
    }
    APP.importing = false; APP.lastImport = `Import terminé le ${new Date().toLocaleString('fr-FR')} : ${done - skipped - errors} ajoutés, ${skipped} ignorés, ${errors} erreurs, ${ocrN} avec OCR`; UI.toast(APP.lastImport, 6000);
    APP.render();
  },
  buildBail(file, ab, pages, ocr) {
    const r = EXTRACT.run(pages, APP.learned); const F = r.fields; const g = k => F[k] && F[k].value;
    const refFromName = (/^(\d{2}\.\d{3}\.\d{2,3})/.exec(file.name) || [])[1] || '';
    const bail = { id: U.uid(), ref: refFromName, pdfId: U.uid(), pdfName: file.name, pdfSize: file.size, pdfPages: pages.length, ocr, created: new Date().toISOString(), updated: new Date().toISOString(), fields: {}, history: [] };
    const simple = ['type', 'bailleur', 'preneur', 'siren', 'emailFacturation', 'actif', 'adresse', 'batiment', 'lots', 'surfaceTotale', 'parkingsNombre', 'parkingsNumeros', 'destination', 'stockageICPE', 'dateSignature', 'dateEffet', 'dateFin', 'dureeMois', 'resiliation', 'loyerAnnuelHT', 'periodicite', 'terme', 'franchiseMois'];
    for (const k of simple) { bail[k] = g(k) ?? null; }
    bail.index = { type: g('indexType'), basePeriode: g('indexBasePeriode'), baseValeur: g('indexBaseValeur'), premiereDate: g('indexPremiereDate'), plafond: g('indexPlafond') };
    bail.depot = { montant: g('depotMontant'), mois: g('depotMois') }; bail.tva = { option: g('tvaOption') ?? true, taux: 20 };
    bail.charges = { mode: g('chargesMode'), montantAnnuelHT: g('chargesMontant'), periodicite: g('chargesPeriodicite'), taxeFonciere: g('taxeFonciere') };
    bail.prorata = 'jours'; bail.yardi = { tenantCodes: [], unitCodes: [] };
    for (const [k, m] of Object.entries(F)) if (k[0] !== '_') bail.fields[k] = { conf: m.conf, page: m.page, snippet: m.snippet, offset: m.offset, deduit: m.deduit, learned: m.learned, note: m.note, extracted: m.value };
    bail.lignes = EXTRACT.rentLines(pages, bail.loyerAnnuelHT); bail.surfaces = EXTRACT.surfaces(pages); bail.paliers = []; bail.avenants = [];
    bail.anomalies = F._anomalies || []; bail.statut = bail.anomalies.length ? 'anomalie' : 'extrait';
    if (!bail.ref) bail.ref = (bail.preneur || file.name.replace(/\.pdf$/i, '')).slice(0, 40);
    return bail;
  },
  // ===== Vue Baux (3 panneaux) =====
  vBaux(v) {
    let L = APP.filtered(); if (APP.filters.statut) L = L.filter(b => b.statut === APP.filters.statut);
    const actifs = [...new Set(APP.baux.map(b => b.actif).filter(Boolean))];
    v.innerHTML = `<div class="baux">
      <div id="blist"><div class="toolbar row" style="padding:6px"><select id="f-statut" style="flex:1"><option value="">Tous statuts (${APP.filtered().length})</option>${UI.opts(['extrait', 'a_verifier', 'anomalie', 'valide'], APP.filters.statut, UI.statutLabel)}</select><button id="btn-new" title="Créer un bail sans PDF">+</button></div>
        ${L.map(b => `<div class="list-item ${APP.sel && APP.sel.id === b.id ? 'sel' : ''}" data-id="${b.id}"><div class="t"><span class="dot ${b.statut}"></span>${U.esc(b.preneur || b.ref || '—')}</div><div class="s"><span>${U.esc(b.ref || '')} · ${U.esc(b.actif || '')}</span><span>${U.fmtMoney(CALC.loyerAnnuel(b), 0)} €</span></div></div>`).join('') || '<p class="muted" style="padding:10px">Aucun bail. Importez des PDF depuis le tableau de bord.</p>'}
      </div>
      <div id="viewer" class="viewer"><div class="toolbar"><span id="pv-info" class="muted">Sélectionnez un bail</span><span style="flex:1"></span><button id="pv-zoomout" title="Zoom -">−</button><button id="pv-zoomin" title="Zoom +">+</button><input id="pv-find" type="search" placeholder="Chercher dans le texte" style="width:180px"><button id="pv-text" title="Afficher le texte brut">Texte</button></div><div id="pv-pages"></div></div>
      <div id="bform" class="form"><datalist id="dl-actifs">${actifs.map(a => `<option value="${U.esc(a)}">`).join('')}</datalist><p class="muted">Sélectionnez un bail dans la liste.<br><br>Raccourcis : <kbd>Ctrl</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd> bail suivant/précédent, <kbd>Ctrl</kbd>+<kbd>Entrée</kbd> valider, <kbd>Ctrl</kbd>+<kbd>S</kbd> enregistrer.</p></div></div>`;
    UI.$('#f-statut', v).onchange = e => { APP.filters.statut = e.target.value; APP.render(); };
    UI.$('#btn-new', v).onclick = () => APP.newBail();
    UI.$$('.list-item', v).forEach(el => el.onclick = () => APP.select(el.dataset.id));
    UI.$('#pv-zoomin', v).onclick = () => { APP.zoom = Math.min(3, (APP.zoom || 1.3) + 0.2); APP.renderPdf(); }; UI.$('#pv-zoomout', v).onclick = () => { APP.zoom = Math.max(0.6, (APP.zoom || 1.3) - 0.2); APP.renderPdf(); };
    UI.$('#pv-find', v).onchange = e => APP.findInPdf(e.target.value); UI.$('#pv-text', v).onclick = () => APP.showText();
    if (APP.sel) { const s = L.find(b => b.id === APP.sel.id); if (s) APP.select(s.id); }
  },
  selectOffset(d) { let L = APP.filtered(); if (APP.filters.statut) L = L.filter(b => b.statut === APP.filters.statut); const i = L.findIndex(b => APP.sel && b.id === APP.sel.id); const n = L[i + d]; if (n) APP.select(n.id); },
  async select(id) {
    if (APP.sel && APP.dirty) await APP.saveSel(false);
    APP.sel = U.clone(APP.baux.find(b => b.id === id)); APP.dirty = false;
    UI.$$('.list-item').forEach(el => el.classList.toggle('sel', el.dataset.id === id)); const li = UI.$(`.list-item[data-id="${id}"]`); if (li) li.scrollIntoView({ block: 'nearest' });
    APP.renderForm(); await APP.loadPdf();
  },
  renderForm() {
    const b = APP.sel, el = UI.$('#bform'); if (!b || !el) return;
    b.yardi = b.yardi || { tenantCodes: [], unitCodes: [] }; b.yardi.tenantCodesText = (b.yardi.tenantCodes || []).join(', '); b.yardi.unitCodesText = (b.yardi.unitCodes || []).join(', ');
    b.loyerAnnuelHT = CALC.loyerAnnuel(b);
    const lists = {}; let html = `<div class="actions"><button id="b-save" class="primary" title="Ctrl+S">Enregistrer</button><button id="b-validate" title="Ctrl+Entrée">✓ Valider</button><button id="b-reextract" title="Relancer l'extraction (règles + ancres apprises)">↻ Ré-extraire</button><button id="b-dup" title="Créer un avenant / bail lié">Avenant</button><button id="b-del" class="danger">Supprimer</button></div>
      <div class="legend small muted"><span><span class="dot valide"></span>confiant</span><span><span class="dot a_verifier"></span>douteux</span><span><span class="dot anomalie"></span>non trouvé</span><span><span class="dot extrait"></span>saisi</span></div>`;
    if (b.anomalies && b.anomalies.length) html += `<div class="anoms"><b>Anomalies détectées</b><ul style="margin:4px 0 0 16px;padding:0">${b.anomalies.map(a => `<li>${U.esc(a)}</li>`).join('')}</ul></div>`;
    const lx = CALC.loyerIndexeAt(b, U.toISO(new Date()));
    html += `<div class="muted small" style="margin-bottom:8px">PDF : ${U.esc(b.pdfName || 'aucun')} (${b.pdfPages || 0} p.${b.ocr ? ', OCR' : ''}) · Loyer indexé aujourd'hui : <b>${U.fmtMoney(lx.montant)} € HT/an</b> (coef ${lx.coef.toFixed(4)})${lx.missing.length ? ` <span class="error">indice manquant : ${lx.missing.join(', ')}</span>` : ''}${lx.unverified.length ? ` <span class="warn">indice non vérifié : ${lx.unverified.join(', ')}</span>` : ''}</div>`;
    for (const f of UI.FORM) {
      if (f.group) { html += `<h3>${f.group}</h3>`; if (f.group === 'Loyer et facturation') html += UI.subTable('lignes', UI.SUB.lignes.title, UI.SUB.lignes.cols, b.lignes || []) + UI.subTable('paliers', UI.SUB.paliers.title, UI.SUB.paliers.cols, b.paliers || []); if (f.group === 'Lieux loués') html += UI.subTable('surfaces', UI.SUB.surfaces.title, UI.SUB.surfaces.cols, b.surfaces || []); if (f.group === 'Suivi') html += UI.subTable('avenants', UI.SUB.avenants.title, UI.SUB.avenants.cols, b.avenants || []); continue; }
      html += UI.fieldHtml(f, b, lists);
    }
    html += `<h3>Échéances</h3><ul class="small" style="margin:0;padding-left:16px">${CALC.echeances(b).map(e => `<li>${U.fmtDate(e.date)} : ${e.libelle}${e.preavis ? ` (préavis avant le ${U.fmtDate(e.preavis)})` : ''}</li>`).join('') || '<li class="muted">—</li>'}</ul>`;
    html += `<h3>Historique</h3><div class="small muted">${(b.history || []).slice(-15).reverse().map(h => `${h.date.slice(0, 16).replace('T', ' ')} – ${U.esc(h.champ)} : ${U.esc(String(h.avant ?? '∅'))} → ${U.esc(String(h.apres ?? '∅'))}`).join('<br>') || '—'}</div>`;
    el.innerHTML = html;
    el.oninput = e => { const t = e.target; if (t.dataset.field) APP.onField(t); else if (t.dataset.sub) APP.onSub(t); };
    el.onclick = e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.src) APP.showSource(t.dataset.src); else if (t.dataset.subadd) { (b[t.dataset.subadd] ||= []).push(UI.SUB[t.dataset.subadd].blank()); APP.dirty = true; APP.renderForm(); } else if (t.dataset.subdel) { b[t.dataset.subdel].splice(+t.dataset.i, 1); APP.dirty = true; APP.renderForm(); } };
    UI.$('#b-save', el).onclick = () => APP.saveSel(true); UI.$('#b-validate', el).onclick = () => APP.validate(); UI.$('#b-del', el).onclick = () => APP.deleteSel(); UI.$('#b-reextract', el).onclick = () => APP.reextract(); UI.$('#b-dup', el).onclick = () => APP.newBail(b);
  },
  onField(t) {
    const f = UI.FORM.find(x => x.key === t.dataset.field); const b = APP.sel; const path = t.dataset.path; const v = UI.readField(f, t); const before = UI.getPath(b, path);
    if (v === before) return; UI.setPath(b, path, v); APP.dirty = true;
    b.fields = b.fields || {}; const meta = b.fields[f.key] || {}; meta.conf = 'manuel'; b.fields[f.key] = meta;
    (b.history ||= []).push({ date: new Date().toISOString(), champ: f.label, avant: before, apres: v });
    t.closest('.f').className = 'f manuel';
    if (f.key === 'yardiTenant') b.yardi.tenantCodes = (v || '').split(/[,\s;]+/).filter(Boolean); if (f.key === 'yardiUnit') b.yardi.unitCodes = (v || '').split(/[,\s;]+/).filter(Boolean);
    // apprentissage de l'ancre si la valeur figure dans le texte du PDF
    if (EXTRACT.FIELDS.some(x => x.key === f.key) && v !== null && v !== '' && APP.pages) { APP.learned = EXTRACT.learn(APP.learned, f.key, v, APP.pages); DB.setSetting('learned', APP.learned); }
  },
  onSub(t) { const row = APP.sel[t.dataset.sub][+t.dataset.i]; const col = UI.SUB[t.dataset.sub].cols.find(c => c.key === t.dataset.k); row[t.dataset.k] = col.type === 'num' ? U.parseNum(t.value) : t.value; APP.dirty = true; if (t.dataset.sub === 'lignes') { const tot = UI.$('[data-field="loyerAnnuelHT"]'); if (tot) tot.value = U.fmtNum(CALC.loyerAnnuel(APP.sel), 2); } },
  async saveSel(notify) {
    const b = APP.sel; if (!b) return; b.updated = new Date().toISOString(); b.loyerAnnuelHT = CALC.loyerAnnuel(b);
    const clean = U.clone(b); delete clean.yardi.tenantCodesText; delete clean.yardi.unitCodesText;
    await DB.put('baux', clean); const i = APP.baux.findIndex(x => x.id === b.id); if (i >= 0) APP.baux[i] = clean; else APP.baux.push(clean);
    APP.dirty = false; if (notify) UI.toast('Enregistré');
    const li = UI.$(`.list-item[data-id="${b.id}"]`); if (li) { li.querySelector('.t').innerHTML = `<span class="dot ${b.statut}"></span>${U.esc(b.preneur || b.ref || '—')}`; li.querySelector('.s').innerHTML = `<span>${U.esc(b.ref || '')} · ${U.esc(b.actif || '')}</span><span>${U.fmtMoney(CALC.loyerAnnuel(b), 0)} €</span>`; }
  },
  async validate() { if (!APP.sel) return; APP.sel.statut = 'valide'; await APP.saveSel(false); UI.toast('Bail validé'); APP.selectOffset(1); },
  async deleteSel() { const b = APP.sel; if (!b || !(await UI.confirm(`Supprimer le bail « ${U.esc(b.preneur || b.ref)} » et son PDF ?`, { ok: 'Supprimer', danger: true }))) return; await DB.del('baux', b.id); if (b.pdfId) await DB.del('pdfs', b.pdfId); APP.baux = APP.baux.filter(x => x.id !== b.id); APP.sel = null; APP.dirty = false; APP.render(); },
  async newBail(from) {
    const b = { id: U.uid(), ref: from ? `${from.ref} – avenant` : '', statut: 'a_verifier', created: new Date().toISOString(), updated: new Date().toISOString(), fields: {}, history: [], lignes: [], surfaces: [], paliers: [], avenants: [], anomalies: [], index: {}, depot: {}, charges: {}, tva: { option: true, taux: 20 }, yardi: { tenantCodes: [], unitCodes: [] }, prorata: 'jours' };
    if (from) { for (const k of ['type', 'bailleur', 'preneur', 'enseigne', 'siren', 'actif', 'adresse', 'batiment', 'lots', 'surfaceTotale', 'periodicite', 'terme', 'prorata']) b[k] = from[k]; b.parentId = from.id; b.index = U.clone(from.index || {}); b.lignes = U.clone(from.lignes || []); b.fields = {}; }
    await DB.put('baux', b); APP.baux.push(b); APP.sel = null; APP.render(); APP.select(b.id);
  },
  async reextract() {
    const b = APP.sel; if (!b || !APP.pages) return;
    const fresh = APP.buildBail({ name: b.pdfName, size: b.pdfSize }, null, APP.pages, b.ocr);
    const keep = ['id', 'ref', 'pdfId', 'pdfName', 'pdfSize', 'pdfPages', 'ocr', 'created', 'history', 'commentaires', 'yardi', 'avenants', 'paliers', 'statut'];
    for (const k of Object.keys(fresh)) if (!keep.includes(k)) b[k] = fresh[k];
    // conserve les valeurs saisies à la main
    for (const [k, m] of Object.entries(b.fields)) if (m.conf === 'manuel') { const f = UI.FORM.find(x => x.key === k); if (f) { UI.setPath(b, f.path || f.key, UI.getPath(APP.baux.find(x => x.id === b.id), f.path || f.key)); fresh.fields[k] = m; } }
    b.fields = { ...fresh.fields, ...Object.fromEntries(Object.entries(b.fields).filter(([k, m]) => m.conf === 'manuel')) };
    APP.dirty = true; APP.renderForm(); UI.toast('Extraction relancée (valeurs saisies conservées)');
  },
  // ===== Visionneuse PDF =====
  async loadPdf() {
    const b = APP.sel; const info = UI.$('#pv-info'), cont = UI.$('#pv-pages'); if (!cont) return; cont.innerHTML = ''; APP.pages = null;
    if (!b.pdfId) { info.textContent = 'Aucun PDF associé'; return; }
    if (APP.docId !== b.pdfId) { if (APP.doc) { try { APP.doc.destroy(); } catch { } } APP.doc = null; const p = await DB.get('pdfs', b.pdfId); if (!p) { info.textContent = 'PDF introuvable'; return; } APP.pages = p.pages; APP.doc = await PDF.open(p.data); APP.docId = b.pdfId; APP.pdfRec = p; } else APP.pages = APP.pdfRec.pages;
    info.textContent = `${b.pdfName} – ${APP.doc.numPages} pages`; await APP.renderPdf();
  },
  async renderPdf() {
    const cont = UI.$('#pv-pages'); if (!cont || !APP.doc) return; cont.innerHTML = ''; const scale = APP.zoom || 1.3; APP.pageEls = [];
    for (let i = 1; i <= APP.doc.numPages; i++) { const pg = APP.pages[i - 1]; const d = document.createElement('div'); d.className = 'page'; d.dataset.page = i; d.style.width = `${pg.width * scale}px`; d.style.height = `${pg.height * scale}px`; d.innerHTML = `<span class="pagelabel">${i}</span>`; cont.appendChild(d); APP.pageEls.push(d); }
    const io = new IntersectionObserver(async (entries) => { for (const en of entries) if (en.isIntersecting && !en.target.querySelector('canvas')) { const c = document.createElement('canvas'); en.target.prepend(c); try { await PDF.render(APP.doc, +en.target.dataset.page, c, scale); } catch { } } }, { root: UI.$('#viewer'), rootMargin: '600px' });
    APP.pageEls.forEach(d => io.observe(d));
  },
  highlight(pageNum, matchFn, scroll = true) {
    UI.$$('.hl').forEach(h => h.remove()); const pg = APP.pages && APP.pages[pageNum - 1]; const d = APP.pageEls && APP.pageEls[pageNum - 1]; if (!pg || !d) return 0;
    const scale = APP.zoom || 1.3; let n = 0, first = null;
    for (const it of pg.items) if (matchFn(it)) { const h = document.createElement('div'); h.className = 'hl'; h.style.left = `${it.x * scale}px`; h.style.top = `${(pg.height - it.y - it.h) * scale}px`; h.style.width = `${Math.max(4, it.w * scale)}px`; h.style.height = `${Math.max(8, it.h * scale)}px`; d.appendChild(h); n++; if (!first) first = h; }
    if (scroll) { d.scrollIntoView({ block: 'start' }); if (first) setTimeout(() => first.scrollIntoView({ block: 'center' }), 50); }
    return n;
  },
  showSource(key) {
    const m = APP.sel.fields && APP.sel.fields[key]; if (!m || !m.page) return;
    const words = new Set(U.norm(m.snippet || '').replace(/…/g, ' ').split(/[^a-z0-9€,.'/-]+/).filter(w => w.length > 1));
    const n = APP.highlight(m.page, it => { const toks = U.norm(it.s).split(/[^a-z0-9€,.'/-]+/).filter(w => w.length > 1); if (!toks.length) return false; const hit = toks.filter(t => words.has(t)).length; return hit / toks.length >= 0.6 && (hit >= 2 || toks.length === 1); });
    if (!n) UI.toast(`Page ${m.page} : ${m.snippet || ''}`, 5000);
  },
  findInPdf(q) { q = U.norm(q); if (!q || !APP.pages) return; const pg = APP.pages.find(p => U.norm(p.text).includes(q)); if (!pg) { UI.toast('Introuvable'); return; } const n = APP.highlight(pg.num, it => U.norm(it.s).includes(q) || q.includes(U.norm(it.s)) && it.s.length > 3); if (!n) { APP.pageEls[pg.num - 1].scrollIntoView(); UI.toast(`Page ${pg.num}`); } },
  showText() { if (!APP.pages) return; UI.modal(`<h2>Texte extrait</h2><textarea class="wide" style="min-height:70vh;width:80vw" readonly>${U.esc(APP.pages.map(p => `===== Page ${p.num}${p.ocr ? ' (OCR)' : ''} =====\n${p.text}`).join('\n\n'))}</textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button data-close>Fermer</button></div>`); },
  // ===== Indices =====
  vIndices(v) {
    const rows = INDICES.cache || []; const types = Object.keys(INDICES.TYPES); const years = [...new Set(rows.map(r => +r.periode.slice(0, 4)))].sort((a, b) => b - a); const y0 = new Date().getFullYear(); for (let y = y0 + 1; y >= y0 - 1; y--) if (!years.includes(y)) years.push(y); years.sort((a, b) => b - a);
    const unv = rows.filter(r => !r.verifie).length;
    v.innerHTML = `<div class="panel"><h2>Tables d'indices</h2>
      <div class="row"><button id="idx-csv">Importer un CSV…</button><input type="file" id="idx-file" accept=".csv,.txt" class="hidden"><button id="idx-verify-all">Marquer tout comme vérifié</button><button id="idx-export">Exporter (Excel)</button><span class="muted small">CSV attendu : <code>type;periode;valeur</code> (ex. <code>ILAT;2025T2;136,34</code>). ${unv ? `<span class="warn">${unv} valeur(s) pré-remplies non vérifiées.</span>` : '<span class="ok">Toutes les valeurs sont vérifiées.</span>'}</span></div>
      <p class="muted small">Modifiez une valeur directement dans la cellule (elle devient « vérifiée »). Case vide = indice non publié / inconnu. Les valeurs pré-remplies proviennent de mémoire et doivent être contrôlées sur insee.fr.</p>
      <div class="indices-grid">${types.map(t => `<div><h3>${t} <span class="muted" style="text-transform:none;font-weight:normal">${INDICES.TYPES[t]}</span></h3><table><thead><tr><th>Année</th><th>T1</th><th>T2</th><th>T3</th><th>T4</th></tr></thead><tbody>${years.map(y => `<tr><td>${y}</td>${[1, 2, 3, 4].map(q => { const r = INDICES.get(t, `${y}T${q}`); return `<td><input data-idx="${t}" data-p="${y}T${q}" value="${r ? U.fmtNum(r.valeur, 2) : ''}" class="${r ? (r.verifie ? 'ok' : 'warn') : ''}" style="${r && !r.verifie ? 'border-color:var(--doute)' : ''}" title="${r ? U.esc(r.source) : ''}"></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button id="idx-addyear">+ Année antérieure</button></div></div>`;
    v.onchange = async e => { const t = e.target; if (!t.dataset.idx) return; const val = U.parseNum(t.value); if (val === null) { await INDICES.remove(t.dataset.idx, t.dataset.p); } else await INDICES.set(t.dataset.idx, t.dataset.p, val, true); t.className = val === null ? '' : 'ok'; t.style.borderColor = ''; UI.toast('Indice enregistré'); };
    UI.$('#idx-csv', v).onclick = () => UI.$('#idx-file', v).click();
    UI.$('#idx-file', v).onchange = async e => { const f = e.target.files[0]; if (!f) return; const r = await INDICES.importCSV(await U.readFile(f, 'text')); UI.toast(`${r.n} valeurs importées${r.errs.length ? `, ${r.errs.length} lignes ignorées` : ''}`); APP.render(); };
    UI.$('#idx-verify-all', v).onclick = async () => { if (!(await UI.confirm('Marquer toutes les valeurs comme vérifiées ?'))) return; for (const r of rows) if (!r.verifie) await DB.put('indices', { ...r, verifie: true }); await INDICES.load(); APP.render(); };
    UI.$('#idx-export', v).onclick = () => { const wb = XLSX.utils.book_new(); EXCEL.sheet(wb, 'Indices', rows.map(i => ({ Indice: i.type, Période: i.periode, Valeur: i.valeur, Vérifié: i.verifie ? 'oui' : 'non', Source: i.source }))); XLSX.writeFile(wb, 'indices.xlsx'); };
    UI.$('#idx-addyear', v).onclick = async () => { const y = Math.min(...years) - 1; await INDICES.set('ILC', `${y}T1`, 0, false, 'à saisir'); await INDICES.remove('ILC', `${y}T1`); years.push(y); APP.render(); };
  },
  // ===== Quittancement =====
  vQuittance(v) {
    const today = U.toISO(new Date()); const q = APP.qParams || { from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31', statut: '' };
    v.innerHTML = `<div class="panel"><h2>Quittancement</h2><div class="row"><label>Du <input type="date" id="q-from" value="${q.from}"></label><label>au <input type="date" id="q-to" value="${q.to}"></label>
      <select id="q-statut"><option value="">Tous les baux filtrés</option>${UI.opts(['valide', 'a_verifier', 'extrait', 'anomalie'], q.statut, UI.statutLabel)}</select>
      <button id="q-run" class="primary">Calculer</button><button id="q-export" ${APP.quittance ? '' : 'disabled'}>Exporter (Excel)</button><span class="muted small">Les filtres actif / locataire de la barre s'appliquent.</span></div>
      <div id="q-warn"></div></div><div id="q-out"></div>`;
    const run = () => {
      APP.qParams = { from: UI.$('#q-from').value, to: UI.$('#q-to').value, statut: UI.$('#q-statut').value };
      let L = APP.filtered(); if (APP.qParams.statut) L = L.filter(b => b.statut === APP.qParams.statut);
      const lignes = [], warns = [];
      for (const b of L) { const r = CALC.quittance(b, APP.qParams.from, APP.qParams.to); lignes.push(...r.lignes); r.warnings.forEach(w => warns.push(`${b.ref || b.preneur} : ${w}`)); }
      APP.quittance = lignes; UI.$('#q-export').disabled = !lignes.length;
      UI.$('#q-warn').innerHTML = warns.length ? `<div class="anoms" style="margin-top:8px"><b>${warns.length} avertissement(s)</b><ul style="margin:4px 0 0 16px;padding:0;max-height:120px;overflow:auto">${[...new Set(warns)].map(w => `<li>${U.esc(w)}</li>`).join('')}</ul></div>` : '';
      const tot = lignes.reduce((a, l) => ({ ht: a.ht + l.ht, tva: a.tva + l.tva, ttc: a.ttc + l.ttc }), { ht: 0, tva: 0, ttc: 0 });
      const cols = [{ key: 'ref', label: 'Réf.' }, { key: 'preneur', label: 'Preneur' }, { key: 'actif', label: 'Actif' }, { key: 'du', label: 'Du', render: U.fmtDate }, { key: 'au', label: 'Au', render: U.fmtDate }, { key: 'libelle', label: 'Libellé' }, { key: 'chargeCode', label: 'Code' }, { key: 'coef', label: 'Coef.', num: true, dec: 4 }, { key: 'prorata', label: 'Prorata', num: true, dec: 4 }, { key: 'ht', label: 'HT', num: true }, { key: 'tva', label: 'TVA', num: true }, { key: 'ttc', label: 'TTC', num: true }];
      const t = UI.table(cols, lignes, { sortKey: APP.sort.q, sortDir: APP.sort.qd || 1, onRow: r => { APP.sel = null; APP.filters.statut = ''; APP.go('baux'); APP.select(r.bailId); } });
      UI.$('#q-out').innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><b>${lignes.length} lignes</b><span>Total HT <b>${U.fmtMoney(tot.ht)}</b> · TVA ${U.fmtMoney(tot.tva)} · TTC <b>${U.fmtMoney(tot.ttc)}</b></span></div>${t.html}</div>`;
      t.bind(UI.$('#q-out')); UI.$$('#q-out th[data-sort]').forEach(th => th.onclick = () => { APP.sort.qd = APP.sort.q === th.dataset.sort ? -(APP.sort.qd || 1) : 1; APP.sort.q = th.dataset.sort; run(); });
    };
    UI.$('#q-run', v).onclick = run; UI.$('#q-export', v).onclick = () => EXCEL.exportQuittance(APP.quittance || []);
    if (APP.quittance) run();
  },
  // ===== Yardi =====
  async vYardi(v) {
    const imp = await DB.get('yardi', 'current'); APP.yardiRows = imp ? imp.rows : [];
    const linked = APP.filtered().filter(b => b.yardi && b.yardi.tenantCodes && b.yardi.tenantCodes.length);
    v.innerHTML = `<div class="panel"><h2>Rapprochement Yardi</h2>
      <div class="row"><button id="y-file">Importer un export (xlsx / csv)…</button><input type="file" id="y-in" accept=".xlsx,.xls,.csv,.txt,.tsv" class="hidden"><button id="y-paste">Coller un export…</button>
        <span class="muted">${imp ? `${APP.yardiRows.length} lignes importées le ${imp.date.slice(0, 16).replace('T', ' ')}` : 'Aucun export importé'}</span>
        <span style="flex:1"></span><button id="y-match">Associer automatiquement les locataires</button></div>
      <p class="muted small">Colonnes reconnues : Property, Tenant, Unit, Description, Charge Code, Net, VAT, Total Amount, Charge From, Charge To. Le code locataire (t…) est lu dans la colonne Tenant. Un bail peut être associé à plusieurs codes (fiche bail, groupe Yardi).</p>
      <div class="row"><label>Mode <select id="y-mode"><option value="global">Global (par locataire et code charge)</option><option value="detail" ${APP.yMode === 'detail' ? 'selected' : ''}>Détail (par mois)</option></select></label>
        <label>Statut <select id="y-statut"><option value="">Tous</option>${UI.opts(['Écart', 'Yardi seul', 'Calcul seul', 'OK', 'Yardi absent'], APP.yStatut)}</select></label>
        <button id="y-run" class="primary" ${APP.yardiRows.length && linked.length ? '' : 'disabled'}>Rapprocher (${linked.length} baux associés)</button><button id="y-export" ${APP.rapp ? '' : 'disabled'}>Exporter les corrections (Excel)</button></div></div><div id="y-out"></div>`;
    UI.$('#y-file', v).onclick = () => UI.$('#y-in', v).click();
    UI.$('#y-in', v).onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const rows = /\.xlsx?$/i.test(f.name) ? YARDI.parseWorkbook(await U.readFile(f)) : YARDI.parseText(await U.readFile(f, 'text')); await APP.saveYardi(rows, f.name); } catch (ex) { UI.toast('Erreur : ' + ex.message, 5000); } };
    UI.$('#y-paste', v).onclick = () => UI.modal(`<h2>Coller l'export Yardi (copié depuis Excel)</h2><textarea id="y-txt" class="wide" style="width:70vw;min-height:40vh"></textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button data-close>Annuler</button><button id="y-ok" class="primary">Importer</button></div>`, b => { UI.$('#y-ok', b).onclick = async () => { try { const rows = YARDI.parseText(UI.$('#y-txt', b).value); UI.closeModal(); await APP.saveYardi(rows, 'collage'); } catch (ex) { UI.toast('Erreur : ' + ex.message, 5000); } }; });
    UI.$('#y-match', v).onclick = async () => { let n = 0; for (const b of APP.baux) { if (b.yardi && b.yardi.tenantCodes && b.yardi.tenantCodes.length) continue; const s = YARDI.suggest(b, APP.yardiRows); if (s.length && s[0].score >= 0.8) { b.yardi = b.yardi || {}; b.yardi.tenantCodes = [s[0].code]; b.yardi.unitCodes = [...new Set(APP.yardiRows.filter(r => r.tenantCode === s[0].code).map(r => r.unitCode).filter(Boolean))]; await DB.put('baux', b); n++; } } UI.toast(`${n} bail(x) associé(s) par le nom du locataire ; vérifiez dans chaque fiche`); APP.render(); };
    const run = () => {
      APP.yMode = UI.$('#y-mode').value; APP.yStatut = UI.$('#y-statut').value; APP.rapp = YARDI.reconcile(linked, APP.yardiRows, APP.yMode); UI.$('#y-export').disabled = !APP.rapp.length;
      let rows = APP.rapp; if (APP.yStatut) rows = rows.filter(r => r.statut === APP.yStatut);
      const cols = [{ key: 'statut', label: 'Statut', render: s => UI.tag(s) }, { key: 'ref', label: 'Réf.' }, { key: 'preneur', label: 'Preneur' }, { key: 'actif', label: 'Actif' }, { key: 'tenantCodes', label: 'Codes Yardi' }, { key: 'chargeCode', label: 'Code charge' }, { key: 'mois', label: 'Période' }, { key: 'yardi', label: 'Yardi HT', num: true }, { key: 'calcul', label: 'Calcul HT', num: true }, { key: 'ecart', label: 'Écart', num: true, render: (x, r) => x === undefined ? '' : `<span class="${Math.abs(x) <= 1 ? 'ok' : 'error'}">${U.fmtNum(x)}</span>` }, { key: 'warnings', label: 'Avertissements', render: (x, r) => U.esc(x || r.note || '') }];
      const t = UI.table(cols, rows, { sortKey: APP.sort.y, sortDir: APP.sort.yd || 1, onRow: r => { APP.sel = null; APP.filters.statut = ''; APP.go('baux'); APP.select(r.bailId); } });
      const nEc = APP.rapp.filter(r => r.statut !== 'OK').length;
      UI.$('#y-out').innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><b>${rows.length} lignes affichées</b><span>${nEc} ligne(s) à corriger sur ${APP.rapp.length}</span></div>${t.html}</div>`;
      t.bind(UI.$('#y-out')); UI.$$('#y-out th[data-sort]').forEach(th => th.onclick = () => { APP.sort.yd = APP.sort.y === th.dataset.sort ? -(APP.sort.yd || 1) : 1; APP.sort.y = th.dataset.sort; run(); });
    };
    UI.$('#y-run', v).onclick = run; UI.$('#y-export', v).onclick = () => EXCEL.exportRapprochement(APP.rapp || []);
    if (APP.rapp && APP.yardiRows.length && linked.length) run();
  },
  async saveYardi(rows, name) { if (!rows.length) throw new Error('Aucune ligne reconnue'); await DB.put('yardi', { id: 'current', date: new Date().toISOString(), name, rows }); APP.rapp = null; UI.toast(`${rows.length} lignes Yardi importées`); APP.render(); },
  // ===== Paramètres =====
  vParams(v) {
    const codes = CALC.codes || CALC.DEFAULT_CODES;
    v.innerHTML = `<div class="panel"><h2>Sauvegarde</h2>
      <div class="row"><button id="p-exp-enc" class="primary">Exporter une sauvegarde chiffrée (.bbx)</button><button id="p-exp-clear">Exporter en clair (.json)</button><label><input type="checkbox" id="p-withpdf" checked> inclure les PDF</label></div>
      <div class="row" style="margin-top:8px"><button id="p-imp">Restaurer une sauvegarde…</button><input type="file" id="p-imp-file" accept=".bbx,.json" class="hidden"><label><input type="checkbox" id="p-replace"> remplacer les données existantes</label></div>
      <p class="muted small">La sauvegarde chiffrée utilise un mot de passe de votre choix (AES-256-GCM). L'export en clair contient toutes les données lisibles : à réserver à un emplacement protégé.</p></div>
      <div class="panel"><h2>Export Excel de la base</h2><div class="row"><button id="p-xlsx" class="primary">Exporter la base complète (.xlsx)</button><span class="muted small">Onglets : Baux, Lignes de loyer, Surfaces, Paliers, Avenants, Indices, Quittancement et Rapprochement (s'ils ont été calculés).</span></div></div>
      <div class="panel"><h2>Sécurité</h2><div class="row"><button id="p-pass">Changer le mot de passe maître</button><label>Verrouillage auto après <input type="number" id="p-delay" value="${SESSION.delayMin}" min="0" style="width:60px"> min (0 = jamais)</label></div></div>
      <div class="panel"><h2>Codes de charge Yardi</h2><div class="row">${Object.keys(CALC.DEFAULT_CODES).map(k => `<label>${CALC.LABELS[k] || k} (${k}) <input data-code="${k}" value="${U.esc(codes[k] || '')}" style="width:90px"></label>`).join('')}</div></div>
      <div class="panel"><h2>Extraction</h2><div class="row"><button id="p-reextract">Ré-extraire tous les baux non validés</button><button id="p-forget">Oublier les ancres apprises</button><span class="muted small">${Object.values(APP.learned).reduce((n, a) => n + a.length, 0)} ancre(s) apprise(s) à partir de vos corrections.</span></div></div>
      <div class="panel"><h2>Zone dangereuse</h2><button id="p-wipe" class="danger">Effacer toutes les données du dossier</button></div>
      <p class="muted small">Version du <!--BUILD-->. Librairies : pdf.js, Tesseract.js, SheetJS (licences Apache 2.0). Aucune connexion réseau.</p>`;
    UI.$('#p-exp-enc', v).onclick = async () => { const pw = await UI.prompt('Mot de passe de la sauvegarde (8 caractères minimum) :', { type: 'password' }); if (!pw || pw.length < 8) { if (pw !== null) UI.toast('Trop court'); return; } UI.toast('Préparation…'); const data = await DB.exportAll(UI.$('#p-withpdf').checked); U.download(`sauvegarde_baux_${U.toISO(new Date())}.bbx`, await CRYPTO.packFile(data, pw), 'application/octet-stream'); };
    UI.$('#p-exp-clear', v).onclick = async () => { if (!(await UI.confirm('Exporter toutes les données EN CLAIR ? Le fichier sera lisible par quiconque y accède.', { ok: 'Exporter en clair', danger: true }))) return; const data = await DB.exportAll(UI.$('#p-withpdf').checked); U.download(`sauvegarde_baux_${U.toISO(new Date())}.json`, JSON.stringify(data), 'application/json'); };
    UI.$('#p-imp', v).onclick = () => UI.$('#p-imp-file', v).click();
    UI.$('#p-imp-file', v).onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const text = await U.readFile(f, 'text'); let pw = null; if (text.startsWith('{"format":"bail-bail-chiffre"')) pw = await UI.prompt('Mot de passe de la sauvegarde :', { type: 'password' }); const obj = await CRYPTO.unpackFile(text, pw || ''); const replace = UI.$('#p-replace').checked; if (replace && !(await UI.confirm('Remplacer toutes les données actuelles par la sauvegarde ?', { danger: true, ok: 'Remplacer' }))) return; await DB.importAll(obj, { replace }); APP.baux = await DB.all('baux'); await INDICES.load(); APP.learned = await DB.getSetting('learned', {}); UI.toast('Sauvegarde restaurée'); APP.render(); } catch (ex) { UI.toast('Échec : ' + (ex.message || 'mot de passe incorrect ?'), 5000); } };
    UI.$('#p-xlsx', v).onclick = () => EXCEL.exportBase(APP.filtered(), INDICES.cache, APP.quittance, APP.rapp);
    UI.$('#p-pass', v).onclick = async () => { const o = await UI.prompt('Mot de passe actuel :', { type: 'password' }); if (!o) return; const n = await UI.prompt('Nouveau mot de passe (8 caractères minimum) :', { type: 'password' }); if (!n || n.length < 8) return; const n2 = await UI.prompt('Confirmer le nouveau mot de passe :', { type: 'password' }); if (n !== n2) { UI.toast('Les saisies diffèrent'); return; } UI.toast('Ré-encodage en cours…'); if (await SESSION.changePassword(o, n)) UI.toast('Mot de passe changé'); else UI.toast('Mot de passe actuel incorrect'); };
    UI.$('#p-delay', v).onchange = async e => { SESSION.delayMin = Math.max(0, +e.target.value || 0); await DB.setSetting('lockDelay', SESSION.delayMin); SESSION.touch(); };
    UI.$$('[data-code]', v).forEach(i => i.onchange = async () => { CALC.codes[i.dataset.code] = i.value.trim(); await DB.setSetting('codes', CALC.codes); });
    UI.$('#p-reextract', v).onclick = async () => { const L = APP.baux.filter(b => b.statut !== 'valide' && b.pdfId); if (!L.length || !(await UI.confirm(`Ré-extraire ${L.length} bail(x) non validés avec les règles et les ancres apprises ? Les champs saisis à la main sont conservés.`))) return; let n = 0; for (const b of L) { const p = await DB.get('pdfs', b.pdfId); if (!p) continue; const fresh = APP.buildBail({ name: b.pdfName, size: b.pdfSize }, null, p.pages, b.ocr); const keep = ['id', 'ref', 'pdfId', 'pdfName', 'pdfSize', 'pdfPages', 'ocr', 'created', 'history', 'commentaires', 'yardi', 'avenants', 'paliers', 'statut']; const manual = Object.entries(b.fields || {}).filter(([k, m]) => m.conf === 'manuel'); for (const k of Object.keys(fresh)) if (!keep.includes(k)) b[k] = fresh[k]; for (const [k, m] of manual) { const f = UI.FORM.find(x => x.key === k); if (f) { UI.setPath(b, f.path || f.key, UI.getPath(APP.baux.find(x => x.id === b.id), f.path || f.key)); } b.fields[k] = m; } await DB.put('baux', b); n++; } UI.toast(`${n} bail(x) ré-extraits`); APP.render(); };
    UI.$('#p-forget', v).onclick = async () => { if (await UI.confirm('Oublier toutes les ancres apprises ?')) { APP.learned = {}; await DB.setSetting('learned', {}); APP.render(); } };
    UI.$('#p-wipe', v).onclick = async () => { if (!(await UI.confirm('Effacer TOUTES les données (baux, PDF, indices, Yardi) du dossier ? Irréversible.', { ok: 'Tout effacer', danger: true }))) return; const pw = await UI.prompt('Confirmez le mot de passe maître :', { type: 'password' }); if (!pw || !(await SESSION.unlock(pw))) { UI.toast('Mot de passe incorrect'); return; } await DB.wipeAll(); SESSION.lock(); location.reload(); };
  },
};
window.APP = APP;
document.addEventListener('DOMContentLoaded', () => APP.boot());
