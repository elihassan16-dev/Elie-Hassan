// Rentals P&L engine — pure JS (no React), shared by the Rentals pages
// (src/rentalsPL.jsx re-exports it) and the Claude connector on the server.
import { propMonth, forMonth } from "./platinumLive.js";

// ── months & ranges ──
export const pad = (n) => String(n).padStart(2, "0");
export const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const addMonths = (ym, k) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const monthsBetween = (a, b) => { const out = []; if (!a || !b || a > b) return out; let x = a; let g = 0; while (x <= b && g++ < 240) { out.push(x); x = addMonths(x, 1); } return out; };
export const mLabel = (ym, style = "short") => { const [y, m] = String(ym).split("-").map(Number); if (!y) return ""; const d = new Date(y, m - 1, 1); return style === "year" ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : d.toLocaleDateString(undefined, { month: style }); };
export const OWNER = /owner\s*(distribution|draw|contribution|disburse)|distribution to owner/i;
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
export const IN_ORDER = ["Rent", "Prepaid rent", "Late fees", "Deposits", "Other income", "Other (not itemized)"];
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
export const rankIn = (c) => { const i = IN_ORDER.indexOf(String(c).split(" – ")[0]); return i < 0 ? 50 : i; };
// Rent first (units in order), then prepaid, late fees, deposits, other.
export const sortIncome = (list) => list.sort((a, b) => rankIn(a.cat) - rankIn(b.cat) || (a.cat.startsWith("Rent – ") && b.cat.startsWith("Rent – ") ? a.cat.localeCompare(b.cat, undefined, { numeric: true }) : b.amount - a.amount));
// Across several properties, per-unit rent lines fold back into one "Rent".
export const foldUnits = (cat) => (cat.startsWith("Rent – ") ? "Rent" : cat);

// ── Reversals (Elie 10/6/26): an NSF / bounced / returned payment shows up
// as "Rental Income - NSF reversal receipt for Reference #…" (negative in
// AppFolio's Cash Out). It cancels an earlier payment: match it to the most
// recent un-reversed income line of the same property and amount (≤45 days
// before) and take away that line's money in that line's month + category.
export const REV = /\bnsf\b|reversal|returned (payment|check|item)|bounced|chargeback/i;
export const INCOME_DESC = /^(rental income|late fees?|subsidized rent|legal fees-income|other income|tenant)/i;
export const isReversal = (t) => REV.test(String(t.desc || "")) || (t.neg && (t.dir === "in" || INCOME_DESC.test(String(t.desc || ""))));
export const effCache = new WeakMap();
// basis "entry" (Elie 10/6/26 — to cross-check with AppFolio): every line in
// the month it was ENTERED, a bounced payment in the month it bounced.
export function effTxns(live, key, basis) {
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
export const isHap = (t) => /\bhap\b|subsid|sec(tion)?\s?8/i.test(`${t.desc} ${t.ref || ""}`);
export function rentCatFn(live, key, multi) {
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
export const NAMES_MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b|\b(0?[1-9]|1[0-2])\/20\d{2}\b/i;
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
    withTxMonths(effTxns(ctx.live, key), r.txMonths).forEach(({ t, ym, rev, orig, part, moved }) => {
      const base = rev ? (orig || { ...t, dir: "in" }) : t;
      if (base.dir !== "in" || OWNER.test(`${t.desc} ${t.payee}`)) return;
      const c = catOf(base), kind = kindOf(c);
      if (!kind) return;
      const amt = part != null ? part : t.amount;
      out.push({ date: t.date, forYm: ym, explicit: moved || (kind !== "prepaid" && (rev ? true : NAMES_MONTH.test(t.desc || ""))), unit: c.startsWith("Rent – ") ? c.slice(7) : "", kind: moved && kind === "prepaid" ? "rent" : kind, amount: rev ? -amt : amt, desc: t.desc, rev, hap: isHap(base), src: "platinum" });
    });
  }
  (r.qbPins || []).forEach((p) => {
    const c = p.cat || "";
    if (!/^Rent\b|^Late fees/.test(c)) return;
    pinParts(p).forEach((x) => out.push({ date: p.date, forYm: x.ym, explicit: x.split || !!p.forYm || NAMES_MONTH.test(p.desc || ""), unit: c.startsWith("Rent – ") ? c.slice(7) : "", kind: c.startsWith("Rent") ? "rent" : "late", amount: x.amount, desc: p.desc || p.accountName || "Paid to you (QuickBooks)", rev: false, hap: false, src: "pin", part: x.split }));
  });
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Elie's own month for a Platinum line (10/7/26): r.txMonths[txId] = {ym} or
// {split:[{ym,amount}]} (adds up to the line). Only for "month it's for"
// counting — the entry date never changes. A bounced payment follows the
// payment it cancels. Each entry → one or more {…x, ym, part, moved, splitOf}.
export const txOvParts = (o, src) => {
  if (!o || !src) return null;
  const amt = Math.abs(Number(src.amount) || 0);
  if (Array.isArray(o.split) && o.split.length && Math.abs(o.split.reduce((s, p) => s + (Number(p.amount) || 0), 0) - amt) < 0.01) return o.split.map((p) => ({ ym: p.ym, amount: Number(p.amount) }));
  if (o.ym && /^\d{4}-\d{2}$/.test(o.ym)) return [{ ym: o.ym, amount: amt }];
  return null;
};
export function withTxMonths(eff, txMonths) {
  if (!txMonths || !Object.keys(txMonths).length) return eff;
  const out = [];
  eff.forEach((x) => {
    const src = x.rev ? x.orig : x.t;
    const parts = src && txOvParts(txMonths[src.id], src);
    if (!parts) { out.push(x); return; }
    const scale = (Number(x.t.amount) || 0) / (Number(src.amount) || 1);
    parts.forEach((p) => out.push({ ...x, ym: p.ym, part: Math.round(p.amount * scale * 100) / 100, moved: true, splitOf: parts.length > 1 ? src.amount : undefined }));
  });
  return out;
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
    const eff = (ctx.basis === "entry" ? effTxns(ctx.live, key, "entry") : withTxMonths(effTxns(ctx.live, key), r.txMonths)).filter((x) => x.ym === ym && notOwner(x.t)); // by the month each line is FOR (or entered)
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
      eff.forEach(({ t, rev, orig, part, moved, splitOf }) => {
        const amt = part != null ? part : t.amount;
        const tag = moved ? { forYm: ym, moved: true, splitOf, full: (rev ? orig : t)?.amount } : {};
        if (!rev) { add(t.dir === "in" ? income : expenses, catOf(t), amt, isPrepaid(t) || moved ? { ...t, ...(isPrepaid(t) ? { prepaid: true } : {}), ...tag, amount: amt } : t); return; }
        // A reversal takes money away from the line it cancels (or, unmatched,
        // from the income category its own description names).
        const base = orig || { ...t, dir: "in" };
        add(income, catOf(base), -amt, { ...t, dir: "in", amount: -amt, rev: true, forYm: moved ? ym : orig ? forMonth(orig) : ym, reverses: orig ? `${orig.date} payment` : "" });
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

