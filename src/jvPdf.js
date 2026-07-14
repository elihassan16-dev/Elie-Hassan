// Build the Joint Venture Agreement as a real PDF file (jsPDF) so it can be
// attached to an email straight from the app — same text as the print version.
// Moshe's script signature is drawn on a canvas (so the script font renders)
// and dropped onto the By: line as an image, descenders crossing the line.
// jsPDF loads on demand (~350 KB) so it never weighs down app launch.

function signaturePng() {
  try {
    const scale = 3, w = 260, h = 64, BASE = 40; // BASE = the name's baseline inside the canvas
    const c = document.createElement("canvas");
    c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    const stack = "'Snell Roundhand','Edwardian Script ITC','Monotype Corsiva','Lucida Calligraphy','Segoe Script','Brush Script MT',cursive";
    let size = 30;
    ctx.font = `${size}px ${stack}`;
    while (ctx.measureText("Moshe Hamaoui").width > w - 24 && size > 16) { size -= 1; ctx.font = `${size}px ${stack}`; }
    ctx.fillStyle = "#1a2b57";
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.save();
    ctx.translate(w / 2, BASE);
    ctx.rotate(-3.5 * Math.PI / 180);
    ctx.fillText("Moshe Hamaoui", 0, 0);
    ctx.restore();
    // The flourish stroke swept under the name.
    ctx.strokeStyle = "rgba(26,43,87,0.85)"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(14, 50);
    ctx.bezierCurveTo(66, 54, 170, 42, 246, 48);
    ctx.stroke();
    const k = 0.6; // page size: 156 x 38.4 pt
    return { data: c.toDataURL("image/png"), w: w * k, h: h * k, baseline: BASE * k };
  } catch { return null; }
}

// All money/percent values arrive pre-formatted strings; propLegal is the full
// address incl. block/lot; short is the investor's short name used in the text.
export async function jvPdfFile({ address, propLegal, invName, invAddress, short, today, amount, ownPct, retPct, days, buyout }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 x 792
  const W = 612, H = 792, margin = 72, maxW = W - margin * 2;
  const lineH = 17;
  let y = margin;
  const nm = invName || "____________________________";
  const ad = invAddress || "____________________________";
  const sh = short || "Investor";

  const ensure = (need) => { if (y + need > H - margin) { doc.addPage(); y = margin; } };
  // A paragraph of {t, b} runs — word wrap with mixed bold/normal, page-safe.
  const para = (runs, gap = 8) => {
    ensure(lineH);
    doc.setFontSize(11.5);
    let cx = margin;
    for (const r of runs) {
      for (const tok of String(r.t).split(/(\s+)/)) {
        if (!tok) continue;
        doc.setFont("times", r.b ? "bold" : "normal");
        const tw = doc.getTextWidth(tok);
        if (/^\s+$/.test(tok)) { if (cx > margin) { doc.text(" ", cx, y); cx += doc.getTextWidth(" "); } continue; } // real space glyph so copied text keeps its spaces
        if (cx > margin && cx + tw > margin + maxW) { cx = margin; y += lineH; ensure(0); }
        doc.text(tok, cx, y);
        cx += tw;
      }
    }
    y += lineH + gap - 8;
  };
  const heading = (txt) => {
    ensure(lineH * 2.5);
    y += 7;
    doc.setFont("times", "bold"); doc.setFontSize(12);
    doc.text(txt, margin, y);
    y += lineH;
  };

  doc.setFont("times", "bold"); doc.setFontSize(14);
  doc.text("JOINT VENTURE AGREEMENT", W / 2, y, { align: "center" });
  y += 30;

  para([
    { t: `This Joint Venture Agreement (the "Agreement") is entered into as of ${today}, by and between: ` },
    { t: "Goldstone Properties LLC", b: 1 },
    { t: `, having an address at 17 Natures Way, Lakewood, New Jersey 08701 (“Goldstone”) and ` },
    { t: nm, b: 1 },
    { t: `, having an address at ${ad} (“${sh}”) (collectively referred to as the "Parties").` },
  ]);
  heading("1. BACKGROUND");
  para([{ t: `The Parties desire to enter into a joint venture for the purpose of purchase and construction of real estate property (the "Venture").` }]);
  heading("2. CONTRIBUTIONS");
  para([{ t: "2.1 Cash Contribution: ", b: 1 }, { t: `${sh} agrees to contribute ${amount} in cash towards the purchase and construction of ${propLegal} (the “Property”).` }]);
  para([{ t: "2.2 Ownership Interest: ", b: 1 }, { t: `In consideration of the cash contribution, ${sh} shall be entitled to a ${ownPct} percent ownership interest in the Venture.` }]);
  heading("3. BUYOUT OPTION");
  para([{ t: "3.1 Buyout Price: ", b: 1 }, { t: `Goldstone shall have the option to buy out ${sh}'s ${ownPct} percent ownership interest in the Venture within ${days} days of the effective date of this Agreement (the “Buyout Period”) for the total amount of ${buyout} which shall be prorated based on the date of the buyout.` }]);
  heading("4. MANAGEMENT");
  para([{ t: "4.1 Decision-Making: ", b: 1 }, { t: "The Parties agree that Goldstone shall have sole authority to make major decisions regarding the Venture." }]);
  para([{ t: "4.2 Management Responsibilities: ", b: 1 }, { t: "Goldstone shall have full management responsibility for the Venture, including but not limited to decision-making and day-to-day operations." }]);
  heading("5. PROFITS AND LOSSES");
  para([{ t: "The profits and losses of the Venture shall be allocated between the Parties in proportion to their respective ownership interests." }]);
  heading("6. TERM AND TERMINATION");
  para([{ t: "This Agreement shall commence on the effective date and shall continue until sale of Property." }]);
  heading("7. MISCELLANEOUS");
  para([{ t: "7.1 Governing Law: ", b: 1 }, { t: "This Agreement shall be governed by and construed in accordance with the laws of New Jersey." }]);
  para([{ t: "7.2 Amendments: ", b: 1 }, { t: "No amendment or modification of this Agreement shall be valid unless in writing and signed by both Parties." }]);
  para([{ t: "7.3 Signatures: ", b: 1 }, { t: "This Agreement may be executed in counterparts, each of which shall be deemed an original, but all of which together shall constitute one and the same instrument. The Agreement when signed by a party and delivered to the other party by fax or other electronic means, shall be deemed a document containing the original signature of the transmitting party and shall be fully enforceable against the transmitting party. If reasonably requested, each party shall provide the other with a copy of the Contract bearing the original signature of the party whom such request has been made." }]);
  y += 6;
  para([{ t: "Subject Property: ", b: 1 }, { t: propLegal }]);
  para([{ t: "IN WITNESS WHEREOF, the Parties hereto have executed this Joint Venture Agreement as of the date first above written." }]);

  // Goldstone signature block — script ink centered on the By: line.
  ensure(150);
  y += 22;
  doc.setFont("times", "bold"); doc.setFontSize(11.5);
  doc.text("GOLDSTONE PROPERTIES LLC", margin, y);
  y += 36; // air above the line for the ink
  doc.setFont("times", "normal");
  doc.text("By:", margin, y);
  const lineX = margin + 26, lineW = 200;
  doc.setDrawColor(0); doc.setLineWidth(0.8);
  doc.line(lineX, y + 2, lineX + lineW, y + 2);
  const sig = signaturePng();
  if (sig) doc.addImage(sig.data, "PNG", lineX + (lineW - sig.w) / 2, y + 2 - sig.baseline, sig.w, sig.h);
  y += lineH + 2;
  doc.text("Name: Moshe Hamaoui", margin, y); y += lineH;
  doc.text("Title: President", margin, y); y += lineH;
  doc.text(`Date: ${today}`, margin, y); y += lineH;

  // Investor block.
  ensure(90);
  y += 30;
  doc.line(margin, y + 2, margin + lineW, y + 2);
  y += lineH;
  doc.setFont("times", "bold");
  doc.text(String(nm).toUpperCase(), margin, y); y += lineH;
  doc.setFont("times", "normal");
  doc.text(`Date: ${today}`, margin, y);

  const safe = String(address || "property").replace(/[^a-zA-Z0-9 ,.-]/g, "").slice(0, 60);
  return new File([doc.output("blob")], `JV Agreement - ${safe}.pdf`, { type: "application/pdf" });
}
