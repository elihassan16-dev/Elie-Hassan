// Free New Jersey property lookup — no API key required.
//
// Flow: geocode the address with the US Census geocoder (free, no key) to get a
// point, then run a point-in-polygon query against NJ's statewide "Parcels and
// MOD-IV Composite" ArcGIS layer (NJ Office of GIS, public). Returns the parcel's
// block & lot, assessed values, year built, lot size, last sale and — when the
// MOD-IV roll carries it — the annual tax. Beds/baths are not in NJ assessment
// data, so those are never returned (the client leaves them for manual entry).
//
// Everything here hits only free public endpoints; there is no secret to protect,
// so this runs unauthenticated. It's read-only and rate-limited by the upstreams.

// Stable ArcGIS item id for "Parcels and MOD-IV Composite of NJ, Web Mercator
// (3857)". We resolve the live FeatureServer URL from the item (robust to the
// hosted service being moved/renamed) and cache it for the lambda's lifetime.
const NJ_PARCELS_ITEM = "852937c223e94fcf8e167a23b500935d";
let cachedServiceUrl = null;

async function njServiceUrl() {
  if (cachedServiceUrl) return cachedServiceUrl;
  const r = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${NJ_PARCELS_ITEM}?f=json`);
  if (!r.ok) throw new Error(`ArcGIS item lookup failed (${r.status})`);
  const j = await r.json();
  if (!j.url) throw new Error("NJ parcels service URL not found on ArcGIS item.");
  cachedServiceUrl = j.url; // e.g. https://services9.arcgis.com/.../FeatureServer
  return cachedServiceUrl;
}

// Case-insensitive "first present, non-empty attribute" picker — the MOD-IV
// composite field set varies slightly between refreshes, so we try aliases.
function pick(attrs, names) {
  const lower = {};
  for (const k of Object.keys(attrs || {})) lower[k.toLowerCase()] = attrs[k];
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "0") return v;
  }
  // second pass allows 0 (valid for some numerics)
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
const num = (v) => { if (v == null) return null; const x = parseFloat(String(v).replace(/[^\d.-]/g, "")); return isNaN(x) ? null : x; };

// Query NJ parcels layer 0 at a point (optionally within `distance` metres).
// Surfaces ArcGIS error objects (returned with HTTP 200) instead of masking them.
async function queryParcel(base, lon, lat, distance) {
  const q = new URLSearchParams({
    where: "1=1",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  if (distance) { q.set("distance", String(distance)); q.set("units", "esriSRUnit_Meter"); }
  const r = await fetch(`${base}/0/query?${q.toString()}`);
  if (!r.ok) throw new Error(`NJ parcels query failed (${r.status})`);
  const j = await r.json();
  if (j.error) throw new Error(`NJ parcels query error: ${j.error.message || JSON.stringify(j.error)}`);
  return j.features || [];
}

async function geocode(address) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Census geocoder failed (${r.status})`);
  const j = await r.json();
  const m = j?.result?.addressMatches?.[0];
  if (!m || !m.coordinates) return null;
  return { lon: m.coordinates.x, lat: m.coordinates.y, matched: m.matchedAddress || "" };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const address = (req.query?.address || "").toString().trim();
  if (!address) { res.status(400).json({ error: "Pass ?address=" }); return; }

  try {
    const geo = await geocode(address);
    if (!geo) { res.status(200).json({ found: false, reason: "Address couldn't be geocoded. Check the street/city/zip." }); return; }

    const base = await njServiceUrl();
    // The Census geocoder interpolates a point along the STREET centerline, which
    // often lands just outside the parcel polygon (parcels don't include the road).
    // So: try an exact point-in-parcel hit first, then fall back to a buffered
    // search and disambiguate by leading street number.
    let feats = await queryParcel(base, geo.lon, geo.lat, 0);
    if (!feats.length) feats = await queryParcel(base, geo.lon, geo.lat, 60);
    if (!feats.length) { res.status(200).json({ found: false, reason: `No NJ parcel found near ${geo.matched || address}.`, matched: geo.matched }); return; }

    const streetNum = (address.match(/\d+/) || [])[0] || "";
    let feat = feats[0];
    if (feats.length > 1 && streetNum) {
      const m = feats.find((f) => {
        const loc = String(pick(f.attributes, ["PROP_LOC", "PROPLOC", "PROP_ADDR", "ADDRESS"]) || "").trim();
        return loc.startsWith(streetNum + " ") || loc.startsWith(streetNum + "-");
      });
      if (m) feat = m;
    }
    const a = feat.attributes || {};

    const block = pick(a, ["PCLBLOCK", "BLOCK", "MOD4_BLOCK", "BLK"]);
    const lot = pick(a, ["PCLLOT", "LOT", "MOD4_LOT"]);
    const qual = pick(a, ["PCLQCODE", "QUAL", "QUALIFIER", "PCL_QCODE"]);
    const blockLot = block || lot
      ? `Block ${block ?? "?"}, Lot ${lot ?? "?"}${qual ? ` (Qual ${qual})` : ""}`
      : null;

    const netVal = num(pick(a, ["NET_VALUE", "NETVALUE", "TOTAL_VALUE", "ASSESSED_VALUE"]));
    const annualTax = num(pick(a, ["LST_YR_TAX", "LAST_YEAR_TAX", "TAX_AMT", "TAXES", "CALC_TAXES", "LAST_TAX", "TAX_AMOUNT"]));

    res.status(200).json({
      found: true,
      source: "NJ Parcels + MOD-IV (NJ Office of GIS)",
      matched: geo.matched,
      block: block ?? null,
      lot: lot ?? null,
      qualifier: qual ?? null,
      blockLot,
      pamsPin: pick(a, ["PAMS_PIN", "PAMSPIN", "GIS_PIN", "PIN"]) ?? null,
      propClass: pick(a, ["PROP_CLASS", "PROPERTY_CLASS", "PROP_CLS", "CLASS"]) ?? null,
      propAddress: pick(a, ["PROP_LOC", "PROPLOC", "PROP_ADDR", "ADDRESS"]) ?? null,
      municipality: pick(a, ["MUN_NAME", "MUNICIPALITY", "MUN", "PCL_MUN"]) ?? null,
      county: pick(a, ["COUNTY", "COUNTY_NAME"]) ?? null,
      yearBuilt: num(pick(a, ["YR_CONSTR", "YEAR_BUILT", "YRBUILT", "BUILT_YR", "YR_BUILT"])),
      sqft: num(pick(a, ["SQ_FT", "SQFT", "BLD_SF", "LIV_SF", "BUILDING_SF", "FINISHED_SF"])),
      lotAcres: num(pick(a, ["CALC_ACRE", "ACREAGE", "ACRES", "CALC_ACRES"])),
      landValue: num(pick(a, ["LAND_VAL", "LANDVALUE", "LAND_VALUE"])),
      improvementValue: num(pick(a, ["IMPRVT_VAL", "IMPROVEMENT_VALUE", "IMP_VALUE", "BLDG_VAL"])),
      assessedValue: netVal,
      annualTax,
      lastSalePrice: num(pick(a, ["SALE_PRICE", "LST_SALE_PR", "SR_NU", "LAST_SALE_PRICE", "SALEPRICE"])),
      lastSaleDate: pick(a, ["SALE_DATE", "DEED_DATE", "LST_SALE_DT", "LAST_SALE_DATE"]) ?? null,
      buildingDesc: pick(a, ["BUILD_DESC", "BLDG_DESC", "BLDG_DESCRIPTION", "BUILDING_DESC"]) ?? null,
    });
  } catch (e) {
    console.error("[property/lookup] failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
