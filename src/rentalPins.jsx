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
import { mLabel, pinMonth, addMonths, monthsBetween, validSplit } from "./rentalsPL";
import { forMonth } from "./platinumLive.js";

const ALL_ACCTS = { id: "__all__", name: "All bank & credit-card accounts", classification: "Asset", type: "Bank", all: true };
export const PIN_CATS = ["Mortgage", "Insurance", "Property taxes", "Utilities", "Repairs & maintenance", "HOA", "Other expenses", "Other income"];
// Income a tenant paid straight to Elie (Elie 10/6/26) pins as "Rent – <unit>"
// on multi-unit rentals (same rows as Platinum's), else "Rent" — see rentCatsFor.
export const pinKey = (accountId, t) => `${accountId}|${t.lineKey || t.id || `${t.date}|${t.amount}`}`;
const guessCat = (acct, rentCats) => {
  const s = `${acct?.name || ""} ${acct?.type || ""} ${acct?.subType || ""}`.toLowerCase();
  if (acct?.classification === "Revenue" || acct?.classification === "Income" || /rent|income/.test(s)) return (rentCats && rentCats[0] && rentCats[0].cat) || "Rent";
  if (/mortgage|loan|note|debt/.test(s) || acct?.classification === "Liability" && !/credit ?card/.test(s)) return "Mortgage";
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
  // Search by QuickBooks PROJECT too (Elie 10/7/26) — every line QuickBooks
  // put on that project (Debt service, Repairs…), like the flip houses' QB tab.
  const [fresh, setFresh] = useState(0);
  const [mode, setMode] = useState("acct");
  const [projects, setProjects] = useState(null);
  const [proj, setProj] = useState(null);
  useEffect(() => {
    if (mode !== "proj" || projects) return;
    qbAuthFetch("/api/quickbooks/projects").then((d) => {
      const items = (d.items || []).sort((a, b) => (b.isProject - a.isProject) || String(a.name).localeCompare(String(b.name)));
      setProjects(items);
      const linked = rental.qbProjectId || (rental.units || []).map((u) => u.qbProjectId).find(Boolean);
      const num = String(rental.address || "").match(/^\d+/)?.[0];
      const guess = items.find((x) => String(x.id) === String(linked)) || (num ? items.find((x) => x.isProject && new RegExp(`(^|[^\\d])${num}([^\\d]|$)`).test(x.name)) : null);
      if (guess) setProj(guess);
    }).catch((e) => setErr(e.message || "Couldn't reach QuickBooks."));
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode !== "proj" || !proj) return;
    setTxns(null); setPicked(new Set()); setErr(""); setAuto(false);
    let dead = false;
    const a = { id: `proj:${proj.id}`, name: proj.name, proj: true };
    qbAuthFetch(`/api/quickbooks/transactions?customerId=${encodeURIComponent(proj.id)}${fresh ? "&fresh=1" : ""}`)
      .then((d) => { if (!dead) setTxns((d.items || []).map((t) => ({ ...t, date: normDate(t.date), _acct: a }))); })
      .catch(() => { if (!dead) setErr("Couldn't load that project."); });
    return () => { dead = true; };
  }, [mode, proj && proj.id, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = mode === "proj" ? proj : acct;
  useEffect(() => {
    qbAuthFetch("/api/quickbooks/accounts?class=All").then((d) => setAccounts(d.items || [])).catch((e) => setErr(e.message || "Couldn't reach QuickBooks."));
  }, []);
  // One account, or (Elie 10/6/26 — the loan account only held the opening
  // journal entry; the payments come out of a bank account) every bank and
  // credit-card account at once. Each line remembers its own account.
  useEffect(() => {
    if (!acct || mode !== "acct") return;
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
  }, [acct && acct.id, fresh, mode]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const shown0 = (txns || []).filter((t) => (allDates || (t.date.slice(0, 7) >= from && t.date.slice(0, 7) <= to)) && (!q || `${t.vendor} ${t.memo} ${t.type} ${t.amount} ${t.account || ""}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.date.localeCompare(a.date));
  const shown = shown0.slice(0, 300);
  const toggle = (k) => {
    // Project lines: the first one picked suggests the category from its QB account ("Debt Service" → Mortgage).
    if (mode === "proj" && !picked.size) { const t0 = (txns || []).find((x) => pinKey(x._acct.id, x) === k); if (t0 && t0.account) setCat(guessCat({ name: t0.account, classification: /income/i.test(t0.section || "") ? "Revenue" : "Expense" }, rentCats)); }
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
    const newPins = chosen.map((t) => ({ key: pinKey(t._acct.id, t), accountId: t._acct.id, accountName: t._acct.proj && t.account ? `${t._acct.name} · ${t.account}` : t._acct.name, date: t.date, amount: Math.abs(Number(t.amount) || 0), desc: descOf(t), cat, at, ...(ruleId ? { rule: ruleId } : {}) }));
    const patch = { qbPins: [...(rental.qbPins || []).filter((p) => !newPins.some((n) => n.key === p.key)), ...newPins] };
    if (ruleId && mode === "acct") {
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
    <Sheet title="Pin from QuickBooks" sub={`${rental.address} · transactions from any QuickBooks account or project`} isMobile={isMobile} onClose={onClose}>
      {err && <div style={{ fontSize: 13.5, color: T.red, margin: "0 4px 8px" }}>{err}</div>}
      <div style={{ display: "inline-flex", background: "rgba(118,118,128,0.12)", borderRadius: 17, padding: 2, marginBottom: 4 }} role="tablist" aria-label="Search by">
        {[["acct", "By account"], ["proj", "By project"]].map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setTxns(null); setPicked(new Set()); setErr(""); setFresh(0); }} style={{ minHeight: 32, padding: "0 14px", border: "none", borderRadius: 15, background: mode === k ? T.card : "transparent", boxShadow: mode === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none", fontSize: 13.5, fontWeight: 600, color: mode === k ? T.text : "#3A3A3C", cursor: "pointer", fontFamily: "inherit" }}>{l}</button>)}
      </div>
      {mode === "proj" && <>
        <div style={lab}>Project</div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={proj ? proj.id : ""} onChange={(e) => { setFresh(0); setProj((projects || []).find((x) => String(x.id) === e.target.value) || null); }} aria-label="QuickBooks project" style={{ ...sel, flex: 1 }}>
            <option value="">{projects ? "Choose a project…" : "Loading projects…"}</option>
            {projects && projects.some((x) => x.isProject) && <optgroup label="Projects">{projects.filter((x) => x.isProject).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
            {projects && <optgroup label="Customers">{projects.filter((x) => !x.isProject).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
          </select>
          {proj && <button onClick={() => setFresh((x) => x + 1)} title="Reload from QuickBooks" aria-label="Reload from QuickBooks" style={{ width: 44, minHeight: 44, borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, fontSize: 17, cursor: "pointer", color: T.text }}>↻</button>}
        </div>
      </>}
      {mode === "acct" && <div style={lab}>Account</div>}
      {mode === "acct" && <div style={{ display: "flex", gap: 8 }}>
        <select value={acct ? acct.id : ""} onChange={(e) => { setFresh(0); setAcct(e.target.value === "__all__" ? ALL_ACCTS : (accounts || []).find((a) => a.id === e.target.value) || null); }} aria-label="QuickBooks account" style={{ ...sel, flex: 1 }}>
          <option value="">{accounts ? "Choose an account…" : "Loading accounts…"}</option>
          {accounts && <option value="__all__">🔍 All bank &amp; credit-card accounts</option>}
          {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
        </select>
        {acct && <button onClick={() => setFresh((x) => x + 1)} title="Reload from QuickBooks" aria-label="Reload from QuickBooks" style={{ width: 44, minHeight: 44, borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, fontSize: 17, cursor: "pointer", color: T.text }}>↻</button>}
      </div>}
      {src && <>
        <div style={lab}>
          <span style={{ flex: 1 }}>Transactions · {allDates ? "all dates" : (from === to ? mLabel(from, "long") : `${mLabel(from)} – ${mLabel(to)} ${to.slice(0, 4)}`)}</span>
          <button onClick={() => setAllDates((v) => !v)} style={{ border: "none", background: "none", color: T.blue, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", minHeight: 30 }}>{allDates ? "Only this period" : "Show all dates"}</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, memo or amount" aria-label="Search transactions" style={{ ...sel, minHeight: 38, marginBottom: 8, background: "rgba(118,118,128,0.12)", border: "none" }} />
        <div style={{ background: T.card, borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}`, maxHeight: 320, overflowY: "auto" }}>
          {!txns && !err && <div style={{ padding: 14, fontSize: 13.5, color: T.textSub }}>Loading from QuickBooks…</div>}
          {txns && shown0.length > 300 && <div style={{ padding: "8px 14px", fontSize: 12.5, color: T.textSub, borderBottom: `1px solid ${T.border}` }}>Showing the newest 300 of {shown0.length} — search to narrow it down.</div>}
          {txns && shown.length === 0 && <div style={{ padding: 14, fontSize: 13.5, color: T.textSub }}>No transactions{allDates ? "" : " in this period — tap Show all dates"}.</div>}
          {txns && mode === "acct" && !acct.all && txns.length <= 2 && guessCat(acct) === "Mortgage" && <div style={{ padding: "10px 14px", fontSize: 13, color: "#8a6d1f", background: "#FDF9EE", borderBottom: `1px solid ${T.border}` }}>Only {txns.length} transaction{txns.length === 1 ? "" : "s"} in this account. If the monthly payments come out of a bank account, <button onClick={() => { setAcct(ALL_ACCTS); setAllDates(true); setQ("mortgage"); }} style={{ border: "none", background: "none", color: T.blue, fontWeight: 650, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>search all bank &amp; card accounts for “mortgage”</button> (or the lender's name).</div>}
          {shown.map((t, i) => {
            const k = pinKey(t._acct.id, t), already = pinned.has(k), on = already || picked.has(k);
            return (
              <button key={k} disabled={already} onClick={() => toggle(k)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 46, padding: "8px 14px", border: "none", borderTop: i ? `1px solid ${T.border}` : "none", background: "none", cursor: already ? "default" : "pointer", fontFamily: "inherit", textAlign: "left", opacity: already ? 0.55 : 1 }}>
                <span style={{ width: 22, height: 22, borderRadius: 11, border: `1.5px solid ${on ? T.gold : "#C7C7CC"}`, background: on ? T.gold : "transparent", color: "#fff", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on ? "✓" : ""}</span>
                <span style={{ width: 54, fontSize: 13, color: T.textSub, flexShrink: 0 }}>{dshort(t.date)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: T.text }}>{descOf(t)}{mode === "acct" && acct.all ? <span style={{ display: "block", fontSize: 12, color: T.textSub }}>{t._acct.name}</span> : null}{mode === "proj" && t.account ? <span style={{ display: "block", fontSize: 12, color: T.textSub }}>{t.account}</span> : null}{already && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "1px 6px", background: "#FDF9EE", color: "#8a6d1f", border: "1px solid #EAD9A9" }}>ALREADY IN</span>}</span>
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
        {mode === "acct" && <button onClick={() => setAuto((v) => !v)} role="switch" aria-checked={auto} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 56, marginTop: 10, padding: "8px 14px", borderRadius: 14, border: `1px solid ${T.border}`, background: T.card, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 15, fontWeight: 650, color: T.text }}>Keep pinning new ones automatically</span><span style={{ display: "block", fontSize: 12.5, color: T.textSub }}>{acct.classification === "Liability" && acct.type !== "Credit Card" ? "every new payment from this account lands here by itself" : "new ones from the same payee in this account land here by themselves"}</span></span>
          <span style={{ width: 50, height: 30, borderRadius: 15, background: auto ? "#34C759" : "#E9E9EB", position: "relative", flexShrink: 0, transition: "background .15s" }}><span style={{ position: "absolute", top: 2, left: auto ? 22 : 2, width: 26, height: 26, borderRadius: 13, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left .15s" }} /></span>
        </button>}
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
  const [splitting, setSplitting] = useState(null); // hooks before the early return below
  const rules = rental.qbPinRules || [];
  const pins = [...(rental.qbPins || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!rules.length && !pins.length) return null;
  const loose = pins.filter((p) => !p.rule || !rules.some((r) => r.id === p.rule));
  const shown = all ? loose : loose.slice(0, 6);
  // "For" month (Elie 10/6/26): which month a pinned line counts toward —
  // or "Split across months…" for one deposit that covers several.
  const setMonth = (p, ym) => {
    if (ym === "__split") { setSplitting(p); return; }
    onSave({ qbPins: (rental.qbPins || []).map((x) => (x.key === p.key ? { ...x, forYm: ym || undefined, split: undefined } : x)) });
  };
  const saveSplit = (p, split) => { onSave({ qbPins: (rental.qbPins || []).map((x) => (x.key === p.key ? { ...x, split: split || undefined, forYm: undefined } : x)) }); setSplitting(null); };
  const monthPick = (p) => {
    const auto = forMonth(p), cur = pinMonth(p), d = String(p.date).slice(0, 7);
    const isSplit = validSplit(p);
    const opts = monthsBetween(addMonths(d, -24), addMonths(d, 12)).reverse();
    if (cur && !opts.includes(cur)) opts.push(cur);
    const lbl = (ym) => `${mLabel(ym)} ${ym.slice(0, 4)}`;
    const on = isSplit || !!p.forYm;
    return (
      <label title="Which month this counts for" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 3, minHeight: 30, padding: "0 10px", borderRadius: 15, background: on ? "#FDF9EE" : "rgba(118,118,128,0.12)", border: on ? "1px solid #EAD9A9" : "1px solid transparent", color: on ? "#8a6d1f" : T.text, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0 }}>
        {isSplit ? `Split · ${p.split.length} months` : `For ${lbl(cur)}`} <span style={{ fontSize: 10, opacity: 0.7 }}>▼</span>
        <select aria-label="Counts for month" value={isSplit ? "__split" : p.forYm || ""} onChange={(e) => setMonth(p, e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", fontSize: 16 }}>
          <option value="">Automatic · {lbl(auto)}</option>
          <option value="__split">{isSplit ? "Edit the split…" : "Split across months…"}</option>
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
      {splitting && <SplitSheet pin={splitting} rental={rental} onSave={(split) => saveSplit(splitting, split)} onClose={() => setSplitting(null)} />}
    </div>
  );
}

// ✂️ Split one pinned deposit across several months (Elie 10/6/26). Starts
// with the unit's monthly rent going back from the payment's month (the rest
// on the oldest), or half and half; must add up to the deposit.
const unitKeyOf = (s) => { const t = String(s || "").trim().toLowerCase(); let m = t.match(/#\s*([\w-]+)/); if (m) return m[1]; m = t.match(/^(?:unit|apt)\.?\s*([\w-]+)/); if (m) return m[1]; return t.split(/\s+/)[0] || ""; };
function rentHint(rental, cat) {
  const units = rental.units || [];
  const num = (v) => Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0;
  if (String(cat).startsWith("Rent – ")) { const k = unitKeyOf(cat.slice(7)); const u = units.find((x) => unitKeyOf(x.label) === k); return u ? num(u.rent) : 0; }
  if (/^Rent\b/.test(cat || "") && units.length === 1) return num(units[0].rent);
  return 0;
}
export function SplitSheet({ pin, rental, onSave, onClose }) {
  const total = Math.round(Math.abs(Number(pin.amount) || 0) * 100) / 100;
  const start = pinMonth(pin), d = String(pin.date).slice(0, 7);
  const [rows, setRows] = useState(() => {
    if (validSplit(pin)) return pin.split.map((x) => ({ ym: x.ym, amount: String(x.amount) }));
    const rent = rentHint(rental, pin.cat);
    if (rent > 0 && total > rent + 0.5) {
      const out = []; let left = total, ym = start;
      // Back pay fills the months before the payment; a prepayment (pin.forward) the months after.
      while (left > 0.004 && out.length < 24) { const x = left - rent < rent * 0.25 && out.length ? left : Math.min(left, rent); const row = { ym, amount: (Math.round(x * 100) / 100).toFixed(2) }; if (pin.forward) out.push(row); else out.unshift(row); left = Math.round((left - x) * 100) / 100; ym = addMonths(ym, pin.forward ? 1 : -1); }
      return out;
    }
    const half = Math.round((total / 2) * 100) / 100;
    return [{ ym: addMonths(start, -1), amount: half.toFixed(2) }, { ym: start, amount: (total - half).toFixed(2) }];
  });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 700;
  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  const left = Math.round((total - sum) * 100) / 100;
  const ok = Math.abs(left) < 0.01 && rows.every((r) => Number(r.amount) > 0);
  const opts = monthsBetween(addMonths(d, -36), addMonths(d, 12)).reverse();
  const lbl = (ym) => `${mLabel(ym)} ${ym.slice(0, 4)}`;
  const upd = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const even = () => setRows((rs) => { const n = rs.length; const each = Math.floor((total / n) * 100) / 100; return rs.map((r, i) => ({ ...r, amount: (i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each).toFixed(2) })); });
  const addRow = () => setRows((rs) => { const first = rs.map((r) => r.ym).sort()[0] || start; return [{ ym: addMonths(first, -1), amount: left > 0 ? left.toFixed(2) : "" }, ...rs]; });
  const save = () => {
    const m = new Map();
    rows.forEach((r) => m.set(r.ym, Math.round(((m.get(r.ym) || 0) + Number(r.amount)) * 100) / 100));
    const split = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, amount]) => ({ ym, amount }));
    onSave(split.length > 1 ? split : null);
  };
  const field = { minHeight: 44, borderRadius: 10, border: `1px solid ${T.border}`, background: T.card, padding: "0 10px", fontSize: 16, fontFamily: "inherit", color: T.text, boxSizing: "border-box" };
  const pill = (primary, dis) => ({ minHeight: 44, padding: "0 16px", borderRadius: 22, border: "none", background: primary ? "#B8953F" : "rgba(118,118,128,0.12)", color: primary ? "#fff" : T.text, fontSize: 15, fontWeight: 650, fontFamily: "inherit", cursor: dis ? "default" : "pointer", opacity: dis ? 0.5 : 1 });
  return (
    <Sheet title="Split across months" sub={`${dshort(pin.date)} · ${pin.desc || ""} · ${money(total)}`} onClose={onClose} isMobile={isMobile}>
      <div style={{ fontSize: 13, color: T.textSub, margin: "0 2px 10px" }}>How much of this deposit was for each month. It counts toward those months in the P&amp;L and the delinquency report.</div>
      <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: "4px 12px" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: i ? `1px solid ${T.border}` : "none" }}>
            <select aria-label={`Month ${i + 1}`} value={r.ym} onChange={(e) => upd(i, "ym", e.target.value)} style={{ ...field, flex: 1, minWidth: 0 }}>
              {(opts.includes(r.ym) ? opts : [r.ym, ...opts]).map((ym) => <option key={ym} value={ym}>{lbl(ym)}</option>)}
            </select>
            <div style={{ position: "relative", width: 132, flexShrink: 0 }}>
              <span style={{ position: "absolute", left: 10, top: 12, color: T.textSub, fontSize: 15 }}>$</span>
              <input aria-label={`Amount ${i + 1}`} inputMode="decimal" value={r.amount} onChange={(e) => upd(i, "amount", e.target.value.replace(/[^\d.]/g, ""))} style={{ ...field, width: "100%", paddingLeft: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
            </div>
            <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length < 2} aria-label="Remove month" style={{ width: 36, height: 44, border: "none", background: "none", color: T.textTert, fontSize: 16, cursor: rows.length < 2 ? "default" : "pointer", opacity: rows.length < 2 ? 0.3 : 1 }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
        <button onClick={addRow} style={{ ...pill(false), minHeight: 36, fontSize: 13.5 }}>＋ Add month</button>
        <button onClick={even} style={{ ...pill(false), minHeight: 36, fontSize: 13.5 }}>Split evenly</button>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, margin: "4px 2px 12px", color: Math.abs(left) < 0.01 ? "#248A3D" : "#D70015" }}>
        {Math.abs(left) < 0.01 ? `✓ Adds up to ${money(total)}` : left > 0 ? `${money(left)} still to assign (of ${money(total)})` : `${money(-left)} too much (deposit is ${money(total)})`}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {validSplit(pin) && <button onClick={() => onSave(null)} style={{ ...pill(false), flex: 1 }}>Don't split</button>}
        <button onClick={ok ? save : undefined} disabled={!ok} style={{ ...pill(true, !ok), flex: 2 }}>Save split</button>
      </div>
    </Sheet>
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
