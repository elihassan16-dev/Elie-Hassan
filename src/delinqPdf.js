// 📄 Delinquency report PDF (Elie 10/6/26) — something clean to send to
// Platinum or an attorney: the summary table (every tenant, owed, aging,
// last paid) and then, for each tenant who's behind, the month-by-month
// ledger. jsPDF loads on demand.
import { BUCKETS, dShort } from "./rentalsDelinq.jsx";

const GOLD = [184, 145, 46], INK = [28, 28, 30], SUB = [96, 96, 100], LINE = [226, 226, 230], RED = [196, 23, 12], GREEN = [31, 122, 54], BAND = [246, 246, 248];
const CO = { name: "Goldstone Properties LLC", addr: "17 Natures Way, Lakewood, New Jersey 08701" };
const m0 = (v) => { const n = Math.round(Number(v) || 0); return n === 0 ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`; };
const tName = (t) => t.name || (t.label ? `${t.label} tenant` : "Tenant");

export async function delinquencyPdfFile(d, { title, asOf, change, over60, pctCollected }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40, R = W - M;
  let y = 0;
  const head = () => {
    doc.setFont("times", "bold"); doc.setFontSize(18); doc.setTextColor(...INK); doc.text("Goldstone Properties", M, 46);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...GOLD); doc.text("DELINQUENCY REPORT", R, 40, { align: "right", charSpace: 1.5 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SUB); doc.text(`As of ${dShort(asOf, true)}`, R, 54, { align: "right" });
    doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(M, 62, R, 62);
    y = 82;
  };
  const room = (h) => { if (y + h > H - 50) { doc.addPage(); head(); return true; } return false; };
  head();
  doc.setFont("times", "bold"); doc.setFontSize(16); doc.setTextColor(...INK); doc.text(title, M, y); y += 20;
  // KPI strip
  const kp = [["Total owed", m0(d.total)], ["Tenants behind", `${d.behind.length} of ${d.occupied}`], ["Over 60 days", m0(over60)], [`Collected this month`, pctCollected == null ? "—" : `${pctCollected}%  (${m0(d.monthPaid)} of ${m0(d.monthRent)})`]];
  const kw = (R - M) / 4;
  kp.forEach(([l, v], i) => {
    const x = M + i * kw;
    doc.setFillColor(...BAND); doc.roundedRect(x, y, kw - 8, 40, 6, 6, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...SUB); doc.text(l, x + 10, y + 14);
    doc.setFont("helvetica", "bold"); doc.setFontSize(i === 3 ? 10.5 : 13); doc.setTextColor(...(i === 0 && d.total > 0.5 ? RED : INK)); doc.text(v, x + 10, y + 31);
  });
  y += 54;
  if (Math.abs(change) > 0.5) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...SUB); doc.text(`${change > 0 ? "Up" : "Down"} ${m0(Math.abs(change))} from a week earlier.`, M, y); y += 14; }

  // Summary table
  const cols = [
    { h: "Tenant", w: 118, l: true }, { h: "Unit / property", w: 98, l: true }, { h: "Rent", w: 48 }, { h: "Owed", w: 56 },
    ...BUCKETS.map((b) => ({ h: b, w: 48 })), { h: "Last paid", w: 84, l: true }, { h: "History", w: 0, l: true },
  ];
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols[cols.length - 1].w = R - M - fixed;
  const xs = []; cols.reduce((x, c) => { xs.push(x); return x + c.w; }, M);
  const cell = (c, i, txt, opt = {}) => {
    doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(opt.size || 8.8); doc.setTextColor(...(opt.color || INK));
    const s = doc.splitTextToSize(String(txt ?? ""), c.w - 8)[0] || "";
    if (c.l) doc.text(s, xs[i] + 4, y); else doc.text(s, xs[i] + c.w - 4, y, { align: "right" });
  };
  const header = () => { doc.setFillColor(...BAND); doc.rect(M, y - 11, R - M, 16, "F"); cols.forEach((c, i) => cell(c, i, c.h, { bold: true, size: 8, color: SUB })); y += 16; };
  header();
  const line = () => { doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y - 11, R, y - 11); };
  const group = (label, amt, color) => { if (room(34)) header(); line(); doc.setFillColor(250, 250, 251); doc.rect(M, y - 11, R - M, 16, "F"); cell(cols[0], 0, label, { bold: true, size: 9.5 }); cell(cols[3], 3, m0(amt), { bold: true, color }); y += 16; };
  const row = (t, showProp) => {
    if (room(18)) header();
    line();
    const behind = t.owed > 0.5;
    cell(cols[0], 0, tName(t), { bold: behind });
    cell(cols[1], 1, showProp ? t.rental.address : t.label || "—", { color: SUB });
    cell(cols[2], 2, m0(t.rent));
    cell(cols[3], 3, t.vacant ? "—" : behind ? m0(t.owed) : t.owed < -0.5 ? m0(t.owed) : "$0", { bold: true, color: t.vacant ? SUB : behind ? RED : GREEN });
    t.aging.forEach((v, k) => cell(cols[4 + k], 4 + k, behind ? m0(v) : "—"));
    cell(cols[8], 8, t.last ? `${dShort(t.last.date)} · ${m0(t.last.amount)}` : "—");
    cell(cols[9], 9, t.tags.map((x) => x.t).join(" · "), { color: SUB, size: 8 });
    y += 16;
  };
  const behindProps = d.props.filter((p) => p.owed > 0.5).sort((a, b) => b.owed - a.owed);
  behindProps.forEach((p) => { group(p.r.address, p.owed, RED); p.tenants.filter((t) => t.owed > 0.5).sort((a, b) => b.owed - a.owed).forEach((t) => row(t, false)); });
  const cur = d.props.flatMap((p) => p.tenants.filter((t) => !(t.owed > 0.5) && !t.vacant));
  if (cur.length) { group("Current / paid ahead", 0, GREEN); cur.sort((a, b) => a.owed - b.owed).forEach((t) => row(t, true)); }
  if (room(18)) header();
  line(); doc.setFillColor(...BAND); doc.rect(M, y - 11, R - M, 16, "F");
  cell(cols[0], 0, "Total", { bold: true }); cell(cols[3], 3, m0(d.total), { bold: true, color: d.total > 0.5 ? RED : INK });
  d.aging.forEach((v, k) => cell(cols[4 + k], 4 + k, m0(v), { bold: true }));
  y += 26;

  // Ledgers for everyone who's behind
  const behind = behindProps.flatMap((p) => p.tenants.filter((t) => t.owed > 0.5).sort((a, b) => b.owed - a.owed));
  if (behind.length) {
    if (room(60)) { /* new page */ }
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...GOLD); doc.text("MONTH BY MONTH", M, y, { charSpace: 1.5 }); y += 16;
    const lc = [{ h: "Month", w: 110, l: true }, { h: "Rent charged", w: 80 }, { h: "Paid for it", w: 80 }, { h: "Payments", w: 0, l: true }, { h: "Still owed", w: 80 }];
    lc[3].w = R - M - lc.reduce((s, c) => s + c.w, 0);
    const lx = []; lc.reduce((x, c) => { lx.push(x); return x + c.w; }, M);
    const lcell = (i, txt, opt = {}) => {
      const c = lc[i];
      doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(opt.size || 8.5); doc.setTextColor(...(opt.color || INK));
      const lines = doc.splitTextToSize(String(txt ?? ""), c.w - 8);
      if (c.l) doc.text(lines, lx[i] + 4, y, { lineHeightFactor: 1.25 }); else doc.text(lines[0] || "", lx[i] + c.w - 4, y, { align: "right" });
      return lines.length;
    };
    behind.forEach((t) => {
      if (room(70)) { /* new page */ }
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...INK);
      doc.text(`${tName(t)} — ${t.rental.address}${t.label ? ` (${t.label})` : ""}`, M, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...RED); doc.text(`Owes ${m0(t.owed)}`, R, y, { align: "right" });
      y += 14;
      doc.setFillColor(...BAND); doc.rect(M, y - 10, R - M, 14, "F");
      lc.forEach((c, i) => lcell(i, c.h, { bold: true, size: 7.8, color: SUB }));
      y += 14;
      [...t.rows].reverse().forEach((w) => {
        const pays = [...w.pays.map((p) => `${dShort(p.date)} ${m0(p.amount)}${p.rev ? " bounced" : ""}${p.hap ? " HAP" : ""}${p.src === "pin" ? " (paid to owner)" : ""}`), ...(w.applied.length ? [`+ ${m0(w.applied.reduce((s, x) => s + x, 0))} from a payment with no month`] : [])].join(" · ") || "—";
        const n = Math.max(1, doc.splitTextToSize(pays, lc[3].w - 8).length);
        if (room(12 * n + 4)) { /* new page */ }
        lcell(0, w.label, { bold: !!w.open }); lcell(1, m0(w.charged)); lcell(2, m0(w.charged - w.due)); lcell(3, pays, { color: SUB }); lcell(4, w.due > 0.5 ? m0(w.due) : "paid", { bold: true, color: w.due > 0.5 ? RED : GREEN });
        y += 11 * n + 3;
      });
      if (t.af) { doc.setFont("helvetica", "italic"); doc.setFontSize(7.8); doc.setTextColor(...SUB); doc.text(`Starts from AppFolio's past due of ${m0(t.af.pastDue)} on ${dShort(t.af.asOf, true)}.`, M + 4, y); y += 10; }
      y += 12;
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...SUB);
    doc.text("Rent charged from each lease minus every payment received (bounced payments taken back out). A payment counts toward the month written on it; one with no month goes to the oldest month owed.", W / 2, H - 34, { align: "center" });
    doc.text(`${CO.name}  ·  ${CO.addr}${pages > 1 ? `  ·  Page ${i} of ${pages}` : ""}`, W / 2, H - 22, { align: "center" });
  }
  return new File([doc.output("blob")], `Delinquency report ${asOf}.pdf`, { type: "application/pdf" });
}
