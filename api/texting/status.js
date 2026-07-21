// Is business texting (Quo) connected? The app checks this to decide whether
// Text buttons open real in-app threads or fall back to the phone's sms: links.
// Bonus: once the keys exist, this ALSO self-registers our reply webhook with
// Quo (checked at most once per server instance) — zero manual setup steps.
import { config, createWebhook } from "../../lib/quo.js";

const API = "https://api.openphone.com/v1";
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
  const webhook = cfg.webhookToken ? await ensureWebhook(req.headers.host) : "no token";
  res.status(200).json({ connected: true, from: cfg.from, webhook });
}
