<!doctype html><html><head><meta charset="utf-8"><title>proto</title></head><body>
<pre id="log"></pre>
<!--VENDOR-->
<!--ASSETS-->
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\n'; console.log(m); };
const blobUrl = (text, type='application/javascript') => URL.createObjectURL(new Blob([text], {type}));
const b64ToBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; };
window.runTests = async function(pdfB64) {
  const out = {};
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl(window.__ASSETS.pdfWorker);
    const doc = await pdfjsLib.getDocument({data: b64ToBytes(pdfB64)}).promise;
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    out.pdfPages = doc.numPages; out.pdfText = tc.items.map(i=>i.str).join(' ').slice(0,200);
    log('pdf ok ' + out.pdfPages + ' pages: ' + out.pdfText);
    // render page 1 to canvas, then OCR it
    const vp = page.getViewport({scale: 1.5});
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({canvasContext: c.getContext('2d'), viewport: vp}).promise;
    const t0 = Date.now();
    const worker = await Tesseract.createWorker([{code:'fra', data: b64ToBytes(window.__ASSETS.fraTraineddataGz)}], 1, {
      workerPath: blobUrl(window.__ASSETS.tessWorker),
      corePath: blobUrl(window.__ASSETS.tessCoreSimd),
      workerBlobURL: false,
      logger: m => { if (m.status && m.progress===1) log('tess: ' + m.status); }
    });
    const r = await worker.recognize(c);
    out.ocr = r.data.text.slice(0,300); out.ocrMs = Date.now()-t0;
    log('ocr ok in ' + out.ocrMs + 'ms: ' + out.ocr);
    await worker.terminate();
  } catch (e) { out.error = String(e && e.stack || e); log('ERR ' + out.error); }
  return out;
};
</script></body></html>
