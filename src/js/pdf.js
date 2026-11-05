'use strict';
// ---------- Lecture des PDF (pdf.js) ----------
const PDF = {
  _init: false,
  init() {
    if (PDF._init) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = U.blobUrl(window.__ASSETS.pdfWorker);
    PDF._init = true;
  },
  async open(data) { PDF.init(); return pdfjsLib.getDocument({ data: data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : data, isEvalSupported: false }).promise; },
  // Extrait le texte de chaque page. Reconstitue les lignes à partir des positions.
  async extractText(doc, onProgress) {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items = tc.items.filter(it => it.str !== undefined);
      // regroupe par ligne (même y approx.), ordonne par x
      const lines = [];
      for (const it of items) {
        const y = Math.round(it.transform[5]), x = it.transform[4];
        let line = lines.find(l => Math.abs(l.y - y) <= 2);
        if (!line) { line = { y, parts: [] }; lines.push(line); }
        line.parts.push({ x, str: it.str, w: it.width, h: it.height, hasEOL: it.hasEOL });
      }
      lines.sort((a, b) => b.y - a.y);
      const text = lines.map(l => l.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      const vp = page.getViewport({ scale: 1 });
      pages.push({ num: i, text, width: vp.width, height: vp.height, items: items.filter(it => it.str.trim()).map(it => ({ s: it.str, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5] * 10) / 10, w: Math.round(it.width * 10) / 10, h: Math.round((it.height || Math.abs(it.transform[3]) || 10) * 10) / 10 })) });
      if (onProgress) onProgress(i, doc.numPages);
    }
    return pages;
  },
  async render(doc, pageNum, canvas, scale = 1.3) {
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale });
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return vp;
  },
};
