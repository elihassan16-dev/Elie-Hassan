// 🏦 Monthly "Mortgage payments" checklist (Elie approved 10/13/26).
// On/after the 1st of each month ONE Company task appears — assigned to Elie,
// delegated to Esti — with one checklist item per property we own (rentals +
// flips that are Purchased / Under Construction / On Market / In Closing).
// QuickBooks ticks an item when it sees that month's payment: a line in the
// property's linked mortgage/loan account(s), a Mortgage pin on a rental, or a
// "Debt Service"/"Mortgage" line on its QB project. From the 6th, anything still
// open is marked Late, the task turns 🚨 urgent and Elie + Esti get one push.
// Mounted once in the shell; renders nothing.
import { useEffect, useRef } from "react";
import { useData } from "./data/DataProvider";
import { qbAuthFetch, notify } from "./net";
import { withSubs } from "./subtasks";

const OFFICE_TASK_PID = "__office_task__";
const HOLDING = ["Purchased", "Under Construction", "On Market", "In Closing"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const autoIdFor = (ym) => `mortgages:${ym}`;
// Same id on every device so two people opening the app on the 1st write ONE row.
const taskIdFor = (ym) => Number(`7${ym.replace("-", "")}01`);
const addrOf = (x) => String(x.address || x.name || "Property").trim();
const normDate = (s) => { const v = String(s || ""); const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; const d = new Date(v); return isNaN(d) ? "" : d.toISOString().slice(0, 10); };
const findMember = (team, re, fallback) => (team || []).find((n) => re.test(String(n || ""))) || fallback;

// Every property we own right now → checklist items (stable ids per property).
export function mortgageItems(rentals, props) {
  const items = [];
  const fromProp = new Set((rentals || []).map((r) => String(r.fromPropertyId || "")).filter(Boolean));
  (rentals || []).filter((r) => r && !r.archived && !r.deleted).forEach((r) => items.push({ id: `r:${r.id}`, text: addrOf(r), group: "Rentals", ref: { kind: "rental", id: r.id } }));
  (props || []).filter((p) => p && !p.archived && p.status === "Rental" && !fromProp.has(String(p.id))).forEach((p) => items.push({ id: `p:${p.id}`, text: addrOf(p), group: "Rentals", ref: { kind: "prop", id: p.id } }));
  (props || []).filter((p) => p && !p.archived && HOLDING.includes(p.status)).forEach((p) => items.push({ id: `p:${p.id}`, text: addrOf(p), group: "Flips", ref: { kind: "prop", id: p.id } }));
  const seen = new Set();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).map((x) => ({ ...x, done: false }));
}

// Look for this month's payment for one item. Returns {date, amount, account} or null.
async function findPayment(item, ym, rentals, props, cache) {
  const ref = item.ref || {};
  const src = ref.kind === "rental" ? (rentals || []).find((r) => String(r.id) === String(ref.id)) : (props || []).find((p) => String(p.id) === String(ref.id));
  if (!src) return null;
  // 1) A rental's Mortgage pin dated (or set "for") this month.
  if (ref.kind === "rental") {
    const pin = (src.qbPins || []).find((p) => p.cat === "Mortgage" && (p.forYm === ym || normDate(p.date).slice(0, 7) === ym));
    if (pin) return { date: normDate(pin.date), amount: pin.amount, account: pin.accountName || "Mortgage" };
  }
  // 2) A payment line in the linked mortgage / loan account(s) this month.
  const accts = ref.kind === "rental"
    ? [...(src.qbMortgageAccounts || []), ...(src.qbPinRules || []).filter((x) => x.cat === "Mortgage").map((x) => x.accountId)]
    : [...(src.qbLoanAccounts || [])];
  for (const id of [...new Set(accts.filter(Boolean).map(String))]) {
    const key = `a:${id}`;
    if (!(key in cache)) cache[key] = await qbAuthFetch(`/api/quickbooks/account-txns?account=${encodeURIComponent(id)}`).then((d) => d.items || []).catch(() => null);
    const hit = (cache[key] || []).find((t) => normDate(t.date).slice(0, 7) === ym && (Number(t.amount) < 0 || /payment|check|expense/i.test(String(t.type || ""))));
    if (hit) return { date: normDate(hit.date), amount: hit.amount, account: hit.vendor ? `${hit.vendor}` : "Loan account" };
  }
  // 3) A "Debt Service" / "Mortgage" line on the property's QB project this month.
  const proj = src.qbProjectId;
  if (proj) {
    const key = `p:${proj}`;
    if (!(key in cache)) cache[key] = await qbAuthFetch(`/api/quickbooks/transactions?customerId=${encodeURIComponent(proj)}&start=${ym}-01`).then((d) => d.items || []).catch(() => null);
    const hit = (cache[key] || []).find((t) => normDate(t.date).slice(0, 7) === ym && /debt\s*service|mortgage/i.test(String(t.account || "")));
    if (hit) return { date: normDate(hit.date), amount: hit.amount, account: String(hit.account || "Debt Service").split(":").pop().trim() };
  }
  return null;
}

export function MortgageChecklistSync() {
  const d = useData() || {};
  const { rentals, sharedProps, officeTasks, setOfficeTasks, flushOfficeTasks, teamMembers, currentUser, fresh } = d;
  // Wait for this session's first full load (rentals + office tasks), never a stale snapshot.
  const loading = !fresh;
  const busy = useRef(false);
  const elie = findMember(teamMembers, /^eli(e)?\b/i, "Elie Hassan");
  const esti = findMember(teamMembers, /^est(i|ie)\b/i, "Estie Ungar");
  const isOwner = (n) => String(n || "").split(" ")[0].toLowerCase() === String(currentUser || "").split(" ")[0].toLowerCase();
  // Only Elie's and Esti's devices run it (they own the task; keeps QuickBooks calls low).
  const runsHere = !!currentUser && (isOwner(elie) || isOwner(esti));

  // 1) Create this month's task once.
  useEffect(() => {
    if (!runsHere || loading || !setOfficeTasks || !Array.isArray(officeTasks)) return;
    const ym = ymOf(new Date());
    const aid = autoIdFor(ym);
    if (officeTasks.some((t) => t && t.autoId === aid)) return;
    const subs = mortgageItems(rentals, sharedProps);
    if (!subs.length) return;
    const [y, m] = ym.split("-").map(Number);
    const task = {
      id: taskIdFor(ym), text: `Mortgage payments — ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ""}`,
      status: "Not Started", assignee: elie, delegate: esti, assignedAt: Date.now(), assignedBy: "Automation",
      cat: "Automation", autoId: aid, mtgYm: ym, subtasks: subs,
    };
    setOfficeTasks((prev) => ((prev || []).some((t) => t && t.autoId === aid) ? prev : [...(prev || []), task]));
    if (flushOfficeTasks) setTimeout(flushOfficeTasks, 0);
    Promise.resolve(notify([esti], { title: "New task for you", body: `${task.text} — ${subs.length} properties to check`, tag: `task-${task.id}`, url: `/?goto=task:office:${task.id}` })).catch(() => {});
  }, [runsHere, loading, officeTasks, rentals, sharedProps]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) QuickBooks auto-tick (every 2 hours per device) + 3) Late / urgent from the 6th.
  useEffect(() => {
    if (!runsHere || loading || !Array.isArray(officeTasks)) return;
    const ym = ymOf(new Date());
    const task = officeTasks.find((t) => t && t.autoId === autoIdFor(ym));
    if (!task || task.status === "Completed") return;
    const up = (fn) => { setOfficeTasks((prev) => (prev || []).map((t) => (t.id === task.id ? fn(t) : t))); if (flushOfficeTasks) setTimeout(flushOfficeTasks, 0); };

    const open = (task.subtasks || []).filter((s) => !s.done);
    // Late / urgent (once) — only after QuickBooks has been checked this month,
    // so a list created mid-month doesn't cry wolf before the first check.
    const lateDue = new Date().getDate() >= 6 && !task.lateFlagged;
    const pushLate = (still) => { if (still.length) Promise.resolve(notify([elie, esti], { title: "🚨 URGENT — mortgage payments", body: `Not paid yet for ${MONTHS[new Date().getMonth()]}: ${still.map((s) => s.text).join(", ")}`, tag: `task-${task.id}-late`, url: `/?goto=task:office:${task.id}` })).catch(() => {}); };
    const flagLate = (t) => {
      const still = (t.subtasks || []).filter((s) => !s.done);
      if (new Date().getDate() < 6 || !still.length || t.lateFlagged) return t;
      return { ...t, urgent: true, urgentAt: Date.now(), urgentBy: "Automation", lateFlagged: true, subtasks: (t.subtasks || []).map((s) => (s.done ? s : { ...s, late: true })) };
    };
    if (task.qbCheckedAt && lateDue && open.length) { pushLate(open); up(flagLate); return; }
    if (busy.current || !open.length) return;
    let last = 0; try { last = Number(localStorage.getItem(`gs_mtg_check_${ym}`)) || 0; } catch { /* private mode */ }
    if (Date.now() - last < 2 * 3600 * 1000) return;
    busy.current = true;
    try { localStorage.setItem(`gs_mtg_check_${ym}`, String(Date.now())); } catch { /* ignore */ }
    (async () => {
      const cache = {};
      const found = {};
      for (const s of open) {
        try { const hit = await findPayment(s, ym, rentals, sharedProps, cache); if (hit) found[s.id] = hit; } catch { /* keep going */ }
      }
      up((t) => {
        const ticked = Object.keys(found).length ? withSubs(t, (t.subtasks || []).map((s) => (s.done || !found[s.id] ? s : { ...s, done: true, late: false, doneAt: found[s.id].date ? `${found[s.id].date}T12:00:00` : new Date().toISOString(), doneBy: "QuickBooks", qb: { date: found[s.id].date, amount: Math.abs(Number(found[s.id].amount) || 0), account: found[s.id].account } })), "QuickBooks") : t;
        return flagLate({ ...ticked, qbCheckedAt: Date.now() });
      });
      if (lateDue) pushLate(open.filter((s) => !found[s.id]));
    })().finally(() => { busy.current = false; });
  }, [runsHere, loading, officeTasks, rentals, sharedProps]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
