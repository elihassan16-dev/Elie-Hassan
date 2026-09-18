// Copy a product picture into Goldstone's own storage so it can never go
// blank again (Elie 9/18/26): pictures pulled from a store's product page
// were stored as the store's own image address, and stores rotate or block
// those later. Team-only. Returns { url } — the durable public copy — or the
// original address with { mirrored:false } when the store won't hand it over.
import { createClient } from "@supabase/supabase-js";
import { requireTeamUser } from "../../lib/quickbooks.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX = 8 * 1024 * 1024;

export default async function handler(req, res) {
  const user = await requireTeamUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  let url = String(req.query.url || "").trim();
  if (!url) { res.status(400).json({ error: "No picture address." }); return; }
  if (url.startsWith("//")) url = "https:" + url;
  let u;
  try { u = new URL(url); } catch { res.status(400).json({ error: "That doesn't look like a link." }); return; }
  // Already ours — nothing to do.
  if (u.hostname.endsWith(".supabase.co") && u.pathname.includes("/storage/v1/object/public/")) { res.status(200).json({ url, mirrored: true, same: true }); return; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(u.toString(), {
      signal: ctl.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", Accept: "image/avif,image/webp,image/*,*/*;q=0.8", Referer: `${u.origin}/` },
    });
    clearTimeout(t);
    const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!r.ok || !type.startsWith("image/")) { res.status(200).json({ url, mirrored: false, error: r.ok ? "Not a picture." : `Store said ${r.status}.` }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX) { res.status(200).json({ url, mirrored: false, error: buf.length ? "Picture too big." : "Empty picture." }); return; }
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : type === "image/avif" ? "avif" : "jpg";
    const path = `spec/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { error } = await sb.storage.from("attachments").upload(path, buf, { contentType: type, upsert: false });
    if (error) throw error;
    const { data } = sb.storage.from("attachments").getPublicUrl(path);
    res.status(200).json({ url: data.publicUrl, mirrored: true, from: url });
  } catch (e) {
    res.status(200).json({ url, mirrored: false, error: e.name === "AbortError" ? "That store took too long." : (e.message || "Couldn't copy that picture.") });
  }
}
