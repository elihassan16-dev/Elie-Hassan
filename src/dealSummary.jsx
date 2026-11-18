// 📄 Deal summary (Elie 11/17/26: "a very brief synopsis of all my numbers and
// how we got to the profit — so I can show people a screenshot, not all of
// this"). One clean pop-up from a lead's or property's Financial Overview:
// all-in purchase, rehab, holding → total cost; sale price − commissions &
// selling − financing − total cost = profit; cash in + return. ⬇ PDF makes the
// same page as a file (computer download / phone share sheet). The numbers are
// passed in already computed by the Financial Overview, so they always match it.
//
// views = { projected: {purchase,buying,rehab,holding,sale,selling,financing,profit,cashIn,months},
//           actual?:   { …same } }
import { useState } from "react";
import { T } from "./theme";
import { saveMadeFile } from "./fileSave";

const money = (v) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(Number(v) || 0)).toLocaleString("en-US")}`;
const pct = (profit, cash) => (cash > 0 ? `${Math.round((profit / cash) * 1000) / 10}%` : "");

export function DealSummarySheet({ title, sub, views, initial = "projected", isMobile, onClose, extra = null }) {
  const [view, setView] = useState(views && views[initial] ? initial : "projected");
  const [busy, setBusy] = useState(false);
  const v = (views && views[view]) || {};
  const allIn = (v.purchase || 0) + (v.buying || 0);
  const cost = allIn + (v.rehab || 0) + (v.openBills || 0) + (v.holding || 0);
  const roc = pct(v.profit || 0, v.cashIn || 0);
  const label = view === "actual" ? "Actual" : "Projected";

  const row = (name, val, o = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: o.total ? "10px 0" : "8px 0", borderTop: o.first ? "none" : o.total ? `1px solid ${T.text}` : "1px solid rgba(0,0,0,0.07)", fontSize: 14, fontWeight: o.total ? 700 : 400, paddingLeft: o.indent ? 14 : 0, color: o.indent ? T.textSub : T.text }}>
      <span>{name}{o.note && <span style={{ display: "block", fontSize: 11.5, color: T.textTert, fontWeight: 400 }}>{o.note}</span>}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: o.minus && val ? T.red : undefined }}>{o.minus && val ? "−" : ""}{money(Math.abs(val || 0))}</span>
    </div>
  );
  const hd = (t) => <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.06em", margin: "14px 0 2px" }}>{t}</div>;

  const pdf = async () => {
    setBusy(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const W = 612, M = 64, R = W - M;
      const GOLD = [184, 149, 63], INK = [28, 28, 30], SUB = [130, 130, 136], RED = [192, 57, 43], GREEN = [30, 123, 60];
      let y = 70;
      doc.setFont("times", "bold"); doc.setFontSize(20); doc.setTextColor(...GOLD); doc.text("Goldstone Properties", M, y); y += 24;
      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(`Deal summary - ${title}`, M, y); y += 15;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...SUB);
      doc.text(`${label} numbers${v.months ? ` · ${v.months}-month hold` : ""} · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, M, y); y += 10;
      doc.setDrawColor(...GOLD); doc.setLineWidth(1.5); doc.line(M, y, R, y); y += 26;
      const amt = (n) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
      const line = (name, val, o = {}) => {
        if (o.total) { doc.setDrawColor(...INK); doc.setLineWidth(0.9); doc.line(M, y - 13, R, y - 13); }
        doc.setFont("helvetica", o.total ? "bold" : "normal"); doc.setFontSize(11.5);
        doc.setTextColor(...(o.indent ? SUB : INK)); doc.text(name, M + (o.indent ? 14 : 0), y);
        doc.setTextColor(...(o.minus && val ? RED : INK)); doc.text(o.minus && val ? `-${amt(Math.abs(val)).replace("-", "")}` : amt(val || 0), R, y, { align: "right" });
        if (!o.total) { doc.setDrawColor(236, 236, 236); doc.setLineWidth(0.6); doc.line(M, y + 7, R, y + 7); }
        y += 22;
      };
      const head = (t) => { doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...SUB); doc.text(t.toUpperCase(), M, y); y += 18; };
      head("Cost");
      line("Purchase price", v.purchase, { indent: true });
      line("Closing costs", v.buying, { indent: true });
      line("All-in purchase", allIn);
      line("Rehab", v.rehab);
      if (v.openBills) line("Open bills (still owed)", v.openBills);
      line("Holding costs", v.holding);
      line("Total cost", cost, { total: true });
      y += 10; head("Sale");
      line(view === "actual" ? "Sale price" : "Sale price (ARV)", v.sale);
      line("Commissions & selling costs", -(v.selling || 0), { minus: true });
      line(view === "actual" ? "Interest (hard money + line of credit)" : "Financing (interest + lender fees)", -(v.financing || 0), { minus: true });
      line("Less total cost", -cost, { minus: true });
      y += 6;
      doc.setFillColor(234, 247, 238); doc.roundedRect(M, y - 16, R - M, 34, 8, 8, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...((v.profit || 0) < 0 ? RED : GREEN));
      doc.text(`${label} profit`, M + 14, y + 6); doc.text(amt(v.profit || 0), R - 14, y + 6, { align: "right" }); y += 44;
      if (v.cashIn > 0) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...SUB);
        doc.text(`Cash in: ${amt(v.cashIn)}${roc ? `  ·  Return on cash in: ${roc}` : ""}`, M, y); y += 16;
      }
      doc.setFontSize(8); doc.setTextColor(170, 170, 170);
      doc.text("Goldstone Properties · private & confidential · figures are estimates unless marked actual", W / 2, 760, { align: "center" });
      const safe = String(title || "Deal").replace(/[^\w\- ,]+/g, "").trim() || "Deal";
      await saveMadeFile(new File([doc.output("blob")], `${safe} - Deal summary.pdf`, { type: "application/pdf" }));
    } catch (e) { window.alert(e.message || "Couldn't make the PDF."); }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 320, padding: isMobile ? 0 : 16, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: isMobile ? "20px 20px 0 0" : 20, width: 460, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 18px 50px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px 10px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.gold, letterSpacing: "0.06em", textTransform: "uppercase" }}>Deal summary</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginTop: 2 }}>{title}</div>
            {sub && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2 }}>{sub}{v.months ? ` · ${v.months}-month hold` : ""}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 15, border: "none", background: "rgba(118,118,128,0.12)", color: T.textSub, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>
        {views && views.actual && (
          <div style={{ padding: "0 20px 4px" }}>
            <div style={{ display: "inline-flex", borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)", padding: 3, gap: 2 }}>
              {[["projected", "Projected"], ["actual", "Actual"]].map(([k, l]) => (
                <button key={k} onClick={() => setView(k)} style={{ padding: "6px 16px", borderRadius: 14, border: "none", background: view === k ? "#fff" : "transparent", boxShadow: view === k ? "0 1px 4px rgba(0,0,0,0.14)" : "none", color: view === k ? T.text : T.textSub, fontWeight: view === k ? 650 : 450, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ padding: "0 20px 6px", overflowY: "auto" }}>
          {hd("Cost")}
          {row("Purchase price", v.purchase, { first: true, indent: true })}
          {row("Closing costs", v.buying, { indent: true })}
          {row("All-in purchase", allIn)}
          {row("Rehab", v.rehab)}
          {v.openBills ? row("Open bills (still owed)", v.openBills) : null}
          {row("Holding costs", v.holding)}
          {row("Total cost", cost, { total: true })}
          {hd("Sale")}
          {row(view === "actual" ? "Sale price" : "Sale price (ARV)", v.sale, { first: true })}
          {row("Commissions & selling costs", -(v.selling || 0), { minus: true })}
          {row(view === "actual" ? "Interest (hard money + line of credit)" : "Financing (interest + lender fees)", -(v.financing || 0), { minus: true })}
          {row("Less total cost", -cost, { minus: true })}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", background: (v.profit || 0) < 0 ? "#FDECEC" : "#EAF7EE", borderRadius: 12, marginTop: 10, fontWeight: 800, fontSize: 16, color: (v.profit || 0) < 0 ? T.red : "#1E7B3C" }}>
            <span>{label} profit</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{money(v.profit || 0)}</span>
          </div>
          {v.cashIn > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: T.textSub, padding: "9px 4px 4px" }}><span>Cash in {money(v.cashIn)}</span>{roc && <span>{roc} return on cash in</span>}</div>}
          {extra}
        </div>
        <div style={{ padding: "12px 20px max(14px,env(safe-area-inset-bottom))", borderTop: "1px solid rgba(0,0,0,0.07)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={pdf} disabled={busy} style={{ minHeight: 44, padding: "0 20px", borderRadius: 22, border: "none", background: T.gold, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>{busy ? "Making PDF…" : isMobile ? "⤴ Share PDF" : "⬇ PDF"}</button>
        </div>
      </div>
    </div>
  );
}
