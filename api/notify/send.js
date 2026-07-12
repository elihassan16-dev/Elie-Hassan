// Fan out a notification to teammates via Web Push + email + SMS.
// Called by the client right after it posts a message or assigns a task. The
// caller's Supabase JWT is verified; recipients are given by display name and
// resolved to users (for their push subscriptions + email) with the service role.
// The actual fan-out lives in lib/notify.js, shared with API routes (change
// orders) that must notify reliably even if the caller's device drops.
import { admin, requireAppUser } from "../../lib/quickbooks.js";
import { notifyFanout } from "../../lib/notify.js";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { recipients, title, body, url, tag, toAdmins, toOrg } = await readBody(req);
  if ((!Array.isArray(recipients) || recipients.length === 0) && !toAdmins && !toOrg) { res.status(200).json({ pushed: 0, mailed: 0 }); return; }

  const out = await notifyFanout(admin(), user.id, { recipients, title, body, url, tag, toAdmins: !!toAdmins, toOrg: toOrg || null });
  res.status(200).json(out);
}
