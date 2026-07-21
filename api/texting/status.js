// Is business texting (Quo) connected — FOR THIS USER? The connected number
// is the admin's own Quo line, so only admins get connected:true; everyone
// else (members, contractors, signed-out) sees texting as off and every
// Call/Text button falls back to the phone's plain tel:/sms: links.
// Bonus: once the keys exist, this ALSO self-registers our reply webhook with
// Quo (checked at most once per server instance) — zero manual setup steps.
import { requireAppUser } from "../../lib/showings.js";
import { config, createWebhook } from "../../lib/quo.js";
import { createClient } from "@supabase/supabase-js";

const API = "https://api.openphone.com/v1";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
let webhookChecked = null; // "ready" | "failed: …" — memoized per warm instance

async function ensureWebhook(host) {
  if (webhookChecked === "ready") return webhookChecked;
  const cfg = config();
  try {
    const r = await fetch(`${API}/webhooks`, { headers: { Authorization: cfg.key } });
    const j = await r.json().catch(() => ({}));
    const hooks = (j && (j.data || j.result)) || [];
    const ours = Array.isArray(hooks) && hooks.some((h) => String(h.url || "").includes("/api/texting/webhook"));
    if (!ours) await createWebhook(`https://${host}`);
    webhookChecked = "ready";
  } catch (e) {
    webhookChecked = `failed: ${e.message}`;
  }
  return webhookChecked;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const cfg = config();
  if (!cfg.configured) { res.status(200).json({ connected: false }); return; }
  // Keep the webhook registered no matter who's asking — replies must always
  // reach the app.
  const webhook = cfg.webhookToken ? await ensureWebhook(req.headers.host) : "no token";
  const user = await requireAppUser(req).catch(() => null);
  if (!user || !SERVICE_ROLE) { res.status(200).json({ connected: false }); return; }
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: u } = await db.from("users").select("role").eq("id", user.id).maybeSingle();
  if (!u || u.role !== "admin") { res.status(200).json({ connected: false }); return; }
  res.status(200).json({ connected: true, from: cfg.from, webhook });
}
