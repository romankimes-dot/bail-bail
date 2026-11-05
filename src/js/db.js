'use strict';
// ---------- Persistance : fichiers chiffrés dans le dossier de l'app (File System Access API) ----------
// Arborescence : <dossier app>/donnees/auth.json (sel + vérificateur), donnees/<store>/<id>.bbx (chiffré), donnees/pdf/<id>.bin (chiffré)
const DB = {
  STORES: ['baux', 'pdfs', 'indices', 'yardi', 'settings'],
  root: null, data: null, dirs: {}, cache: {},
  supported() { return typeof window.showDirectoryPicker === 'function'; },
  async chooseFolder() {
    const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'bail-bail' });
    await DB.useFolder(h); return h;
  },
  async useFolder(h) {
    DB.root = h; DB.data = await h.getDirectoryHandle('donnees', { create: true });
    for (const s of DB.STORES) DB.dirs[s] = await DB.data.getDirectoryHandle(s, { create: true });
    DB.cache = {};
  },
  async _write(dir, name, bytes) {
    const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable();
    await w.write(bytes); await w.close();
  },
  async _read(dir, name) { try { const fh = await dir.getFileHandle(name); return await (await fh.getFile()).arrayBuffer(); } catch { return null; } },
  async _list(dir) { const out = []; for await (const [name, h] of dir.entries()) if (h.kind === 'file') out.push(name); return out; },
  // Conteneur binaire : [4 octets 'BBX1'][12 iv][ct JSON][ optionnel : 4 octets len binaire | 12 iv | ct binaire ]
  async _seal(obj) {
    const { id, ...rest } = obj; let bin = null;
    if (rest.data instanceof ArrayBuffer) { bin = await CRYPTO.encrypt(rest.data); delete rest.data; }
    const js = await CRYPTO.encryptJSON(rest);
    const parts = [new TextEncoder().encode('BBX1'), new Uint8Array(new Uint32Array([js.ct.length]).buffer), js.iv, js.ct];
    if (bin) parts.push(bin.iv, bin.ct);
    const total = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; } return out;
  },
  async _unseal(id, buf) {
    if (!buf) return null; const u = new Uint8Array(buf);
    if (new TextDecoder().decode(u.subarray(0, 4)) !== 'BBX1') throw new Error('Format de fichier inconnu : ' + id);
    const len = new Uint32Array(u.slice(4, 8).buffer)[0];
    const obj = await CRYPTO.decryptJSON({ iv: u.subarray(8, 20), ct: u.subarray(20, 20 + len) }); obj.id = id;
    if (u.length > 20 + len) obj.data = await CRYPTO.decrypt({ iv: u.subarray(20 + len, 32 + len), ct: u.subarray(32 + len) }, CRYPTO.key, false);
    return obj;
  },
  _fname(id) { return encodeURIComponent(id) + '.bbx'; },
  _idOf(name) { return decodeURIComponent(name.replace(/\.bbx$/, '')); },
  async get(store, id) {
    if (DB.cache[store] && DB.cache[store].has(id)) return DB.cache[store].get(id);
    return DB._unseal(id, await DB._read(DB.dirs[store], DB._fname(id)));
  },
  async all(store) {
    if (store !== 'pdfs' && DB.cache[store]) return [...DB.cache[store].values()];
    const names = (await DB._list(DB.dirs[store])).filter(n => n.endsWith('.bbx'));
    const rows = []; for (const n of names) { const r = await DB._unseal(DB._idOf(n), await DB._read(DB.dirs[store], n)); if (r) rows.push(r); }
    if (store !== 'pdfs') DB.cache[store] = new Map(rows.map(r => [r.id, r]));
    return rows;
  },
  async put(store, obj) {
    await DB._write(DB.dirs[store], DB._fname(obj.id), await DB._seal(obj));
    if (store !== 'pdfs' && DB.cache[store]) DB.cache[store].set(obj.id, U.clone(obj));
  },
  async putMany(store, objs) { for (const o of objs) await DB.put(store, o); },
  async del(store, id) { try { await DB.dirs[store].removeEntry(DB._fname(id)); } catch { } if (DB.cache[store]) DB.cache[store].delete(id); },
  async clear(store) { for (const n of await DB._list(DB.dirs[store])) await DB.dirs[store].removeEntry(n); DB.cache[store] = new Map(); },
  async getSetting(key, def = null) { const r = await DB.get('settings', key); return r ? r.value : def; },
  setSetting(key, value) { return DB.put('settings', { id: key, value }); },
  async wipeAll() { for (const s of DB.STORES) await DB.clear(s); try { await DB.data.removeEntry('auth.json'); } catch { } },
  // --- méta en clair (sel, vérificateur, itérations) ---
  async getMeta() { const b = await DB._read(DB.data, 'auth.json'); if (!b) return null; const o = JSON.parse(new TextDecoder().decode(b)); return { salt: CRYPTO.unb64(o.salt), iv: CRYPTO.unb64(o.iv), ct: CRYPTO.unb64(o.ct), iter: o.iter }; },
  async putMeta(m) { await DB._write(DB.data, 'auth.json', new TextEncoder().encode(JSON.stringify({ app: 'bail-bail', salt: CRYPTO.b64(m.salt), iv: CRYPTO.b64(m.iv), ct: CRYPTO.b64(m.ct), iter: m.iter, created: new Date().toISOString() }))); },
  // --- sauvegarde complète (objet en clair en mémoire) ---
  async exportAll(withPdf) {
    const out = { app: 'bail-bail', version: 1, date: new Date().toISOString() };
    for (const s of DB.STORES) {
      if (s === 'pdfs') { if (!withPdf) continue; out.pdfs = (await DB.all('pdfs')).map(p => ({ ...p, data: p.data ? CRYPTO.b64(new Uint8Array(p.data)) : null })); }
      else out[s] = await DB.all(s);
    }
    return out;
  },
  async importAll(obj, { replace = false } = {}) {
    if (!obj || obj.app !== 'bail-bail') throw new Error('Fichier de sauvegarde non reconnu');
    for (const s of DB.STORES) {
      if (!obj[s]) continue; if (replace) await DB.clear(s);
      let rows = obj[s]; if (s === 'pdfs') rows = rows.map(p => ({ ...p, data: p.data ? U.b64ToBytes(p.data).buffer : null }));
      await DB.putMany(s, rows);
    }
    DB.cache = {};
  },
};
// ---------- Session : mot de passe maître, verrouillage ----------
const SESSION = {
  locked: true, timer: null, delayMin: 15,
  async hasPassword() { return !!(await DB.getMeta()); },
  async create(password) {
    const salt = CRYPTO.randomSalt(); const key = await CRYPTO.deriveKey(password, salt); const v = await CRYPTO.makeVerifier(key);
    await DB.putMeta({ salt, iv: v.iv, ct: v.ct, iter: CRYPTO.ITER });
    CRYPTO.key = key; SESSION.locked = false; SESSION.touch(); return true;
  },
  async unlock(password) {
    const a = await DB.getMeta(); if (!a) return false;
    const key = await CRYPTO.deriveKey(password, a.salt);
    if (!(await CRYPTO.checkVerifier({ iv: a.iv, ct: a.ct }, key))) return false;
    CRYPTO.key = key; SESSION.locked = false; SESSION.touch(); return true;
  },
  async changePassword(oldP, newP) {
    if (!(await SESSION.unlock(oldP))) return false;
    const data = {}; for (const s of DB.STORES) data[s] = await DB.all(s);
    const salt = CRYPTO.randomSalt(); const key = await CRYPTO.deriveKey(newP, salt); const v = await CRYPTO.makeVerifier(key);
    CRYPTO.key = key;
    for (const s of DB.STORES) { await DB.clear(s); await DB.putMany(s, data[s]); }
    await DB.putMeta({ salt, iv: v.iv, ct: v.ct, iter: CRYPTO.ITER }); return true;
  },
  lock() { CRYPTO.key = null; SESSION.locked = true; DB.cache = {}; clearTimeout(SESSION.timer); if (window.APP) APP.onLock(); },
  touch() { clearTimeout(SESSION.timer); if (SESSION.delayMin > 0) SESSION.timer = setTimeout(() => SESSION.lock(), SESSION.delayMin * 60000); },
};
