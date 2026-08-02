// Jivetel "Webhook Relay" receiver — captures whatever Jivetel sends so the
// real parsing can be wired once the payload shape is known. POST requires
// ?key= to match JIVETEL_WEBHOOK_SECRET (set in Vercel). GET is open but
// returns only counts and redacted key-shapes — never message content.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = () => createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

// "a.b[].c:string" style paths — structure only, no values.
function shapeOf(o, pre = "", out = new Set(), depth = 0) {
  if (depth > 5 || o == null) { if (pre) out.add(pre + ":" + (o === null ? "null" : "empty")); return out; }
  if (Array.isArray(o)) { shapeOf(o[0], pre + "[]", out, depth + 1); return out; }
  if (typeof o === "object") { for (const k of Object.keys(o)) shapeOf(o[k], pre ? pre + "." + k : k, out, depth + 1); return out; }
  out.add(pre + ":" + typeof o);
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { data } = await db().from("app_settings").select("data").eq("id", "jivetel_events").maybeSingle();
      const ev = (data && data.data && data.data.events) || [];
      const shapes = new Set();
      ev.forEach((e) => shapeOf(e.body, "", shapes));
      return res.status(200).json({
        configured: !!process.env.JIVETEL_WEBHOOK_SECRET,
        count: ev.length,
        lastAt: ev.length ? ev[ev.length - 1].at : null,
        contentTypes: [...new Set(ev.map((e) => e.ct).filter(Boolean))],
        shapes: [...shapes].sort(),
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const secret = process.env.JIVETEL_WEBHOOK_SECRET;
    if (!secret || String(req.query.key || "") !== secret) return res.status(401).json({ error: "bad key" });
    const row = (await db().from("app_settings").select("data").eq("id", "jivetel_events").maybeSingle()).data;
    const ev = ((row && row.data && row.data.events) || []).slice(-99); // keep the last 100
    ev.push({ at: new Date().toISOString(), ct: req.headers["content-type"] || "", body: req.body ?? null });
    await db().from("app_settings").upsert({ id: "jivetel_events", data: { events: ev }, updated_at: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200 on our own hiccups so Jivetel doesn't disable the relay.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
