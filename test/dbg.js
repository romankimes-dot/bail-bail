const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('[pageerror]', e.message)); p.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 300)));
  await p.addInitScript({ path: path.join(__dirname, 'fake-fs.js') }); await p.goto('file://' + path.resolve(__dirname, '../dist/index.html'));
  await p.waitForTimeout(500); console.log(await p.evaluate(() => ({ supported: DB.supported(), lockErr: document.querySelector('#lock-error').textContent, btn: document.querySelector('#btn-folder').disabled })));
  await p.click('#btn-folder'); await p.waitForTimeout(1500); console.log(await p.evaluate(() => ({ lockErr: document.querySelector('#lock-error').textContent, cls: document.querySelector('#lock-step-pass').className }))); await b.close(); })();
