// Jivetel "Webhook Relay" receiver — captures whatever Jivetel sends so the
// real parsing can be wired once the payload shape is known. POST requires
// ?key= to match JIVETEL_WEBHOOK_SECRET (set in Vercel). GET is open but
// returns only counts and redacted key-shapes — never message content.
import { createClient } from "@supabase/supabase-js";
import { storeSms, e164, identifyPhone, whoSub } from "../../lib/jivetel.js";

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

// MMS attachments — relays name the URL list differently across shapes, so
// probe the common spellings. The raw event is captured either way
// (jivetel_events), so an unmatched shape can be wired exactly later.
const mediaOf = (x) => {
  const raw = x && (x.MediaURLs ?? x.MediaUrls ?? x.MediaUrl ?? x.MediaURL ?? x.Media ?? x.media ?? x.Attachments ?? x.attachments ?? x.Files ?? null);
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((m) => (typeof m === "string" ? m : (m && (m.url || m.Url || m.URL || m.link || m.location || m.MediaUrl)) || "")).filter((u) => /^https?:/i.test(u));
};

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
    const client = db();
    const row = (await client.from("app_settings").select("data").eq("id", "jivetel_events").maybeSingle()).data;
    const ev = ((row && row.data && row.data.events) || []).slice(-99); // keep the last 100 raw
    ev.push({ at: new Date().toISOString(), ct: req.headers["content-type"] || "", body: req.body ?? null });
    await client.from("app_settings").upsert({ id: "jivetel_events", data: { events: ev }, updated_at: new Date().toISOString() });

    // Parse the Textable message shape into the app's Jivetel message log —
    // {eventType, timestamp, data:{FromNumber,ToNumber,MessageBody,
    //  MessageDirection, MessageID, ConversationID, ContactName, …}}.
    const d = (req.body && req.body.data) || null;
    const media = d ? mediaOf(d) : [];
    // A picture with no caption has a null body — it's still a message.
    if (d && d.MessageID && (d.MessageBody != null || media.length)) {
      const dir = /out/i.test(String(d.MessageDirection || "")) ? "out" : "in";
      const msg = {
        id: String(d.MessageID),
        at: req.body.timestamp ? new Date(Number(req.body.timestamp)).toISOString() : new Date().toISOString(),
        dir,
        from: String(d.FromNumber || ""),
        to: String(d.ToNumber || ""),
        text: String(d.MessageBody || ""),
        media,
        name: String(d.ContactName || ""),
        convId: String(d.ConversationID || ""),
        userId: String(d.TextableUserID || ""),
      };
      const mrow = (await client.from("app_settings").select("data").eq("id", "jivetel_msgs").maybeSingle()).data;
      const msgs = ((mrow && mrow.data && mrow.data.msgs) || []);
      if (!msgs.some((m) => m.id === msg.id)) {
        msgs.push(msg);
        await client.from("app_settings").upsert({ id: "jivetel_msgs", data: { msgs: msgs.slice(-2000) }, updated_at: new Date().toISOString() });
        // Into the app's conversation store too — the thread popups, badges
        // and realtime updates all read sms_messages. The other party's
        // number keys the thread; upsert by id dedupes messages the send
        // endpoint already logged.
        await storeSms({
          id: msg.id,
          phone: e164(dir === "in" ? msg.from : msg.to),
          direction: dir,
          text: msg.text,
          ...(media.length ? { media } : {}),
          by: dir === "in" ? msg.name : "",
          from: dir === "in" ? e164(msg.to) : e164(msg.from),
          at: msg.at,
          status: "",
        }).catch(() => {});
        // Ping whoever OWNS the line the text came in on (their number in
        // JIVETEL_NUMBERS); unknown line → the whole team.
        if (dir === "in") {
          const { notifyFanout } = await import("../../lib/notify.js");
          const preview = msg.text.length > 90 ? msg.text.slice(0, 90) + "…" : msg.text;
          let owner = null;
          try {
            const nums = JSON.parse(process.env.JIVETEL_NUMBERS || "{}");
            const d10 = (x) => { const d = String(x || "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
            const hit = Object.entries(nums).find(([, v]) => d10(v) && d10(v) === d10(msg.to));
            if (hit) owner = hit[0];
          } catch { /* bad JSON → team-wide */ }
          let who = null; try { who = await identifyPhone(msg.from); } catch { /* number-only */ }
          // Name in the title; buyer/agent/lead + their property before the
          // message, so the banner answers "who and about what" at a glance.
          const sub = whoSub(who);
          await notifyFanout(client, null, {
            ...(owner ? { recipientsFirst: [owner] } : { toTeam: true }),
            title: `💬 New text — ${(who && who.name) || msg.name || msg.from}`,
            body: `${sub ? sub + " · " : ""}${preview || (media.length ? "📷 Photo" : "(no text)")}`,
            tag: `jvmsg-${msg.id}`.slice(0, 64),
            url: "/",
          }).catch(() => {});
        }
      }
    }
    // Delivery receipts: a status-only event (MessageID, no MessageBody)
    // updates the stored message so the thread's ✓ becomes ✓✓ once the
    // carrier confirms the handset got it — or flags a failed send. Field
    // names are probed tolerantly; the raw event is in jivetel_events either
    // way, so an unrecognized shape can be wired in from the capture.
    else if (d && d.MessageID && d.MessageBody == null) {
      const st = String(d.MessageStatus || d.Status || d.DeliveryStatus || d.MessageDeliveryStatus || d.status || "").toLowerCase();
      const mapped = /deliver/.test(st) ? "delivered" : /fail|undeliver|reject|error/.test(st) ? "failed" : "";
      if (mapped) {
        const { data: row } = await client.from("sms_messages").select("data").eq("id", String(d.MessageID)).maybeSingle();
        if (row && row.data && row.data.status !== mapped) {
          await client.from("sms_messages").update({ data: { ...row.data, status: mapped }, updated_at: new Date().toISOString() }).eq("id", String(d.MessageID));
        }
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200 on our own hiccups so Jivetel doesn't disable the relay.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
