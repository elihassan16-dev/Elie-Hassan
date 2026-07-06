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

// Build the parcels query URL for a point (optionally buffered by `distance` m).
// Uses the JSON geometry object form — the simple "x,y" comma form is rejected by
// some hosted feature services with "Invalid or missing input parameters".
function parcelQueryUrl(base, lon, lat, distance) {
  const q = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  if (distance) { q.set("distance", String(distance)); q.set("units", "esriSRUnit_Meter"); }
  return `${layerQuery(base)}?${q.toString()}`;
}

// The resolved service URL may be a service root (…/FeatureServer, …/MapServer) or
// already a specific layer (…/MapServer/0). The query op lives at <layer>/query, so
// only append /0 when the URL isn't already a layer.
function layerQuery(base) {
  return /\/\d+$/.test(base) ? `${base}/query` : `${base}/0/query`;
}

// Query NJ parcels layer 0 at a point (optionally within `distance` metres).
// Surfaces ArcGIS error objects (returned with HTTP 200) instead of masking them.
async function queryParcel(base, lon, lat, distance) {
  const r = await fetch(parcelQueryUrl(base, lon, lat, distance));
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

  // ?debug=1 dumps every internal step (geocode result, resolved service URL, the
  // exact query URL, and the raw ArcGIS response) so a failing lookup can be traced
  // by opening the URL in a browser. Read-only, public data — safe to expose.
  const debug = req.query?.debug != null;

  try {
    const geo = await geocode(address);
    if (!geo) { res.status(200).json({ found: false, reason: "Address couldn't be geocoded. Check the street/city/zip." }); return; }

    const base = await njServiceUrl();

    if (debug) {
      const exactUrl = parcelQueryUrl(base, geo.lon, geo.lat, 0);
      const bufferUrl = parcelQueryUrl(base, geo.lon, geo.lat, 60);
      let exactRaw = null, bufferRaw = null;
      try { exactRaw = await (await fetch(exactUrl)).json(); } catch (e) { exactRaw = { fetchError: e.message }; }
      try { bufferRaw = await (await fetch(bufferUrl)).json(); } catch (e) { bufferRaw = { fetchError: e.message }; }
      // Pull the matched feature's attributes to the top so field names + values are
      // easy to read (this is what we map into the property).
      const attrs = exactRaw?.features?.[0]?.attributes || bufferRaw?.features?.[0]?.attributes || null;
      res.status(200).json({ debug: true, address, geo, base, attributes: attrs, fieldNames: attrs ? Object.keys(attrs) : null, exactUrl, bufferUrl, exactRaw, bufferRaw });
      return;
    }

    // The Census geocoder interpolates a point that can land in a NEIGHBOR's parcel
    // (it put "28 Messenger" inside the "24 Messenger" lot). So gather the containing
    // parcel plus nearby parcels within a buffer, then pick the one whose assessment
    // address actually matches the input — the point-in-polygon hit alone is unreliable.
    const streetNum = (address.match(/\d+/) || [])[0] || "";
    const streetName = ((address.match(/\d+\s+([A-Za-z][A-Za-z.]*)/) || [])[1] || "").toUpperCase();
    const addrMatch = (f) => {
      if (!streetNum) return false;
      const loc = String(pick(f.attributes, ["PROP_LOC", "PROPLOC", "PROP_ADDR", "ADDRESS"]) || "").toUpperCase().trim();
      const numOk = loc.startsWith(streetNum + " ") || loc.startsWith(streetNum + "-");
      const nameOk = !streetName || loc.includes(streetName);
      return numOk && nameOk;
    };

    const near = await queryParcel(base, geo.lon, geo.lat, 60);
    let feat = near.find(addrMatch) || null;
    if (!feat) {
      // No address match nearby — fall back to the parcel that contains the point.
      const exact = await queryParcel(base, geo.lon, geo.lat, 0);
      feat = exact[0] || near[0] || null;
    }
    if (!feat) { res.status(200).json({ found: false, reason: `No NJ parcel found near ${geo.matched || address}.`, matched: geo.matched }); return; }
    const a = feat.attributes || {};

    const block = pick(a, ["PCLBLOCK", "BLOCK", "MOD4_BLOCK", "BLK"]);
    const lot = pick(a, ["PCLLOT", "LOT", "MOD4_LOT"]);
    const qual = pick(a, ["PCLQCODE", "QUAL", "QUALIFIER", "PCL_QCODE"]);
    const blockLot = block || lot
      ? `Block ${block ?? "?"}, Lot ${lot ?? "?"}${qual ? ` (Qual ${qual})` : ""}`
      : null;

    const netVal = num(pick(a, ["NET_VALUE", "NETVALUE", "TOTAL_VALUE", "ASSESSED_VALUE"]));
    // MOD-IV usually carries the last-billed tax; if not present here we fall back
    // to assessed value × the municipal general tax rate (per $100) when that field exists.
    const taxRate = num(pick(a, ["GEN_TAX_RATE", "TAX_RATE", "GENERAL_TAX_RATE", "GTR"]));
    let annualTax = num(pick(a, ["LAST_YR_TX", "LST_YR_TAX", "LAST_YEAR_TAX", "TAX_AMT", "TAXES", "CALC_TAXES", "LAST_TAX", "TAX_AMOUNT", "TAX_AMT_1", "TAXES_1", "PRYRTAX", "TAXAMT"]));
    if (annualTax == null && netVal != null && taxRate != null) annualTax = Math.round(netVal * taxRate / 100);

    // No dedicated sqft field on this layer — the living area is the trailing number
    // in BLDG_DESC (e.g. "2F1G       1776" → 1776).
    const bldgDesc = String(pick(a, ["BLDG_DESC", "BLDG_DESCRIPTION", "BUILD_DESC"]) || "");
    let sqft = num(pick(a, ["SQ_FT", "SQFT", "BLD_SF", "LIV_SF", "BUILDING_SF", "FINISHED_SF"]));
    if (sqft == null) { const mm = bldgDesc.match(/(\d{3,6})\s*$/); if (mm) sqft = parseInt(mm[1], 10); }

    const pamsPin = pick(a, ["PAMS_PIN", "PAMSPIN", "GIS_PIN", "PIN", "PIN_NODUP"]) ?? null;
    // NJParcels.com per-parcel page: /property/{CCMM municipality code}/{block}/{lot}.
    // The municipality code is the leading 4 digits of the PAMS PIN (CC county + MM muni).
    const munCode = (String(pamsPin || "").match(/(\d{4})/) || [])[1] || null;
    const sourceUrl = (munCode && block && lot)
      ? `https://njparcels.com/property/${munCode}/${encodeURIComponent(String(block).trim())}/${encodeURIComponent(String(lot).trim())}`
      : `https://njparcels.com/search/?q=${encodeURIComponent(geo.matched || address)}`;

    res.status(200).json({
      found: true,
      source: "NJ Parcels + MOD-IV (NJ Office of GIS)",
      sourceUrl,
      matched: geo.matched,
      block: block ?? null,
      lot: lot ?? null,
      qualifier: qual ?? null,
      blockLot,
      pamsPin,
      propClass: pick(a, ["PROP_CLASS", "PROPERTY_CLASS", "PROP_CLS", "CLASS"]) ?? null,
      propAddress: pick(a, ["PROP_LOC", "PROPLOC", "PROP_ADDR", "ADDRESS"]) ?? null,
      municipality: pick(a, ["MUN_NAME", "MUNICIPALITY", "MUN", "PCL_MUN"]) ?? null,
      county: pick(a, ["COUNTY", "COUNTY_NAME"]) ?? null,
      yearBuilt: num(pick(a, ["YR_CONSTR", "YEAR_BUILT", "YRBUILT", "BUILT_YR", "YR_BUILT"])),
      sqft,
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
