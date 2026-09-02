// Build a real Scope-of-Work PDF (jsPDF) so contractors open a proper document
// instead of reading a wall of text. Returns a File ready for uploadAttachment.
// jsPDF is loaded on demand (~350 KB) so it never weighs down app launch.
//
// Two shapes of job:
//  • job.sowItems  — the structured scope from the builder (categories, one
//    line per item, Included / As needed / To discuss), with a version number,
//    highlighted changes since the last version, and a "latest version" link.
//  • job.scope     — the older free-text scope (UPPERCASE headings + lines).
import { SOW_CATS, SOW_MAT, SPEC_CATS } from "./sowLibrary";

const GOLD = [184, 145, 46];
const fmtDay = (d) => new Date(d || Date.now()).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export async function sowPdfFile(job) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 x 792
  const W = 612, H = 792, margin = 56, maxW = W - margin * 2;
  let y = margin;
  const specN = Array.isArray(job.specItems) ? job.specItems.length : 0;
  const structured = Array.isArray(job.sowItems) && (job.sowItems.length > 0 || specN > 0);
  const hasScope = structured && job.sowItems.length > 0;

  doc.setFont("times", "bold"); doc.setFontSize(19); doc.setTextColor(...GOLD);
  doc.text("Goldstone Properties", margin, y); y += 20;
  doc.setFontSize(13); doc.setTextColor(60, 60, 60);
  doc.text(structured && !hasScope ? "Finish Spec Sheet" : "Scope of Work", margin, y);
  if (structured && job.sowVersion) {
    doc.setFont("times", "normal"); doc.setFontSize(10.5); doc.setTextColor(120, 120, 120);
    doc.text(`Version ${job.sowVersion}`, W - margin, y, { align: "right" });
  }
  y += 18;
  doc.setFont("times", "normal"); doc.setFontSize(11); doc.setTextColor(90, 90, 90);
  doc.text(`${job.propertyAddress || ""}${job.title ? ` — ${job.title}` : ""}`, margin, y); y += 14;
  doc.text(`Prepared ${fmtDay(job.scopeEditedAt || Date.now())}${job.scopeEditedBy ? ` by ${job.scopeEditedBy}` : ""}`, margin, y); y += 14;

  if (structured) {
    const changed = new Set(job.sowChanged || []);
    const prev = job.sowPrev || {};
    const removed = Array.isArray(job.sowRemoved) ? job.sowRemoved : [];
    if ((changed.size || removed.length) && job.sowVersion > 1) {
      doc.setFont("times", "bold"); doc.setTextColor(180, 83, 9);
      doc.text(`UPDATED — highlighted lines are new or changed since version ${job.sowVersion - 1}; struck-through lines came out.`, margin, y, { maxWidth: maxW }); y += 14;
    }
    if (job.sowLatestUrl) {
      doc.setFont("times", "normal"); doc.setTextColor(10, 102, 194);
      doc.textWithLink("Always open the latest version of this scope", margin, y, { url: job.sowLatestUrl });
      const w = doc.getTextWidth("Always open the latest version of this scope");
      doc.setDrawColor(10, 102, 194); doc.setLineWidth(0.5); doc.line(margin, y + 1.5, margin + w, y + 1.5);
      y += 14;
    }
    doc.setDrawColor(...GOLD); doc.setLineWidth(1.4);
    doc.line(margin, y, W - margin, y); y += 14;
    // Legend
    doc.setFont("times", "italic"); doc.setFontSize(9.5); doc.setTextColor(120, 120, 120);
    const matDef = SOW_MAT[job.sowMatDefault] ? job.sowMatDefault : "contractor";
    const hasGs = job.sowItems.some((it) => it.cat === "gsmat");
    const legend = `MATERIALS: ${SOW_MAT[matDef].legend}${hasGs ? " — except the items listed under MATERIALS PROVIDED BY GOLDSTONE below" : ""} — unless a line is tagged otherwise. Lines tagged AS NEEDED are confirmed on site; lines tagged TO DISCUSS need a call with Goldstone before pricing. No prices in this document — the bid is yours.`;
    if (hasScope) {
      const legendLines = doc.splitTextToSize(legend, maxW);
      doc.text(legendLines, margin, y);
      y += 12 * legendLines.length + 12;
    } else { y -= 6; }

    const lineH = 15;
    const tagsFor = (it) => {
      const t = [];
      if (it.status === "asneeded") t.push({ label: "AS NEEDED", fill: [232, 244, 255], color: [10, 102, 194] });
      if (it.status === "discuss") t.push({ label: "TO DISCUSS", fill: [253, 233, 200], color: [180, 83, 9] });
      const m = it.mat || matDef;
      if (m !== matDef && it.cat !== "gsmat") t.push({ label: (SOW_MAT[m] || SOW_MAT.contractor).tag, fill: [248, 241, 224], color: [138, 109, 31] });
      return t;
    };
    const ensure = (need) => { if (y + need > H - margin - 10) { doc.addPage(); y = margin; } };
    // Gray struck-through line — "was: …" under a reworded line, or a line
    // that came out since the last version.
    const struck = (label, text, x, width) => {
      doc.setFont("times", "italic"); doc.setFontSize(9.5); doc.setTextColor(140, 140, 140);
      const lines = doc.splitTextToSize(`${label}${text}`, width);
      ensure(13 * lines.length);
      lines.forEach((ln) => {
        doc.text(ln, x, y);
        const w = doc.getTextWidth(ln);
        doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.6); doc.line(x, y - 3, x + w, y - 3);
        y += 13;
      });
      doc.setFont("times", "normal"); doc.setFontSize(10.5); doc.setTextColor(25, 25, 25);
    };
    SOW_CATS.forEach((c) => {
      const rows = job.sowItems.filter((it) => it.cat === c.key);
      const gone = removed.filter((r) => r.cat === c.key);
      if (!rows.length && !gone.length) return;
      ensure(lineH * 3);
      y += 8;
      doc.setFont("times", "bold"); doc.setFontSize(11.5); doc.setTextColor(25, 25, 25);
      doc.text(c.long, margin, y); y += lineH + 1;
      if (c.note) {
        doc.setFont("times", "italic"); doc.setFontSize(9.5); doc.setTextColor(120, 120, 120);
        const nl = doc.splitTextToSize(c.note, maxW);
        doc.text(nl, margin, y - 3); y += 12 * nl.length + 2;
        doc.setTextColor(25, 25, 25);
      }
      doc.setFont("times", "normal"); doc.setFontSize(10.5);
      rows.forEach((it, i) => {
        const tags = tagsFor(it);
        doc.setFont("times", "bold"); doc.setFontSize(7.5);
        tags.forEach((t) => { t.w = doc.getTextWidth(t.label) + 12; });
        doc.setFontSize(10.5);
        const tagW = tags.reduce((s, t) => s + t.w + 4, 0);
        const numW = 20;
        const textW = maxW - numW - (tags.length ? tagW + 6 : 0);
        doc.setFont("times", "normal");
        const lines = doc.splitTextToSize(String(it.text || ""), textW);
        const noteLines = it.note ? doc.splitTextToSize(`Note: ${it.note}`, textW) : [];
        ensure(lineH * (lines.length + noteLines.length));
        const hl = changed.has(it.id);
        if (hl) { doc.setFillColor(255, 249, 196); doc.rect(margin - 4, y - 10.5, maxW + 8, lineH * (lines.length + noteLines.length) - 0.5, "F"); }
        doc.setTextColor(25, 25, 25); doc.setFont("times", "normal");
        doc.text(`${i + 1}.`, margin, y);
        lines.forEach((ln, li) => { doc.text(ln, margin + numW, y + li * lineH); });
        if (tags.length) {
          let tx = W - margin;
          const ty = y - 8.5;
          tags.slice().reverse().forEach((t) => {
            tx -= t.w;
            doc.setFillColor(...t.fill); doc.roundedRect(tx, ty, t.w, 11.5, 4, 4, "F");
            doc.setFont("times", "bold"); doc.setFontSize(7.5); doc.setTextColor(...t.color);
            doc.text(t.label, tx + t.w / 2, ty + 8.3, { align: "center" });
            tx -= 4;
          });
          doc.setFontSize(10.5);
        }
        y += lineH * lines.length;
        if (noteLines.length) {
          doc.setFont("times", "italic"); doc.setTextColor(110, 110, 110);
          noteLines.forEach((ln) => { doc.text(ln, margin + numW, y); y += lineH; });
        }
        if (hl && prev[it.id]) struck("was: ", prev[it.id], margin + numW, textW);
      });
      gone.forEach((r) => struck("removed: ", r.text, margin + 20, maxW - 20));
    });

    // ── 🎨 Finish Spec Sheet — same document, its own part ──
    const spec = Array.isArray(job.specItems) ? job.specItems : [];
    if (spec.length) {
      const photos = job.specPhotos || {};
      if (hasScope) {
        if (y > H - 260) { doc.addPage(); y = margin; } else { y += 18; }
        doc.setFont("times", "bold"); doc.setFontSize(13); doc.setTextColor(60, 60, 60);
        doc.text("Finish Spec Sheet", margin, y); y += 8;
        doc.setDrawColor(...GOLD); doc.setLineWidth(1.4); doc.line(margin, y, W - margin, y); y += 14;
      }
      doc.setFont("times", "italic"); doc.setFontSize(9.5); doc.setTextColor(120, 120, 120);
      const sl = doc.splitTextToSize("Install exactly these products unless a substitution is approved in writing. Each item says who buys it. Items marked CONTRACTOR TO CHOOSE: send your pick (photo or link) to Goldstone for approval before buying. Tap a product name to open its page.", maxW);
      doc.text(sl, margin, y); y += 12 * sl.length + 8;
      const thumb = 54, gap = 10;
      // Grouped by ROOM when any finish names one (master bath reads as one
      // block: floor tile, wall tile, vanity…); otherwise by category.
      const byRoom = spec.some((it) => it.room && String(it.room).trim());
      const roomOf = (it) => (it.room && String(it.room).trim()) || "Whole house";
      const groups = byRoom
        ? [...new Set(spec.map(roomOf))].map((r) => ({ label: r.toUpperCase(), rows: spec.filter((it) => roomOf(it) === r).slice().sort((a, b) => SPEC_CATS.findIndex((c) => c.key === a.cat) - SPEC_CATS.findIndex((c) => c.key === b.cat)) }))
        : SPEC_CATS.map((c) => ({ label: c.label.toUpperCase(), rows: spec.filter((it) => it.cat === c.key) })).filter((g) => g.rows.length);
      groups.forEach((g) => {
        const rows = g.rows;
        if (!rows.length) return;
        ensure(thumb + 30);
        y += 6;
        doc.setFont("times", "bold"); doc.setFontSize(11.5); doc.setTextColor(25, 25, 25);
        doc.text(g.label, margin, y); y += 14;
        rows.forEach((it) => {
          const catLbl = byRoom ? (SPEC_CATS.find((c) => c.key === it.cat) || {}).label || "" : "";
          const ph = photos[it.id];
          const tx = margin + (ph ? thumb + gap : 0);
          const tw = maxW - (ph ? thumb + gap : 0);
          doc.setFont("times", "bold"); doc.setFontSize(10.5);
          const titleLines = doc.splitTextToSize(`${catLbl ? `${catLbl}: ` : ""}${it.title || ""}${it.price ? `  ·  ${it.price}` : ""}`, tw);
          doc.setFont("times", "normal"); doc.setFontSize(9.5);
          const descLines = it.desc ? doc.splitTextToSize(it.desc, tw) : [];
          const textH = 13 * titleLines.length + 12 * descLines.length + 14;
          const rowH = Math.max(ph ? thumb : 0, textH) + 8;
          ensure(rowH);
          const top = y;
          if (ph) {
            try {
              const r = Math.min(thumb / ph.w, thumb / ph.h); const dw = ph.w * r, dh = ph.h * r;
              doc.addImage(ph.data, "JPEG", margin + (thumb - dw) / 2, top - 8 + (thumb - dh) / 2, dw, dh);
            } catch { /* skip the picture */ }
          }
          let ty = top + 2;
          doc.setFont("times", "bold"); doc.setFontSize(10.5);
          if (it.link) { doc.setTextColor(10, 102, 194); titleLines.forEach((ln, i) => { if (i === 0) doc.textWithLink(ln, tx, ty, { url: it.link }); else doc.text(ln, tx, ty); ty += 13; }); }
          else { doc.setTextColor(25, 25, 25); titleLines.forEach((ln) => { doc.text(ln, tx, ty); ty += 13; }); }
          doc.setFont("times", "normal"); doc.setFontSize(9.5); doc.setTextColor(90, 90, 90);
          descLines.forEach((ln) => { doc.text(ln, tx, ty); ty += 12; });
          // tag
          const t = it.choose ? { label: "CONTRACTOR TO CHOOSE — SEND TO GOLDSTONE FOR APPROVAL", fill: [253, 233, 200], color: [180, 83, 9] } : it.buyer === "contractor" ? { label: "CONTRACTOR BUYS", fill: [232, 244, 255], color: [10, 102, 194] } : { label: "GOLDSTONE BUYS", fill: [248, 241, 224], color: [138, 109, 31] };
          doc.setFont("times", "bold"); doc.setFontSize(7.5);
          const tW = doc.getTextWidth(t.label) + 12;
          doc.setFillColor(...t.fill); doc.roundedRect(tx, ty - 6, tW, 11.5, 4, 4, "F");
          doc.setTextColor(...t.color); doc.text(t.label, tx + tW / 2, ty + 2.3, { align: "center" });
          doc.setFontSize(10.5); doc.setTextColor(25, 25, 25);
          y = top + rowH;
        });
      });
    }
  } else {
    // Edited since it was first sent → say so, and highlight what changed below.
    const changed = new Set(job.scopeChangedLines || []);
    if (job.scopeEditedAt && changed.size) {
      doc.setFont("times", "bold"); doc.setTextColor(180, 83, 9);
      doc.text(`UPDATED ${fmtDay(job.scopeEditedAt)}${job.scopeEditedBy ? ` by ${job.scopeEditedBy}` : ""} — highlighted lines are new or changed.`, margin, y);
      y += 14;
    } else { y -= 4; }
    doc.setDrawColor(...GOLD); doc.setLineWidth(1.4);
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
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("times", "normal"); doc.setFontSize(8.5); doc.setTextColor(150, 150, 150);
    doc.text(`Goldstone Properties · gpflips.com${structured && job.sowVersion ? ` · Scope v${job.sowVersion}` : ""} · page ${i} of ${pages}`, margin, H - 28);
  }

  const safe = String(job.propertyAddress || "job").replace(/[^a-zA-Z0-9 ,.-]/g, "").slice(0, 60);
  const vtag = structured && job.sowVersion ? ` v${job.sowVersion}` : "";
  return new File([doc.output("blob")], `Scope of Work${vtag} - ${safe}.pdf`, { type: "application/pdf" });
}

// One tap → the SOW opens as a real PDF in the browser's viewer (generated
// on-device, nothing uploaded). Works on both the portal and admin sides.
// The window must open INSIDE the tap (popup blockers), then we steer it to
// the PDF once the on-demand jsPDF chunk has built it.
export async function openSowPdf(job) {
  const win = window.open("", "_blank");
  try {
    const file = await sowPdfFile(job);
    const url = URL.createObjectURL(file);
    if (win) win.location = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}
