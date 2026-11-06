#!/usr/bin/env node
// Assemble dist/index.html : un seul fichier autonome (CSS, JS et librairies inline).
const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
const asJsonString = (s) => JSON.stringify(s).replace(/<\//g, '<\\/');

const jsOrder = ['util.js','crypto.js','db.js','indices.js','pdf.js','ocr.js','extract.js','calc.js','yardi.js','excel.js','ui.js','app.js'];
const appJs = jsOrder.map(f => `/* ===== src/js/${f} ===== */\n` + read('src/js/' + f)).join('\n\n');
const css = read('src/css/app.css');

const assets = {
  pdfWorker: read('vendor/pdf.worker.min.js'),
  // Correctif tesseract.js 6.0.1 : initialize() lit .data au lieu de .code pour les langues passées en objet {code, data}
  tessWorker: read('vendor/worker.min.js').replace('return"string"==typeof t?t:t.data', 'return"string"==typeof t?t:t.code'),
  tessCoreSimd: read('vendor/tesseract-core-simd-lstm.wasm.js'),
  tessCore: read('vendor/tesseract-core-lstm.wasm.js'),
  fraTraineddataGz: fs.readFileSync(path.join(root, 'vendor/fra.traineddata.gz')).toString('base64'),
};
const assetsJs = 'window.__ASSETS = {' + Object.entries(assets).map(([k, v]) => `${k}: ${asJsonString(v)}`).join(',\n') + '};';

let html = read('src/index.html');
// Remplacement par fonction : évite l'interprétation des motifs $& / $1 présents dans les librairies.
const put = (h, tag, content) => h.replace(tag, () => content);
html = put(html, '<!--CSS-->', `<style>\n${css}\n</style>`);
html = put(html, '<!--VENDOR-->', ['pdf.min.js','xlsx.full.min.js','tesseract.min.js'].map(f => `<script>\n${safe(read('vendor/' + f))}\n</script>`).join('\n'));
html = put(html, '<!--ASSETS-->', `<script>\n${assetsJs}\n</script>`);
html = put(html, '<!--APP-->', `<script>\n${safe(appJs)}\n</script>`);
html = put(html, '<!--BUILD-->', new Date().toISOString().slice(0, 10));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/Bail-Bail.html'), html);
console.log('dist/Bail-Bail.html écrit :', (html.length / 1048576).toFixed(1), 'Mo');
