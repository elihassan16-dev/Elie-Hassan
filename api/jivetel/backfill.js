// 🔁 Backfill from Jivetel itself: list recent messages on each configured
// line (same tokens the send endpoint uses) and store any the webhook missed
// into the shared conversation store. Built after a campaign blast outran the
// old webhook handler — the raw capture only held the last ~60 deliveries, so
// the dropped replies had to come from the source of truth.
// Like ?replay=1 on the webhook: unauthenticated GET, idempotent, no pings,
// and the response carries counts + endpoint diagnostics only — never
// message content. The exact list route isn't documented, so a few likely
// shapes are probed and the first that answers with an array wins.
import { createClient } from "@supabase/supabase-js";
import { storeSms, e164 } from "../../lib/jivetel.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = () => createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

export const config = { maxDuration: 60 };

const CANDIDATE_PATHS = [
  "/api/messages?per_page=200",
  "/api/messages?limit=200",
  "/api/v1/messages?limit=200",
  "/api/message/list",
  "/api/conversations?limit=100",
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    let numbers = {};
    try { numbers = JSON.parse(process.env.JIVETEL_NUMBERS || "{}"); } catch { /* empty */ }
    const notes = [];
    let seen = 0, recovered = 0;
    const client = db();
    for (const person of Object.keys(numbers)) {
      const sfx = String(person).split(" ")[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
      const token = process.env["JIVETEL_TOKEN_" + sfx] || process.env.JIVETEL_API_TOKEN || "";
      if (!token) { notes.push({ person, note: "no token" }); continue; }
      const auth = token.includes(" ") ? token : `Bearer ${token}`;
      let list = null;
      for (const path of CANDIDATE_PATHS) {
        try {
          const r = await fetch("https://jivetel-txt.jivetel.com" + path, { headers: { Authorization: auth, Accept: "application/json" } });
          const t = await r.text();
          let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
          const arr = j == null ? null : Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.messages) ? j.messages : Array.isArray(j.items) ? j.items : Array.isArray(j.results) ? j.results : null;
          if (r.ok && arr) { list = arr; notes.push({ person, used: path, got: arr.length }); break; }
          notes.push({ person, path, status: r.status, shape: j ? Object.keys(j).slice(0, 8) : String(t).slice(0, 60) });
        } catch (e) { notes.push({ person, path, err: String(e.message).slice(0, 80) }); }
      }
      if (!list) continue;
      for (const m of list) {
        if (!m || typeof m !== "object") continue;
        const id = String(m.id ?? m.uuid ?? m.MessageID ?? m.message_id ?? "");
        if (!id) continue;
        const dirRaw = String(m.direction ?? m.MessageDirection ?? "").toLowerCase();
        const dir = /out/.test(dirRaw) ? "out" : "in";
        const from = String(m.from ?? m.FromNumber ?? m.from_number ?? "");
        const to = String(m.to ?? m.ToNumber ?? m.to_number ?? "");
        const text = String(m.message ?? m.body ?? m.text ?? m.MessageBody ?? "");
        const mediaRaw = m.media ?? m.MediaURLs ?? m.attachments ?? null;
        const media = (Array.isArray(mediaRaw) ? mediaRaw : mediaRaw ? [mediaRaw] : [])
          .map((x) => (typeof x === "string" ? x : (x && (x.url || x.link)) || "")).filter((u) => /^https?:/i.test(u));
        if (!text && !media.length) continue;
        seen++;
        const { data: exist } = await client.from("sms_messages").select("id").eq("id", id).maybeSingle();
        if (exist) continue;
        const atRaw = m.created_at ?? m.createdAt ?? m.date ?? m.timestamp ?? null;
        const at = (() => { try { const t = new Date(isNaN(Number(atRaw)) ? atRaw : Number(atRaw)); return atRaw && !isNaN(t.getTime()) ? t.toISOString() : new Date().toISOString(); } catch { return new Date().toISOString(); } })();
        await storeSms({
          id,
          phone: e164(dir === "in" ? from : to),
          direction: dir,
          text,
          ...(media.length ? { media } : {}),
          by: dir === "in" ? String(m.contact_name ?? m.ContactName ?? m.name ?? "") : person,
          from: dir === "in" ? e164(to) : e164(from),
          at,
          status: "",
        }).catch(() => { /* one bad row must not stop the rest */ });
        recovered++;
      }
    }
    return res.status(200).json({ ok: true, seen, recovered, notes });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}
