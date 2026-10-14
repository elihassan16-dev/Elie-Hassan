// "Connect Claude to Goldstone" sign-in page. GET shows the form (same email +
// password as the app); POST checks the login, refuses contractors, and sends
// Claude back with a one-time code (PKCE S256 required).
import { getClient, passwordLogin, activeTeamUser, issueCode } from "../../lib/mcpAuth.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FIELDS = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"];

function page({ params, error, email }) {
  const hidden = FIELDS.map((k) => `<input type="hidden" name="${k}" value="${esc(params[k])}">`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Claude · Goldstone</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F2F2F7;font-family:-apple-system,"SF Pro Text","Inter",system-ui,sans-serif;color:#1C1C1E;padding:16px}
.card{background:#fff;border-radius:22px;box-shadow:0 12px 40px rgba(0,0,0,.12);width:100%;max-width:380px;padding:28px 24px}
.logo{width:52px;height:52px;border-radius:14px;background:#B8912E;color:#fff;font-weight:800;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
h1{font-size:20px;text-align:center;margin:0 0 6px;letter-spacing:-.02em}p{font-size:13.5px;color:#6C6C70;text-align:center;margin:0 0 18px;line-height:1.45}
label{display:block;font-size:12px;font-weight:600;color:#6C6C70;margin:12px 0 5px}
input[type=email],input[type=password]{width:100%;min-height:44px;border-radius:12px;border:1px solid rgba(60,60,67,.2);padding:0 12px;font-size:16px;font-family:inherit;outline:none}
input:focus{border-color:#B8912E}
button{width:100%;min-height:46px;margin-top:18px;border:none;border-radius:23px;background:#B8912E;color:#fff;font-weight:700;font-size:15.5px;font-family:inherit;cursor:pointer}
.err{background:#FFF0EF;color:#C4170C;border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:6px}
.fine{font-size:11.5px;color:#8E8E93;text-align:center;margin-top:14px;line-height:1.45}
</style></head><body><form class="card" method="POST" autocomplete="on">
<div class="logo">G</div><h1>Connect Claude to Goldstone</h1>
<p>Sign in with your Goldstone login. Claude will be able to see your properties and tasks, and do things for you — as you.</p>
${error ? `<div class="err">${esc(error)}</div>` : ""}
${hidden}
<label for="e">Email</label><input id="e" type="email" name="email" value="${esc(email || "")}" autocomplete="username" required autofocus>
<label for="p">Password</label><input id="p" type="password" name="password" autocomplete="current-password" required>
<button type="submit">Sign in &amp; connect</button>
<div class="fine">Texts and emails always need your OK in Claude before they go out. You can disconnect anytime in Claude → Settings → Connectors.</div>
</form></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  const src = req.method === "POST" ? { ...(req.query || {}), ...(req.body || {}) } : (req.query || {});
  const params = Object.fromEntries(FIELDS.map((k) => [k, src[k] ? String(src[k]) : ""]));
  const fail = (code, msg) => res.status(code).setHeader("Content-Type", "text/html; charset=utf-8").send(`<p style="font-family:system-ui;padding:24px">${esc(msg)}</p>`);

  const client = await getClient(params.client_id).catch(() => null);
  if (!client) return fail(400, "Unknown app. Remove the connector in Claude and add it again.");
  if (!client.redirect_uris.includes(params.redirect_uri)) return fail(400, "That return address isn't registered for this app.");
  if ((src.response_type && src.response_type !== "code") || !params.code_challenge || (params.code_challenge_method || "S256") !== "S256") return fail(400, "Unsupported sign-in request.");

  if (req.method !== "POST") {
    return res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(page({ params }));
  }
  const show = (error) => res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(page({ params, error, email: src.email }));
  const login = await passwordLogin(src.email, src.password);
  if (!login.uid) return show(login.error);
  const uid = login.uid;
  const who = await activeTeamUser(uid);
  if (!who) return show("This login can't connect Claude (team accounts only).");
  const code = await issueCode({ uid, clientId: params.client_id, redirectUri: params.redirect_uri, challenge: params.code_challenge, method: "S256" });
  const u = new URL(params.redirect_uri);
  u.searchParams.set("code", code);
  if (params.state) u.searchParams.set("state", params.state);
  res.setHeader("Location", u.toString());
  return res.status(302).end();
}
