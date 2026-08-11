// Read-only view of a pinned email chain that lives in a TEAMMATE's mailbox.
// Signed-in team members only (contractors blocked); the server locates the
// thread across the team mailboxes via Graph application permissions and
// returns the messages — view only, no reply/forward/delete surface exists.
import { requireAppUser } from "../../lib/showings.js";
import { profileOf } from "../../lib/jivetel.js";
import { fetchThreadFromAnyMailbox, mailSweepConfigured } from "../../lib/mailsweep.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const user = await requireAppUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const prof = await profileOf(user.id);
  if (prof?.role === "contractor") return res.status(403).json({ error: "Not available on contractor accounts." });
  if (!mailSweepConfigured()) return res.status(200).json({ unavailable: true, messages: [] });
  try {
    const { internetMessageId, conversationId } = req.body || {};
    if (!internetMessageId && !conversationId) return res.status(400).json({ error: "internetMessageId or conversationId required." });
    const r = await fetchThreadFromAnyMailbox({ internetMessageId, conversationId });
    return res.status(200).json(r);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
