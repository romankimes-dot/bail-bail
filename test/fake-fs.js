// Faux File System Access API en mémoire, injecté avant le chargement de la page (tests Playwright).
(() => {
  const mkDir = (name) => {
    const entries = new Map();
    return {
      kind: 'directory', name,
      async getDirectoryHandle(n, { create } = {}) { if (!entries.has(n)) { if (!create) throw new DOMException('not found', 'NotFoundError'); entries.set(n, mkDir(n)); } return entries.get(n); },
      async getFileHandle(n, { create } = {}) { if (!entries.has(n)) { if (!create) throw new DOMException('not found', 'NotFoundError'); entries.set(n, mkFile(n)); } return entries.get(n); },
      async removeEntry(n) { entries.delete(n); },
      async *entries() { for (const [k, v] of entries) yield [k, v]; },
      _entries: entries,
    };
  };
  const toBytes = (c) => c instanceof ArrayBuffer ? new Uint8Array(c) : (ArrayBuffer.isView(c) ? new Uint8Array(c.buffer, c.byteOffset, c.byteLength) : new TextEncoder().encode(String(c)));
  const mkFile = (name) => {
    let data = new Uint8Array(0);
    return { kind: 'file', name, async getFile() { return new File([data], name); },
      async createWritable() { const chunks = []; return { async write(c) { chunks.push(toBytes(c)); }, async close() { const n = chunks.reduce((s, c) => s + c.length, 0); data = new Uint8Array(n); let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; } } }; } };
  };
  window.__fakeRoot = window.__fakeRoot || mkDir('bail-bail-app');
  window.showDirectoryPicker = async () => window.__fakeRoot;
  window.__fakeFsList = async () => { const out = []; const walk = async (d, p) => { for await (const [k, v] of d.entries()) { if (v.kind === 'file') out.push(p + '/' + k + ' (' + (await v.getFile()).size + ' o)'); else await walk(v, p + '/' + k); } }; await walk(window.__fakeRoot, ''); return out; };
})();
