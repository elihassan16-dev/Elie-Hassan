// node --test tests/ — locked projections (proforma) + sold-deal records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { finLocked, proformaUpdate, buildDealRecord } from "../src/dealLock.js";

const fin = { purchasePrice: "250000", rehabCosts: "60000", salePrice: "420000", holdPeriod: "6", hmRate: "10", hmLoanPct: "90", gapRate: "15" };

test("finLocked: only Under Contract (and leads) are editable", () => {
  assert.equal(finLocked("Under Contract"), false);
  assert.equal(finLocked("New Leads"), false);
  for (const st of ["Purchased", "Under Construction", "On Market", "Attorney Review", "In Closing", "Sold", "Rental"]) assert.equal(finLocked(st), true, st);
});

test("proforma: saved once when locked, never rewritten while locked", () => {
  const f1 = proformaUpdate({ status: "Purchased", financials: fin });
  assert.ok(f1.proforma && f1.proforma.fields.purchasePrice === "250000");
  assert.ok(f1.proforma.numbers.profit > 0);
  // Fiddling later (locked) doesn't touch the saved original.
  assert.equal(proformaUpdate({ status: "On Market", financials: { ...f1, purchasePrice: "300000" } }), null);
});

test("proforma: back to Under Contract unlocks; re-locking with new numbers keeps the old copy", () => {
  const f1 = proformaUpdate({ status: "Purchased", financials: fin });
  const f2 = proformaUpdate({ status: "Under Contract", financials: f1 });
  assert.equal(f2.proforma.unlocked, true);
  const f3 = proformaUpdate({ status: "Purchased", financials: { ...f2, purchasePrice: "240000" } });
  assert.equal(f3.proforma.fields.purchasePrice, "240000");
  assert.equal(f3.proformaHistory.length, 1);
  assert.equal(f3.proformaHistory[0].fields.purchasePrice, "250000");
  // Re-locked without edits: just drops the unlocked flag.
  const f4 = proformaUpdate({ status: "Purchased", financials: f2 });
  assert.equal(f4.proforma.unlocked, undefined);
  assert.equal(f4.proforma.fields.purchasePrice, "250000");
});

test("deal record: projection vs actual + lenders", () => {
  const f1 = proformaUpdate({ status: "Purchased", financials: fin });
  const p = { id: 7, address: "12 Oak Ln", city: "Trenton", status: "Sold", financials: { ...f1, actualPurchasePrice: "250000", actualBuyingCosts: "5000", actualRehabCosts: "70000", actualHoldingCosts: "4000", actualSalePrice: "430000", sellingDate: "2026-11-01", acHmInterestOverride: "12000", acGapInterestOverride: "6000" } };
  const draws = [{ id: 1, propertyId: 7, funderName: "BIL", amount: 50000, dateFunded: "2026-05-01", paybackDate: "2026-11-02", rate: 12 }];
  const r = buildDealRecord(p, draws);
  assert.equal(r.proforma.profit, f1.proforma.numbers.profit);
  assert.equal(r.actual.sale, 430000);
  assert.equal(r.actual.financing, 18000);
  assert.equal(r.soldDate, "2026-11-01");
  assert.equal(r.lenders.length, 1);
  assert.equal(r.lenders[0].lender, "BIL");
  assert.ok(r.lenders[0].interest > 0);
});
