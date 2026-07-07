// Fan out a notification to teammates via Web Push + email.
// Called by the client right after it posts a message or assigns a task. The
// caller's Supabase JWT is verified; recipients are given by display name and
// resolved to users (for their push subscriptions + email) with the service role.
import webpush from "web-push";
import { admin, requireAppUser } from "../../lib/quickbooks.js";

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

  const { recipients, title, body, url, tag } = await readBody(req);
  if (!Array.isArray(recipients) || recipients.length === 0) { res.status(200).json({ pushed: 0, mailed: 0 }); return; }

  const db = admin();
  // Resolve recipient display names -> user rows (id + email). Never notify the
  // sender, and skip anyone an admin has muted.
  const { data: users } = await db.from("users").select("id,email,name,notify_muted,sms_email");
  const wanted = new Set(recipients.map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  const targets = (users || []).filter((u) => u.name && wanted.has(u.name.toLowerCase()) && u.id !== user.id && !u.notify_muted);
  if (targets.length === 0) { res.status(200).json({ pushed: 0, mailed: 0 }); return; }
  const ids = targets.map((u) => u.id);

  const payload = JSON.stringify({ title: title || "Goldstone Properties", body: body || "", url: url || "/", tag: tag || undefined });
  // Relative URLs ("/") are useless outside the app — build an absolute link for
  // the email and SMS channels.
  const base = process.env.APP_URL || "https://gpflips.com";
  const link = url && /^https?:/i.test(url) ? url : `${base}${url && String(url).startsWith("/") ? url : "/"}`;
  let pushed = 0, mailed = 0, texted = 0;

  // ── Web Push ──────────────────────────────────────────────────────────────
  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY, VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    try {
      webpush.setVapidDetails(process.env.NOTIFY_CONTACT || "mailto:elihassan16@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);
      const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", ids);
      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          pushed++;
        } catch (e) {
          // A gone/expired subscription (404/410) is dead — prune it.
          if (e && (e.statusCode === 404 || e.statusCode === 410)) {
            await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }
    } catch (e) { console.error("[notify] push failed:", e.message); }
  }

  // ── Email (Resend) ──────────────────────────────────────────────────────────
  const RESEND = process.env.RESEND_API_KEY, FROM = process.env.NOTIFY_FROM_EMAIL;
  if (RESEND && FROM) {
    const emails = [...new Set(targets.map((u) => u.email).filter(Boolean))];
    for (const to of emails) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM, to, subject: title || "Goldstone Properties", text: (body || "") + `\n\nOpen the app: ${link}` }),
        });
        if (r.ok) mailed++;
      } catch (e) { console.error("[notify] email failed:", e.message); }
    }
  }

  // ── Text message (carrier email→SMS gateways, via the same Resend key) ──────
  // Free but best-effort: carriers throttle these and some (AT&T) have retired
  // their gateway. Keep it short — gateways hard-truncate around 160 chars.
  if (RESEND && FROM) {
    const cells = [...new Set(targets.map((u) => (u.sms_email || "").trim()).filter((x) => x.includes("@")))];
    const sms = `${title || "Goldstone"}: ${body || ""}`.slice(0, 120) + `\n${link}`;
    for (const to of cells) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
          // Gateways render the subject in parens before the body; keep it tiny.
          body: JSON.stringify({ from: FROM, to, subject: "Goldstone", text: sms }),
        });
        if (r.ok) texted++;
      } catch (e) { console.error("[notify] sms failed:", e.message); }
    }
  }

  res.status(200).json({ pushed, mailed, texted });
}
