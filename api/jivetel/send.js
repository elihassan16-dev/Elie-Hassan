// Send an SMS/MMS through Jivetel's texting platform. Jivetel issues a
// separate API token per number, so each person has their own pair:
//   JIVETEL_NUMBERS      {"Elie":"+1732...","Moshe":"+1...","Esti":"+1..."}
//   JIVETEL_TOKEN_ELIE / JIVETEL_TOKEN_MOSHE / JIVETEL_TOKEN_ESTI
// The person resolves from the signed-in user's first name (or an explicit
// fromName), so everyone texts from their own line with their own key.
// JIVETEL_API_TOKEN remains as a shared fallback.
// GET ?cap=1 (signed-in) answers "is texting set up for me?" for the app.
// Sent messages are logged to the shared sms_messages conversation store.
import { requireAppUser } from "../../lib/showings.js";
import { storeSms, e164, profileOf, firstName, sameFirst } from "../../lib/jivetel.js";

// Who is texting: their JIVETEL_NUMBERS key, from-number, and API token.
function resolveSender(user, fromName, profileName) {
  let numbers = {};
  try { numbers = JSON.parse(process.env.JIVETEL_NUMBERS || "{}"); } catch { /* default only */ }
  const cands = [fromName, user?.user_metadata?.name, profileName, user?.email].filter(Boolean);
  let person = null;
  for (const c of cands) {
    const k = numbers[c] != null ? c : Object.keys(numbers).find((x) => sameFirst(x, c));
    if (k) { person = k; break; }
  }
  const from = (person && numbers[person]) || process.env.JIVETEL_FROM_DEFAULT || Object.values(numbers)[0] || "";
  const sfx = firstName(person || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const token = (sfx && process.env["JIVETEL_TOKEN_" + sfx]) || process.env.JIVETEL_API_TOKEN || "";
  return { person, from, token };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  // Signed-in capability check for the app UI: is texting wired up for ME?
  if (req.method === "GET" && req.query.cap) {
    const user = await requireAppUser(req);
    if (!user) return res.status(401).json({ error: "Sign in first." });
    const prof = await profileOf(user.id);
    if (prof?.role === "contractor") return res.status(200).json({ connected: false, from: "" });
    const { from, token } = resolveSender(user, null, prof?.name);
    const connected = !!(from && token);
    return res.status(200).json({ connected, from: connected ? from : "" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const user = await requireAppUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  try {
    const { to, message, media, fromName } = req.body || {};
    if (!to || !String(message || "").trim()) return res.status(400).json({ error: "to and message are required." });
    const prof = await profileOf(user.id);
    if (prof?.role === "contractor") return res.status(403).json({ error: "The business texting line isn't available on contractor accounts." });
    const { person, from, token } = resolveSender(user, fromName, prof?.name);
    if (!from) return res.status(503).json({ error: "No from-number configured (JIVETEL_NUMBERS / JIVETEL_FROM_DEFAULT)." });
    if (!token) return res.status(503).json({ error: `Texting isn't connected for ${person || "you"} yet.` });
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
    if (data && data.status === false) return res.status(502).json({ error: data.msg || "Jivetel rejected the message.", detail: data });
    // Log it so the conversation thread shows it right away. The inbound
    // webhook may also relay this message later — same id, so it dedupes.
    await storeSms({
      id: String(data?.id || `out-${Date.now()}`),
      phone: body.to,
      direction: "out",
      text: String(message),
      by: prof?.name || user.user_metadata?.name || "",
      from: body.from,
      at: new Date().toISOString(),
      status: "sent",
    }).catch(() => {});
    return res.status(200).json({ ok: true, from: body.from, result: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
