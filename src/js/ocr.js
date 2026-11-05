'use strict';
// ---------- OCR (Tesseract.js, worker hors ligne) ----------
const OCR = {
  worker: null,
  async get(onLog) {
    if (OCR.worker) return OCR.worker;
    const A = window.__ASSETS;
    const simd = await OCR._simdOK();
    // Le moteur WASM est concaténé au script du worker : aucun chargement réseau.
    const workerSrc = (simd ? A.tessCoreSimd : A.tessCore) + '\n' + A.tessWorker;
    OCR.worker = await Tesseract.createWorker([{ code: 'fra', data: U.b64ToBytes(A.fraTraineddataGz) }], 1, {
      workerPath: U.blobUrl(workerSrc), corePath: 'inline.js', workerBlobURL: false, cacheMethod: 'none',
      logger: m => { if (onLog) onLog(m); },
    });
    return OCR.worker;
  },
  async _simdOK() { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; } },
  // OCR de toutes les pages d'un document pdf.js ; renvoie [{num, text}]
  async ocrDocument(doc, onProgress) {
    const worker = await OCR.get();
    const pages = []; const canvas = document.createElement('canvas');
    for (let i = 1; i <= doc.numPages; i++) {
      await PDF.render(doc, i, canvas, 2);
      const r = await worker.recognize(canvas);
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 }); pages.push({ num: i, text: r.data.text, width: vp.width, height: vp.height, items: [], ocr: true });
      if (onProgress) onProgress(i, doc.numPages);
    }
    return pages;
  },
  async terminate() { if (OCR.worker) { await OCR.worker.terminate(); OCR.worker = null; } },
};
