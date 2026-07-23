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
// Street-type words don't decide a match — BoldTrail says "33 Morris Street"
// where the app says "33 Morris Ave", "Falmouth Road" vs "Falmouth Rd", etc.
// The comparable core is house number + street NAME, suffix and anything after
// it (city…) dropped.
const STREET_SUFFIX=/^(\d+[a-z0-9]{2,}?)(street|avenue|boulevard|boul|road|lane|drive|court|place|terrace|circle|highway|parkway|ave|av|st|rd|blvd|ln|dr|ct|pl|ter|cir|hwy|pkwy|way)/;
export const btMatchesProperty = (lead, p) => {
  // Normalize, drop a directional right after the house number ("415 S 1st Ave"
  // ↔ "415 1st Ave"), then reduce to number + street name.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    .replace(/^(\d+)(south|north|east|west|s|n|e|w)(?=\d)/, "$1");
  const core = (x) => { const m = x.match(STREET_SUFFIX); return m ? m[1] : x; };
  const tag = (lead.tags || []).map(String).find((x) => /^pb./i.test(x.trim()));
  if (!tag) return false;
  const a = core(norm(tag.trim().replace(/^pb/i, "")));
  const b = core(norm(p.address));
  if (!a || !b || Math.min(a.length, b.length) < 5) return false;
  return a.startsWith(b) || b.startsWith(a);
};
