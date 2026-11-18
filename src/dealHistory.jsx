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
// {deals:{<propId>: record}} as a back-end backup (archived properties are no
// longer auto-deleted — Elie 11/18/26). A record = original projection vs
// actual, the private lenders (principal, dates, rate, interest), hard money,
// dates and sale. Shown by tapping a deal's address on the Sold Properties
// report → SoldDealSheet (no separate report).
import { useEffect, useMemo, useRef } from "react";
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

// Sold Properties report → tap an address: original projection vs actual,
// with lenders, hard money and when the projection was locked.
export function SoldDealSheet({ rec, isMobile, onClose, note = null }) {
  if (!rec) return null;
  return (
    <DealSummarySheet title={rec.address} sub={[rec.city, rec.soldDate ? `Sold ${day(rec.soldDate)}` : "Sold"].filter(Boolean).join(" · ")} isMobile={isMobile}
      views={{ projected: rec.proforma, ...(rec.actual ? { actual: rec.actual } : {}) }} initial={rec.actual ? "actual" : "projected"}
      extra={<>
        {note && <div style={{ fontSize: 12, color: T.textSub, background: "rgba(118,118,128,0.08)", borderRadius: 10, padding: "8px 10px", marginTop: 12, lineHeight: 1.4 }}>{note}</div>}
        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.06em", margin: "16px 0 4px" }}>Lenders</div>
        {(rec.lenders || []).length === 0 && <div style={{ fontSize: 13, color: T.textTert, padding: "6px 0" }}>No private-lender money linked.</div>}
        {(rec.lenders || []).map((l, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: i ? "1px solid rgba(0,0,0,0.07)" : "none", fontSize: 13.5 }}>
            <span>{l.lender}<span style={{ display: "block", fontSize: 11.5, color: T.textTert }}>{day(l.funded)}{l.paidBack ? ` → paid ${day(l.paidBack)}` : " · open"} · {l.rate}%</span></span>
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}<span style={{ display: "block", fontSize: 11.5, color: T.gold }}>+{money(l.interest)} interest</span></span>
          </div>
        ))}
        {rec.hardMoney && rec.hardMoney.loan > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid rgba(0,0,0,0.07)", fontSize: 13.5 }}><span>Hard money<span style={{ display: "block", fontSize: 11.5, color: T.textTert }}>{rec.hardMoney.rate}%</span></span><span style={{ textAlign: "right" }}>{money(rec.hardMoney.loan)}<span style={{ display: "block", fontSize: 11.5, color: T.gold }}>+{money(rec.hardMoney.interest)} interest</span></span></div>}
        {(rec.purchaseDate || rec.soldDate) && <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 8 }}>{[rec.purchaseDate && `Bought ${day(rec.purchaseDate)}`, rec.soldDate && `Sold ${day(rec.soldDate)}`].filter(Boolean).join(" · ")}</div>}
        {rec.proformaAt && <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 2 }}>Original projection locked {day(rec.proformaAt)}.</div>}
      </>}
      onClose={onClose} />
  );
}
