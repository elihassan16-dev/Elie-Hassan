// 📍 Address type-ahead for "Add New Lead" (Elie 11/13/26). Signed-in team only.
//   GET ?q=<typed text>&session=<token>      → { source, items:[{id, main, secondary, full?}] }
//   GET ?place=<id>&session=<token>          → { address, city, state, zip, full }
// Google Places (New) with the same GOOGLE_MAPS_API_KEY as Street View (needs
// "Places API (New)" enabled on the key), biased to New Jersey — falls back to
// Photon (OpenStreetMap, free, no key) when Google isn't available, so the box
// always works. The key never reaches the browser.
import { requireAppUser, isTeamUser } from "../../lib/showings.js";

// New Jersey (+ a little of PA / NY around it) — Elie's market comes first.
const NJ = { low: { latitude: 38.9, longitude: -75.6 }, high: { latitude: 41.36, longitude: -73.88 } };
const STATES = { "new jersey": "NJ", "new york": "NY", pennsylvania: "PA", delaware: "DE", maryland: "MD", connecticut: "CT" };
const stateAbbr = (s) => (String(s || "").length === 2 ? String(s).toUpperCase() : STATES[String(s || "").toLowerCase()] || s || "");

async function google(q, session, key) {
  const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input: q, sessionToken: session || undefined, includedRegionCodes: ["us"], locationBias: { rectangle: NJ } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Google ${r.status}`);
  return (j.suggestions || []).map((s) => s.placePrediction).filter(Boolean).slice(0, 6).map((p) => ({
    id: `g:${p.placeId}`,
    main: (p.structuredFormat && p.structuredFormat.mainText && p.structuredFormat.mainText.text) || (p.text && p.text.text) || "",
    secondary: ((p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || "").replace(/, USA$/, ""),
  }));
}

async function googlePlace(id, session, key) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}${session ? `?sessionToken=${encodeURIComponent(session)}` : ""}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "addressComponents,formattedAddress" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Google ${r.status}`);
  const get = (type, short) => { const c = (j.addressComponents || []).find((x) => (x.types || []).includes(type)); return c ? (short ? c.shortText : c.longText) || "" : ""; };
  const street = [get("street_number"), get("route", true)].filter(Boolean).join(" ");
  const unit = get("subpremise");
  return {
    address: street ? `${street}${unit ? ` #${unit}` : ""}` : String(j.formattedAddress || "").split(",")[0],
    city: get("locality") || get("sublocality") || get("postal_town") || get("administrative_area_level_3") || get("neighborhood"),
    state: get("administrative_area_level_1", true) || "NJ",
    zip: get("postal_code"),
  };
}

// Photon (komoot) — OpenStreetMap search made for type-ahead, biased to central NJ.
async function photon(q) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&lat=40.1&lon=-74.6&location_bias_scale=0.5`, { headers: { "User-Agent": "GoldstoneApp/1.0" } });
  if (!r.ok) throw new Error(`Photon ${r.status}`);
  const j = await r.json();
  const seen = new Set();
  return (j.features || []).map((f) => f.properties || {}).filter((p) => p.countrycode === "US" && (p.housenumber || p.street || p.type === "street"))
    .map((p) => {
      const address = [p.housenumber, p.street || (p.type === "street" ? p.name : "")].filter(Boolean).join(" ");
      const city = p.city || p.town || p.village || p.district || p.county || "";
      const state = stateAbbr(p.state);
      return { address, city, state, zip: p.postcode || "" };
    })
    .filter((x) => x.address && !seen.has(`${x.address}|${x.city}`) && seen.add(`${x.address}|${x.city}`))
    .sort((a, b) => (b.state === "NJ") - (a.state === "NJ"))
    .slice(0, 6)
    .map((x) => ({ id: `o:${x.address}`, main: x.address, secondary: [x.city, [x.state, x.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), place: x }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const user = await requireAppUser(req);
  if (!user || !(await isTeamUser(user.id))) { res.status(401).json({ error: "Sign in first." }); return; }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const session = String(req.query.session || "").slice(0, 64);
  try {
    if (req.query.place) {
      const id = String(req.query.place);
      if (!id.startsWith("g:") || !key) { res.status(400).json({ error: "Unknown place." }); return; }
      const p = await googlePlace(id.slice(2), session, key);
      res.json({ ...p, full: [p.address, p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") });
      return;
    }
    const q = String(req.query.q || "").trim().slice(0, 120);
    if (q.length < 3) { res.json({ items: [] }); return; }
    let googleErr = "";
    if (key) {
      try { res.json({ source: "google", items: await google(q, session, key) }); return; }
      catch (e) { googleErr = e.message; }
    }
    const items = await photon(q);
    res.json({ source: "osm", items, ...(googleErr ? { note: `Google suggestions are off (${googleErr.slice(0, 160)}) — using OpenStreetMap.` } : {}) });
  } catch (e) {
    res.status(502).json({ error: e.message || "Address lookup failed." });
  }
}
