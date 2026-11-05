'use strict';
// ---------- Chiffrement (WebCrypto : PBKDF2 + AES-256-GCM) ----------
// Toutes les données persistées dans IndexedDB sont chiffrées avec une clé dérivée du mot de passe maître.
const CRYPTO = {
  key: null, salt: null, ITER: 310000,
  enc: new TextEncoder(), dec: new TextDecoder(),
  async deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', CRYPTO.enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: CRYPTO.ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  // Chiffre une chaîne ou un ArrayBuffer -> {iv, ct} (Uint8Array)
  async encrypt(data, key = CRYPTO.key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = typeof data === 'string' ? CRYPTO.enc.encode(data) : new Uint8Array(data);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);
    return { iv, ct: new Uint8Array(ct) };
  },
  async decrypt({ iv, ct }, key = CRYPTO.key, asText = true) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return asText ? CRYPTO.dec.decode(pt) : pt;
  },
  async encryptJSON(obj) { return CRYPTO.encrypt(JSON.stringify(obj)); },
  async decryptJSON(blob) { return JSON.parse(await CRYPTO.decrypt(blob)); },
  // Vérificateur stocké pour contrôler le mot de passe sans exposer la clé
  async makeVerifier(key) { return CRYPTO.encrypt('bail-bail-ok', key); },
  async checkVerifier(v, key) { try { return (await CRYPTO.decrypt(v, key)) === 'bail-bail-ok'; } catch { return false; } },
  randomSalt() { return crypto.getRandomValues(new Uint8Array(16)); },
  // Conteneur de sauvegarde chiffrée (fichier .bbx) : JSON { format, salt, iv, ct } en base64
  async packFile(obj, password) {
    const salt = CRYPTO.randomSalt(); const key = await CRYPTO.deriveKey(password, salt);
    const { iv, ct } = await CRYPTO.encrypt(JSON.stringify(obj), key);
    return JSON.stringify({ format: 'bail-bail-chiffre', version: 1, iter: CRYPTO.ITER, salt: CRYPTO.b64(salt), iv: CRYPTO.b64(iv), ct: CRYPTO.b64(ct) });
  },
  async unpackFile(text, password) {
    const o = JSON.parse(text);
    if (o.format !== 'bail-bail-chiffre') return o; // sauvegarde en clair
    const key = await CRYPTO.deriveKey(password, CRYPTO.unb64(o.salt));
    return JSON.parse(await CRYPTO.decrypt({ iv: CRYPTO.unb64(o.iv), ct: CRYPTO.unb64(o.ct) }, key));
  },
  b64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); },
  unb64(b) { return U.b64ToBytes(b); },
};
