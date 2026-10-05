// 🏢 Platinum LIVE numbers (Elie 10/5/26): the monthly packet is too slow for a
// weekly review, so Cowork (skill goldstone-appfolio, Mon + Thu) also reads the
// AppFolio owner portal's Dashboard (per property: cash in/out, rent collected
// vs due, units) and Transactions page (every payment, expense and unpaid
// bill) and hands the app one JSON "update". This file is the pure part:
// validate the update, fold it into the stored row, and work out what changed.
//
// Stored in the same app_settings row "appfolio":
//   months{ "YYYY-MM": {all, props{key:{…}}, complete, at} }   month totals
//   snapshots[ {at, month, all, props, bills[], billsTotal, newIds[]} ]  one per check
//   txns{ id: {dir,date,key,name,unit,desc,amount,firstSeen} }   every payment/expense
import { afKey } from "./appfolio.js";

export const propKeyOf = (s) => afKey(String(s || "").split(" - ")[0]);
const propNameOf = (s) => String(s || "").split(" - ")[0].trim();
const unitOf = (s) => { const p = String(s || "").split(" - "); return p.length > 1 ? p.slice(1).join(" - ").trim() : ""; };
export const monthOf = (iso) => String(iso || "").slice(0, 7);
const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || v === "") return null;
  const t = String(v).replace(/[$,\s]/g, "");
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const x = parseFloat(t.replace(/[()\-]/g, ""));
  return Number.isFinite(x) ? (neg ? -x : x) : null;
};
const normDate = (s) => {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
};
const normMonth = (s) => {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = t.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/); if (m && MON[m[1]]) return `${m[2]}-${String(MON[m[1]]).padStart(2, "0")}`;
  return "";
};
const NUM_KEYS = { cashIn: ["cashIn"], cashOut: ["cashOut"], contributions: ["contributions"], disbursements: ["disbursements"], rentCollected: ["rentCollected"], rentDue: ["rentDue", "rentExpected"], unitsRented: ["unitsRented"], unitsTotal: ["unitsTotal"] };
const nums = (o) => {
  const out = {};
  Object.entries(NUM_KEYS).forEach(([k, aliases]) => {
    for (const a of aliases) { const v = toNum(o && o[a]); if (v != null) { out[k] = Math.abs(v); break; } }
  });
  return out;
};
const txList = (list, dir) => (Array.isArray(list) ? list : []).map((t) => ({
  dir, date: normDate(t.date), key: propKeyOf(t.property), name: propNameOf(t.property), unit: unitOf(t.property),
  desc: String(t.description || t.desc || "").trim(), payee: String(t.payee || "").trim(), amount: Math.abs(toNum(t.amount) || 0),
})).filter((t) => t.date && t.key && t.amount);

// Accepts the object, or the text Cowork pastes (code fences allowed).
export function normalizeUpdate(raw) {
  let o = raw;
  if (typeof o === "string") {
    const t = o.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { o = JSON.parse(t); } catch { throw new Error("That isn't a Platinum update — it should be the JSON block from Cowork."); }
  }
  if (!o || typeof o !== "object") throw new Error("That isn't a Platinum update.");
  const months = (Array.isArray(o.months) ? o.months : []).map((m) => {
    const month = normMonth(m.month);
    return {
      month, complete: !!m.complete,
      all: nums(m.all || m.portfolio || {}),
      props: (Array.isArray(m.properties) ? m.properties : []).map((p) => ({ key: propKeyOf(p.property || p.name), name: propNameOf(p.property || p.name), ...nums(p) })).filter((p) => p.key),
      cashIn: txList(m.cashIn, "in"), cashOut: txList(m.cashOut, "out"),
    };
  }).filter((m) => m.month);
  const hasBills = Array.isArray(o.unpaidBills);
  const bills = (hasBills ? o.unpaidBills : []).map((b) => ({
    date: normDate(b.date), payee: String(b.payee || "").trim(), key: propKeyOf(b.property), name: propNameOf(b.property), unit: unitOf(b.property),
    desc: String(b.description || b.desc || "").trim(), amount: Math.abs(toNum(b.amount) || 0),
  })).filter((b) => b.key && b.amount);
  if (!months.length && !hasBills) throw new Error("No numbers in that update — it needs \"months\" and/or \"unpaidBills\".");
  const at = o.checkedAt && !isNaN(new Date(o.checkedAt)) ? new Date(o.checkedAt).toISOString() : new Date().toISOString();
  const billsTotal = toNum(o.unpaidBillsTotal) != null ? Math.abs(toNum(o.unpaidBillsTotal)) : (hasBills ? bills.reduce((t, b) => t + b.amount, 0) : null);
  return { at, months, bills: hasBills ? bills : null, billsTotal };
}

const round2 = (v) => Math.round(v * 100) / 100;
// Fold an update into the stored row → the fields to save.
export function applyUpdate(cur, u, by) {
  const txns = { ...((cur && cur.txns) || {}) };
  const newIds = [];
  u.months.forEach((m) => {
    const seen = {};
    [...m.cashIn, ...m.cashOut].forEach((t) => {
      const base = `${t.dir}|${t.date}|${t.key}|${t.unit}|${t.desc}|${round2(t.amount).toFixed(2)}`;
      const k = (seen[base] = (seen[base] || 0) + 1);
      const id = `${base}|${k}`;
      if (!txns[id]) { txns[id] = { ...t, amount: round2(t.amount), firstSeen: u.at }; newIds.push(id); }
    });
  });
  // keep two years of transactions
  const cutoff = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  Object.keys(txns).forEach((id) => { if (txns[id].date < cutoff) delete txns[id]; });

  const months = { ...((cur && cur.months) || {}) };
  u.months.forEach((m) => {
    const old = months[m.month] || {};
    const props = { ...(old.props || {}) };
    m.props.forEach((p) => { props[p.key] = { ...(props[p.key] || {}), ...p }; });
    months[m.month] = { month: m.month, all: { ...(old.all || {}), ...m.all }, props, complete: m.complete || !!old.complete, at: u.at };
  });

  const cm = u.months.find((m) => m.month === monthOf(u.at)) || [...u.months].sort((a, b) => b.month.localeCompare(a.month))[0] || null;
  const prevSnaps = ((cur && cur.snapshots) || []).slice();
  const last = prevSnaps[prevSnaps.length - 1];
  const snap = {
    at: u.at, by: by || "", month: cm ? cm.month : monthOf(u.at),
    all: cm ? cm.all : {}, props: cm ? Object.fromEntries(cm.props.map((p) => [p.key, p])) : {},
    bills: u.bills != null ? u.bills : (last && last.bills) || [],
    billsTotal: u.billsTotal != null ? u.billsTotal : (last ? last.billsTotal : null),
    newIds,
  };
  const snapshots = [...prevSnaps, snap].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-60)
    .map((s, i, arr) => (i < arr.length - 12 ? { ...s, bills: undefined, newIds: undefined } : s)); // older checks keep totals only
  return { txns, months, snapshots, checkedAt: u.at, checkedBy: by || "" };
}

// ── reading it back ──
const prevMonthOf = (ym) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
export const monthLabel = (ym, long) => { const [y, m] = String(ym).split("-").map(Number); if (!y) return ""; return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: long ? "long" : "short" }); };

// Everything the screens need, from the stored row.
export function liveModel(row) {
  const snaps = ((row && row.snapshots) || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (!snaps.length) return null;
  const latest = snaps[snaps.length - 1];
  const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const months = (row && row.months) || {};
  const txns = Object.entries((row && row.txns) || {}).map(([id, t]) => ({ id, ...t }));
  const month = latest.month;
  const lastMonth = prevMonthOf(month);
  const day = Number(String(latest.at).slice(8, 10)) || new Date(latest.at).getDate();
  // Same point last month: the last check from last month on/before today's day.
  const sameDayLast = snaps.filter((s) => s.month === lastMonth && Number(String(s.at).slice(8, 10)) <= day).pop() || null;
  const newSet = new Set(latest.newIds || []);
  const fresh = txns.filter((t) => newSet.has(t.id));
  // Bill changes since the previous check
  const billKey = (b) => `${b.key}|${b.payee}|${b.date}|${b.desc}`;
  const billChanges = { paidDown: [], paidOff: [], added: [] };
  if (prev && Array.isArray(prev.bills) && Array.isArray(latest.bills)) {
    const now = new Map(latest.bills.map((b) => [billKey(b), b]));
    const was = new Map(prev.bills.map((b) => [billKey(b), b]));
    was.forEach((b, k) => {
      const n = now.get(k);
      if (!n) billChanges.paidOff.push(b);
      else if (n.amount < b.amount - 0.5) billChanges.paidDown.push({ ...n, was: b.amount, paid: round2(b.amount - n.amount) });
    });
    now.forEach((b, k) => { if (!was.has(k)) billChanges.added.push(b); });
  }
  const monthList = Object.keys(months).sort();
  return { snaps, latest, prev, months, monthList, txns, month, lastMonth, sameDayLast, fresh, billChanges, firstCheck: !prev };
}

// Money in/out for one property in one month — the dashboard's number when
// Cowork read it, else added up from the transactions.
export function propMonth(model, key, ym) {
  const m = model.months[ym];
  const p = m && m.props && m.props[key];
  const tx = model.txns.filter((t) => t.key === key && monthOf(t.date) === ym);
  const sum = (dir) => round2(tx.filter((t) => t.dir === dir).reduce((s, t) => s + t.amount, 0));
  return {
    cashIn: p && p.cashIn != null ? p.cashIn : sum("in"),
    cashOut: p && p.cashOut != null ? p.cashOut : sum("out"),
    rentCollected: p ? p.rentCollected : null, rentDue: p ? p.rentDue : null,
    unitsTotal: p ? p.unitsTotal : null, tx,
  };
}
