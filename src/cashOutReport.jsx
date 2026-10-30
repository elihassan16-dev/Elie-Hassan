// 💵 Cash-Out Analysis (Elie approved the mockup 10/30/26). Reports →
// one row per deal: closing date · sale price · selling costs · loans +
// interest to closing · interest reserve back · open bills → est. cash out.
// Same money math as the Claude connector's liquidation_forecast
// (lib/cashOut.js), plus what only this screen does:
//  • sale price from Actuals or Projected (top switch) or Elie's own price
//    per deal (p.coSalePrice — "what if I sell at this?"),
//  • his own closing date (p.coCloseDate) — else the Calendar's, else Dec 31,
//  • selling-cost lines he leaves out (p.coSellOff = item keys),
//  • selling costs QuickBooks shows ALREADY PAID on the deal's project are
//    credited back (Elie 10/30/26) — they're spent, not owed at closing,
//  • the line of credit = the private lenders' money: paid off at closing as
//    principal + interest to the closing date. The QuickBooks credit-line
//    accounts on the deal are the SAME money, so they're only counted when no
//    private-lender funding is linked to the deal (Elie 10/30/26: "double dipping"),
//  • open bills he types per vendor (p.coBills [{id,vendor,amount,note}]),
//  • 📌 pins for a model (his own, prefs.coPins) + views: In Closing by date,
//    the pipeline (In Closing + On Market + Under Construction), 📌 Model.
// Saved fields live on the property, so everyone sees the same analysis;
// only the owner (Financial Section editor) can change them.
import { useEffect, useMemo, useState } from "react";
import { T } from "./theme";
import { useData } from "./data/DataProvider";
import { useAuth } from "./auth/AuthProvider";
import { Sheet } from "./platinum";
import { printHtml } from "./pdfViewer";
import { loanEntries, hardMoney, interestReserveLeft, creditLines, sellingCosts, closingDates, privateLenderPayoff } from "../lib/cashOut.js";
import { drawsForProperty } from "../lib/dealMath.js";

const n = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };
const money = (v) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(Number(v) || 0)).toLocaleString("en-US")}`;
const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const days = (a, b) => { const x = Date.parse(`${a}T12:00:00Z`), y = Date.parse(`${b}T12:00:00Z`); return isNaN(x) || isNaN(y) ? 0 : Math.max(0, Math.round((y - x) / 86400000)); };
const mdy = (ymd) => { const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : ""; };
const PIPE = ["In Closing", "On Market", "Under Construction"];
const OWNED = ["Purchased", "Under Construction", "On Market", "In Closing"];

// Selling-cost lines ↔ QuickBooks P&L accounts on the deal's project, for the
// "already paid" credit. Only costs that are paid BEFORE closing can show up.
const PAID_MATCH = [
  [/stag/i, /stag/i],
  [/pictur|photo|boost|marketing|advertis/i, /photo|pictur|marketing|advertis|boost/i],
  [/pre.?list|inspection/i, /pre.?list/i],
  [/commission/i, /commission|realtor|broker/i],
  [/flat fee/i, /flat fee|listing fee/i],
];
function paidInQb(line, rows) {
  if (!rows || line.autoType === "tax") return 0;
  const m = PAID_MATCH.find(([lineRe]) => lineRe.test(line.title));
  if (!m) return 0;
  return rows.filter((r) => r.section !== "Income" && m[1].test(String(r.name || ""))).reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
}

// One deal's whole analysis.
function analyse(p, { accounts, bankAccounts, spend, draws, src, today, defaultClose }) {
  const f = p.financials || {};
  const cal = closingDates(p).calendar;
  const close = p.coCloseDate || cal || defaultClose;
  const closeSrc = p.coCloseDate ? "your date" : cal ? "from Calendar" : "default";
  const own = n(p.coSalePrice) > 0;
  const base = src === "projected" ? n(f.salePrice) : (n(f.actualSalePrice) || n(f.salePrice));
  const baseSrc = src === "projected" ? "projected" : n(f.actualSalePrice) > 0 ? "actual (contract)" : "projected (no contract)";
  const sale = own ? n(p.coSalePrice) : base;
  const sc = sellingCosts(f, sale);
  const off = new Set((p.coSellOff || []).map(String));
  const rows = p.qbProjectId && spend && spend[p.qbProjectId] && spend[p.qbProjectId].pnl ? spend[p.qbProjectId].pnl.rows : null;
  const lines = sc.lines.map((l) => {
    const paid = Math.min(l.amount, paidInQb(l, rows));
    const on = !off.has(l.key);
    return { ...l, on, paid, owed: on ? Math.max(0, l.amount - paid) : 0 };
  });
  const selling = sc.lines.length ? lines.reduce((s, l) => s + l.owed, 0) : sc.total;
  const paidCredit = lines.reduce((s, l) => s + (l.on ? l.paid : 0), 0);
  const hm = hardMoney(p, accounts, bankAccounts);
  const d = days(today, close);
  const credit = creditLines(p, accounts, bankAccounts).filter((c) => c.rate > 0);
  const lenders = privateLenderPayoff(drawsForProperty(p, draws), close);
  const creditCounted = !lenders.length; // lenders linked → QuickBooks credit lines are the same money
  // A loan on the balance sheet whose balance IS a private lender's principal
  // (to the dollar — one lender, or all the remaining ones together) is that
  // lender's money, not hard money: it's paid once, in the lender's payoff
  // (Elie 10/30/26: 16 Falmouth's manual entries = BIL + Boruchuv).
  const near = (a, b) => b > 0 && Math.abs(a - b) < 1.5;
  const pool = lenders.map((l) => ({ l, used: false }));
  const hmRows = hm.lenders.map((e) => { const m = pool.find((x) => !x.used && near(e.balance, x.l.principal)); if (m) { m.used = true; return { ...e, sameAs: [m.l.lender] }; } return { ...e }; });
  hmRows.forEach((e) => { if (e.sameAs) return; const left = pool.filter((x) => !x.used); if (left.length > 1 && near(e.balance, left.reduce((t, x) => t + x.l.principal, 0))) { left.forEach((x) => { x.used = true; }); e.sameAs = left.map((x) => x.l.lender); } });
  const hmDrawn = hmRows.filter((e) => !e.sameAs).reduce((t, e) => t + e.balance, 0);
  const hmUndrawn = hmDrawn > 0 || !hmRows.length ? hm.undrawn : 0; // no real hard-money loan → no holdback interest
  const hmFull = hmDrawn + hmUndrawn;
  const hmInterest = Math.round(hmFull * (hm.rate / 100) / 365 * d);
  // 🌉 Money floated to the deal from your own accounts (3185 etc. — Bank-Recon
  // bridges incl. the auto-float): paid back at closing, no interest (Elie 10/30/26).
  const floats = loanEntries(p, accounts, bankAccounts).filter((e) => e.bridge && e.bal > 0.5);
  const floatTotal = floats.reduce((t, e) => t + e.bal, 0);
  const loans = hmDrawn + hmInterest + (creditCounted ? credit.reduce((s, c) => s + c.balance, 0) : 0) + lenders.reduce((s, l) => s + l.total, 0) + floatTotal;
  const allIn = p.qbAllInCost !== undefined && p.qbAllInCost !== null && p.qbAllInCost !== "" ? Number(p.qbAllInCost) : (p.qbProjectId && spend && spend[p.qbProjectId] && spend[p.qbProjectId].allIn != null ? spend[p.qbProjectId].allIn : null);
  const reserve = Math.max(0, interestReserveLeft(p, accounts, bankAccounts, allIn) || 0);
  const bills = (p.coBills || []).filter((b) => n(b.amount));
  const billsTotal = bills.reduce((s, b) => s + n(b.amount), 0);
  return {
    p, close, closeSrc, d, sale, own, baseSrc, base, sc, lines, selling, paidCredit, hm, hmRows, hmDrawn, hmUndrawn, hmFull, hmInterest, floats, floatTotal, credit, creditCounted, lenders, loans, reserve, bills, billsTotal,
    cash: Math.round(sale - selling - loans + reserve - billsTotal),
  };
}

const cell = { padding: "10px 12px", borderBottom: `1px solid ${T.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", verticalAlign: "middle" };
const head = { ...cell, fontSize: 10.5, fontWeight: 700, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", background: "#FAFAFC", position: "sticky", top: 0, zIndex: 1 };
const tap = { background: "none", border: "none", padding: 0, color: T.blue, fontFamily: "inherit", fontSize: 13, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3, fontVariantNumeric: "tabular-nums" };
const sub = { display: "block", fontSize: 10.5, color: T.textTert, marginTop: 2 };
const inp = { border: `1px solid ${T.border}`, borderRadius: 8, padding: "5px 8px", fontSize: 13, fontFamily: "inherit", background: "#fff", color: T.text, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const SC = { "In Closing": ["#7B3FB8", "#F3EAFB"], "On Market": ["#1E7B3C", "#EAF7EE"], "Under Construction": ["#B86E00", "#FFF4E5"], Purchased: ["#1D6FB8", "#E9F2FB"] };
const segBtn = (on) => ({ padding: "6px 13px", borderRadius: 100, border: "none", background: on ? "#fff" : "transparent", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.12)" : "none", color: on ? T.text : T.textSub, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", minHeight: 32 });
const segWrap = { display: "inline-flex", background: "rgba(118,118,128,0.12)", borderRadius: 100, padding: 3 };
const rowS = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${T.border}`, fontSize: 13.5 };
const small = { display: "block", fontSize: 11.5, color: T.textTert, marginTop: 1 };
const totS = { display: "flex", justifyContent: "space-between", padding: "12px 14px", background: T.goldLight, borderRadius: 12, fontWeight: 800, fontSize: 14.5, marginTop: 10 };

// Numbers you type: edit as text, save on blur / Enter.
function NumIn({ value, onSave, width = 104, disabled, placeholder }) {
  const [v, setV] = useState(value ? String(Math.round(value)) : "");
  useEffect(() => { setV(value ? String(Math.round(value)) : ""); }, [value]);
  const commit = () => { const x = n(v); if (x !== (value || 0)) onSave(x > 0 ? x : ""); };
  return <input inputMode="decimal" disabled={disabled} value={v ? `$${Number(n(v)).toLocaleString("en-US")}` : ""} placeholder={placeholder} onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} style={{ ...inp, width }} />;
}

export function CashOutReport({ sharedProps, accounts, spend, requestSpend, canEdit, updateProp, isMobile, onClose }) {
  const { draws, bankAccounts } = useData() || {};
  const { prefs, savePrefs } = useAuth() || {};
  const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const [src, setSrc] = useState(() => ls("gs_co_src", "actual"));
  const [view, setView] = useState(() => ls("gs_co_view", "closing"));
  useEffect(() => { try { localStorage.setItem("gs_co_src", src); localStorage.setItem("gs_co_view", view); } catch { /* private mode */ } }, [src, view]);
  // Pins are per person (uprefs_<uid> via BIG_KEYS), mirrored locally so a tap shows at once.
  const [pinList, setPinList] = useState(null);
  const pins = useMemo(() => new Set((pinList || (prefs && prefs.coPins) || []).map(String)), [pinList, prefs]);
  const togglePin = (id) => { const k = String(id); const next = pins.has(k) ? [...pins].filter((x) => x !== k) : [...pins, k]; setPinList(next); if (savePrefs) savePrefs({ coPins: next }); };
  const [pop, setPop] = useState(null); // {kind:"sell"|"loans"|"bills", id}
  const today = todayYmd();
  const defaultClose = `${today.slice(0, 4)}-12-31`;

  const owned = useMemo(() => (sharedProps || []).filter((p) => p && !p.archived && OWNED.includes(p.status)), [sharedProps]);
  const list = useMemo(() => {
    if (view === "model") return owned.filter((p) => pins.has(String(p.id)));
    if (view === "closing") return owned.filter((p) => p.status === "In Closing");
    return owned.filter((p) => PIPE.includes(p.status));
  }, [owned, view, pins]);
  // QuickBooks P&L for the "already paid" credit + up-front reserves.
  const key = list.map((p) => p.qbProjectId).filter(Boolean).join(",");
  useEffect(() => { if (requestSpend && list.length) requestSpend(list); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = { accounts, bankAccounts, spend, draws, src, today, defaultClose };
  const rows = list.map((p) => analyse(p, ctx))
    .sort((a, b) => (view === "closing" ? String(a.close).localeCompare(String(b.close)) : 0) || PIPE.indexOf(a.p.status) - PIPE.indexOf(b.p.status) || String(a.p.address || "").localeCompare(String(b.p.address || "")));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const cur = pop ? rows.find((r) => String(r.p.id) === String(pop.id)) : null;
  const set = (p, k, v) => { if (canEdit) updateProp(p.id, k, v); };

  const exportCsv = () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Property", "Status", "Closing date", "Sale price", "Selling costs", "Loans + interest", "Interest reserve", "Open bills", "Est. cash out"].map(q).join(",")];
    rows.forEach((r) => lines.push([r.p.address, r.p.status, mdy(r.close), r.sale, r.selling, r.loans, r.reserve, r.billsTotal, r.cash].map(q).join(",")));
    lines.push(["Total", "", "", sum("sale"), sum("selling"), sum("loans"), sum("reserve"), sum("billsTotal"), sum("cash")].map(q).join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = `Cash-Out Analysis ${today}.csv`; a.click();
  };
  const exportPdf = () => {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const tr = rows.map((r) => `<tr><td style="text-align:left"><b>${esc(r.p.address)}</b><br><span style="color:#888">${esc(r.p.status)}</span></td><td>${mdy(r.close)}</td><td>${money(r.sale)}</td><td>${money(-r.selling)}</td><td>${money(-r.loans)}</td><td>${money(r.reserve)}</td><td>${money(-r.billsTotal)}</td><td><b>${money(r.cash)}</b></td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:24px;color:#1c1c1e}h1{font-size:20px;margin:0 0 4px}p{color:#666;font-size:12px;margin:0 0 14px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px 8px;border-bottom:1px solid #e5e5ea;text-align:right}th{font-size:10px;text-transform:uppercase;color:#888}tfoot td{font-weight:800;background:#F8F1E0}</style></head><body><h1>Goldstone Properties — Cash-Out Analysis</h1><p>${esc(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))} · sale price from ${src === "projected" ? "Projected" : "Actuals"}</p><table><thead><tr><th style="text-align:left">Property</th><th>Closing</th><th>Sale price</th><th>Selling</th><th>Loans + interest</th><th>Reserve</th><th>Open bills</th><th>Est. cash out</th></tr></thead><tbody>${tr}</tbody><tfoot><tr><td style="text-align:left">Total · ${rows.length}</td><td></td><td>${money(sum("sale"))}</td><td>${money(-sum("selling"))}</td><td>${money(-sum("loans"))}</td><td>${money(sum("reserve"))}</td><td>${money(-sum("billsTotal"))}</td><td>${money(sum("cash"))}</td></tr></tfoot></table></body></html>`;
    printHtml(html, { title: "Cash-Out Analysis", filename: "Cash-Out Analysis.pdf" });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 250, background: T.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: isMobile ? "calc(12px + env(safe-area-inset-top)) 14px 10px" : "16px 24px 12px", background: T.bg, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.gold, fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: "inherit", padding: "4px 0", minHeight: 44, flexShrink: 0 }}>‹ Reports</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 19 : 22, fontWeight: 700, color: T.text }}>💵 Cash-Out Analysis</div>
            <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.45 }}>What you walk away with at each closing: sale price minus selling costs, every loan and its interest to closing, and open bills, plus the interest reserve back.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <div style={segWrap}>{[["closing", "In Closing"], ["pipeline", "In Closing + On Market + Construction"], ["model", `📌 Model${pins.size ? ` (${pins.size})` : ""}`]].map(([k, l]) => <button key={k} onClick={() => setView(k)} style={segBtn(view === k)}>{l}</button>)}</div>
          <span style={{ fontSize: 12.5, color: T.textSub }}>Sale price from</span>
          <div style={segWrap}>{[["actual", "Actuals"], ["projected", "Projected"]].map(([k, l]) => <button key={k} onClick={() => setSrc(k)} style={segBtn(src === k)}>{l}</button>)}</div>
          <span style={{ flex: 1 }} />
          <button onClick={exportCsv} style={{ ...segBtn(false), background: "#fff", border: `1px solid ${T.border}` }}>⬇ Export CSV</button>
          <button onClick={exportPdf} style={{ ...segBtn(false), background: "#fff", border: `1px solid ${T.border}` }}>📄 PDF</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: isMobile ? "0 10px 24px" : "0 24px 28px" }}>
        {!rows.length ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: "28px 20px", textAlign: "center", color: T.textSub, fontSize: 14 }}>
            {view === "model" ? "No deals pinned yet. Switch to another view and tap 📌 next to the deals you want to model." : view === "closing" ? "No deals are In Closing right now." : "No deals in the pipeline."}
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, boxShadow: T.shadow, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13, minWidth: 980 }}>
              <thead><tr>
                <th style={{ ...head, textAlign: "left" }}>Property</th><th style={head}>Closing date</th><th style={head}>Sale price</th><th style={head}>Selling costs</th><th style={head}>Loans + interest</th><th style={head}>Interest reserve</th><th style={head}>Open bills</th><th style={head}>Est. cash out</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const [c, bg] = SC[r.p.status] || [T.textSub, T.bg];
                  const pinned = pins.has(String(r.p.id));
                  return (
                    <tr key={r.p.id}>
                      <td style={{ ...cell, textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button onClick={() => togglePin(r.p.id)} aria-label={pinned ? "Unpin from model" : "Pin to model"} title={pinned ? "Unpin from your model" : "Pin to your model"} style={{ width: 32, height: 32, borderRadius: 16, border: "none", background: pinned ? T.goldLight : "transparent", cursor: "pointer", fontSize: 15, opacity: pinned ? 1 : 0.35, flexShrink: 0 }}>📌</button>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: T.text, whiteSpace: "normal" }}>{r.p.address}{r.p.city ? `, ${r.p.city}` : ""}</div>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: c, background: bg, borderRadius: 20, padding: "2px 8px", display: "inline-block", marginTop: 3 }}>{r.p.status}</span>
                          </div>
                        </div>
                      </td>
                      <td style={cell}>
                        <input type="date" disabled={!canEdit} value={r.close} onChange={(e) => set(r.p, "coCloseDate", e.target.value || "")} style={{ ...inp, width: 140 }} />
                        <span style={sub}>{r.closeSrc} · {r.d} days{r.p.coCloseDate && canEdit ? <> · <button onClick={() => set(r.p, "coCloseDate", "")} style={{ ...tap, fontSize: 10.5 }}>reset</button></> : null}</span>
                      </td>
                      <td style={cell}>
                        <NumIn value={r.sale} disabled={!canEdit} onSave={(v) => set(r.p, "coSalePrice", v === "" || Math.round(v) === Math.round(r.base) ? "" : v)} />
                        <span style={sub}>{r.own ? <>your price{canEdit ? <> · <button onClick={() => set(r.p, "coSalePrice", "")} style={{ ...tap, fontSize: 10.5 }}>reset</button></> : null}</> : r.baseSrc}</span>
                      </td>
                      <td style={cell}><button onClick={() => setPop({ kind: "sell", id: r.p.id })} style={tap}>{money(-r.selling)}</button>{r.paidCredit > 0 && <span style={{ ...sub, color: "#1E7B3C" }}>{money(r.paidCredit)} already paid</span>}</td>
                      <td style={cell}><button onClick={() => setPop({ kind: "loans", id: r.p.id })} style={tap}>{money(-r.loans)}</button></td>
                      <td style={{ ...cell, color: r.reserve > 0 ? "#1E7B3C" : T.textTert, fontWeight: r.reserve > 0 ? 600 : 400 }}>{r.reserve > 0 ? `+${money(r.reserve)}` : "$0"}</td>
                      <td style={cell}><button onClick={() => setPop({ kind: "bills", id: r.p.id })} style={{ ...tap, color: r.bills.length ? T.blue : T.textTert }}>{r.bills.length ? money(-r.billsTotal) : "＋ Add"}</button>{r.bills.length > 0 && <span style={sub}>{r.bills.length} bill{r.bills.length === 1 ? "" : "s"}</span>}</td>
                      <td style={{ ...cell, fontWeight: 800, fontSize: 14, color: r.cash < 0 ? T.red : "#8a6d1f" }}>{money(r.cash)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr style={{ background: T.goldLight }}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 800, borderBottom: "none" }}>Total · {rows.length} deal{rows.length === 1 ? "" : "s"}</td><td style={{ ...cell, borderBottom: "none" }} />
                <td style={{ ...cell, fontWeight: 800, borderBottom: "none" }}>{money(sum("sale"))}</td>
                <td style={{ ...cell, fontWeight: 800, borderBottom: "none" }}>{money(-sum("selling"))}</td>
                <td style={{ ...cell, fontWeight: 800, borderBottom: "none" }}>{money(-sum("loans"))}</td>
                <td style={{ ...cell, fontWeight: 800, borderBottom: "none", color: "#1E7B3C" }}>+{money(sum("reserve"))}</td>
                <td style={{ ...cell, fontWeight: 800, borderBottom: "none" }}>{money(-sum("billsTotal"))}</td>
                <td style={{ ...cell, fontWeight: 800, fontSize: 15, borderBottom: "none", color: "#8a6d1f" }}>{money(sum("cash"))}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 10, lineHeight: 1.5 }}>Hard-money interest runs from today to the closing date on the full loan (incl. any undrawn holdback), the way the Financial Overview figures it. Your line of credit is the private lenders' money, paid off at closing as principal + interest to the closing date (the QuickBooks credit-line accounts are the same money and only count when no lender funding is linked to the deal); your own 0% loans are paid back with no interest. Selling costs QuickBooks already shows as paid on the deal are credited back.</div>
      </div>

      {cur && pop.kind === "sell" && (
        <Sheet title="Selling costs" sub={`${cur.p.address} · at ${money(cur.sale)} · ${cur.sc.source}`} isMobile={isMobile} onClose={() => setPop(null)}>
          {cur.lines.length ? cur.lines.map((l, i) => (
            <div key={l.key} style={{ ...rowS, borderTop: i ? rowS.borderTop : "none" }}>
              <button disabled={!canEdit} onClick={() => { const offs = new Set((cur.p.coSellOff || []).map(String)); offs.has(l.key) ? offs.delete(l.key) : offs.add(l.key); set(cur.p, "coSellOff", [...offs]); }} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: canEdit ? "pointer" : "default", fontFamily: "inherit", textAlign: "left", flex: 1, minWidth: 0, minHeight: 44 }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${l.on ? T.gold : "#C7C7CC"}`, background: l.on ? T.gold : "#fff", color: "#fff", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{l.on ? "✓" : ""}</span>
                <span style={{ color: l.on ? T.text : T.textTert, textDecoration: l.on ? "none" : "line-through", fontSize: 13.5 }}>{l.title}{l.on && l.paid > 0 && <span style={{ ...small, color: "#1E7B3C" }}>{money(l.paid)} already paid in QuickBooks — credited</span>}</span>
              </button>
              <span style={{ color: l.on ? T.text : T.textTert, textDecoration: l.on ? "none" : "line-through", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{money(l.on ? l.owed : l.amount)}{l.on && l.paid > 0 && <span style={small}>of {money(l.amount)}</span>}</span>
            </div>
          )) : <div style={{ fontSize: 13.5, color: T.textSub, padding: "8px 0" }}>This deal only has a selling-cost total ({money(cur.sc.total)}) — add the lines in the Financial Overview to see and switch them here.</div>}
          <div style={totS}><span>Total owed at closing</span><span>{money(cur.selling)}</span></div>
          {cur.sc.projected > 0 && <div style={{ fontSize: 12, color: T.textTert, marginTop: 8 }}>Projected in the Financial Overview: {money(cur.sc.projected)}</div>}
        </Sheet>
      )}

      {cur && pop.kind === "loans" && (
        <Sheet title="Loans + interest" sub={`${cur.p.address} · closing ${mdy(cur.close)} (${cur.d} days)`} isMobile={isMobile} onClose={() => setPop(null)}>
          {(() => {
            const items = [];
            cur.hmRows.filter((x) => !x.sameAs).forEach((x) => { const nm = x.name.split(":").pop().trim(); items.push([/hard money/i.test(nm) ? nm : `Hard money — ${nm}`, "principal drawn", x.balance]); });
            if (cur.hmInterest) items.push(["Hard-money interest to closing", `${cur.hm.rate}% on ${money(cur.hmFull)}${cur.hmUndrawn ? ` (incl. ${money(cur.hmUndrawn)} undrawn holdback)` : ""} · ${cur.d} days`, cur.hmInterest]);
            if (cur.creditCounted) cur.credit.forEach((c) => items.push([`Line of credit — ${c.name.split(":").pop().trim()}`, "full principal paid at closing (no private-lender funding linked)", c.balance]));
            cur.floats.forEach((e) => items.push([`🌉 Float — ${e.name.replace(/^.* — floated until next draw — /, "").replace(/^Borrowed — /, "")}`, "your own money, paid back at closing · no interest", e.bal]));
            cur.lenders.forEach((l) => items.push([l.owner ? `${l.lender} — 0% loan` : `Private lender — ${l.lender}`, l.owner ? "principal paid back at closing, no interest" : `${money(l.principal)} + interest to closing @ ${Math.round(l.rate * 10000) / 100}%`, l.total]));
            if (!items.length) return <div style={{ fontSize: 13.5, color: T.textSub, padding: "8px 0" }}>No loans linked to this deal yet — link them on the Property Balance Sheet.</div>;
            return items.map(([a, b, v], i) => <div key={i} style={{ ...rowS, borderTop: i ? rowS.borderTop : "none" }}><span>{a}<span style={small}>{b}</span></span><span style={{ fontVariantNumeric: "tabular-nums" }}>{money(v)}</span></div>);
          })()}
          <div style={totS}><span>Total</span><span>{money(cur.loans)}</span></div>
          {(() => {
            const dup = [...(!cur.creditCounted ? cur.credit.map((c) => `${c.name.split(":").pop().trim()} ${money(c.balance)}`) : []), ...cur.hmRows.filter((e) => e.sameAs).map((e) => `${e.name.split(":").pop().trim()} ${money(e.balance)} (= ${e.sameAs.join(" + ")})`)];
            return dup.length ? <div style={{ fontSize: 12, color: T.textTert, marginTop: 8, lineHeight: 1.45 }}>Not counted again: {dup.join(", ")} — the same money as the private lenders above.</div> : null;
          })()}
          {cur.reserve > 0 && <div style={{ fontSize: 12.5, color: "#1E7B3C", marginTop: 8 }}>+{money(cur.reserve)} interest reserve comes back to you (shown in its own column).</div>}
        </Sheet>
      )}

      {cur && pop.kind === "bills" && <BillsSheet r={cur} canEdit={canEdit} isMobile={isMobile} onSave={(list) => set(cur.p, "coBills", list)} onClose={() => setPop(null)} />}
    </div>
  );
}

function BillsSheet({ r, canEdit, isMobile, onSave, onClose }) {
  const [vendor, setVendor] = useState(""), [amt, setAmt] = useState(""), [note, setNote] = useState("");
  const list = r.p.coBills || [];
  const add = () => { if (!vendor.trim() || !n(amt)) return; onSave([...list, { id: Date.now(), vendor: vendor.trim(), amount: n(amt), note: note.trim() }]); setVendor(""); setAmt(""); setNote(""); };
  const field = { ...inp, textAlign: "left", padding: "10px 11px", fontSize: 14, minWidth: 0 };
  return (
    <Sheet title="Open bills" sub={r.p.address} isMobile={isMobile} onClose={onClose}>
      {list.length ? list.map((b, i) => (
        <div key={b.id} style={{ ...rowS, borderTop: i ? rowS.borderTop : "none" }}>
          <span>{b.vendor}{b.note && <span style={small}>{b.note}</span>}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontVariantNumeric: "tabular-nums" }}>{money(b.amount)}{canEdit && <button onClick={() => onSave(list.filter((x) => x.id !== b.id))} aria-label={`Remove ${b.vendor}`} style={{ width: 36, height: 36, border: "none", background: "none", color: T.red, fontSize: 15, cursor: "pointer" }}>✕</button>}</span>
        </div>
      )) : <div style={{ fontSize: 13.5, color: T.textSub, padding: "6px 0" }}>No open bills on this deal.</div>}
      {canEdit && <>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", margin: "12px 0 6px" }}>Add a bill</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor" style={{ ...field, flex: "2 1 140px" }} />
          <input value={amt} inputMode="decimal" onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="$ Amount" style={{ ...field, flex: "1 1 90px" }} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ ...field, flex: "1 1 100%" }} />
          <button onClick={add} disabled={!vendor.trim() || !n(amt)} style={{ flex: "1 1 100%", minHeight: 44, borderRadius: 12, border: "none", background: T.gold, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: vendor.trim() && n(amt) ? 1 : 0.5 }}>Add bill</button>
        </div>
      </>}
      <div style={totS}><span>Total</span><span>{money(r.billsTotal)}</span></div>
    </Sheet>
  );
}
