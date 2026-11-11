// ⚖️ Attorney Review watch (Elie 11/11/26). A property in "Attorney Review"
// that hasn't moved on to In Closing after 2 BUSINESS days gets ONE urgent
// task on the property — "Get <address> out of attorney review" — that is
// everyone's task (t.team, no single assignee) + a push to the whole team.
// When the status changes (In Closing, back On Market…) the open task closes
// itself. Runs on the showing-watcher heartbeat (api/showings/watch.js, GitHub
// Actions every few minutes), throttled to one real check per 10 minutes.
//   p.arSince — when we first saw it in Attorney Review (cleared when it leaves)
import { admin } from "./mcpAuth.js";
import { notifyFanout, claimAlert } from "./notify.js";

const AR = "Attorney Review";
const NY = "America/New_York";
const nyParts = (ms) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
const isWeekend = (ms) => /Sat|Sun/.test(nyParts(ms).weekday);

// The moment `n` business days (Mon–Fri, New York) have passed since `sinceMs`.
// A Friday-afternoon start is due Tuesday afternoon; a Saturday start counts
// from Monday morning's business day (due Wednesday at the same clock time).
export function businessDue(sinceMs, n = 2) {
  let t = sinceMs, left = n;
  while (isWeekend(t)) t += 86400000; // a weekend start counts from Monday
  while (left > 0) { t += 86400000; if (!isWeekend(t)) left--; }
  return t;
}
const addrOf = (p) => [p.address, p.city].filter(Boolean).join(", ");
const isDone = (t) => t && (t.status === "Completed" || t.status === "N/A");

export async function checkAttorneyReview({ force = false, db: dbIn = null, notify = notifyFanout } = {}) {
  const db = dbIn || admin();
  if (!force && !(await claimAlert(db, "attorney_review_check", { windowMs: 10 * 60000 }))) return { skipped: true };
  const { data, error } = await db.from("properties").select("id,data");
  if (error) return { error: error.message };
  const now = Date.now(), out = { checked: 0, started: 0, flagged: 0, closed: 0 };
  for (const row of data || []) {
    const p = row.data;
    if (!p || p.archived || p.deleted) continue;
    const inAR = p.status === AR;
    const openTask = (p.tasks || []).find((t) => t && !t.deleted && t.arWatch && !isDone(t));
    if (!inAR && !p.arSince && !openTask) continue;
    out.checked++;
    let pushed = null;
    const next = await save(db, row.id, (x) => {
      const nx = { ...x };
      if (x.status !== AR) {
        // Left attorney review: stop the clock + close its escalation task.
        delete nx.arSince;
        nx.tasks = (x.tasks || []).map((t) => (t && t.arWatch && !t.deleted && !isDone(t)
          ? { ...t, status: "Completed", completedAt: new Date().toISOString(), completedBy: "Auto", autoDoneWhy: `Status changed to ${x.status || "another status"}`, urgent: false }
          : t));
        return nx;
      }
      const gateAt = Date.parse(((x.statusGates || {})[AR] || {}).at || "");
      const since = Date.parse(x.arSince || "") || (isFinite(gateAt) ? gateAt : now);
      if (!x.arSince) nx.arSince = new Date(since).toISOString();
      if (now < businessDue(since, 2)) return nx;
      const key = `arWatch:${new Date(since).toISOString().slice(0, 16)}`;
      if ((x.tasks || []).some((t) => t && t.autoId === key)) return nx; // already raised for this stretch
      const id = since + 7; // deterministic per stretch, so two checks can't add two
      const task = {
        id, text: `Get ${x.address || "this property"} out of attorney review`,
        status: "Not Started", assignee: "", delegate: "", team: true, cat: "Custom",
        autoId: key, arWatch: true, assignedAt: now, assignedBy: "Auto",
        urgent: true, urgentAt: now, urgentBy: "Auto",
      };
      nx.tasks = [...(x.tasks || []), task];
      pushed = task;
      return nx;
    });
    if (next && inAR && !p.arSince) out.started++;
    if (pushed) {
      out.flagged++;
      try {
        await notify(db, null, {
          toTeam: true,
          title: "🚨 URGENT — still in attorney review",
          body: `${addrOf(next)} has been in Attorney Review for 2 business days. Get it to In Closing.`,
          url: `/?goto=task:${p.id}:${pushed.id}`,
          tag: `arwatch-${p.id}`,
        });
      } catch { /* the task is there either way */ }
    }
    if (!inAR && openTask) out.closed++;
  }
  return out;
}

async function save(db, rowId, fn) {
  const { data: row } = await db.from("properties").select("data").eq("id", rowId).maybeSingle();
  if (!row || !row.data) return null;
  const before = JSON.stringify(row.data);
  const next = fn(row.data);
  if (JSON.stringify(next) === before) return next;
  const { error } = await db.from("properties").update({ data: next }).eq("id", rowId);
  if (error) return null;
  return next;
}
