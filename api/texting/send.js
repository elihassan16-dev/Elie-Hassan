// Send a text from the company Quo number, and log it so the conversation
// thread shows it. Admin-only for now — the connected Quo number is Elie's
// own line; once each teammate has their own number this opens up per-user.
import { requireAppUser } from "../../lib/showings.js";
import { config, sendSms, storeSms, e164 } from "../../lib/quo.js";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!config().configured) { res.status(503).json({ error: "Texting isn't connected yet." }); return; }
    // Contractor logins can't use the company texting line.
    if (SERVICE_ROLE) {
      const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      const { data: u } = await db.from("users").select("role,name").eq("id", user.id).maybeSingle();
      if (!u || u.role !== "admin") { res.status(403).json({ error: "The business texting line is admin-only for now." }); return; }
      req._senderName = u.name || user.email || "";
    }
    const { to, message } = req.body || {};
    if (!to || !String(message || "").trim()) { res.status(400).json({ error: "A recipient and a message are required." }); return; }
    const sent = await sendSms(to, message);
    await storeSms({
      id: sent.id || `out-${Date.now()}`,
      phone: e164(to),
      direction: "out",
      text: String(message || ""),
      by: req._senderName || "",
      at: sent.createdAt || new Date().toISOString(),
      status: sent.status || "sent",
    }).catch(() => {});
    res.status(200).json({ ok: true, id: sent.id || null });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
