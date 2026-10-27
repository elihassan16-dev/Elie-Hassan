// 🎬 gpflips.com/v/<uid> — a public watch page for a property video walkthrough
// (Elie 10/27/26, reverse prospecting). A full walkthrough is far too big for a
// picture message, so the text carries the poster picture + this short link,
// which plays the full-quality video on any phone. Only the Cloudflare Stream
// video named in the link is shown (they're already public, requireSignedURLs
// is off); nothing else about the property or the app is exposed.
// Readable links too (Elie 10/27/26): gpflips.com/v/24a-dewey-dr → that
// property's walkthrough (the one picked for its pitch, else its newest video).
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const slugOf = (addr) => String(addr || "").split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
async function fromSlug(slug) {
  if (!SERVICE_ROLE || !slug) return null;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data } = await db.from("properties").select("data");
  const props = (data || []).map((r) => r.data).filter((p) => p && !p.archived && !p.deleted);
  const p = props.find((x) => slugOf(x.address) === slug) || props.find((x) => slugOf(x.address).startsWith(slug + "-"));
  if (!p) return null;
  const vids = (p.media || []).filter((m) => m && m.kind === "video" && m.uid && !(p.mediaHidden || []).includes(m.id)).sort((a, b) => (b.at || 0) - (a.at || 0));
  const v = vids.find((m) => m.id === p.rpVideoId) || vids[0];
  return v ? { uid: String(v.uid), title: String(p.address || "").split(",")[0] } : null;
}
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_STREAM_TOKEN = process.env.CF_STREAM_TOKEN;
const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default async function handler(req, res) {
  const raw = String(req.query.uid || "").toLowerCase().slice(0, 80);
  let uid = /^[a-f0-9]{20,64}$/.test(raw) ? raw : "";
  let title = String(req.query.t || "").slice(0, 90);
  if (!uid && raw) { const hit = await fromSlug(raw.replace(/[^a-z0-9-]/g, "")).catch(() => null); if (hit) { uid = hit.uid; title = title || hit.title; } }
  let preview = "", thumb = "";
  if (uid && CF_ACCOUNT_ID && CF_STREAM_TOKEN) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}`, { headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}` } });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.result) { preview = j.result.preview || ""; thumb = j.result.thumbnail || ""; }
    } catch { /* falls to the not-found page */ }
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!preview) {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goldstone Properties</title><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:60px 20px;color:#555">This video isn't available.</body>`);
    return;
  }
  const iframe = preview.replace(/\/watch(\?.*)?$/, "/iframe") + "?poster=" + encodeURIComponent(thumb.replace(/\?.*$/, "") + "?time=2s&height=720");
  const heading = title ? `${esc(title)} — video walkthrough` : "Video walkthrough";
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${heading} · Goldstone Properties</title>
<meta property="og:title" content="${heading}"><meta property="og:site_name" content="Goldstone Properties"><meta property="og:type" content="video.other">
<meta property="og:image" content="${esc(thumb.replace(/\?.*$/, "") + "?time=2s&height=720")}"><meta name="twitter:card" content="summary_large_image"><meta property="og:video" content="${esc(preview)}">
<style>body{margin:0;background:#111;color:#fff;font-family:-apple-system,"SF Pro Text",Helvetica,Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column}
header{padding:16px 18px 10px;display:flex;align-items:center;gap:10px}header b{color:#D4B25F;font-family:Georgia,serif;font-size:19px}
.v{position:relative;width:100%;max-width:900px;margin:0 auto;aspect-ratio:9/16;max-height:82vh}.v iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
@media (min-aspect-ratio:1/1){.v{aspect-ratio:16/9}}h1{font-size:16px;font-weight:600;margin:12px 18px 24px;text-align:center;color:#ddd}</style></head>
<body><header><b>Goldstone Properties</b></header>
<div class="v"><iframe src="${esc(iframe)}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<h1>${heading}</h1></body></html>`);
}
