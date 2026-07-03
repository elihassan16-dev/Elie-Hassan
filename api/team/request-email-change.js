// Step 1 of a verified email change: email a 6-digit code to the NEW address.
// Nothing changes yet. We return a signed, stateless token that encodes the new
// email + a hash of the code (never the code itself) so step 2 can verify without
// any database storage. If the new email is mistyped, the code goes nowhere and
// the change can never be confirmed — no lockout.
import crypto from "crypto";
import { requireAppUser } from "../../lib/showings.js";

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || "goldstone-fallback-secret";
const sign = (b64) => crypto.createHmac("sha256", SECRET).update(b64).digest("base64url");

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const email = (body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }

  const RESEND = process.env.RESEND_API_KEY, FROM = process.env.NOTIFY_FROM_EMAIL;
  if (!RESEND || !FROM) { res.status(400).json({ error: "Email isn't set up on the server, so we can't verify a new address yet." }); return; }

  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  const exp = Date.now() + 15 * 60 * 1000;                 // 15-minute window
  const ch = crypto.createHash("sha256").update(code + SECRET).digest("base64url");
  const payloadB64 = Buffer.from(JSON.stringify({ u: user.id, e: email, x: exp, ch })).toString("base64url");
  const token = `${payloadB64}.${sign(payloadB64)}`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: email,
        subject: `Your Goldstone verification code: ${code}`,
        text: `Your Goldstone verification code is ${code}.\n\nEnter it in the app to confirm changing your login email to this address. It expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`,
      }),
    });
    if (!r.ok) { const j = await r.json().catch(() => null); res.status(400).json({ error: `Couldn't send the code: ${(j && (j.message || j.error)) || r.status}` }); return; }
  } catch { res.status(400).json({ error: "Couldn't send the verification email. Try again." }); return; }

  res.status(200).json({ ok: true, token, to: email });
}
