// 📦 Email-chat cache (Elie 11/15/26: "it takes an awfully long time… could it
// be stored?"). Each pinned chain's messages are kept in memory for the session
// and in IndexedDB across reloads, so a chat opens instantly from the saved
// copy and refreshes quietly in the background. Keys are per signed-in mailbox.
const MEM = new Map(); // key -> { at, data }
let dbp = null;
const db = () => dbp || (dbp = new Promise((res) => {
  try {
    const r = indexedDB.open("gs_mail", 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore("t"); } catch { /* exists */ } };
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  } catch { res(null); }
}));
export const memGet = (k) => MEM.get(k) || null;
export async function cacheGet(k) {
  const m = MEM.get(k);
  if (m) return m;
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    try {
      const q = d.transaction("t").objectStore("t").get(k);
      q.onsuccess = () => { const v = q.result || null; if (v) MEM.set(k, v); res(v); };
      q.onerror = () => res(null);
    } catch { res(null); }
  });
}
export async function cachePut(k, data) {
  const v = { at: Date.now(), data };
  MEM.set(k, v);
  const d = await db();
  if (!d) return;
  try { d.transaction("t", "readwrite").objectStore("t").put(v, k); } catch { /* quota — memory copy still works */ }
}
// Small session-only cache for the per-chain unread/in-my-mailbox checks.
const UNREAD = new Map(); // key -> { at, n, inb }
export const unreadGet = (k) => UNREAD.get(k) || null;
export const unreadPut = (k, n, inb) => UNREAD.set(k, { at: Date.now(), n, inb });
