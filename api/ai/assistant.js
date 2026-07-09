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
Creating tasks: when the user asks you to create/add tasks, call the propose_tasks tool. Pick the propertyId from the property list by matching the address the user mentions (use "office" only for company work not tied to a property). Write each task short and actionable. For assignee (owner) and delegate use EXACT names from the team list, only when the user says or clearly implies who; otherwise leave them empty. Never make someone both assignee and delegate of the same task. If you can't tell which property they mean, ask instead of guessing.`;

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
      }],
      messages: [...past, { role: "user", content: q.slice(0, 2000) }],
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
    if (!answer && !action) { res.status(502).json({ error: "The AI returned an empty answer — try again." }); return; }
    res.status(200).json({ answer: answer || "Here's the task list — review and add:", action });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `AI request failed: ${e.message || "unknown error"}` });
  }
}
