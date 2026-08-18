// ChatARV connector — MLS-fresh sold comps for the AI Underwriter.
// Their API docs live behind the dashboard, so this connector SELF-DISCOVERS:
// it tries the conventional endpoint layouts and auth styles until one
// answers, remembers the working combination (app_settings chatarv_cfg), and
// maps whatever field names come back into the app's comp shape. Successful
// results cache 30 days per address (chatarv_cache) so re-opens never burn a
// comp report from the plan.
// GET ?address=...[&force=1]  |  GET ?status=1 → discovery state, no report spent
import { createClient } from "@supabase/supabase-js";
import { requireAppUser } from "../../lib/quickbooks.js";
import { profileOf } from "../../lib/jivetel.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[$,]/g, "")); return isNaN(x) ? 0 : x; };
const pick = (o, keys) => { for (const k of keys) { const v = o && o[k]; if (v !== undefined && v !== null && v !== "") return v; } return undefined; };

// Find the comp array wherever they put it.
function findComps(raw, depth = 0) {
  if (!raw || depth > 3) return null;
  if (Array.isArray(raw)) return raw.length && typeof raw[0] === "object" ? raw : null;
  if (typeof raw !== "object") return null;
  for (const k of ["comps", "comparables", "properties", "results", "matches", "topComps"]) {
    const v = raw[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
  }
  for (const k of Object.keys(raw)) {
    const hit = findComps(raw[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function mapComp(c) {
  const addrRaw = String(pick(c, ["formattedAddress", "fullAddress", "address", "streetAddress", "addr"]) || "");
  const price = num(pick(c, ["soldPrice", "salePrice", "closePrice", "lastSalePrice", "price", "soldFor", "amount"]));
  const date = String(pick(c, ["soldDate", "saleDate", "closeDate", "lastSaleDate", "dateSold", "date"]) || "").slice(0, 10);
  const sqft = num(pick(c, ["squareFootage", "sqft", "livingArea", "buildingSize", "area"]));
  const daysOld = date ? Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 86400000)) : num(pick(c, ["daysOld", "daysAgo"]));
  return {
    address: addrRaw.split(",").slice(0, 1).join(""),
    full: addrRaw.slice(0, 140),
    price,
    priceSrc: "sold", // ChatARV comps are MLS closed sales
    sqft,
    beds: num(pick(c, ["bedrooms", "beds", "br"])),
    baths: num(pick(c, ["bathrooms", "baths", "ba"])),
    yearBuilt: num(pick(c, ["yearBuilt", "year"])),
    distance: Math.round(num(pick(c, ["distance", "distanceMiles", "dist", "milesAway"])) * 100) / 100,
    daysOld,
    date,
    ...(num(pick(c, ["listPrice", "listedPrice", "askingPrice"])) ? { listPrice: num(pick(c, ["listPrice", "listedPrice", "askingPrice"])) } : {}),
  };
}

function findArv(raw, depth = 0) {
  if (!raw || typeof raw !== "object" || depth > 3) return 0;
  const direct = num(pick(raw, ["arv", "estimatedArv", "afterRepairValue", "estimatedValue", "suggestedArv"]));
  if (direct) return direct;
  for (const k of Object.keys(raw)) {
    if (Array.isArray(raw[k])) continue;
    const v = findArv(raw[k], depth + 1);
    if (v) return v;
  }
  return 0;
}

const BASES = ["https://api.chatarv.ai", "https://www.chatarv.ai/api", "https://app.chatarv.ai/api"];
const ROUTES = [
  { m: "POST", p: "/v1/comps" }, { m: "POST", p: "/comps" },
  { m: "GET", p: "/v1/comps" }, { m: "GET", p: "/comps" },
  { m: "POST", p: "/v1/reports" }, { m: "POST", p: "/v1/comp-report" },
];
const AUTHS = [(k) => ({ Authorization: `Bearer ${k}` }), (k) => ({ "x-api-key": k })];

async function tryCall(base, route, auth, key, address) {
  const url = base + route.p + (route.m === "GET" ? `?address=${encodeURIComponent(address)}` : "");
  const r = await fetch(url, {
    method: route.m,
    headers: { Accept: "application/json", ...(route.m === "POST" ? { "Content-Type": "application/json" } : {}), ...auth(key) },
    ...(route.m === "POST" ? { body: JSON.stringify({ address }) } : {}),
  });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* HTML/other */ }
  return { status: r.status, body, url, method: route.m };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  const KEY = process.env.CHATARV_API_KEY;
  if (!KEY) { res.status(503).json({ error: "Waiting for the ChatARV key — add CHATARV_API_KEY in Vercel (Production + Preview)." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const prof = await profileOf(user.id);
    if (prof?.role === "contractor") { res.status(403).json({ error: "Not available on contractor accounts." }); return; }
  } catch { /* treat as team */ }

  const db = SERVICE ? createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } }) : null;
  const getRow = async (id) => { try { return db ? (await db.from("app_settings").select("data").eq("id", id).maybeSingle()).data : null; } catch { return null; } };
  const putRow = async (id, data) => { try { if (db) await db.from("app_settings").upsert({ id, data, updated_at: new Date().toISOString() }); } catch { /* best-effort */ } };

  if (req.query.status) {
    const cfg = await getRow("chatarv_cfg");
    return res.status(200).json({ configured: true, working: (cfg && cfg.data && cfg.data.url) || null, lastProbe: (cfg && cfg.data && cfg.data.probe) || null });
  }

  const address = String(req.query.address || "").trim();
  if (address.length < 8) { res.status(400).json({ error: "Send a full street address." }); return; }
  const cacheKey = "v1" + address.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 78);

  let cacheRow = null;
  if (!req.query.force) {
    cacheRow = await getRow("chatarv_cache");
    const hit = cacheRow && cacheRow.data && cacheRow.data.items && cacheRow.data.items[cacheKey];
    if (hit && Date.now() - new Date(hit.at).getTime() < 30 * 86400000) { res.status(200).json({ ...hit, cached: true }); return; }
  }

  // Known-good combination first; discovery otherwise.
  const cfgRow = await getRow("chatarv_cfg");
  const cfg = (cfgRow && cfgRow.data) || {};
  const tried = [];
  let win = null;
  const attempts = [];
  if (cfg.base && cfg.route && typeof cfg.auth === "number") attempts.push({ base: cfg.base, route: cfg.route, auth: cfg.auth });
  BASES.forEach((base) => ROUTES.forEach((route) => AUTHS.forEach((_, ai) => {
    if (!attempts.some((a) => a.base === base && a.route.p === route.p && a.route.m === route.m && a.auth === ai)) attempts.push({ base, route, auth: ai });
  })));
  for (const a of attempts) {
    try {
      const r = await tryCall(a.base, a.route, AUTHS[a.auth], KEY, address);
      tried.push(`${r.method} ${r.url} → ${r.status}`);
      // 401/403 with a JSON body still proves the endpoint exists — but only a
      // 2xx with parseable JSON counts as the working shape.
      if (r.status >= 200 && r.status < 300 && r.body) { win = { ...a, resp: r.body, url: r.url }; break; }
    } catch (e) { tried.push(`${a.route.m} ${a.base}${a.route.p} → ${String(e.message || "").slice(0, 40)}`); }
    if (tried.length >= 26) break;
  }
  if (!win) {
    await putRow("chatarv_cfg", { ...cfg, probe: { at: new Date().toISOString(), tried: tried.slice(0, 30) } });
    res.status(502).json({ error: "Couldn't find ChatARV's API shape automatically — send me their API docs page and I'll wire it exactly.", tried: tried.slice(0, 10) });
    return;
  }
  await putRow("chatarv_cfg", { base: win.base, route: win.route, auth: win.auth, probe: { at: new Date().toISOString(), workedUrl: win.url, keys: Object.keys(win.resp || {}).slice(0, 20) } });

  const rawComps = findComps(win.resp) || [];
  const comps = rawComps.map(mapComp).filter((c) => c.address && c.price > 0).slice(0, 12);
  const out = { at: new Date().toISOString(), provider: "ChatARV (MLS)", arv: findArv(win.resp), comps };
  if (!comps.length) { res.status(502).json({ error: "ChatARV answered but no comps could be read from the response — send me their docs and I'll map it exactly.", keys: Object.keys(win.resp || {}).slice(0, 20) }); return; }

  const items = (cacheRow && cacheRow.data && cacheRow.data.items) || ((await getRow("chatarv_cache"))?.data?.items) || {};
  items[cacheKey] = out;
  const keep = Object.entries(items).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 60);
  await putRow("chatarv_cache", { items: Object.fromEntries(keep) });
  res.status(200).json(out);
}
