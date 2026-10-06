// 🏘 Rentals dashboard (Elie approved 10/6/26): properties down the left
// ("All properties" on top, then each rental with its net for the period and a
// dot for this month's rent), an interactive P&L dashboard on the right —
// period buttons (This month · Last 3 · This year · Last year · All time ·
// Custom) + Show by Month / Quarter / Year drive the 4 key numbers (vs last
// year), money in vs expenses chart, "where the money went", and the P&L table
// (tap any number for its payments; Export CSV). "All properties" adds a
// sortable Compare-properties table. Phones: the list is its own screen.
// Numbers come from rentalsPL.jsx's engine (Platinum transactions, else the
// rental's monthly ledger).
import { Fragment, useEffect, useMemo, useState } from "react";
import { T } from "./theme";
import { Sheet } from "./platinum";
import { rentalMonthPL, portfolioMonth, ymNow, addMonths, monthsBetween, mLabel, GroupBars, sortIncome, rentCatsFor, pinParts } from "./rentalsPL";
import { PinSheet, PinnedList } from "./rentalPins";
import { forMonth } from "./platinumLive.js";
import { owedByRental } from "./rentalsDelinq";

// ── period + grouping (remembered) ──
const LS = "gs_rentals_dash";
const PERIODS = [["this", "This month"], ["3m", "Last 3 mo"], ["ytd", "This year"], ["lastyear", "Last year"], ["all", "All time"]];
export function useDashPeriod(firstMonth) {
  const [st, setSt] = useState(() => { try { const v = JSON.parse(localStorage.getItem(LS) || "null"); if (v && v.p) return v; } catch { /* default */ } return { p: "ytd", by: "month" }; });
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch { /* private mode */ } }, [st]);
  const now = ymNow(), y = now.slice(0, 4);
  let from, to;
  if (st.p === "this") { from = to = now; }
  else if (st.p === "3m") { from = addMonths(now, -2); to = now; }
  else if (st.p === "lastyear") { from = `${+y - 1}-01`; to = `${+y - 1}-12`; }
  else if (st.p === "all") { from = firstMonth && firstMonth < now ? firstMonth : `${y}-01`; to = now; }
  else if (st.p === "custom") { from = st.from || `${y}-01`; to = st.to || now; }
  else { from = `${y}-01`; to = now; }
  const months = monthsBetween(from, to);
  const label = from === to ? `${mLabel(from, "long")} ${from.slice(0, 4)}` : `${mLabel(from)}${from.slice(0, 4) !== to.slice(0, 4) ? ` ${from.slice(0, 4)}` : ""} – ${mLabel(to)} ${to.slice(0, 4)}`;
  return { ...st, from, to, months, label, set: setSt };
}
// Months → columns for Month / Quarter / Year.
function buckets(months, by) {
  const out = [];
  const multiYear = new Set(months.map((m) => m.slice(0, 4))).size > 1;
  months.forEach((ym) => {
    const y = ym.slice(0, 4), q = Math.ceil(Number(ym.slice(5, 7)) / 3);
    const key = by === "year" ? y : by === "quarter" ? `${y}-Q${q}` : ym;
    let b = out[out.length - 1];
    if (!b || b.key !== key) {
      const label = by === "year" ? y : by === "quarter" ? `Q${q}${multiYear ? ` ’${y.slice(2)}` : ""}` : `${mLabel(ym)}${multiYear && (ym.endsWith("-01") || !out.length) ? ` ’${y.slice(2)}` : ""}`;
      const long = by === "year" ? y : by === "quarter" ? `Q${q} ${y}` : `${mLabel(ym, "long")} ${y}`;
      b = { key, label, long, months: [] }; out.push(b);
    }
    b.months.push(ym);
  });
  const now = ymNow();
  out.forEach((b) => { b.partial = b.months.includes(now); });
  return out;
}

// ── formatting ──
const money = (v, cents) => { const n = Number(v) || 0; return `${n < -0.004 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`; };
const signed = (v, cents) => `${(Number(v) || 0) > 0.004 ? "+" : ""}${money(v, cents)}`;
const num0 = (v) => { const n = Math.round(Number(v) || 0); return n === 0 ? "—" : `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`; };
const snum = (v) => { const n = Math.round(Number(v) || 0); return n === 0 ? "0" : `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString()}`; };
const GREEN = "#248A3D", RED = "#D70015", OUT_C = "#3E6DB5", GOLD = "#B8953F";
const netColor = (v) => (v > 0.5 ? GREEN : v < -0.5 ? RED : T.text);
const card = { background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: "12px 14px" };
const segWrap = { display: "inline-flex", background: "rgba(118,118,128,0.12)", borderRadius: 17, padding: 2, flexWrap: "nowrap", maxWidth: "100%", overflowX: "auto", scrollbarWidth: "none" };
const segBtn = (on) => ({ minHeight: 30, padding: "0 12px", border: "none", borderRadius: 15, background: on ? T.card : "transparent", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.12)" : "none", fontSize: 13, fontWeight: 600, color: on ? T.text : "#3A3A3C", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });

// Roll a set of rentals over some months into one P&L (+ every payment).
function sumPL(rentals, months, ctx, single) {
  const income = new Map(), expenses = new Map();
  let totalIn = 0, totalOut = 0, mortgage = 0, any = false;
  months.forEach((ym) => {
    const p = single ? rentalMonthPL(rentals[0], ym, ctx) : portfolioMonth(rentals, ym, ctx);
    if (single ? p.source !== "none" : p.any) any = true;
    const add = (map, e) => { const x = map.get(e.cat) || { cat: e.cat, amount: 0, tx: [] }; x.amount += e.amount; x.tx.push(...(e.tx || [])); map.set(e.cat, x); };
    p.income.forEach((e) => add(income, e)); p.expenses.forEach((e) => add(expenses, e));
    totalIn += p.totalIn; totalOut += p.totalOut; mortgage += p.mortgage;
  });
  const sort = (m) => [...m.values()].sort((a, b) => b.amount - a.amount);
  return { any, income: sortIncome([...income.values()]), expenses: sort(expenses), totalIn, totalOut, net: totalIn - totalOut, mortgage, cashFlow: totalIn - totalOut - mortgage };
}

// This month's rent status for a rental (Platinum live).
export function rentStatus(live, key) {
  const p = live && key ? (live.latest.props || {})[key] : null;
  if (!p || !(p.rentDue > 0) || p.rentCollected == null) return null;
  const m = mLabel(live.month);
  if (p.rentCollected >= p.rentDue - 0.5) return { color: "#34C759", text: `${m} paid` };
  if (p.rentCollected > 0) return { color: "#FF9500", text: `${m} part paid` };
  return { color: "#FF3B30", text: `${m} rent not paid` };
}

// ── left: the property list ──
export function RentalsSidebar({ rentals, ctx, period, selId, onSelect, onAdd, importBtn, platSub, isMobile }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => rentals.map((r) => {
    const p = sumPL([r], period.months, ctx, true);
    return { r, net: p.net, any: p.any, st: rentStatus(ctx.live, ctx.keyFor ? ctx.keyFor(r) : null) };
  }), [rentals, ctx, period.months.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => sumPL(rentals, period.months, ctx, false), [rentals, ctx, period.months.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const dq = useMemo(() => owedByRental(rentals, ctx), [rentals, ctx]);
  const units = rentals.reduce((s, r) => s + (r.units || []).length, 0);
  const shown = rows.filter((x) => !q || `${x.r.address} ${x.r.city || ""}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.any - a.any) || b.net - a.net);
  const item = (key, on, icon, title, sub, val, valColor, onClick, i) => (
    <button key={key} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 54, padding: "8px 12px", border: "none", borderTop: i ? `1px solid ${on ? "transparent" : T.border}` : "none", background: on ? GOLD : "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, background: on ? "rgba(255,255,255,0.22)" : T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, color: on ? "#fff" : T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: on ? "rgba(255,255,255,0.9)" : T.textSub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: on ? "#fff" : valColor }}>{val}</span>
      {isMobile && <span style={{ color: "#C7C7CC", fontSize: 18 }}>›</span>}
    </button>
  );
  const dot = (st, on) => st ? <><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: on ? "#fff" : st.color, marginRight: 5, verticalAlign: 1 }} />{st.text}</> : null;
  const allOn = !isMobile && (selId == null || selId === "all");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: isMobile ? "14px 14px 40px" : "16px 12px", height: isMobile ? "auto" : "100%", boxSizing: "border-box", overflowY: isMobile ? "visible" : "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
        <div style={{ flex: 1, fontSize: isMobile ? 30 : 22, fontWeight: 800, letterSpacing: "-0.01em", color: T.text }}>{isMobile ? "Rentals" : "Properties"}</div>
        {importBtn}
        <button onClick={onAdd} style={{ minHeight: 32, padding: "0 12px", borderRadius: 16, border: "none", background: GOLD, color: "#fff", fontSize: 13, fontWeight: 650, cursor: "pointer", fontFamily: "inherit" }}>＋ Add</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search properties" aria-label="Search properties" style={{ minHeight: 36, borderRadius: 10, border: "none", background: "rgba(118,118,128,0.12)", padding: "0 12px", fontSize: 14, fontFamily: "inherit", color: T.text, outline: "none" }} />
      <div style={{ background: T.card, borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}` }}>
        {item("all", allOn, "🏘", "All properties", `${rentals.length} properties · ${units} units`, all.any ? signed(all.net) : "—", netColor(all.net), () => onSelect("all"), 0)}
        {item("delinquency", selId === "delinquency", "📋", "Delinquency report", dq.report.behind.length ? `${dq.report.behind.length} tenant${dq.report.behind.length > 1 ? "s" : ""} behind` : dq.report.tenants.length ? "Everyone's paid up" : "Who owes what, per tenant", dq.report.total > 0.5 ? money(dq.report.total) : "", T.text, () => onSelect("delinquency"), 1)}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.textSub, padding: "2px 8px 0" }}>Net · {period.label}</div>
      <div style={{ background: T.card, borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}` }}>
        {shown.length === 0 && <div style={{ padding: "18px 14px", fontSize: 13.5, color: T.textTert, textAlign: "center" }}>{rentals.length ? "No match" : "No rentals yet — tap ＋ Add"}</div>}
        {shown.map((x, i) => {
          const on = String(selId) === String(x.r.id);
          const n = (x.r.units || []).length;
          // What its tenants owe (delinquency report) beats this month's rent dot.
          const ow = dq.by.get(String(x.r.id));
          const st = ow && ow.owed > 0.5 ? { color: ow.old > 0.5 ? "#FF3B30" : "#FF9500", text: `owes ${money(ow.owed)}` } : x.st;
          const sub = <>{n > 1 ? `${n} units${st ? " · " : ""}` : ""}{dot(st, on)}{!st && n <= 1 ? (x.r.city || "") : ""}</>;
          return item(x.r.id, on, n > 1 ? "🏢" : "🏠", x.r.address, sub, x.any ? signed(x.net) : "—", x.any ? netColor(x.net) : T.textTert, () => onSelect(x.r.id), i);
        })}
      </div>
      <div style={{ background: T.card, borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}`, marginTop: isMobile ? 4 : "auto" }}>
        {item("plat", String(selId) === "platinum", "🏢", "Platinum updates", platSub, isMobile ? "" : "›", T.textSub, () => onSelect("platinum"), 0)}
      </div>
    </div>
  );
}

// ── right: the dashboard ──
export function RentalsDashboard({ rentals, rental, ctx, period, onOpen, isMobile, header, onUpdateRental }) {
  const [pinOpen, setPinOpen] = useState(false);
  const single = !!rental;
  const set = single ? [rental] : rentals;
  const allCols = buckets(period.months, period.by || "month");
  const [cell, setCell] = useState(null); // {title, tx}
  const [customOpen, setCustomOpen] = useState(false);
  const [openCat, setOpenCat] = useState(null);
  const [sort, setSort] = useState({ k: "net", d: -1 });
  const key = [period.months.join(), period.by, single ? rental.id : "all", rentals.length].join("|");
  const data = useMemo(() => {
    let per = allCols.map((b) => sumPL(set, b.months, ctx, single));
    // Skip the empty columns before the numbers start (e.g. Jan–Aug before Cowork's history).
    const first = per.findIndex((p) => p.any);
    const cols = first > 0 ? allCols.slice(first) : allCols;
    if (first > 0) per = per.slice(first);
    const tot = sumPL(set, period.months, ctx, single);
    const ly = sumPL(set, period.months.map((m) => addMonths(m, -12)), ctx, single);
    return { per, tot, ly, cols };
  }, [key, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const { per, tot, ly, cols } = data;
  const pct = (a, b) => (b > 0.5 ? Math.round(((a - b) / b) * 100) : null);
  const vsLY = (a, b, upBad) => { const p = ly.any ? pct(a, b) : null; if (p == null) return <span style={{ color: T.textSub }}>&nbsp;</span>; const bad = upBad ? p > 0 : p < 0; return <span style={{ color: p === 0 ? T.textSub : bad ? RED : GREEN }}>{p > 0 ? "↑" : p < 0 ? "↓" : ""} {Math.abs(p)}% vs last year</span>; };
  const margin = tot.totalIn > 0.5 ? Math.round((tot.net / tot.totalIn) * 100) : null;
  const mtgPinned = set.some((r) => (r.qbPins || []).some((p) => p.cat === "Mortgage" && period.months.includes(String(p.date).slice(0, 7))));
  // 4th tile: cash flow after mortgage (one property) / this month's rent collected (all)
  const live = ctx.live;
  const la = live && live.latest.all;
  const rentTile = !single && la && la.rentDue > 0;
  const kpi = (label, val, color, sub) => (
    <div style={{ ...card, padding: "10px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: isMobile ? 19 : 22, fontWeight: 750, letterSpacing: "-0.01em", color: color || T.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{val}</div>
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1 }}>{sub}</div>
    </div>
  );
  const chartRows = cols.map((b, i) => ({ ym: b.key, label: b.label, long: b.long, partial: b.partial, in: per[i].totalIn, out: per[i].totalOut }));
  const expMax = Math.max(1, ...tot.expenses.map((e) => e.amount));
  // P&L table rows
  const cats = (side) => tot[side].map((e) => e.cat);
  const val = (p, side, cat) => p[side].find((e) => e.cat === cat) || null;
  const exportCsv = () => {
    const head = ["", ...cols.map((b) => b.long), "Total"];
    const line = (label, get) => [label, ...per.map((p) => Math.round(get(p) * 100) / 100), Math.round(get(tot) * 100) / 100];
    const rows = [head, ["Income"], ...cats("income").map((c) => line(c, (p) => val(p, "income", c)?.amount || 0)), line("Total income", (p) => p.totalIn), ["Expenses"], ...cats("expenses").map((c) => line(c, (p) => val(p, "expenses", c)?.amount || 0)), line("Total expenses", (p) => p.totalOut), line("Net", (p) => p.net)];
    if (tot.mortgage > 0.5) { rows.push(line("Mortgage", (p) => -p.mortgage)); rows.push(line("Cash flow", (p) => p.cashFlow)); }
    const csv = rows.map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${single ? rental.address : "All properties"} P&L ${period.label}.csv`.replace(/[^\w &.–-]+/g, " ");
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  const th = { fontSize: 11.5, fontWeight: 600, color: T.textSub, textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "6px 8px", borderTop: `1px solid ${T.border}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: T.text, fontSize: 13 };
  const first = { position: "sticky", left: 0, background: T.card, textAlign: "left", paddingLeft: 0, paddingRight: 10, minWidth: 120, zIndex: 1 };
  const totC = { background: "#F6F6F8", fontWeight: 700 };
  const clickCell = (title, e) => e && e.tx && e.tx.length ? () => setCell({ title, tx: e.tx }) : undefined;
  const catLine = (side, c) => (
    <tr key={side + c}>
      <td style={{ ...td, ...first }}>{c}{(val(tot, side, c)?.tx || []).some((t) => t.pinned) ? <span title="From QuickBooks" style={{ marginLeft: 4 }}>📌</span> : null}</td>
      {per.map((p, i) => { const e = val(p, side, c); const f = clickCell(`${c} · ${cols[i].long}`, e); return <td key={cols[i].key} onClick={f} style={{ ...td, cursor: f ? "pointer" : "default", textDecoration: f ? "underline dotted #C7C7CC" : "none", textUnderlineOffset: 3 }}>{num0(e ? e.amount : 0)}</td>; })}
      {(() => { const e = val(tot, side, c); const f = clickCell(`${c} · ${period.label}`, e); return <td onClick={f} style={{ ...td, ...totC, cursor: f ? "pointer" : "default" }}>{num0(e ? e.amount : 0)}</td>; })()}
    </tr>
  );
  const sumLine = (label, get, opts = {}) => (
    <tr>
      <td style={{ ...td, ...first, fontWeight: 700 }}>{label}</td>
      {per.map((p, i) => { const v = get(p); return <td key={cols[i].key} style={{ ...td, fontWeight: opts.bold === false ? 400 : 700, color: opts.color ? netColor(v) : T.text }}>{opts.signed ? (Math.abs(v) < 0.5 ? "—" : snum(v)) : num0(v)}</td>; })}
      {(() => { const v = get(tot); return <td style={{ ...td, ...totC, color: opts.color ? netColor(v) : T.text }}>{opts.signed ? (Math.abs(v) < 0.5 ? "—" : snum(v)) : num0(v)}</td>; })()}
    </tr>
  );
  const grp = (label) => <tr><td style={{ ...td, ...first, borderTop: "none", fontSize: 11.5, fontWeight: 700, color: T.textSub, paddingTop: 10 }}>{label}</td>{per.map((p, i) => <td key={cols[i].key} style={{ ...td, borderTop: "none" }} />)}<td style={{ ...td, ...totC, borderTop: "none" }} /></tr>;
  // Compare properties (All)
  const cmp = useMemo(() => single ? [] : rentals.map((r) => {
    const ps = cols.map((b) => sumPL([r], b.months, ctx, true));
    const t = sumPL([r], period.months, ctx, true);
    return { r, ps, t, margin: t.totalIn > 0.5 ? Math.round((t.net / t.totalIn) * 100) : null };
  }), [key, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmpSorted = [...cmp].sort((a, b) => {
    const g = (x) => sort.k === "name" ? x.r.address : sort.k === "in" ? x.t.totalIn : sort.k === "out" ? x.t.totalOut : sort.k === "margin" ? (x.margin ?? -1e9) : sort.k.startsWith("c") ? x.ps[+sort.k.slice(1)].net : x.t.net;
    const A = g(a), B = g(b);
    return (typeof A === "string" ? A.localeCompare(B) : A - B) * sort.d;
  });
  const sortTh = (k, label, extra = {}) => <th key={k} onClick={() => setSort((s) => ({ k, d: s.k === k ? -s.d : -1 }))} style={{ ...th, cursor: "pointer", ...extra }}>{label}{sort.k === k ? (sort.d < 0 ? " ▾" : " ▴") : ""}</th>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {header}
      {/* period + show by */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={segWrap} role="tablist" aria-label="Period">
          {PERIODS.map(([k, l]) => <button key={k} onClick={() => period.set((s) => ({ ...s, p: k }))} style={segBtn(period.p === k)}>{l}</button>)}
        </div>
        <button onClick={() => setCustomOpen(true)} style={{ ...segBtn(period.p === "custom"), background: period.p === "custom" ? T.text : "rgba(118,118,128,0.12)", color: period.p === "custom" ? "#fff" : T.text, minHeight: 34, borderRadius: 17 }}>📅 {period.p === "custom" ? period.label : "Custom…"}</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: T.textSub }}>Show by</span>
        <div style={segWrap} role="tablist" aria-label="Show by">
          {[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]].map(([k, l]) => <button key={k} onClick={() => period.set((s) => ({ ...s, by: k }))} style={segBtn((period.by || "month") === k)}>{l}</button>)}
        </div>
      </div>
      {/* Count by (Elie 10/6/26): the month each payment is FOR, or the date it was entered (matches AppFolio) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: -4 }}>
        <span style={{ fontSize: 12.5, color: T.textSub }}>Count by</span>
        <div style={segWrap} role="tablist" aria-label="Count by">
          {[["for", "Month it's for"], ["entry", "Entry date"]].map(([k, l]) => <button key={k} onClick={() => period.set((s) => ({ ...s, basis: k }))} style={segBtn((period.basis || "for") === k)}>{l}</button>)}
        </div>
        <span style={{ fontSize: 12, color: T.textSub }}>{period.basis === "entry" ? "Each payment in the month it was entered — same as AppFolio's Transactions page." : "Each payment in the month written on it (rent for May paid in June counts in May)."}</span>
      </div>
      {!tot.any && <div style={{ ...card, fontSize: 14, color: T.textSub }}>No numbers for {period.label} yet. Platinum properties fill in when Cowork sends updates; other rentals from their monthly ledger (Details tab){single && onUpdateRental ? <> — or <button onClick={() => setPinOpen(true)} style={{ border: "none", background: "none", color: T.blue, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>📌 pin transactions from QuickBooks</button></> : null}.</div>}
      {tot.any && <>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          {kpi("Money in", money(tot.totalIn), null, vsLY(tot.totalIn, ly.totalIn, false))}
          {kpi("Expenses", money(tot.totalOut), null, vsLY(tot.totalOut, ly.totalOut, true))}
          {kpi("Net", signed(tot.net), netColor(tot.net), <span style={{ color: T.textSub }}>{margin != null ? `${margin}% of money in` : " "}</span>)}
          {rentTile
            ? kpi(`Rent collected · ${mLabel(live.month)}`, `${Math.round((la.rentCollected || 0) / la.rentDue * 100)}%`, null, <span style={{ color: T.textSub }}>{money(la.rentCollected)} of {money(la.rentDue)}</span>)
            : kpi("Cash flow after mortgage", tot.mortgage > 0.5 ? signed(tot.cashFlow) : "—", tot.mortgage > 0.5 ? netColor(tot.cashFlow) : T.textSub, <span style={{ color: T.textSub }}>{tot.mortgage > 0.5 ? `mortgage ${money(tot.mortgage)}` : "add the loan payment in Details"}</span>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1.55fr) minmax(0,1fr)", gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>Money in vs expenses</div>
            <GroupBars rows={chartRows} W={isMobile ? 330 : 620} H={isMobile ? 130 : 180} />
          </div>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}><b style={{ flex: 1, fontSize: 14.5, color: T.text }}>Where the money went</b><span style={{ fontSize: 12, color: T.textSub }}>{money(tot.totalOut)}</span></div>
            {tot.expenses.length === 0 && <div style={{ fontSize: 13, color: T.textSub, padding: "8px 0" }}>No expenses</div>}
            {tot.expenses.slice(0, 8).map((e) => (
              <Fragment key={e.cat}>
                <button onClick={() => e.tx.length && setOpenCat(openCat === e.cat ? null : e.cat)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 30, border: "none", background: "none", padding: 0, cursor: e.tx.length ? "pointer" : "default", fontFamily: "inherit" }}>
                  <span style={{ width: 128, fontSize: 12.5, color: "#3A3A3C", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.cat}</span>
                  <span style={{ flex: 1, height: 10, background: T.bg, borderRadius: 5, overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${Math.max(2, (e.amount / expMax) * 100)}%`, background: OUT_C, borderRadius: 5 }} /></span>
                  <span style={{ width: 70, textAlign: "right", fontSize: 12.5, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: T.text }}>{money(e.amount)}</span>
                </button>
                {openCat === e.cat && <TxList tx={e.tx} />}
              </Fragment>
            ))}
            {tot.expenses.some((e) => e.tx.length) && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4 }}>Click a bar to see every payment behind it</div>}
          </div>
        </div>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <b style={{ flex: 1, fontSize: 14.5, color: T.text }}>P&amp;L by {period.by || "month"}{period.basis === "entry" ? <span style={{ fontWeight: 600, fontSize: 12, color: "#8a6d1f", background: "#FDF9EE", border: "1px solid #EAD9A9", borderRadius: 6, padding: "1px 6px", marginLeft: 8 }}>by entry date</span> : null}</b>
            <span style={{ fontSize: 12, color: T.textSub }}>click a number for the payments</span>
            {single && onUpdateRental && <button onClick={() => setPinOpen(true)} style={{ minHeight: 30, padding: "0 12px", borderRadius: 15, border: "none", background: GOLD, fontSize: 12.5, fontWeight: 650, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>📌 Pin from QuickBooks</button>}
            <button onClick={exportCsv} style={{ minHeight: 30, padding: "0 10px", borderRadius: 15, border: `1px solid ${T.border}`, background: T.card, fontSize: 12.5, fontWeight: 600, color: T.text, cursor: "pointer", fontFamily: "inherit" }}>⬇ Export</button>
          </div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
              <thead><tr><th style={{ ...th, ...first }} />{cols.map((b) => <th key={b.key} style={th}>{b.label}{b.partial ? "*" : ""}</th>)}<th style={{ ...th, ...totC }}>Total</th></tr></thead>
              <tbody>
                {grp("Income")}
                {cats("income").map((c) => catLine("income", c))}
                {sumLine("Total income", (p) => p.totalIn)}
                {grp("Expenses")}
                {cats("expenses").map((c) => catLine("expenses", c))}
                {sumLine("Total expenses", (p) => p.totalOut)}
                {sumLine("Net", (p) => p.net, { color: true, signed: true })}
                {tot.mortgage > 0.5 && sumLine(mtgPinned ? "Mortgage 📌" : "Mortgage", (p) => -p.mortgage, { signed: true, bold: false })}
                {tot.mortgage > 0.5 && sumLine("Cash flow", (p) => p.cashFlow, { color: true, signed: true })}
              </tbody>
            </table>
          </div>
          {cols.some((b) => b.partial) && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 6 }}>* {mLabel(ymNow(), "long")} so far</div>}
        </div>
        {single && onUpdateRental && <PinnedList rental={rental} onSave={onUpdateRental} />}
        {!single && <div style={card}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}><b style={{ flex: 1, fontSize: 14.5, color: T.text }}>Compare properties</b><span style={{ fontSize: 12, color: T.textSub }}>click a column to sort · a row to open</span></div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
              <thead><tr>
                {sortTh("name", "Property", { ...first, textAlign: "left" })}
                {cols.length > 1 && cols.length <= 12 && cols.map((b, i) => sortTh(`c${i}`, `${b.label}${b.partial ? "*" : ""}`))}
                {sortTh("in", "Money in")}{sortTh("out", "Expenses")}{sortTh("net", "Net", totC)}{sortTh("margin", "Margin")}
              </tr></thead>
              <tbody>
                {cmpSorted.map((x) => (
                  <tr key={x.r.id} onClick={() => onOpen(x.r.id)} style={{ cursor: "pointer" }}>
                    <td style={{ ...td, ...first }}>{x.r.address}</td>
                    {cols.length > 1 && cols.length <= 12 && x.ps.map((p, i) => <td key={cols[i].key} style={{ ...td, color: p.any ? netColor(p.net) : T.textTert }}>{p.any ? snum(p.net) : "—"}</td>)}
                    <td style={td}>{num0(x.t.totalIn)}</td><td style={td}>{num0(x.t.totalOut)}</td>
                    <td style={{ ...td, ...totC, color: x.t.any ? netColor(x.t.net) : T.textTert }}>{x.t.any ? snum(x.t.net) : "—"}</td>
                    <td style={{ ...td, color: x.margin != null && x.margin < 0 ? RED : T.text }}>{x.margin != null ? `${x.margin}%` : "—"}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, ...first, fontWeight: 700 }}>Total</td>
                  {cols.length > 1 && cols.length <= 12 && per.map((p, i) => <td key={cols[i].key} style={{ ...td, fontWeight: 700, color: netColor(p.net) }}>{snum(p.net)}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{num0(tot.totalIn)}</td><td style={{ ...td, fontWeight: 700 }}>{num0(tot.totalOut)}</td>
                  <td style={{ ...td, ...totC, color: netColor(tot.net) }}>{snum(tot.net)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{margin != null ? `${margin}%` : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {cmp.some((x) => !x.t.any) && tot.any && per.some((p, i) => p.any && !cmp.some((x) => x.ps[i].any)) && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 6 }}>Some months only have Platinum's all-properties total, so they show in the Total row but not per property.</div>}
        </div>}
      </>}
      {cell && <Sheet title={cell.title} sub={`${cell.tx.length} payment${cell.tx.length === 1 ? "" : "s"}`} isMobile={isMobile} onClose={() => setCell(null)}><div style={{ ...card, padding: "4px 14px" }}><TxList tx={cell.tx} plain /></div></Sheet>}
      {customOpen && <CustomSheet period={period} isMobile={isMobile} onClose={() => setCustomOpen(false)} />}
      {pinOpen && single && <PinSheet rental={rental} period={period} isMobile={isMobile} onSave={onUpdateRental} onClose={() => setPinOpen(false)} rentCats={rentCatsFor(rental, ctx)} />}
    </div>
  );
}

// Payments behind a number: Entry date (when it was entered / paid) ·
// Description · For (the month it counts toward) · Amount (Elie 10/6/26).
function TxList({ tx, plain }) {
  const list = [...tx].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const yr = new Date().getFullYear();
  const day = (d) => { const x = new Date(String(d).slice(0, 10) + "T00:00:00"); return isNaN(x) ? d : x.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(x.getFullYear() !== yr ? { year: "2-digit" } : {}) }); };
  const forLbl = (t) => { const f = t.forYm || forMonth(t); return f ? `${mLabel(f)} ${f.slice(0, 4)}` : ""; };
  const head = { fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: "none" };
  return (
    <div style={{ background: plain ? "transparent" : T.bg, borderRadius: 10, padding: plain ? 0 : "2px 10px", margin: plain ? 0 : "2px 0 6px" }}>
      <div style={{ display: "flex", gap: 10, padding: "6px 0 4px" }}>
        <span style={{ ...head, width: 62, flexShrink: 0 }}>Entry date</span>
        <span style={{ ...head, flex: 1 }}>Description</span>
        <span style={{ ...head, width: 70, flexShrink: 0 }}>For</span>
        <span style={{ ...head, width: 80, textAlign: "right", flexShrink: 0 }}>Amount</span>
      </div>
      {list.map((t, j) => {
        const f = t.forYm || forMonth(t), moved = f && f !== String(t.date).slice(0, 7);
        return (
          <div key={j} style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "6px 0", borderTop: `1px solid ${T.border}`, alignItems: "baseline" }}>
            <span style={{ color: T.textSub, width: 62, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{day(t.date)}</span>
            <span style={{ flex: 1, minWidth: 0, color: T.text }}>{t.payee ? `${t.payee} — ` : ""}{t.desc}{t.name ? <span style={{ color: T.textSub }}> · {t.name}{t.unit ? ` ${(String(t.unit).match(/#\S+$/) || [""])[0]}` : ""}</span> : null}{t.pinned ? <span title="From QuickBooks"> 📌</span> : null}{t.rev ? <span style={{ display: "block", fontSize: 11.5, color: RED }}>Bounced — cancels the {t.reverses ? new Date(t.reverses.slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " payment" : "payment"}</span> : null}</span>
            <span style={{ width: 70, flexShrink: 0, color: moved ? "#B45309" : T.textSub, fontWeight: moved ? 650 : 400 }}>{forLbl(t)}</span>
            <span style={{ width: 80, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums", fontWeight: 600, color: t.amount < 0 ? RED : T.text }}>{money(t.amount, true)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CustomSheet({ period, isMobile, onClose }) {
  const [from, setFrom] = useState(period.from), [to, setTo] = useState(period.to);
  const now = ymNow();
  const inp = { width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 44, borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, padding: "0 12px", fontSize: 16, fontFamily: "inherit", color: T.text };
  const lab = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: T.textSub };
  return (
    <Sheet title="Custom dates" sub="Pick the first and last month" isMobile={isMobile} onClose={onClose}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <label style={lab}>From<input type="month" value={from} max={now} onChange={(e) => e.target.value && setFrom(e.target.value)} style={inp} /></label>
        <label style={lab}>To<input type="month" value={to} max={now} onChange={(e) => e.target.value && setTo(e.target.value)} style={inp} /></label>
      </div>
      <button onClick={() => { const a = from <= to ? from : to, b = from <= to ? to : from; period.set((s) => ({ ...s, p: "custom", from: a, to: b })); onClose(); }} style={{ width: "100%", minHeight: 50, borderRadius: 25, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>Show {from <= to ? `${mLabel(from)} – ${mLabel(to)}` : `${mLabel(to)} – ${mLabel(from)}`}</button>
    </Sheet>
  );
}

// Earliest month any rental has numbers for (for "All time").
export function firstDataMonth(rentals, live) {
  let m = null;
  const take = (x) => { if (x && (!m || x < m)) m = x; };
  rentals.forEach((r) => { (r.ledger || []).forEach((L) => take(L.month)); (r.qbPins || []).forEach((p) => pinParts(p).forEach((x) => take(x.ym))); });
  if (live) { (live.monthList || []).forEach(take); live.txns.forEach((t) => take(forMonth(t))); }
  return m;
}
