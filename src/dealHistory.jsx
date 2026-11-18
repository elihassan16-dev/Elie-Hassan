// 📚 Deal history + 🔒 locked projections (Elie 11/18/26).
//
// LOCK: once a property is past Under Contract (Purchased, Under Construction,
// On Market, Attorney Review, In Closing, Sold, Rental) its PROJECTED numbers
// are frozen — the Financial Overview's projected column is read-only and the
// original underwriting is saved on the deal as financials.proforma
// {at, status, fields, numbers}. Moving it back to Under Contract unlocks it
// (proforma.unlocked); moving forward again re-saves (the old copy is kept in
// proformaHistory).
//
// HISTORY: every Sold deal is copied into app_settings "deal_history"
// {deals:{<propId>: record}} — kept forever, even after the property is
// archived and auto-deleted 60 days later. A record = original projection vs
// actual, the private lenders (principal, dates, rate, interest), hard money,
// dates and sale. Reports → "📚 Sold deal history".
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { T } from "./theme";
import { DealSummarySheet } from "./dealSummary";
import { buildDealRecord } from "./dealLock.js";
export { finLocked, proformaUpdate, buildDealRecord, projectedNumbers, pickProforma, PROFORMA_KEYS } from "./dealLock.js";

const ROW = "deal_history";
async function readRow() {
  const { data } = await supabase.from("app_settings").select("data").eq("id", ROW).maybeSingle();
  return (data && data.data) || { deals: {} };
}

// Keep the history row in step with every Sold property (team devices).
export function useDealHistorySync(sharedProps, draws, enabled) {
  const busy = useRef(false);
  const sig = useMemo(() => (sharedProps || []).filter((p) => p && p.status === "Sold").map((p) => JSON.stringify(buildDealRecord(p, draws))).join("\n"), [sharedProps, draws]);
  useEffect(() => {
    if (!enabled || !sig || busy.current) return;
    const t = setTimeout(async () => {
      busy.current = true;
      try {
        const cur = await readRow();
        const deals = { ...(cur.deals || {}) };
        let changed = false;
        (sharedProps || []).filter((p) => p && p.status === "Sold").forEach((p) => {
          const rec = buildDealRecord(p, draws);
          const old = deals[rec.id];
          const same = old && JSON.stringify({ ...old, savedAt: undefined }) === JSON.stringify({ ...rec, savedAt: undefined });
          if (!same) { deals[rec.id] = { ...rec, savedAt: new Date().toISOString(), firstSavedAt: (old && old.firstSavedAt) || new Date().toISOString() }; changed = true; }
        });
        if (changed) await supabase.from("app_settings").upsert({ id: ROW, data: { ...cur, deals }, updated_at: new Date().toISOString() });
      } catch { /* next change retries */ }
      busy.current = false;
    }, 4000);
    return () => clearTimeout(t);
  }, [sig, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

const money = (v) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(Number(v) || 0)).toLocaleString("en-US")}`;
const day = (s) => { const d = new Date(String(s || "").length === 10 ? `${s}T12:00:00` : s); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };

// Reports → 📚 Sold deal history.
export function DealHistoryReport({ isMobile, onClose }) {
  const [deals, setDeals] = useState(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => { readRow().then((r) => setDeals(Object.values(r.deals || {}))).catch(() => setDeals([])); }, []);
  const list = (deals || []).filter((d) => !q.trim() || `${d.address} ${d.city} ${(d.lenders || []).map((l) => l.lender).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => String(b.soldDate || b.savedAt || "").localeCompare(String(a.soldDate || a.savedAt || "")));
  const cell = { padding: isMobile ? "10px 6px" : "11px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontSize: isMobile ? 12.5 : 13.5 };
  const head = { ...cell, fontSize: 10.5, fontWeight: 700, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", background: "#FAFAFC" };
  const cur = open ? list.find((d) => d.id === open) : null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 250, background: T.bg, overflowY: "auto", padding: isMobile ? "calc(12px + env(safe-area-inset-top)) 14px 24px" : "16px 24px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.gold, fontWeight: 600, fontSize: 15, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>‹ Reports</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 20, fontWeight: 750 }}>📚 Sold deal history</div>
          <div style={{ fontSize: 12.5, color: T.textSub }}>Every sold deal kept for your records — original projection vs actual, lenders and what they were paid. Stays here even after a property is archived or deleted.</div>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address or lender" style={{ height: 36, borderRadius: 10, border: "none", background: "rgba(118,118,128,0.10)", padding: "0 12px", fontSize: 13.5, fontFamily: "inherit", minWidth: 220 }} />
      </div>
      <div style={{ background: "#fff", borderRadius: 14, boxShadow: T.shadow, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ ...head, textAlign: "left" }}>Property</th><th style={head}>Sold</th>
            {!isMobile && <th style={head}>Sale price</th>}<th style={head}>Projected</th><th style={head}>Actual</th>{!isMobile && <th style={head}>Lenders</th>}
          </tr></thead>
          <tbody>
            {deals === null && <tr><td colSpan={6} style={{ ...cell, textAlign: "center", color: T.textTert }}>Loading…</td></tr>}
            {deals && !list.length && <tr><td colSpan={6} style={{ ...cell, textAlign: "center", color: T.textTert, whiteSpace: "normal" }}>No sold deals saved yet — every property marked Sold is added here automatically.</td></tr>}
            {list.map((d) => {
              const diff = d.actual ? d.actual.profit - d.proforma.profit : null;
              return (
                <tr key={d.id} onClick={() => setOpen(d.id)} style={{ cursor: "pointer" }}>
                  <td style={{ ...cell, textAlign: "left", whiteSpace: "normal" }}><b style={{ fontWeight: 650 }}>{d.address}</b><div style={{ fontSize: 11.5, color: T.textTert }}>{d.city}</div></td>
                  <td style={cell}>{day(d.soldDate) || "—"}</td>
                  {!isMobile && <td style={cell}>{money(d.actual ? d.actual.sale : d.proforma.sale)}</td>}
                  <td style={{ ...cell, color: T.textSub }}>{money(d.proforma.profit)}</td>
                  <td style={{ ...cell, fontWeight: 700, color: d.actual ? (d.actual.profit < 0 ? T.red : "#1E7B3C") : T.textTert }}>{d.actual ? money(d.actual.profit) : "—"}{diff != null && <div style={{ fontSize: 11, fontWeight: 500, color: diff < 0 ? T.red : "#1E7B3C" }}>{diff >= 0 ? "+" : ""}{money(diff)} vs plan</div>}</td>
                  {!isMobile && <td style={{ ...cell, textAlign: "right", whiteSpace: "normal", fontSize: 12.5, color: T.textSub }}>{(d.lenders || []).length ? [...new Set(d.lenders.map((l) => l.lender))].join(", ") : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cur && (
        <DealSummarySheet title={cur.address} sub={[cur.city, cur.soldDate ? `Sold ${day(cur.soldDate)}` : "Sold"].filter(Boolean).join(" · ")} isMobile={isMobile}
          views={{ projected: cur.proforma, ...(cur.actual ? { actual: cur.actual } : {}) }} initial={cur.actual ? "actual" : "projected"}
          extra={<>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.06em", margin: "16px 0 4px" }}>Lenders</div>
            {(cur.lenders || []).length === 0 && <div style={{ fontSize: 13, color: T.textTert, padding: "6px 0" }}>No private-lender money linked.</div>}
            {(cur.lenders || []).map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: i ? "1px solid rgba(0,0,0,0.07)" : "none", fontSize: 13.5 }}>
                <span>{l.lender}<span style={{ display: "block", fontSize: 11.5, color: T.textTert }}>{day(l.funded)}{l.paidBack ? ` → paid ${day(l.paidBack)}` : " · open"} · {l.rate}%</span></span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}<span style={{ display: "block", fontSize: 11.5, color: T.gold }}>+{money(l.interest)} interest</span></span>
              </div>
            ))}
            {cur.hardMoney && cur.hardMoney.loan > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid rgba(0,0,0,0.07)", fontSize: 13.5 }}><span>Hard money<span style={{ display: "block", fontSize: 11.5, color: T.textTert }}>{cur.hardMoney.rate}%</span></span><span style={{ textAlign: "right" }}>{money(cur.hardMoney.loan)}<span style={{ display: "block", fontSize: 11.5, color: T.gold }}>+{money(cur.hardMoney.interest)} interest</span></span></div>}
            {cur.proformaAt && <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 8 }}>Projection locked {day(cur.proformaAt)}.</div>}
          </>}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
