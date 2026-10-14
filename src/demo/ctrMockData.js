// Preview-harness stand-in for src/contractors/data.js — demo jobs for the
// contractor-portal preview page (ctrdemo.html). Pure math helpers copied
// verbatim from the real module; the hook returns an in-memory sample.
const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const day10 = (n) => days(n).slice(0, 10);

const TUT = typeof window !== "undefined" && /[?&]tut=1/.test(window.location.search);
const ORG = TUT ? { id: "org1", name: "Ritterman Construction", contactName: "Moshe Ritterman", phone: "(732) 555-0208", email: "moshe@example.com" }
  : { id: "org1", name: "Shia Polak Construction", contactName: "Shia Polak", phone: "(848) 555-0133", email: "shia@polakconstruction.com" };
const ME = TUT ? "Moshe Ritterman" : "Shia Polak";
const ORG2 = { id: "org2", name: "MCD Builds LLC", contactName: "Mendel Davids", phone: "(732) 555-0129", email: "mendel@mcdbuilds.com" };
const JOBS = [
  { id: "j1", orgId: "org1", propertyId: 1003, propertyAddress: "1055 Huntingdon Dr, Westampton", title: "Full interior renovation", status: "active", price: 46800, startDate: day10(-12),
    changeOrders: [{ id: 1, label: "Extra beam in the basement", amount: 1200, date: day10(-5) }],
    coRequests: [
      { id: 11, label: "Upgrade to 200-amp panel", status: "awaiting_price", askedBy: "Moshe", at: days(-2) },
      { id: 12, label: "Tile the laundry room", amount: 850, status: "pending" },
    ],
    payments: [{ id: 1, amount: 12000, date: day10(-10), note: "Mobilization" }, { id: 2, amount: 17500, date: day10(-4), note: "Draw 2 — demo + framing" }],
    scope: "yes", sowPdfUrl: "", crew: [] },
  { id: "j2", orgId: "org1", propertyId: 1001, propertyAddress: "417 Lakeview Ter, Pemberton", title: "Roof + siding", status: "active", price: 42000, startDate: day10(-4), changeOrders: [], coRequests: [], payments: [], crew: [] },
  { id: "j3", orgId: "org1", propertyId: 1002, propertyAddress: "32 Oakland Ave, Newfield", title: "Kitchen & two baths", status: "bid", price: 0, changeOrders: [], coRequests: [], payments: [], crew: [] },
  { id: "j4", orgId: "org2", propertyId: 1002, propertyAddress: "32 Oakland Ave, Newfield", title: "Septic replacement", status: "active", price: 28500, startDate: day10(-20), changeOrders: [], coRequests: [], payments: [{ id: 1, amount: 14000, date: day10(-14), note: "Half up front" }], crew: [] },
];
const TASKS = [
  { id: "t1", orgId: "org1", jobId: "j1", text: "Demo the back bathroom down to studs", status: "In Progress", createdBy: "Moshe Hamaoui", createdAt: days(-3), statusBy: ME },
  { id: "t2", orgId: "org1", jobId: "j1", text: "Send photos of the roof decking before you close it up", status: "Not Started", createdBy: "Elie Hassan", createdAt: days(-2) },
  { id: "t3", orgId: "org1", jobId: "j1", text: "Dumpster delivered and placed", status: "Completed", createdBy: "Moshe Hamaoui", createdAt: days(-6), doneBy: ME, doneAt: days(-6) },
  { id: "t4", orgId: "org1", jobId: "j1", direction: "to_team", text: "Need the tile picked for the hall bath", status: "Not Started", createdAt: days(-1) },
];
const MESSAGES = [
  { id: "m1", jobId: "j1", orgId: "org1", side: "team", author: "Moshe Hamaoui", text: "Morning — inspector confirmed Friday 9am for the rough plumbing.", at: days(-1.2), readBy: [] },
  { id: "m2", jobId: "j1", orgId: "org1", side: "contractor", author: ME, text: "We'll be ready. Framing passed yesterday 👍", at: days(-1.1), readBy: ["Moshe Hamaoui"] },
  { id: "m3", jobId: "j1", orgId: "org1", side: "team", author: "Elie Hassan", text: "Looking great guys. Send me pics of the beam when it's in.", at: days(-0.2), readBy: [] },
  // 🚨 preview: an urgent note each way (Goldstone → contractor on j2, contractor → Goldstone on j4)
  { id: "m5", jobId: "j2", orgId: "org1", side: "team", author: "Elie Hassan", text: "Inspector is coming at 1 — the panel cover needs to be on", at: days(-0.05), readBy: [], urgent: true },
  { id: "m6", jobId: "j4", orgId: "org2", side: "contractor", author: "Mendel Davids", text: "Water heater is leaking — need approval to replace today", at: days(-0.03), readBy: [], urgent: true },
];
const SITE = [{ id: "1003", address: "1055 Huntingdon Dr, Westampton", utilities: { water: "on", electric: "on", gas: "off" }, utilitiesBy: {}, permits: {}, permitsBy: {}, events: [
  { id: 1, type: "rough", trade: "Plumbing", date: day10(2), time: "09:00", note: "", by: ME, orgName: ORG.name, at: days(-1) },
  { id: 2, type: "final", trade: "", date: day10(8), time: "", note: "with Moshe", by: "Moshe Hamaoui", orgName: "", at: days(-1) },
] }];

// In-memory store so taps in the preview really update (mark complete, send a
// message, flip a utility…) — like the live tables would.
import { useEffect, useState } from "react";
const KEY = { contractor_orgs: "orgs", contractor_jobs: "jobs", contractor_tasks: "tasks", contractor_messages: "messages", contractor_docs: "docs", site_status: "siteStatus" };
let store = { orgs: [ORG, ORG2], jobs: JOBS, tasks: TASKS, messages: MESSAGES, docs: [], siteStatus: SITE };
const subs = new Set();
const bump = () => subs.forEach((f) => f(store));
const save = async (table, obj) => { const k = KEY[table]; if (!k) return; const list = store[k] || []; const i = list.findIndex((x) => String(x.id) === String(obj.id)); store = { ...store, [k]: i >= 0 ? list.map((x, j) => (j === i ? { ...x, ...obj } : x)) : [...list, obj] }; bump(); };
const remove = async (table, id) => { const k = KEY[table]; if (!k) return; store = { ...store, [k]: (store[k] || []).filter((x) => String(x.id) !== String(id)) }; bump(); };
// What /api/contractors/co-request does on the server: a bid, a contractor's
// change-order request, or a price for a CO Goldstone asked for.
export function mockCoRequest(b) {
  const j = (store.jobs || []).find((x) => String(x.id) === String(b.jobId));
  if (!j) return;
  const now = new Date().toISOString();
  let next;
  if (b.bidAmount != null) next = { ...j, bidAmount: Number(b.bidAmount), bidItems: b.bidItems || null, bidBy: ME, bidAt: now };
  else if (b.requestId != null) next = { ...j, coRequests: (j.coRequests || []).map((r) => (String(r.id) === String(b.requestId) ? { ...r, amount: Number(b.amount), status: "pending", by: ME, at: now } : r)) };
  else next = { ...j, coRequests: [...(j.coRequests || []), { id: Date.now(), label: b.label, amount: Number(b.amount), note: b.note || "", by: ME, at: now, status: "pending" }] };
  save("contractor_jobs", next);
}
export function useContractorData() {
  const [s, setS] = useState(store);
  useEffect(() => { subs.add(setS); return () => subs.delete(setS); }, []);
  return { ...s, save, remove, error: null };
}
export const jobTotal = (j) => (Number(j.price) || 0) + (j.changeOrders || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
export const jobPaid = (j) => (j.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const jobLeft = (j) => jobTotal(j) - jobPaid(j);
export const jobDays = (j) => { if (!j.startDate) return null; const ms = Date.now() - new Date(j.startDate + "T00:00:00").getTime(); return ms < 0 ? 0 : Math.floor(ms / 86400000) + 1; };
export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return iso || ""; } };
export const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
