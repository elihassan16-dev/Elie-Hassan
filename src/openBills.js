// 👷 Open bills on a deal — ONE place for the Financial Overview, the Cash-Out
// Analysis and the profit everywhere (Elie 11/12/26: "open bills should be
// subtracted. Absolutely."). The Actual profit takes them off on top of the
// rehab QuickBooks shows as paid; finProfit reads the stored copy
// (financials.acOpenBills) so the Portfolio and the Claude connector match too,
// and the screens that can work it out live pass the live number.
//
// Open bills = every contractor company not paid in full on the deal (hired
// jobs' contract − job payments − QuickBooks payments on the deal's project
// that match the company and aren't pinned to a job yet) unless unticked in
// Cash-Out (p.coBillsOff), + the bills typed per vendor (p.coBills).
import { useEffect, useState } from "react";
import { jobTotal, jobPaid, jobPropertyOf } from "./contractors/data";
import { qbAuthFetch } from "./net";

export const SKIP_JOB = ["bid", "awaiting_price", "removed"];
const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };

export const dealJobs = (p, jobs, props) => (jobs || []).filter((j) => j && !SKIP_JOB.includes(j.status) && String((jobPropertyOf(j, props) || {}).id) === String(p.id));

// Contractors still to be paid on a deal, per company (Elie 10/30/26).
export function contractorOwed(p, { jobs, orgs, props, qbTx }) {
  const mine = dealJobs(p, jobs, props);
  const items = p.qbProjectId && qbTx ? qbTx[p.qbProjectId] : null;
  const byOrg = {};
  mine.forEach((j) => { (byOrg[j.orgId] = byOrg[j.orgId] || []).push(j); });
  return Object.entries(byOrg).map(([orgId, js]) => {
    const vendor = ((orgs || []).find((o) => String(o.id) === String(orgId)) || {}).name || "Contractor";
    const contract = js.reduce((t, j) => t + jobTotal(j), 0);
    const pinned = js.reduce((t, j) => t + jobPaid(j), 0);
    const have = new Set(js.flatMap((j) => (j.payments || []).map((x) => x.qbId).filter(Boolean)));
    const excl = new Set(js.flatMap((j) => j.qbExcluded || []));
    const word = (vendor.trim().split(/\s+/)[0] || "").toLowerCase();
    const kOf = (t) => t.id || `${t.date}|${t.vendor}|${t.amount}`;
    // A payment typed on the job by hand (no QuickBooks link) with the same
    // amount as a QuickBooks line is that line — never count it twice.
    const typed = js.flatMap((j) => (j.payments || []).filter((x) => !x.qbId).map((x) => Math.round(Number(x.amount) || 0)));
    const qbNew = items && word.length >= 3 ? items.filter((t) => (t.section || "").toLowerCase() !== "income" && [t.vendor, t.memo].filter(Boolean).join(" ").toLowerCase().includes(word) && !have.has(kOf(t)) && !excl.has(kOf(t)))
      .filter((t) => { const i = typed.indexOf(Math.round(Math.abs(Number(t.amount) || 0))); if (i < 0) return true; typed.splice(i, 1); return false; })
      .reduce((t, x) => t + Math.abs(Number(x.amount) || 0), 0) : 0;
    const paid = pinned + qbNew;
    return { key: `org:${orgId}`, vendor, jobs: js.length, contract, paid, qbNew, left: Math.max(0, Math.round(contract - paid)) };
  }).filter((c) => c.left > 0.5 && c.contract > 0);
}

// Everything owed on the deal → { ctrBills (each with .on), bills, count, total }.
export function openBillsOf(p, ctr) {
  const bills = (p.coBills || []).filter((b) => num(b.amount));
  const off = new Set((p.coBillsOff || []).map(String));
  const ctrBills = contractorOwed(p, ctr).map((c) => ({ ...c, on: !off.has(c.key) }));
  const total = Math.round(bills.reduce((s, b) => s + num(b.amount), 0) + ctrBills.reduce((s, c) => s + (c.on ? c.left : 0), 0));
  return { bills, ctrBills, count: bills.length + ctrBills.filter((c) => c.on).length, total };
}

// QuickBooks transactions per project, shared 10-minute cache (Cash-Out + Financial Overview).
const qbTxCache = {}; // projectId → {at, items}
const qbTxWait = {};
export function useQbProjectTx(ids) {
  const key = [...new Set((ids || []).filter(Boolean).map(String))].sort().join(",");
  const [tx, setTx] = useState(() => Object.fromEntries(Object.entries(qbTxCache).map(([k, v]) => [k, v.items])));
  useEffect(() => {
    let alive = true;
    key.split(",").filter(Boolean).filter((id) => !qbTxCache[id] || Date.now() - qbTxCache[id].at > 600000).forEach((id) => {
      const job = qbTxWait[id] || (qbTxWait[id] = qbAuthFetch(`/api/quickbooks/transactions?customerId=${encodeURIComponent(id)}`)
        .then((d) => { qbTxCache[id] = { at: Date.now(), items: (d && d.items) || [] }; })
        .catch(() => { qbTxCache[id] = { at: Date.now(), items: [], failed: true }; }) // unreachable — job payments still count
        .finally(() => { delete qbTxWait[id]; }));
      job.then(() => { if (alive) setTx((m) => ({ ...m, [id]: qbTxCache[id].items })); });
    });
    return () => { alive = false; };
  }, [key]);
  // Ready = every project asked for has an answer (or failed).
  const ready = key.split(",").filter(Boolean).every((id) => qbTxCache[id]);
  return { tx, ready };
}

// One deal's open bills, live. `ready` = contractor data + any QuickBooks lines it
// needs are in (only then is the number safe to store on the deal).
export function useOpenBills(p, props, ctrData) {
  const { jobs, orgs } = ctrData || {};
  const needsQb = !!(p && p.qbProjectId && dealJobs(p, jobs, props).length);
  const { tx, ready: qbReady } = useQbProjectTx(needsQb ? [p.qbProjectId] : []);
  if (!p) return { total: 0, ready: false, ctrBills: [], bills: [], count: 0 };
  const ob = openBillsOf(p, { jobs, orgs, props, qbTx: tx });
  return { ...ob, ready: Array.isArray(jobs) && Array.isArray(orgs) && (!needsQb || qbReady) };
}

// Keep financials.acOpenBills (what finProfit reads everywhere) equal to the live
// number. Called from the screens that work it out live.
export function syncOpenBills(p, live, ready, onUpdate) {
  if (!p || !ready || !onUpdate) return;
  const f = p.financials || {};
  if (Math.round(num(f.acOpenBills)) === Math.round(live) && (live !== 0 || f.acOpenBills !== undefined)) return;
  if (live === 0 && f.acOpenBills === undefined) return; // nothing to store
  onUpdate(p.id, "financials", { ...f, acOpenBills: String(Math.round(live)) });
}
