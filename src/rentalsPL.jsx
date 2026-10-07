// 📊 Rentals P&L — month over month, any date range (Elie approved 10/5/26).
// One 📅 range (quick picks or custom From/To months, optional compare) drives
// the Rental Portfolio overview (net, money in, expenses, per-month chart, each
// property's net + month strip), the all-properties Monthly P&L table, and each
// rental's P&L / Months tabs.
//
// Where the numbers come from, per rental per month:
//   • Platinum-managed (Cowork's live AppFolio data, platinumLive.js): every
//     payment/expense, sorted into categories from Platinum's descriptions; if
//     the portal's month total is bigger than the itemized rows, the gap shows
//     as "Other (not itemized)".
//   • otherwise the rental's monthly ledger (rent / management / service /
//     mortgage, typed or synced from QuickBooks).
// Mortgage: the ledger's mortgage paid that month, else the loan's monthly
// payment — only on months that have any activity. Owner draws/contributions
// are not income or expenses, so they're left out.
import { Fragment, useEffect, useMemo, useState } from "react";
import { T } from "./theme";
import { Sheet } from "./platinum";
import { propMonth, forMonth } from "./platinumLive.js";

// ── months & ranges ──
const pad = (n) => String(n).padStart(2, "0");
export const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const addMonths = (ym, k) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const monthsBetween = (a, b) => { const out = []; if (!a || !b || a > b) return out; let x = a; let g = 0; while (x <= b && g++ < 240) { out.push(x); x = addMonths(x, 1); } return out; };
export const mLabel = (ym, style = "short") => { const [y, m] = String(ym).split("-").map(Number); if (!y) return ""; const d = new Date(y, m - 1, 1); return style === "year" ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : d.toLocaleDateString(undefined, { month: style }); };
const PRESETS = [
  { key: "this", label: "This month", calc: (n) => [n, n] },
  { key: "last", label: "Last month", calc: (n) => [addMonths(n, -1), addMonths(n, -1)] },
  { key: "3m", label: "Last 3 months", chip: "3 months", calc: (n) => [addMonths(n, -2), n] },
  { key: "6m", label: "Last 6 months", chip: "6 months", calc: (n) => [addMonths(n, -5), n] },
  { key: "12m", label: "Last 12 months", chip: "12 months", calc: (n) => [addMonths(n, -11), n] },
  { key: "ytd", label: "This year", calc: (n) => [`${n.slice(0, 4)}-01`, n] },
  { key: "lastyear", label: "Last year", calc: (n) => { const y = Number(n.slice(0, 4)) - 1; return [`${y}-01`, `${y}-12`]; } },
];
const LS = "gs_rentals_range";
export function useRentalRange() {
  const [r, setR] = useState(() => { try { const v = JSON.parse(localStorage.getItem(LS) || "null"); if (v && v.preset) return v; } catch { /* default */ } return { preset: "6m", compare: "none" }; });
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* private mode */ } }, [r]);
  const now = ymNow();
  const p = PRESETS.find((x) => x.key === r.preset);
  const [from, to] = p ? p.calc(now) : [r.from || addMonths(now, -5), r.to || now];
  const months = monthsBetween(from, to);
  let cmp = null;
  if (r.compare === "prev") cmp = monthsBetween(addMonths(from, -months.length), addMonths(from, -1));
  if (r.compare === "lastyear") cmp = monthsBetween(addMonths(from, -12), addMonths(to, -12));
  const label = months.length === 1 ? mLabel(from, "long") + (from.slice(0, 4) !== now.slice(0, 4) ? ` ${from.slice(0, 4)}` : "") : `${mLabel(from)} – ${mLabel(to)}${to.slice(0, 4) !== now.slice(0, 4) || from.slice(0, 4) !== to.slice(0, 4) ? ` ${to.slice(0, 4)}` : ""}`;
  return { ...r, from, to, months, cmp, label, now, set: setR };
}

// ── categories ──
const OWNER = /owner\s*(distribution|draw|contribution|disburse)|distribution to owner/i;
export function categorize(t) {
  const s = `${t.desc || ""} ${t.payee || ""}`.toLowerCase();
  if (t.dir === "in") {
    if (/late fee/.test(s)) return "Late fees";
    // "Tenant Prepayments … - July Rent HAP" is July's rent, paid early.
    if (/prepa/.test(s) && !/\b(rent|hap)\b/.test(s.replace(/prepa\w*/g, ""))) return "Prepaid rent";
    if (/deposit/.test(s)) return "Deposits";
    if (/rent|hap|subsid|section 8/.test(s)) return "Rent";
    return "Other income";
  }
  if (/management fee|mgmt fee/.test(s)) return "Management fee";
  if (/leasing|first month|placement|lease renewal/.test(s)) return "Leasing fees";
  if (/contractor fee/.test(s)) return "Contractor fees";
  if (/pest|exterminat|rodent|termite/.test(s)) return "Pest control";
  if (/landscap|lawn|snow|tree/.test(s)) return "Landscaping";
  if (/insurance/.test(s)) return "Insurance";
  if (/\btax/.test(s)) return "Taxes";
  if (/utilit|water bill|electric bill|\bgas\b|pseg|atlantic city electric|trash|garbage/.test(s)) return "Utilities";
  if (/clean/.test(s)) return "Cleaning";
  return "Repairs & maintenance";
}
const IN_ORDER = ["Rent", "Prepaid rent", "Late fees", "Deposits", "Other income", "Other (not itemized)"];
// "6 S 4th St #4" → "#4"; "518 N High St" → "518 N High"; else the address in
// the description ("516 N High St - Rental Income - …").
export function unitLabel(t) {
  const u = String(t.unit || "").trim();
  const hash = u.match(/#\s*[\w-]+$/);
  if (hash) return hash[0].replace(/\s+/g, "");
  const strip = (x) => x.replace(/\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Ter|Pl|Way)\.?$/i, "").trim();
  if (u) return strip(u);
  const m = String(t.desc || "").match(/^(\d+[A-Za-z]?\s[^-]{2,40}?)\s+-\s/);
  return m ? strip(m[1]) : "unit not listed";
}
const rankIn = (c) => { const i = IN_ORDER.indexOf(String(c).split(" – ")[0]); return i < 0 ? 50 : i; };
// Rent first (units in order), then prepaid, late fees, deposits, other.
export const sortIncome = (list) => list.sort((a, b) => rankIn(a.cat) - rankIn(b.cat) || (a.cat.startsWith("Rent – ") && b.cat.startsWith("Rent – ") ? a.cat.localeCompare(b.cat, undefined, { numeric: true }) : b.amount - a.amount));
// Across several properties, per-unit rent lines fold back into one "Rent".
export const foldUnits = (cat) => (cat.startsWith("Rent – ") ? "Rent" : cat);

// ── Reversals (Elie 10/6/26): an NSF / bounced / returned payment shows up
// as "Rental Income - NSF reversal receipt for Reference #…" (negative in
// AppFolio's Cash Out). It cancels an earlier payment: match it to the most
// recent un-reversed income line of the same property and amount (≤45 days
// before) and take away that line's money in that line's month + category.
const REV = /\bnsf\b|reversal|returned (payment|check|item)|bounced|chargeback/i;
const INCOME_DESC = /^(rental income|late fees?|subsidized rent|legal fees-income|other income|tenant)/i;
export const isReversal = (t) => REV.test(String(t.desc || "")) || (t.neg && (t.dir === "in" || INCOME_DESC.test(String(t.desc || ""))));
const effCache = new WeakMap();
// basis "entry" (Elie 10/6/26 — to cross-check with AppFolio): every line in
// the month it was ENTERED, a bounced payment in the month it bounced.
function effTxns(live, key, basis) {
  let byKey = effCache.get(live);
  if (!byKey) { byKey = new Map(); effCache.set(live, byKey); }
  const ck = `${key}|${basis === "entry" ? "entry" : "for"}`;
  if (byKey.has(ck)) return byKey.get(ck);
  if (basis === "entry") { const out = effTxns(live, key).map((x) => ({ ...x, ym: String(x.t.date).slice(0, 7) })); byKey.set(ck, out); return out; }
  const all = live.txns.filter((t) => t.key === key).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const used = new Set();
  const days = (a, b) => (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000;
  const out = all.map((t) => {
    if (!isReversal(t)) return { t, ym: forMonth(t), rev: false };
    const isLate = /late fee/i.test(t.desc || "");
    const cands = all.filter((o) => o !== t && !isReversal(o) && o.dir === "in" && !used.has(o) && Math.abs(o.amount - t.amount) < 0.005 && o.date <= t.date && days(o.date, t.date) <= 45 && (/late fee/i.test(o.desc || "") === isLate));
    const o = cands[cands.length - 1] || null;
    if (o) used.add(o);
    return { t, ym: o ? forMonth(o) : forMonth(t), rev: true, orig: o };
  });
  byKey.set(ck, out);
  return out;
}

// Rent lines → "Rent – <unit>" on multi-unit buildings. Section 8 (HAP)
// lines that don't name a unit go to the unit the other Section 8 payments
// name (516-518: "516 N High St - Subsidized Rent").
const isHap = (t) => /\bhap\b|subsid|sec(tion)?\s?8/i.test(`${t.desc} ${t.ref || ""}`);
function rentCatFn(live, key, multi) {
  let hapUnit = null;
  if (multi) {
    const cnt = {};
    live.txns.forEach((t) => { if (t.key === key && t.dir === "in" && isHap(t)) { const u = unitLabel(t); if (u !== "unit not listed") cnt[u] = (cnt[u] || 0) + 1; } });
    hapUnit = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  return (t) => {
    let c = categorize(t);
    if (multi && t.dir === "in" && c === "Rent") { let u = unitLabel(t); if (u === "unit not listed" && hapUnit && isHap(t)) u = hapUnit; c = `Rent – ${u}`; }
    return c;
  };
}
// The month a pinned QuickBooks line counts for: the one Elie picked (📌 list
// "For" menu, 10/6/26), else the month in its description, else its date.
export const pinMonth = (p) => p.forYm || forMonth(p);
// A pin split across months (Elie 10/6/26 — one deposit covering several
// months) → [{ym, amount, split}]; otherwise the whole amount in pinMonth.
export const validSplit = (p) => Array.isArray(p.split) && p.split.length > 0 && p.split.every((x) => /^\d{4}-\d{2}$/.test(x.ym) && Number(x.amount) > 0) && Math.abs(p.split.reduce((s, x) => s + Number(x.amount), 0) - Math.abs(Number(p.amount) || 0)) < 0.01;
export const pinParts = (p) => (validSplit(p) ? p.split.map((x) => ({ ym: x.ym, amount: Number(x.amount), split: true })) : [{ ym: pinMonth(p), amount: Math.abs(Number(p.amount) || 0), split: false }]);
// Does the description name the month it's for? (else a payment "for" its
// own payment month really means "no month written").
const NAMES_MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b|\b(0?[1-9]|1[0-2])\/20\d{2}\b/i;
// Every rent payment for one rental (delinquency report): Platinum's rent
// lines (bounced ones negative, in the month of the payment they cancel),
// prepaid rent, late fees, and rent pinned from QuickBooks (paid to Elie
// directly). unit = "" or the "Rent – X" unit.
export function rentPaymentsFor(r, ctx) {
  const out = [];
  const key = ctx && ctx.live && ctx.keyFor ? ctx.keyFor(r) : null;
  if (key) {
    const catOf = rentCatFn(ctx.live, key, true);
    const kindOf = (c) => (c.startsWith("Rent") ? "rent" : c === "Prepaid rent" ? "prepaid" : c === "Late fees" ? "late" : null);
    effTxns(ctx.live, key).forEach(({ t, ym, rev, orig }) => {
      const base = rev ? (orig || { ...t, dir: "in" }) : t;
      if (base.dir !== "in" || OWNER.test(`${t.desc} ${t.payee}`)) return;
      const c = catOf(base), kind = kindOf(c);
      if (!kind) return;
      out.push({ date: t.date, forYm: ym, explicit: kind !== "prepaid" && (rev ? true : NAMES_MONTH.test(t.desc || "")), unit: c.startsWith("Rent – ") ? c.slice(7) : "", kind, amount: rev ? -t.amount : t.amount, desc: t.desc, rev, hap: isHap(base), src: "platinum" });
    });
  }
  (r.qbPins || []).forEach((p) => {
    const c = p.cat || "";
    if (!/^Rent\b|^Late fees/.test(c)) return;
    pinParts(p).forEach((x) => out.push({ date: p.date, forYm: x.ym, explicit: x.split || !!p.forYm || NAMES_MONTH.test(p.desc || ""), unit: c.startsWith("Rent – ") ? c.slice(7) : "", kind: c.startsWith("Rent") ? "rent" : "late", amount: x.amount, desc: p.desc || p.accountName || "Paid to you (QuickBooks)", rev: false, hap: false, src: "pin", part: x.split }));
  });
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// "Count them as" choices for income pinned from QuickBooks: one per unit on a
// multi-unit rental (the units Platinum's rent names, then the rental's own
// unit list), with the tenant's name when the rental has it.
export function rentCatsFor(r, ctx) {
  const units = r.units || [];
  if (units.length <= 1) { const tn = units[0]?.tenant?.name; return [{ cat: "Rent", label: `Rent${tn ? ` · ${tn}` : ""}`, tenant: tn || "" }]; }
  const seen = new Set();
  const key = ctx && ctx.live && ctx.keyFor ? ctx.keyFor(r) : null;
  if (key) ctx.live.txns.forEach((t) => { if (t.key === key && t.dir === "in" && categorize(t) === "Rent") { const u = unitLabel(t); if (u !== "unit not listed") seen.add(u); } });
  const tenantFor = (u) => { const n = String(u).replace(/^#/, "").split(" ")[0].toLowerCase(); const x = units.find((v) => String(v.label || "").replace(/^#/, "").toLowerCase().split(" ")[0] === n || String(v.label || "").toLowerCase() === String(u).toLowerCase()); return x?.tenant?.name || ""; };
  if (!seen.size) units.forEach((u, i) => seen.add(u.label || `Unit ${i + 1}`));
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((u) => { const tn = tenantFor(u); return { cat: `Rent – ${u}`, label: `Rent – ${u}${tn ? ` · ${tn}` : ""}`, tenant: tn }; });
}

// ── the P&L for one rental, one month ──
// ctx = { live, keyFor(rental) → Platinum key|null, bAmt(L,bucket,field) }
export function rentalMonthPL(r, ym, ctx) {
  const income = new Map(), expenses = new Map();
  const add = (map, cat, amount, tx) => { if (!(Math.abs(amount) > 0.004)) return; const e = map.get(cat) || { cat, amount: 0, tx: [] }; e.amount += amount; if (tx) e.tx.push(tx); map.set(cat, e); };
  let source = "none";
  const key = ctx.live && ctx.keyFor ? ctx.keyFor(r) : null;
  if (key) {
    const pm = propMonth(ctx.live, key, ym);
    const notOwner = (t) => !OWNER.test(`${t.desc} ${t.payee}`);
    const eff = effTxns(ctx.live, key, ctx.basis).filter((x) => x.ym === ym && notOwner(x.t)); // by the month each line is FOR (or entered)
    const tx = eff.map((x) => x.t);
    const paid = pm.paidTx.filter((t) => notOwner(t) && !isReversal(t)); // by payment date (portal totals)
    const m = ctx.live.months[ym];
    const dash = m && m.props && m.props[key];
    if (tx.length || (dash && (dash.cashIn != null || dash.cashOut != null))) {
      source = "platinum";
      // Multi-unit buildings: one Rent line per unit (Elie 10/6/26).
      const multi = (r.units || []).length > 1;
      // Prepaid rent (Elie 10/7/26) counts as plain Rent — the unit's line on a
      // multi-unit building — and is tagged "Prepaid" in the payments popup.
      const rentCat = rentCatFn(ctx.live, key, multi);
      const isPrepaid = (t) => t.dir === "in" && categorize(t) === "Prepaid rent";
      const catOf = (t) => (isPrepaid(t) ? rentCat({ ...t, desc: `Rent ${t.desc || ""}` }) : rentCat(t));
      eff.forEach(({ t, rev, orig }) => {
        if (!rev) { add(t.dir === "in" ? income : expenses, catOf(t), t.amount, isPrepaid(t) ? { ...t, prepaid: true } : t); return; }
        // A reversal takes money away from the line it cancels (or, unmatched,
        // from the income category its own description names).
        const base = orig || { ...t, dir: "in" };
        add(income, catOf(base), -t.amount, { ...t, dir: "in", amount: -t.amount, rev: true, forYm: orig ? forMonth(orig) : ym, reverses: orig ? `${orig.date} payment` : "" });
      });
      // The portal's month totals count payments by DATE, so compare them with
      // what was paid this month, not with what's assigned to it.
      const paidSum = (dir) => paid.filter((t) => t.dir === dir).reduce((s, t) => s + t.amount, 0);
      if (dash && dash.cashIn != null && dash.cashIn - paidSum("in") > 1) add(income, "Other (not itemized)", dash.cashIn - paidSum("in"));
      if (dash && dash.cashOut != null && dash.cashOut - paidSum("out") > 1) add(expenses, "Other (not itemized)", dash.cashOut - paidSum("out"));
    }
  }
  const L = (r.ledger || []).find((x) => x.month === ym);
  if (source === "none" && L) {
    source = "ledger";
    add(income, "Rent", ctx.bAmt(L, "rent", "rentReceived"));
    add(expenses, "Management fee", ctx.bAmt(L, "management", "mgmtPaid"));
    add(expenses, "Repairs & maintenance", ctx.bAmt(L, "service", "serviceCalls"));
  }
  // 📌 QuickBooks transactions pinned to this rental (mortgage, insurance,
  // taxes, outside bills…). A pinned mortgage replaces the ledger/loan figure.
  const pins = [];
  (r.qbPins || []).forEach((p) => (ctx.basis === "entry" ? [{ ym: String(p.date).slice(0, 7), amount: Math.abs(Number(p.amount) || 0), split: false }] : pinParts(p)).forEach((x) => { if (x.ym === ym) pins.push({ p, x }); }));
  let pinnedMtg = 0;
  pins.forEach(({ p, x }) => {
    const t = { dir: /^(Rent\b|Late fees|Deposits|Other income)/.test(p.cat || "") ? "in" : "out", date: p.date, desc: `${p.desc || ""}${x.split ? ` (part of ${Math.abs(Number(p.amount) || 0).toLocaleString(undefined, { style: "currency", currency: "USD" })})` : ""}`, payee: p.accountName || "QuickBooks", amount: x.amount, pinned: true, forYm: ym };
    if (p.cat === "Mortgage") pinnedMtg += t.amount;
    else add(t.dir === "in" ? income : expenses, p.cat || "Other expenses", t.amount, t);
  });
  if (pins.length && source === "none") source = "pins";
  const inc = sortIncome([...income.values()]);
  const exp = [...expenses.values()].sort((a, b) => (a.cat === "Other (not itemized)") - (b.cat === "Other (not itemized)") || b.amount - a.amount);
  const totalIn = inc.reduce((s, e) => s + e.amount, 0), totalOut = exp.reduce((s, e) => s + e.amount, 0);
  let mortgage = 0;
  const ledgerMtg = L ? ctx.bAmt(L, "mortgage", "mortgagePaid") : 0;
  if (pinnedMtg > 0) mortgage = pinnedMtg;
  else if (ledgerMtg > 0) mortgage = ledgerMtg;
  else if (source !== "none") mortgage = Number(String((r.mortgage || {}).payment || "").replace(/[$,]/g, "")) || 0;
  return { ym, source, income: inc, expenses: exp, totalIn, totalOut, net: totalIn - totalOut, mortgage, cashFlow: totalIn - totalOut - mortgage };
}
// Several months and/or several rentals rolled into one P&L.
export function rollPL(rentals, months, ctx) {
  const income = new Map(), expenses = new Map();
  let totalIn = 0, totalOut = 0, mortgage = 0, any = false;
  rentals.forEach((r) => months.forEach((ym) => {
    const p = rentalMonthPL(r, ym, ctx);
    if (p.source !== "none") any = true;
    p.income.forEach((e) => { const x = income.get(e.cat) || { cat: e.cat, amount: 0, tx: [] }; x.amount += e.amount; x.tx.push(...e.tx); income.set(e.cat, x); });
    p.expenses.forEach((e) => { const x = expenses.get(e.cat) || { cat: e.cat, amount: 0, tx: [] }; x.amount += e.amount; x.tx.push(...e.tx); expenses.set(e.cat, x); });
    totalIn += p.totalIn; totalOut += p.totalOut; mortgage += p.mortgage;
  }));
  return { any, income: [...income.values()].sort((a, b) => b.amount - a.amount), expenses: [...expenses.values()].sort((a, b) => b.amount - a.amount), totalIn, totalOut, net: totalIn - totalOut, mortgage, cashFlow: totalIn - totalOut - mortgage };
}

// Portfolio P&L for one month. Platinum-managed rentals with no property-level
// numbers that month (history Cowork read as portfolio totals only) fall back
// to Platinum's all-properties total, shown as "Other (not itemized)".
export function portfolioMonth(rentals, ym, ctx) {
  const managed = rentals.filter((r) => ctx.keyFor && ctx.live && ctx.keyFor(r));
  const others = rentals.filter((r) => !managed.includes(r));
  const a = rollPL(others, [ym], ctx);
  let b = rollPL(managed, [ym], ctx);
  const all = ctx.live && ctx.live.months[ym] && ctx.live.months[ym].all;
  if (!b.any && managed.length && all && (all.cashIn || all.cashOut)) {
    const ti = all.cashIn || 0, to = all.cashOut || 0;
    b = { ...b, any: true, income: ti ? [{ cat: "Other (not itemized)", amount: ti, tx: [] }] : [], expenses: to ? [{ cat: "Other (not itemized)", amount: to, tx: [] }] : [], totalIn: ti, totalOut: to };
  }
  const merge = (side) => { const m = new Map(); [...a[side], ...b[side]].forEach((e) => { const k = foldUnits(e.cat); const x = m.get(k) || { cat: k, amount: 0, tx: [] }; x.amount += e.amount; x.tx.push(...(e.tx || [])); m.set(k, x); }); const out = [...m.values()]; return side === "income" ? sortIncome(out) : out.sort((p, q) => q.amount - p.amount); };
  const totalIn = a.totalIn + b.totalIn, totalOut = a.totalOut + b.totalOut, mortgage = a.mortgage + b.mortgage;
  return { any: a.any || b.any, income: merge("income"), expenses: merge("expenses"), totalIn, totalOut, net: totalIn - totalOut, mortgage, cashFlow: totalIn - totalOut - mortgage };
}

// ── formatting & bits ──
const money = (v, cents) => { const n = Number(v) || 0; return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`; };
const signed = (v, cents) => `${(Number(v) || 0) > 0.004 ? "+" : ""}${money(v, cents)}`;
const num0 = (v) => { const n = Math.round(Number(v) || 0); return n === 0 ? "—" : `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`; };
const GREEN = "#248A3D", RED = "#D70015", IN_C = "#9C7A26", OUT_C = "#3E6DB5";
const card = { background: T.card, borderRadius: 18, border: `1px solid ${T.border}`, overflow: "hidden", marginBottom: 12 };
const secTitle = { fontSize: 15, fontWeight: 700, color: T.text, margin: "16px 4px 8px", display: "flex", alignItems: "baseline", gap: 8 };
const capsule = { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 14px", borderRadius: 18, border: "none", background: "rgba(118,118,128,0.12)", color: T.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const netColor = (v) => (v > 0.5 ? GREEN : v < -0.5 ? RED : T.text);

export function RangeCapsule({ range, onOpen }) {
  return <button onClick={onOpen} style={capsule} aria-label={`Date range ${range.label}`}>📅 {range.label} <span style={{ fontSize: 10, color: T.textSub }}>▼</span></button>;
}
export function RangeChips({ range }) {
  const chips = [["this", "This month"], ["last", "Last month"], ["3m", "3 months"], ["6m", "6 months"], ["ytd", "This year"]];
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", margin: "0 0 12px", paddingBottom: 2 }}>
      {chips.map(([k, l]) => <button key={k} onClick={() => range.set((r) => ({ ...r, preset: k }))} style={{ flexShrink: 0, minHeight: 34, padding: "0 13px", borderRadius: 17, border: "none", background: range.preset === k ? T.text : "rgba(118,118,128,0.12)", color: range.preset === k ? "#fff" : "#3A3A3C", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>)}
    </div>
  );
}
export function RangeSheet({ range, isMobile, onClose }) {
  const [preset, setPreset] = useState(range.preset);
  const [from, setFrom] = useState(range.from), [to, setTo] = useState(range.to);
  const [compare, setCompare] = useState(range.compare || "none");
  const now = ymNow();
  const show = () => {
    if (preset === "custom") { const a = from <= to ? from : to, b = from <= to ? to : from; range.set({ preset: "custom", from: a, to: b, compare }); }
    else range.set({ preset, compare });
    onClose();
  };
  const row = { display: "flex", alignItems: "center", minHeight: 46, padding: "0 16px", borderTop: `1px solid ${T.border}`, fontSize: 16, color: T.text, cursor: "pointer", background: "none", border: "none", width: "100%", fontFamily: "inherit", textAlign: "left" };
  const monthIn = { width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 44, borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, padding: "0 12px", fontSize: 16, fontFamily: "inherit", color: T.text };
  const rangeTxt = (p) => { const [a, b] = p.calc(now); return a === b ? mLabel(a, "year") : `${mLabel(a)} – ${mLabel(b, "year")}`; };
  return (
    <Sheet title="Date range" isMobile={isMobile} onClose={onClose}>
      <div style={card}>
        {PRESETS.map((p, i) => (
          <button key={p.key} onClick={() => setPreset(p.key)} style={{ ...row, borderTop: i ? `1px solid ${T.border}` : "none" }}>
            <span style={{ flex: 1 }}>{p.label}</span>
            <span style={{ color: preset === p.key ? IN_C : T.textSub, fontSize: preset === p.key ? 17 : 14 }}>{preset === p.key ? "✓" : rangeTxt(p)}</span>
          </button>
        ))}
        <button onClick={() => setPreset("custom")} style={{ ...row, fontWeight: 600 }}><span style={{ flex: 1 }}>Custom</span>{preset === "custom" && <span style={{ color: IN_C, fontSize: 17 }}>✓</span>}</button>
      </div>
      {preset === "custom" && <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <label style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: T.textSub }}>From<input type="month" value={from} max={now} onChange={(e) => e.target.value && setFrom(e.target.value)} style={monthIn} /></label>
        <label style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: T.textSub }}>To<input type="month" value={to} max={now} onChange={(e) => e.target.value && setTo(e.target.value)} style={monthIn} /></label>
      </div>}
      <div style={{ ...card, display: "flex", alignItems: "center", minHeight: 46, padding: "0 16px", gap: 10 }}>
        <span style={{ flex: 1, fontSize: 16, color: T.text }}>Compare with</span>
        <select value={compare} onChange={(e) => setCompare(e.target.value)} style={{ minHeight: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.card, fontSize: 14, padding: "0 8px", fontFamily: "inherit", color: T.text }}>
          <option value="none">Nothing</option><option value="prev">Previous period</option><option value="lastyear">Same months last year</option>
        </select>
      </div>
      <button onClick={show} style={{ width: "100%", minHeight: 50, borderRadius: 25, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>Show</button>
    </Sheet>
  );
}

// Money in vs expenses per month (two series, legend, tap a month for numbers).
export function GroupBars({ rows, W = 330, H = 120 }) {
  const [hi, setHi] = useState(null);
  const base = H - 22, top = 10;
  const max = Math.max(1, ...rows.flatMap((r) => [r.in, r.out]));
  const step = (W - 4) / Math.max(1, rows.length);
  const bw = Math.max(4, Math.min(22, step / 2 - 4));
  const act = hi != null ? rows[hi] : null;
  return (
    <div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#3A3A3C", alignItems: "center", minHeight: 18 }}>
        {act ? <span style={{ fontVariantNumeric: "tabular-nums" }}><b>{act.long}</b> · in {money(act.in)} · expenses {money(act.out)} · net <b style={{ color: netColor(act.in - act.out) }}>{signed(act.in - act.out)}</b></span> : <>
          <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: IN_C, marginRight: 5, verticalAlign: -1 }} />Money in</span>
          <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: OUT_C, marginRight: 5, verticalAlign: -1 }} />Expenses</span>
        </>}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", marginTop: 6, touchAction: "manipulation" }} onPointerLeave={() => setHi(null)} role="img" aria-label="Money in and expenses by month">
        <line x1="0" y1={base} x2={W} y2={base} stroke="#E5E5EA" />
        {rows.map((r, i) => {
          const cx = 2 + i * step + step / 2;
          const h = (v) => (v > 0 ? Math.max(3, (v / max) * (base - top)) : 0);
          const bar = (x, v, c) => { const hh = h(v); return hh > 0 ? <path d={`M${x},${base} v${-(hh - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${hh - 3} z`} fill={c} opacity={r.partial ? 0.42 : hi == null || hi === i ? 1 : 0.5} /> : null; };
          return (
            <g key={r.ym} onPointerEnter={() => setHi(i)} onClick={() => setHi(i)} style={{ cursor: "pointer" }}>
              <rect x={2 + i * step} y={0} width={step} height={H} fill="transparent" />
              {bar(cx - bw - 1, r.in, IN_C)}{bar(cx + 1, r.out, OUT_C)}
              {(rows.length <= (W > 400 ? 14 : 8) || i % Math.ceil(rows.length / (W > 400 ? 14 : 8)) === 0) && <text x={cx} y={H - 4} fontSize="10.5" fill={hi === i ? T.text : "#6E6E73"} fontWeight={hi === i ? 700 : 400} textAnchor="middle">{r.label}{r.partial ? "*" : ""}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function Spark({ values }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 20, marginTop: 4 }} aria-hidden="true">
      {values.map((v, i) => <i key={i} style={{ width: values.length > 8 ? 5 : 8, height: v ? Math.max(2, (Math.abs(v) / max) * 20) : 1, borderRadius: 2, background: v < 0 ? RED : v > 0 ? IN_C : "#D1D1D6" }} />)}
    </div>
  );
}

// ── Overview (list page top) ──
export function RentalsOverview({ rentals, ctx, range, onOpen, chipsFor, onTable, isMobile }) {
  const [sheet, setSheet] = useState(false);
  const cur = ymNow();
  const per = useMemo(() => rentals.map((r) => {
    const ms = range.months.map((ym) => rentalMonthPL(r, ym, ctx));
    const net = ms.reduce((s, p) => s + p.net, 0);
    return { r, ms, net, any: ms.some((p) => p.source !== "none") };
  }), [rentals, ctx, range.months.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = range.months.map((ym) => { const p = portfolioMonth(rentals, ym, ctx); return { ym, label: mLabel(ym), long: mLabel(ym, "year"), partial: ym === cur, in: p.totalIn, out: p.totalOut }; });
  const tIn = rows.reduce((s, x) => s + x.in, 0), tOut = rows.reduce((s, x) => s + x.out, 0), net = tIn - tOut;
  const cmpNet = range.cmp ? range.cmp.reduce((s, ym) => s + portfolioMonth(rentals, ym, ctx).net, 0) : null;
  const units = rentals.reduce((s, r) => s + (r.units || []).length, 0);
  // Rent collected this month (Platinum live) when the range includes it.
  const live = ctx.live;
  const showRent = live && range.months.includes(live.month) && (live.latest.all || {}).rentDue > 0;
  const la = showRent ? live.latest.all : null;
  const lastPct = showRent && live.sameDayLast && live.sameDayLast.all && live.sameDayLast.all.rentDue ? Math.round((live.sameDayLast.all.rentCollected || 0) / live.sameDayLast.all.rentDue * 100) : null;
  const pct = la ? Math.round((la.rentCollected || 0) / la.rentDue * 100) : 0;
  const sorted = [...per].sort((a, b) => (b.any - a.any) || b.net - a.net);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }} />
        <RangeCapsule range={range} onOpen={() => setSheet(true)} />
      </div>
      <RangeChips range={range} />
      <div style={{ ...card, padding: "14px 16px" }}>
        <div style={{ fontSize: 12.5, color: T.textSub }}>Net · {range.label} · {rentals.length} propert{rentals.length === 1 ? "y" : "ies"}{units ? ` · ${units} units` : ""}</div>
        <div style={{ fontSize: 32, fontWeight: 750, letterSpacing: "-0.02em", color: netColor(net), fontVariantNumeric: "tabular-nums" }}>{signed(net)}</div>
        {cmpNet != null && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: -2 }}>{range.compare === "prev" ? "Previous period" : "Same months last year"}: <b style={{ color: netColor(cmpNet) }}>{signed(cmpNet)}</b> · <span style={{ color: net >= cmpNet ? GREEN : RED, fontWeight: 650 }}>{net >= cmpNet ? "↑" : "↓"} {money(Math.abs(net - cmpNet))}</span></div>}
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          {[["Money in", tIn], ["Expenses", tOut]].map(([l, v]) => <div key={l} style={{ flex: 1, background: T.bg, borderRadius: 12, padding: "8px 10px" }}><div style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{l}</div><div style={{ fontSize: 16.5, fontWeight: 700, color: T.text, fontVariantNumeric: "tabular-nums" }}>{money(v)}</div></div>)}
        </div>
        {rows.length > 1 && <div style={{ marginTop: 12 }}><GroupBars rows={rows} /></div>}
        {showRent && <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: T.text, gap: 8 }}><b>{mLabel(live.month, "long")} rent collected</b><span style={{ fontVariantNumeric: "tabular-nums" }}><b>{money(la.rentCollected)}</b> <span style={{ color: T.textSub }}>of {money(la.rentDue)} · {pct}%</span></span></div>
          <div style={{ height: 8, borderRadius: 4, background: "#E9E9EB", position: "relative", margin: "8px 0 5px" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, pct)}%`, borderRadius: 4, background: GREEN }} />
            {lastPct != null && <div style={{ position: "absolute", top: -4, bottom: -4, left: `calc(${Math.min(100, lastPct)}% - 1px)`, width: 2, borderRadius: 1, background: T.text }} />}
          </div>
          {lastPct != null && <div style={{ fontSize: 12, color: T.textSub }}>{mLabel(live.lastMonth, "long")} was {lastPct}% by this day (black tick)</div>}
        </div>}
        <button onClick={onTable} style={{ display: "flex", alignItems: "center", width: "100%", minHeight: 44, marginTop: 10, padding: "0 2px", border: "none", borderTop: `1px solid ${T.border}`, background: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 15, color: T.text }}>
          <span style={{ flex: 1, textAlign: "left" }}>📊 Monthly P&amp;L table</span><span style={{ color: "#C7C7CC", fontSize: 20 }}>›</span>
        </button>
      </div>
      <div style={secTitle}>Properties<span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 500, color: T.textSub }}>Net · {range.label}</span></div>
      <div style={card}>
        {sorted.length === 0 && <div style={{ padding: "26px 16px", textAlign: "center", fontSize: 13.5, color: T.textTert }}>No rentals yet. Tap “+ Add rental” to start your portfolio.</div>}
        {sorted.map((x, i) => (
          <div key={x.r.id} onClick={() => onOpen(x.r.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", minHeight: 56, borderTop: i ? `1px solid ${T.border}` : "none", cursor: "pointer" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.r.address}{(x.r.units || []).length > 1 ? <span style={{ fontSize: 12.5, fontWeight: 400, color: T.textSub }}> · {(x.r.units || []).length} units</span> : null}</div>
              {chipsFor && chipsFor(x.r)}
              {range.months.length > 1 && x.any && <Spark values={x.ms.map((p) => p.net)} />}
              {!x.any && <div style={{ fontSize: 12, color: T.textTert, marginTop: 2 }}>No numbers for {range.label} yet</div>}
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 650, color: x.any ? netColor(x.net) : T.textTert, fontVariantNumeric: "tabular-nums" }}>{x.any ? signed(x.net) : "—"}</div>
            <span style={{ color: "#C7C7CC", fontSize: 20 }}>›</span>
          </div>
        ))}
      </div>
      {sheet && <RangeSheet range={range} isMobile={isMobile} onClose={() => setSheet(false)} />}
    </>
  );
}

// ── Month-over-month table (one rental or all) ──
export function MonthsTable({ rentals, ctx, range }) {
  const cur = ymNow();
  // Skip leading months with no numbers at all (before the data starts).
  const hasAny = (ym) => (rentals.length > 1 ? portfolioMonth(rentals, ym, ctx) : rollPL(rentals, [ym], ctx)).any;
  const firstIdx = range.months.findIndex(hasAny);
  const ms = firstIdx > 0 ? range.months.slice(firstIdx) : range.months;
  const per = ms.map((ym) => (rentals.length > 1 ? portfolioMonth(rentals, ym, ctx) : rollPL(rentals, [ym], ctx)));
  const sumBy = (side) => { const m = new Map(); per.forEach((p) => p[side].forEach((e) => m.set(e.cat, { cat: e.cat, amount: (m.get(e.cat)?.amount || 0) + e.amount }))); return [...m.values()]; };
  const total = { any: per.some((p) => p.any), income: sumBy("income"), expenses: sumBy("expenses"), totalIn: per.reduce((s, p) => s + p.totalIn, 0), totalOut: per.reduce((s, p) => s + p.totalOut, 0), mortgage: per.reduce((s, p) => s + p.mortgage, 0) };
  total.net = total.totalIn - total.totalOut; total.cashFlow = total.net - total.mortgage;
  const cats = (side) => { const s = new Set(); per.forEach((p) => p[side].forEach((e) => s.add(e.cat))); return [...s].sort((a, b) => (total[side].find((e) => e.cat === b)?.amount || 0) - (total[side].find((e) => e.cat === a)?.amount || 0)); };
  const inCats = cats("income"), outCats = cats("expenses");
  const val = (p, side, cat) => p[side].find((e) => e.cat === cat)?.amount || 0;
  const hasMtg = total.mortgage > 0.5;
  const th = { fontSize: 12, fontWeight: 600, color: T.textSub, textAlign: "right", padding: "10px 10px 6px", whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "8px 10px", borderTop: `1px solid ${T.border}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: T.text };
  const first = { position: "sticky", left: 0, background: T.card, textAlign: "left", paddingLeft: 14, minWidth: 128, boxShadow: `1px 0 0 ${T.border}`, zIndex: 1 };
  const totC = { background: "#F6F6F8", fontWeight: 700 };
  const line = (label, get, opts = {}) => (
    <tr>
      <td style={{ ...td, ...first, fontWeight: opts.bold ? 700 : 400 }}>{label}</td>
      {per.map((p, i) => { const v = get(p); return <td key={ms[i]} style={{ ...td, fontWeight: opts.bold ? 700 : 400, color: opts.color ? netColor(v) : T.text }}>{opts.signed ? (Math.abs(v) < 0.5 ? "—" : `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString()}`) : num0(opts.neg ? -v : v)}</td>; })}
      {(() => { const v = get(total); return <td style={{ ...td, ...totC, color: opts.color ? netColor(v) : T.text }}>{opts.signed ? (Math.abs(v) < 0.5 ? "—" : `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString()}`) : num0(opts.neg ? -v : v)}</td>; })()}
    </tr>
  );
  const grp = (label) => <tr><td style={{ ...td, ...first, borderTop: "none", fontSize: 12, fontWeight: 700, color: T.textSub, paddingTop: 12 }}>{label}</td>{per.map((p, i) => <td key={ms[i]} style={{ ...td, borderTop: "none" }} />)}<td style={{ ...td, ...totC, borderTop: "none" }} /></tr>;
  if (!total.any) return <div style={{ ...card, padding: 16, fontSize: 13.5, color: T.textSub }}>No numbers for {range.label} yet. Platinum properties fill in when Cowork sends updates; others from the monthly ledger under Details.</div>;
  return (
    <>
      <div style={{ ...card, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: "100%" }}>
          <thead><tr><th style={{ ...th, ...first, boxShadow: "none" }} />{ms.map((ym) => <th key={ym} style={th}>{mLabel(ym)}{ym.slice(0, 4) !== cur.slice(0, 4) && ms.some((x) => x.slice(0, 4) !== ym.slice(0, 4)) ? ` ’${ym.slice(2, 4)}` : ""}{ym === cur ? "*" : ""}</th>)}<th style={{ ...th, ...totC }}>Total</th></tr></thead>
          <tbody>
            {grp("Income")}
            {inCats.map((c) => <Fragment key={"i" + c}>{line(c, (p) => val(p, "income", c))}</Fragment>)}
            {line("Total income", (p) => p.totalIn, { bold: true })}
            {grp("Expenses")}
            {outCats.map((c) => <Fragment key={"o" + c}>{line(c, (p) => val(p, "expenses", c))}</Fragment>)}
            {line("Total expenses", (p) => p.totalOut, { bold: true })}
            {line("Net", (p) => p.net, { bold: true, color: true, signed: true })}
            {hasMtg && line("Mortgage", (p) => p.mortgage, { neg: true })}
            {hasMtg && line("Cash flow", (p) => p.cashFlow, { bold: true, color: true, signed: true })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: T.textSub, margin: "-4px 6px 12px" }}>{ms.length > 3 ? "Swipe sideways for more months · " : ""}{ms.includes(cur) ? `* ${mLabel(cur, "long")} so far` : ""}</div>
    </>
  );
}

// ── One rental: one month's P&L ──
export function RentalPL({ rental, ctx, range }) {
  const [ym, setYm] = useState(range.to);
  useEffect(() => { setYm(range.to); }, [range.to]);
  const [open, setOpen] = useState(null);
  const p = rentalMonthPL(rental, ym, ctx);
  const canNext = ym < ymNow();
  const lineRow = (e, side, i) => {
    const k = `${side}:${e.cat}`, isOpen = open === k, can = e.tx.length > 0;
    return (
      <div key={k} style={{ borderTop: i ? `1px solid ${T.border}` : "none" }}>
        <div onClick={() => can && setOpen(isOpen ? null : k)} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 16px", cursor: can ? "pointer" : "default" }}>
          <span style={{ flex: 1, fontSize: 15.5, color: T.text }}>{e.cat}{e.tx.length > 1 ? <span style={{ fontSize: 12.5, color: T.textSub }}> · {e.tx.length}</span> : null}</span>
          <span style={{ fontSize: 15.5, fontVariantNumeric: "tabular-nums", color: T.text }}>{money(e.amount, true)}</span>
          {can && <span style={{ color: "#C7C7CC", fontSize: 18, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>}
        </div>
        {isOpen && <div style={{ background: T.bg, padding: "4px 16px 8px" }}>
          {e.tx.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((t, j) => (
            <div key={j} style={{ display: "flex", gap: 10, fontSize: 13, padding: "6px 0", borderTop: j ? `1px solid ${T.border}` : "none" }}>
              <span style={{ color: T.textTert, width: 44, flexShrink: 0 }}>{new Date(t.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span style={{ flex: 1, minWidth: 0, color: T.text }}>{t.payee ? `${t.payee} — ` : ""}{t.desc}{t.unit ? <span style={{ color: T.textSub }}> · {t.unit}</span> : null}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(t.amount, true)}</span>
            </div>
          ))}
        </div>}
      </div>
    );
  };
  const total = (label, v, color) => <div style={{ display: "flex", alignItems: "center", minHeight: 46, padding: "0 16px", borderTop: `1px solid ${T.border}`, fontWeight: 700, fontSize: 15.5, color: T.text }}><span style={{ flex: 1 }}>{label}</span><span style={{ fontVariantNumeric: "tabular-nums", color: color || T.text }}>{color ? signed(v, true) : money(v, true)}</span></div>;
  const head = (t) => <div style={{ fontSize: 13, fontWeight: 600, color: T.textSub, padding: "12px 16px 4px" }}>{t}</div>;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 10px" }}>
        <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: T.text }}>{mLabel(ym, "long")} {ym.slice(0, 4)}{ym === ymNow() ? <span style={{ fontSize: 13, fontWeight: 500, color: T.textSub }}> · so far</span> : null}</div>
        <div style={{ display: "flex", alignItems: "center", background: "rgba(118,118,128,0.12)", borderRadius: 18, height: 36 }}>
          <button onClick={() => setYm(addMonths(ym, -1))} aria-label="Previous month" style={{ width: 44, height: 36, border: "none", background: "none", fontSize: 18, color: T.text, cursor: "pointer" }}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: T.text, minWidth: 34, textAlign: "center" }}>{mLabel(ym)}</span>
          <button onClick={() => canNext && setYm(addMonths(ym, 1))} aria-label="Next month" disabled={!canNext} style={{ width: 44, height: 36, border: "none", background: "none", fontSize: 18, color: canNext ? T.text : "#C7C7CC", cursor: canNext ? "pointer" : "default" }}>›</button>
        </div>
      </div>
      {p.source === "none" ? <div style={{ ...card, padding: 16, fontSize: 14, color: T.textSub }}>No numbers for {mLabel(ym, "long")} yet.</div> : <>
        <div style={card}>{head("Income")}{p.income.length ? p.income.map((e, i) => lineRow(e, "in", i)) : <div style={{ padding: "8px 16px", color: T.textSub, fontSize: 14 }}>Nothing came in</div>}{total("Total income", p.totalIn)}</div>
        <div style={card}>{head("Expenses")}{p.expenses.length ? p.expenses.map((e, i) => lineRow(e, "out", i)) : <div style={{ padding: "8px 16px", color: T.textSub, fontSize: 14 }}>No expenses</div>}{total("Total expenses", p.totalOut)}</div>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", minHeight: 46, padding: "0 16px", fontWeight: 700, fontSize: 15.5, color: T.text }}><span style={{ flex: 1 }}>Net</span><span style={{ color: netColor(p.net), fontVariantNumeric: "tabular-nums" }}>{signed(p.net, true)}</span></div>
          {p.mortgage > 0.5 && <>
            <div style={{ display: "flex", alignItems: "center", minHeight: 44, padding: "0 16px", borderTop: `1px solid ${T.border}`, fontSize: 15.5, color: T.text }}><span style={{ flex: 1 }}>Mortgage <span style={{ fontSize: 12.5, color: T.textSub }}>from loan info</span></span><span style={{ fontVariantNumeric: "tabular-nums" }}>{money(-p.mortgage, true)}</span></div>
            {total("Cash flow after mortgage", p.cashFlow, netColor(p.cashFlow))}
          </>}
        </div>
        <div style={{ fontSize: 12, color: T.textSub, margin: "-4px 6px 12px" }}>{p.source === "platinum" ? "From Platinum (AppFolio) · tap a line to see the payments" : "From this rental's monthly ledger (Details)"}</div>
      </>}
    </>
  );
}
