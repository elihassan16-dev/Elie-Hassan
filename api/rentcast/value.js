// RentCast proxy for the AI Underwriter: sale-value estimate + sold comps +
// the subject property's record, for one address. Server-side so the API key
// stays in Vercel; results cached in app_settings (30 days, ~60 addresses)
// so re-opening a deal never burns a lookup from the plan's quota.
// GET ?address=...  (auth'd app users only; contractor accounts blocked)
import { createClient } from "@supabase/supabase-js";
import { requireAppUser } from "../../lib/quickbooks.js";
import { profileOf } from "../../lib/jivetel.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const num = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  const KEY = process.env.RENTCAST_API_KEY;
  if (!KEY) { res.status(503).json({ error: "Waiting for the RentCast key — add RENTCAST_API_KEY in Vercel (Production + Preview)." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const prof = await profileOf(user.id);
    if (prof?.role === "contractor") { res.status(403).json({ error: "Not available on contractor accounts." }); return; }
  } catch { /* profile row missing → treat as team */ }

  const address = String(req.query.address || "").trim();
  if (address.length < 8) { res.status(400).json({ error: "Send a full street address." }); return; }
  const cacheKey = "v4" + address.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 78); // v4: throttled deed lookups + sale history

  const db = SERVICE ? createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } }) : null;
  const fresh = (at) => at && Date.now() - new Date(at).getTime() < 30 * 86400000;
  let cacheRow = null;
  if (db && !req.query.force) {
    try {
      cacheRow = (await db.from("app_settings").select("data").eq("id", "rentcast_cache").maybeSingle()).data;
      const hit = cacheRow && cacheRow.data && cacheRow.data.items && cacheRow.data.items[cacheKey];
      if (hit && fresh(hit.at)) { res.status(200).json({ ...hit, cached: true }); return; }
    } catch { /* cache unreadable → live lookup */ }
  }

  const rc = async (path) => {
    const r = await fetch(`https://api.rentcast.io/v1${path}`, { headers: { "X-Api-Key": KEY, Accept: "application/json" } });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error((body && (body.message || body.error)) || `RentCast ${r.status}`);
    return body;
  };

  try {
    const enc = encodeURIComponent(address);
    const [valR, propR] = await Promise.allSettled([
      rc(`/avm/value?address=${enc}&compCount=25`),
      rc(`/properties?address=${enc}`),
    ]);
    if (valR.status === "rejected") throw new Error(valR.reason?.message || "Value lookup failed.");
    const v = valR.value || {};
    const p0 = propR.status === "fulfilled" && Array.isArray(propR.value) ? propR.value[0] : (propR.status === "fulfilled" ? propR.value : null);
    const feats = (p0 && p0.features) || {};
    // SOLD comps only (Elie's rule): an active listing is an asking price,
    // not a proven sale — drop them before anything downstream sees them.
    const soldOnly = (Array.isArray(v.comparables) ? v.comparables : []).filter((c) => String(c.status || "").toLowerCase() !== "active" && (c.removedDate || c.lastSeenDate));
    const out = {
      at: new Date().toISOString(),
      value: { price: num(v.price), low: num(v.priceRangeLow), high: num(v.priceRangeHigh) },
      subject: p0 ? {
        sqft: num(p0.squareFootage), beds: num(p0.bedrooms), baths: num(p0.bathrooms),
        yearBuilt: num(p0.yearBuilt), lotSize: num(p0.lotSize), type: String(p0.propertyType || ""),
        lastSalePrice: num(p0.lastSalePrice), lastSaleDate: String(p0.lastSaleDate || "").slice(0, 10),
        pool: !!feats.pool, garage: !!feats.garage, fireplace: !!feats.fireplace,
        ...(feats.garageSpaces ? { garageSpaces: num(feats.garageSpaces) } : {}),
      } : null,
      comps: soldOnly.slice(0, 12).map((c) => ({
        address: String(c.formattedAddress || "").split(",").slice(0, 1).join(""),
        full: String(c.formattedAddress || "").slice(0, 140),
        price: num(c.price),
        sqft: num(c.squareFootage), beds: num(c.bedrooms), baths: num(c.bathrooms),
        yearBuilt: num(c.yearBuilt),
        distance: Math.round(num(c.distance) * 100) / 100,
        daysOld: num(c.daysOld),
        date: String(c.removedDate || c.lastSeenDate || c.listedDate || "").slice(0, 10),
        correlation: Math.round(num(c.correlation) * 100) / 100,
      })),
    };
    // The comp feed's "price" is the final LIST price. The deed-recorded
    // closing price lives on each comp's property record — look each one up
    // and swap it in when the recorded sale matches this listing's era, so
    // a 540-listed / 580-sold comp counts as 580 (Elie's rule).
    // Throttled in small batches with 429 retries: a 12-wide burst tripped
    // RentCast's rate limit and silently left most comps as "pending".
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rcRetry = async (path) => {
      for (let a = 0; ; a++) {
        try { return await rc(path); }
        catch (e) {
          const msg = String(e.message || "");
          if (a < 2 && (/429|rate|too many/i.test(msg))) { await sleep(700 * (a + 1)); continue; }
          throw e;
        }
      }
    };
    const lookupSold = async (c, i) => {
      try {
        const pr = await rcRetry(`/properties?address=${encodeURIComponent(c.full)}`);
        const rec = Array.isArray(pr) ? pr[0] : pr;
        // Best recorded sale: the record's lastSale, or the newest Sale event
        // in its history — whichever is most recent.
        let sp = num(rec && rec.lastSalePrice), sd = String((rec && rec.lastSaleDate) || "").slice(0, 10);
        Object.values((rec && rec.history) || {}).forEach((h) => {
          if (!h || !/sale/i.test(String(h.event || ""))) return;
          const hd = String(h.date || "").slice(0, 10);
          if (num(h.price) > 0 && hd > sd) { sp = num(h.price); sd = hd; }
        });
        const near = sd && (!c.date || Math.abs(new Date(sd) - new Date(c.date)) < 400 * 86400000);
        if (sp > 0 && near && new Date(sd) > new Date(Date.now() - 550 * 86400000)) {
          out.comps[i] = { ...c, listPrice: c.price, price: sp, date: sd, priceSrc: "sold" };
        } else out.comps[i] = { ...c, priceSrc: "list" };
      } catch { out.comps[i] = { ...c, priceSrc: "list" }; }
    };
    for (let g = 0; g < out.comps.length; g += 4) {
      await Promise.allSettled(out.comps.slice(g, g + 4).map((c, j) => lookupSold(c, g + j)));
      if (g + 4 < out.comps.length) await sleep(400);
    }
    if (db) {
      try {
        const items = (cacheRow && cacheRow.data && cacheRow.data.items) || {};
        items[cacheKey] = out;
        // Keep the freshest ~60 addresses so the row stays small.
        const keep = Object.entries(items).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 60);
        await db.from("app_settings").upsert({ id: "rentcast_cache", data: { items: Object.fromEntries(keep) }, updated_at: new Date().toISOString() });
      } catch { /* cache write is best-effort */ }
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: e.message || "RentCast lookup failed." });
  }
}
