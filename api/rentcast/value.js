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
  // Owner-tunable comp filters: radius in miles, sold-within window in months.
  const radius = Math.min(3, Math.max(0.3, num(req.query.radius) || 1));
  const months = Math.min(24, Math.max(3, Math.round(num(req.query.months)) || 12));
  const cacheKey = `v11r${radius}m${months}` + address.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 70);

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
      filters: { radius, months },
      value: { price: num(v.price), low: num(v.priceRangeLow), high: num(v.priceRangeHigh) },
      subject: p0 ? {
        sqft: num(p0.squareFootage), beds: num(p0.bedrooms), baths: num(p0.bathrooms),
        yearBuilt: num(p0.yearBuilt), lotSize: num(p0.lotSize), type: String(p0.propertyType || ""),
        lastSalePrice: num(p0.lastSalePrice), lastSaleDate: String(p0.lastSaleDate || "").slice(0, 10),
        pool: !!feats.pool, garage: !!feats.garage, fireplace: !!feats.fireplace,
        ...(feats.garageSpaces ? { garageSpaces: num(feats.garageSpaces) } : {}),
        // Record details for the Property Details card auto-fill.
        county: String(p0.county || ""), zoning: String(p0.zoning || ""),
        apn: String(p0.assessorID || ""),
        heating: String(feats.heatingType || (feats.heating ? "Yes" : "")),
        cooling: String(feats.coolingType || (feats.cooling ? "Yes" : "")),
        architecture: String(feats.architectureType || ""),
        ...(num(feats.floorCount) ? { floors: num(feats.floorCount) } : {}),
        owner: (p0.owner && Array.isArray(p0.owner.names) ? p0.owner.names.join(", ") : "").slice(0, 90),
      } : null,
      comps: [],
    };
    const listComps = soldOnly.slice(0, 15).map((c) => ({
      address: String(c.formattedAddress || "").split(",").slice(0, 1).join(""),
      full: String(c.formattedAddress || "").slice(0, 140),
      price: num(c.price),
      sqft: num(c.squareFootage), beds: num(c.bedrooms), baths: num(c.bathrooms),
      yearBuilt: num(c.yearBuilt),
      distance: Math.round(num(c.distance) * 100) / 100,
      daysOld: num(c.daysOld),
      date: String(c.removedDate || c.lastSeenDate || c.listedDate || "").slice(0, 10),
      correlation: Math.round(num(c.correlation) * 100) / 100,
    }));
    // ── Primary comp source: DEED RECORDS BY AREA (Elie's find) ──
    // /properties supports an area query by last-sale window, so we pull
    // every recorded sale near the subject directly — sold prices by
    // construction, instead of starting from listings and hoping the deed
    // matches. Listing comps then only contribute list prices for context
    // and very fresh MLS sales the records haven't caught up with yet.
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const hav = (la1, lo1, la2, lo2) => {
      const R = 3958.8, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
      const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    let recComps = [];
    // ── MLS-fresh signal: listings that RECENTLY WENT OFF-MARKET nearby.
    // A removed sale listing usually means the house just sold — weeks
    // before the county records the deed. These carry the final list price,
    // the removal date, and days-on-market. (/listings/sale, status=Inactive)
    let offMkt = [];
    const lat = num(p0 && p0.latitude), lon = num(p0 && p0.longitude);
    if (lat && lon) {
      try {
        const li = await rc(`/listings/sale?latitude=${lat}&longitude=${lon}&radius=${radius}&status=Inactive&limit=200${p0.propertyType ? `&propertyType=${encodeURIComponent(p0.propertyType)}` : ""}`);
        const sqft0i = num(p0 && p0.squareFootage);
        offMkt = (Array.isArray(li) ? li : [])
          .filter((l) => num(l.price) > 0 && l.removedDate && Date.now() - new Date(l.removedDate).getTime() < months * 30 * 86400000)
          .filter((l) => !sqft0i || (num(l.squareFootage) > 0 && num(l.squareFootage) > sqft0i * 0.55 && num(l.squareFootage) < sqft0i * 1.7))
          .map((l) => ({
            address: String(l.formattedAddress || "").split(",").slice(0, 1).join(""),
            full: String(l.formattedAddress || "").slice(0, 140),
            price: num(l.price), priceSrc: "list",
            sqft: num(l.squareFootage), beds: num(l.bedrooms), baths: num(l.bathrooms),
            yearBuilt: num(l.yearBuilt),
            distance: Math.round(hav(lat, lon, num(l.latitude), num(l.longitude)) * 100) / 100,
            daysOld: Math.max(0, Math.round((Date.now() - new Date(l.removedDate).getTime()) / 86400000)),
            date: String(l.removedDate).slice(0, 10),
            ...(num(l.daysOnMarket) ? { dom: num(l.daysOnMarket) } : {}),
            recNote: `off-market:${String(l.removedDate).slice(0, 10)}${num(l.daysOnMarket) ? `·${num(l.daysOnMarket)}dom` : ""}`,
          }))
          .sort((a, b) => a.daysOld - b.daysOld)
          .slice(0, 10);
      } catch { /* endpoint thin/unavailable → records + AVM comps still carry it */ }
      const area = async (r) => {
        const q = `/properties?latitude=${lat}&longitude=${lon}&radius=${r}&saleDateRange=${months * 30}&limit=350${p0.propertyType ? `&propertyType=${encodeURIComponent(p0.propertyType)}` : ""}`;
        const res = await rc(q);
        return Array.isArray(res) ? res : [];
      };
      let recs = [];
      try { recs = await area(radius); } catch { /* thin/absent → listing fallback below */ }
      const sqft0 = num(p0 && p0.squareFootage);
      const subjN = norm((p0 && p0.formattedAddress) || address);
      recComps = recs
        .filter((r) => num(r.lastSalePrice) > 0 && norm(r.formattedAddress) !== subjN)
        .filter((r) => !sqft0 || (num(r.squareFootage) > 0 && num(r.squareFootage) > sqft0 * 0.55 && num(r.squareFootage) < sqft0 * 1.7))
        .map((r) => {
          const d = hav(lat, lon, num(r.latitude), num(r.longitude));
          const daysOld = Math.max(0, Math.round((Date.now() - new Date(r.lastSaleDate).getTime()) / 86400000));
          return {
            address: String(r.formattedAddress || "").split(",").slice(0, 1).join(""),
            full: String(r.formattedAddress || "").slice(0, 140),
            price: num(r.lastSalePrice), priceSrc: "sold",
            sqft: num(r.squareFootage), beds: num(r.bedrooms), baths: num(r.bathrooms),
            yearBuilt: num(r.yearBuilt),
            distance: Math.round(d * 100) / 100,
            daysOld,
            date: String(r.lastSaleDate || "").slice(0, 10),
          };
        })
        .filter((c) => c.distance <= radius + 0.05 && c.daysOld <= months * 30 + 15)
        .sort((a, b) => (a.distance + a.daysOld / 900) - (b.distance + b.daysOld / 900))
        .slice(0, 12);
      // A record comp that was also a listing gains its LIST price for context.
      // BUT: a listing that ENDED well after the recorded sale means the house
      // traded again and the deed hasn't caught up — the record price is the
      // OLD transaction (often the flipper's own purchase). Showing it as the
      // sold price would poison the ARV; demote it to pending instead.
      const byAddr = {};
      listComps.forEach((c) => { byAddr[norm(c.full)] = c; });
      offMkt.forEach((c) => { byAddr[norm(c.full)] = c; }); // fresher than AVM comps
      recComps = recComps.map((c) => {
        const m = byAddr[norm(c.full)];
        if (!m) return c;
        if (m.date && c.date && new Date(m.date) - new Date(c.date) > 60 * 86400000) {
          return { ...m, priceSrc: "list", recNote: `record-outdated:${c.date}` };
        }
        return { ...c, listPrice: m.price, correlation: m.correlation };
      });
    }
    if (recComps.length >= 4) {
      // Deed records carry the comp sheet. Add the freshest MLS signals the
      // records haven't caught up with — recently off-market listings first
      // (they likely JUST sold), then any leftover AVM listing comps. All
      // marked pending; the owner can type the closing off Zillow.
      const recSet = new Set(recComps.map((c) => norm(c.full)));
      const seen = new Set();
      const pool = [...offMkt, ...listComps.map((c) => ({ ...c, priceSrc: "list", recNote: "not-in-records-yet" }))]
        .filter((c) => { const k = norm(c.full); if (recSet.has(k) || seen.has(k)) return false; seen.add(k); return true; })
        .filter((c) => (!c.distance || c.distance <= radius + 0.05) && (!c.daysOld || c.daysOld <= months * 30));
      out.comps = [...recComps, ...pool.slice(0, Math.max(0, Math.min(4, 15 - recComps.length)))];
    } else {
      // Area query unavailable/thin — fall back to listing comps enriched
      // one-by-one against their property records (throttled, 429 retries).
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
      // Confirmed-sale candidates lead; off-market pendings are capped extras
      // so they can never flood the sheet when deed records run thin.
      const seenF = new Set();
      out.comps = [...listComps, ...offMkt.slice(0, 4)].filter((c) => { const k = norm(c.full); if (seenF.has(k)) return false; seenF.add(k); return true; }).slice(0, 14);
      const lookupSold = async (c, i) => {
        if (String(c.recNote || "").startsWith("off-market:")) return; // already the freshest info we have
        try {
          const pr = await rcRetry(`/properties?address=${encodeURIComponent(c.full)}`);
          const rec = Array.isArray(pr) ? pr[0] : pr;
          if (!rec) { out.comps[i] = { ...c, priceSrc: "list", recNote: "no-record" }; return; }
          let sp = num(rec.lastSalePrice), sd = String(rec.lastSaleDate || "").slice(0, 10);
          Object.values(rec.history || {}).forEach((h) => {
            if (!h || !/^sale$/i.test(String(h.event || "").trim())) return;
            const hd = String(h.date || "").slice(0, 10);
            if (num(h.price) > 0 && hd > sd) { sp = num(h.price); sd = hd; }
          });
          if (!(sp > 0)) { out.comps[i] = { ...c, priceSrc: "list", recNote: "no-sale-on-record" }; return; }
          const near = !c.date || Math.abs(new Date(sd) - new Date(c.date)) < 400 * 86400000;
          if (near && new Date(sd) > new Date(Date.now() - 550 * 86400000)) {
            out.comps[i] = { ...c, listPrice: c.price, price: sp, date: sd, priceSrc: "sold" };
          } else out.comps[i] = { ...c, priceSrc: "list", recNote: `sale-on-file:${sd}` };
        } catch (e) { out.comps[i] = { ...c, priceSrc: "list", recNote: "err:" + String(e.message || "").slice(0, 40) }; }
      };
      for (let g = 0; g < out.comps.length; g += 4) {
        await Promise.allSettled(out.comps.slice(g, g + 4).map((c, j) => lookupSold(c, g + j)));
        if (g + 4 < out.comps.length) await sleep(400);
      }
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
