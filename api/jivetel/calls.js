// Jivetel call-event receiver (Webhook Event Subscriptions: call_origid,
// cdr, call recording). Payloads are arrays of NetSapiens-style records:
//   call_origid — live leg updates while a call rings/connects
//     {orig_from_uri:"sip:7325551234@…", orig_from_name:"CNAM", orig_user:"",
//      term_user:"101", term_call_info:"alerting", time_answer:"0000-…", remove?}
//   cdr — one record when a call completes
//     {cdr_id, orig_sub:null|ext, term_sub:ext, orig_from_uri, orig_from_name,
//      orig_to_user, time_start:epoch, time_answer:null|…, time_talking:secs}
// Completed calls land in the shared sms_messages store as kind:"call" rows,
// so each contact's conversation shows calls between the texts. Inbound
// ringing and missed calls fan out push notifications.
// POST requires ?key= to match JIVETEL_WEBHOOK_SECRET. GET is open but
// returns only counts and redacted key-shapes — never call content.
import { createClient } from "@supabase/supabase-js";
import { storeSms, e164 } from "../../lib/jivetel.js";

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

const uriNum = (u) => { const s = String(u || "").replace(/^sip:/i, "").split("@")[0]; const d = s.replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
const pretty = (n) => { const d = String(n || "").replace(/\D/g, ""); const x = d.length === 11 && d.startsWith("1") ? d.slice(1) : d; return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : String(n || ""); };
const fmtDur = (s) => { s = Number(s) || 0; return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const noAnswer = (v) => v == null || String(v).startsWith("0000");

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
      // Key-gated "who can actually receive alerts": each team login with how
      // many notification-ready devices they have. Zero devices = that person
      // never tapped "Turn on notifications" on their phone.
      if (req.query.who && process.env.JIVETEL_WEBHOOK_SECRET && String(req.query.key || "") === process.env.JIVETEL_WEBHOOK_SECRET) {
        const client = db();
        const { data: users } = await client.from("users").select("id,name,role,notify_muted,notify_channels");
        const { data: subs } = await client.from("push_subscriptions").select("user_id");
        const { data: arow } = await client.from("app_settings").select("data").eq("id", "jivetel_alerts").maybeSingle();
        const cnt = {};
        (subs || []).forEach((s) => { cnt[s.user_id] = (cnt[s.user_id] || 0) + 1; });
        return res.status(200).json({
          team: (users || []).filter((u) => u.role !== "contractor").map((u) => ({ name: u.name, muted: !!u.notify_muted, pushOff: !!(u.notify_channels && u.notify_channels.push === false), devices: cnt[u.id] || 0 })),
          recentAlerts: ((arow && arow.data && arow.data.log) || []).slice(-8).reverse(),
        });
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

    const entries = Array.isArray(req.body) ? req.body : req.body && typeof req.body === "object" ? [req.body] : [];
    const crow = (await client.from("app_settings").select("data").eq("id", "jivetel_calls").maybeSingle()).data;
    const log = (crow && crow.data) || {};
    const calls = log.calls || [];   // structured completed-call log (for the CRM)
    const rung = log.rung || [];     // orig_callids we already ring-notified
    let dirty = false;
    // Whose line is an extension? JIVETEL_CALL_EXT_ELIE="101@DOMAIN" etc. map
    // it — so the ring/missed alert goes ONLY to that person. Unknown
    // extension → the whole team (better than nobody).
    const extOwner = (ext) => {
      const e = String(ext || "").split("@")[0];
      if (!e) return null;
      for (const [k, v] of Object.entries(process.env)) {
        const m = /^JIVETEL_CALL_EXT_([A-Z0-9]+)$/.exec(k);
        if (m && String(v || "").split("@")[0] === e) return m[1].toLowerCase();
      }
      return null;
    };
    const notify = async (ext, payload) => {
      const { notifyFanout } = await import("../../lib/notify.js");
      const owner = extOwner(ext);
      // pushOnly: useful as a banner, pure noise as email/SMS.
      let result = null, err = "";
      try { result = await notifyFanout(client, null, { ...(owner ? { recipientsFirst: [owner] } : { toTeam: true }), url: "/", pushOnly: true, ...payload }); }
      catch (e) { err = e.message || "failed"; }
      // Diagnostics trail: the last 20 alert attempts — who was targeted and
      // how many devices actually got pushed. Read via GET ?key&who=1.
      try {
        const arow = (await client.from("app_settings").select("data").eq("id", "jivetel_alerts").maybeSingle()).data;
        const list = ((arow && arow.data && arow.data.log) || []).slice(-19);
        list.push({ at: new Date().toISOString(), ext: String(ext || ""), owner: owner || "(team)", title: payload.title, pushed: result ? result.pushed : null, err });
        await client.from("app_settings").upsert({ id: "jivetel_alerts", data: { log: list }, updated_at: new Date().toISOString() });
      } catch { /* diagnostics only */ }
    };

    for (const e of entries) {
      if (!e || typeof e !== "object") continue;

      if (e.cdr_id) {
        // ── Completed call ──
        const inbound = !e.orig_sub;                       // originated outside the PBX
        const ext = String(e.term_sub || e.orig_sub || "");
        const other = inbound ? uriNum(e.orig_from_uri) : String(e.orig_to_user || "").replace(/\D/g, "");
        if (other.length < 7) continue;                    // extension-to-extension — not a contact call
        const answered = !noAnswer(e.time_answer);
        const talk = Number(e.time_talking) || 0;
        const at = e.time_start ? new Date(Number(e.time_start) * 1000).toISOString() : new Date().toISOString();
        const name = inbound ? String(e.orig_from_name || "") : "";
        const missed = inbound && !answered;
        const text = inbound
          ? (missed ? "📞 Missed call" : `📞 Incoming call · ${fmtDur(talk)}`)
          : (answered ? `📞 Outgoing call · ${fmtDur(talk)}` : "📞 Outgoing call · no answer");
        await storeSms({
          id: "call-" + e.cdr_id,
          phone: e164(other),
          direction: inbound ? "call-in" : "call-out",
          kind: "call",
          text,
          by: name,
          ext,
          talkSecs: talk,
          missed,
          at,
          status: "",
        }).catch(() => {});
        if (!calls.some((c) => c.id === e.cdr_id)) {
          calls.push({ id: e.cdr_id, dir: inbound ? "in" : "out", phone: other, name, ext, at, talk, answered });
          dirty = true;
        }
        if (missed) {
          await notify(ext, {
            title: `📞 Missed call — ${name || pretty(other)}`,
            body: `${pretty(other)} · rang ext ${ext}`,
            tag: `jvcall-${e.cdr_id}`.slice(0, 64),
          });
        }
        continue;
      }

      // ── Live leg update (call_origid): inbound ringing → instant heads-up ──
      const ringing = String(e.term_call_info || "") === "alerting" && !e.remove && noAnswer(e.time_answer) && !e.orig_user;
      if (ringing && e.orig_callid && !rung.includes(e.orig_callid)) {
        rung.push(e.orig_callid);
        dirty = true;
        const from = uriNum(e.orig_from_uri);
        await notify(e.term_user, {
          title: `📞 Incoming call — ${e.orig_from_name || pretty(from)}`,
          body: `${pretty(from)} · ringing ext ${e.term_user || "?"}`,
          tag: `jvring-${e.orig_callid}`.slice(0, 64),
        });
      }
    }
    if (dirty) {
      await client.from("app_settings").upsert({
        id: "jivetel_calls",
        data: { calls: calls.slice(-3000), rung: rung.slice(-100) },
        updated_at: new Date().toISOString(),
      });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200 on our own hiccups so Jivetel doesn't disable the subscription.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
