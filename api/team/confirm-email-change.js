// Step 2 of a verified email change: check the code against the signed token from
// step 1, then actually switch the login + notification email.
import crypto from "crypto";
import { requireAppUser } from "../../lib/showings.js";
import { updateUserEmail } from "../../lib/team.js";

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || "goldstone-fallback-secret";
const sign = (b64) => crypto.createHmac("sha256", SECRET).update(b64).digest("base64url");
const timingSafeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const token = String(body.token || ""), code = String(body.code || "").trim();
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig || !timingSafeEq(sig, sign(payloadB64))) { res.status(400).json({ error: "This verification link is invalid. Start over." }); return; }

  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")); } catch { res.status(400).json({ error: "Invalid token." }); return; }
  if (payload.u !== user.id) { res.status(403).json({ error: "This code isn't for your account." }); return; }
  if (Date.now() > payload.x) { res.status(400).json({ error: "That code expired. Send a new one." }); return; }

  const ch = crypto.createHash("sha256").update(code + SECRET).digest("base64url");
  if (!timingSafeEq(ch, payload.ch)) { res.status(400).json({ error: "That code isn't right. Check the email and try again." }); return; }

  try {
    const result = await updateUserEmail({ userId: user.id, email: payload.e });
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const msg = /already been registered|already exists|duplicate|registered/i.test(e.message || "")
      ? "That email is already used by another account." : e.message;
    res.status(400).json({ error: msg });
  }
}
