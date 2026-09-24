// Last-known-data snapshots (localStorage). The app paints instantly from the
// snapshot on launch, then the normal network refresh replaces it in place —
// launches feel instant instead of waiting on every table to re-download.
// Writes are best-effort: quota errors / private mode just skip the cache.
import { supabase } from "./supabaseClient";

const K = (name) => `gs-snap-v1-${name}`;

export function readSnap(name) {
  try { const s = localStorage.getItem(K(name)); return s ? JSON.parse(s) : null; } catch { return null; }
}
// Written when the browser is idle, at most once per table per burst: the
// properties and settings snapshots are megabytes, and stringifying + storing
// them synchronously on every reload froze the page (Elie 9/24/26).
const pending = new Map(); // name -> { value, handle }
const idle = (fn) => (typeof requestIdleCallback === "function" ? { i: requestIdleCallback(fn, { timeout: 4000 }) } : { t: setTimeout(fn, 1200) });
const cancelIdle = (h) => { if (!h) return; if (h.i != null && typeof cancelIdleCallback === "function") cancelIdleCallback(h.i); if (h.t != null) clearTimeout(h.t); };
export function writeSnap(name, value) {
  const cur = pending.get(name);
  if (cur) { cur.value = value; return; }
  const entry = { value, handle: null };
  entry.handle = idle(() => {
    pending.delete(name);
    try { localStorage.setItem(K(name), JSON.stringify(entry.value)); } catch { /* quota / private mode */ }
  });
  pending.set(name, entry);
}
export function clearSnaps() {
  pending.forEach((e) => cancelIdle(e.handle)); // a queued write must never land after a sign-out
  pending.clear();
  try { Object.keys(localStorage).filter((k) => k.startsWith("gs-snap-")).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

// A different login on this device must never see the previous account's data.
supabase.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") clearSnaps(); });

// Belt-and-braces for the same risk when no SIGNED_OUT ever fired (an expired
// session, a cleared cookie): every consumer stamps the owner before reading —
// a different user id wipes the previous account's snapshots first.
export function ensureSnapOwner(uid) {
  try {
    const cur = localStorage.getItem("gs-snap-owner");
    if (cur && cur !== String(uid)) clearSnaps();
    localStorage.setItem("gs-snap-owner", String(uid));
  } catch { /* ignore */ }
}
