// Demo-only data store for the tutorial recording — realistic sample rows,
// live updates (save/remove mutate the store so interactions show on screen).
import { useEffect, useState } from "react";

const D = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString(); };
const day = (days) => D(days).slice(0, 10);

const SCOPE = `SCOPE OF WORK
211 Clover St, Roselle, NJ
Prepared by Goldstone Properties

DEMOLITION
1. Remove all existing floor finishes throughout down to subfloor.
2. Demo kitchen cabinets, countertops, sink, and appliances for disposal.
3. Gut both bathrooms: fixtures, vanities, tile, and tub surrounds.

KITCHEN
1. Install new shaker cabinets (white) with soft-close hardware.
2. Quartz countertops with standard eased edge.
3. Install stainless appliance package (supplied by owner).

BATHROOMS
1. New tub with tile surround to ceiling, hall bath.
2. Tile floors, new vanities, mirrors, and lighting in both baths.

GENERAL CONDITIONS
1. Contractor is licensed and insured; permits by contractor.
2. Debris removal and broom-clean at completion.
3. Changes handled through written change orders in the portal.`;

const store = {
  contractor_orgs: [{ id: "demo-org", name: "MCD BUILDS LLC", mainContact: "Hershy Gelbman" }],
  contractor_jobs: [{
    id: 1, orgId: "demo-org", propertyId: "p1",
    propertyAddress: "211 Clover St, Roselle", title: "Full renovation",
    price: 84500, startDate: day(-9), status: "active", createdAt: D(-9),
    scope: SCOPE,
    changeOrders: [{ id: 2, label: "Replace rotted subfloor — kitchen", amount: 1800, date: day(-3), by: "Hershy Gelbman" }],
    payments: [{ id: 3, amount: 20000, date: day(-8), note: "Deposit" }, { id: 4, amount: 15000, date: day(-2), note: "Draw 1 — demo complete" }],
    coRequests: [{ id: 5, label: "Replace rotted subfloor — kitchen", amount: 1800, by: "Hershy Gelbman", at: D(-4), status: "approved" }],
  }],
  contractor_tasks: [
    { id: 11, jobId: 1, orgId: "demo-org", text: "Send electrical rough-in photos before closing walls", status: "In Progress", direction: "to_contractor", createdBy: "Elie Hassan", createdAt: D(-2), statusBy: "Hershy Gelbman" },
    { id: 12, jobId: 1, orgId: "demo-org", text: "Order kitchen cabinets (white shaker)", status: "Not Started", direction: "to_contractor", createdBy: "Elie Hassan", createdAt: D(-1) },
    { id: 13, jobId: 1, orgId: "demo-org", text: "Need paint color decision for bedrooms", status: "Not Started", direction: "to_team", createdBy: "Hershy Gelbman", createdAt: D(-1), askedOf: ["Elie Hassan"] },
  ],
  contractor_messages: [
    { id: 21, jobId: 1, orgId: "demo-org", author: "Elie Hassan", side: "team", text: "Welcome aboard — everything for this job lives right here.", at: D(-9), readBy: ["Elie Hassan", "Hershy Gelbman"] },
    { id: 22, jobId: 1, orgId: "demo-org", author: "Hershy Gelbman", side: "contractor", text: "Demo is done, starting rough plumbing tomorrow.", at: D(-2), readBy: ["Hershy Gelbman", "Elie Hassan"] },
    { id: 23, jobId: 1, orgId: "demo-org", author: "Elie Hassan", side: "team", text: "Looks great. Don't close walls before the inspection.", at: D(-1), readBy: ["Elie Hassan", "Hershy Gelbman"], taskRefId: 11, taskRefText: "Send electrical rough-in photos before closing walls" },
  ],
  contractor_docs: [{ id: 31, jobId: 1, orgId: "demo-org", name: "Signed contract.pdf", url: "#", mime: "application/pdf", by: "Elie Hassan", at: D(-9) }],
  site_status: [{
    id: "p1", address: "211 Clover St, Roselle",
    utilities: { electric: "on", water: "on" }, utilitiesBy: { electric: { by: "Elie Hassan", at: D(-5) }, water: { by: "Hershy Gelbman", at: D(-4) } }, utilitiesAuto: {},
    permits: { building: "yes", plumbing: "yes" }, permitsBy: { building: { by: "Elie Hassan", at: D(-6) } },
    permitPlans: { building: "approved" }, permitInsp: {},
    info: { parcel: "Block 407 / Lot 12", lockbox: "4821" },
    events: [{ id: 41, type: "rough", trade: "Plumbing", date: day(2), time: "09:30", note: "", by: "Hershy Gelbman", orgName: "MCD BUILDS LLC", at: D(-1) }],
    updatedAt: D(-1), updatedBy: "Hershy Gelbman",
  }],
};

const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

export function useContractorData() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return {
    orgs: store.contractor_orgs, jobs: store.contractor_jobs, tasks: store.contractor_tasks,
    messages: store.contractor_messages, docs: store.contractor_docs, siteStatus: store.site_status,
    error: "",
    save: async (table, row) => {
      const rows = store[table] || (store[table] = []);
      const i = rows.findIndex((r) => String(r.id) === String(row.id));
      if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push(row);
      store[table] = [...rows];
      emit();
    },
    remove: async (table, id) => { store[table] = (store[table] || []).filter((r) => String(r.id) !== String(id)); emit(); },
    reload: () => {},
  };
}
export const jobTotal = (j) => (Number(j.price) || 0) + (j.changeOrders || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
export const jobPaid = (j) => (j.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const jobLeft = (j) => jobTotal(j) - jobPaid(j);
export const jobDays = (j) => { if (!j.startDate) return null; const d = Math.floor((Date.now() - new Date(j.startDate + "T00:00:00").getTime()) / 86400000); return isNaN(d) ? null : Math.max(0, d); };
export const money = (n) => `$${(Number(n) || 0).toLocaleString()}`;
export const fmtDate = (iso) => { try { return new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; } };
export const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
