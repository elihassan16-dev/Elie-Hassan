// Native push for the iPhone / Android app (Elie 10/16/26). The app saves its
// device token in push_subscriptions as endpoint "apns:<token>" (iPhone) or
// "fcm:<token>" (Android); notifyFanout sends those here instead of web push.
//
// Vercel env vars (nothing is sent until they exist — the website is unaffected):
//   iPhone  — APNS_KEY (the .p8 key's text), APNS_KEY_ID, APNS_TEAM_ID,
//             APNS_BUNDLE_ID (default com.gpflips.app)
//   Android — FCM_SERVICE_ACCOUNT (the Firebase service-account JSON)
import crypto from "crypto";
import http2 from "http2";

const b64u = (b) => Buffer.from(b).toString("base64url");
const pem = (s) => String(s || "").replace(/\\n/g, "\n").trim();

// ── Apple (APNs, token auth) ─────────────────────────────────────────────────
let apnsJwt = { tok: "", at: 0 };
function apnsToken() {
  if (apnsJwt.tok && Date.now() - apnsJwt.at < 45 * 60000) return apnsJwt.tok;
  const head = b64u(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }));
  const claims = b64u(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${claims}`), { key: pem(process.env.APNS_KEY), dsaEncoding: "ieee-p1363" });
  apnsJwt = { tok: `${head}.${claims}.${b64u(sig)}`, at: Date.now() };
  return apnsJwt.tok;
}
function apnsSend(host, token, payload, tag) {
  return new Promise((resolve) => {
    let client;
    try { client = http2.connect(`https://${host}`); } catch (e) { resolve({ status: 0, reason: e.message }); return; }
    client.on("error", (e) => resolve({ status: 0, reason: e.message }));
    const req = client.request({
      ":method": "POST", ":path": `/3/device/${token}`,
      authorization: `bearer ${apnsToken()}`,
      "apns-topic": process.env.APNS_BUNDLE_ID || "com.gpflips.app",
      "apns-push-type": "alert", "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 86400),
      ...(tag ? { "apns-collapse-id": String(tag).slice(0, 64) } : {}),
      "content-type": "application/json",
    });
    let status = 0, data = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (c) => { data += c; });
    req.on("end", () => { client.close(); let reason = ""; try { reason = JSON.parse(data || "{}").reason || ""; } catch { /* empty */ } resolve({ status, reason }); });
    req.on("error", (e) => { client.close(); resolve({ status: 0, reason: e.message }); });
    req.setTimeout(10000, () => { req.close(); client.close(); resolve({ status: 0, reason: "timeout" }); });
    req.end(JSON.stringify(payload));
  });
}
async function sendApns(token, { title, body, url, tag, badge }) {
  if (!process.env.APNS_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID) return { ok: false, skipped: true };
  const payload = { aps: { alert: { title: title || "Goldstone Properties", body: body || "" }, sound: "default", ...(Number.isFinite(badge) ? { badge } : {}), ...(tag ? { "thread-id": String(tag).slice(0, 64) } : {}) }, url: url || "/" };
  // App Store / TestFlight builds use production; a build run straight from
  // Xcode uses the sandbox — try production first, then the sandbox.
  let r = await apnsSend("api.push.apple.com", token, payload, tag);
  if (r.status === 400 && r.reason === "BadDeviceToken") r = await apnsSend("api.sandbox.push.apple.com", token, payload, tag);
  const gone = r.status === 410 || (r.status === 400 && (r.reason === "BadDeviceToken" || r.reason === "DeviceTokenNotForTopic"));
  return { ok: r.status === 200, gone, reason: r.reason };
}

// ── Google (FCM HTTP v1) ─────────────────────────────────────────────────────
let fcmAuth = { tok: "", exp: 0 };
function fcmAccount() { try { return JSON.parse(process.env.FCM_SERVICE_ACCOUNT || ""); } catch { return null; } }
async function fcmAccessToken(sa) {
  if (fcmAuth.tok && Date.now() < fcmAuth.exp - 60000) return fcmAuth.tok;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claims}`), pem(sa.private_key));
  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64u(sig)}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`FCM auth failed (${r.status})`);
  fcmAuth = { tok: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return fcmAuth.tok;
}
async function sendFcm(token, { title, body, url, tag, badge }) {
  const sa = fcmAccount();
  if (!sa || !sa.project_id) return { ok: false, skipped: true };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await fcmAccessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      notification: { title: title || "Goldstone Properties", body: body || "" },
      data: { url: url || "/", ...(tag ? { tag: String(tag) } : {}) },
      android: { priority: "high", ttl: "86400s", notification: { channel_id: "messages", sound: "default", ...(Number.isFinite(badge) ? { notification_count: badge } : {}), ...(tag ? { tag: String(tag).slice(0, 64) } : {}) } },
    } }),
  });
  if (r.ok) return { ok: true };
  const j = await r.json().catch(() => ({}));
  const code = (j.error && (j.error.status || "")) + " " + JSON.stringify((j.error && j.error.details) || []);
  const gone = r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(code);
  return { ok: false, gone, reason: code.trim() };
}

export const isNativeSub = (endpoint) => /^(apns|fcm):/.test(String(endpoint || ""));

// → {ok, gone, skipped}. gone = the app was uninstalled / token is dead → prune it.
export async function sendNative(sub, msg) {
  const ep = String(sub.endpoint || "");
  try {
    if (ep.startsWith("apns:")) return await sendApns(ep.slice(5), msg);
    if (ep.startsWith("fcm:")) return await sendFcm(ep.slice(4), msg);
  } catch (e) { return { ok: false, reason: e.message }; }
  return { ok: false };
}
