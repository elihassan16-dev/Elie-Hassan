// Global AI assistant: answers questions across the WHOLE portfolio (the client
// sends a slim JSON snapshot of every active property + contacts + team) and can
// PROPOSE task lists ("create tasks for 610 Bayview: ...") via a tool call. The
// server never writes anything — proposed tasks go back to the client, which shows
// them for review and creates them only when the user taps Add.
import Anthropic from "@anthropic-ai/sdk";
import { requireAppUser } from "../../lib/quickbooks.js";

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

const SYSTEM = `You are the AI assistant for Goldstone Properties, a New Jersey real-estate flipping company. You can see the whole portfolio: every property (info, financials, computed profit, tasks, buyer) plus the contact directory and the team.
Answering questions: use ONLY the data provided. Be direct and brief — lead with the answer (a code, a number, a name, a phone number), then at most a sentence of context. Format money as dollars. If the data doesn't contain the answer, say plainly it isn't in the records — never guess or invent figures.
Creating tasks: when the user asks you to create/add tasks, call the propose_tasks tool. Pick the propertyId from the property list by matching the address the user mentions (use "office" only for company work not tied to a property). Write each task short and actionable. For assignee (owner) and delegate use EXACT names from the team list, only when the user says or clearly implies who; otherwise leave them empty. Never make someone both assignee and delegate of the same task. If you can't tell which property they mean, ask instead of guessing.
Creating leads: when the user pastes deal info (a text, email, or blast from a wholesaler/agent) and asks to make a lead, call the propose_lead tool. Extract ONLY facts actually present — leave every unknown field as an empty string, never infer or pad. Ignore marketing fluff, greetings, and disclaimers. Number fields (askingPrice, beds, baths, sqft, yearBuilt): digits only, no $ signs or commas. Put genuinely useful extras that don't fit a field (claimed ARV, rehab estimate, occupancy, access/showing instructions, deadline pressure) into notes as short plain lines. If a lead for that address already exists in the data, say so instead of proposing a duplicate. If there's no address at all, ask for it.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." });
    return;
  }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { question, history, context, team, propIndex } = await readBody(req);
  const q = String(question || "").trim();
  if (!q) { res.status(400).json({ error: "Ask something first." }); return; }
  const members = (Array.isArray(team) ? team : []).map((m) => String(m)).filter(Boolean);
  // id -> address map for validating the tool's property pick.
  const index = new Map((Array.isArray(propIndex) ? propIndex : []).map((p) => [String(p.id), String(p.address || "")]));

  const past = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      system: `${SYSTEM}\n\nTEAM MEMBERS: ${members.join(", ") || "(none)"}\n\nPORTFOLIO DATA (JSON):\n${String(context || "{}").slice(0, 180000)}`,
      tools: [{
        name: "propose_tasks",
        description: "Propose a task list for the user to review and add. Nothing is created until the user confirms in the app.",
        input_schema: {
          type: "object",
          properties: {
            propertyId: { type: "string", description: "The id of the property these tasks belong to (from the property list), or \"office\" for company tasks not tied to a property" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "The task itself, short and actionable" },
                  assignee: { type: "string", description: "Exact team-member name who owns it, or empty string" },
                  delegate: { type: "string", description: "Exact team-member name doing the work (optional), or empty string" },
                },
                required: ["text"],
              },
            },
          },
          required: ["propertyId", "tasks"],
        },
      }, {
        name: "propose_lead",
        description: "Propose a new lead extracted from pasted deal info, for the user to review and create. Nothing is created until the user confirms in the app.",
        input_schema: {
          type: "object",
          properties: {
            address: { type: "string", description: "Street address (required)" },
            city: { type: "string" },
            state: { type: "string", description: "Two-letter state, default NJ if clearly a NJ deal, else empty" },
            zip: { type: "string" },
            sellerName: { type: "string", description: "Seller or the person offering the deal" },
            sellerPhone: { type: "string" },
            sellerEmail: { type: "string" },
            source: { type: "string", description: "Where the lead came from, e.g. wholesaler name/company, 'text blast'" },
            askingPrice: { type: "string", description: "Digits only" },
            closingTarget: { type: "string", description: "Requested/target closing timeframe if stated" },
            type: { type: "string", description: "Property type, e.g. Single Family, Duplex" },
            beds: { type: "string", description: "Digits only" },
            baths: { type: "string", description: "Digits only" },
            sqft: { type: "string", description: "Digits only" },
            yearBuilt: { type: "string", description: "Digits only" },
            condition: { type: "string", description: "Stated condition, short" },
            notes: { type: "string", description: "Useful extras that fit no field (ARV claim, rehab estimate, occupancy, access), short plain lines" },
          },
          required: ["address"],
        },
      }],
      // Generous cap — pasted deal blasts (texts/emails) can run long.
      messages: [...past, { role: "user", content: q.slice(0, 12000) }],
    });

    const answer = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const tu = (msg.content || []).find((b) => b.type === "tool_use" && b.name === "propose_tasks");
    let action = null;
    if (tu) {
      const pid = String(tu.input?.propertyId || "");
      const okProp = pid === "office" || index.has(pid);
      const valid = new Set(members);
      const tasks = (tu.input?.tasks || [])
        .map((t) => ({
          text: String(t.text || "").trim(),
          assignee: valid.has(t.assignee) ? t.assignee : "",
          delegate: valid.has(t.delegate) && t.delegate !== t.assignee ? t.delegate : "",
        }))
        .filter((t) => t.text);
      if (okProp && tasks.length) {
        action = { type: "tasks", propertyId: pid, propertyAddress: pid === "office" ? "Office / company tasks" : index.get(pid), tasks };
      }
    }
    const lu = (msg.content || []).find((b) => b.type === "tool_use" && b.name === "propose_lead");
    if (!action && lu) {
      const s = (v) => String(v ?? "").trim();
      const digits = (v) => s(v).replace(/[^0-9.]/g, "");
      const lead = {
        address: s(lu.input?.address), city: s(lu.input?.city), state: s(lu.input?.state).toUpperCase().slice(0, 2), zip: s(lu.input?.zip),
        sellerName: s(lu.input?.sellerName), sellerPhone: s(lu.input?.sellerPhone), sellerEmail: s(lu.input?.sellerEmail),
        source: s(lu.input?.source), askingPrice: digits(lu.input?.askingPrice), closingTarget: s(lu.input?.closingTarget),
        type: s(lu.input?.type), beds: digits(lu.input?.beds), baths: digits(lu.input?.baths), sqft: digits(lu.input?.sqft),
        yearBuilt: digits(lu.input?.yearBuilt), condition: s(lu.input?.condition), notes: s(lu.input?.notes),
      };
      if (lead.address) action = { type: "lead", lead };
    }
    if (!answer && !action) { res.status(502).json({ error: "The AI returned an empty answer — try again." }); return; }
    res.status(200).json({ answer: answer || (action?.type === "lead" ? "Here's the lead I pulled out — review and create:" : "Here's the task list — review and add:"), action });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `AI request failed: ${e.message || "unknown error"}` });
  }
}
