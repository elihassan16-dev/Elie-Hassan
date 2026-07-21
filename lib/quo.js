// Quo (formerly OpenPhone) business texting. Server-side only — the API key
// lives in Vercel env vars and never reaches the browser.
//
//   OPENPHONE_API_KEY      from Quo: Settings -> API -> generate key
//   OPENPHONE_FROM_NUMBER  the company texting number, E.164 (+17325551234)
//   QUO_WEBHOOK_TOKEN      any long random string — protects the reply webhook URL
//
// Until these are set the integration reports "not connected" and nothing in
// the live app changes.
import { createClient } from "@supabase/supabase-js";

const API = "https://api.openphone.com/v1";

export function config() {
  const e = process.env;
  const key = e.OPENPHONE_API_KEY || e.QUO_API_KEY || "";
  const from = e.OPENPHONE_FROM_NUMBER || e.QUO_FROM_NUMBER || "";
  return { key, from, webhookToken: e.QUO_WEBHOOK_TOKEN || "", configured: !!(key && from) };
}

export function e164(n) {
  const d = String(n || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? "+" + d : "";
}

async function quoFetch(path, opts = {}) {
  const { key } = config();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: key, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.message || j?.errors?.[0]?.message || `Quo request failed (${res.status}).`);
  return j;
}

// Send one text from the company number. Returns Quo's message object.
export async function sendSms(to, message) {
  const cfg = config();
  if (!cfg.configured) throw new Error("Texting isn't connected yet.");
  const j = await quoFetch("/messages", {
    method: "POST",
    body: JSON.stringify({ content: String(message || ""), from: cfg.from, to: [e164(to)] }),
  });
  return j.data || j;
}

// Register our reply webhook with Quo (run once from the app, admin-only).
export async function createWebhook(appOrigin) {
  const cfg = config();
  if (!cfg.configured) throw new Error("Texting isn't connected yet.");
  if (!cfg.webhookToken) throw new Error("Set QUO_WEBHOOK_TOKEN first (any long random string).");
  const url = `${appOrigin}/api/texting/webhook?token=${encodeURIComponent(cfg.webhookToken)}`;
  const j = await quoFetch("/webhooks/messages", {
    method: "POST",
    body: JSON.stringify({ url, events: ["message.received", "message.delivered"], label: "Goldstone app" }),
  });
  return j.data || j;
}

// Store a message row (service role — bypasses RLS; the team reads via RLS).
export async function storeSms(row) {
  const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE) return;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  await db.from("sms_messages").upsert(
    { id: String(row.id), phone: row.phone || "", data: row, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
}
