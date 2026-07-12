// Last-known-data snapshots (localStorage). The app paints instantly from the
// snapshot on launch, then the normal network refresh replaces it in place —
// launches feel instant instead of waiting on every table to re-download.
// Writes are best-effort: quota errors / private mode just skip the cache.
import { supabase } from "./supabaseClient";

const K = (name) => `gs-snap-v1-${name}`;

export function readSnap(name) {
  try { const s = localStorage.getItem(K(name)); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function writeSnap(name, value) {
  try { localStorage.setItem(K(name), JSON.stringify(value)); } catch { /* quota / private mode */ }
}
export function clearSnaps() {
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
