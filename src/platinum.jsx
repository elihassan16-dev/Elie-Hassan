// 🏢 Platinum Management (AppFolio) on Rental Portfolio — approved 10/5/26.
// Elie's Cowork (skill goldstone-appfolio) opens the AppFolio owner portal
// Monday + Thursday mornings, downloads the owner statement and uploads it
// here; appfolio.js reads it. View-only — Esti books these numbers in
// QuickBooks, so nothing here touches the rental ledgers.
// Stored in ONE app_settings row "appfolio" {statements[], links{}, checkedAt,
// checkedBy}, read directly (kept out of the shared settings sync — it's big
// and only this page needs it).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthProvider";
import { parseAppfolioPdf, matchRental } from "./appfolio";

const ROW = "appfolio";
const KEEP = 12;
let cache = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());
async function loadRow() {
  const { data, error } = await supabase.from("app_settings").select("data").eq("id", ROW).maybeSingle();
  if (error) throw error;
  cache = (data && data.data) || { statements: [], links: {} };
  emit();
  return cache;
}
async function saveRow(patchFn) {
  let cur = cache;
  try { cur = await loadRow(); } catch { /* write over what we have */ }
  const next = { statements: [], links: {}, ...(cur || {}), ...patchFn(cur || { statements: [], links: {} }) };
  const { error } = await supabase.from("app_settings").upsert({ id: ROW, data: next, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache = next; emit();
  return next;
}

export function usePlatinum() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    loadRow().catch(() => {});
    return () => subs.delete(f);
  }, []);
  const row = cache || { statements: [], links: {} };
  const statements = [...(row.statements || [])].sort((a, b) => String(b.to).localeCompare(String(a.to)) || String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  const latest = statements[0] || null;
  const links = row.links || {};
  const rentalFor = (prop, rentals) => {
    const id = links[prop.key];
    if (id) return (rentals || []).find((r) => String(r.id) === String(id)) || null;
    return matchRental(prop.name, rentals);
  };
  // Latest statement data for one rental (+ the newest rent roll for it).
  const viewFor = (rental, rentals) => {
    if (!rental) return null;
    for (const s of statements) {
      const prop = (s.props || []).find((p) => !p.rollOnly && String(rentalFor(p, rentals)?.id) === String(rental.id));
      if (prop) {
        let units = prop.units || [];
        if (!units.length) {
          for (const s2 of statements) { const p2 = (s2.props || []).find((p) => p.key === prop.key && (p.units || []).length); if (p2) { units = p2.units; break; } }
        }
        return { stmt: s, prop, units };
      }
    }
    return null;
  };
  return { loaded: !!cache, row, statements, latest, links, rentalFor, viewFor, reload: loadRow, save: saveRow };
}

// ── formatting ──
const money = (v, cents = true) => {
  const n = Number(v) || 0;
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${n < 0 ? "−" : ""}$${s}`;
};
const signed = (v, cents = true) => `${(Number(v) || 0) > 0 ? "+" : ""}${money(v, cents)}`;
const dshort = (iso) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const dlong = (iso) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
const period = (s) => (s ? `${dshort(s.from)} – ${dlong(s.to)}` : "");
const whenAgo = (iso) => {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d)) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days < 1 && d.getDate() === new Date().getDate()) return `today ${t}`;
  if (days < 6) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${t}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const RED = "#D70015", GREEN = "#248A3D";
const chipS = (kind) => ({
  display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 7, padding: "2px 7px", marginRight: 5, marginTop: 3, whiteSpace: "nowrap",
  ...(kind === "red" ? { background: "#FFE9E7", color: "#C4170C" } : kind === "orange" ? { background: "#FFF1E0", color: "#B45309" } : { background: "#E8F7EC", color: "#1F7A36" }),
});
const pastDueOf = (units) => (units || []).reduce((t, u) => t + (u.pastDue > 0 ? u.pastDue : 0), 0);
const isRent = (t) => /rent/i.test(t.desc || "") && !/prepay/i.test(t.desc || "") && t.cashIn > 0;

// Chips for a rental row in the list.
export function PlatinumChips({ view }) {
  if (!view) return null;
  const due = pastDueOf(view.units);
  const ahead = (view.units || []).some((u) => u.pastDue < 0);
  const remit = view.prop.summary?.remit;
  return (
    <div style={{ marginTop: 2 }}>
      {due > 0 && <span style={chipS("red")}>{money(due, false)} past due</span>}
      {!due && ahead && <span style={chipS("green")}>Paid ahead</span>}
      {remit > 0 && <span style={chipS("orange")}>Send {money(remit, false)}</span>}
    </div>
  );
}

// ── top card on Rental Portfolio ──
export function PlatinumCard({ rentals, onOpen, isMobile }) {
  const plat = usePlatinum();
  const { displayName } = useAuth() || {};
  const fileRef = useRef(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const s = plat.latest;
  const upload = async (files) => {
    const list = [...(files || [])].filter(Boolean);
    if (!list.length) return;
    setErr(""); let last = null;
    try {
      for (const f of list) {
        setBusy(`Reading ${f.name}…`);
        const parsed = await parseAppfolioPdf(await f.arrayBuffer());
        setBusy("Saving…");
        const rnd = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, "").slice(0, 16);
        const path = `appfolio/${parsed.to || "statement"}-${rnd}.pdf`;
        const { error } = await supabase.storage.from("attachments").upload(path, f, { contentType: "application/pdf", upsert: false });
        if (error) throw error;
        const { data } = supabase.storage.from("attachments").getPublicUrl(path);
        const stmt = { ...parsed, id: `${parsed.from}_${parsed.to}`, fileName: f.name, pdfUrl: data.publicUrl, uploadedAt: new Date().toISOString(), uploadedBy: displayName || "" };
        const isNew = !(plat.statements || []).some((x) => x.id === stmt.id);
        await plat.save((cur) => ({
          statements: [...(cur.statements || []).filter((x) => x.id !== stmt.id), stmt].sort((a, b) => String(b.to).localeCompare(String(a.to))).slice(0, KEEP),
          checkedAt: new Date().toISOString(), checkedBy: displayName || "",
        }));
        last = { stmt, isNew };
      }
      setResult(last);
    } catch (e) { setErr(e.message || "Couldn't read that statement."); }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
  };
  const markChecked = async () => {
    setErr("");
    try { await plat.save(() => ({ checkedAt: new Date().toISOString(), checkedBy: displayName || "" })); } catch (e) { setErr(e.message || "Couldn't save."); }
  };

  const props = (s && s.props || []).filter((p) => !p.rollOnly);
  const sum = s ? (Object.keys(s.summary || {}).length ? s.summary : props.reduce((t, p) => { Object.entries(p.summary || {}).forEach(([k, v]) => { t[k] = (t[k] || 0) + v; }); return t; }, {})) : {};
  const checkedAt = plat.row.checkedAt;
  const stale = checkedAt && Date.now() - new Date(checkedAt).getTime() > 5 * 86400000;
  // Needs attention
  const attn = [];
  if (s) {
    const behind = [];
    props.forEach((p) => {
      const r = plat.rentalFor(p, rentals);
      const v = plat.viewFor(r, rentals);
      (v ? v.units : p.units || []).forEach((u) => { if (u.pastDue > 0) behind.push({ ...u, rental: r }); });
    });
    if (behind.length) {
      const tot = behind.reduce((t, u) => t + u.pastDue, 0);
      attn.push({ icon: "💸", bg: "#FFE9E7", title: `${behind.length} tenant${behind.length > 1 ? "s" : ""} behind — ${money(tot, false)}`, sub: behind.sort((a, b) => b.pastDue - a.pastDue).map((u) => `${u.tenant || u.unit || "Tenant"} ${money(u.pastDue, false)}`).join(" · "), rental: behind.length === 1 ? behind[0].rental : null });
    }
    props.forEach((p) => {
      const r = plat.rentalFor(p, rentals);
      if (p.summary?.remit > 0) attn.push({ icon: "🧾", bg: "#FFE9E7", title: `Platinum asks you to send ${money(p.summary.remit)}`, sub: `${p.name} — bills are more than the cash there`, rental: r });
      (p.bills || []).forEach((b) => {
        const age = (new Date(s.to + "T00:00:00") - new Date(b.due + "T00:00:00")) / 86400000;
        if (b.amount >= 500 && age >= 60) attn.push({ icon: "🔨", bg: "#FFF1E0", title: `${b.payee.replace(/\s+LLC$/i, "")} ${money(b.amount, false)} unpaid`, sub: `${p.name} · due since ${dlong(b.due)}`, rental: r });
      });
    });
    const rentTx = props.flatMap((p) => (p.transactions || []).filter(isRent));
    if (rentTx.length) {
      const dates = rentTx.map((t) => t.date).sort();
      const a = dshort(dates[0]), b = dshort(dates[dates.length - 1]);
      attn.push({ icon: "💵", bg: "#E8F7EC", title: `Rent came in — ${money(rentTx.reduce((t, x) => t + x.cashIn, 0), false)}`, sub: `${rentTx.length} payment${rentTx.length > 1 ? "s" : ""} this statement · ${a}${b !== a ? ` – ${b}` : ""}`, rental: null });
    }
  }
  const unmatched = props.filter((p) => !plat.rentalFor(p, rentals));

  const capBtn = (primary) => ({ minHeight: 36, padding: "0 14px", borderRadius: 18, border: primary ? "none" : `1px solid ${T.border}`, background: primary ? T.gold : T.card, color: primary ? "#fff" : T.text, fontWeight: 650, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });
  const stat = (label, val, red) => (
    <div style={{ flex: 1, minWidth: 0, background: T.bg, borderRadius: 12, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: T.textSub, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 750, color: red ? RED : T.text, fontVariantNumeric: "tabular-nums" }}>{val}</div>
    </div>
  );
  return (
    <>
      <div style={{ background: T.card, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: "13px 14px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: T.goldLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🏢</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: T.text }}>Platinum Management</div>
            <div style={{ fontSize: 12, color: stale ? "#B45309" : T.textSub }}>
              {s ? `${props.length} propert${props.length === 1 ? "y" : "ies"} · ${period(s)}` : "AppFolio owner statements"}
              {checkedAt ? ` · ${stale ? "Cowork hasn't checked since" : "checked"} ${whenAgo(checkedAt)}` : ""}
            </div>
          </div>
        </div>
        {s && <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
          {stat("Cash they hold", money(sum.ending, false))}
          {stat("Unpaid bills", money(Math.abs(sum.unpaidBills || 0), false), (sum.unpaidBills || 0) < 0)}
          {stat("Owed to you", money(sum.netOwnerFunds, false), (sum.netOwnerFunds || 0) < 0)}
        </div>}
        {!s && plat.loaded && <div style={{ fontSize: 13, color: T.textSub, marginTop: 10, lineHeight: 1.45 }}>Upload an owner statement PDF from the AppFolio owner portal — or let Cowork do it Monday and Thursday mornings. Rent, past-due tenants, unpaid bills and what Platinum holds show up here.</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={!!busy} style={capBtn(true)}>{busy || "⬆ Upload"}</button>
          {plat.statements.length > 0 && <button onClick={() => setListOpen(true)} style={capBtn(false)}>📄 Statements</button>}
          <button onClick={markChecked} style={capBtn(false)} title="Cowork taps this when the portal has nothing new">✓ Checked</button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => upload(e.target.files)} aria-label="Upload Platinum statement" />
        </div>
        {err && <div style={{ fontSize: 13, color: RED, marginTop: 8 }}>{err}</div>}
        {unmatched.length > 0 && rentals.length > 0 && <div style={{ marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 9 }}>
          {unmatched.map((p) => (
            <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub, marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 140 }}>Which rental is <b style={{ color: T.text }}>{p.name}</b>?</span>
              <select value="" onChange={(e) => e.target.value && plat.save((cur) => ({ links: { ...(cur.links || {}), [p.key]: e.target.value } })).catch(() => {})} style={{ minHeight: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.card, fontSize: 13, padding: "0 8px", fontFamily: "inherit", color: T.text }}>
                <option value="">Link to…</option>
                {rentals.map((r) => <option key={r.id} value={r.id}>{r.address}</option>)}
              </select>
            </div>
          ))}
        </div>}
      </div>
      {attn.length > 0 && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.04em", margin: "4px 6px 6px" }}>Needs attention</div>
        <div style={{ background: T.card, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: "0 14px", marginBottom: 14 }}>
          {attn.map((a, i) => (
            <div key={i} onClick={() => a.rental && onOpen && onOpen(a.rental.id)} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: i ? `1px solid ${T.border}` : "none", cursor: a.rental ? "pointer" : "default", minHeight: 44 }}>
              <div style={{ width: 28, height: 28, borderRadius: 9, background: a.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{a.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{a.title}</div>
                <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.35 }}>{a.sub}</div>
              </div>
              {a.rental && <span style={{ color: "#C7C7CC", fontSize: 18, alignSelf: "center" }}>›</span>}
            </div>
          ))}
        </div>
      </>}
      {result && <ResultSheet result={result} rentals={rentals} plat={plat} isMobile={isMobile} onClose={() => setResult(null)} />}
      {listOpen && <StatementsSheet plat={plat} isMobile={isMobile} onClose={() => setListOpen(false)} />}
    </>
  );
}

function Sheet({ title, sub, onClose, isMobile, children }) {
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, width: isMobile ? "100%" : 520, maxHeight: isMobile ? "90vh" : "86vh", borderRadius: isMobile ? "28px 28px 0 0" : 24, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {isMobile && <div style={{ width: 36, height: 5, borderRadius: 3, background: "rgba(60,60,67,0.3)", margin: "8px auto 0", flexShrink: 0 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{title}</div>
            {sub && <div style={{ fontSize: 13, color: T.textSub }}>{sub}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, background: "rgba(118,118,128,0.12)", color: T.textSub, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✕</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "8px 16px calc(16px + env(safe-area-inset-bottom))" }}>{children}</div>
      </div>
    </div>, document.body);
}

function ResultSheet({ result, rentals, plat, isMobile, onClose }) {
  const s = result.stmt;
  const props = (s.props || []).filter((p) => !p.rollOnly);
  const th = { fontSize: 11, fontWeight: 700, color: T.textSub, padding: "8px 0 6px", textAlign: "right" };
  const td = { fontSize: 13, padding: "8px 0", borderTop: `1px solid ${T.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  return (
    <Sheet title={result.isNew ? "New Platinum statement" : "Statement updated"} sub={`${period(s)} · ${props.length} propert${props.length === 1 ? "y" : "ies"}`} isMobile={isMobile} onClose={onClose}>
      <div style={{ background: T.card, borderRadius: 16, padding: "2px 14px", border: `1px solid ${T.border}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>PROPERTY</th><th style={th}>IN</th><th style={th}>OUT</th><th style={th}>PAST DUE</th></tr></thead>
          <tbody>{props.map((p) => {
            const v = plat.viewFor(plat.rentalFor(p, rentals), rentals);
            const due = pastDueOf(v ? v.units : p.units);
            return (
              <tr key={p.key}>
                <td style={{ ...td, textAlign: "left", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                <td style={{ ...td, color: GREEN }}>{money(p.summary?.cashIn || 0, false)}</td>
                <td style={td}>{money(Math.abs(p.summary?.cashOut || 0), false)}</td>
                <td style={{ ...td, color: due > 0 ? RED : T.textSub }}>{due > 0 ? money(due, false) : "—"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 12.5, color: T.textSub, margin: "10px 4px 12px", lineHeight: 1.45 }}>Saved on Rental Portfolio. Esti books these in QuickBooks, so your monthly ledgers aren't changed.</div>
      <a href={s.pdfUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 24, background: "rgba(118,118,128,0.12)", color: T.text, fontWeight: 650, fontSize: 15, textDecoration: "none" }}>📄 Open statement PDF</a>
      <button onClick={onClose} style={{ width: "100%", marginTop: 8, minHeight: 48, borderRadius: 24, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
    </Sheet>
  );
}

function StatementsSheet({ plat, isMobile, onClose }) {
  return (
    <Sheet title="Platinum statements" sub="Newest first" isMobile={isMobile} onClose={onClose}>
      <div style={{ background: T.card, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
        {plat.statements.map((s, i) => (
          <a key={s.id} href={s.pdfUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: i ? `1px solid ${T.border}` : "none", textDecoration: "none", color: T.text, minHeight: 44 }}>
            <span style={{ fontSize: 18 }}>📄</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{period(s)}</div>
              <div style={{ fontSize: 12, color: T.textSub }}>{(s.props || []).filter((p) => !p.rollOnly).length} properties · added {whenAgo(s.uploadedAt)}{s.uploadedBy ? ` by ${String(s.uploadedBy).split(" ")[0]}` : ""}</div>
            </div>
            <span style={{ color: "#C7C7CC", fontSize: 18 }}>›</span>
          </a>
        ))}
      </div>
    </Sheet>
  );
}

// ── 🏢 Platinum tab inside a rental ──
export function PlatinumTab({ view }) {
  const { stmt, prop, units } = view;
  const S = prop.summary || {};
  const card = { background: T.card, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden", marginBottom: 14 };
  const sec = { fontSize: 12, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.04em", margin: "4px 6px 6px" };
  const kv = (label, v, color, bold) => (v == null ? null : (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0", fontVariantNumeric: "tabular-nums", fontWeight: bold ? 700 : 400, borderTop: bold ? `1px solid ${T.border}` : "none", marginTop: bold ? 4 : 0, paddingTop: bold ? 9 : 6 }}>
      <span style={{ color: T.text }}>{label}</span><span style={{ color: color || T.text }}>{label === "Cash in" ? signed(v) : money(v)}</span>
    </div>
  ));
  const billTot = (prop.bills || []).reduce((t, b) => t + b.amount, 0);
  const tx = [...(prop.transactions || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const asOf = units[0]?.asOf;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: T.textSub, margin: "0 6px 8px" }}>Managed by Platinum · statement {period(stmt)}</div>
      <div style={{ ...card, padding: "10px 14px" }}>
        {kv("Cash at start", S.beginning)}
        {kv("Cash in", S.cashIn, GREEN)}
        {kv("Cash out", S.cashOut)}
        {kv("Unpaid bills", S.unpaidBills, (S.unpaidBills || 0) < 0 ? RED : null)}
        {kv("Reserve they keep", S.reserve)}
        {kv("Tenant prepayments", S.prepayments)}
        {kv("Owed to you", S.netOwnerFunds, (S.netOwnerFunds || 0) < 0 ? RED : GREEN, true)}
        {S.remit > 0 && <div style={{ fontSize: 12.5, color: "#C4170C", fontWeight: 600, marginTop: 2 }}>Platinum asks you to send {money(S.remit)}</div>}
        {prop.income && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 6 }}>Net income this period: <b style={{ color: prop.income.net >= 0 ? GREEN : RED }}>{signed(prop.income.net)}</b> ({money(prop.income.totalIncome)} in − {money(prop.income.totalExpense)} expenses)</div>}
      </div>

      {units.length > 0 && <>
        <div style={sec}>Tenants{asOf ? ` · as of ${dshort(asOf)}` : ""}</div>
        <div style={card}>
          {units.map((u, i) => {
            const hap = (prop.transactions || []).find((t) => /subsidi|sec(tion)? ?8|hap/i.test(`${t.desc} ${t.ref}`) && (!u.unit || (t.desc || "").toLowerCase().includes(u.unit.toLowerCase().split(" ")[0])));
            return (
              <div key={i} style={{ padding: "11px 14px", borderTop: i ? `1px solid ${T.border}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <b style={{ fontSize: 14.5, flex: 1, minWidth: 0, color: T.text }}>{u.unit ? `${(u.unit.match(/^\d+[A-Za-z]?\b/) || [u.unit])[0]} · ` : ""}{u.tenant || "Vacant"}</b>
                  <span style={{ fontWeight: 650, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{money(u.rent, false)}/mo</span>
                </div>
                <div style={{ fontSize: 12, color: T.textSub }}>
                  {[hap ? `Section 8 pays ${money(hap.cashIn, false)}` : "", u.leaseTo ? `lease to ${dlong(u.leaseTo)}` : "", u.status && u.status !== "Current" ? u.status : ""].filter(Boolean).join(" · ")}
                </div>
                {u.pastDue > 0 && <span style={chipS("red")}>{money(u.pastDue)} past due</span>}
                {u.pastDue < 0 && <span style={chipS("green")}>Paid ahead {money(-u.pastDue, false)}</span>}
                {u.late > 0 && <span style={chipS("orange")}>Late {u.late}×</span>}
                {u.nsf > 0 && <span style={chipS("orange")}>Bounced {u.nsf}×</span>}
              </div>
            );
          })}
        </div>
      </>}

      {(prop.bills || []).length > 0 && <>
        <div style={sec}>Bills not paid yet · {money(billTot)}</div>
        <div style={card}>
          {[...prop.bills].sort((a, b) => b.amount - a.amount).map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 13 }}>
              <span style={{ color: T.textTert, width: 44, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{dshort(b.due)}</span>
              <span style={{ flex: 1, minWidth: 0, color: T.text }}>{b.payee.replace(/\s+LLC$/i, "")} — {b.desc}</span>
              <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{money(b.amount)}</span>
            </div>
          ))}
        </div>
      </>}

      {tx.length > 0 && <>
        <div style={sec}>Transactions this statement</div>
        <div style={card}>
          {tx.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 13 }}>
              <span style={{ color: T.textTert, width: 44, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{dshort(t.date)}</span>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ color: T.text }}>{t.payee}</span><br /><span style={{ color: T.textSub, fontSize: 12 }}>{t.desc}</span></span>
              <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums", color: t.cashIn ? GREEN : T.text }}>{t.cashIn ? signed(t.cashIn) : money(-t.cashOut)}</span>
            </div>
          ))}
        </div>
      </>}

      {stmt.pdfUrl && <a href={stmt.pdfUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 24, background: "rgba(118,118,128,0.12)", color: T.text, fontWeight: 650, fontSize: 15, textDecoration: "none", marginBottom: 8 }}>📄 Open statement PDF</a>}
    </div>
  );
}
