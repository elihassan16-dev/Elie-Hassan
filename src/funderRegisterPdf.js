// 📒 Lender FULL REGISTER as a real PDF (Elie approved the preview 11/11/26):
// every transaction line by line — wires in, money placed in each property,
// partial paydowns, paybacks with the interest they earned, interest
// reinvested / paid out, withdrawals, adjustments — with a running balance,
// for a date range (balance carried forward), plus an optional page with the
// open loans and their interest so far. The caller (GoldstoneApp, which owns
// funderRegister / drawInterest) passes everything pre-computed.
//
// d = { name, range, made,
//       kpis: [[label, text, color]],                     (8 boxes, 4 per row)
//       rows: [{ date, type, tag:[bg,fg], note, inn, out, int, intColor, bal, bf }],
//       totals: { n, inn, out, int, bal },
//       foot, open?: { rows:[[prop, funded, terms, amount, interest]], total:[amount, interest], asOf } }
const GOLD = [184, 149, 63], INK = [28, 28, 30], SUB = [138, 138, 142], LINE = [236, 236, 236];
const GREEN = [21, 128, 61], RED = [192, 57, 43];
const hex = (h) => { const m = String(h || "").replace("#", ""); return m.length === 6 ? [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)) : INK; };

export async function funderRegisterPdfFile(d) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 x 792
  const W = 612, H = 792, M = 40, CW = W - M * 2;
  let y = M + 6;

  // ── Header ──
  doc.setFont("times", "bold"); doc.setFontSize(20); doc.setTextColor(...GOLD);
  doc.text("Goldstone Properties", M, y); y += 21;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...INK);
  doc.text(`Lender Register — ${d.name}`, M, y); y += 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SUB);
  doc.text(`${d.range} · made ${d.made}`, M, y); y += 9;
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.6); doc.line(M, y, W - M, y); y += 14;

  // ── Totals boxes (4 per row) ──
  const bw = (CW - 3 * 7) / 4, bh = 36;
  d.kpis.forEach(([label, text, color], i) => {
    const bx = M + (i % 4) * (bw + 7), by = y + Math.floor(i / 4) * (bh + 7);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.roundedRect(bx, by, bw, bh, 5, 5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); doc.setTextColor(...SUB);
    doc.text(String(label).toUpperCase(), bx + 8, by + 12.5);
    doc.setFontSize(11.5); doc.setTextColor(...(color ? hex(color) : INK));
    doc.text(String(text), bx + 8, by + 28);
  });
  y += Math.ceil(d.kpis.length / 4) * (bh + 7) + 10;

  // ── Register table ──
  // x positions: date | type | note | in (r) | out (r) | interest (r) | balance (r)
  // Four equal money columns wide enough for $1,000,000.00+ (Elie 11/11/26:
  // the totals row overlapped on BIL's register).
  const COLW = 74;
  const X = { date: M + 3, type: M + 66, note: M + 148 };
  const R = { bal: W - M - 3 }; R.int = R.bal - COLW; R.out = R.int - COLW; R.inn = R.out - COLW;
  const noteW = R.inn - COLW + 6 - X.note;
  // Right-aligned amount that never spills into the next column: shrinks to fit.
  const amt = (text, right, size) => {
    let fs = size; doc.setFontSize(fs);
    while (fs > 6 && doc.getTextWidth(String(text)) > COLW - 8) { fs -= 0.4; doc.setFontSize(fs); }
    doc.text(String(text), right, y, { align: "right" }); doc.setFontSize(size);
  };
  const head = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(...SUB);
    doc.text("DATE", X.date, y); doc.text("TYPE", X.type, y); doc.text("PROPERTY / NOTE", X.note, y);
    doc.text("MONEY IN", R.inn, y, { align: "right" }); doc.text("MONEY OUT", R.out, y, { align: "right" });
    doc.text("INTEREST", R.int, y, { align: "right" }); doc.text("BALANCE", R.bal, y, { align: "right" });
    y += 4; doc.setDrawColor(221, 221, 221); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 11;
  };
  head();
  const newPage = () => { doc.addPage(); y = M + 4; head(); };
  doc.setFontSize(8.6);
  if (!d.rows.length) {
    doc.setFont("helvetica", "normal"); doc.setTextColor(170, 170, 170);
    doc.text("No transactions in these dates.", M + CW / 2, y + 2, { align: "center" }); y += 16;
  }
  d.rows.forEach((r) => {
    const note = doc.splitTextToSize(String(r.note || ""), noteW);
    const h = Math.max(1, note.length) * 10 + 6;
    if (y + h > H - M - 24) newPage();
    if (r.bf) { doc.setFillColor(251, 247, 236); doc.rect(M, y - 9, CW, h, "F"); }
    doc.setFont("helvetica", r.bf ? "bold" : "normal"); doc.setFontSize(8.6); doc.setTextColor(...INK);
    doc.text(String(r.date || ""), X.date, y);
    if (r.bf) doc.text(String(r.note || ""), X.type, y);
    else {
      // colored type tag
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.8);
      const tw = doc.getTextWidth(r.type) + 9;
      doc.setFillColor(...hex(r.tag[0])); doc.roundedRect(X.type - 1, y - 7.5, tw, 10, 4, 4, "F");
      doc.setTextColor(...hex(r.tag[1])); doc.text(r.type, X.type + 3.5, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.6); doc.setTextColor(...INK);
      doc.text(note, X.note, y);
    }
    if (r.inn) { doc.setTextColor(...GREEN); amt(r.inn, R.inn, 8.6); }
    if (r.out) { doc.setTextColor(...RED); amt(r.out, R.out, 8.6); }
    if (r.int) { doc.setFont("helvetica", "bold"); doc.setTextColor(...hex(r.intColor || "#B8953F")); amt(r.int, R.int, 8.6); doc.setFont("helvetica", r.bf ? "bold" : "normal"); }
    doc.setTextColor(...INK); amt(r.bal || "", R.bal, 8.6);
    y += h - 6;
    doc.setDrawColor(242, 242, 242); doc.setLineWidth(0.6); doc.line(M, y - 4, W - M, y - 4);
    y += 7;
  });
  // totals
  if (y > H - M - 30) newPage();
  doc.setFillColor(250, 250, 250); doc.rect(M, y - 9, CW, 15, "F");
  doc.setDrawColor(51, 51, 51); doc.setLineWidth(1.2); doc.line(M, y - 9, W - M, y - 9);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.6); doc.setTextColor(...INK);
  doc.text(`Period totals · ${d.totals.n} transaction${d.totals.n === 1 ? "" : "s"}`, X.date, y);
  doc.setTextColor(...GREEN); amt(d.totals.inn, R.inn, 8.6);
  doc.setTextColor(...RED); amt(d.totals.out, R.out, 8.6);
  doc.setTextColor(...GOLD); amt(d.totals.int, R.int, 8.6);
  doc.setTextColor(...INK); amt(d.totals.bal, R.bal, 8.6);
  y += 20;

  // footnote
  if (y > H - M - 40) { doc.addPage(); y = M; }
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.6); doc.setTextColor(...SUB);
  const fl = doc.splitTextToSize(d.foot, CW); doc.text(fl, M, y); y += fl.length * 9.5 + 6;

  // ── Optional page: open loans + interest so far ──
  if (d.open) {
    doc.addPage(); y = M + 6;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(`Open loans — interest so far (${d.open.asOf})`, M, y); y += 8;
    doc.setDrawColor(...GOLD); doc.setLineWidth(1.2); doc.line(M, y, W - M, y); y += 16;
    const cols = [M + 4, M + CW * 0.45, M + CW * 0.6], RA = W - M - CW * 0.17, RI = W - M - 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...SUB);
    ["PROPERTY", "FUNDED", "DAYS"].forEach((h, i) => doc.text(h, cols[i], y));
    doc.text("AMOUNT", RA, y, { align: "right" }); doc.text("INTEREST", RI, y, { align: "right" });
    y += 4; doc.setDrawColor(221, 221, 221); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 12;
    doc.setFontSize(9);
    if (!d.open.rows.length) { doc.setFont("helvetica", "normal"); doc.setTextColor(170, 170, 170); doc.text("None outstanding.", M + CW / 2, y, { align: "center" }); y += 16; }
    d.open.rows.forEach((row) => {
      if (y > H - M - 20) { doc.addPage(); y = M; }
      const prop = doc.splitTextToSize(String(row[0] || "—"), CW * 0.43);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...INK);
      doc.text(prop, cols[0], y); doc.text(String(row[1] || ""), cols[1], y); doc.text(String(row[2] || ""), cols[2], y);
      doc.text(String(row[3] || ""), RA, y, { align: "right" });
      doc.setFont("helvetica", "bold"); doc.setTextColor(...GOLD); doc.text(String(row[4] || ""), RI, y, { align: "right" });
      y += prop.length * 11 + 5;
      doc.setDrawColor(242, 242, 242); doc.setLineWidth(0.6); doc.line(M, y - 9, W - M, y - 9);
    });
    doc.setDrawColor(...GOLD); doc.setLineWidth(1.4); doc.line(M, y - 6, W - M, y - 6); y += 7;
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.text("Total", cols[0], y);
    doc.text(String(d.open.total[0]), RA, y, { align: "right" });
    doc.setTextColor(...GOLD); doc.text(String(d.open.total[1]), RI, y, { align: "right" });
  }

  // page numbers
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(170, 170, 170); doc.text(`${d.name} · Lender Register · page ${i} of ${n} · private & confidential`, W / 2, H - 22, { align: "center" }); }

  const safe = String(d.name || "Lender").replace(/[^\w\- ]+/g, "").trim() || "Lender";
  return new File([doc.output("blob")], `${safe} - Goldstone Register.pdf`, { type: "application/pdf" });
}
