// Place a call through Jivetel's Click2Call: rings the caller's own Jivetel
// phone first, then dials the destination and bridges. Uses portal login
// credentials (separate from the texting tokens):
//   JIVETEL_CALL_HOST   e.g. "https://portal.jivetel.com" (from the API docs)
//   JIVETEL_CALL_USER / JIVETEL_CALL_PASS   portal login
//   JIVETEL_CALL_EXT    extension in "{extension}@{domain}" form
// Ani (the caller ID shown) defaults to the caller's own line from
// JIVETEL_NUMBERS. Inert until the env vars are set.
import { requireAppUser } from "../../lib/showings.js";

export default async function handler(req, res) {
  // Browser test door, gated like the webhook:
  // GET /api/jivetel/call?key=SECRET&to=7325551234
  const isTest = req.method === "GET";
  if (isTest) {
    const secret = process.env.JIVETEL_WEBHOOK_SECRET;
    if (!secret || String(req.query.key || "") !== secret) return res.status(401).json({ error: "bad key" });
  } else if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const user = isTest ? { user_metadata: { name: String(req.query.fromName || "Elie") } } : await requireAppUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  try {
    const { to, fromName } = isTest ? { to: req.query.to, fromName: req.query.fromName } : req.body || {};
    if (!to) return res.status(400).json({ error: "to is required." });
    const host = String(process.env.JIVETEL_CALL_HOST || "").replace(/\/+$/, "");
    const username = process.env.JIVETEL_CALL_USER;
    const password = process.env.JIVETEL_CALL_PASS;
    const ext = process.env.JIVETEL_CALL_EXT;
    if (!host || !username || !password || !ext) {
      const missing = [!host && "JIVETEL_CALL_HOST", !username && "JIVETEL_CALL_USER", !password && "JIVETEL_CALL_PASS", !ext && "JIVETEL_CALL_EXT"].filter(Boolean).join(", ");
      return res.status(503).json({ error: `Calling isn't connected yet (${missing} missing).` });
    }
    let numbers = {};
    try { numbers = JSON.parse(process.env.JIVETEL_NUMBERS || "{}"); } catch { /* default only */ }
    const first = (s) => String(s || "").trim().toLowerCase().split(/[\s@]+/)[0];
    const cands = [fromName, user.user_metadata?.name, user.email].filter(Boolean);
    let ani = process.env.JIVETEL_FROM_DEFAULT || Object.values(numbers)[0] || "";
    for (const c of cands) {
      const k = numbers[c] != null ? c : Object.keys(numbers).find((x) => first(x) && first(x) === first(c));
      if (k) { ani = numbers[k]; break; }
    }
    const digits = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
    const body = {
      Username: username,
      Password: password,
      Extension: ext,
      Destination: digits(to),
      Ani: digits(ani),
      AutoAnswer: false,
      RingAll: true,
      PlaceInQueue: false,
    };
    const r = await fetch(host + "/api/QYLJTLuf3HjzEr2/Click2Call.aspx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Click2Call failed (${r.status})`, detail: text.slice(0, 300) });
    let data = null; try { data = JSON.parse(text); } catch { /* non-JSON OK */ }
    return res.status(200).json({ ok: true, ringing: ext, thenDialing: body.Destination, callerId: body.Ani, result: data ?? text.slice(0, 200) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
