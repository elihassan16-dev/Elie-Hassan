// 📄 Payoff statement for a private lender (Elie 9/30/26): a one-page letter
// from the Record payback popup, dated the day it's made — "we're pleased to
// let you know we completed the sale of …", then the breakdown (amount funded
// and when, payback date, days, daily interest, total interest, principal +
// interest) and a sign-off. No wire details, by request. Same numbers the
// popup shows: simple interest, actual days / 365, tiered on each balance
// when there were paydowns.
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
  const W = 612, H = 792, M = 64, R = W - M;
  // Every funding this lender put into the deal (a second wire a couple of
  // weeks later is its own loan) — one line each, then the totals.
  const loans = (s.loans && s.loans.length ? s.loans : [{ amount: s.amount, dateFunded: s.dateFunded, payments: s.payments, rate: s.rate }])
    .map((l) => { const rate = Number(l.rate) || 0; const r = payoffPeriods({ amount: l.amount, dateFunded: l.dateFunded, payments: l.payments, end: s.payoffDate, rate });
      return { ...l, rate, ...r, interest: r.periods.reduce((t, p) => t + p.interest, 0), days: days(l.dateFunded, s.payoffDate), perDiem: r.balance * rate / 365 }; })
    .sort((a, b) => String(a.dateFunded).localeCompare(String(b.dateFunded)));
  const multi = loans.length > 1;
  const balance = loans.reduce((t, l) => t + l.balance, 0);
  const interest = loans.reduce((t, l) => t + l.interest, 0);
  const total = balance + interest;
  const perDiem = loans.reduce((t, l) => t + l.perDiem, 0);
  const pctOf = (r) => `${Math.round(r * 10000) / 100}%`;
  const sameRate = loans.every((l) => l.rate === loans[0].rate);
  const pct = pctOf(loans[0].rate);
  const part = s.mode === "part";
  const who = String(s.funderName || "").trim();

  // ── Letterhead: logo, company, address, gold rule
  const logo = await logoData();
  if (logo) { try { doc.addImage(logo, "PNG", M, 38, 56, 56); } catch { /* no logo */ } }
  const hx = logo ? M + 70 : M;
  doc.setFont("times", "bold"); doc.setFontSize(21); doc.setTextColor(...INK);
  doc.text("Goldstone Properties", hx, 64);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SUB);
  doc.text(CO.addr, hx, 80);
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.4); doc.line(M, 106, R, 106);

  // ── Date, title, addressee
  let y = 138;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SUB);
  doc.text(longDate(new Date().toISOString()), R, y, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...GOLD);
  doc.text(part ? "PAYDOWN STATEMENT" : "PAYOFF STATEMENT", M, y, { charSpace: 2 });
  doc.setFont("times", "bold"); doc.setFontSize(21); doc.setTextColor(...INK);
  doc.text(s.property || "Loan", M, y + 26, { maxWidth: R - M });
  y += 58;

  // ── The letter
  const para = (t, opts = {}) => {
    doc.setFont(opts.font || "times", opts.style || "normal"); doc.setFontSize(opts.size || 11.5); doc.setTextColor(...(opts.color || INK));
    const ls = doc.splitTextToSize(t, R - M); doc.text(ls, M, y, { lineHeightFactor: 1.45 }); y += ls.length * (opts.size || 11.5) * 1.45 + (opts.after != null ? opts.after : 10);
  };
  para(`Dear ${who || "Partner"},`, { after: 6 });
  const place = s.property || "the property";
  para(part
    ? `We're writing to confirm a partial paydown on your loan for ${place}. Please see the breakdown below.`
    : `We're pleased to let you know that we have completed the sale of ${place}. Please see the breakdown of your distribution below.`, { after: 16 });

  // ── Breakdown
  const row = (label, val, opts = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal"); doc.setFontSize(opts.size || 10.5);
    doc.setTextColor(...(opts.color || INK));
    doc.text(label, M + (opts.indent || 0), y);
    doc.setFont("helvetica", opts.bold || opts.boldVal ? "bold" : "normal");
    doc.text(val, R, y, { align: "right" });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5); if (!opts.noLine) doc.line(M, y + 7, R, y + 7);
    y += opts.gap || rowGap;
  };
  // Tighter rows when there are more lines (paydowns, several fundings) so it stays one page.
  const lineCount = loans.reduce((t, l) => t + 2 + l.paydowns.length + (l.periods.length > 1 ? l.periods.length : 0), 0) + (multi ? 4 : 0);
  const rowGap = lineCount > 13 ? 17 : lineCount > 10 ? 19 : 22;
  const subGap = rowGap - 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...SUB);
  doc.text("BREAKDOWN", M, y, { charSpace: 1.5 }); y += 8;
  doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(M, y, R, y); y += 18;
  const periodRows = (l) => { if (l.periods.length > 1) l.periods.forEach((p) => row(`${shortDate(p.from)} – ${shortDate(p.to)} · ${p.days} days on ${money(p.bal)}`, money(p.interest), { color: SUB, indent: 24, size: 9.5, gap: subGap })); };
  if (!multi) {
    const l = loans[0];
    row(`Amount funded — ${longDate(l.dateFunded)}`, money(l.amount), { boldVal: true });
    l.paydowns.forEach((p) => row(`Principal paid down — ${longDate(p.date)}`, `(${money(p.amount)})`, { color: SUB, indent: 12 }));
    if (l.paydowns.length) row("Principal outstanding", money(l.balance), { boldVal: true });
    row(part ? "Paydown date" : "Payback date", longDate(s.payoffDate), { boldVal: true });
    row("Term", `${l.days} day${l.days === 1 ? "" : "s"}`);
    row("Interest rate", `${pct} per year`);
    row(`Daily interest${l.paydowns.length ? ` (on ${money(l.balance)})` : ""}`, `${money(perDiem)} per day`);
    periodRows(l);
    row("Total interest", money(interest), { boldVal: true });
  } else {
    // One block per funding: amount + date, its paydowns, its own days / daily / interest.
    loans.forEach((l, i) => {
      row(`Funding ${i + 1} — ${longDate(l.dateFunded)}`, money(l.amount), { bold: true });
      l.paydowns.forEach((p) => row(`Principal paid down — ${longDate(p.date)}`, `(${money(p.amount)})`, { color: SUB, indent: 12, gap: subGap }));
      row(`Interest · ${l.days} day${l.days === 1 ? "" : "s"} at ${money(l.perDiem)} per day${sameRate ? "" : ` (${pctOf(l.rate)})`}`, money(l.interest), { color: SUB, indent: 12, gap: subGap });
      periodRows(l);
      y += rowGap < 22 ? 2 : 6; // a breath between fundings
    });
    y += 2;
    row(part ? "Paydown date" : "Payback date", longDate(s.payoffDate), { boldVal: true });
    if (sameRate) row("Interest rate", `${pct} per year`);
    row("Total principal", money(balance), { boldVal: true });
    row("Daily interest", `${money(perDiem)} per day`);
    row("Total interest", money(interest), { boldVal: true });
  }
  y += 6;

  // ── Principal + interest box
  const boxH = 62;
  doc.setFillColor(248, 241, 224); doc.setDrawColor(...GOLD); doc.setLineWidth(1);
  doc.roundedRect(M, y - 6, R - M, boxH, 6, 6, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...GOLD);
  doc.text("PRINCIPAL + INTEREST", M + 18, y + 18, { charSpace: 1.5 });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...SUB);
  doc.text(`${money(balance)} principal + ${money(interest)} interest`, M + 18, y + 36);
  doc.setFont("times", "bold"); doc.setFontSize(26); doc.setTextColor(...INK);
  doc.text(money(total), R - 18, y + 34, { align: "right" });
  y += boxH + (rowGap < 22 ? 14 : 20);

  // A partial paydown: what comes back now and what's still on the loan.
  // (Where the rest of the money sits is Goldstone's internal business — not on the letter.)
  if (part) {
    const pa = Number(s.partAmount) || 0;
    row("Principal paid back now", money(pa), { boldVal: true });
    row("Principal remaining on the loan", money(Math.max(0, balance - pa)), { boldVal: true });
    y += 4;
  }

  // ── Closing + signature (onto a second page only if a long history needs it)
  if (y + 108 > H - 70) { doc.addPage(); y = 90; } // closing + signature need ~108pt above the fine print
  para(`If you have any questions or concerns, please don't hesitate to reach out. Thank you for your continued partnership — we look forward to the next one.`, { after: 18 });
  para("Sincerely,", { after: 22 });
  doc.setFont("times", "bold"); doc.setFontSize(12); doc.setTextColor(...INK); doc.text(s.preparedBy || "Elie Hassan", M, y); y += 15;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...SUB); doc.text(CO.name, M, y);

  // Footer on every page: the fine print + company line
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...SUB);
    doc.text(`Interest is simple interest${sameRate ? ` at ${pct} per year` : ""} on the outstanding principal, counted on actual days over a 365-day year.`, W / 2, H - 58, { align: "center" });
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, H - 46, R, H - 46);
    doc.setFontSize(8); doc.text(`${CO.name}  ·  ${CO.addr}${pages > 1 ? `  ·  Page ${i} of ${pages}` : ""}`, W / 2, H - 32, { align: "center" });
  }

  const safe = (s.property || "loan").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const name = `${part ? "Paydown" : "Payoff"}-${safe}-${String(s.payoffDate || "").slice(0, 10)}.pdf`;
  return new File([doc.output("blob")], name, { type: "application/pdf" });
}
