// Per-user state that GROWS (read stamps per text thread, seen task ids, …)
// lives in its own app_settings row "uprefs_<userId>" — NOT in auth
// user_metadata. Everything in user_metadata is copied into the login token
// that rides on every request, and once it passed ~16KB file uploads failed
// with "Exceeded maximum allowed HTTP header size" (Elie 10/5/26).
import { supabase } from "./supabaseClient";

export const BIG_KEYS = ["smsRead", "taskSeenIds", "propPushOrder", "callDismiss"];
const rowId = (uid) => `uprefs_${uid}`;

export async function sessionUid() {
  try { const { data } = await supabase.auth.getSession(); return data?.session?.user?.id || null; } catch { return null; }
}

export async function loadBigPrefs(uid) {
  if (!uid) return null;
  const { data, error } = await supabase.from("app_settings").select("data").eq("id", rowId(uid)).maybeSingle();
  if (error) throw error;
  return (data && data.data) || {};
}

// Merges the given top-level keys into the row (re-reads first so another
// device's keys aren't wiped).
export async function saveBigPrefs(uid, patch) {
  if (!uid || !patch) return;
  let cur = {};
  try { cur = (await loadBigPrefs(uid)) || {}; } catch { /* write what we have */ }
  const next = { ...cur, ...patch };
  const { error } = await supabase.from("app_settings").upsert({ id: rowId(uid), data: next, updated_at: new Date().toISOString() });
  if (error) throw error;
  return next;
}

export const splitBig = (patch) => {
  const big = {}, small = {};
  Object.entries(patch || {}).forEach(([k, v]) => { (BIG_KEYS.includes(k) ? big : small)[k] = v; });
  return { big, small };
};

// One-time move: copy any big keys still in user_metadata into the row
// (returns the merged row) …
export const staleBigKeys = (user) => BIG_KEYS.filter((k) => ((user && user.user_metadata) || {})[k] != null);
export async function moveBigPrefs(user) {
  const meta = (user && user.user_metadata) || {};
  const cur = (await loadBigPrefs(user.id)) || {};
  const patch = {};
  staleBigKeys(user).forEach((k) => {
    const a = meta[k], b = cur[k];
    if (b == null) patch[k] = a;
    else if (k === "smsRead" && a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) {
      // newest stamp per thread wins
      const m = { ...a };
      Object.entries(b).forEach(([p, t]) => { if (!m[p] || String(t) > String(m[p])) m[p] = t; });
      patch[k] = m;
    }
  });
  return Object.keys(patch).length ? await saveBigPrefs(user.id, patch) : cur;
}
// … then blank them in user_metadata and refresh so the login token shrinks NOW.
export async function clearBigMeta(user) {
  const clear = {}; staleBigKeys(user).forEach((k) => { clear[k] = null; });
  if (!Object.keys(clear).length) return;
  const { error } = await supabase.auth.updateUser({ data: clear });
  if (!error) { try { await supabase.auth.refreshSession(); } catch { /* next refresh shrinks it */ } }
}
