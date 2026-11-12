// node --test tests/ — finProfit's breakdown pieces add up to the profit it
// returns (the Cash-Out "Profit" pop-up shows them as a table, Elie 11/12/26).
import { test } from "node:test";
import assert from "node:assert/strict";
import { finProfit } from "../lib/dealMath.js";

const f = {
  purchasePrice: "250000", rehabCosts: "60000", salePrice: "420000", holdPeriod: "6", hmRate: "10", hmLoanPct: "90", gapRate: "15",
  buyingCostItems: [{ id: 3, title: "Misc", resp: "Buyer Pays", amount: "4000" }],
  sellingCostItems: [{ id: 1, autoType: "commission", resp: "Seller Pays", commissionPct: "2.5" }, { id: 2, resp: "Seller Pays", amount: "1500" }],
  holdingCostItems: [{ id: 1, title: "Taxes", amount: "6000", perYear: true }, { id: 2, title: "Utilities", amount: "150" }],
  actualPurchasePrice: "248000", actualBuyingCosts: "7311", actualRehabCosts: "71250", actualHoldingCosts: "5120",
  actualSalePrice: "415000", actualSellingCostItems: [{ id: 1, autoType: "commission", resp: "Seller Pays", commissionPct: "2.5" }],
  acHmInterestOverride: "18400", acGapInterestOverride: "9100",
};
test("actual pieces add up to acNet", () => {
  const fp = finProfit(f, "In Closing", "");
  const a = fp.actual;
  assert.equal(a.sale - a.selling - a.hmInterest - a.gapInterest - (a.purchase + a.buying + a.rehab + a.holding), fp.acNet);
  assert.equal(a.selling, 10375);
});
test("projected pieces add up to netProfit", () => {
  const fp = finProfit(f, "In Closing", "");
  const p = fp.projected;
  assert.ok(Math.abs(p.sale - p.selling - p.interest - (p.purchase + p.buying + p.rehab + p.holding) - fp.netProfit) < 1);
});

test("open bills come off only when the rehab is the QuickBooks number (or Elie says so)", () => {
  const base = { ...f, acOpenBills: "12000" };
  const typed = finProfit(base, "In Closing", "");                       // rehab typed by hand → all-in
  const qb = finProfit({ ...base, acRehabSrc: "qb" }, "In Closing", "");   // imported → paid so far
  assert.equal(typed.actual.openBills, 0);
  assert.equal(qb.actual.openBills, 12000);
  assert.equal(typed.acNet - qb.acNet, 12000);
  assert.equal(finProfit({ ...base, acRehabSrc: "qb", acOpenBillsMode: "incl" }, "", "").actual.openBills, 0);
  assert.equal(finProfit({ ...base, acOpenBillsMode: "add" }, "", "").actual.openBills, 12000);
  assert.equal(finProfit({ ...base, acRehabSrc: "qb" }, "", "", { openBills: 500 }).actual.openBills, 500); // live number wins
});
