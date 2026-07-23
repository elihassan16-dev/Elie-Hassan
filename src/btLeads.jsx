// BoldTrail buyer leads — client store (same pattern as sms.jsx): loaded once,
// kept live via realtime, matched to properties by the propertyBoost
// "pb<address>" hashtag so each lead shows up under the right property.
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

let store = null;
const listeners = new Set();
let started = false, t = null;

async function load() {
  const { data, error } = await supabase.from("bt_leads").select("id,phone,data").order("updated_at", { ascending: false });
  if (!error) {
    store = (data || []).map((r) => ({ ...(r.data || {}), id: r.id, phone: (r.data || {}).phone || r.phone || "" }));
    listeners.forEach((fn) => { try { fn(); } catch { /* consumer gone */ } });
  }
}
const sched = () => { clearTimeout(t); t = setTimeout(load, 300); };

function start() {
  if (started) return;
  started = true;
  load();
  const ch = supabase.channel("bt-leads");
  ch.on("postgres_changes", { event: "*", schema: "public", table: "bt_leads" }, sched);
  ch.subscribe();
}

export function useBtLeads() {
  const [, force] = useState(0);
  useEffect(() => {
    start();
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return store || [];
}

// "pb7487GithensAven" ↔ "7487 Githens Ave" — normalize both sides and accept a
// prefix match either way (the hashtag truncates long street names; the app may
// abbreviate). Requires a house number plus a few street characters to match.
export const btMatchesProperty = (lead, p) => {
  // Normalize, then drop a directional right after the house number — BoldTrail
  // says "415 S 1st Ave" where the app says "415 1st Ave"; both become 4151stave.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    .replace(/^(\d+)(south|north|east|west|s|n|e|w)(?=\d)/, "$1");
  const tag = (lead.tags || []).map(String).find((x) => /^pb./i.test(x.trim()));
  if (!tag) return false;
  const a = norm(tag.trim().replace(/^pb/i, ""));
  const b = norm(p.address);
  if (!a || !b || Math.min(a.length, b.length) < 5) return false;
  return a.startsWith(b) || b.startsWith(a);
};
