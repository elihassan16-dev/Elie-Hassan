// Contractor change-order REQUESTS. Contractors can't write the jobs table
// directly (price data is team-owned), so the portal submits here and we append
// a pending request to the job with the service role. Goldstone approves or
// denies it in the app; approving is what actually changes the price.
import { createClient } from "@supabase/supabase-js";
import { requireAppUser } from "../../lib/showings.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!SERVICE_ROLE) { res.status(503).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY env var." }); return; }
    const { jobId, label, amount, note, requestId } = req.body || {};
    const amt = Number(amount);
    if (!jobId || !amt || (!requestId && !String(label || "").trim())) { res.status(400).json({ error: "A description and amount are required." }); return; }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: u } = await db.from("users").select("name,role,contractor_org_id").eq("id", user.id).maybeSingle();
    const { data: job } = await db.from("contractor_jobs").select("id,org_id,data").eq("id", jobId).maybeSingle();
    if (!job) { res.status(404).json({ error: "Job not found." }); return; }
    const isTeam = u && (u.role === "admin" || u.role === "member");
    const isOrg = u && u.role === "contractor" && String(u.contractor_org_id) === String(job.org_id);
    if (!isTeam && !isOrg) { res.status(403).json({ error: "Not your job." }); return; }

    // Pricing a change order GOLDSTONE asked for (scope came from the team, no
    // price yet): fill in the amount and hand it back as a normal pending request.
    if (requestId) {
      const reqs = (job.data || {}).coRequests || [];
      const target = reqs.find((x) => String(x.id) === String(requestId));
      if (!target) { res.status(404).json({ error: "That change-order request wasn't found." }); return; }
      const updated = reqs.map((x) => String(x.id) === String(requestId) ? { ...x, amount: amt, by: u?.name || user.email || "", pricedAt: new Date().toISOString(), status: "pending" } : x);
      const { error: e2 } = await db.from("contractor_jobs").update({ data: { ...(job.data || {}), coRequests: updated } }).eq("id", job.id);
      if (e2) { res.status(500).json({ error: e2.message }); return; }
      const mid = Date.now();
      await db.from("contractor_messages").insert({
        id: String(mid), org_id: job.org_id,
        data: { id: mid, jobId: job.id, orgId: job.org_id, author: u?.name || "", side: "contractor", text: `🧾 Price for the requested change order: ${target.label} — $${amt.toLocaleString()}`, at: new Date().toISOString(), readBy: [u?.name || ""], taskRefId: `co:${target.id}`, taskRefText: `🧾 ${target.label}` },
      });
      res.status(200).json({ ok: true });
      return;
    }

    const request = { id: Date.now(), label: String(label).trim().slice(0, 200), amount: amt, note: String(note || "").trim().slice(0, 300), by: u?.name || user.email || "", at: new Date().toISOString(), status: "pending" };
    const data = { ...(job.data || {}), coRequests: [...((job.data || {}).coRequests || []), request] };
    const { error } = await db.from("contractor_jobs").update({ data }).eq("id", job.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    // Drop the request into the job's chat thread too (server-side, so it never
    // gets skipped) — it shows in the property conversation on both sides.
    const msgId = request.id + 1;
    await db.from("contractor_messages").insert({
      id: String(msgId),
      org_id: job.org_id,
      data: { id: msgId, jobId: job.id, orgId: job.org_id, author: request.by, side: "contractor", text: `🧾 Change order request: ${request.label} — $${amt.toLocaleString()}${request.note ? `\n${request.note}` : ""}`, at: request.at, readBy: [request.by], taskRefId: `co:${request.id}`, taskRefText: `🧾 ${request.label}` },
    });
    res.status(200).json({ ok: true, request });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
