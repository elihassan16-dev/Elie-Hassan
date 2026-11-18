// 🔒 Locked projections + 📚 sold-deal records — pure functions (no React), so
// the app and the tests share them. See src/dealHistory.jsx for the why.
import { finProfit, drawsForProperty, drawInterest, drawRate } from "../lib/dealMath.js";

const UNLOCKED = ["", "New Leads", "Under Contract"];
export const finLocked = (status) => !!status && !UNLOCKED.includes(status);

// The inputs behind the projected column.
export const PROFORMA_KEYS = ["purchasePrice", "buyingCostItems", "buyingCosts", "rehabCosts", "holdingCostItems", "annualHoldingCosts", "holdPeriod", "salePrice", "sellingCostItems", "sellingCosts", "transferTaxResp", "hmLoanPct", "rehabFinPct", "hmRate", "hmOrigPct", "hmDocFee", "gapRate", "hmInterest", "locInterest", "locLoan"];
export const pickProforma = (f) => Object.fromEntries(PROFORMA_KEYS.filter((k) => f && f[k] !== undefined).map((k) => [k, f[k]]));
const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };

// Projected numbers in the Deal-summary shape.
export function projectedNumbers(f) {
  const fp = finProfit(f || {}, "Under Contract", "");
  const p = fp.projected;
  return { purchase: p.purchase, buying: Math.round(p.buying), rehab: p.rehab, holding: p.holding, sale: p.sale, selling: Math.round(p.selling), financing: Math.round(p.interest), profit: Math.round(fp.netProfit), cashIn: Math.round(fp.equityRequired || 0), months: num(f && f.holdPeriod) };
}

// The proforma to save for a property right now, or null when nothing changes.
export function proformaUpdate(p) {
  const f = p.financials || {};
  if (!finLocked(p.status)) {
    // Back to Under Contract: unlock (the saved copy stays until it's re-locked).
    if (f.proforma && !f.proforma.unlocked) return { ...f, proforma: { ...f.proforma, unlocked: true } };
    return null;
  }
  const fields = pickProforma(f);
  if (f.proforma && !f.proforma.unlocked) return null;               // locked + saved: never touch
  if (f.proforma && JSON.stringify(f.proforma.fields) === JSON.stringify(fields)) {
    const { unlocked, ...rest } = f.proforma; return { ...f, proforma: rest }; // re-locked, no edits
  }
  const rec = { at: new Date().toISOString(), status: p.status, fields, numbers: projectedNumbers(f) };
  return { ...f, proforma: rec, ...(f.proforma ? { proformaHistory: [...(f.proformaHistory || []), f.proforma].slice(-6) } : {}) };
}

// One sold deal's permanent record.
export function buildDealRecord(p, draws) {
  const f = p.financials || {};
  const fp = finProfit(f, p.status, (p.propertyInfo || {}).closingDateScheduled);
  const a = fp.actual;
  const pro = f.proforma && f.proforma.numbers ? f.proforma.numbers : projectedNumbers(f);
  const lenders = drawsForProperty(p, draws || []).map((d) => ({
    lender: d.funderName || "Lender", amount: Math.round(num(d.amount)), funded: d.dateFunded || "", paidBack: d.paybackDate || "",
    rate: Math.round(drawRate(d) * 10000) / 100, interest: Math.round(drawInterest(d) || 0),
  }));
  return {
    id: String(p.id), address: p.address || "", city: p.city || "", state: p.state || "",
    purchaseDate: f.purchaseDate || "", soldDate: f.sellingDate || (p.propertyInfo || {}).closingDateScheduled || "",
    proforma: pro, proformaAt: (f.proforma && f.proforma.at) || "",
    actual: num(f.actualSalePrice) > 0 ? { purchase: a.purchase, buying: a.buying, rehab: a.rehab, openBills: a.openBills || 0, holding: a.holding, sale: a.sale, selling: Math.round(a.selling), financing: Math.round(a.hmInterest + a.gapInterest), profit: Math.round(fp.acNet), cashIn: Math.round(fp.equityRequired || 0) } : null,
    hardMoney: { loan: Math.round(num(f.acHmLoanAmt) || 0), rate: num(f.acHmRate !== undefined ? f.acHmRate : f.hmRate), interest: Math.round(a.hmInterest || 0) },
    lenders,
    qbProjectId: p.qbProjectId || "",
  };
}

