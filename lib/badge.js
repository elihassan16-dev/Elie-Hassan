// 🔴 App-icon badge (Elie 10/18/26): the red number on the Goldstone icon.
// Each person's current count lives in app_settings "badge_<uid>" ({n}). The
// app sets the real number whenever it's open (/api/notify/badge); every push
// sent while it's closed bumps it by one and carries it to the phone.
const rowId = (uid) => `badge_${uid}`;

export async function bumpBadges(db, uids) {
  const out = {};
  const ids = [...new Set((uids || []).filter(Boolean).map(String))];
  if (!ids.length) return out;
  try {
    const { data } = await db.from("app_settings").select("id,data").in("id", ids.map(rowId));
    const cur = Object.fromEntries((data || []).map((r) => [r.id, Number(r.data && r.data.n) || 0]));
    const now = new Date().toISOString();
    const rows = ids.map((uid) => { const n = Math.min(99, (cur[rowId(uid)] || 0) + 1); out[uid] = n; return { id: rowId(uid), data: { id: rowId(uid), n, at: now }, updated_at: now }; });
    await db.from("app_settings").upsert(rows, { onConflict: "id" });
  } catch { /* the push still goes out, just without a number */ }
  return out;
}

export async function setBadge(db, uid, n) {
  const now = new Date().toISOString();
  const v = Math.max(0, Math.min(99, Math.round(Number(n) || 0)));
  await db.from("app_settings").upsert({ id: rowId(uid), data: { id: rowId(uid), n: v, at: now }, updated_at: now }, { onConflict: "id" });
  return v;
}
