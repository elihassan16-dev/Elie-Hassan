// AI task generation: the user describes what needs to happen ("get 610 Bayview
// ready to list — Esther handles utilities, delegate the lockbox to Moshe") and
// Claude returns a structured task list with assignee/delegate mapped to real team
// members. The client shows the list for review/editing before anything is created.
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

const SYSTEM = `You create task lists for Goldstone Properties, a New Jersey real-estate flipping company. From the instruction, produce clear, actionable tasks — each one short and specific (a few words to one sentence), the way a busy team writes them. Split compound requests into separate tasks. Don't invent work that wasn't asked for or implied.
For assignee (task owner) and delegate (person doing the work), use EXACT full names from the provided team list — only when the instruction says or clearly implies who; otherwise leave them as empty strings. Never assign someone as both assignee and delegate of the same task.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." });
    return;
  }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { instruction, team, context } = await readBody(req);
  const ask = String(instruction || "").trim();
  if (!ask) { res.status(400).json({ error: "Tell the AI what tasks you need first." }); return; }
  const members = (Array.isArray(team) ? team : []).map((m) => String(m)).filter(Boolean);

  const parts = [];
  if (members.length) parts.push(`Team members (use these exact names): ${members.join(", ")}`);
  if (context) parts.push(`Context:\n${String(context).slice(0, 4000)}`);
  parts.push(`Instruction: ${ask.slice(0, 2000)}`);

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      system: SYSTEM,
      tools: [{
        name: "set_tasks",
        description: "Return the generated task list.",
        input_schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "The task itself, short and actionable" },
                  assignee: { type: "string", description: "Exact team-member name who owns the task, or empty string" },
                  delegate: { type: "string", description: "Exact team-member name doing the work (optional), or empty string" },
                },
                required: ["text"],
              },
            },
          },
          required: ["tasks"],
        },
      }],
      tool_choice: { type: "tool", name: "set_tasks" },
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    const tu = (msg.content || []).find((b) => b.type === "tool_use");
    // Only accept names that exist on the team — the model shouldn't invent people.
    const valid = new Set(members);
    const tasks = (tu?.input?.tasks || [])
      .map((t) => ({
        text: String(t.text || "").trim(),
        assignee: valid.has(t.assignee) ? t.assignee : "",
        delegate: valid.has(t.delegate) && t.delegate !== t.assignee ? t.delegate : "",
      }))
      .filter((t) => t.text);
    if (!tasks.length) { res.status(502).json({ error: "The AI didn't produce any tasks — try rephrasing." }); return; }
    res.status(200).json({ tasks });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `AI task generation failed: ${e.message || "unknown error"}` });
  }
}
