import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { INIT_PROPS, INIT_LEADS, DEFAULT_CONTACTS } from "../seed";

export const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

// ── Row <-> app-object mapping ────────────────────────────────────────────────
// Each table keeps the rich nested app object in a `data` JSONB column, plus a
// few denormalized scalar columns for querying/sorting. The app always reads the
// full object back out of `data`, so objects round-trip byte-for-byte.
const propToRow = (p) => ({
  id: String(p.id), address: p.address || "", city: p.city || "", state: p.state || "", zip: p.zip || "", status: p.status || "", data: p,
});
const leadToRow = (l) => ({
  id: String(l.id), address: l.address || "", city: l.city || "", state: l.state || "", zip: l.zip || "", lead_status: l.leadStatus || "New Leads", data: l,
});
const contactToRow = (c) => ({ id: String(c.id), name: c.name || "", role: c.role || "", phone: c.phone || "", email: c.email || "", data: c });
const autoToRow = (a) => ({ id: String(a.id), trigger: a.trigger || "", data: a });
// Financial Section (admin-only): funders + draws are stored whole in `data`.
const idToRow = (x) => ({ id: String(x.id), data: x });

const rowData = (row, fallback) => (row && row.data ? row.data : fallback(row));

const mapProps = (data) => data.map((r) => rowData(r, (row) => ({ id: Number(row.id), address: row.address, city: row.city, state: row.state, zip: row.zip, status: row.status, financials: {}, propertyInfo: {}, tasks: [], contacts: [] })));
const mapLeads = (data) => data.map((r) => rowData(r, (row) => ({ id: Number(row.id), address: row.address, city: row.city, state: row.state, zip: row.zip, leadStatus: row.lead_status })));
const mapAutos = (data) => data.map((r) => rowData(r, (row) => ({ id: row.id, trigger: row.trigger, tasks: [] })));
const mapContacts = (data) => data.map((r) => rowData(r, (row) => ({ id: Number(row.id), name: row.name, role: row.role, phone: row.phone, email: row.email })));
const mapData = (data) => data.map((r) => (r && r.data ? r.data : r)).filter(Boolean);

// ── A Supabase-backed collection with safe, coalesced, in-order writes ────────
// - Edits update local state immediately, then a single debounced flush writes
//   only the changed rows (in order, never overlapping). Rapid edits collapse to
//   one write carrying the latest values → no out-of-order overwrite.
// - A realtime refresh never reverts a row with unsaved local edits ("dirty").
function useSyncedCollection(table, toRow, mapRows, reportError) {
  const [items, setItems] = useState([]);
  const ref = useRef([]);            // latest items (sync source of truth for flush)
  const synced = useRef(new Map());  // id -> JSON string of last-known DB state
  const dirty = useRef(new Set());   // ids with local changes not yet saved
  const timer = useRef(null);
  const flushing = useRef(false);
  const again = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current) { again.current = true; return; }
    flushing.current = true;
    try {
      const cur = ref.current;
      const curIds = new Set(cur.map((x) => String(x.id)));
      const changed = cur.filter((x) => JSON.stringify(x) !== synced.current.get(String(x.id)));
      const removed = [...synced.current.keys()].filter((id) => !curIds.has(id));

      for (const x of changed) {
        const id = String(x.id);
        const existed = synced.current.has(id);
        const row = toRow(x);
        let error;
        if (existed) { const { id: _omit, ...rest } = row; ({ error } = await supabase.from(table).update(rest).eq("id", id)); }
        else { ({ error } = await supabase.from(table).insert(row)); }
        if (error) reportError(table, existed ? "update" : "insert", error);
        else { synced.current.set(id, JSON.stringify(x)); dirty.current.delete(id); }
      }
      if (removed.length) {
        const { error } = await supabase.from(table).delete().in("id", removed);
        if (error) reportError(table, "delete", error);
        else removed.forEach((id) => { synced.current.delete(id); dirty.current.delete(id); });
      }
    } finally {
      flushing.current = false;
      if (again.current) { again.current = false; flush(); }
    }
  }, [table, toRow, reportError]);

  const schedule = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(flush, 500); }, [flush]);

  const set = useCallback((updater) => {
    setItems((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      ref.current = next;
      const nextIds = new Set(next.map((x) => String(x.id)));
      next.forEach((x) => { const id = String(x.id); if (JSON.stringify(x) !== synced.current.get(id)) dirty.current.add(id); });
      [...synced.current.keys()].forEach((id) => { if (!nextIds.has(id)) dirty.current.add(id); }); // pending deletes
      schedule();
      return next;
    });
  }, [schedule]);

  // Load from DB, but keep any locally-dirty (unsaved) rows so a refresh can't
  // revert an edit — or resurrect a locally-deleted row — before it's saved.
  const load = useCallback(async () => {
    const { data, error } = await supabase.from(table).select("*");
    if (error || !data) return;
    const rows = mapRows(data);
    const dbIds = new Set(rows.map((r) => String(r.id)));
    const merged = [];
    rows.forEach((r) => {
      const id = String(r.id);
      if (dirty.current.has(id)) {
        const local = ref.current.find((x) => String(x.id) === id);
        if (local) merged.push(local); // keep unsaved edit; if deleted locally (no local) → omit
      } else {
        merged.push(r);
        synced.current.set(id, JSON.stringify(r));
      }
    });
    ref.current.forEach((x) => { const id = String(x.id); if (!dbIds.has(id) && dirty.current.has(id)) merged.push(x); }); // locally-created, unsaved
    [...synced.current.keys()].forEach((id) => { if (!dbIds.has(id) && !dirty.current.has(id)) synced.current.delete(id); });
    ref.current = merged;
    setItems(merged);
  }, [table, mapRows]);

  const flushNow = useCallback(() => { clearTimeout(timer.current); return flush(); }, [flush]);

  return { items, set, load, flushNow };
}

export function DataProvider({ children }) {
  const { user, isAdmin, displayName } = useAuth();

  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);
  const seededRef = useRef(false);

  const reportError = useCallback((table, op, error) => {
    console.error(`[${table}] ${op} failed:`, error.message);
    setSaveError(`Couldn't save your change (${op} ${table}): ${error.message}`);
  }, []);

  const propsC = useSyncedCollection("properties", propToRow, mapProps, reportError);
  const leadsC = useSyncedCollection("leads", leadToRow, mapLeads, reportError);
  const autosC = useSyncedCollection("automations", autoToRow, mapAutos, reportError);
  const contactsC = useSyncedCollection("contacts", contactToRow, mapContacts, reportError);
  const fundersC = useSyncedCollection("funders", idToRow, mapData, reportError);
  const drawsC = useSyncedCollection("draws", idToRow, mapData, reportError);
  const officeC = useSyncedCollection("office_messages", idToRow, mapData, reportError);
  const officeTasksC = useSyncedCollection("office_tasks", idToRow, mapData, reportError);
  const bankC = useSyncedCollection("bank_accounts", idToRow, mapData, reportError);
  // Shared, admin-editable app configuration (e.g. status-change checklists).
  const settingsC = useSyncedCollection("app_settings", idToRow, mapData, reportError);

  const loadTeam = useCallback(async () => {
    const { data, error } = await supabase.from("users").select("*").order("name");
    if (!error && data) setTeam(data);
  }, []);

  // Admin-only: mute/unmute a teammate's notifications (RLS lets admins update any user row).
  const setUserMuted = useCallback(async (userId, muted) => {
    const { error } = await supabase.from("users").update({ notify_muted: muted }).eq("id", userId);
    if (error) return error;
    await loadTeam();
    return null;
  }, [loadTeam]);

  const seedIfEmpty = useCallback(async () => {
    if (!isAdmin || seededRef.current) return;
    seededRef.current = true;
    const { count, error } = await supabase.from("properties").select("id", { count: "exact", head: true });
    if (error || count !== 0) return;
    await supabase.from("properties").insert(INIT_PROPS.map(propToRow));
    await supabase.from("leads").insert(INIT_LEADS.map(leadToRow));
    await supabase.from("contacts").insert(DEFAULT_CONTACTS.map(contactToRow));
  }, [isAdmin]);

  // Key the load/subscribe effect on the stable user id (not the whole user object),
  // so background token refreshes and preference saves — which mint a new user object
  // reference with the same id — don't reload all data or flip loading (which would
  // briefly unmount the whole app).
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      await seedIfEmpty();
      await Promise.all([propsC.load(), leadsC.load(), contactsC.load(), autosC.load(), fundersC.load(), drawsC.load(), officeC.load(), officeTasksC.load(), bankC.load(), settingsC.load(), loadTeam()]);
      if (!cancelled) setLoading(false);
    })();

    const timers = {};
    const debounce = (key, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, 250); };

    const channel = supabase
      .channel("goldstone-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "properties" }, () => debounce("p", propsC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => debounce("l", leadsC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => debounce("c", contactsC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "automations" }, () => debounce("a", autosC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "funders" }, () => debounce("f", fundersC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "draws" }, () => debounce("d", drawsC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "office_messages" }, () => debounce("o", officeC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "office_tasks" }, () => debounce("ot", officeTasksC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "bank_accounts" }, () => debounce("b", bankC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => debounce("s", settingsC.load))
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => debounce("u", loadTeam))
      .subscribe();

    // Safety net: flush any pending edits when the tab is hidden or the page is
    // being unloaded/backgrounded (covers a PWA refresh or app switch).
    const flushAll = () => { propsC.flushNow(); leadsC.flushNow(); autosC.flushNow(); contactsC.flushNow(); fundersC.flushNow(); drawsC.flushNow(); officeC.flushNow(); officeTasksC.flushNow(); bankC.flushNow(); settingsC.flushNow(); };
    const onHide = () => { if (document.visibilityState === "hidden") flushAll(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushAll);

    return () => {
      cancelled = true;
      Object.values(timers).forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushAll);
      supabase.removeChannel(channel);
    };
  }, [userId, seedIfEmpty, propsC.load, leadsC.load, autosC.load, contactsC.load, fundersC.load, drawsC.load, officeC.load, officeTasksC.load, bankC.load, settingsC.load, propsC.flushNow, leadsC.flushNow, autosC.flushNow, contactsC.flushNow, fundersC.flushNow, drawsC.flushNow, officeC.flushNow, officeTasksC.flushNow, bankC.flushNow, settingsC.flushNow, loadTeam]);

  const teamMembers = Array.from(new Set([...team.map((u) => u.name || u.email).filter(Boolean), displayName].filter(Boolean)));

  const value = {
    loading,
    sharedProps: propsC.items,
    setSharedProps: propsC.set,
    flushProps: propsC.flushNow,
    leads: leadsC.items,
    setLeads: leadsC.set,
    contacts: contactsC.items,
    setContacts: contactsC.set,
    flushContacts: contactsC.flushNow,
    automations: autosC.items,
    setAutomations: autosC.set,
    funders: fundersC.items,
    setFunders: fundersC.set,
    flushFunders: fundersC.flushNow,
    draws: drawsC.items,
    setDraws: drawsC.set,
    flushDraws: drawsC.flushNow,
    officeMessages: officeC.items,
    setOfficeMessages: officeC.set,
    flushOffice: officeC.flushNow,
    officeTasks: officeTasksC.items,
    setOfficeTasks: officeTasksC.set,
    flushOfficeTasks: officeTasksC.flushNow,
    bankAccounts: bankC.items,
    setBankAccounts: bankC.set,
    flushBank: bankC.flushNow,
    appSettings: settingsC.items,
    setAppSettings: settingsC.set,
    flushAppSettings: settingsC.flushNow,
    team,
    teamMembers,
    setUserMuted,
    currentUser: displayName,
    saveError,
    clearSaveError: () => setSaveError(null),
  };

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
