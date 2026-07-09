// Shared network helpers — used by the main app and the contractor portal.
import { supabase } from "./supabaseClient";

// Authenticated fetch to our serverless API (sends the Supabase JWT). If the token
// has gone stale (server replies 401 "Not signed in"), refresh the session once and
// retry — otherwise an idle PWA can fail even though the user is still logged in.
export async function qbAuthFetch(path, opts = {}) {
  const call = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    // no-store so a refresh always pulls live numbers instead of a stale cached copy.
    return fetch(path, { cache: "no-store", ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  };
  let res = await call();
  if (res.status === 401) {
    try { await supabase.auth.refreshSession(); } catch { /* fall through */ }
    res = await call();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
  return json;
}

// Fire a push + email notification to teammates (by display name). Best-effort:
// never blocks or throws into the UI. The sender is dropped server-side.
// Extra targeting for the contractor portal: {toAdmins:true} notifies every
// Goldstone admin; {toOrg:"<orgId>"} notifies a contractor company's logins.
export async function notify(recipients, { title, body, tag, url, toAdmins, toOrg } = {}) {
  const list = [...new Set((recipients || []).filter(Boolean))];
  if (!list.length && !toAdmins && !toOrg) return;
  try {
    await qbAuthFetch("/api/notify/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: list, title, body, url: url || "/", tag, toAdmins: !!toAdmins, toOrg: toOrg || null }),
    });
  } catch { /* notifications are best-effort */ }
}

// ── Chat attachment upload (Supabase Storage "attachments" bucket) ───────────
export const attachmentKind = (mime = "") => mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
export const sanitizeName = (name = "file") => (name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file").slice(-80);
export async function uploadAttachment(file, folder = "chat") {
  const kind = attachmentKind(file.type || "");
  const base = file.name ? sanitizeName(file.name) : `${kind}.${kind === "audio" ? "webm" : kind === "image" ? "jpg" : "bin"}`;
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, name: file.name || base, mime: file.type || "", kind };
}
