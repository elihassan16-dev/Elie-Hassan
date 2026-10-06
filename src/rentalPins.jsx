// 📌 Pin QuickBooks transactions to a rental (Elie approved 10/6/26): the
// mortgage payment, insurance, property taxes, utilities — anything paid
// outside Platinum — from ANY QuickBooks account (loan, checking, credit card,
// expense). Pins live on the rental: r.qbPins [{key, accountId, accountName,
// date, amount, desc, cat, rule?}], r.qbPinRules [{id, accountId, accountName,
// cat, since, match, sign}] for "keep pinning new ones automatically", and
// r.qbPinSkip [keys] so an unpinned auto pin doesn't come back. rentalsPL's
// engine folds them into the P&L (a pinned mortgage fills the Mortgage line).
import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "./theme";
import { Sheet } from "./platinum";
import { qbAuthFetch } from "./net";
import { mLabel, pinMonth, addMonths, monthsBetween } from "./rentalsPL";
import { forMonth } from "./platinumLive.js";

const ALL_ACCTS = { id: "__all__", name: "All bank & credit-card accounts", classification: "Asset", type: "Bank", all: true };
export const PIN_CATS = ["Mortgage", "Insurance", "Property taxes", "Utilities", "Repairs & maintenance", "HOA", "Other expenses", "Other income"];
// Income a tenant paid straight to Elie (Elie 10/6/26) pins as "Rent – <unit>"
// on multi-unit rentals (same rows as Platinum's), else "Rent" — see rentCatsFor.
export const pinKey = (accountId, t) => `${accountId}|${t.lineKey || t.id || `${t.date}|${t.amount}`}`;
const guessCat = (acct, rentCats) => {
  const s = `${acct?.name || ""} ${acct?.type || ""} ${acct?.subType || ""}`.toLowerCase();
  if (acct?.classification === "Revenue" || acct?.classification === "Income" || /rent|income/.test(s)) return (rentCats && rentCats[0] && rentCats[0].cat) || "Rent";
  if (/mortgage|loan|note/.test(s) || acct?.classification === "Liability" && !/credit ?card/.test(s)) return "Mortgage";
  if (/insur/.test(s)) return "Insurance";
  if (/tax/.test(s)) return "Property taxes";
  if (/utilit|electric|gas|water|sewer/.test(s)) return "Utilities";
  if (/hoa|association/.test(s)) return "HOA";
  if (/repair|mainten/.test(s)) return "Repairs & maintenance";
  return "Other expenses";
};
const descOf = (t) => [t.vendor, t.memo || (t.type && !t.vendor ? t.type : "")].filter(Boolean).join(" · ") || t.type || "QuickBooks transaction";
const money = (v) => `${v < 0 ? "−" : ""}$${Math.abs(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dshort = (d) => { const x = new Date(String(d).slice(0, 10) + "T00:00:00"); return isNaN(x) ? d : x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: x.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }); };
const normDate = (d) => { const s = String(d || ""); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : s; };
const ruleMatches = (rule, t) => {
  if (normDate(t.date) < (rule.since || "")) return false;
  if (rule.sign && Math.sign(Number(t.amount) || 0) !== rule.sign) return false;
  if (rule.match && !`${t.vendor || ""} ${t.memo || ""}`.toLowerCase().includes(rule.match.toLowerCase())) return false;
  return true;
};

// ── the sheet ──
export function PinSheet({ rental, period, isMobile, onSave, onClose, rentCats }) {
  const [accounts, setAccounts] = useState(null);
  const [acct, setAcct] = useState(null);
  const [txns, setTxns] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [allDates, setAllDates] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [cat, setCat] = useState("Mortgage");
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    qbAuthFetch("/api/quickbooks/accounts?class=All").then((d) => setAccounts(d.items || [])).catch((e) => setErr(e.message || "Couldn't reach QuickBooks."));
  }, []);
  const [fresh, setFresh] = useState(0);
  // One account, or (Elie 10/6/26 — the loan account only held the opening
  // journal entry; the payments come out of a bank account) every bank and
  // credit-card account at once. Each line remembers its own account.
  useEffect(() => {
    if (!acct) return;
    setTxns(null); setPicked(new Set()); setErr("");
    if (!fresh) { const c = acct.all ? "Mortgage" : guessCat(acct, rentCats); setCat(c); setAuto(c === "Mortgage"); }
    const list = acct.all ? (accounts || []).filter((a) => a.type === "Bank" || a.type === "Credit Card") : [acct];
    let dead = false;
    Promise.all(list.map((a) => qbAuthFetch(`/api/quickbooks/account-txns?account=${encodeURIComponent(a.id)}${fresh ? "&fresh=1" : ""}`)
      .then((d) => (d.items || []).map((t) => ({ ...t, date: normDate(t.date), _acct: a })))
      .catch(() => (acct.all ? [] : Promise.reject(new Error("Couldn't load that account."))))))
      .then((rows) => { if (!dead) setTxns(rows.flat()); })
      .catch((e) => { if (!dead) setErr(e.message || "Couldn't load that account."); });
    return () => { dead = true; };
  }, [acct && acct.id, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinned = useMemo(() => new Set((rental.qbPins || []).map((p) => p.key)), [rental.qbPins]);
  const groups = useMemo(() => {
    const g = { Loans: [], Bank: [], "Credit cards": [], Income: [], Expenses: [], Other: [] };
    (accounts || []).forEach((a) => {
      const k = a.type === "Bank" ? "Bank" : a.type === "Credit Card" ? "Credit cards" : a.classification === "Liability" ? "Loans" : a.classification === "Revenue" || a.classification === "Income" ? "Income" : a.classification === "Expense" ? "Expenses" : "Other";
      g[k].push(a);
    });
    return Object.entries(g).filter(([, v]) => v.length);
  }, [accounts]);
  const from = period.from, to = period.to;
  const shown0 = (txns || []).filter((t) => (allDates || (t.date.slice(0, 7) >= from && t.date.slice(0, 7) <= to)) && (!q || `${t.vendor} ${t.memo} ${t.type} ${t.amount}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.date.localeCompare(a.date));
  const shown = shown0.slice(0, 300);
  const toggle = (k) => {
    setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    // A tenant paid you directly → pick that tenant's unit when the payer matches.
    const t = (txns || []).find((x) => pinKey(x._acct.id, x) === k);
    const who = `${t?.vendor || ""} ${t?.memo || ""}`.toLowerCase();
    const hit = t && (rentCats || []).find((r) => r.tenant && r.tenant.split(/\s+/).filter((w) => w.length > 2).some((w) => who.includes(w.toLowerCase())));
    if (hit && /^Rent\b/.test(cat)) setCat(hit.cat);
  };
  const save = () => {
    const chosen = (txns || []).filter((t) => picked.has(pinKey(t._acct.id, t)));
    if (!chosen.length) return;
    const at = new Date().toISOString();
    const ruleId = auto ? `r${Date.now()}` : null;
    const newPins = chosen.map((t) => ({ key: pinKey(t._acct.id, t), accountId: t._acct.id, accountName: t._acct.name, date: t.date, amount: Math.abs(Number(t.amount) || 0), desc: descOf(t), cat, at, ...(ruleId ? { rule: ruleId } : {}) }));
    const patch = { qbPins: [...(rental.qbPins || []).filter((p) => !newPins.some((n) => n.key === p.key)), ...newPins] };
    if (ruleId) {
      const first = [...chosen].sort((a, b) => a.date.localeCompare(b.date))[0];
      const ra = first._acct;
      const isLoan = ra.classification === "Liability" && ra.type !== "Credit Card";
      patch.qbPinRules = [...(rental.qbPinRules || []), { id: ruleId, accountId: ra.id, accountName: ra.name, cat, since: first.date, sign: Math.sign(Number(first.amount) || 0) || 0, match: isLoan ? "" : (first.vendor || "").trim(), at }];
    }
    onSave(patch); onClose();
  };
  const sel = { width: "100%", minHeight: 44, borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, padding: "0 12px", fontSize: 15, fontFamily: "inherit", color: T.text, boxSizing: "border-box" };
  const lab = { fontSize: 12.5, fontWeight: 600, color: T.textSub, margin: "12px 4px 6px", display: "flex", alignItems: "center", gap: 8 };
  return (
    <Sheet title="Pin from QuickBooks" sub={`${rental.address} · transactions from any QuickBooks account`} isMobile={isMobile} onClose={onClose}>
      {err && <div style={{ fontSize: 13.5, color: T.red, margin: "0 4px 8px" }}>{err}</div>}
      <div style={{ ...lab, marginTop: 0 }}>Account</div>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={acct ? acct.id : ""} onChange={(e) => { setFresh(0); setAcct(e.target.value === "__all__" ? ALL_ACCTS : (accounts || []).find((a) => a.id === e.target.value) || null); }} aria-label="QuickBooks account" style={{ ...sel, flex: 1 }}>
          <option value="">{accounts ? "Choose an account…" : "Loading accounts…"}</option>
          {accounts && <option value="__all__">🔍 All bank &amp; credit-card accounts</option>}
          {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
        </select>
        {acct && <button onClick={() => setFresh((x) => x + 1)} title="Reload from QuickBooks" aria-label="Reload from QuickBooks" style={{ width: 44, minHeight: 44, borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, fontSize: 17, cursor: "pointer", color: T.text }}>↻</button>}
      </div>
      {acct && <>
        <div style={lab}>
          <span style={{ flex: 1 }}>Transactions · {allDates ? "all dates" : (from === to ? mLabel(from, "long") : `${mLabel(from)} – ${mLabel(to)} ${to.slice(0, 4)}`)}</span>
          <button onClick={() => setAllDates((v) => !v)} style={{ border: "none", background: "none", color: T.blue, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", minHeight: 30 }}>{allDates ? "Only this period" : "Show all dates"}</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, memo or amount" aria-label="Search transactions" style={{ ...sel, minHeight: 38, marginBottom: 8, background: "rgba(118,118,128,0.12)", border: "none" }} />
        <div style={{ background: T.card, borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}`, maxHeight: 320, overflowY: "auto" }}>
          {!txns && !err && <div style={{ padding: 14, fontSize: 13.5, color: T.textSub }}>Loading from QuickBooks…</div>}
          {txns && shown0.length > 300 && <div style={{ padding: "8px 14px", fontSize: 12.5, color: T.textSub, borderBottom: `1px solid ${T.border}` }}>Showing the newest 300 of {shown0.length} — search to narrow it down.</div>}
          {txns && shown.length === 0 && <div style={{ padding: 14, fontSize: 13.5, color: T.textSub }}>No transactions{allDates ? "" : " in this period — tap Show all dates"}.</div>}
          {txns && !acct.all && txns.length <= 2 && guessCat(acct) === "Mortgage" && <div style={{ padding: "10px 14px", fontSize: 13, color: "#8a6d1f", background: "#FDF9EE", borderBottom: `1px solid ${T.border}` }}>Only {txns.length} transaction{txns.length === 1 ? "" : "s"} in this account. If the monthly payments come out of a bank account, <button onClick={() => { setAcct(ALL_ACCTS); setAllDates(true); setQ("mortgage"); }} style={{ border: "none", background: "none", color: T.blue, fontWeight: 650, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>search all bank &amp; card accounts for “mortgage”</button> (or the lender's name).</div>}
          {shown.map((t, i) => {
            const k = pinKey(t._acct.id, t), already = pinned.has(k), on = already || picked.has(k);
            return (
              <button key={k} disabled={already} onClick={() => toggle(k)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 46, padding: "8px 14px", border: "none", borderTop: i ? `1px solid ${T.border}` : "none", background: "none", cursor: already ? "default" : "pointer", fontFamily: "inherit", textAlign: "left", opacity: already ? 0.55 : 1 }}>
                <span style={{ width: 22, height: 22, borderRadius: 11, border: `1.5px solid ${on ? T.gold : "#C7C7CC"}`, background: on ? T.gold : "transparent", color: "#fff", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on ? "✓" : ""}</span>
                <span style={{ width: 54, fontSize: 13, color: T.textSub, flexShrink: 0 }}>{dshort(t.date)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: T.text }}>{descOf(t)}{acct.all ? <span style={{ display: "block", fontSize: 12, color: T.textSub }}>{t._acct.name}</span> : null}{already && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "1px 6px", background: "#FDF9EE", color: "#8a6d1f", border: "1px solid #EAD9A9" }}>ALREADY IN</span>}</span>
                <span style={{ fontSize: 14, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: T.text }}>{money(t.amount)}</span>
              </button>
            );
          })}
        </div>
        <div style={lab}>Count them as</div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Count them as" style={sel}>
          <optgroup label="Income — paid to you directly">
            {(rentCats && rentCats.length ? rentCats : [{ cat: "Rent", label: "Rent" }]).map((r) => <option key={r.cat} value={r.cat}>{r.label}</option>)}
            <option value="Late fees">Late fees</option>
            <option value="Other income">Other income</option>
          </optgroup>
          <optgroup label="Expenses">{PIN_CATS.filter((c) => c !== "Other income").map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
        </select>
        <button onClick={() => setAuto((v) => !v)} role="switch" aria-checked={auto} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 56, marginTop: 10, padding: "8px 14px", borderRadius: 14, border: `1px solid ${T.border}`, background: T.card, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 15, fontWeight: 650, color: T.text }}>Keep pinning new ones automatically</span><span style={{ display: "block", fontSize: 12.5, color: T.textSub }}>{acct.classification === "Liability" && acct.type !== "Credit Card" ? "every new payment from this account lands here by itself" : "new ones from the same payee in this account land here by themselves"}</span></span>
          <span style={{ width: 50, height: 30, borderRadius: 15, background: auto ? "#34C759" : "#E9E9EB", position: "relative", flexShrink: 0, transition: "background .15s" }}><span style={{ position: "absolute", top: 2, left: auto ? 22 : 2, width: 26, height: 26, borderRadius: 13, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left .15s" }} /></span>
        </button>
      </>}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={{ minHeight: 48, padding: "0 20px", borderRadius: 24, border: `1px solid ${T.border}`, background: T.card, fontSize: 15, fontWeight: 600, color: T.text, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
        <button onClick={save} disabled={!picked.size} style={{ flex: 1, minHeight: 48, borderRadius: 24, border: "none", background: T.gold, color: "#fff", fontSize: 15, fontWeight: 650, cursor: picked.size ? "pointer" : "default", fontFamily: "inherit", opacity: picked.size ? 1 : 0.5 }}>📌 Pin {picked.size || ""} transaction{picked.size === 1 ? "" : "s"}</button>
      </div>
    </Sheet>
  );
}

// ── what's pinned to this rental ──
export function PinnedList({ rental, onSave }) {
  const [all, setAll] = useState(false);
  const rules = rental.qbPinRules || [];
  const pins = [...(rental.qbPins || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!rules.length && !pins.length) return null;
  const loose = pins.filter((p) => !p.rule || !rules.some((r) => r.id === p.rule));
  const shown = all ? loose : loose.slice(0, 6);
  // "For" month (Elie 10/6/26): which month a pinned line counts toward.
  const setMonth = (p, ym) => onSave({ qbPins: (rental.qbPins || []).map((x) => (x.key === p.key ? { ...x, forYm: ym || undefined } : x)) });
  const monthPick = (p) => {
    const auto = forMonth(p), cur = pinMonth(p), d = String(p.date).slice(0, 7);
    const opts = monthsBetween(addMonths(d, -24), addMonths(d, 12)).reverse();
    if (cur && !opts.includes(cur)) opts.push(cur);
    const lbl = (ym) => `${mLabel(ym)} ${ym.slice(0, 4)}`;
    return (
      <label title="Which month this counts for" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 3, minHeight: 30, padding: "0 10px", borderRadius: 15, background: p.forYm ? "#FDF9EE" : "rgba(118,118,128,0.12)", border: p.forYm ? "1px solid #EAD9A9" : "1px solid transparent", color: p.forYm ? "#8a6d1f" : T.text, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0 }}>
        For {lbl(cur)} <span style={{ fontSize: 10, opacity: 0.7 }}>▼</span>
        <select aria-label="Counts for month" value={p.forYm || ""} onChange={(e) => setMonth(p, e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", fontSize: 16 }}>
          <option value="">Automatic · {lbl(auto)}</option>
          {opts.map((ym) => <option key={ym} value={ym}>{lbl(ym)}</option>)}
        </select>
      </label>
    );
  };
  const unpin = (p) => onSave({ qbPins: (rental.qbPins || []).filter((x) => x.key !== p.key), qbPinSkip: [...new Set([...(rental.qbPinSkip || []), p.key])] });
  const stopRule = (r) => {
    if (!window.confirm(`Stop pinning new ${r.cat.toLowerCase()} transactions from ${r.accountName}? The ones already pinned stay (you can unpin them too).`)) return;
    onSave({ qbPinRules: rules.filter((x) => x.id !== r.id), qbPins: (rental.qbPins || []).map((p) => (p.rule === r.id ? { ...p, rule: undefined } : p)) });
  };
  const row = (k, idx, icon, main, right, onX, label) => (
    <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "6px 0", borderTop: idx ? `1px solid ${T.border}` : "none", fontSize: 13.5 }}>
      <span>{icon}</span><span style={{ flex: 1, minWidth: 0, color: T.text }}>{main}</span>{right}
      <button onClick={onX} aria-label={label} title={label} style={{ width: 32, height: 32, border: "none", background: "none", color: T.textTert, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>✕</button>
    </div>
  );
  return (
    <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 2 }}><b style={{ flex: 1, fontSize: 14.5, color: T.text }}>Pinned from QuickBooks</b>{rules.length > 0 && <span style={{ fontSize: 12, color: T.textSub }}>auto rules keep adding new ones</span>}</div>
      {rules.map((r, i) => {
        const n = pins.filter((p) => p.rule === r.id).length;
        return row(`r${r.id}`, i, "🔁", <><b>{r.cat}</b> · every {r.match ? <>“{r.match}” </> : ""}payment from <b>{r.accountName}</b></>, <><span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "1px 6px", background: "#FDF9EE", color: "#8a6d1f", border: "1px solid #EAD9A9" }}>AUTO</span><span style={{ fontSize: 12.5, color: T.textSub, whiteSpace: "nowrap" }}>{n} pinned</span></>, () => stopRule(r), "Stop auto-pinning");
      })}
      {shown.map((p, i) => row(p.key, rules.length + i, "📌", <><b>{p.cat}</b> · {dshort(p.date)} · {p.desc} <span style={{ color: T.textSub }}>· {p.accountName}</span></>, <>{monthPick(p)}<span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: T.textSub }}>{money(p.amount)}</span></>, () => unpin(p), "Unpin"))}
      {loose.length > 6 && <button onClick={() => setAll((v) => !v)} style={{ border: "none", background: "none", color: T.blue, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", minHeight: 32, padding: 0 }}>{all ? "Show fewer" : `Show all ${loose.length}`}</button>}
      {rules.some((r) => pins.some((p) => p.rule === r.id)) && <details style={{ marginTop: 4 }}><summary style={{ fontSize: 12.5, color: T.textSub, cursor: "pointer", minHeight: 28 }}>Auto-pinned transactions</summary>
        {pins.filter((p) => p.rule && rules.some((r) => r.id === p.rule)).map((p, i) => row(p.key, i, "📌", <>{dshort(p.date)} · {p.desc} <span style={{ color: T.textSub }}>· {p.cat}</span></>, <>{monthPick(p)}<span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: T.textSub }}>{money(p.amount)}</span></>, () => unpin(p), "Unpin"))}
      </details>}
    </div>
  );
}

// ── auto rules: once per page visit, pin new matching transactions ──
export function useQbPinSync(rentals, upd) {
  const ran = useRef(new Set());
  const updRef = useRef(upd); updRef.current = upd;
  const sig = (rentals || []).map((r) => `${r.id}:${(r.qbPinRules || []).map((x) => x.id).join(",")}`).join("|");
  useEffect(() => {
    const todo = (rentals || []).filter((r) => (r.qbPinRules || []).length && !ran.current.has(`${r.id}:${(r.qbPinRules || []).map((x) => x.id).join(",")}`));
    if (!todo.length) return;
    let dead = false;
    (async () => {
      const cache = {};
      const txOf = async (id) => { if (!cache[id]) cache[id] = qbAuthFetch(`/api/quickbooks/account-txns?account=${encodeURIComponent(id)}`).then((d) => (d.items || []).map((t) => ({ ...t, date: normDate(t.date) }))).catch(() => null); return cache[id]; };
      for (const r of todo) {
        ran.current.add(`${r.id}:${(r.qbPinRules || []).map((x) => x.id).join(",")}`);
        const have = new Set([...(r.qbPins || []).map((p) => p.key), ...(r.qbPinSkip || [])]);
        const add = [];
        for (const rule of r.qbPinRules || []) {
          const tx = await txOf(rule.accountId);
          if (!tx || dead) continue;
          tx.forEach((t) => {
            const k = pinKey(rule.accountId, t);
            if (have.has(k) || !ruleMatches(rule, t)) return;
            have.add(k);
            add.push({ key: k, accountId: rule.accountId, accountName: rule.accountName, date: t.date, amount: Math.abs(Number(t.amount) || 0), desc: descOf(t), cat: rule.cat, at: new Date().toISOString(), rule: rule.id });
          });
        }
        if (add.length && !dead) updRef.current(r.id, { qbPins: [...(r.qbPins || []), ...add] });
      }
    })();
    return () => { dead = true; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
}
