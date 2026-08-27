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
      res.setHeader("Cache-Control", "no-store, max-age=0"); // status must always be live
      const client0 = db();
      const { data } = await client0.from("app_settings").select("data").eq("id", "jivetel_events").maybeSingle();
      const ev = (data && data.data && data.data.events) || [];
      const shapes = new Set();
      ev.forEach((e) => shapeOf(e.body, "", shapes));
      // Re-analyze the last few CAPTURED events on the fly — shape, field
      // names, how the current parser would classify each, and whether that
      // message id actually made it into the conversation store. Ids,
      // directions and field NAMES only — never message content.
      const recent = [];
      const ids = [];
      for (const e of ev.slice(-10)) {
        const b = e.body && typeof e.body === "object" && !Array.isArray(e.body) ? e.body : {};
        const env = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : null;
        const dd = env || (b.MessageID || (b.MessageBody != null && b.MessageDirection) ? b : null);
        const media = dd ? mediaOf(dd) : [];
        const id = dd && dd.MessageID ? String(dd.MessageID) : "";
        if (id) ids.push(id);
        recent.push({
          at: e.at,
          shape: env ? "wrapped" : dd ? "flat" : "other",
          et: String(b.eventType || b.EventType || b.event || ""),
          keys: Object.keys(b).slice(0, 24),
          dkeys: env ? Object.keys(env).slice(0, 24) : undefined,
          id,
          dir: dd ? String(dd.MessageDirection || "") : "",
          parse: dd && (dd.MessageBody != null || media.length) ? (dd.MessageID ? "message" : dd.MessageDirection ? "app-message" : "no-message") : dd && dd.MessageID ? "receipt" : "no-message",
        });
      }
      if (ids.length) {
        const { data: rows } = await client0.from("sms_messages").select("id").in("id", ids);
        const inStore = new Set((rows || []).map((r) => String(r.id)));
        recent.forEach((r) => { if (r.id) r.inStore = inStore.has(r.id); });
      }
      return res.status(200).json({
        v: 5, // bump when the parser changes — proves which build is live
        configured: !!process.env.JIVETEL_WEBHOOK_SECRET,
        count: ev.length,
        lastAt: ev.length ? ev[ev.length - 1].at : null,
        contentTypes: [...new Set(ev.map((e) => e.ct).filter(Boolean))],
        recent,
        // What the parser DID with the last few posts — ids/direction/decision
        // only, never message content. Reads like: stored | dup | no-message.
        lastParse: (data && data.data && data.data.lastParse) || [],
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

    // Parse the Textable message shape into the app's Jivetel message log.
    // Two shapes arrive here: the original wrapped one —
    //   {eventType, timestamp, data:{FromNumber,ToNumber,MessageBody,…}}
    // — and the app-originated relay (messages typed directly in the Jivetel
    // SMS app), which Jivetel sends FLAT: the same fields at the top level,
    // no data envelope and no timestamp.
    const body = req.body && typeof req.body === "object" ? req.body : {};
    // data can arrive as an envelope object — or as something else entirely
    // (string, array) on other event kinds; only an object envelope counts.
    const env = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
    // The message record: the data envelope when wrapped, or the body itself
    // when the fields come flat — with or without a MessageID (the
    // app-originated relay sends none).
    const d = env || (body.MessageID || (body.MessageBody != null && body.MessageDirection) ? body : null);
    const media = d ? mediaOf(d) : [];
    // Ping whoever OWNS the line an inbound text arrived on (their number in
    // JIVETEL_NUMBERS); unknown line → the whole team. Shared by both the
    // id-carrying and the app-originated (no-id) message paths.
    // What arrived, in words: "Video sent" / "Photo sent" / "Attachment sent"
    // (with counts) instead of a generic label.
    const mediaLabel = (urls) => {
      if (!urls || !urls.length) return "";
      const kind = (u) => /\.(mp4|mov|m4v|3gp|webm|avi|mkv)(\?|$)/i.test(u) ? "video" : /\.(jpe?g|png|gif|heic|heif|webp|bmp|tiff?)(\?|$)/i.test(u) ? "photo" : "file";
      const kinds = urls.map(kind);
      const n = urls.length;
      if (kinds.every((k) => k === "video")) return n > 1 ? `🎥 ${n} videos sent` : "🎥 Video sent";
      if (kinds.every((k) => k === "photo")) return n > 1 ? `📷 ${n} photos sent` : "📷 Photo sent";
      return n > 1 ? `📎 ${n} attachments sent` : "📎 Attachment sent";
    };
    const pingInbound = async (m) => {
      // Jivetel can deliver the SAME inbound text in two encodings (with and
      // without a MessageID) near-simultaneously — each raced past the store
      // dedupe and pinged, so phones buzzed twice. A short-lived alert log
      // keyed by sender+content collapses them regardless of arrival order.
      try {
        const key = `${e164(m.from)}|${String(m.text || "").slice(0, 80)}|${String((m.media || [])[0] || "").slice(0, 60)}`;
        const { data: arow } = await client.from("app_settings").select("data").eq("id", "jivetel_text_alerts").maybeSingle();
        const log = ((arow && arow.data && arow.data.log) || []).filter((x) => Date.now() - new Date(x.at).getTime() < 10 * 60000);
        if (log.some((x) => x.k === key && Date.now() - new Date(x.at).getTime() < 3 * 60000)) return;
        log.push({ k: key, at: new Date().toISOString() });
        await client.from("app_settings").upsert({ id: "jivetel_text_alerts", data: { log: log.slice(-60) }, updated_at: new Date().toISOString() });
      } catch { /* dedupe is best-effort — never blocks the alert */ }
      // ⚙️ Feature switch (Settings portal): new-text alerts can be turned off.
      try {
        const { data: featR } = await client.from("app_settings").select("data").eq("id", "features").maybeSingle();
        if (featR && featR.data && featR.data.flags && featR.data.flags.textAlert === false) return;
      } catch { /* switch unreadable → alert as usual */ }
      const { notifyFanout } = await import("../../lib/notify.js");
      const preview = m.text.length > 90 ? m.text.slice(0, 90) + "…" : m.text;
      const owner = lineOwner(m.to); // bad JSON / unknown line → team-wide
      let who = null; try { who = await identifyPhone(m.from); } catch { /* number-only */ }
      // Name in the title; buyer/agent/lead + their property before the
      // message, so the banner answers "who and about what" at a glance.
      const sub = whoSub(who);
      const label = mediaLabel(m.media);
      await notifyFanout(client, null, {
        ...(owner ? { recipientsFirst: [owner] } : { toTeam: true }),
        title: `💬 New text — ${(who && who.name) || m.name || m.from}`,
        body: `${sub ? sub + " · " : ""}${[preview, label].filter(Boolean).join(" · ") || "(no text)"}`,
        tag: `jvmsg-${m.id}`.slice(0, 64),
        url: "/",
      }).catch(() => {});
    };
    // Parse trail for the GET status view — decision, ids and FIELD NAMES
    // only (never values/content), so unknown shapes can be mapped from it.
    const trace = {
      at: new Date().toISOString(),
      shape: env ? "wrapped" : d ? "flat" : "other",
      et: String(body.eventType || body.EventType || body.event || ""),
      keys: Object.keys(body).slice(0, 24),
      dkeys: env ? Object.keys(env).slice(0, 24) : (body.data != null ? "data:" + (Array.isArray(body.data) ? "array" : typeof body.data) : ""),
      id: d && d.MessageID ? String(d.MessageID) : "",
      dir: "",
      decision: "no-message",
    };
    // Which teammate owns a line (their number in JIVETEL_NUMBERS) — labels
    // app-typed outgoing texts with the sender, keys inbound pings.
    const lineOwner = (num) => {
      try {
        const nums = JSON.parse(process.env.JIVETEL_NUMBERS || "{}");
        const d10 = (x) => { const dd = String(x || "").replace(/\D/g, ""); return dd.length === 11 && dd.startsWith("1") ? dd.slice(1) : dd; };
        const hit = Object.entries(nums).find(([, v]) => d10(v) && d10(v) === d10(num));
        return hit ? hit[0] : null;
      } catch { return null; }
    };
    // A picture with no caption has a null body — it's still a message.
    if (d && d.MessageID && (d.MessageBody != null || media.length)) {
      const dir = /out/i.test(String(d.MessageDirection || "")) ? "out" : "in";
      const ts = body.timestamp ?? d.timestamp ?? d.Timestamp ?? null;
      const msg = {
        id: String(d.MessageID),
        at: (() => { try { const t = new Date(isNaN(Number(ts)) ? ts : Number(ts)); return ts && !isNaN(t.getTime()) ? t.toISOString() : new Date().toISOString(); } catch { return new Date().toISOString(); } })(),
        dir,
        from: String(d.FromNumber || ""),
        to: String(d.ToNumber || ""),
        text: String(d.MessageBody || ""),
        media,
        name: String(d.ContactName || ""),
        convId: String(d.ConversationID || ""),
        userId: String(d.TextableUserID || ""),
      };
      trace.dir = dir;
      trace.decision = "dup-relay-log";
      const mrow = (await client.from("app_settings").select("data").eq("id", "jivetel_msgs").maybeSingle()).data;
      const msgs = ((mrow && mrow.data && mrow.data.msgs) || []);
      if (!msgs.some((m) => m.id === msg.id)) {
        msgs.push(msg);
        await client.from("app_settings").upsert({ id: "jivetel_msgs", data: { msgs: msgs.slice(-2000) }, updated_at: new Date().toISOString() });
        // Into the app's conversation store too — the thread popups, badges
        // and realtime updates all read sms_messages. The other party's
        // number keys the thread. Skip ids the send endpoint already logged —
        // its record is richer (author, property tag, sent status) and a
        // relayed echo must not overwrite it.
        const { data: exist } = await client.from("sms_messages").select("id").eq("id", msg.id).maybeSingle();
        trace.decision = exist ? "dup-send-log" : "stored";
        if (!exist) await storeSms({
          id: msg.id,
          phone: e164(dir === "in" ? msg.from : msg.to),
          direction: dir,
          text: msg.text,
          ...(media.length ? { media } : {}),
          // Outgoing texts typed in the Jivetel app carry no author — name
          // them after whoever owns the line they went out on, so threads
          // and contact-ownership see them like app-sent texts.
          by: dir === "in" ? msg.name : lineOwner(msg.from) || "",
          from: dir === "in" ? e164(msg.to) : e164(msg.from),
          at: msg.at,
          status: "",
        }).catch(() => {});
        // Ping whoever OWNS the line the text came in on (their number in
        // JIVETEL_NUMBERS); unknown line → the whole team.
        if (dir === "in") await pingInbound(msg);
      }
    }
    // ── App-originated relay: messages typed directly in the Jivetel SMS
    // app arrive with the same fields but NO MessageID — flat, or wrapped
    // as eventType "message.sent" — and usually in BOTH encodings seconds
    // apart. Content+recency dedupe collapses the double delivery, and it
    // also swallows the relay echo of texts our own send endpoint already
    // logged (same phone + direction + text moments earlier).
    else if (d && !d.MessageID && (d.MessageBody != null || media.length) && d.MessageDirection && (d.FromNumber || d.ToNumber)) {
      const dir = /out/i.test(String(d.MessageDirection)) ? "out" : "in";
      const from = String(d.FromNumber || ""), to = String(d.ToNumber || "");
      const phone = e164(dir === "in" ? from : to);
      const text = String(d.MessageBody || "");
      trace.dir = dir;
      const since = new Date(Date.now() - 10 * 60000).toISOString();
      const { data: dupRows } = await client.from("sms_messages").select("data").eq("phone", phone).gte("updated_at", since);
      const dup = (dupRows || []).some((r) => r.data && r.data.direction === dir && String(r.data.text || "") === text && String(((r.data.media || [])[0]) || "") === String(media[0] || ""));
      trace.decision = dup ? "dup-recent" : "stored";
      if (!dup) {
        const ts = body.timestamp ?? d.timestamp ?? null;
        const at = (() => { try { const t = new Date(isNaN(Number(ts)) ? ts : Number(ts)); return ts && !isNaN(t.getTime()) ? t.toISOString() : new Date().toISOString(); } catch { return new Date().toISOString(); } })();
        const name = String(d.ContactName || "");
        const id = "jvapp-" + (Number(ts) || Date.now()) + "-" + (text.length || media.length);
        await storeSms({
          id,
          phone,
          direction: dir,
          text,
          ...(media.length ? { media } : {}),
          by: dir === "in" ? name : lineOwner(from) || "",
          from: dir === "in" ? e164(to) : e164(from),
          at,
          status: "",
        }).catch(() => {});
        if (dir === "in") await pingInbound({ id, from, to, name, text, media });
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
      trace.decision = mapped ? "receipt-" + mapped : "receipt-ignored";
      if (mapped) {
        const { data: row } = await client.from("sms_messages").select("data").eq("id", String(d.MessageID)).maybeSingle();
        if (row && row.data && row.data.status !== mapped) {
          await client.from("sms_messages").update({ data: { ...row.data, status: mapped }, updated_at: new Date().toISOString() }).eq("id", String(d.MessageID));
        }
      }
    }
    // Persist the parse trail (last 10) next to the raw capture.
    try {
      const prev = ((row && row.data && row.data.lastParse) || []).slice(-9);
      await client.from("app_settings").upsert({ id: "jivetel_events", data: { events: ev, lastParse: [...prev, trace] }, updated_at: new Date().toISOString() });
    } catch { /* diagnostics only */ }
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200 on our own hiccups so Jivetel doesn't disable the relay.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
