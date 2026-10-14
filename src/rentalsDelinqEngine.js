// Delinquency engine — pure JS (no React), shared by the Delinquency report
// (src/rentalsDelinq.jsx re-exports it) and the Claude connector on the server.
import { rentPaymentsFor, unitLabel, addMonths, monthsBetween, mLabel } from "./rentalsEngine.js";

export const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoOf(new Date());
export const dayDiff = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
export const shiftDays = (iso, k) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + k); return isoOf(d); };
export const num = (v) => Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0;
export const r2 = (v) => Math.round(v * 100) / 100;
// "#4" / "Unit 4" / "6 S 4th St #4" → "4"; "516 N High St" → "516"
export const unitKey = (label) => {
  const s = String(label || "").trim().toLowerCase();
  let m = s.match(/#\s*([\w-]+)/); if (m) return m[1];
  m = s.match(/^(?:unit|apt|apartment|suite)\.?\s*([\w-]+)/); if (m) return m[1];
  return s.split(/\s+/)[0] || "";
};
export const dShort = (iso, year) => { if (!iso) return ""; const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) }); };
export const bucketOf = (days) => (days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3);
export const BUCKETS = ["0–30", "31–60", "61–90", "90+"];

// Newest packet rent roll for this rental dated on/before `asOf`.
export function packetFor(r, ctx, asOf) {
  let best = null;
  (ctx.packets || []).forEach((s) => (s.props || []).forEach((p) => {
    const units = p.units || [];
    const at = units[0] && units[0].asOf;
    if (!units.length || !at || at > asOf) return;
    if (!ctx.rentalFor || String(ctx.rentalFor(p)?.id) !== String(r.id)) return;
    if (!best || at > best.asOf) best = { asOf: at, units };
  }));
  return best;
}

// One tenant's ledger → rows (oldest first), owed, aging.
export function tenantLedger(tn, pays, opt) {
  const { asOf, packet, startYm } = opt;
  const endYm = asOf.slice(0, 7);
  const pYm = packet ? packet.asOf.slice(0, 7) : null;
  const rows = [];
  if (packet) rows.push({ ym: pYm, open: true, label: `Owed on ${dShort(packet.asOf)}`, charged: tn.opening || 0, pays: [] });
  let from = packet ? addMonths(pYm, 1) : startYm;
  if (tn.leaseFrom && tn.leaseFrom.slice(0, 7) > from) from = tn.leaseFrom.slice(0, 7);
  let to = endYm;
  if (tn.moveOut && tn.moveOut.slice(0, 7) < to) to = tn.moveOut.slice(0, 7);
  if (from && tn.rent > 0) monthsBetween(from < addMonths(endYm, -35) ? addMonths(endYm, -35) : from, to).forEach((ym) => rows.push({ ym, label: `${mLabel(ym)} ${ym.slice(0, 4)}`, charged: tn.rent, pays: [] }));
  const rowFor = (ym) => { let x = rows.find((w) => !w.open && w.ym === ym); if (!x) { x = { ym, label: `${mLabel(ym)} ${ym.slice(0, 4)}`, charged: 0, pays: [] }; rows.push(x); } return x; };
  const loose = [];
  pays.forEach((p) => {
    if (p.kind === "late") { if (packet && p.forYm <= pYm) (rows.find((w) => w.open) || rowFor(p.forYm)).pays.push(p); return; } // late fees only toward the packet's balance
    if (packet && p.forYm <= pYm) { rows.find((w) => w.open).pays.push(p); return; }
    if (p.explicit) rowFor(p.forYm).pays.push(p); else loose.push(p);
  });
  const oi = rows.findIndex((w) => w.open && !w.pays.length && Math.abs(w.charged) < 0.005);
  if (oi >= 0) rows.splice(oi, 1); // nothing owed on the packet date and nothing paid toward it
  rows.sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || a.ym.localeCompare(b.ym));
  rows.forEach((w) => { w.paid = r2(w.pays.reduce((s, p) => s + p.amount, 0)); w.due = r2(w.charged - w.paid); w.applied = []; });
  // Payments with no month, and any month paid over, go to the oldest month still owed.
  let pool = loose.reduce((s, p) => s + p.amount, 0);
  rows.forEach((w) => { if (w.due < 0) { pool += -w.due; w.credit = -w.due; w.due = 0; } });
  if (pool < 0) { const last = rows[rows.length - 1] || rowFor(endYm); last.due = r2(last.due - pool); pool = 0; }
  rows.forEach((w) => { if (pool > 0.004 && w.due > 0.004) { const x = Math.min(pool, w.due); w.due = r2(w.due - x); w.applied.push(x); pool -= x; } });
  const credit = r2(pool);
  const owed = r2(rows.reduce((s, w) => s + w.due, 0) - credit);
  return { rows, owed, credit, aging: agingOf(rows, tn, asOf), loose };
}
// Aging by how long each month's rent has been unpaid (due the 1st). The
// packet's opening balance is aged in rent-size pieces, newest month first.
export function agingOf(rows, tn, asOf) {
  const aging = [0, 0, 0, 0];
  rows.forEach((w) => {
    if (!(w.due > 0.004)) return;
    if (w.open && tn.rent > 0) {
      let left = w.due, ym = w.ym;
      const floor = tn.leaseFrom ? tn.leaseFrom.slice(0, 7) : null; // never age it from before the lease began
      while (left > 0.004) { const x = floor && ym <= floor ? left : Math.min(left, tn.rent); aging[bucketOf(dayDiff(`${ym}-01`, asOf))] += x; left -= x; ym = addMonths(ym, -1); }
    } else aging[bucketOf(dayDiff(`${w.ym}-01`, asOf))] += w.due;
  });
  return aging.map(r2);
}

// The whole report as of a date. range = {from, to} months (Elie 10/6/26):
// only the rent FOR those months — charged, paid, and still unpaid today.
export function delinquency(rentals, ctx, asOf = todayIso(), range = null) {
  const endYm = asOf.slice(0, 7);
  const props = [];
  (rentals || []).forEach((r) => {
    const packet = packetFor(r, ctx, asOf);
    const all = rentPaymentsFor(r, ctx);
    const pays = all.filter((p) => p.date && p.date <= asOf && (!packet || p.date > packet.asOf));
    const n = packet ? packet.units.length : (r.units || []).length;
    const multi = n > 1;
    let tenants = packet
      ? packet.units.filter((u) => u.tenant || u.rent > 0 || u.pastDue).map((u) => ({ label: multi ? unitLabel({ unit: u.unit }) : "", name: u.tenant || "", rent: u.rent || 0, opening: u.pastDue || 0, late: u.late || 0, nsf: u.nsf || 0, af: { pastDue: u.pastDue || 0, asOf: u.asOf }, leaseFrom: u.leaseFrom || "", moveOut: u.moveOut || "" }))
      : (r.units || []).map((u, i) => ({ label: multi ? (u.label || `Unit ${i + 1}`) : "", name: (u.tenant && u.tenant.name) || "", rent: num(u.rent), opening: 0, late: 0, nsf: 0, af: null, leaseFrom: u.leaseStart || "", moveOut: "" }));
    if (!tenants.length && all.length) tenants = [{ label: "", name: "", rent: 0, opening: 0, late: 0, nsf: 0, af: null }];
    tenants.forEach((t) => { t.key = multi ? unitKey(t.label) : ""; });
    // Which tenant each payment belongs to.
    const byT = new Map(tenants.map((t) => [t, []]));
    let other = null;
    pays.forEach((p) => {
      let t = multi ? tenants.find((x) => x.key && x.key === unitKey(p.unit)) : tenants[0];
      if (!t) { if (!other) { other = { label: "No unit named", key: "?", name: "Payments with no unit", rent: 0, opening: 0, late: 0, nsf: 0, af: null }; byT.set(other, []); } t = other; }
      byT.get(t).push(p);
    });
    if (other) tenants.push(other);
    // No packet: the ledger starts at the first month we have rent for this property.
    const firstYm = all.filter((p) => p.kind !== "late").map((p) => p.forYm).sort()[0] || null;
    if (!packet && !firstYm) return; // no rent data yet
    const out = tenants.map((t) => {
      // Elie's marks (10/6/26), r.dqMarks[unit key or "_"]: {vacant} = the unit
      // is empty — its balance is wiped and it isn't counted; {startYm} = a new
      // tenant moved in — their ledger starts fresh that month.
      t.mark = (r.dqMarks || {})[t.key || "_"] || null;
      const fresh = t.mark && !t.mark.vacant && /^\d{4}-\d{2}$/.test(t.mark.startYm || "") ? t.mark.startYm : null;
      const mine = (byT.get(t) || []).filter((p) => !fresh || (p.kind !== "late" && p.forYm >= fresh));
      let L = tenantLedger(t, mine, { asOf, packet: fresh ? null : packet, startYm: fresh || (firstYm && firstYm <= endYm ? firstYm : endYm) });
      let rangeCharged = 0, rangePaid = 0;
      if (range) {
        // The packet's balance can hold older months too: keep only the
        // rent-size pieces (newest first) that fall inside the range.
        const rows = L.rows.filter((w) => w.ym >= range.from && w.ym <= range.to).map((w) => {
          if (!w.open || !(t.rent > 0)) return w;
          const cap = t.rent * monthsBetween(range.from, w.ym).length;
          return { ...w, charged: Math.min(w.charged, cap), due: Math.min(w.due, cap), label: `${w.label} (${mLabel(range.from)}–${mLabel(w.ym)} part)` };
        });
        rangeCharged = r2(rows.reduce((s, w) => s + Math.max(0, w.charged), 0));
        rangePaid = r2(rows.reduce((s, w) => s + Math.max(0, w.charged) - w.due, 0));
        L = { ...L, rows, owed: r2(rows.reduce((s, w) => s + w.due, 0)), credit: 0, aging: agingOf(rows, t, asOf) };
      }
      const allMine = all.filter((p) => (multi ? (t.key === "?" ? !tenants.some((x) => x !== t && x.key === unitKey(p.unit)) : t.key === unitKey(p.unit)) : true) && p.date <= asOf && (!fresh || (p.kind !== "late" && p.forYm >= fresh)));
      // Last paid = the latest day with a payment, that whole day's total.
      const lastDay = [...allMine].reverse().find((p) => !p.rev && p.amount > 0)?.date;
      const lastPays = lastDay ? allMine.filter((p) => !p.rev && p.date === lastDay) : [];
      const last = lastDay ? { date: lastDay, amount: r2(lastPays.reduce((s, p) => s + p.amount, 0)), hap: lastPays.length > 0 && lastPays.every((p) => p.hap) } : null;
      const bounced = new Set(allMine.filter((p) => p.rev).map((p) => p.date)).size; // one bounced check = one reversal date
      // No packet, no tenant name and never a payment on record → probably vacant; shown, not counted.
      const marked = !!(t.mark && t.mark.vacant);
      const vacant = marked || (!packet && !fresh && !t.name && t.key !== "?" && !allMine.some((p) => p.kind !== "late"));
      const cur = L.rows.find((w) => !w.open && w.ym === endYm);
      const hap = allMine.some((p) => p.hap);
      const tags = [];
      if (t.late > 0) tags.push({ t: `Late ${t.late}×`, c: "or" });
      if (bounced) tags.push({ t: `Bounced ${bounced}×`, c: "red" });
      if (hap && L.owed > 0.5) tags.push({ t: "Tenant part late", c: "or" });
      else if (cur && cur.charged > 0 && cur.paid > 0.004 && cur.due > 0.5) tags.push({ t: "Partial", c: "or" });
      if (marked) tags.splice(0, tags.length, { t: `Vacant · marked ${dShort(String(t.mark.at || "").slice(0, 10))}`, c: "mu" });
      else if (vacant) tags.push({ t: "Vacant? No payments on record", c: "mu" });
      else if (fresh) tags.unshift({ t: `New tenant from ${mLabel(fresh)} ${fresh.slice(0, 4)}`, c: "gr" });
      else if (L.owed < -0.5) tags.push({ t: "Paid ahead", c: "gr" });
      else if (L.owed <= 0.5 && !t.late && !bounced && t.rent > 0) tags.push({ t: "On time", c: "gr" });
      if (vacant) { L.owed = 0; L.aging = [0, 0, 0, 0]; }
      return { ...t, rental: r, ...L, rangeCharged, rangePaid, vacant, marked, fresh, last, bounced, hap, tags, curCharged: cur ? cur.charged : 0, curPaid: cur ? r2(cur.charged - cur.due) : 0 };
    }).filter((t) => t.rent > 0 || t.rows.length || Math.abs(t.owed) > 0.004);
    if (!out.length) return;
    const owed = r2(out.reduce((s, t) => s + Math.max(0, t.owed), 0));
    const aging = [0, 1, 2, 3].map((i) => r2(out.reduce((s, t) => s + (t.owed > 0.004 ? t.aging[i] : 0), 0)));
    props.push({ r, tenants: out, owed, aging, packet });
  });
  const tenants = props.flatMap((p) => p.tenants);
  const total = r2(props.reduce((s, p) => s + p.owed, 0));
  const aging = [0, 1, 2, 3].map((i) => r2(props.reduce((s, p) => s + p.aging[i], 0)));
  const behind = tenants.filter((t) => t.owed > 0.5);
  const occupied = tenants.filter((t) => t.rent > 0 && t.key !== "?" && !t.vacant).length;
  const monthRent = r2(tenants.reduce((s, t) => s + (t.vacant ? 0 : range ? t.rangeCharged : t.curCharged), 0)), monthPaid = r2(tenants.reduce((s, t) => s + (t.vacant ? 0 : Math.max(0, range ? t.rangePaid : t.curPaid)), 0));
  return { asOf, range, props, tenants, total, aging, behind, occupied, monthRent, monthPaid };
}
// Sidebar numbers: what each rental's tenants owe today.
export function owedByRental(rentals, ctx) {
  const d = delinquency(rentals, ctx);
  const m = new Map();
  d.props.forEach((p) => m.set(String(p.r.id), { owed: p.owed, old: p.aging[1] + p.aging[2] + p.aging[3], ahead: p.tenants.every((t) => t.owed <= 0.5) && p.tenants.some((t) => t.owed < -0.5) }));
  return { report: d, by: m };
}

