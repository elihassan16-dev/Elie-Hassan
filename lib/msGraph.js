// Microsoft Graph with the app's APPLICATION permissions (client credentials —
// the same Azure app + AZURE_CLIENT_SECRET the 24/7 email sweeper uses).
// Used by the Claude connector to search/read/send the CONNECTED teammate's
// own mailbox and to read/write property folders in OneDrive/SharePoint.
// The connector only ever passes the signed-in teammate's own mailbox.
// Needs (Azure → App registrations → this app → API permissions → Microsoft
// Graph → Application, then "Grant admin consent"): Mail.Read (sweeper),
// Mail.ReadWrite + Mail.Send (send/reply with attachments), Files.ReadWrite.All
// (property folders).
const TENANT = process.env.AZURE_TENANT_ID || "377dbf92-fa58-4e25-bd42-f96116751c69";
const CLIENT = process.env.AZURE_CLIENT_ID || "8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff";
const GRAPH = "https://graph.microsoft.com/v1.0";

export const graphConfigured = () => !!process.env.AZURE_CLIENT_SECRET;

let tok = null;
async function appToken() {
  if (tok && tok.exp > Date.now() + 60000) return tok.access_token;
  const secret = process.env.AZURE_CLIENT_SECRET || "";
  if (!secret) throw Object.assign(new Error("Microsoft isn't connected on the server (AZURE_CLIENT_SECRET missing in Vercel)."), { setup: true });
  const body = new URLSearchParams({ client_id: CLIENT, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw Object.assign(new Error(d.error_description || `Microsoft sign-in failed (${r.status})`), { setup: true });
  tok = { access_token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return tok.access_token;
}

// graph(method, path, body?, {raw, headers}) → JSON (or raw Response when raw).
export async function graph(method, path, body, opts = {}) {
  const token = await appToken();
  const isBuf = body && (Buffer.isBuffer(body) || body instanceof Uint8Array);
  const r = await fetch(path.startsWith("http") ? path : GRAPH + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !isBuf ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) },
    ...(body ? { body: isBuf ? body : JSON.stringify(body) } : {}),
  });
  if (opts.raw) return r;
  if (r.status === 202 || r.status === 204) return {};
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || `Microsoft ${r.status}`;
    const err = new Error(msg); err.status = r.status;
    if (r.status === 403 || /Access is denied|Authorization_RequestDenied|insufficient privileges/i.test(msg)) err.permission = true;
    throw err;
  }
  return j || {};
}

// Upload bytes into a folder (small → simple PUT, big → upload session). Returns the driveItem.
export async function uploadToFolder(driveId, parentId, name, buf) {
  const safe = String(name || "file").replace(/[\\/:*?"<>|#%]+/g, "-").slice(0, 180);
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(safe)}:`;
  if (buf.length <= 3.5 * 1024 * 1024) {
    return graph("PUT", `${base}/content?@microsoft.graph.conflictBehavior=rename`, buf, { headers: { "Content-Type": "application/octet-stream" } });
  }
  const sess = await graph("POST", `${base}/createUploadSession`, { item: { "@microsoft.graph.conflictBehavior": "rename" } });
  const CH = 5 * 320 * 1024 * 4; // ~6.5 MB, multiple of 320 KiB
  let last = null;
  for (let i = 0; i < buf.length; i += CH) {
    const part = buf.subarray(i, Math.min(i + CH, buf.length));
    const r = await fetch(sess.uploadUrl, { method: "PUT", headers: { "Content-Length": String(part.length), "Content-Range": `bytes ${i}-${i + part.length - 1}/${buf.length}` }, body: part });
    if (!r.ok && r.status !== 202) throw new Error(`Upload failed (${r.status})`);
    last = await r.json().catch(() => null);
  }
  return last || {};
}

// Plain text (with line breaks) → simple, safe email HTML.
export const textToHtml = (s) => `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>")}</div>`;
// Email HTML → readable text (bounded).
export const htmlToText = (h) => String(h || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
