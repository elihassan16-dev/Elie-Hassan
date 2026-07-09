// Contractor-portal data layer, shared by the admin Contractors page and the
// contractor-facing portal. Each table is {id, org_id, data(jsonb)} — the app
// object lives whole in `data`; org_id is denormalized for RLS scoping.
// Simple load-once + realtime-reload semantics (no offline queue — portal
// writes are small and immediate).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

const TABLES = ["contractor_orgs", "contractor_jobs", "contractor_tasks", "contractor_messages", "contractor_docs"];

export function useContractorData() {
  const [store, setStore] = useState({ orgs: null, jobs: null, tasks: null, messages: null, docs: null });
  const [error, setError] = useState("");
  const keyOf = (table) => ({ contractor_orgs: "orgs", contractor_jobs: "jobs", contractor_tasks: "tasks", contractor_messages: "messages", contractor_docs: "docs" })[table];

  const loadTable = useCallback(async (table) => {
    // RLS scopes results automatically: team sees everything, a contractor login
    // only ever receives their own company's rows.
    const { data, error: err } = await supabase.from(table).select("id,data").order("id");
    if (err) { setError(err.message || "Couldn't load portal data."); return; }
    setStore((s) => ({ ...s, [keyOf(table)]: (data || []).map((r) => r.data).filter(Boolean) }));
  }, []);

  const loadAll = useCallback(() => { TABLES.forEach(loadTable); }, [loadTable]);

  const timers = useRef({});
  useEffect(() => {
    loadAll();
    const chan = supabase.channel("contractor-portal");
    TABLES.forEach((table) => {
      chan.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(timers.current[table]);
        timers.current[table] = setTimeout(() => loadTable(table), 250);
      });
    });
    chan.subscribe();
    // Also refresh when the app comes back to the foreground (same reason the
    // main DataProvider does — realtime sockets die while a phone is asleep).
    const onShow = () => { if (document.visibilityState === "visible") loadAll(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { supabase.removeChannel(chan); document.removeEventListener("visibilitychange", onShow); Object.values(timers.current).forEach(clearTimeout); };
  }, [loadAll, loadTable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Insert-or-update one row. The full object goes in `data`; orgId also lands in
  // the org_id column so RLS can scope it. contractor_orgs has NO org_id column
  // (the row id IS the org) — sending one makes Postgres reject the write.
  const save = useCallback(async (table, obj) => {
    const row = { id: String(obj.id), data: obj, updated_at: new Date().toISOString() };
    if (table !== "contractor_orgs") row.org_id = obj.orgId != null ? String(obj.orgId) : null;
    const { error: err } = await supabase.from(table).upsert(row, { onConflict: "id" });
    if (err) throw new Error(err.message || "Save failed.");
    await loadTable(table);
  }, [loadTable]);

  const remove = useCallback(async (table, id) => {
    const { error: err } = await supabase.from(table).delete().eq("id", String(id));
    if (err) throw new Error(err.message || "Delete failed.");
    await loadTable(table);
  }, [loadTable]);

  return { ...store, error, save, remove, reload: loadAll };
}

// ── Shared job math ──────────────────────────────────────────────────────────
export const jobTotal = (j) => (Number(j.price) || 0) + (j.changeOrders || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
export const jobPaid = (j) => (j.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const jobLeft = (j) => jobTotal(j) - jobPaid(j);
export const jobDays = (j) => {
  if (!j.startDate) return null;
  const s = new Date(String(j.startDate).slice(0, 10) + "T00:00:00");
  if (isNaN(s)) return null;
  return Math.max(0, Math.round((Date.now() - s.getTime()) / 86400000));
};
export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return iso || ""; } };
export const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
