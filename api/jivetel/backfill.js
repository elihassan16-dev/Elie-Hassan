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
    // ?docs=2 — the instance serves its OpenAPI spec at /docs/json: return
    // every path+method, and for message/conversation/export paths also the
    // parameter names and response-schema field names — everything needed to
    // wire the list endpoint exactly. Structure only, never data.
    if (String(req.query.docs || "") === "2") {
      const r = await fetch("https://jivetel-txt.jivetel.com/docs/json", { headers: { Accept: "application/json" } });
      const spec = await r.json().catch(() => null);
      if (!spec || !spec.paths) return res.status(200).json({ docs2: true, error: "no spec", status: r.status });
      const paths = Object.entries(spec.paths).map(([p, ops]) => `${Object.keys(ops || {}).join(",").toUpperCase()} ${p}`).sort();
      const interesting = Object.entries(spec.paths)
        .filter(([p]) => /message|conversation|export|history/i.test(p))
        .map(([p, ops]) => {
          const out = { p };
          for (const [m, op] of Object.entries(ops || {})) {
            if (!op || typeof op !== "object") continue;
            out[m] = {
              params: (op.parameters || []).map((x) => `${x.in || ""}:${x.name}${x.required ? "*" : ""}`),
              resp: JSON.stringify((op.responses || {})["200"] || {}).slice(0, 1200),
            };
          }
          return out;
        });
      const schemas = (spec.components && spec.components.schemas) || spec.definitions || {};
      const msgSchemas = Object.entries(schemas)
        .filter(([k]) => /message|conversation/i.test(k))
        .map(([k, v]) => ({ k, props: Object.keys((v && v.properties) || {}).slice(0, 30) }));
      return res.status(200).json({ docs2: true, count: paths.length, interesting, msgSchemas, paths });
    }
    // ?docs=1 — Textable white-label instances serve their API reference at
    // /docs/html; scrape the ROUTE PATTERNS out of it (paths only, no other
    // content) so the real message-list endpoint can be wired without
    // guessing. The first probe's 404s proved the guessed routes wrong.
    if (String(req.query.docs || "") === "1") {
      const found = new Set();
      const tried = [];
      const first = Object.keys(numbers)[0] || "";
      const sfx0 = first.split(" ")[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
      const tok0 = process.env["JIVETEL_TOKEN_" + sfx0] || process.env.JIVETEL_API_TOKEN || "";
      for (const path of ["/docs/html", "/docs", "/api/docs", "/docs/json", "/api"]) {
        try {
          const r = await fetch("https://jivetel-txt.jivetel.com" + path, { headers: { Accept: "text/html,application/json", ...(tok0 ? { Authorization: tok0.includes(" ") ? tok0 : `Bearer ${tok0}` } : {}) } });
          const t = await r.text();
          tried.push({ path, status: r.status, bytes: t.length });
          if (!r.ok) continue;
          (t.match(/(?:GET|POST|PUT|PATCH|DELETE)?\s*\/(?:api|v\d)[a-zA-Z0-9_\/:{}.\-]*/g) || []).forEach((m) => found.add(m.trim().slice(0, 80)));
          (t.match(/"\/[a-zA-Z0-9_\/:{}.\-]{3,60}"/g) || []).forEach((m) => found.add(m.replace(/"/g, "").slice(0, 80)));
        } catch (e) { tried.push({ path, err: String(e.message).slice(0, 60) }); }
      }
      return res.status(200).json({ docs: true, tried, routes: [...found].sort().slice(0, 200) });
    }
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
