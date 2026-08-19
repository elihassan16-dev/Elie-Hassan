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

export const config = { maxDuration: 60 };

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

  const { address, plan, subject, value, comps, mustUse, mustSkip, after } = await readBody(req);

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
