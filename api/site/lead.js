// 🌐 "Sell your house to us" form on the public company website (Elie 11/8/26).
// Saves the seller as a New Lead (same shape as the app's mkLead, source
// "Website") and pings the whole team. Public endpoint, so: a hidden honeypot
// field, length limits, and at most one submission per visitor per minute.
import { createClient } from "@supabase/supabase-js";
import { notifyFanout, claimAlert } from "../../lib/notify.js";
import { mkLead } from "../../src/seed.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
const CONDITIONS = ["Move-in ready", "Needs some work", "Needs a lot of work", "Not sure"];
const TIMELINES = ["ASAP", "1–3 months", "3+ months", "Just exploring"];

// "12 Main St, Toms River, NJ 08753" → parts (best effort; the full text is kept in notes).
function splitAddress(full) {
  const parts = full.split(",").map((s) => s.trim()).filter(Boolean);
  const out = { address: parts[0] || full, city: "", state: "NJ", zip: "" };
  const tail = parts.slice(1).join(" ");
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(tail); if (zip) out.zip = zip[1];
  const st = /\b([A-Z]{2})\b/.exec(tail.replace(/\d+/g, "")); if (st) out.state = st[1];
  if (parts[1]) out.city = parts[1].replace(/\b[A-Z]{2}\b/, "").replace(/\d{5}(-\d{4})?/, "").trim();
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!SERVICE_ROLE) { res.status(500).json({ error: "not configured" }); return; }
  const b = (req.body && typeof req.body === "object") ? req.body : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  if (clip(b.website, 200)) { res.status(200).json({ ok: true }); return; } // honeypot: bots fill every field
  const address = clip(b.address, 160), name = clip(b.name, 80), phone = clip(b.phone, 30), email = clip(b.email, 120).toLowerCase();
  const condition = CONDITIONS.includes(b.condition) ? b.condition : "";
  const timeline = TIMELINES.includes(b.timeline) ? b.timeline : "";
  const message = clip(b.message, 2000);
  const digits = phone.replace(/\D/g, "");
  if (address.length < 5) { res.status(400).json({ error: "Please enter the property address." }); return; }
  if (!name) { res.status(400).json({ error: "Please enter your name." }); return; }
  if (digits.length < 10 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: "Please enter a phone number or email so we can reach you." }); return; }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (ip && !(await claimAlert(db, `site-lead:${ip}`, { windowMs: 60000 }))) { res.status(429).json({ error: "Thanks — we already got your request. We'll be in touch shortly." }); return; }

  const now = new Date();
  const when = now.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const a = splitAddress(address);
  const base = mkLead({ address: a.address, city: a.city, state: a.state, zip: a.zip });
  const lead = {
    ...base,
    dateAdded: now.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }),
    notes: [`🌐 From the website (${when})`, `Address as typed: ${address}`, timeline && `Wants to sell: ${timeline}`, message && `Seller says: ${message}`].filter(Boolean).join("\n"),
    info: { ...base.info, sellerName: name, sellerPhone: phone, sellerEmail: email, source: "Website", closingTarget: timeline, condition },
    web: { at: now.toISOString() },
  };
  const { error } = await db.from("leads").insert({ id: String(lead.id), address: lead.address, city: lead.city, state: lead.state, zip: lead.zip, lead_status: "New Leads", data: lead });
  if (error) { console.error("[site/lead] insert failed:", error.message); res.status(500).json({ error: "Something went wrong — please call or email us instead." }); return; }
  try {
    await notifyFanout(db, null, { toTeam: true, title: "🏠 New seller lead from the website", body: `${name} — ${address}${timeline ? ` · ${timeline}` : ""}${condition ? ` · ${condition}` : ""}`, url: "/?goto=leads", tag: `site-lead-${lead.id}` });
  } catch (e) { console.error("[site/lead] notify failed:", e && e.message); }
  res.status(200).json({ ok: true });
}
