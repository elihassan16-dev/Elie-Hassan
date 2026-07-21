// One-tap webhook registration (admin only): tells Quo where to deliver
// incoming texts. Run once after the API key + token are in place.
import { requireAppUser } from "../../lib/showings.js";
import { createWebhook, config } from "../../lib/quo.js";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (SERVICE_ROLE) {
      const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      const { data: u } = await db.from("users").select("role").eq("id", user.id).maybeSingle();
      if (!u || u.role !== "admin") { res.status(403).json({ error: "Admins only." }); return; }
    }
    if (!config().configured) { res.status(503).json({ error: "Set OPENPHONE_API_KEY and OPENPHONE_FROM_NUMBER first." }); return; }
    const origin = `https://${req.headers.host}`;
    const hook = await createWebhook(origin);
    res.status(200).json({ ok: true, webhook: { id: hook.id || null, url: hook.url || null, status: hook.status || null } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
