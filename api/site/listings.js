// 🌐 Public company website feed (Elie 11/8/26) — gpflips.com/company, and
// later his own domain. Anyone can call this: it returns ONLY what a listing
// page shows — street, town, price, beds/baths/sqft, a short description, and
// the photos + walkthrough video picked for the website. Never money, notes,
// tasks, people or anything else from the app.
//
// What shows:
//   For Sale        = status On Market
//   Under Contract  = status In Closing
//   (Sold homes are NOT shown — Elie 11/8/26)
// A listing is hidden when p.web.hide is set (the app's 🌐 Website sheet).
// Photos: p.web.photos [{id,url,w,h}] chosen in that sheet, in order (first =
// cover); none chosen → the property's Zillow photos (src "zillow"). Video:
// p.web.video {uid,url} | "none"; none chosen → the reverse-prospecting pitch
// video (p.rpVideoId), already shared publicly at gpflips.com/v/.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOW = { "On Market": "sale", "Attorney Review": "pending", "In Closing": "pending" }; // no Sold on the site (Elie 11/8/26)
const httpsOnly = (u) => (/^https:\/\//i.test(String(u || "")) ? String(u) : "");
const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : 0; };
const short = (v, n = 40) => String(v ?? "").trim().slice(0, n);
export const slugOf = (addr) => String(addr || "").split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Cloudflare Stream: the iframe player + a poster picture from the stored link.
function streamOf(m) {
  if (!m || !m.uid) return null;
  const uid = String(m.uid).toLowerCase();
  if (!/^[a-f0-9]{20,64}$/.test(uid)) return null;
  const base = /^(https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com)\//i.exec(String(m.url || m.watch || ""));
  if (!base) return null;
  return { uid, player: `${base[1]}/${uid}/iframe`, poster: `${base[1]}/${uid}/thumbnails/thumbnail.jpg?time=2s&height=1080` };
}

export function publicListing(p) {
  const kind = SHOW[p.status];
  const web = p.web || {};
  if (!kind || p.archived || p.deleted || web.hide) return null;
  const hidden = new Set(p.mediaHidden || []);
  const media = (p.media || []).filter((m) => m && m.id && !hidden.has(m.id));
  const photos = (Array.isArray(web.photos) && web.photos.length
    ? web.photos.map((x) => ({ url: httpsOnly(x && x.url), w: num(x && x.w) || undefined, h: num(x && x.h) || undefined }))
    : media.filter((m) => m.kind === "photo" && m.src === "zillow").map((m) => ({ url: httpsOnly(m.url), w: num(m.w) || undefined, h: num(m.h) || undefined }))
  ).filter((x) => x.url).slice(0, 60);
  let video = null;
  if (web.video !== "none") {
    video = web.video && web.video.uid ? streamOf(web.video)
      : p.rpVideoId && p.rpVideoId !== "none" ? streamOf(media.find((m) => m.kind === "video" && m.id === p.rpVideoId)) : null;
  }
  const pi = p.propertyInfo || {};
  return {
    id: slugOf(p.address) || String(p.id),
    street: short(String(p.address || "").split(",")[0], 80),
    town: short(p.city, 40), state: short(p.state || "NJ", 4), zip: short(p.zip, 10),
    kind,
    price: num(web.price) || num(p.rpPrice) || 0,
    beds: short(pi.beds, 6), baths: short(pi.baths, 6), sqft: num(pi.sqft) || 0,
    blurb: short(web.blurb, 1200),
    renovated: web.renovated !== false,
    photos, video,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!SERVICE_ROLE) { res.status(500).json({ error: "not configured" }); return; }
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data, error } = await db.from("properties").select("data").in("status", Object.keys(SHOW));
    if (error) throw error;
    const rank = { sale: 0, pending: 1 };
    const listings = (data || []).map((r) => r && r.data && publicListing(r.data)).filter(Boolean)
      .sort((a, b) => rank[a.kind] - rank[b.kind] || (b.photos.length ? 1 : 0) - (a.photos.length ? 1 : 0) || a.town.localeCompare(b.town));
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
    res.status(200).json({ listings });
  } catch (e) {
    console.error("[site/listings]", e && e.message);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: "Couldn't load listings" });
  }
}
