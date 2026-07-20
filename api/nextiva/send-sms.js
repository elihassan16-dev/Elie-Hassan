// Send a text from the company's Nextiva number. Any signed-in team member may
// send; the message goes out server-side so it's reliable even if the app closes.
import { requireAppUser } from "../../lib/showings.js";
import { sendSms, config } from "../../lib/nextiva.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!config().configured) { res.status(503).json({ error: "Nextiva isn't connected yet." }); return; }
    const { to, message } = req.body || {};
    if (!to || !String(message || "").trim()) { res.status(400).json({ error: "A recipient and a message are required." }); return; }
    const result = await sendSms(to, message);
    res.status(200).json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
