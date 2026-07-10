// Build a real Scope-of-Work PDF (jsPDF) so contractors open a proper document
// instead of reading a wall of text. Returns a File ready for uploadAttachment.
import { jsPDF } from "jspdf";

export function sowPdfFile(job) {
  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 x 792
  const W = 612, H = 792, margin = 56, maxW = W - margin * 2;
  let y = margin;

  doc.setFont("times", "bold"); doc.setFontSize(19); doc.setTextColor(184, 145, 46);
  doc.text("Goldstone Properties", margin, y); y += 20;
  doc.setFontSize(13); doc.setTextColor(60, 60, 60);
  doc.text("Scope of Work", margin, y); y += 18;
  doc.setFont("times", "normal"); doc.setFontSize(11); doc.setTextColor(90, 90, 90);
  doc.text(`${job.propertyAddress || ""}${job.title ? ` — ${job.title}` : ""}`, margin, y); y += 14;
  doc.text(`Prepared ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`, margin, y); y += 14;
  // Edited since it was first sent → say so, and highlight what changed below.
  const changed = new Set(job.scopeChangedLines || []);
  if (job.scopeEditedAt && changed.size) {
    doc.setFont("times", "bold"); doc.setTextColor(180, 83, 9);
    doc.text(`UPDATED ${new Date(job.scopeEditedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}${job.scopeEditedBy ? ` by ${job.scopeEditedBy}` : ""} — highlighted lines are new or changed.`, margin, y);
    y += 14;
  } else { y -= 4; }
  doc.setDrawColor(184, 145, 46); doc.setLineWidth(1.4);
  doc.line(margin, y, W - margin, y); y += 22;

  doc.setTextColor(25, 25, 25); doc.setFontSize(10.5);
  const lineH = 15;
  String(job.scope || "").split("\n").forEach((para, pi) => {
    const lines = para.trim() === "" ? [""] : doc.splitTextToSize(para, maxW);
    // UPPERCASE section headings get bold + a little air above.
    const isHeading = /^[A-Z0-9 &/,'()-]{3,}$/.test(para.trim()) && para.trim() === para.trim().toUpperCase() && /[A-Z]/.test(para);
    if (isHeading && y > margin + 30) y += 6;
    doc.setFont("times", isHeading ? "bold" : "normal");
    const hl = changed.has(pi) && para.trim() !== "";
    lines.forEach((ln) => {
      if (y > H - margin) { doc.addPage(); y = margin; }
      if (hl) { doc.setFillColor(253, 233, 200); doc.rect(margin - 4, y - 10.5, maxW + 8, lineH - 0.5, "F"); }
      doc.setTextColor(25, 25, 25);
      doc.text(ln, margin, y); y += lineH;
    });
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("times", "normal"); doc.setFontSize(8.5); doc.setTextColor(150, 150, 150);
    doc.text(`Goldstone Properties · gpflips.com · page ${i} of ${pages}`, margin, H - 28);
  }

  const safe = String(job.propertyAddress || "job").replace(/[^a-zA-Z0-9 ,.-]/g, "").slice(0, 60);
  return new File([doc.output("blob")], `Scope of Work - ${safe}.pdf`, { type: "application/pdf" });
}

// One tap → the SOW opens as a real PDF in the browser's viewer (generated
// on-device, nothing uploaded). Works on both the portal and admin sides.
export function openSowPdf(job) {
  const file = sowPdfFile(job);
  const url = URL.createObjectURL(file);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
