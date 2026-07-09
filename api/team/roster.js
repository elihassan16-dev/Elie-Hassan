// Team roster NAMES only — safe for contractor logins (they can't read the users
// table directly). Used by the portal's "who are you asking?" picker so a request
// can be aimed at a specific Goldstone person. No emails/roles/ids leave here.
import { createClient } from "@supabase/supabase-js";
import { requireAppUser } from "../../lib/showings.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!SERVICE_ROLE) { res.status(503).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY env var." }); return; }
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data } = await db.from("users").select("name,role").in("role", ["admin", "member"]).order("name");
    res.status(200).json({ names: (data || []).map((u) => u.name).filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
