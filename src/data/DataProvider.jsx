import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { INIT_PROPS, INIT_LEADS, DEFAULT_CONTACTS } from "../seed";

const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

// ── Row <-> app-object mapping ────────────────────────────────────────────────
// Each table keeps the rich nested app object in a `data` JSONB column, plus a
// few denormalized scalar columns for querying/sorting. The app always reads the
// full object back out of `data`, so objects round-trip byte-for-byte.
const propToRow = (p) => ({
  id: String(p.id),
  address: p.address || "",
  city: p.city || "",
  state: p.state || "",
  zip: p.zip || "",
  status: p.status || "",
  data: p,
});
const leadToRow = (l) => ({
  id: String(l.id),
  address: l.address || "",
  city: l.city || "",
  state: l.state || "",
  zip: l.zip || "",
  lead_status: l.leadStatus || "New Leads",
  data: l,
});
const contactToRow = (c) => ({ id: String(c.id), name: c.name || "", role: c.role || "", phone: c.phone || "", email: c.email || "", data: c });
const autoToRow = (a) => ({ id: String(a.id), trigger: a.trigger || "", data: a });

const rowData = (row, fallback) => (row && row.data ? row.data : fallback(row));

// Deep-ish equality for change detection (objects are built with stable key order).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function DataProvider({ children }) {
  const { user, isAdmin, displayName } = useAuth();

  const [properties, setProperties] = useState([]);
  const [leads, setLeadsState] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [automations, setAutomationsState] = useState([]);
  const [team, setTeam] = useState([]); // users rows
  const [loading, setLoading] = useState(true);

  const seededRef = useRef(false);

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadProperties = useCallback(async () => {
    const { data, error } = await supabase.from("properties").select("*");
    if (!error && data) setProperties(data.map((r) => rowData(r, (row) => ({ id: Number(row.id), address: row.address, city: row.city, state: row.state, zip: row.zip, status: row.status, financials: {}, propertyInfo: {}, tasks: [], contacts: [] }))));
    return { data, error };
  }, []);

  const loadLeads = useCallback(async () => {
    const { data, error } = await supabase.from("leads").select("*");
    if (!error && data) setLeadsState(data.map((r) => rowData(r, (row) => ({ id: Number(row.id), address: row.address, city: row.city, state: row.state, zip: row.zip, leadStatus: row.lead_status }))));
    return { data, error };
  }, []);

  const loadContacts = useCallback(async () => {
    const { data, error } = await supabase.from("contacts").select("*").order("id");
    if (!error && data) setContacts(data.map((r) => rowData(r, (row) => ({ id: Number(row.id), name: row.name, role: row.role, phone: row.phone, email: row.email }))));
  }, []);

  const loadAutomations = useCallback(async () => {
    const { data, error } = await supabase.from("automations").select("*");
    if (!error && data) setAutomationsState(data.map((r) => rowData(r, (row) => ({ id: row.id, trigger: row.trigger, tasks: [] }))));
  }, []);

  const loadTeam = useCallback(async () => {
    const { data, error } = await supabase.from("users").select("*").order("name");
    if (!error && data) setTeam(data);
  }, []);

  // ── One-time seed (admin only, only when properties table is empty) ──────────
  const seedIfEmpty = useCallback(async () => {
    if (!isAdmin || seededRef.current) return;
    seededRef.current = true;
    const { count } = await supabase.from("properties").select("id", { count: "exact", head: true });
    if (count && count > 0) return;
    await supabase.from("properties").upsert(INIT_PROPS.map(propToRow));
    await supabase.from("leads").upsert(INIT_LEADS.map(leadToRow));
    await supabase.from("contacts").upsert(DEFAULT_CONTACTS.map(contactToRow));
  }, [isAdmin]);

  // ── Initial load + realtime subscriptions ────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      await seedIfEmpty();
      await Promise.all([loadProperties(), loadLeads(), loadContacts(), loadAutomations(), loadTeam()]);
      if (!cancelled) setLoading(false);
    })();

    // Debounced reloads keep things simple and conflict-free: any remote change
    // reloads that table, so every client converges to the DB state.
    const timers = {};
    const debounce = (key, fn) => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(fn, 250);
    };

    const channel = supabase
      .channel("goldstone-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "properties" }, () => debounce("p", loadProperties))
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => debounce("l", loadLeads))
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => debounce("c", loadContacts))
      .on("postgres_changes", { event: "*", schema: "public", table: "automations" }, () => debounce("a", loadAutomations))
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => debounce("u", loadTeam))
      .subscribe();

    return () => {
      cancelled = true;
      Object.values(timers).forEach(clearTimeout);
      supabase.removeChannel(channel);
    };
  }, [user, seedIfEmpty, loadProperties, loadLeads, loadContacts, loadAutomations, loadTeam]);

  // ── Persistence helpers: diff prev→next, upsert changed, delete removed ──────
  const syncCollection = useCallback(async (prev, next, table, toRow) => {
    const prevById = new Map(prev.map((x) => [String(x.id), x]));
    const nextIds = new Set(next.map((x) => String(x.id)));

    const changed = next.filter((x) => {
      const before = prevById.get(String(x.id));
      return !before || !same(before, x);
    });
    const removedIds = prev.map((x) => String(x.id)).filter((id) => !nextIds.has(id));

    if (changed.length) {
      const { error } = await supabase.from(table).upsert(changed.map(toRow));
      if (error) console.error(`[${table}] upsert failed:`, error.message);
    }
    if (removedIds.length) {
      const { error } = await supabase.from(table).delete().in("id", removedIds);
      if (error) console.error(`[${table}] delete failed:`, error.message);
    }
  }, []);

  // ── Public setters that mirror the original localStorage-backed signatures ───
  const setSharedProps = useCallback(
    (updater) => {
      setProperties((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        syncCollection(prev, next, "properties", propToRow);
        return next;
      });
    },
    [syncCollection]
  );

  const setLeads = useCallback(
    (updater) => {
      setLeadsState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        syncCollection(prev, next, "leads", leadToRow);
        return next;
      });
    },
    [syncCollection]
  );

  const setAutomations = useCallback(
    (next) => {
      setAutomationsState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        syncCollection(prev, value, "automations", autoToRow);
        return value;
      });
    },
    [syncCollection]
  );

  // Team member display names for assignment dropdowns (always include myself).
  const teamMembers = Array.from(
    new Set([...team.map((u) => u.name || u.email).filter(Boolean), displayName].filter(Boolean))
  );

  const value = {
    loading,
    sharedProps: properties,
    setSharedProps,
    leads,
    setLeads,
    contacts,
    automations,
    setAutomations,
    team,
    teamMembers,
    currentUser: displayName,
  };

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
