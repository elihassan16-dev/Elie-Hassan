// Shared notification fan-out: Web Push + email + SMS. Used by /api/notify/send
// (client-triggered pings) and called directly by API routes whose notification
// must never be lost — e.g. change orders, where the old client-side ping died
// silently if the contractor's app closed right after submitting.
import webpush from "web-push";

// db: a service-role Supabase client. senderId: excluded from targets.
// Targeting: recipients (display names), toAdmins, or toOrg — same as the API.
export async function notifyFanout(db, senderId, { recipients = [], toAdmins = false, toOrg = null, title, body, url, tag } = {}) {
  const { data: users } = await db.from("users").select("id,email,name,role,contractor_org_id,notify_muted,sms_email");
  let targets;
  if (toAdmins) {
    targets = (users || []).filter((u) => u.role === "admin" && u.id !== senderId && !u.notify_muted);
  } else if (toOrg) {
    targets = (users || []).filter((u) => u.contractor_org_id === toOrg && u.id !== senderId && !u.notify_muted);
    // Per-job crew: a job ping (its url deep-links to the job) restricted to
    // some of the company's people only notifies those people.
    const m = /[?&]goto=job:([^&]+)/.exec(url || "");
    if (m && targets.length) {
      try {
        const { data: jrow } = await db.from("contractor_jobs").select("data").eq("id", decodeURIComponent(m[1])).maybeSingle();
        const crew = jrow && jrow.data ? jrow.data.crew : null;
        if (Array.isArray(crew) && crew.length) targets = targets.filter((u) => crew.includes(u.id));
      } catch { /* best-effort — fall back to the whole company */ }
    }
  } else {
    const wanted = new Set((recipients || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
    targets = (users || []).filter((u) => u.name && wanted.has(u.name.toLowerCase()) && u.id !== senderId && !u.notify_muted);
  }
  if (!targets.length) return { pushed: 0, mailed: 0, texted: 0 };
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
        // Every notification email shares one subject and a stable References
        // anchor (per recipient), so mail clients — Gmail especially — thread
        // them into a single "Goldstone Updates" conversation instead of
        // scattering one email per ping. The real notification moves to the body.
        const anchor = `<goldstone-notify-${String(to).toLowerCase().replace(/[^a-z0-9@.\-_+]/g, "")}@gpflips.com>`;
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM, to,
            subject: "Goldstone Updates",
            text: `${title || "Goldstone Properties"}\n${body || ""}\n\nOpen the app: ${link}`,
            headers: { "In-Reply-To": anchor, "References": anchor },
          }),
        });
        if (r.ok) mailed++;
      } catch (e) { console.error("[notify] email failed:", e.message); }
    }
  }

  // ── Text message ─────────────────────────────────────────────────────────────
  // Preferred transport: a Zapier Catch-Hook that feeds Nextiva's "Send an SMS"
  // action — real SMS from the office number (already 10DLC-registered), immune to
  // the carrier filtering that eats email-gateway texts. Set ZAPIER_SMS_HOOK_URL
  // in Vercel to turn it on. The 10-digit number is parsed off users.sms_email
  // (the part before the @), so the in-app 📱 editor keeps working unchanged.
  const ZAP = process.env.ZAPIER_SMS_HOOK_URL;
  if (ZAP) {
    const nums = [...new Set(targets.map((u) => String(u.sms_email || "").split("@")[0].replace(/\D/g, "")).filter((d) => d.length === 10))];
    const sms = `${title || "Goldstone"}: ${body || ""}`.slice(0, 130) + `\n${link}`;
    for (const num of nums) {
      try {
        const r = await fetch(ZAP, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: `+1${num}`, message: sms }),
        });
        if (r.ok) texted++;
      } catch (e) { console.error("[notify] zapier sms failed:", e.message); }
    }
  }
  // Fallback transport: carrier email→SMS gateways via the same Resend key.
  // Free but best-effort: carriers throttle these and some (AT&T) have retired
  // their gateway. Keep it short — gateways hard-truncate around 160 chars — and
  // link-free: URLs (especially https://) are the top reason gateways silently
  // spam-drop these, so mention the bare domain in words instead.
  else if (RESEND && FROM) {
    const cells = [...new Set(targets.map((u) => (u.sms_email || "").trim()).filter((x) => x.includes("@")))];
    const domain = base.replace(/^https?:\/\//i, "");
    const sms = `${title || "Goldstone"}: ${body || ""}`.slice(0, 110) + ` - open ${domain}`;
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

  return { pushed, mailed, texted };
}
