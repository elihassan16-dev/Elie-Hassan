// node --test tests/  — the cash-out math behind the connector's
// property_balance_sheet and liquidation_forecast tools (lib/cashOut.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loanEntries, hardMoney, interestReserveLeft, creditLines, sellingLines, sellingCosts,
  closingDates, privateLenderPayoff, manualBills, contractorBalances, pnlAllIn, cashOut, balanceSheet,
} from "../lib/cashOut.js";

const accounts = [
  { id: "10", name: "Kiavi Loan — 12 Main", balance: -300000 },   // hard money (bank job)
  { id: "20", name: "TD LOC", balance: -60000 },                   // pot (down payment / reserve)
  { id: "30", name: "Construction LOC", balance: -25000 },         // construction credit
];
const baseProp = () => ({
  id: 1, address: "12 Main St, Lakewood", status: "In Closing",
  qbLoanAccounts: ["10", "20", "30"], qbLocPotIds: ["20"], qbConstrIds: ["30"],
  qbFloatTxns: [{ amount: 30000 }], qbDebtTxns: [{ amount: -4000 }, { amount: 4000 }], // magnitudes: 8,000 paid
  constrHoldback: "80000", qbDrawTxns: [{ amount: 50000 }],
  propertyInfo: { closingDateScheduled: "2026-12-15" },
  financials: {
    hmRate: "10", gapRate: "12", salePrice: "500000", actualSalePrice: "480000", sellingDate: "2026-12-20",
    sellingCostItems: [{ autoType: "commission", commissionPct: "2", resp: "Seller Pays" }, { autoType: "tax", resp: "Seller Pays" }, { title: "Misc", amount: "1000", resp: "Seller Pays" }],
    actualSellingCostItems: [{ autoType: "commission", commissionPct: "2", resp: "Seller Pays" }, { autoType: "flatfee", resp: "Seller Pays", amountOverride: "" }, { title: "Attorney", amount: "1500", resp: "Seller Pays" }, { title: "Maybe line", amount: "999", resp: "Maybe" }],
  },
});
const bankAccounts = [{ id: "b1", name: "Chase", adjustments: [
  { id: 1, propertyId: 1, linkKind: "bridge", amount: -5000, label: "Float" },
  { id: 2, propertyId: 1, linkKind: "none", amount: -9999 },
  { id: 3, propertyId: 2, linkKind: "loan", amount: -7000 },
] }];

test("loan entries get the balance sheet's jobs; bridges count as bank-recon loans", () => {
  const e = loanEntries(baseProp(), accounts, bankAccounts);
  assert.deepEqual(e.map((x) => [x.key, x.job, x.bal]), [["10", "bank", 300000], ["20", "pot", 60000], ["30", "constr", 25000], ["adjb1_1", "bank", 5000]]);
  assert.equal(e[3].bridge, true);
});

test("hard money: drawn excludes bridges; full adds the undrawn holdback; interest on both", () => {
  const hm = hardMoney(baseProp(), accounts, bankAccounts);
  assert.equal(hm.drawn, 300000);
  assert.equal(hm.undrawn, 30000);           // 80,000 holdback − 50,000 drawn
  assert.equal(hm.full, 330000);
  assert.equal(hm.rate, 10);
  assert.equal(Math.round(hm.monthlyOnDrawn), 2500);
  assert.equal(Math.round(hm.monthlyOnFull), 2750);
  assert.equal(hm.lenders[0].name, "Kiavi Loan — 12 Main");
});

test("actual financing rate wins over projected", () => {
  const p = baseProp(); p.financials.acHmRate = "11.5";
  assert.equal(hardMoney(p, accounts, bankAccounts).rate, 11.5);
});

test("interest reserve = pot − deployed − debt service paid (all mode), custom amount, up-front mode", () => {
  assert.equal(interestReserveLeft(baseProp(), accounts, bankAccounts, null), 60000 - 30000 - 8000);
  const c = baseProp(); c.dmReserveMode = "custom"; c.dmReserveAmt = "$12,000";
  assert.equal(interestReserveLeft(c, accounts, bankAccounts, null), 4000);
  const u = baseProp(); u.dmFinType = "upfront";
  assert.equal(interestReserveLeft(u, accounts, bankAccounts, 350000), 385000 - 350000);
  assert.equal(interestReserveLeft(u, accounts, bankAccounts, null), null);
});

test("credit lines: pot + construction at the deal's gap rate; bridges at 0%", () => {
  const c = creditLines(baseProp(), accounts, bankAccounts);
  assert.deepEqual(c.map((x) => [x.balance, x.rate]), [[60000, 12], [25000, 12], [5000, 0]]);
});

test("selling costs: actual list at the contract price, Maybe/N/A skipped, projected shown separately", () => {
  const f = baseProp().financials;
  const s = sellingCosts(f, 480000);
  assert.equal(s.source, "actual");
  assert.deepEqual(s.lines.map((l) => l.amount), [9600, 1500, 1500]); // 2% · flat fee tier (≤500k) · attorney
  assert.equal(s.total, 12600);
  const proj = sellingLines("500000", f.sellingCostItems).reduce((t, l) => t + l.amount, 0);
  assert.equal(s.projected, proj);
  const none = sellingCosts({ ...f, actualSellingCostItems: [] }, 480000);
  assert.equal(none.source, "projected (no actuals yet)");
});

test("calendar closing date only for In Closing deals", () => {
  assert.equal(closingDates(baseProp()).calendar, "2026-12-15");
  const p = baseProp(); p.status = "On Market";
  assert.equal(closingDates(p).calendar, "");
});

test("private-lender payoff projects interest to the closing date; owner loans are flagged", () => {
  const draws = [
    { id: 1, funderName: "Abe Lender", amount: 100000, rate: 12, dateFunded: "2026-01-01" },
    { id: 2, funderName: "Elie Hassan", amount: 50000, rate: 0, dateFunded: "2026-02-01" },
    { id: 3, funderName: "Old", amount: 1, dateFunded: "2025-01-01", paybackDate: "2025-06-01" },
  ];
  const r = privateLenderPayoff(draws, "2027-01-01");
  assert.equal(r.length, 2);
  assert.equal(Math.round(r[0].interest), 12000);       // 12% × 365 days
  assert.equal(r[1].owner, true);
  assert.equal(r[1].interest, 0);
  assert.equal(r[1].total, 50000);
});

test("open bills are the ones the user enters; blanks ignored", () => {
  const m = manualBills([{ amount: 1200, note: "Plumber" }, { amount: "350", note: "PSE&G" }, { amount: 0 }]);
  assert.equal(m.total, 1550);
  assert.equal(m.bills.length, 2);
  assert.equal(manualBills(undefined).total, 0);
});

test("contractor balances are listed for reference (hired jobs on this property only)", () => {
  const jobs = [
    { id: "j1", propertyId: 1, orgId: "o1", status: "active", title: "Full reno", price: 50000, changeOrders: [{ amount: 5000 }], payments: [{ amount: 40000 }] },
    { id: "j2", propertyId: 1, orgId: "o2", status: "bid", price: 9000 },
    { id: "j3", propertyId: 2, orgId: "o1", status: "active", price: 1000 },
  ];
  const c = contractorBalances(baseProp(), jobs, [{ id: "o1", name: "MCD Builds LLC" }]);
  assert.deepEqual(c.map((x) => [x.vendor, x.left]), [["MCD Builds LLC", 15000]]);
  // ...and never change the cash out.
  const withJobs = cashOut(baseProp(), ctx({ jobs, orgs: [] }), { defaultClose: "2026-12-31" });
  const without = cashOut(baseProp(), ctx(), { defaultClose: "2026-12-31" });
  assert.equal(withJobs.cashOut, without.cashOut);
});

test("P&L all-in from a raw Intuit report or an imported copy", () => {
  assert.equal(pnlAllIn({ income: 1, rows: [], cogs: 100, expenses: 50 }), 150);
  const raw = { Rows: { Row: [
    { group: "COGS", Summary: { ColData: [{ value: "Total" }, { value: "1,000.00" }] } },
    { group: "Expenses", Summary: { ColData: [{ value: "Total" }, { value: "250" }] } },
  ] } };
  assert.equal(pnlAllIn(raw), 1250);
  assert.equal(pnlAllIn(null), null);
});

const ctx = (extra = {}) => ({ accounts, bankAccounts, draws: [
  { funderName: "Abe Lender", amount: 100000, rate: 12, dateFunded: "2026-01-01" },
  { funderName: "Elie Hassan", amount: 20000, rate: 0, dateFunded: "2026-03-01" },
], jobs: [], orgs: [], today: "2026-10-31", allIn: null, ...extra });

test("cash out = sale − selling − HM − HM interest − private payoff + reserve − open bills entered", () => {
  const p = baseProp();
  const r = cashOut(p, ctx(), { defaultClose: "2026-12-31", openBills: [{ amount: 2500, note: "Electrician" }] });
  assert.equal(r.close, "2026-12-15");
  assert.equal(r.closeSource, "calendar");
  assert.equal(r.days, 45);
  const hmInt = Math.round(300000 * 0.10 / 365 * 45);  // on the drawn balance only
  assert.equal(r.hmInterest, hmInt);
  const plInt = 100000 * 0.12 / 365 * 348;               // Jan 1 → Dec 15
  const expected = 480000 - 12600 - 300000 - hmInt - (100000 + plInt + 20000) + 22000 - 2500;
  assert.equal(r.cashOut, Math.round(expected));
  assert.equal(r.ownerPayoff, 20000);                    // owner 0% loan = payoff, not cash out
  assert.equal(r.creditSubtracted, false);
});

test("overrides: sale price recomputes selling costs; closing override; default date for undated deals", () => {
  const p = baseProp(); p.status = "On Market";
  const r = cashOut(p, ctx(), { salePrice: 520000, defaultClose: "2026-12-31" });
  assert.equal(r.close, "2026-12-31");
  assert.equal(r.closeSource, "default");
  assert.equal(r.saleSource, "override");
  assert.equal(r.selling, 10400 + 2000 + 1500);          // 2% of 520k + flat fee tier (>500k) + attorney
  const o = cashOut(p, ctx(), { closeDate: "2026-11-30", defaultClose: "2026-12-31" });
  assert.equal(o.close, "2026-11-30");
  assert.equal(o.closeSource, "override");
});

test("credit lines subtract only when asked", () => {
  const p = baseProp();
  const a = cashOut(p, ctx(), { defaultClose: "2026-12-31" });
  const b = cashOut(p, ctx(), { defaultClose: "2026-12-31", includeCreditLines: true });
  assert.equal(a.cashOut - b.cashOut, 85000);            // TD LOC 60k + construction 25k (bridge excluded)
});

test("balance sheet bundles every field", () => {
  const b = balanceSheet(baseProp(), ctx());
  assert.equal(b.hardMoney.drawn, 300000);
  assert.equal(b.interestReserve, 22000);
  assert.equal(b.selling.total, 12600);
  assert.equal(b.sale.price, 480000);
  assert.equal(b.closing.calendar, "2026-12-15");
  assert.equal(b.privateLenders.length, 2);
});

test("connector text: every field shows, goal over/under, owner payoff called out", async () => {
  const { fmtBalanceSheet, fmtForecast } = await import("../lib/mcpMore.js");
  const sheet = fmtBalanceSheet(balanceSheet(baseProp(), ctx()));
  for (const s of ["$300,000 drawn", "full commitment $330,000", "Interest per month: $2,500 on drawn · $2,750 on full", "Interest reserve left: $22,000", "TD LOC $60,000", "Selling costs — actual: $12,600", "projected $", "Elie Hassan (owner)", "Sale price: $480,000", "closing (Calendar): 2026-12-15"]) assert.ok(sheet.includes(s), `missing: ${s}\n${sheet}`);
  const r = [cashOut(baseProp(), ctx(), { defaultClose: "2026-12-31", openBills: [{ amount: 2500, note: "Electrician" }] })];
  const over = fmtForecast(r, r[0].cashOut - 1000, "2026-12-31");
  assert.match(over, /Goal \$[\d,]+: over by \$1,000\./);
  const under = fmtForecast(r, r[0].cashOut + 2500, "2026-12-31");
  assert.match(under, /short by \$2,500\./);
  assert.match(under, /after repaying \$20,000 of owner loans/);
  assert.match(under, /Elie Hassan — owner loan, payoff/);
  assert.match(under, /open bills \$2,500 \(Electrician \$2,500\)/);
  assert.match(sheet, /Contractor balances left \(reference — not counted/);
});
