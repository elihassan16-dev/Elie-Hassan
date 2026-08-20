// Preview-harness stand-in for the main app's DataProvider — the REAL
// GoldstoneShell renders against this in-memory sample portfolio, so UI
// changes can be screenshotted here before anything ships. Mutations work
// (setX are real state setters); nothing persists. Aliased in by
// vite.appdemo.config.js only — never bundled into the real app.
import { useState } from "react";
import { DEMO_SHOWINGS, demoShowingKey } from "./appMockNet.js";

const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

const FIN = (over = {}) => ({
  purchasePrice: "205000", buyingCosts: "8400", buyingTransferTax: "0", transferTaxResp: "Seller Pays",
  rehabCosts: "85000", annualHoldingCosts: "9600", holdPeriod: "6", fundingSource: "", salePrice: "475000",
  sellingCosts: "21500", sellingTransferTax: "", actualPurchasePrice: "", actualBuyingCosts: "", actualRehabCosts: "",
  purchaseDate: "", sellingDate: "", locLoan: "", locInterest: "", hmLoan: "", hmInterest: "",
  actualSalePrice: "", actualSellingCosts: "", actualSellingTransferTax: "",
  buyingCostItems: [{ id: 1, title: "Title Cost", autoType: "title", auto: true, resp: "Buyer Pays" }, { id: 2, title: "Transfer Tax", autoType: "tax", auto: true, resp: "Seller Pays" }, { id: 3, title: "Miscellaneous", autoType: null, auto: false, resp: "Buyer Pays", amount: "1000" }],
  sellingCostItems: [{ id: 1, title: "Commission", autoType: "commission", auto: true, resp: "Seller Pays", commissionPct: "2" }, { id: 2, title: "Transfer Tax", autoType: "tax", auto: true, resp: "Seller Pays" }, { id: 3, title: "Miscellaneous", autoType: null, auto: false, resp: "Seller Pays", amount: "2000" }],
  holdingCostItems: [{ id: 1, title: "Property Taxes", amount: "6200", perYear: true, auto: false }, { id: 2, title: "Insurance", amount: "1800", perYear: true, auto: false }, { id: 3, title: "Utilities", amount: "150", perMonth: true, auto: true }],
  ...over,
});

const PROPS = [
  {
    id: 1001, address: "417 Lakeview Ter", city: "Pemberton", state: "NJ", zip: "08068", status: "Under Construction",
    financials: FIN({
      arvAi: {
        at: days(-1), plan: "Full gut — new kitchen, 2 baths, flooring, roof", provider: "ChatARV (MLS)",
        filters: { radius: 1, months: 12 }, arv: 475000, low: 455000, high: 495000, psf: 231, asIs: 426000,
        reasoning: "Full renovation, so the finished house competes with the best updated sales nearby. The strongest comps sold around $455–490k; at ~2,056 sqft we anchor near $231/sf and land mid-range to stay conservative.",
        subject: { sqft: 2056, beds: 4, baths: 2, yearBuilt: 1972, pool: false, garage: true },
        comps: [
          { address: "323 Dermody St", full: "323 Dermody St, Pemberton, NJ 08068", price: 495000, listPrice: 479000, date: days(-40).slice(0, 10), sqft: 1980, beds: 4, baths: 2, distance: 0.15, used: true, why: "renovated, near-identical size", priceSrc: "sold" },
          { address: "248 W 3rd Ave", full: "248 W 3rd Ave, Pemberton, NJ 08068", price: 450000, date: days(-90).slice(0, 10), sqft: 1890, beds: 3, baths: 2, distance: 0.32, used: true, why: "updated, $238/sf", priceSrc: "sold" },
          { address: "207 Clover St", full: "207 Clover St, Pemberton, NJ 08068", price: 275000, date: days(-60).slice(0, 10), sqft: 1510, beds: 3, baths: 1, distance: 0.02, used: false, why: "as-is estate sale, $182/sf", priceSrc: "sold" },
          { address: "399 Division St", full: "399 Division St, Pemberton, NJ 08068", price: 374999, date: days(-12).slice(0, 10), sqft: 1120, beds: 3, baths: 1, distance: 0.19, used: false, why: "deed not recorded yet", priceSrc: "list" },
        ],
      },
    }),
    propertyInfo: { type: "Single Family", beds: "4", baths: "2", sqft: "2056", yearBuilt: "1972", lot: "0.25 ac", parcel: "", lockboxCode: "4417", lockboxLocation: "Front door", notes: "" },
    tasks: [
      { id: 1, text: "Order dumpster for demo week", status: "In Progress", assignee: "Moshe Hamaoui", delegate: "", assignedAt: Date.now(), assignedBy: "Elie Hassan" },
      { id: 2, text: "Follow up on the inspection at 417 Lakeview Ter — get the report / talk to the buyer's side", cat: "Inspections", status: "Not Started", assignee: "Moshe Hamaoui", delegate: "", autoId: "insp-fup:demo", assignedAt: Date.now(), assignedBy: "Elie Hassan" },
    ],
    contacts: [2001],
    customLeads: [{ id: 1, name: "Papa Pay", phone: "(908) 555-0142", buyer: true, at: days(-2) }],
    showingSnapshots: { "sh-1": { agent: "Dominique Bell", phone: "(609) 555-0177" } },
  },
  {
    id: 1002, address: "32 Oakland Ave", city: "Newfield", state: "NJ", zip: "08344", status: "Under Contract",
    financials: FIN({ purchasePrice: "180000", rehabCosts: "65000", salePrice: "365000", holdPeriod: "5" }),
    propertyInfo: { type: "Single Family", beds: "3", baths: "2", sqft: "1480", yearBuilt: "1965", lot: "", parcel: "", lockboxCode: "", lockboxLocation: "", notes: "Septic engineering with ICD in progress" },
    tasks: [{ id: 3, text: "Sign ICD site-evaluation contract", status: "Completed", assignee: "Elie Hassan", delegate: "", assignedAt: Date.now(), assignedBy: "Elie Hassan" }],
    contacts: [2002],
  },
  {
    id: 1003, address: "1030 Hanover Blvd", city: "Browns Mills", state: "NJ", zip: "08015", status: "On Market",
    financials: FIN({ purchasePrice: "150000", rehabCosts: "72000", salePrice: "329900", holdPeriod: "7" }),
    propertyInfo: { type: "Single Family", beds: "3", baths: "1.5", sqft: "1290", yearBuilt: "1958", lot: "", parcel: "", lockboxCode: "1030", lockboxLocation: "Side rail", notes: "" },
    tasks: [{ id: 4, text: "Sign and lock box pickup", status: "Not Started", assignee: "Moshe Hamaoui", delegate: "", assignedAt: Date.now(), assignedBy: "Elie Hassan" }],
    contacts: [],
    // Live ShowingTime demo data (mock feed in appMockNet) with saved lead
    // statuses so By property / Hot leads / By agent all render populated.
    showingSnapshots: Object.fromEntries(DEMO_SHOWINGS.map((s) => [demoShowingKey(s), { uid: s.uid, start: s.start, summary: s.summary, location: s.location, agent: s.agent, broker: s.broker, phone: s.phone, email: "", status: s.status }])),
    showingLeads: {
      [demoShowingKey(DEMO_SHOWINGS[0])]: "offer",
      [demoShowingKey(DEMO_SHOWINGS[1])]: "interest",
      [demoShowingKey(DEMO_SHOWINGS[2])]: "not",
      [demoShowingKey(DEMO_SHOWINGS[4])]: "received",
    },
    customLeads: [{ id: 2, name: "Papa Pay", phone: "(908) 555-0142", buyer: true, at: days(-2), lead: "interest" }],
  },
  {
    id: 1004, address: "19 Orchard St", city: "South Amboy", state: "NJ", zip: "08879", status: "Sold",
    financials: FIN({ purchasePrice: "231000", rehabCosts: "58000", salePrice: "410000", actualSalePrice: "418000", purchaseDate: "2026-01-12", sellingDate: "2026-07-28", holdPeriod: "6" }),
    propertyInfo: { type: "Single Family", beds: "3", baths: "2", sqft: "1410", yearBuilt: "1949", lot: "", parcel: "", lockboxCode: "", lockboxLocation: "", notes: "" },
    tasks: [], contacts: [],
  },
];

const TEAM = [
  { id: "demo-elie", email: "elie@goldstonepropertiesnj.com", name: "Elie Hassan", role: "admin", notify_muted: false, sms_email: "7326643836@vtext.com", notify_channels: null },
  { id: "demo-moshe", email: "moshe@goldstonepropertiesnj.com", name: "Moshe Hamaoui", role: "member", notify_muted: false, sms_email: "7326916416@vtext.com", notify_channels: { push: true, email: true, sms: false } },
  { id: "demo-esti", email: "esti@goldstonepropertiesnj.com", name: "Esti Ungar", role: "member", notify_muted: false, sms_email: "7322998137@vtext.com", notify_channels: null },
];

const CONTACTS = [
  { id: 2001, name: "Ray Demeters", role: "Septic", phone: "(609) 555-0132", email: "ray@demeterseptic.com", tags: ["Septic"] },
  { id: 2002, name: "Lisa LaScala", role: "Septic engineering", phone: "(856) 555-0177", email: "lisa@icdconnected.com", company: "ICD Connected", tags: ["Septic"] },
  { id: 2003, name: "Sam Cutler", role: "Attorney", phone: "(732) 555-0110", email: "sam@cutlerlaw.com", company: "Cutler Law", tags: ["Attorney"] },
  { id: 2004, name: "Shia Polak", role: "Owner", phone: "(848) 555-0133", email: "shia@polakconstruction.com", company: "Shia Polak Construction", tags: ["Contractor"] },
  { id: 2005, name: "Yanky Polak", role: "Foreman", phone: "(848) 555-0102", company: "Shia Polak Construction", tags: ["Contractor"] },
  { id: 2006, name: "Dana Whitfield", role: "Closer", phone: "(609) 555-0119", email: "dana@gstitle.com", company: "Garden State Title", tags: ["Title"] },
  { id: 2007, name: "Robert Ellis", role: "Post-closing", phone: "(609) 555-0121", email: "rob@gstitle.com", company: "Garden State Title", tags: ["Title"] },
];

const OFFICE_MSGS = [
  { id: 9001, author: "Moshe Hamaoui", text: "unit 5 paid their portion and we should be up to date", at: days(-0.2), propId: null },
  { id: 9002, author: "Esti Ungar", text: "sent it to you for signature", at: days(-0.1), propId: 1002 },
  { id: 9003, author: "Elie Hassan", text: "Got it — signing tonight 👍", at: days(-0.05), propId: 1002 },
];

const OFFICE_TASKS = [
  { id: 9101, text: "Reconcile line of credit", status: "Not Started", assignee: "Esti Ungar", delegate: "", autoId: "loc-reconcile", assignedAt: Date.now(), assignedBy: "Elie Hassan", locInfo: { funderName: "J. Klein", amount: 120000, dateFunded: "2026-08-01", ratePct: 15, custom: false, locTotal: 120000, drawId: 1 } },
];

export function useData() { return window.__appDemoData; }

export function DataProvider({ children }) {
  const [sharedProps, setSharedProps] = useState(PROPS);
  const [leads, setLeads] = useState([]);
  const [contacts, setContacts] = useState(CONTACTS);
  const [automations, setAutomations] = useState([]);
  const [funders, setFunders] = useState([{ id: 1, name: "J. Klein", ledger: [] }]);
  const [draws, setDraws] = useState([]);
  const [officeMessages, setOfficeMessages] = useState(OFFICE_MSGS);
  const [officeTasks, setOfficeTasks] = useState(OFFICE_TASKS);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [appSettings, setAppSettings] = useState([{ id: "features", flags: {}, who: {} }, { id: "followups", items: [] }]);
  const [rentals, setRentals] = useState([]);
  const [team, setTeam] = useState(TEAM);
  const noop = () => {};
  const value = {
    loading: false,
    sharedProps, setSharedProps, flushProps: noop,
    leads, setLeads,
    contacts, setContacts, flushContacts: noop,
    automations, setAutomations,
    funders, setFunders, flushFunders: noop,
    draws, setDraws, flushDraws: noop,
    officeMessages, setOfficeMessages, flushOffice: noop,
    officeTasks, setOfficeTasks, flushOfficeTasks: noop,
    bankAccounts, setBankAccounts, flushBank: noop,
    appSettings, setAppSettings, flushAppSettings: noop,
    rentals, setRentals, flushRentals: noop,
    team,
    ctrUsers: [
      { id: "cu1", name: "Shia Polak", orgId: "org1" },
      { id: "cu2", name: "Moti Polak", orgId: "org1" },
      { id: "cu3", name: "Mendel Davids", orgId: "org2" },
    ],
    teamMembers: TEAM.map((u) => u.name),
    setUserMuted: (id, muted) => setTeam((t) => t.map((u) => (u.id === id ? { ...u, notify_muted: muted } : u))),
    setUserSms: (id, sms) => setTeam((t) => t.map((u) => (u.id === id ? { ...u, sms_email: sms } : u))),
    setUserChannels: (id, ch) => setTeam((t) => t.map((u) => (u.id === id ? { ...u, notify_channels: ch } : u))),
    currentUser: "Elie Hassan",
    saveError: null,
    clearSaveError: noop,
  };
  window.__appDemoData = value;
  return children;
}
