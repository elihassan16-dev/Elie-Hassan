// Shared Jivetel texting helpers — server-side only (service role).
// The conversation store is the same sms_messages table the app has always
// read (so old conversations survive engine changes); these helpers write
// rows in that shape and answer who a signed-in user is.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function e164(n) {
  const d = String(n || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? "+" + d : "";
}

// Store one message row (service role — bypasses RLS; the team reads via RLS).
// Upsert by id: the send endpoint and the inbound webhook can both log the
// same message without doubling it.
export async function storeSms(row) {
  if (!SERVICE_ROLE) return;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  await db.from("sms_messages").upsert(
    { id: String(row.id), phone: row.phone || "", data: row, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
}

// The auth login often has no display name stored — the app's users table
// always does, and it also carries the role (contractors never get the
// business texting/calling lines).
export async function profileOf(userId) {
  try {
    if (!SERVICE_ROLE || !userId) return null;
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data } = await db.from("users").select("name,role").eq("id", userId).maybeSingle();
    return data || null;
  } catch { return null; }
}
