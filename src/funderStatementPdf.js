// 📄 Lender statement as a real PDF file (Elie 10/19/26) so it can be emailed
// straight from the lender page — same numbers and layout as the ⭳ PDF print
// report: six totals, outstanding loans with standing interest, paid-back loans.
// The caller passes everything pre-computed (funderStats / drawInterest live in
// GoldstoneApp). jsPDF loads on demand so it never weighs down app launch.

const GOLD = [184, 149, 63], INK = [28, 28, 30], SUB = [138, 138, 142], LINE = [236, 236, 236];
const hex = (h) => { const m = String(h || "").replace("#", ""); return m.length === 6 ? [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)) : INK; };

// d = { name, today, stats:[[label, text, color]], open:[[prop, funded, terms, amount, interest]],
//       openTotal:[amount, interest], paid:[[prop, funded, paidBack, amount, interest]],
//       paidTotal:[amount, interest], foot }
export async function funderStatementPdfFile(d) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 x 792
  const W = 612, H = 792, M = 44, CW = W - M * 2;
  let y = M + 6;

  doc.setFont("times", "bold"); doc.setFontSize(20); doc.setTextColor(...GOLD);
  doc.text("Goldstone Properties", M, y);
  y += 22;
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...INK);
  doc.text(`Lender Statement — ${d.name}`, M, y);
  y += 15;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...SUB);
  doc.text(`As of ${d.today}`, M, y);
  y += 10;
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.6); doc.line(M, y, W - M, y);
  y += 18;

  // Totals — 3 per row.
  const bw = (CW - 16) / 3, bh = 42;
  d.stats.forEach(([label, text, color], i) => {
    const bx = M + (i % 3) * (bw + 8), by = y + Math.floor(i / 3) * (bh + 8);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.roundedRect(bx, by, bw, bh, 6, 6);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...SUB);
    doc.text(String(label).toUpperCase(), bx + 10, by + 15);
    doc.setFontSize(13.5); doc.setTextColor(...hex(color));
    doc.text(String(text), bx + 10, by + 33);
  });
  y += Math.ceil(d.stats.length / 3) * (bh + 8) + 14;

  const cols = [0, 0.37, 0.52]; // left edges: property | col2 | col3
  const R = (i) => M + CW * (i === 3 ? 0.83 : 1) - 4; // right edges: amount | interest
  const table = (title, head, rows, total, empty) => {
    if (y > H - 120) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(85, 85, 85);
    doc.text(title.toUpperCase(), M, y); y += 14;
    doc.setFontSize(7.5); doc.setTextColor(...SUB);
    head.forEach((h, i) => { const r = i >= 3; doc.text(h.toUpperCase(), r ? R(i) : M + CW * cols[i] + 4, y, r ? { align: "right" } : undefined); });
    y += 5; doc.setDrawColor(221, 221, 221); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 13;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    if (!rows.length) { doc.setTextColor(170, 170, 170); doc.text(empty, M + CW / 2, y, { align: "center" }); y += 16; }
    rows.forEach((row) => {
      if (y > H - M - 20) { doc.addPage(); y = M; }
      const prop = doc.splitTextToSize(String(row[0] || "—"), CW * cols[1] - 10);
      row.forEach((c, i) => {
        const r = i >= 3;
        doc.setTextColor(...(i === 4 ? GOLD : INK));
        doc.setFont("helvetica", i === 4 ? "bold" : "normal");
        if (i === 0) doc.text(prop, M + 4, y);
        else doc.text(String(c || ""), r ? R(i) : M + CW * cols[i] + 4, y, r ? { align: "right" } : undefined);
      });
      y += 11 * prop.length + 5;
      doc.setDrawColor(242, 242, 242); doc.setLineWidth(0.6); doc.line(M, y - 9, W - M, y - 9);
    });
    doc.setDrawColor(...GOLD); doc.setLineWidth(1.4); doc.line(M, y - 6, W - M, y - 6); y += 7;
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text("Total", M + 4, y);
    doc.text(String(total[0]), R(3), y, { align: "right" });
    doc.setTextColor(...GOLD); doc.text(String(total[1]), R(4), y, { align: "right" });
    y += 26;
  };
  table("Outstanding properties — standing interest", ["Property", "Funded", "Days", "Amount", "Interest"], d.open, d.openTotal, "None outstanding.");
  table("Sold / paid-back properties — interest paid", ["Property", "Funded", "Paid back", "Amount", "Interest"], d.paid, d.paidTotal, "None yet.");

  if (y > H - M - 30) { doc.addPage(); y = M; }
  doc.setDrawColor(238, 238, 238); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 13;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(170, 170, 170);
  doc.text(doc.splitTextToSize(d.foot, CW), M, y);

  const safe = String(d.name || "Lender").replace(/[^\w\- ]+/g, "").trim() || "Lender";
  return new File([doc.output("blob")], `${safe} - Goldstone Statement.pdf`, { type: "application/pdf" });
}
