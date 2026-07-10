// Contractor-portal data layer, shared by the admin Contractors page and the
// contractor-facing portal. Each table is {id, org_id, data(jsonb)} — the app
// object lives whole in `data`; org_id is denormalized for RLS scoping.
//
// ONE shared store for the whole app: every useContractorData() consumer reads
// the same module-level cache, fed by a single load + a single realtime
// channel. (It used to be per-component: seven mounted copies meant seven full
// downloads of every table on every change and every app-foregrounding — the
// #1 reason the app felt slower as messages and jobs piled up.)
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const TABLES = ["contractor_orgs", "contractor_jobs", "contractor_tasks", "contractor_messages", "contractor_docs", "site_status"];
const keyOf = (table) => ({ contractor_orgs: "orgs", contractor_jobs: "jobs", contractor_tasks: "tasks", contractor_messages: "messages", contractor_docs: "docs", site_status: "siteStatus" })[table];

let store = { orgs: null, jobs: null, tasks: null, messages: null, docs: null, siteStatus: null, error: "" };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* consumer unmounted */ } });
const timers = {};
let started = false;

async function loadTable(table) {
  // RLS scopes results automatically: team sees everything, a contractor login
  // only ever receives their own company's rows.
  const { data, error: err } = await supabase.from(table).select("id,data").order("id");
  if (err) { store = { ...store, error: err.message || "Couldn't load portal data." }; emit(); return; }
  store = { ...store, error: "", [keyOf(table)]: (data || []).map((r) => r.data).filter(Boolean) };
  emit();
}
const loadAll = () => { TABLES.forEach((t) => loadTable(t)); };
const scheduleLoad = (table) => { clearTimeout(timers[table]); timers[table] = setTimeout(() => loadTable(table), 250); };

function start() {
  if (started) return;
  started = true;
  loadAll();
  const chan = supabase.channel("ctr-shared");
  TABLES.forEach((table) => chan.on("postgres_changes", { event: "*", schema: "public", table }, () => scheduleLoad(table)));
  chan.subscribe();
  // Refresh when the app comes back to the foreground (same reason the main
  // DataProvider does — realtime sockets die while a phone is asleep).
  const onShow = () => { if (document.visibilityState === "visible") TABLES.forEach(scheduleLoad); };
  document.addEventListener("visibilitychange", onShow);
  // A different login on the same device sees different rows (RLS): wipe the
  // cache on sign-out, refetch on the next sign-in.
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      store = { orgs: null, jobs: null, tasks: null, messages: null, docs: null, siteStatus: null, error: "" };
      emit();
    } else if (event === "SIGNED_IN") loadAll();
  });
}

// Insert-or-update one row. The full object goes in `data`; orgId also lands in
// the org_id column so RLS can scope it. contractor_orgs has NO org_id column
// (the row id IS the org) — sending one makes Postgres reject the write.
async function save(table, obj) {
  const row = { id: String(obj.id), data: obj, updated_at: new Date().toISOString() };
  // contractor_orgs and site_status have no org_id column (org rows ARE the org;
  // site_status is keyed by property and shared across every contractor on it).
  if (table !== "contractor_orgs" && table !== "site_status") row.org_id = obj.orgId != null ? String(obj.orgId) : null;
  const { error: err } = await supabase.from(table).upsert(row, { onConflict: "id" });
  if (err) throw new Error(err.message || "Save failed.");
  await loadTable(table);
}

async function remove(table, id) {
  const { error: err } = await supabase.from(table).delete().eq("id", String(id));
  if (err) throw new Error(err.message || "Delete failed.");
  await loadTable(table);
}

export function useContractorData() {
  const [, force] = useState(0);
  useEffect(() => {
    start();
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return { ...store, save, remove, reload: loadAll };
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
