// ARV underwriter: given the subject property, the rehab plan, RentCast's
// value estimate and its sold comps, Claude picks the comps that match the
// post-renovation product, discards the ones that don't, and returns a
// suggested after-repair value with plain-English reasoning. The client
// stores the result on the deal so it's computed once and shared.
import Anthropic from "@anthropic-ai/sdk";
import { requireAppUser } from "../../lib/quickbooks.js";

const SYSTEM = `You are the acquisitions underwriter for a New Jersey house-flipping company. You are given ONE subject property, the owner's renovation plan, an automated value estimate, and numbered comparable sales. Produce a defensible AFTER-REPAIR VALUE (ARV) — the price the house should sell for once the plan is completed.

Rules:
- All comps given are SOLD/off-market sales. A comp's "price" is the deed-recorded closing price when priceSrc="sold", and the OWNER-VERIFIED closing price (checked against the MLS/Zillow) when priceSrc="owner" — treat both as confirmed sales. When priceSrc="list" it is the final LIST price, which in competitive markets often sits a few percent BELOW what the house actually closed for — weigh those slightly upward, and prefer confirmed-price comps when both are available. Judge each: does its price reflect a renovated/updated house comparable to the post-renovation subject? Prefer recent, close, similar-size RENOVATED sales (higher $/sf usually signals updated condition; low $/sf outliers are usually as-is/distressed — skip them).
- SCALE TO THE PLAN. This is critical: the ARV must reflect what the plan actually produces, and different plans on the same house MUST produce different ARVs.
  · Cosmetic/light plans (cleanup, paint, carpets, "fluff") do NOT create a top-of-market house — anchor near the automated as-is estimate with only a modest lift (typically 3-8%), well below the best renovated comps.
  · Mid plans (kitchen OR baths, some systems) land between as-is and the renovated comps.
  · Only a genuine full renovation earns the top renovated-comp range.
- Weigh $/sf of the comps you keep against the subject's square footage (adjust if the plan adds finished space, e.g. finishing a basement).
- ADJUST FOR FEATURES the subject has that typical comps don't (or lacks that they have): pool, garage, fireplace, notably larger/smaller lot. Apply a sensible dollar adjustment for the market and SAY so in the reasoning (e.g. "+$15-20k for the in-ground pool"). The renovation plan text may mention features too — honor it.
- FINISHED-PRODUCT SPECS: when the input includes finishedProduct, the owner is changing the house itself — adding finished square footage, bedrooms or bathrooms. subjectDetails describe the house BEFORE the work; underwrite the FINISHED spec instead: use the finished square footage (record sqft + sqftAdded) for all $/sf math, and judge comps against the finished bed/bath/size, not the records. An addition is worth what the comps say finished space sells for, not what it costs to build. State the finished spec in the reasoning (e.g. "valued at the finished ~2,450 sf with 3 full baths").
- Never invent data. Be conservative: when in doubt, land the ARV in the middle of the credible range, not the top.

Reply with ONLY strict JSON, no prose around it:
{"arv":342000,"low":330000,"high":355000,"psf":228,"reasoning":"2-4 plain sentences a non-technical owner can read","used":[{"i":0,"why":"renovated, 0.3mi, $231/sf"}],"skipped":[{"i":3,"why":"as-is estate sale, $168/sf"}]}
"i" is the comp's index from the input. Every input comp must appear in used or skipped.`;

// Give the MCP underwrite room for tool round-trips to ChatARV.
export const config = { maxDuration: 60 };

// MCP mode: Claude pulls the comps itself from ChatARV's MCP server (MLS
// closed sales) and underwrites in one pass — no REST docs needed.
const SYSTEM_MCP = `You are the acquisitions underwriter for a New Jersey house-flipping company, with ChatARV tools connected (MLS comp data). Work in two steps:
1. Use the available ChatARV tools to pull sold comparables for the subject property's address (run a comp report / comps lookup with the address). Prefer SOLD/closed comps.
2. Underwrite an AFTER-REPAIR VALUE for the subject once the renovation plan is completed, using those comps plus the provided subject details and as-is estimate.

Underwriting rules:
- Prefer recent, close, similar-size RENOVATED closed sales. Low-$/sf outliers are usually as-is/distressed — mark them skipped.
- SCALE TO THE PLAN: cosmetic/light plans anchor near the as-is estimate with a modest lift (3-8%); mid plans land between; only a genuine full renovation earns the top renovated-comp range.
- Adjust for subject features comps don't share (pool, garage, lot) and say so.
- FINISHED-PRODUCT SPECS: when the input includes finishedProduct, the owner is changing the house itself (adding sqft, bedrooms or bathrooms). subjectDetails are the BEFORE records; underwrite the FINISHED spec: use the finished square footage (record + sqftAdded) for $/sf, pull/judge comps against the finished bed/bath/size, and state the finished spec in the reasoning.
- Never invent comps or prices — only use what the tools return. Be conservative.

Reply with ONLY strict JSON, no prose:
{"arv":342000,"low":330000,"high":355000,"psf":228,"reasoning":"2-4 plain sentences","comps":[{"address":"9 Cherry St","price":349900,"listPrice":339000,"date":"2026-06-14","sqft":1512,"beds":3,"baths":2,"distance":0.3,"used":true,"why":"renovated, $231/sf"}]}
comps: every comp the tools returned (max 12), price = SOLD/closing price, listPrice only if known, used true/false with a short why.`;

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { address, plan, subject, value, comps, mustUse, mustSkip, mcp, after } = await readBody(req);

  // Finished-product answers from the questionnaire — sanitized; "keep" answers
  // never reach here, so anything present is a real change to underwrite.
  const numA = (x, max) => { const v = Math.round(parseFloat(String(x ?? "").replace(/[^0-9.]/g, ""))); return v >= 0 && v <= max ? v : 0; };
  const finished = (() => {
    if (!after || typeof after !== "object") return null;
    const out = {};
    if (["light", "mid", "gut"].includes(after.scope)) out.scope = after.scope;
    if (numA(after.sqftAdd, 5000) > 0) out.sqftAdded = numA(after.sqftAdd, 5000);
    if (numA(after.beds, 12) > 0) out.bedsFinished = numA(after.beds, 12);
    if (numA(after.bathsFull, 8) > 0 || numA(after.bathsHalf, 6) > 0) out.bathsFinished = { full: numA(after.bathsFull, 8), half: numA(after.bathsHalf, 6) };
    return Object.keys(out).length ? out : null;
  })();

  // ── MCP mode: Claude pulls MLS comps from ChatARV itself ──
  if (mcp) {
    if (!process.env.CHATARV_API_KEY) { res.status(503).json({ error: "ChatARV key not configured." }); return; }
    if (!address) { res.status(400).json({ error: "Need an address." }); return; }
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "mcp-client-2025-04-04",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 3000,
          system: SYSTEM_MCP,
          messages: [{ role: "user", content: JSON.stringify({ subjectAddress: String(address).slice(0, 140), renovationPlan: String(plan || "standard full renovation").slice(0, 600), subjectDetails: subject || null, ...(finished ? { finishedProduct: finished } : {}), automatedAsIsEstimate: value || null }) }],
          mcp_servers: [{ type: "url", url: "https://www.chatarv.ai/mcp", name: "chatarv", authorization_token: process.env.CHATARV_API_KEY }],
        }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) { res.status(502).json({ error: (data && data.error && data.error.message) || `MCP underwrite failed (${r.status}).` }); return; }
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      let parsed = null;
      try { parsed = JSON.parse(text.replace(/^[\s\S]*?(\{)/, "$1").replace(/\}[^}]*$/, "}")); } catch { /* handled below */ }
      if (!parsed || !Number(parsed.arv) || !Array.isArray(parsed.comps) || !parsed.comps.length) {
        res.status(502).json({ error: "ChatARV connected but the underwrite came back without usable comps — try again, or fall back to records." });
        return;
      }
      const numQ = (x) => { const n2 = parseFloat(String(x ?? "").replace(/[$,]/g, "")); return isNaN(n2) ? 0 : n2; };
      res.status(200).json({
        provider: "ChatARV (MLS)",
        arv: Math.round(Number(parsed.arv)),
        low: Math.round(Number(parsed.low) || Number(parsed.arv)),
        high: Math.round(Number(parsed.high) || Number(parsed.arv)),
        psf: Math.round(Number(parsed.psf) || 0),
        reasoning: String(parsed.reasoning || "").slice(0, 700),
        comps: parsed.comps.slice(0, 12).map((c) => ({
          address: String(c.address || "").split(",").slice(0, 1).join("").slice(0, 80),
          full: String(c.address || "").slice(0, 140),
          price: numQ(c.price), priceSrc: "sold",
          ...(numQ(c.listPrice) ? { listPrice: numQ(c.listPrice) } : {}),
          date: String(c.date || "").slice(0, 10),
          sqft: numQ(c.sqft), beds: numQ(c.beds), baths: numQ(c.baths),
          distance: Math.round(numQ(c.distance) * 100) / 100,
          used: !!c.used, why: String(c.why || "").slice(0, 120),
        })).filter((c) => c.address && c.price > 0),
      });
    } catch (e) {
      res.status(502).json({ error: e.message || "MCP underwrite failed." });
    }
    return;
  }

  const list = (Array.isArray(comps) ? comps : []).slice(0, 12);
  if (!address || !list.length) { res.status(400).json({ error: "Need an address and at least one comp." }); return; }

  // Owner overrides: comps the owner insists on using / excluding (by index).
  // These are ORDERS — the model recomputes the ARV around the owner's set.
  const ints = (a) => (Array.isArray(a) ? a : []).filter((x) => Number.isInteger(x) && x >= 0 && x < list.length).slice(0, 12);
  const forceUse = ints(mustUse), forceSkip = ints(mustSkip);
  const payload = {
    subject: { address: String(address).slice(0, 120), ...(subject || {}) },
    renovationPlan: String(plan || "standard full renovation").slice(0, 600),
    ...(finished ? { finishedProduct: finished } : {}),
    automatedEstimateAsIs: value || null,
    ...(forceUse.length || forceSkip.length ? { ownerOverrides: { mustUse: forceUse, mustSkip: forceSkip, note: "The owner has reviewed the comps. mustUse comps MUST appear in used; mustSkip comps MUST appear in skipped. Recompute the ARV around this comp set and say in the reasoning how the owner's picks moved the number." } } : {}),
    comps: list.map((c, i) => ({ i, ...c })),
  };
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed = null;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); } catch { /* handled below */ }
    if (!parsed || !Number(parsed.arv)) { res.status(502).json({ error: "The underwriter couldn't produce a number — try again." }); return; }
    const clean = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && Number.isInteger(x.i)).map((x) => ({ i: x.i, why: String(x.why || "").slice(0, 120) }));
    // Enforce the owner's overrides even if the model drifted.
    const usedArr = clean(parsed.used), skipArr = clean(parsed.skipped);
    forceUse.forEach((i) => {
      const at = skipArr.findIndex((x) => x.i === i); if (at >= 0) skipArr.splice(at, 1);
      if (!usedArr.some((x) => x.i === i)) usedArr.push({ i, why: "owner's pick" });
    });
    forceSkip.forEach((i) => {
      const at = usedArr.findIndex((x) => x.i === i); if (at >= 0) usedArr.splice(at, 1);
      if (!skipArr.some((x) => x.i === i)) skipArr.push({ i, why: "excluded by owner" });
    });
    res.status(200).json({
      arv: Math.round(Number(parsed.arv)),
      low: Math.round(Number(parsed.low) || Number(parsed.arv)),
      high: Math.round(Number(parsed.high) || Number(parsed.arv)),
      psf: Math.round(Number(parsed.psf) || 0),
      reasoning: String(parsed.reasoning || "").slice(0, 700),
      used: usedArr,
      skipped: skipArr,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Underwrite failed." });
  }
}
