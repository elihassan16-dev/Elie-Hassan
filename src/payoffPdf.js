// 📄 Payoff statement for a private lender (Elie 9/30/26): a one-page PDF from
// the Record payback popup — same numbers the popup shows (simple interest,
// actual days / 365, tiered on each balance when there were paydowns), laid out
// as a proper letter he can preview and WhatsApp / email to the funder.
// jsPDF loads on demand so it never weighs down app launch.

const GOLD = [184, 145, 46], INK = [28, 28, 30], SUB = [96, 96, 100], LINE = [226, 214, 180];
const CO = { name: "Goldstone Properties LLC", addr: "17 Natures Way, Lakewood, New Jersey 08701" };
const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso) => { if (!iso) return ""; const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); return isNaN(d) ? String(iso) : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); };
const shortDate = (iso) => { if (!iso) return ""; const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); return isNaN(d) ? String(iso) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const days = (a, b) => { const s = new Date(a), e = new Date(b); if (isNaN(s) || isNaN(e)) return 0; return Math.max(0, Math.round((e - s) / 86400000)); };

// The interest, period by period (one line per balance), exactly like the app's drawInterest.
export function payoffPeriods({ amount, dateFunded, payments, end, rate }) {
  const pays = [...(payments || [])].filter((p) => p.date && (Number(p.amount) || 0) > 0 && String(p.date) <= String(end)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let bal = Number(amount) || 0, cursor = dateFunded;
  const out = [];
  for (const p of pays) {
    const n = days(cursor, p.date);
    out.push({ from: cursor, to: p.date, bal, days: n, interest: bal * (rate / 365) * n });
    bal = Math.max(0, bal - (Number(p.amount) || 0));
    cursor = p.date;
  }
  const n = days(cursor, end);
  out.push({ from: cursor, to: end, bal, days: n, interest: bal * (rate / 365) * n });
  return { periods: out, balance: bal, paydowns: pays };
}

let logoP = null;
const logoData = () => {
  if (!logoP) logoP = fetch("/logo.png").then((r) => r.blob()).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); })).catch(() => null);
  return logoP;
};

// s = { funderName, property, dateFunded, amount, payments, payoffDate, rate (0.15),
//       mode: both|int|prin|hold|part, holdWhat, partAmount, preparedBy }
export async function payoffPdfFile(s) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" }); // 612 x 792
  const W = 612, H = 792, M = 56, R = W - M;
  const rate = Number(s.rate) || 0;
  const { periods, balance, paydowns } = payoffPeriods({ amount: s.amount, dateFunded: s.dateFunded, payments: s.payments, end: s.payoffDate, rate });
  const interest = periods.reduce((t, p) => t + p.interest, 0);
  const total = balance + interest;
  const perDiem = balance * rate / 365;
  const pct = `${Math.round(rate * 10000) / 100}%`;

  // ── Letterhead
  const logo = await logoData();
  if (logo) { try { doc.addImage(logo, "PNG", M, 40, 54, 54); } catch { /* no logo */ } }
  const hx = logo ? M + 68 : M;
  doc.setFont("times", "bold"); doc.setFontSize(20); doc.setTextColor(...INK);
  doc.text("Goldstone Properties", hx, 66);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SUB);
  doc.text(`${CO.name}  ·  ${CO.addr}`, hx, 82);
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.4); doc.line(M, 108, R, 108);

  // ── Title + details
  let y = 146;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...GOLD);
  doc.text(s.mode === "part" ? "PAYDOWN STATEMENT" : "PAYOFF STATEMENT", M, y, { charSpace: 2 });
  doc.setFont("times", "bold"); doc.setFontSize(22); doc.setTextColor(...INK);
  doc.text(s.property || "Loan", M, y + 28, { maxWidth: R - M });
  y += 58;
  const meta = [
    ["Lender", s.funderName || "—"],
    ["Statement date", longDate(new Date().toISOString())],
    ["Loan funded", longDate(s.dateFunded)],
    [s.mode === "part" ? "Paydown date" : "Good through", longDate(s.payoffDate)],
    ["Interest", `${pct} per year, simple — actual days / 365`],
  ];
  doc.setFontSize(10.5);
  meta.forEach(([k, v], i) => {
    const yy = y + i * 17;
    doc.setFont("helvetica", "normal"); doc.setTextColor(...SUB); doc.text(k, M, yy);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.text(String(v), M + 110, yy);
  });
  y += meta.length * 17 + 16;

  // ── The math, line by line
  const row = (label, amt, opts = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal"); doc.setFontSize(opts.size || 10.5);
    doc.setTextColor(...(opts.color || INK));
    doc.text(label, M + (opts.indent || 0), y, { maxWidth: R - M - 140 });
    if (amt != null) doc.text(amt, R, y, { align: "right" });
    y += opts.gap || 18;
  };
  const rule = (c = LINE, w = 0.8) => { doc.setDrawColor(...c); doc.setLineWidth(w); doc.line(M, y - 11, R, y - 11); y += 4; };
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...SUB); doc.text("DETAIL", M, y, { charSpace: 1.5 }); doc.text("AMOUNT", R - doc.getTextWidth("AMOUNT") - 1.5 * 5, y, { charSpace: 1.5 }); y += 16;
  rule();
  row("Original principal", money(s.amount));
  paydowns.forEach((p) => row(`Less principal paid down ${shortDate(p.date)}`, `(${money(p.amount)})`, { color: SUB, indent: 12 }));
  if (paydowns.length) row("Principal outstanding", money(balance), { bold: true });
  y += 2;
  periods.forEach((p) => row(`Interest ${shortDate(p.from)} – ${shortDate(p.to)} · ${p.days} day${p.days === 1 ? "" : "s"} on ${money(p.bal)}`, money(p.interest), { color: periods.length > 1 ? SUB : INK, indent: periods.length > 1 ? 12 : 0 }));
  if (periods.length > 1) row("Total interest", money(interest), { bold: true });
  y += 6; rule(GOLD, 1);

  // ── Total box
  const boxH = 54;
  doc.setFillColor(248, 241, 224); doc.setDrawColor(...GOLD); doc.setLineWidth(1);
  doc.roundedRect(M, y - 4, R - M, boxH, 6, 6, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...GOLD);
  doc.text(s.mode === "part" ? "BALANCE + INTEREST TO DATE" : "TOTAL PAYOFF", M + 16, y + 20, { charSpace: 1.5 });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SUB);
  doc.text(`Principal ${money(balance)} + interest ${money(interest)}`, M + 16, y + 36);
  doc.setFont("times", "bold"); doc.setFontSize(24); doc.setTextColor(...INK);
  doc.text(money(total), R - 16, y + 32, { align: "right" });
  y += boxH + 24;

  // ── How it's being settled (the option picked in the popup)
  const settle = (() => {
    const pa = Number(s.partAmount) || 0;
    if (s.mode === "part") return [["Principal paid back now", money(pa)], ["Principal remaining on the loan", money(Math.max(0, balance - pa))], ["Interest", "continues on the remaining balance"]];
    if (s.mode === "int") return [["Interest paid to you", money(interest)], ["Principal kept with Goldstone to redeploy", money(balance)]];
    if (s.mode === "prin") return [["Principal paid back to you", money(balance)], ["Interest reinvested onto your balance", money(interest)]];
    if (s.mode === "hold") {
      if (s.holdWhat === "prin") return [["Interest paid to you", money(interest)], ["Principal held with Goldstone", money(balance)]];
      if (s.holdWhat === "int") return [["Principal paid back to you", money(balance)], ["Interest held with Goldstone", money(interest)]];
      return [["Held with Goldstone (principal + interest)", money(total)], ["Paid out now", money(0)]];
    }
    return [["Principal paid back to you", money(balance)], ["Interest paid to you", money(interest)], ["Total paid to you", money(total)]];
  })();
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...SUB); doc.text("SETTLEMENT", M, y, { charSpace: 1.5 }); y += 16;
  rule();
  settle.forEach(([k, v], i) => row(k, v, { bold: i === settle.length - 1 && s.mode === "both" }));
  y += 8;

  // ── Notes + sign-off
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SUB);
  const notes = [
    s.mode === "part"
      ? `Interest keeps accruing on the remaining principal from ${longDate(s.payoffDate)}.`
      : `Figures are good through ${longDate(s.payoffDate)}. If the payoff lands later, add ${money(perDiem)} per day (per diem).`,
    `Interest is simple interest at ${pct} per year on the outstanding principal, counted on actual days elapsed over a 365-day year${paydowns.length ? ", on each balance for the days it was outstanding" : ""}.`,
    "Please reach out with any questions about this statement.",
  ];
  notes.forEach((t) => { const ls = doc.splitTextToSize(t, R - M); doc.text(ls, M, y); y += ls.length * 12 + 4; });
  y = Math.max(y + 18, H - 150);
  doc.setFont("times", "italic"); doc.setFontSize(12); doc.setTextColor(...INK);
  doc.text("Thank you for your partnership,", M, y); y += 34;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(M, y, M + 200, y); y += 15;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(s.preparedBy || "Elie Hassan", M, y); y += 13;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...SUB); doc.text(CO.name, M, y);

  // Footer
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, H - 44, R, H - 44);
  doc.setFontSize(8); doc.setTextColor(...SUB);
  doc.text(`${CO.name} · ${CO.addr}`, W / 2, H - 30, { align: "center" });

  const safe = (s.property || "loan").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const name = `Payoff-${safe}-${String(s.payoffDate || "").slice(0, 10)}.pdf`;
  return new File([doc.output("blob")], name, { type: "application/pdf" });
}
