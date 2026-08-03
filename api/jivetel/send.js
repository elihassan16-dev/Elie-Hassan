// Send an SMS/MMS through Jivetel's texting platform. Jivetel issues a
// separate API token per number, so each person has their own pair:
//   JIVETEL_NUMBERS      {"Elie":"+1732...","Moshe":"+1...","Esti":"+1..."}
//   JIVETEL_TOKEN_ELIE / JIVETEL_TOKEN_MOSHE / JIVETEL_TOKEN_ESTI
// The person resolves from the signed-in user's first name (or an explicit
// fromName), so everyone texts from their own line with their own key.
// JIVETEL_API_TOKEN remains as a shared fallback. Inert until keys are set.
import { requireAppUser } from "../../lib/showings.js";

export default async function handler(req, res) {
  // Browser-friendly test door, gated by the same server secret as the
  // webhook: GET /api/jivetel/send?key=SECRET&to=7325551234[&fromName=Moshe]
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
    const { to, message, media, fromName } = isTest
      ? { to: req.query.to, message: String(req.query.msg || "Test text from the Goldstone app 🎉"), fromName: req.query.fromName }
      : req.body || {};
    if (!to || !message) return res.status(400).json({ error: "to and message are required." });
    let numbers = {};
    try { numbers = JSON.parse(process.env.JIVETEL_NUMBERS || "{}"); } catch { /* bad JSON → default only */ }
    // Forgiving lookup: "Elie" in JIVETEL_NUMBERS matches a login named
    // "Elie Hassan" (first name, case-insensitive), else email prefix.
    const first = (s) => String(s || "").trim().toLowerCase().split(/[\s@]+/)[0];
    const cands = [fromName, user.user_metadata?.name, user.email].filter(Boolean);
    let person = null;
    for (const c of cands) {
      const hit = numbers[c] != null ? c : Object.keys(numbers).find((k) => first(k) && first(k) === first(c));
      if (hit) { person = hit; break; }
    }
    if (!person) person = Object.keys(numbers).find((k) => numbers[k] === process.env.JIVETEL_FROM_DEFAULT) || Object.keys(numbers)[0] || null;
    const from = (person && numbers[person]) || process.env.JIVETEL_FROM_DEFAULT;
    if (!from) return res.status(503).json({ error: "No from-number configured (JIVETEL_NUMBERS / JIVETEL_FROM_DEFAULT)." });
    const token = (person && process.env["JIVETEL_TOKEN_" + first(person).toUpperCase()]) || process.env.JIVETEL_API_TOKEN;
    if (!token) return res.status(503).json({ error: `Jivetel isn't connected yet — no API key for ${person || "this line"} (JIVETEL_TOKEN_${first(person || "name").toUpperCase()}).` });
    const e164 = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : d.length === 11 && d.startsWith("1") ? "+" + d : String(p || ""); };
    const body = { to: e164(to), from: e164(from), message: String(message) };
    if (Array.isArray(media) && media.length) body.media = media;
    const r = await fetch("https://jivetel-txt.jivetel.com/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token.includes(" ") ? token : `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Jivetel send failed (${r.status})`, detail: text.slice(0, 300) });
    let data = null; try { data = JSON.parse(text); } catch { /* non-JSON OK */ }
    return res.status(200).json({ ok: true, from: body.from, result: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
