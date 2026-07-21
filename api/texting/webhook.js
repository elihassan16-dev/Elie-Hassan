// Quo calls this the moment a text arrives at (or is delivered from) the
// company number. The URL carries a secret token so only Quo's calls with our
// registered URL are accepted. Incoming replies are stored for the app's
// conversation threads, and the team gets pinged.
import { config, storeSms, e164 } from "../../lib/quo.js";
import { notifyFanout } from "../../lib/notify.js";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
    const cfg = config();
    if (!cfg.webhookToken || String(req.query.token || "") !== cfg.webhookToken) {
      res.status(401).json({ error: "Bad token." }); return;
    }
    const evt = req.body || {};
    const type = evt.type || "";
    const msg = (evt.data && evt.data.object) || {};
    if (type === "message.received") {
      const from = e164(msg.from || "");
      await storeSms({
        id: msg.id || `in-${Date.now()}`,
        phone: from,
        direction: "in",
        text: String(msg.text || msg.body || ""),
        at: msg.createdAt || new Date().toISOString(),
        status: "received",
      });
      // Ping the admins: someone texted the business line.
      if (SERVICE_ROLE) {
        const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
        await notifyFanout(db, null, {
          toAdmins: true,
          title: `💬 Text from ${from}`,
          body: String(msg.text || msg.body || "").slice(0, 140) || "(no text)",
          url: "/?goto=chat:__sms__",
          tag: `sms-${from}`,
        }).catch(() => {});
      }
    } else if (type === "message.delivered" && msg.id) {
      // Mark the outbound row delivered (best-effort).
      if (SERVICE_ROLE) {
        const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
        const { data } = await db.from("sms_messages").select("id,phone,data").eq("id", String(msg.id)).maybeSingle();
        if (data) await db.from("sms_messages").upsert({ id: data.id, phone: data.phone, data: { ...data.data, status: "delivered" }, updated_at: new Date().toISOString() }, { onConflict: "id" });
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200-range fast so Quo doesn't retry-storm; log the reason.
    console.error("[texting/webhook]", e.message);
    res.status(200).json({ ok: false });
  }
}
