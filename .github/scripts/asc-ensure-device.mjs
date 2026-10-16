// Apple won't create the development provisioning profile an archive needs
// until the team has at least one registered device ("Your team has no
// devices…"). Brand-new accounts have none, so register one placeholder iPhone
// through the App Store Connect API (only when the team has zero devices).
import crypto from "crypto";

const { ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
const b64u = (x) => Buffer.from(x).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64u(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }));
const body = b64u(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: ASC_KEY_P8.replace(/\\n/g, "\n"), dsaEncoding: "ieee-p1363" });
const auth = { Authorization: `Bearer ${head}.${body}.${b64u(sig)}`, "Content-Type": "application/json" };

const list = await fetch("https://api.appstoreconnect.apple.com/v1/devices?limit=1", { headers: auth });
if (!list.ok) { console.error("Couldn't list devices:", list.status, await list.text()); process.exit(1); }
const have = (await list.json()).data || [];
if (have.length) { console.log(`Team already has a device (${have[0].attributes.name}) — nothing to do.`); process.exit(0); }

const udid = "00008110-" + crypto.randomBytes(8).toString("hex").toUpperCase();
const r = await fetch("https://api.appstoreconnect.apple.com/v1/devices", {
  method: "POST", headers: auth,
  body: JSON.stringify({ data: { type: "devices", attributes: { name: "Build placeholder (CI)", udid, platform: "IOS" } } }),
});
if (!r.ok) { console.error("Couldn't register a device:", r.status, await r.text()); process.exit(1); }
console.log("Registered a placeholder device so signing can proceed.");
