// 💵 Cash-out analysis for the Claude connector (property_balance_sheet +
// liquidation_forecast). Pure functions — no database, no QuickBooks calls —
// so they're unit-tested in tests/cashOut.test.js. The server wrappers in
// lib/mcpMore.js load the rows and pass them in.
//
// The loan / reserve math is a server copy of the app's Property Balance Sheet
// ("Deal Money", src/GoldstoneApp.jsx: bsSum, bsOut, dmHoldbackOf, the
// FinDealMoney calc's entriesOf / jobOf / bankBal / fullLoan, and dmPotMath's
// reserveLeft). If those rules change in GoldstoneApp.jsx, re-copy them here.
import { n, drawRate, drawBalance, drawInterest, calcNJRTF, INHOUSE_FLAT_FEE, qbMatchScore } from "./dealMath.js";

export const OWNER_NAME = "Elie Hassan";

const bsSum = (arr) => (arr || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
// Pinned payment lists are magnitudes (QuickBooks hands them back with either sign).
const bsOut = (arr) => (arr || []).reduce((s, l) => s + Math.abs(Number(l.amount) || 0), 0);
const dmHoldbackOf = (p) => { const raw = p.constrHoldback; const pins = bsSum(p.qbHoldbackTxns); const hasManual = raw != null && raw !== ""; const hasPins = (p.qbHoldbackTxns || []).length > 0; return (hasPins || hasManual) ? pins + (hasManual ? Number(raw) : 0) : null; };
const nn = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };

// Every loan on a deal, the way the balance sheet lists them: linked QuickBooks
// loan accounts (live balance), manual loan entries, and Bank-Recon adjustments
// linked to the property (not "none"; an emptied auto-float is skipped). Each
// carries its job: "bank" = the hard-money / bank loan, "pot" = credit-line
// money for the down payment + interest reserve, "constr" = construction credit.
export function loanEntries(p, accounts, bankAccounts) {
  const acct = (id) => (accounts || []).find((x) => String(x.id) === String(id)) || null;
  const bal = (id) => { const a = acct(id); return a ? Math.abs(Number(a.balance) || 0) : 0; };
  const nameOf = (id) => { const a = acct(id); return a ? a.name : accounts == null ? "(QuickBooks not loaded)" : "(account not found in QuickBooks)"; };
  const potIds = (p.qbLocPotIds || []).map(String), conIds = (p.qbConstrIds || []).map(String);
  const jobOf = (key) => (conIds.includes(key) ? "constr" : potIds.includes(key) ? "pot" : "bank");
  return [
    ...(p.qbLoanAccounts || []).map((id) => ({ key: String(id), source: "quickbooks", bal: bal(id), name: nameOf(id) })),
    ...(p.qbLoanCustom || []).map((l) => ({ key: "c" + l.id, source: "manual", bal: Math.abs(Number(l.amount) || 0), name: l.name || "Manual entry" })),
    ...(bankAccounts || []).flatMap((b) => (b.adjustments || [])
      .filter((a) => String(a.propertyId || "") === String(p.id) && a.linkKind !== "none" && !(a.autoFloat && Math.abs(Number(a.amount) || 0) < 0.5))
      .map((a) => ({ key: `adj${b.id}_${a.id}`, source: "bank recon", adj: true, bridge: a.linkKind === "bridge", draw: a.linkKind === "draw", bal: Math.abs(Number(a.amount) || 0), name: `${a.label || "Borrowed"} — from ${b.name || "bank account"}` }))),
  ].map((e) => ({ ...e, job: e.adj ? "bank" : jobOf(e.key) }));
}

// Construction draws received (QuickBooks pins + manual + Bank-Recon draws + pending).
function drawsIn(p, bankAccounts) {
  const adjDraws = (bankAccounts || []).flatMap((b) => (b.adjustments || []).filter((a) => String(a.propertyId || "") === String(p.id) && a.linkKind === "draw")).reduce((t, a) => t + Math.abs(Number(a.amount) || 0), 0);
  const pend = (p.dmPendingDraws || []).reduce((t, x) => t + Math.abs(Number(x.amount) || 0), 0);
  return bsOut(p.qbDrawTxns) + bsOut(p.dmDrawCustom) + adjDraws + pend;
}

// Hard money: what's actually drawn (the bank-job balances, floats/bridges
// excluded — the lender charges nothing on his own money moved between
// accounts), the full commitment (drawn + undrawn holdback, which hard money
// charges interest on too), the rate (Actual financing rate, else projected,
// else 9%), and monthly interest on each.
export function hardMoney(p, accounts, bankAccounts) {
  const f = p.financials || {};
  const entries = loanEntries(p, accounts, bankAccounts);
  const bank = entries.filter((e) => e.job === "bank" && !e.bridge);
  const drawn = bank.reduce((t, e) => t + e.bal, 0);
  const hb = dmHoldbackOf(p);
  const draws = drawsIn(p, bankAccounts);
  const undrawn = Math.max(0, (hb || 0) - draws);
  const full = drawn + undrawn;
  const rate = n(f.acHmRate !== undefined && f.acHmRate !== "" ? f.acHmRate : f.hmRate) || 9;
  return {
    lenders: bank.map((e) => ({ name: e.name, balance: e.bal, source: e.source })),
    drawn, holdback: hb, drawsReceived: draws, undrawn, full, rate,
    monthlyOnDrawn: drawn * (rate / 100) / 12, monthlyOnFull: full * (rate / 100) / 12,
  };
}

// Interest reserve still in the pot: the app's dmPotMath reserveLeft.
// "Draws" deals: pot balance − deployed, as all/custom reserve, minus debt
// service paid from it. "Funded up front": total loans − all-in spend.
export function interestReserveLeft(p, accounts, bankAccounts, allIn) {
  const entries = loanEntries(p, accounts, bankAccounts).filter((e) => !e.adj);
  if ((p.dmFinType || "draws") === "upfront") {
    const total = entries.reduce((t, e) => t + e.bal, 0);
    return allIn == null ? null : Math.max(0, total - allIn);
  }
  const potBal = entries.filter((e) => e.job === "pot").reduce((t, e) => t + e.bal, 0);
  const leftPot = potBal - (bsSum(p.qbFloatTxns) + bsSum(p.qbFloatCustom));
  const reserve = (p.dmReserveMode || "all") === "all" ? Math.max(0, leftPot) : nn(p.dmReserveAmt);
  return Math.max(0, reserve - (bsOut(p.qbDebtTxns) + bsOut(p.qbDebtCustom)));
}

// Credit lines / gap money other than the hard-money loan: the pot and
// construction credit accounts plus 🌉 bridges. Rate = the deal's gap / LOC rate
// (Actual financing, else projected, else 15%) — QuickBooks doesn't carry one.
export function creditLines(p, accounts, bankAccounts) {
  const f = p.financials || {};
  const rate = n(f.acGapRate !== undefined && f.acGapRate !== "" ? f.acGapRate : f.gapRate) || 15;
  return loanEntries(p, accounts, bankAccounts)
    .filter((e) => e.job !== "bank" || e.bridge)
    .map((e) => ({ name: e.name, balance: e.bal, kind: e.bridge ? "bridge (own money)" : e.job === "constr" ? "construction credit" : "credit line (down payment / reserve)", rate: e.bridge ? 0 : rate, source: e.source }));
}

// Selling costs line by line — same rules as the app's Selling Costs popup.
export function sellingLines(sp, items) {
  return (items || []).filter((i) => i.resp !== "N/A" && i.resp !== "Maybe").map((i) => {
    let amount;
    if (i.autoType === "commission") amount = Math.round(n(sp) * (parseFloat(i.commissionPct || 0) / 100));
    else if (i.autoType === "flatfee") amount = n(i.amountOverride) > 0 ? n(i.amountOverride) : INHOUSE_FLAT_FEE(sp);
    else if (i.autoType === "tax") { const rtf = calcNJRTF(n(sp)); amount = i.resp === "Seller Pays" ? rtf.total : i.resp === "Split" ? Math.round(rtf.total / 2) : 0; }
    else amount = n(i.amount);
    const title = i.autoType === "commission" ? `Commission ${i.commissionPct || 0}%` : i.title || (i.autoType === "tax" ? "Transfer Tax" : "Other");
    return { title, amount };
  });
}
// Actual selling costs at a sale price: the Actuals list, else the Actuals
// flat total, else the Financial Overview's list (flagged). Projected separately.
export function sellingCosts(f, sp) {
  const ac = f.actualSellingCostItems || [];
  const pj = f.sellingCostItems || [];
  const projLines = sellingLines(f.salePrice, pj);
  const projected = pj.length ? projLines.reduce((s, l) => s + l.amount, 0) : n(f.sellingCosts);
  if (ac.length) { const lines = sellingLines(sp, ac); return { source: "actual", lines, total: lines.reduce((s, l) => s + l.amount, 0), projected, projectedLines: projLines }; }
  if (n(f.actualSellingCosts) > 0) return { source: "actual (total only)", lines: [], total: n(f.actualSellingCosts), projected, projectedLines: projLines };
  const lines = sellingLines(sp, pj);
  return { source: pj.length ? "projected (no actuals yet)" : "projected total", lines, total: pj.length ? lines.reduce((s, l) => s + l.amount, 0) : n(f.sellingCosts), projected, projectedLines: projLines };
}

// The sale closing date the Calendar shows (In Closing only: scheduled
// closing, else the selling date) + the Financial Overview's selling date.
export function closingDates(p) {
  const f = p.financials || {}, pi = p.propertyInfo || {};
  const calendar = p.status === "In Closing" ? String(pi.closingDateScheduled || f.sellingDate || "").slice(0, 10) : "";
  return { calendar, sellingDate: String(f.sellingDate || "").slice(0, 10), scheduled: String(pi.closingDateScheduled || "").slice(0, 10) };
}
export const salePriceOf = (f) => (n(f.actualSalePrice) > 0 ? { price: n(f.actualSalePrice), source: "contract (actual)" } : { price: n(f.salePrice), source: "projected / ARV" });

// Private-lender money on the deal, paid off at closing: principal left +
// interest projected to the closing date. Loans from the owner are flagged —
// they're payoffs, not cash out.
export const isOwnerLoan = (d) => String(d.funderName || "").trim().toLowerCase() === OWNER_NAME.toLowerCase();
export function privateLenderPayoff(draws, closeYmd) {
  return (draws || []).filter((d) => !d.paybackDate).map((d) => {
    const principal = drawBalance(d);
    const interest = drawInterest({ ...d, paybackDate: closeYmd });
    return { lender: d.funderName || "lender", principal, rate: drawRate(d), funded: d.dateFunded || "", interest, total: principal + interest, owner: isOwnerLoan(d) };
  });
}

// Open QuickBooks bills on the deal. A bill's lines carry the project; the
// still-unpaid share is split by line (Balance / TotalAmt).
const vendorKey = (s) => String(s || "").toLowerCase().replace(/\b(llc|inc|corp|co|company|ltd|construction|contracting|builders?|builds|services?|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export const sameVendor = (a, b) => { const x = vendorKey(a), y = vendorKey(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
export function openBillsFor(p, bills) {
  const proj = p.qbProjectId ? String(p.qbProjectId) : "";
  const mine = (ref) => !!ref && ((proj && String(ref.value) === proj) || qbMatchScore(p.address || "", String(ref.name || "").split(":").pop()) >= 0.85);
  const out = [];
  (bills || []).forEach((b) => {
    const bal = n(b.Balance), tot = n(b.TotalAmt);
    if (!(bal > 0)) return;
    const lines = (b.Line || []).filter((l) => mine((l.AccountBasedExpenseLineDetail || l.ItemBasedExpenseLineDetail || {}).CustomerRef));
    if (!lines.length) return;
    const lineAmt = lines.reduce((s, l) => s + n(l.Amount), 0);
    const share = tot > 0 ? Math.round(lineAmt * (bal / tot) * 100) / 100 : lineAmt;
    out.push({ vendor: (b.VendorRef && b.VendorRef.name) || "Vendor", amount: share, due: b.DueDate || "", date: b.TxnDate || "", number: b.DocNumber || "" });
  });
  return out;
}
// Contractor contract balances still to pay (hired jobs only).
const jobTotal = (j) => n(j.price) + (j.changeOrders || []).reduce((s, c) => s + n(c.amount), 0);
const jobPaid = (j) => (j.payments || []).reduce((s, x) => s + n(x.amount), 0);
export function contractorBalances(p, jobs, orgs) {
  const orgName = (id) => ((orgs || []).find((o) => String(o.id) === String(id)) || {}).name || "Contractor";
  return (jobs || []).filter((j) => j && !["bid", "complete", "removed"].includes(j.status)
    && (j.propertyId != null && p.id != null ? String(j.propertyId) === String(p.id) : qbMatchScore(p.address || "", j.propertyAddress || "") >= 0.85))
    .map((j) => ({ vendor: orgName(j.orgId), job: j.title || "Job", contract: jobTotal(j), paid: jobPaid(j), left: Math.max(0, jobTotal(j) - jobPaid(j)) }))
    .filter((x) => x.left > 0);
}
// Bills + contractor balances without counting the same money twice: a bill
// from a vendor that also has a contract balance here is already inside that
// balance (billed but unpaid), so it's listed but not added again.
export function unpaidTotal(bills, contractors) {
  const counted = (bills || []).map((b) => ({ ...b, inContract: (contractors || []).some((c) => sameVendor(b.vendor, c.vendor)) }));
  const billsTotal = counted.filter((b) => !b.inContract).reduce((s, b) => s + b.amount, 0);
  const contractTotal = (contractors || []).reduce((s, c) => s + c.left, 0);
  return { bills: counted, billsTotal, contractTotal, total: billsTotal + contractTotal };
}

// P&L report (raw Intuit JSON or an imported/flattened copy) → all-in spend.
export function pnlAllIn(rpt) {
  if (!rpt) return null;
  if (rpt.income !== undefined && Array.isArray(rpt.rows)) return n(rpt.expenses) + n(rpt.cogs);
  let cogs = 0, exp = 0, seen = false;
  const walk = (rows) => (rows || []).forEach((r) => {
    if (r.Rows && r.Rows.Row) walk(r.Rows.Row);
    if (r.Summary && r.Summary.ColData && r.group) {
      const t = n(r.Summary.ColData[r.Summary.ColData.length - 1].value);
      if (r.group === "COGS") { cogs = t; seen = true; } else if (r.group === "Expenses") { exp = t; seen = true; }
    }
  });
  walk(rpt.Rows && rpt.Rows.Row);
  return seen ? cogs + exp : null;
}

const daysUntil = (fromYmd, toYmd) => { const a = Date.parse(`${fromYmd}T12:00:00Z`), b = Date.parse(`${toYmd}T12:00:00Z`); return isNaN(a) || isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86400000)); };

// One property's balance-sheet picture (property_balance_sheet).
export function balanceSheet(p, ctx) {
  const f = p.financials || {};
  const hm = hardMoney(p, ctx.accounts, ctx.bankAccounts);
  const sale = salePriceOf(f);
  const bills = openBillsFor(p, ctx.bills);
  const ctr = contractorBalances(p, ctx.jobs, ctx.orgs);
  return {
    address: p.address, status: p.status,
    hardMoney: hm,
    interestReserve: interestReserveLeft(p, ctx.accounts, ctx.bankAccounts, ctx.allIn != null ? ctx.allIn : null),
    creditLines: creditLines(p, ctx.accounts, ctx.bankAccounts),
    selling: sellingCosts(f, sale.price),
    unpaid: unpaidTotal(bills, ctr), contractors: ctr,
    sale, closing: closingDates(p),
    privateLenders: privateLenderPayoff(ctx.draws, ctx.today),
  };
}

// One property's estimated cash out at closing (liquidation_forecast).
// sale − selling − hard-money balance − hard-money interest to closing −
// private-lender payoff (principal + interest to closing; owner loans included
// as payoffs) + interest reserve − open bills & contractor balances.
// Credit lines are listed, and only subtracted with includeCreditLines.
export function cashOut(p, ctx, opt = {}) {
  const f = p.financials || {};
  const cal = closingDates(p).calendar;
  const close = opt.closeDate || cal || opt.defaultClose;
  const closeSource = opt.closeDate ? "override" : cal ? "calendar" : "default";
  const sale = opt.salePrice != null ? { price: n(opt.salePrice), source: "override" } : salePriceOf(f);
  const selling = sellingCosts(f, sale.price);
  const hm = hardMoney(p, ctx.accounts, ctx.bankAccounts);
  const days = daysUntil(ctx.today, close);
  // Hard money charges on the full commitment (drawn + undrawn holdback).
  const hmInterest = Math.round(hm.full * (hm.rate / 100) / 365 * days);
  const lenders = privateLenderPayoff(ctx.draws, close);
  const plPayoff = lenders.reduce((s, l) => s + l.total, 0);
  const ownerPayoff = lenders.filter((l) => l.owner).reduce((s, l) => s + l.total, 0);
  const reserve = interestReserveLeft(p, ctx.accounts, ctx.bankAccounts, ctx.allIn != null ? ctx.allIn : null) || 0;
  const unpaid = unpaidTotal(openBillsFor(p, ctx.bills), contractorBalances(p, ctx.jobs, ctx.orgs));
  const credit = creditLines(p, ctx.accounts, ctx.bankAccounts).filter((c) => c.rate > 0);
  const creditTotal = credit.reduce((s, c) => s + c.balance, 0);
  const net = sale.price - selling.total - hm.drawn - hmInterest - plPayoff + reserve - unpaid.total - (opt.includeCreditLines ? creditTotal : 0);
  return {
    address: p.address, status: p.status, close, closeSource, days,
    salePrice: sale.price, saleSource: sale.source, selling: selling.total, sellingSource: selling.source,
    hmBalance: hm.drawn, hmFull: hm.full, hmRate: hm.rate, hmInterest,
    privateLenders: lenders, privatePayoff: plPayoff, ownerPayoff,
    reserve, unpaid: unpaid.total, unpaidDetail: unpaid,
    creditLines: credit, creditTotal, creditSubtracted: !!opt.includeCreditLines,
    cashOut: Math.round(net),
  };
}
