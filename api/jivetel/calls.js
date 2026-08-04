// Jivetel call-event receiver (Webhook Event Subscriptions: call_origid,
// cdr, call recording). Same discovery pattern as the texting webhook:
// capture every payload raw so the real parsing can be wired once the shape
// is known, and keep a best-effort parsed call log alongside.
// POST requires ?key= to match JIVETEL_WEBHOOK_SECRET. GET is open but
// returns only counts and redacted key-shapes — never call content.
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

// Best-effort peek at common CDR field names so a call log starts building
// even before the exact schema is confirmed. Unknown shapes still land in
// the raw ring buffer either way.
function guessCall(b) {
  if (!b || typeof b !== "object") return null;
  const pick = (...names) => {
    for (const n of names) {
      const v = n.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), b);
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const from = pick("from", "From", "caller", "callerId", "caller_id", "orig_from_number", "orig_caller_id_number", "data.FromNumber", "ani", "Ani");
  const to = pick("to", "To", "callee", "called", "dialed", "term_to_number", "orig_to_number", "data.ToNumber", "dnis");
  if (from === undefined && to === undefined) return null;
  return {
    id: String(pick("id", "Id", "uuid", "orig_callid", "call_id", "CallID", "cdr_id", "sessionId") || `call-${Date.now()}`),
    from: String(from ?? ""),
    to: String(to ?? ""),
    direction: String(pick("direction", "Direction", "call_direction") ?? ""),
    duration: String(pick("duration", "Duration", "talk_time", "time_talking", "billsec") ?? ""),
    at: String(pick("time", "timestamp", "Timestamp", "start_time", "time_start", "datetime") ?? new Date().toISOString()),
    type: String(pick("eventType", "event", "type") ?? "cdr"),
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { data } = await db().from("app_settings").select("data").eq("id", "jivetel_call_events").maybeSingle();
      const ev = (data && data.data && data.data.events) || [];
      // Key-gated raw peek (same secret as POST) — for wiring the parser to
      // the real payload. Without the key, GET stays shape-only.
      if (req.query.raw && process.env.JIVETEL_WEBHOOK_SECRET && String(req.query.key || "") === process.env.JIVETEL_WEBHOOK_SECRET) {
        return res.status(200).json({ count: ev.length, latest: ev.slice(-3) });
      }
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
    const client = db();
    const row = (await client.from("app_settings").select("data").eq("id", "jivetel_call_events").maybeSingle()).data;
    const ev = ((row && row.data && row.data.events) || []).slice(-199); // keep the last 200 raw
    ev.push({ at: new Date().toISOString(), ct: req.headers["content-type"] || "", body: req.body ?? null });
    await client.from("app_settings").upsert({ id: "jivetel_call_events", data: { events: ev }, updated_at: new Date().toISOString() });

    // Best-effort call log — refined once the real payload shape is known.
    const call = guessCall(req.body);
    if (call) {
      const crow = (await client.from("app_settings").select("data").eq("id", "jivetel_calls").maybeSingle()).data;
      const calls = ((crow && crow.data && crow.data.calls) || []);
      if (!calls.some((c) => c.id === call.id && c.type === call.type)) {
        calls.push(call);
        await client.from("app_settings").upsert({ id: "jivetel_calls", data: { calls: calls.slice(-3000) }, updated_at: new Date().toISOString() });
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200 on our own hiccups so Jivetel doesn't disable the subscription.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
