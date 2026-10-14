// 📋 Delinquency report (Elie approved 10/6/26): every tenant on every rental,
// what they owe as of any date, aged 0–30 / 31–60 / 61–90 / 90+, with a
// month-by-month ledger per tenant, Excel (CSV) + PDF export.
//
// How a balance is worked out, per tenant:
//   • start from the latest Platinum packet's rent roll on/before the date
//     ("Past Due" as of the packet date — includes late fees AppFolio charged);
//     no packet → start at the first month we have rent payments for the
//     property, owing $0;
//   • + each month's rent after that (lease rent from the rent roll, else the
//     rental's unit list), through the as-of month (stops at move-out);
//   • − every rent payment entered after the packet date: Platinum's rent lines
//     (rentPaymentsFor — bounced ones count back), prepaid rent, rent pinned
//     from QuickBooks as paid to Elie directly, and late fees paid toward the
//     packet's balance.
// A payment counts toward the month written on it; one with no month goes to
// the oldest month still owed (as does any overpayment of a month).
import { Fragment, useMemo, useState } from "react";
import { T } from "./theme";
import { rentPaymentsFor, unitLabel, addMonths, monthsBetween, mLabel } from "./rentalsPL";

import { pad, isoOf, todayIso, dayDiff, shiftDays, num, r2, unitKey, dShort, bucketOf, BUCKETS, packetFor, tenantLedger, agingOf, delinquency, owedByRental } from "./rentalsDelinqEngine.js";
export { todayIso, dShort, BUCKETS, delinquency, owedByRental };
// ── screen ──
const money = (v) => { const n = Math.round(Number(v) || 0); return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString()}`; };
const num0 = (v) => { const n = Math.round(Number(v) || 0); return n === 0 ? "—" : `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`; };
const RED = "#D70015", GREEN = "#248A3D", ORANGE = "#B45309", GOLD = "#B8953F";
const AGE_BG = ["#FFF7F6", "#FFEDEB", "#FFDCD8", "#FFC6C0"];
const CHIP = { red: { background: "#FFE9E7", color: "#C4170C" }, gr: { background: "#E8F7EC", color: "#1F7A36" }, or: { background: "#FFF1E0", color: ORANGE }, mu: { background: "rgba(118,118,128,0.12)", color: "#3A3A3C" } };
const card = { background: T.card, borderRadius: 14, border: `1px solid ${T.border}` };
const capsule = { minHeight: 34, padding: "0 12px", borderRadius: 17, border: "none", background: "rgba(118,118,128,0.12)", color: T.text, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
const btn = (gold) => ({ minHeight: 34, padding: "0 13px", borderRadius: 17, border: gold ? "none" : `1px solid ${T.border}`, background: gold ? GOLD : T.card, color: gold ? "#fff" : T.text, fontSize: 13, fontWeight: 650, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" });
const payTxt = (p, applied) => `${dShort(p.date)} ${money(p.amount)}${p.rev ? " ↩ bounced" : ""}${p.hap ? " HAP" : ""}${p.src === "pin" ? " (paid to you)" : ""}${applied ? " (no month)" : ""}`;
const tenantName = (t) => t.name || (t.label ? `${t.label} tenant` : "Tenant");
const lastTxt = (t) => (t.last ? `${dShort(t.last.date)} · ${money(t.last.amount)}${t.last.hap ? " HAP" : ""}` : "—");

function asOfChoices() {
  const now = new Date(), out = [{ v: "today", l: "As of today" }];
  for (let k = 0; k < 6; k++) { const d = new Date(now.getFullYear(), now.getMonth() - k, 0); out.push({ v: isoOf(d), l: `As of ${dShort(isoOf(d), true)}` }); }
  return out;
}

export function DelinquencyReport({ rentals, ctx, isMobile, header, onOpen, onUpdate }) {
  const [propSel, setPropSel] = useState("all");
  const [asSel, setAsSel] = useState("today");
  const nowYm = todayIso().slice(0, 7);
  const [rFrom, setRFrom] = useState(() => addMonths(nowYm, -2));
  const [rTo, setRTo] = useState(nowYm);
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  // "Date range" (Elie 10/6/26): only the rent for those months, still unpaid today.
  const isRange = asSel === "range";
  const range = isRange ? { from: rFrom <= rTo ? rFrom : rTo, to: rFrom <= rTo ? rTo : rFrom } : null;
  const rangeLabel = range ? (range.from === range.to ? `${mLabel(range.from)} ${range.from.slice(0, 4)}` : `${mLabel(range.from)}${range.from.slice(0, 4) !== range.to.slice(0, 4) ? ` ${range.from.slice(0, 4)}` : ""} – ${mLabel(range.to)} ${range.to.slice(0, 4)}`) : "";
  const asOf = asSel === "today" || isRange ? todayIso() : asSel;
  const set = propSel === "all" ? rentals : rentals.filter((r) => String(r.id) === String(propSel));
  const d = useMemo(() => delinquency(set, ctx, asOf, range), [set, ctx, asOf, rangeLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const wk = useMemo(() => (isRange ? null : delinquency(set, ctx, shiftDays(asOf, -7))), [set, ctx, asOf, isRange]);
  const change = wk ? r2(d.total - wk.total) : 0;
  const over60 = r2(d.aging[2] + d.aging[3]);
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const behindProps = d.props.filter((p) => p.owed > 0.5).sort((a, b) => b.owed - a.owed);
  const currentTenants = d.props.flatMap((p) => p.tenants.filter((t) => !(t.owed > 0.5) && !t.vacant));
  const vacantTenants = d.props.flatMap((p) => p.tenants.filter((t) => t.vacant));
  // Mark a unit vacant (wipes what's owed) / a new tenant moved in / undo.
  const setMark = (t, val) => {
    if (!onUpdate) return;
    const k = t.key || "_";
    const marks = { ...(t.rental.dqMarks || {}) };
    if (val) marks[k] = { ...val, at: new Date().toISOString() }; else delete marks[k];
    onUpdate(t.rental.id, { dqMarks: marks });
  };
  const markVacant = (t) => {
    const who = `${tenantName(t)}${t.label ? ` (${t.label})` : ""} at ${t.rental.address}`;
    if (!window.confirm(`Mark ${who} vacant?\n\n${t.owed > 0.5 ? `The ${money(t.owed)} they owe will be wiped out of this report. ` : ""}No rent is counted while it's vacant. You can undo this any time.`)) return;
    setMark(t, { vacant: true });
  };
  const pctCollected = d.monthRent > 0 ? Math.round((d.monthPaid / d.monthRent) * 100) : null;
  const title = `Delinquency report${propSel !== "all" && set[0] ? ` — ${set[0].address}` : ""}`;

  const exportCsv = () => {
    const rows = [["Property", "Tenant", "Unit", "Rent", "Owed", ...BUCKETS, "Last paid", "History", "AppFolio says"]];
    d.props.forEach((p) => p.tenants.forEach((t) => rows.push([p.r.address, tenantName(t), t.label, t.rent, t.owed, ...t.aging, lastTxt(t), t.tags.map((x) => x.t).join(" · "), t.af ? `${t.af.pastDue} on ${t.af.asOf}` : ""])));
    rows.push(["Total", "", "", "", d.total, ...d.aging]);
    rows.push([]); rows.push(["Month by month"]); rows.push(["Property", "Tenant", "Month", "Rent charged", "Paid for it", "Payments", "Still owed"]);
    d.props.forEach((p) => p.tenants.forEach((t) => t.rows.forEach((w) => rows.push([p.r.address, tenantName(t), w.label, w.charged, r2(w.charged - w.due), w.pays.map((x) => payTxt(x)).join(" · "), w.due]))));
    const csv = "\ufeff" + rows.map((r) => r.map((x) => (/[",\n]/.test(String(x ?? "")) ? `"${String(x).replace(/"/g, '""')}"` : x ?? "")).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `Delinquency report ${String(isRange ? rangeLabel : asOf).replace(/[^\w ]+/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  const exportPdf = async () => {
    if (busy) return; setBusy(true);
    try {
      const { delinquencyPdfFile } = await import("./delinqPdf.js");
      const file = await delinquencyPdfFile(d, { title, asOf, change, over60, pctCollected, rangeLabel });
      const canShare = isMobile && navigator.canShare && navigator.canShare({ files: [file] });
      if (canShare) { try { await navigator.share({ files: [file], title }); } catch { /* cancelled */ } }
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
    } finally { setBusy(false); }
  };

  const kpi = (label, val, color, sub) => (
    <div style={{ ...card, padding: "10px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: isMobile ? 19 : 22, fontWeight: 750, color: color || T.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{val}</div>
      <div style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{sub}</div>
    </div>
  );
  const th = (l) => ({ fontSize: 11.5, fontWeight: 600, color: T.textSub, textAlign: l ? "left" : "right", padding: "9px 8px 6px", whiteSpace: "nowrap" });
  const td = (l, extra) => ({ textAlign: l ? "left" : "right", padding: "8px 8px", borderTop: `1px solid ${T.border}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 13, color: T.text, ...extra });
  const sticky = { position: "sticky", left: 0, zIndex: 1 };
  const groupRow = (label, amt, color, onClick, k) => (
    <tr key={k}>
      <td colSpan={3} style={{ ...td(true), ...sticky, fontWeight: 700, fontSize: 13.5, background: "#FAFAFB" }}>{onClick ? <button onClick={onClick} style={{ border: "none", background: "none", padding: 0, font: "inherit", color: T.text, cursor: "pointer" }}>{label} ›</button> : label}</td>
      <td style={{ ...td(), fontWeight: 700, background: "#FAFAFB", color }}>{num0(amt) === "—" ? "0" : num0(amt)}</td>
      <td colSpan={7} style={{ ...td(), background: "#FAFAFB" }} />
    </tr>
  );
  const tenantRow = (t, i, showProp) => {
    const id = `${t.rental.id}|${t.label}|${i}`;
    const on = open.has(id);
    const behind = t.owed > 0.5;
    return (
      <Fragment key={id}>
        <tr>
          <td style={{ ...td(true), ...sticky, background: T.card }}>
            <button onClick={() => toggle(id)} aria-expanded={on} style={{ border: "none", background: "none", padding: 0, font: "inherit", color: T.text, cursor: "pointer", fontWeight: behind ? 700 : 500, minHeight: 28 }}>{tenantName(t)} <span style={{ color: T.textSub, fontSize: 11 }}>{on ? "▾" : "▸"}</span></button>
          </td>
          <td style={{ ...td(true), color: showProp || !t.label ? T.textSub : T.text }}>{showProp ? t.rental.address.replace(/\s+(Avenue|Ave|Street|St|Road|Rd|Drive|Dr)\.?$/i, "") : t.label || "—"}</td>
          <td style={td()}>{num0(t.rent)}</td>
          <td style={{ ...td(), fontWeight: 700, color: t.vacant ? T.textSub : behind ? RED : GREEN }}>{t.vacant ? "—" : behind ? num0(t.owed) : t.owed < -0.5 ? num0(t.owed) : "0"}</td>
          {t.aging.map((v, k) => <td key={k} style={{ ...td(), background: behind && v > 0.5 ? AGE_BG[k] : undefined }}>{behind ? num0(v) : "—"}</td>)}
          <td style={td(true)}>{lastTxt(t)}</td>
          <td style={{ ...td(true), whiteSpace: "normal", minWidth: 110, lineHeight: 1.7 }}>{t.tags.map((x) => <span key={x.t} style={{ ...CHIP[x.c], display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "1px 6px", marginRight: 4 }}>{x.t}</span>)}</td>
          <td style={{ ...td(true), color: T.textSub, whiteSpace: "normal", minWidth: 80 }}>{t.af ? `${money(t.af.pastDue)} · ${dShort(t.af.asOf)}` : "—"}</td>
        </tr>
        {on && <tr><td colSpan={11} style={{ background: "#FBFAF7", padding: "0 8px 10px" }}>
          <div style={{ position: "sticky", left: 8, ...(isMobile ? { width: "calc(100vw - 60px)" } : { width: 0, minWidth: "100%" }), overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>{["Month", "Rent charged", "Paid for it", "Payments", "Still owed"].map((h, k) => <th key={h} style={{ ...th(k === 0 || k === 3), padding: "6px 8px", fontSize: 11 }}>{h}</th>)}</tr></thead>
              <tbody>
                {[...t.rows].reverse().map((w) => (
                  <tr key={w.label}>
                    <td style={{ ...td(true), fontSize: 12.5, padding: "5px 8px", fontWeight: w.open ? 600 : 400 }}>{w.label}</td>
                    <td style={{ ...td(), fontSize: 12.5, padding: "5px 8px" }}>{num0(w.charged)}</td>
                    <td style={{ ...td(), fontSize: 12.5, padding: "5px 8px" }}>{num0(w.charged - w.due)}</td>
                    <td style={{ ...td(true), fontSize: 12.5, padding: "5px 8px", color: T.textSub, whiteSpace: "normal", minWidth: 220 }}>{w.pays.length ? w.pays.map((p) => payTxt(p)).join(" · ") : "—"}{w.applied.length ? `${w.pays.length ? " · " : ""}+ ${money(w.applied.reduce((s, x) => s + x, 0))} from a payment with no month` : ""}{w.credit ? ` · ${money(w.credit)} extra moved to the oldest month owed` : ""}</td>
                    <td style={{ ...td(), fontSize: 12.5, padding: "5px 8px", color: w.due > 0.5 ? RED : GREEN, fontWeight: 600 }}>{w.due > 0.5 ? num0(w.due) : "paid"}</td>
                  </tr>
                ))}
                {t.credit > 0.5 && <tr><td colSpan={4} style={{ ...td(true), fontSize: 12.5, padding: "5px 8px" }}>Paid ahead (credit)</td><td style={{ ...td(), fontSize: 12.5, padding: "5px 8px", color: GREEN, fontWeight: 600 }}>−{num0(t.credit)}</td></tr>}
                {!t.rows.length && <tr><td colSpan={5} style={{ ...td(true), fontSize: 12.5, color: T.textSub }}>Nothing charged or paid since {d.props.find((p) => p.r === t.rental)?.packet ? "the packet" : "the start of the data"}.</td></tr>}
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4 }}>Payments count toward the month written on them; a payment with no month goes to the oldest month still owed.{t.af && !t.fresh ? ` Starts from AppFolio's past due on ${dShort(t.af.asOf, true)}.` : ""}{t.fresh ? ` New tenant — starts fresh in ${mLabel(t.fresh)} ${t.fresh.slice(0, 4)}.` : ""}</div>
            {onUpdate && t.key !== "?" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              {t.marked ? <>
                <span style={{ fontSize: 12.5, color: T.textSub }}>Marked vacant — not counted.</span>
                <button onClick={() => setMark(t, null)} style={btn(false)}>Undo vacant</button>
                <label style={{ ...btn(false), position: "relative", display: "inline-flex", alignItems: "center" }}>New tenant moved in… ▾
                  <select aria-label="New tenant from month" value="" onChange={(e) => e.target.value && setMark(t, { startYm: e.target.value })} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", fontSize: 16 }}>
                    <option value="">Starting which month?</option>
                    {monthsBetween(addMonths(asOf.slice(0, 7), -12), addMonths(asOf.slice(0, 7), 1)).reverse().map((ym) => <option key={ym} value={ym}>{mLabel(ym)} {ym.slice(0, 4)}</option>)}
                  </select>
                </label>
              </> : t.fresh ? <>
                <span style={{ fontSize: 12.5, color: T.textSub }}>New tenant from {mLabel(t.fresh)} {t.fresh.slice(0, 4)}.</span>
                <button onClick={() => setMark(t, null)} style={btn(false)}>Undo</button>
                <button onClick={() => markVacant(t)} style={btn(false)}>Mark vacant</button>
              </> : <button onClick={() => markVacant(t)} style={btn(false)}>{t.vacant ? "Yes, it's vacant" : "Mark vacant — wipes what's owed"}</button>}
            </div>}
          </div>
        </td></tr>}
      </Fragment>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          {header}
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: T.text }}>Delinquency report</div>
          <div style={{ fontSize: 13, color: T.textSub }}>{isRange ? <>Rent for <b style={{ color: T.text }}>{rangeLabel}</b> still unpaid as of {dShort(asOf, true)}</> : <>As of {dShort(asOf, true)}</>} · rent from each lease minus every payment (Platinum + paid to you) · bounced payments taken back out</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select aria-label="Property" value={propSel} onChange={(e) => setPropSel(e.target.value)} style={capsule}>
            <option value="all">🏘 All properties</option>
            {rentals.map((r) => <option key={r.id} value={String(r.id)}>{r.address}</option>)}
          </select>
          <select aria-label="As of" value={asSel} onChange={(e) => setAsSel(e.target.value)} style={capsule}>
            {asOfChoices().map((c) => <option key={c.v} value={c.v}>📅 {c.l}</option>)}
            <option value="range">📅 Date range…</option>
          </select>
          {isRange && <>
            <select aria-label="From month" value={rFrom} onChange={(e) => setRFrom(e.target.value)} style={capsule}>
              {monthsBetween(addMonths(nowYm, -35), nowYm).reverse().map((ym) => <option key={ym} value={ym}>From {mLabel(ym)} {ym.slice(0, 4)}</option>)}
            </select>
            <select aria-label="To month" value={rTo} onChange={(e) => setRTo(e.target.value)} style={capsule}>
              {monthsBetween(addMonths(nowYm, -35), nowYm).reverse().map((ym) => <option key={ym} value={ym}>To {mLabel(ym)} {ym.slice(0, 4)}</option>)}
            </select>
          </>}
          <button onClick={exportCsv} style={btn(false)}>⬇ Excel</button>
          <button onClick={exportPdf} style={btn(true)}>{busy ? "Making PDF…" : "📄 PDF to send"}</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
        {isRange
          ? kpi(`Unpaid for ${rangeLabel}`, money(d.total), d.total > 0.5 ? RED : GREEN, `of ${money(d.monthRent)} rent charged`)
          : kpi("Total owed", money(d.total), d.total > 0.5 ? RED : GREEN, Math.abs(change) > 0.5 ? `${change > 0 ? "↑" : "↓"} ${money(Math.abs(change))} since last week` : "same as last week")}
        {kpi("Tenants behind", `${d.behind.length} of ${d.occupied}`, null, "occupied units")}
        {kpi("Over 60 days", money(over60), over60 > 0.5 ? RED : T.text, d.total > 0.5 ? `${Math.round((over60 / d.total) * 100)}% of what's owed` : "nothing")}
        {kpi(isRange ? "Collected for those months" : `${mLabel(asOf.slice(0, 7), "long")} collected`, pctCollected == null ? "—" : `${pctCollected}%`, null, `${money(d.monthPaid)} of ${money(d.monthRent)}`)}
      </div>
      <div style={{ ...card, padding: "4px 14px 10px", overflowX: "auto" }}>
        {!d.tenants.length ? <div style={{ padding: "26px 8px", textAlign: "center", color: T.textSub, fontSize: 14 }}>No rent data yet — add tenants' rent on each rental, or upload a Platinum packet / update.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr>
              <th style={{ ...th(true), ...sticky, background: T.card }}>Tenant</th><th style={th(true)}>Unit</th><th style={th()}>Rent</th><th style={th()}>Owed</th>
              {BUCKETS.map((b) => <th key={b} style={th()}>{b}</th>)}
              <th style={th(true)}>Last paid</th><th style={th(true)}>History</th><th style={{ ...th(true), whiteSpace: "normal" }}>AppFolio says</th>
            </tr></thead>
            <tbody>
              {behindProps.map((p) => (
                <Fragment key={p.r.id}>
                  {groupRow(p.r.address, p.owed, p.aging[1] + p.aging[2] + p.aging[3] > 0.5 ? RED : ORANGE, onOpen ? () => onOpen(p.r.id) : null, `g${p.r.id}`)}
                  {p.tenants.filter((t) => t.owed > 0.5).sort((a, b) => b.owed - a.owed).map((t, i) => tenantRow(t, i, false))}
                </Fragment>
              ))}
              {currentTenants.length > 0 && <>
                {groupRow("Current / paid ahead", 0, GREEN, null, "gcur")}
                {currentTenants.sort((a, b) => a.owed - b.owed).map((t, i) => tenantRow(t, 100 + i, true))}
              </>}
              {vacantTenants.length > 0 && <>
                {groupRow("Vacant — not counted", 0, T.textSub, null, "gvac")}
                {vacantTenants.map((t, i) => tenantRow(t, 200 + i, true))}
              </>}
              <tr>
                <td colSpan={3} style={{ ...td(true), ...sticky, fontWeight: 700, background: "#FAFAFB" }}>Total</td>
                <td style={{ ...td(), fontWeight: 700, background: "#FAFAFB", color: d.total > 0.5 ? RED : GREEN }}>{num0(d.total) === "—" ? "0" : num0(d.total)}</td>
                {d.aging.map((v, k) => <td key={k} style={{ ...td(), fontWeight: 700, background: v > 0.5 ? AGE_BG[k] : "#FAFAFB" }}>{num0(v)}</td>)}
                <td colSpan={3} style={{ ...td(), background: "#FAFAFB" }} />
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <div style={{ fontSize: 12, color: T.textSub, margin: "10px 4px 0", lineHeight: 1.5 }}>
        Tap a tenant for the month-by-month ledger. Balances start from the latest Platinum packet's past due (when there is one), then add each month's rent and take off every payment since. Late fees or court costs Platinum charges after the packet show up with the next packet — compare the “AppFolio says” column.
      </div>
    </div>
  );
}
