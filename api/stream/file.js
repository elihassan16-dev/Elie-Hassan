// Serve a Stream video's MP4 through OUR domain (edge runtime, streamed — no
// size limit). Downloading straight from Cloudflare's customer domain gets
// blocked by browser cross-origin rules on some devices, which dumped users
// onto the raw cloudflarestream.com page instead of saving the file. Fetching
// same-origin always works, and Content-Disposition makes it a real download.
// The uid is a long random id — the same "anyone with the link" exposure the
// video already has (requireSignedURLs is off), so no extra auth here.
export const config = { runtime: "edge" };

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_STREAM_TOKEN = process.env.CF_STREAM_TOKEN;

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const uid = String(searchParams.get("uid") || "").replace(/[^a-zA-Z0-9]/g, "");
  const rawName = String(searchParams.get("name") || "video").replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 80) || "video";
  if (!uid) return new Response(JSON.stringify({ error: "Missing uid." }), { status: 400 });
  if (!CF_ACCOUNT_ID || !CF_STREAM_TOKEN) return new Response(JSON.stringify({ error: "Video service isn't configured." }), { status: 503 });
  const api = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}/downloads`;
  const r = await fetch(api, { headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}` } });
  const j = await r.json().catch(() => ({}));
  const d = j && j.result && j.result.default;
  if (!r.ok || !d || d.status !== "ready" || !d.url) {
    return new Response(JSON.stringify({ error: "The video isn't ready to download yet — try again in a minute." }), { status: 409, headers: { "Content-Type": "application/json" } });
  }
  const vid = await fetch(d.url);
  if (!vid.ok || !vid.body) return new Response(JSON.stringify({ error: `Couldn't fetch the video (${vid.status}).` }), { status: 502 });
  const headers = {
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename="${rawName}.mp4"`,
    "Cache-Control": "no-store",
  };
  const len = vid.headers.get("content-length");
  if (len) headers["Content-Length"] = len;
  return new Response(vid.body, { status: 200, headers });
}
