// Send a test notification to the CALLER's own devices — a self-check so a user
// can confirm push (and email) actually arrive without needing a teammate.
import webpush from "web-push";
import { admin, requireAppUser } from "../../lib/quickbooks.js";

export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const db = admin();
  const out = { pushed: 0, mailed: 0, subscriptions: 0, push: "skipped", email: "skipped" };
  const payload = JSON.stringify({
    title: "🔔 Goldstone test",
    body: "Notifications are working. You'll get these when the app is closed.",
    url: "/", tag: "test",
  });

  // ── Web Push to this user's own subscriptions ───────────────────────────────
  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY, VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    out.push = "no-vapid-keys";
  } else {
    const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", user.id);
    out.subscriptions = (subs || []).length;
    if (out.subscriptions === 0) {
      out.push = "no-subscriptions"; // this device never registered — turn on notifications first
    } else {
      webpush.setVapidDetails(process.env.NOTIFY_CONTACT || "mailto:elihassan16@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);
      for (const s of subs) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); out.pushed++; }
        catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint); out.push = `error ${e && e.statusCode || ""}`.trim(); }
      }
      if (out.pushed > 0) out.push = "sent";
    }
  }

  // ── Email to this user ──────────────────────────────────────────────────────
  const RESEND = process.env.RESEND_API_KEY, FROM = process.env.NOTIFY_FROM_EMAIL;
  if (!RESEND || !FROM) { out.email = "not-configured"; }
  else if (user.email) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: user.email, subject: "🔔 Goldstone test notification", text: "This is a test. Email notifications are working." }),
      });
      if (r.ok) { out.mailed = 1; out.email = "sent"; }
      else { const j = await r.json().catch(() => null); out.email = `resend ${r.status}: ${(j && (j.message || j.error || j.name)) || ""}`.trim(); }
    } catch (e) { out.email = "error"; }
  }

  res.status(200).json(out);
}
