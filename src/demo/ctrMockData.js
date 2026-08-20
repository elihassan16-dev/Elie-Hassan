// Preview-harness stand-in for src/contractors/data.js — demo jobs for the
// contractor-portal preview page (ctrdemo.html). Pure math helpers copied
// verbatim from the real module; the hook returns an in-memory sample.
const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const day10 = (n) => days(n).slice(0, 10);

const ORG = { id: "org1", name: "Shia Polak Construction" };
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
];
const TASKS = [
  { id: "t1", orgId: "org1", jobId: "j1", text: "Demo the back bathroom down to studs", status: "In Progress", createdBy: "Moshe Hamaoui", createdAt: days(-3), statusBy: "Shia Polak" },
  { id: "t2", orgId: "org1", jobId: "j1", text: "Send photos of the roof decking before you close it up", status: "Not Started", createdBy: "Elie Hassan", createdAt: days(-2) },
  { id: "t3", orgId: "org1", jobId: "j1", text: "Dumpster delivered and placed", status: "Completed", createdBy: "Moshe Hamaoui", createdAt: days(-6), doneBy: "Shia Polak", doneAt: days(-6) },
  { id: "t4", orgId: "org1", jobId: "j1", direction: "to_team", text: "Need the tile picked for the hall bath", status: "Not Started", createdAt: days(-1) },
];
const MESSAGES = [
  { id: "m1", jobId: "j1", side: "team", author: "Moshe Hamaoui", text: "Morning — inspector confirmed Friday 9am for the rough plumbing.", at: days(-1.2), readBy: [] },
  { id: "m2", jobId: "j1", side: "contractor", author: "Shia Polak", text: "We'll be ready. Framing passed yesterday 👍", at: days(-1.1), readBy: ["Moshe Hamaoui"] },
  { id: "m3", jobId: "j1", side: "team", author: "Elie Hassan", text: "Looking great guys. Send me pics of the beam when it's in.", at: days(-0.2), readBy: [] },
];
const SITE = [{ id: "1003", address: "1055 Huntingdon Dr, Westampton", utilities: { water: "on", electric: "on", gas: "off" }, utilitiesBy: {}, permits: {}, permitsBy: {}, events: [
  { id: 1, type: "rough", trade: "Plumbing", date: day10(2), time: "09:00", note: "", by: "Shia Polak", orgName: "Shia Polak Construction", at: days(-1) },
  { id: 2, type: "final", trade: "", date: day10(8), time: "", note: "with Moshe", by: "Moshe Hamaoui", orgName: "", at: days(-1) },
] }];

export function useContractorData() {
  return { orgs: [ORG], jobs: JOBS, tasks: TASKS, messages: MESSAGES, docs: [], siteStatus: SITE, save: async () => {}, error: null };
}
export const jobTotal = (j) => (Number(j.price) || 0) + (j.changeOrders || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
export const jobPaid = (j) => (j.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const jobLeft = (j) => jobTotal(j) - jobPaid(j);
export const jobDays = (j) => { if (!j.startDate) return null; const ms = Date.now() - new Date(j.startDate + "T00:00:00").getTime(); return ms < 0 ? 0 : Math.floor(ms / 86400000) + 1; };
export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return iso || ""; } };
export const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
