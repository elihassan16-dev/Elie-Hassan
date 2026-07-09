// Server-side team management — runs only in Vercel functions (uses the service role).
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

// Create a new signed-in-able account (email + password). email_confirm:true so
// they can log in right away without an email round-trip. The DB trigger creates the
// public.users profile row; we upsert too so the chosen display name always sticks.
// role "member" (default) = Goldstone team; role "contractor" + contractorOrgId
// = a contractor-portal login scoped to that company.
export async function createTeamMember({ name, email, password, role = "member", contractorOrgId = null }) {
  const client = admin();
  const finalRole = role === "contractor" ? "contractor" : "member";
  if (finalRole === "contractor" && !contractorOrgId) throw new Error("Contractor accounts need a company.");
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { name } : {},
  });
  if (error) throw new Error(error.message);
  const uid = data?.user?.id;
  const finalName = name || email.split("@")[0];
  if (uid) {
    await client.from("users").upsert(
      { id: uid, email, name: finalName, role: finalRole, contractor_org_id: finalRole === "contractor" ? contractorOrgId : null },
      { onConflict: "id" }
    );
  }
  return { id: uid, email, name: finalName, role: finalRole };
}

// Change a user's login email (auth) AND the notification email (users table) in
// one shot. email_confirm:true sets it directly — no confirmation round-trip.
export async function updateUserEmail({ userId, email }) {
  const client = admin();
  const { error } = await client.auth.admin.updateUserById(userId, { email, email_confirm: true });
  if (error) throw new Error(error.message);
  await client.from("users").update({ email }).eq("id", userId);
  return { id: userId, email };
}
