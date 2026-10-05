// 🏢 Platinum Management (AppFolio) on Rental Portfolio — approved 10/5/26.
// Two sources, both brought in by Elie's Cowork (skill goldstone-appfolio,
// Monday + Thursday mornings):
//   • LIVE numbers (platinumLive.js): Cowork reads the owner portal's
//     Dashboard + Transactions pages and pastes one JSON update — rent
//     collected vs due, cash in/out, every payment/expense, unpaid bills.
//     Drives "This month", "📈 Trends" and "Properties".
//   • The monthly PACKET PDF (appfolio.js): tenants' past-due balances (rent
//     roll), Platinum's remit requests — shown under "From the monthly packet".
// View-only — Esti books these numbers in QuickBooks, so nothing here touches
// the rental ledgers. Stored in ONE app_settings row "appfolio", read directly
// (kept out of the shared settings sync — it's big and only this page needs it).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthProvider";
import { parseAppfolioPdf, matchRental } from "./appfolio.js";
import { normalizeUpdate, applyUpdate, liveModel, propMonth, pct, monthLabel, monthOf } from "./platinumLive.js";

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
  const live = liveModel(row);
  const rentalFor = (prop, rentals) => {
    const id = links[prop.key];
    if (id) return (rentals || []).find((r) => String(r.id) === String(id)) || null;
    return matchRental(prop.name, rentals);
  };
  // Latest packet data for one rental (+ the newest rent roll for it).
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
  // Every Platinum property we know of (live dashboard, bills, transactions, packets).
  const liveProps = () => {
    const out = new Map();
    const add = (key, name) => { if (key && !out.has(key)) out.set(key, { key, name }); };
    if (live) {
      Object.values(live.latest.props || {}).forEach((p) => add(p.key, p.name));
      (live.latest.bills || []).forEach((b) => add(b.key, b.name));
      live.txns.forEach((t) => add(t.key, t.name));
    }
    statements.slice(0, 1).forEach((s) => (s.props || []).forEach((p) => !p.rollOnly && add(p.key, p.name)));
    return [...out.values()];
  };
  const liveKeyFor = (rental, rentals) => {
    if (!rental) return null;
    const p = liveProps().find((x) => String(rentalFor(x, rentals)?.id) === String(rental.id));
    return p ? p.key : null;
  };
  return { loaded: !!cache, row, statements, latest, links, live, rentalFor, viewFor, liveProps, liveKeyFor, reload: loadRow, save: saveRow };
}

// ── formatting ──
const money = (v, cents = true) => {
  const n = Number(v) || 0;
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${n < 0 ? "−" : ""}$${s}`;
};
const signed = (v, cents = true) => `${(Number(v) || 0) > 0 ? "+" : ""}${money(v, cents)}`;
const dshort = (iso) => { if (!iso) return ""; const d = new Date(String(iso).slice(0, 10) + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const dlong = (iso) => { if (!iso) return ""; const d = new Date(String(iso).slice(0, 10) + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
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
const shortName = (s) => String(s || "").replace(/\s+(Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Ter|Terrace|Pl|Place|Way|Wy)\.?$/i, "");
const RED = "#D70015", GREEN = "#248A3D", GOLD = "#B8953F", GRAY = "#8E8E93";
const chipS = (kind) => ({
  display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 7, padding: "2px 7px", marginRight: 5, marginTop: 3, whiteSpace: "nowrap",
  ...(kind === "red" ? { background: "#FFE9E7", color: "#C4170C" } : kind === "orange" ? { background: "#FFF1E0", color: "#B45309" } : kind === "blue" ? { background: "#E8F1FD", color: "#1D5FBF" } : { background: "#E8F7EC", color: "#1F7A36" }),
});
const pastDueOf = (units) => (units || []).reduce((t, u) => t + (u.pastDue > 0 ? u.pastDue : 0), 0);
const isRent = (t) => /rent/i.test(t.desc || "") && !/prepay/i.test(t.desc || "") && t.cashIn > 0;
const cardS = { background: T.card, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden", marginBottom: 12 };
const secS = { fontSize: 12, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.04em", margin: "12px 6px 6px" };

// Rent status chip for this month (live), e.g. "Oct not paid".
const rentChip = (p, ym) => {
  if (!p || !(p.rentDue > 0) || p.rentCollected == null) return null;
  const m = monthLabel(ym);
  if (p.rentCollected >= p.rentDue - 0.5) return <span style={chipS("green")}>{m} paid</span>;
  if (p.rentCollected > 0) return <span style={chipS("orange")}>{m} part paid</span>;
  return <span style={chipS("red")}>{m} not paid</span>;
};

// Chips for a rental row in the list.
export function PlatinumChips({ view, live, liveKey }) {
  const lp = live && liveKey ? (live.latest.props || {})[liveKey] : null;
  const due = view ? pastDueOf(view.units) : 0;
  const remit = view ? view.prop.summary?.remit : 0;
  if (!lp && !due && !remit) return null;
  return (
    <div style={{ marginTop: 2 }}>
      {rentChip(lp, live && live.month)}
      {due > 0 && <span style={chipS("red")}>{money(due, false)} past due</span>}
      {remit > 0 && <span style={chipS("orange")}>Send {money(remit, false)}</span>}
    </div>
  );
}

// ── tiny charts (one series each; tap/hover a bar or point for its value) ──
function BarChart({ data, color, fmt, label }) {
  const [hi, setHi] = useState(null);
  const W = 334, H = 108, top = 18, base = 88;
  const max = Math.max(1, ...data.map((d) => d.value || 0));
  const bw = Math.min(40, (W - 10) / Math.max(1, data.length) - 14);
  const step = (W - 10) / Math.max(1, data.length);
  const act = hi != null ? data[hi] : null;
  return (
    <div>
      <div style={{ height: 16, fontSize: 12, color: T.textSub, fontVariantNumeric: "tabular-nums" }}>{act ? <><b style={{ color: T.text }}>{act.long || act.label}</b> · {fmt(act.value)}{act.note ? ` · ${act.note}` : ""}</> : label}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", touchAction: "manipulation" }} onPointerLeave={() => setHi(null)}>
        <line x1="0" y1={base} x2={W} y2={base} stroke="#E5E5EA" />
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(3, ((d.value || 0) / max) * (base - top)) : 0;
          const x = 5 + i * step + (step - bw) / 2;
          return (
            <g key={d.label + i} onPointerEnter={() => setHi(i)} onClick={() => setHi(i)} style={{ cursor: "pointer" }}>
              <rect x={5 + i * step} y={0} width={step} height={H} fill="transparent" />
              {h > 0 && <path d={`M${x},${base} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} fill={color} opacity={d.partial ? 0.38 : hi == null || hi === i ? 1 : 0.55} />}
              <text x={x + bw / 2} y={H - 3} fontSize="10" fill={hi === i ? T.text : "#6E6E73"} textAnchor="middle" fontWeight={hi === i ? 700 : 400}>{d.label}{d.partial ? "*" : ""}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function LineChart({ points, fmt }) {
  const [hi, setHi] = useState(null);
  const W = 334, H = 92, top = 10, base = 70;
  if (points.length < 2) return <div style={{ fontSize: 12.5, color: T.textSub, padding: "6px 0" }}>The line starts after the second check.</div>;
  const max = Math.max(1, ...points.map((p) => p.value)), min = Math.min(...points.map((p) => p.value));
  const span = Math.max(1, max - Math.min(min, max * 0.5));
  const lo = max - span;
  const x = (i) => 8 + (i * (W - 16)) / (points.length - 1);
  const y = (v) => base - ((v - lo) / span) * (base - top);
  const act = hi != null ? points[hi] : points[points.length - 1];
  return (
    <div>
      <div style={{ height: 16, fontSize: 12, color: T.textSub, fontVariantNumeric: "tabular-nums" }}><b style={{ color: T.text }}>{act.label}</b> · {fmt(act.value)}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", touchAction: "manipulation" }} onPointerLeave={() => setHi(null)}>
        <line x1="0" y1={base + 6} x2={W} y2={base + 6} stroke="#E5E5EA" />
        {hi != null && <line x1={x(hi)} y1={top - 4} x2={x(hi)} y2={base + 6} stroke="#C7C7CC" strokeDasharray="3 3" />}
        <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke={T.text} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(hi != null ? hi : points.length - 1)} cy={y(act.value)} r="4.5" fill={T.text} stroke="#fff" strokeWidth="2" />
        {points.map((p, i) => <rect key={i} x={x(i) - (W / points.length) / 2} y={0} width={W / points.length} height={H} fill="transparent" onPointerEnter={() => setHi(i)} onClick={() => setHi(i)} />)}
        <text x="4" y={H - 2} fontSize="10" fill="#6E6E73">{points[0].label}</text>
        <text x={W - 4} y={H - 2} fontSize="10" fill="#6E6E73" textAnchor="end">{points[points.length - 1].label}</text>
      </svg>
    </div>
  );
}
const deltaTxt = (now, was, fmt, upIsBad) => {
  if (now == null || was == null) return null;
  const d = now - was;
  if (Math.abs(d) < 0.5) return <span style={{ color: T.textSub }}>no change</span>;
  const bad = upIsBad ? d > 0 : d < 0;
  return <span style={{ color: bad ? RED : GREEN }}>{d > 0 ? "↑" : "↓"} {fmt(Math.abs(d))}</span>;
};

// ── top card on Rental Portfolio ──
export function PlatinumCard({ rentals, onOpen, onAddRental, isMobile }) {
  const plat = usePlatinum();
  const { displayName } = useAuth() || {};
  const fileRef = useRef(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [tab, setTab] = useState("month");
  const s = plat.latest;
  const live = plat.live;
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
        }));
        last = { stmt, isNew };
      }
      setResult(last);
    } catch (e) { setErr(e.message || "Couldn't read that statement."); }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── packet "needs attention" (tenants behind, remit requests, old bills) ──
  const props = (s && s.props || []).filter((p) => !p.rollOnly);
  const packetAttn = [];
  if (s) {
    const behind = [];
    props.forEach((p) => {
      const r = plat.rentalFor(p, rentals);
      const v = plat.viewFor(r, rentals);
      (v ? v.units : p.units || []).forEach((u) => { if (u.pastDue > 0) behind.push({ ...u, rental: r }); });
    });
    if (behind.length) {
      const tot = behind.reduce((t, u) => t + u.pastDue, 0);
      packetAttn.push({ icon: "💸", bg: "#FFE9E7", title: `${behind.length} tenant${behind.length > 1 ? "s" : ""} behind — ${money(tot, false)}`, sub: behind.sort((a, b) => b.pastDue - a.pastDue).map((u) => `${u.tenant || u.unit || "Tenant"} ${money(u.pastDue, false)}`).join(" · "), rental: behind.length === 1 ? behind[0].rental : null });
    }
    props.forEach((p) => {
      const r = plat.rentalFor(p, rentals);
      if (p.summary?.remit > 0) packetAttn.push({ icon: "🧾", bg: "#FFE9E7", title: `Platinum asked you to send ${money(p.summary.remit)}`, sub: `${p.name} — bills were more than the cash there`, rental: r });
    });
  }
  // packet-only fallback: old unpaid bills + rent came in (when no live data yet)
  if (s && !live) {
    props.forEach((p) => {
      const r = plat.rentalFor(p, rentals);
      (p.bills || []).forEach((b) => {
        const age = (new Date(s.to + "T00:00:00") - new Date(b.due + "T00:00:00")) / 86400000;
        if (b.amount >= 500 && age >= 60) packetAttn.push({ icon: "🔨", bg: "#FFF1E0", title: `${b.payee.replace(/\s+LLC$/i, "")} ${money(b.amount, false)} unpaid`, sub: `${p.name} · due since ${dlong(b.due)}`, rental: r });
      });
    });
    const rentTx = props.flatMap((p) => (p.transactions || []).filter(isRent));
    if (rentTx.length) {
      const dates = rentTx.map((t) => t.date).sort();
      const a = dshort(dates[0]), b = dshort(dates[dates.length - 1]);
      packetAttn.push({ icon: "💵", bg: "#E8F7EC", title: `Rent came in — ${money(rentTx.reduce((t, x) => t + x.cashIn, 0), false)}`, sub: `${rentTx.length} payment${rentTx.length > 1 ? "s" : ""} this statement · ${a}${b !== a ? ` – ${b}` : ""}`, rental: null });
    }
  }
  const allProps = plat.liveProps();
  const unmatched = allProps.filter((p) => !plat.rentalFor(p, rentals));
  const lAll = live ? live.latest.all || {} : {};
  const nUnits = lAll.unitsTotal;
  const checkedAt = plat.row.checkedAt || (live && live.latest.at);
  const stale = checkedAt && Date.now() - new Date(checkedAt).getTime() > 5 * 86400000;

  const capBtn = (primary) => ({ minHeight: 36, padding: "0 13px", borderRadius: 18, border: primary ? "none" : `1px solid ${T.border}`, background: primary ? T.gold : T.card, color: primary ? "#fff" : T.text, fontWeight: 650, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });
  const segBtn = (on) => ({ flex: 1, minHeight: 34, border: "none", borderRadius: 17, background: on ? T.card : "transparent", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.12)" : "none", fontWeight: on ? 650 : 550, fontSize: 13, color: on ? T.text : "#3A3A3C", cursor: "pointer", fontFamily: "inherit" });
  const attnList = (items) => (
    <div style={{ ...cardS, padding: "0 14px" }}>
      {items.map((a, i) => (
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
  );

  return (
    <>
      <div style={{ ...cardS, padding: "13px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: T.goldLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🏢</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: T.text }}>Platinum Management</div>
            <div style={{ fontSize: 12, color: stale ? "#B45309" : T.textSub }}>
              {allProps.length ? `${allProps.length} propert${allProps.length === 1 ? "y" : "ies"}${nUnits ? ` · ${nUnits} units` : ""}` : "AppFolio owner portal"}
              {checkedAt ? ` · ${stale ? "Cowork hasn't checked since" : "checked"} ${whenAgo(checkedAt)}` : ""}
            </div>
          </div>
        </div>
        {live && <LiveHeadline live={live} statement={s} />}
        {!live && s && <PacketStats s={s} props={props} />}
        {!live && !s && plat.loaded && <div style={{ fontSize: 13, color: T.textSub, marginTop: 10, lineHeight: 1.45 }}>Cowork reads the AppFolio owner portal Monday and Thursday mornings and sends the numbers here: rent collected vs due, every payment and expense, unpaid bills, and the monthly packet.</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={() => setPasteOpen(true)} style={capBtn(true)}>🤖 Update</button>
          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={!!busy} style={capBtn(false)}>{busy || "⬆ Packet"}</button>
          {plat.statements.length > 0 && <button onClick={() => setListOpen(true)} style={capBtn(false)}>📄 Packets</button>}
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => upload(e.target.files)} aria-label="Upload Platinum statement" />
        </div>
        {err && <div style={{ fontSize: 13, color: RED, marginTop: 8 }}>{err}</div>}
      </div>

      {live && <div style={{ display: "flex", background: "rgba(118,118,128,0.12)", borderRadius: 20, padding: 3, marginBottom: 10 }}>
        {[["month", "This month"], ["trends", "📈 Trends"], ["props", "Properties"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={segBtn(tab === k)}>{l}</button>)}
      </div>}

      {live && tab === "month" && <LiveChanges live={live} rentals={rentals} plat={plat} onOpen={onOpen} />}
      {live && tab === "trends" && <TrendsView live={live} statements={plat.statements} />}
      {live && tab === "props" && <PropsTable live={live} plat={plat} rentals={rentals} onOpen={onOpen} onAddRental={onAddRental} />}

      {(tab === "month" || !live) && packetAttn.length > 0 && <>
        <div style={secS}>{live ? `From the monthly packet · ${period(s)}` : "Needs attention"}</div>
        {attnList(packetAttn)}
      </>}
      {(tab === "month" || !live) && unmatched.length > 0 && rentals.length > 0 && <div style={{ ...cardS, padding: "8px 14px 10px" }}>
        {unmatched.map((p) => (
          <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 140 }}><b style={{ color: T.text }}>{p.name}</b> isn't in Rental Portfolio yet</span>
            {onAddRental && <button onClick={() => onAddRental({ name: p.name, units: (live && (live.latest.props || {})[p.key]?.unitsTotal) || 1, key: p.key })} style={capBtn(false)}>＋ Add</button>}
            <select value="" onChange={(e) => e.target.value && plat.save((cur) => ({ links: { ...(cur.links || {}), [p.key]: e.target.value } })).catch(() => {})} style={{ minHeight: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.card, fontSize: 13, padding: "0 8px", fontFamily: "inherit", color: T.text }}>
              <option value="">or link to…</option>
              {rentals.map((r) => <option key={r.id} value={r.id}>{r.address}</option>)}
            </select>
          </div>
        ))}
      </div>}
      {result && <ResultSheet result={result} rentals={rentals} plat={plat} isMobile={isMobile} onClose={() => setResult(null)} />}
      {listOpen && <StatementsSheet plat={plat} isMobile={isMobile} onClose={() => setListOpen(false)} />}
      {pasteOpen && <UpdateSheet plat={plat} by={displayName} isMobile={isMobile} onClose={() => setPasteOpen(false)} />}
    </>
  );
}

function PacketStats({ s, props }) {
  const sum = Object.keys(s.summary || {}).length ? s.summary : props.reduce((t, p) => { Object.entries(p.summary || {}).forEach(([k, v]) => { t[k] = (t[k] || 0) + v; }); return t; }, {});
  const stat = (label, val, red) => (
    <div style={{ flex: 1, minWidth: 0, background: T.bg, borderRadius: 12, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: T.textSub, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 750, color: red ? RED : T.text, fontVariantNumeric: "tabular-nums" }}>{val}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
      {stat("Cash they hold", money(sum.ending, false))}
      {stat("Unpaid bills", money(Math.abs(sum.unpaidBills || 0), false), (sum.unpaidBills || 0) < 0)}
      {stat("Owed to you", money(sum.netOwnerFunds, false), (sum.netOwnerFunds || 0) < 0)}
    </div>
  );
}

// Rent bar + this month's cash in / expenses / unpaid bills.
function LiveHeadline({ live, statement }) {
  const a = live.latest.all || {};
  const mName = monthLabel(live.month, true);
  const p = pct(a.rentCollected || 0, a.rentDue || 0);
  const last = live.months[live.lastMonth];
  const sd = live.sameDayLast;
  const sdPct = sd && sd.all ? pct(sd.all.rentCollected || 0, sd.all.rentDue || 0) : null;
  const lastPct = last && last.all ? pct(last.all.rentCollected || 0, last.all.rentDue || 0) : null;
  const day = new Date(live.latest.at).getDate();
  const wasBills = live.prev ? live.prev.billsTotal : (statement && statement.summary && statement.summary.unpaidBills != null ? Math.abs(statement.summary.unpaidBills) : null);
  const wasWhen = live.prev ? `since ${whenAgo(live.prev.at)}` : statement ? `since ${dshort(statement.to)}` : "";
  const stat = (label, val, sub) => (
    <div style={{ flex: 1, minWidth: 0, background: T.bg, borderRadius: 12, padding: "8px 9px" }}>
      <div style={{ fontSize: 11, color: T.textSub, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 15.5, fontWeight: 750, color: T.text, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      {sub && <div style={{ fontSize: 11, fontWeight: 650, color: T.textSub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
  );
  return (
    <>
      {a.rentDue > 0 && <>
        <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 650, color: T.text }}>{mName} rent collected</span>
          <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: T.text }}><b>{money(a.rentCollected, false)}</b> <span style={{ color: T.textSub }}>of {money(a.rentDue, false)}</span></span>
        </div>
        <div role="img" aria-label={`${p}% collected${sdPct != null ? `, last month ${sdPct}% by this day` : ""}`} style={{ height: 10, borderRadius: 5, background: "#E9E9EB", position: "relative", margin: "8px 0 4px" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, p || 0)}%`, borderRadius: 5, background: GREEN }} />
          {sdPct != null && <div style={{ position: "absolute", top: -4, bottom: -4, left: `calc(${Math.min(100, sdPct)}% - 1px)`, width: 2, borderRadius: 1, background: T.text }} />}
        </div>
        <div style={{ fontSize: 12, color: T.textSub }}>
          {p}% by {monthLabel(live.month)} {day}
          {sdPct != null ? <> · <b style={{ color: T.text }}>{monthLabel(live.lastMonth, true)} was {sdPct}%</b> by this day (black tick)</> : lastPct != null ? <> · {monthLabel(live.lastMonth, true)} finished at <b style={{ color: T.text }}>{lastPct}%</b></> : null}
          {" · "}{money(Math.max(0, a.rentDue - a.rentCollected), false)} still to come in
        </div>
      </>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {stat(`Cash in · ${monthLabel(live.month)}`, money(a.cashIn, false))}
        {stat(`Expenses · ${monthLabel(live.month)}`, money(a.cashOut, false), last && last.all && last.all.cashOut != null ? `${monthLabel(live.lastMonth)}: ${money(last.all.cashOut, false)}` : null)}
        {stat("Unpaid bills", live.latest.billsTotal != null ? money(live.latest.billsTotal, false) : "—", wasBills != null && live.latest.billsTotal != null ? <span title={wasWhen}>{deltaTxt(live.latest.billsTotal, wasBills, (v) => money(v, false), true)}</span> : null)}
      </div>
    </>
  );
}

// "Since last check": payments, rent still missing, new expenses, bill changes.
function LiveChanges({ live, rentals, plat, onOpen }) {
  const L = live.latest;
  const items = [];
  const rentalOf = (key, name) => plat.rentalFor({ key, name }, rentals);
  const tag = (t) => { const u = (String(t.unit || "").match(/#\S+$/) || [])[0]; return `${shortName(t.name)}${u ? ` ${u}` : ""}`; };
  const ins = live.fresh.filter((t) => t.dir === "in").sort((a, b) => b.amount - a.amount);
  if (ins.length) {
    const byProp = {};
    ins.forEach((t) => { const k = tag(t); byProp[k] = (byProp[k] || 0) + t.amount; });
    const late = ins.filter((t) => /late fee/i.test(t.desc)).reduce((s, t) => s + t.amount, 0);
    items.push({ icon: "💵", bg: "#E8F7EC", title: `${ins.length} payment${ins.length > 1 ? "s" : ""} — ${money(ins.reduce((s, t) => s + t.amount, 0), false)}`, sub: Object.entries(byProp).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${money(v, false)}`).join(" · ") + (late ? ` · incl. ${money(late, false)} late fees` : "") });
  }
  const missing = Object.values(L.props || {}).filter((p) => p.rentDue > 0 && p.rentCollected != null && p.rentCollected < p.rentDue - 0.5);
  if (missing.length) {
    const none = missing.filter((p) => !(p.rentCollected > 0)), part = missing.filter((p) => p.rentCollected > 0);
    items.push({ icon: "💸", bg: "#FFE9E7", title: `Still owed for ${monthLabel(live.month, true)} — ${money(missing.reduce((s, p) => s + p.rentDue - p.rentCollected, 0), false)}`, sub: [...none.map((p) => `${shortName(p.name)} nothing yet`), ...part.map((p) => `${shortName(p.name)} ${money(p.rentCollected, false)} of ${money(p.rentDue, false)}`)].join(" · "), rental: missing.length === 1 ? rentalOf(missing[0].key, missing[0].name) : null });
  }
  live.fresh.filter((t) => t.dir === "out").sort((a, b) => b.amount - a.amount).forEach((t) => {
    items.push({ icon: "🧾", bg: "#FFF1E0", title: `Expense — ${t.payee || t.desc} ${money(t.amount)}`, sub: `${t.name}${t.unit ? ` · ${t.unit}` : ""} · ${t.payee ? `${t.desc} · ` : ""}${dshort(t.date)}`, rental: rentalOf(t.key, t.name) });
  });
  const bc = live.billChanges;
  bc.paidDown.forEach((b) => items.push({ icon: "✅", bg: "#E8F1FD", title: `${b.payee.replace(/\s+LLC$/i, "")} paid down ${money(b.paid, false)}`, sub: `${b.name} · ${money(b.amount)} left of ${money(b.was)}`, rental: rentalOf(b.key, b.name) }));
  bc.paidOff.forEach((b) => items.push({ icon: "✅", bg: "#E8F1FD", title: `Bill paid — ${b.payee.replace(/\s+LLC$/i, "")} ${money(b.amount)}`, sub: `${b.name} · ${b.desc}`, rental: rentalOf(b.key, b.name) }));
  bc.added.forEach((b) => items.push({ icon: "🆕", bg: "#FFF1E0", title: `New bill — ${b.payee.replace(/\s+LLC$/i, "")} ${money(b.amount)}`, sub: `${b.name}${b.unit ? ` · ${b.unit}` : ""} · ${b.desc} · ${dshort(b.date)}`, rental: rentalOf(b.key, b.name) }));
  return (
    <>
      <div style={secS}>{live.firstCheck ? `${monthLabel(live.month, true)} so far` : `Since last check · ${whenAgo(live.prev.at)}`}</div>
      {items.length ? (
        <div style={{ ...cardS, padding: "0 14px" }}>
          {items.map((a, i) => (
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
      ) : <div style={{ ...cardS, padding: "14px", fontSize: 13, color: T.textSub }}>Nothing new since the last check.</div>}
    </>
  );
}

function TrendsView({ live, statements }) {
  const months = live.monthList.slice(-7);
  const rent = months.map((ym) => { const a = live.months[ym].all || {}; return { label: monthLabel(ym), long: monthLabel(ym, true), value: pct(a.rentCollected || 0, a.rentDue || 0) || 0, partial: ym === live.month && !live.months[ym].complete, note: a.rentDue ? `${money(a.rentCollected || 0, false)} of ${money(a.rentDue, false)}` : "" }; });
  const exp = months.map((ym) => { const a = live.months[ym].all || {}; return { label: monthLabel(ym), long: monthLabel(ym, true), value: a.cashOut || 0, partial: ym === live.month && !live.months[ym].complete }; });
  const full = rent.filter((r) => !r.partial);
  const lastFull = full[full.length - 1], prevFull = full[full.length - 2];
  const fullE = exp.filter((r) => !r.partial);
  const lastE = fullE[fullE.length - 1], prevE = fullE[fullE.length - 2];
  // Unpaid bills: each packet's figure, then every live check.
  const pts = [
    ...statements.slice().reverse().filter((s) => s.summary && s.summary.unpaidBills != null).map((s) => ({ at: s.to, label: dshort(s.to), value: Math.abs(s.summary.unpaidBills) })),
    ...live.snaps.filter((x) => x.billsTotal != null).map((x) => ({ at: String(x.at).slice(0, 10), label: dshort(x.at), value: x.billsTotal })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const lastB = pts[pts.length - 1], firstB = pts[0];
  const head = (title, sub) => <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><b style={{ fontSize: 14.5, flex: 1, color: T.text }}>{title}</b><span style={{ fontSize: 12, color: T.textSub }}>{sub}</span></div>;
  const hero = (v, d) => <div style={{ fontSize: 22, fontWeight: 750, fontVariantNumeric: "tabular-nums", color: T.text, margin: "2px 0 4px" }}>{v} <span style={{ fontSize: 12.5, fontWeight: 650 }}>{d}</span></div>;
  return (
    <>
      <div style={{ ...cardS, padding: "12px 14px 10px" }}>
        {head("Rent collected", "% of rent due, each month")}
        {lastFull && hero(`${lastFull.value}%`, <>{lastFull.long}{prevFull ? <> · {deltaTxt(lastFull.value, prevFull.value, (v) => `${v} pts`, false)}</> : null}</>)}
        <BarChart data={rent} color={GOLD} fmt={(v) => `${v}%`} label="Tap a month for details · * = so far" />
      </div>
      <div style={{ ...cardS, padding: "12px 14px 10px" }}>
        {head("Expenses", "repairs, fees, bills paid")}
        {lastE && hero(money(lastE.value, false), <>{lastE.long}{prevE ? <> · {deltaTxt(lastE.value, prevE.value, (v) => money(v, false), true)}</> : null}</>)}
        <BarChart data={exp} color={GRAY} fmt={(v) => money(v)} label="Tap a month for details · * = so far" />
      </div>
      <div style={{ ...cardS, padding: "12px 14px 10px" }}>
        {head("Unpaid bills", "at each check")}
        {lastB && hero(money(lastB.value, false), firstB && firstB !== lastB ? <>{deltaTxt(lastB.value, firstB.value, (v) => money(v, false), true)} since {firstB.label}</> : null)}
        <LineChart points={pts} fmt={(v) => money(v)} />
      </div>
    </>
  );
}

function PropsTable({ live, plat, rentals, onOpen, onAddRental }) {
  const ym = live.month;
  const rows = plat.liveProps().map((p) => {
    const m = propMonth(live, p.key, ym);
    const bills = (live.latest.bills || []).filter((b) => b.key === p.key).reduce((s, b) => s + b.amount, 0);
    const lp = (live.latest.props || {})[p.key] || null;
    return { ...p, m, bills, lp, rental: plat.rentalFor(p, rentals) };
  });
  const th = { fontSize: 10.5, fontWeight: 700, color: T.textSub, padding: "8px 0 6px", textAlign: "right", letterSpacing: "0.02em" };
  const td = { fontSize: 12.5, padding: "9px 0", borderTop: `1px solid ${T.border}`, textAlign: "right", verticalAlign: "top", fontVariantNumeric: "tabular-nums", color: T.text };
  const sub = { fontSize: 11.5, color: T.textSub };
  return (
    <div style={{ ...cardS, padding: "2px 14px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>PROPERTY</th><th style={{ ...th, whiteSpace: "nowrap" }}>RENT</th><th style={{ ...th, whiteSpace: "nowrap", paddingLeft: 8 }}>SPENT</th><th style={{ ...th, whiteSpace: "nowrap", paddingLeft: 8 }}>BILLS DUE</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key} onClick={() => r.rental && onOpen && onOpen(r.rental.id)} style={{ cursor: r.rental ? "pointer" : "default" }}>
            <td style={{ ...td, textAlign: "left" }}>
              <b>{shortName(r.name)}</b>{r.lp && r.lp.unitsTotal > 1 ? <span style={sub}> {r.lp.unitsTotal} units</span> : null}<br />
              {rentChip(r.lp, ym)}
              {!r.rental && onAddRental && <button onClick={(e) => { e.stopPropagation(); onAddRental({ name: r.name, units: (r.lp && r.lp.unitsTotal) || 1, key: r.key }); }} style={{ ...chipS("blue"), border: "none", cursor: "pointer", fontFamily: "inherit", minHeight: 22 }}>＋ Add to Rentals</button>}
            </td>
            <td style={{ ...td, color: r.lp && r.lp.rentDue > 0 && r.lp.rentCollected >= r.lp.rentDue - 0.5 ? GREEN : T.text }}>{r.lp && r.lp.rentDue != null ? <>{money(r.lp.rentCollected || 0, false)}<div style={sub}>of {money(r.lp.rentDue, false)}</div></> : money(r.m.cashIn, false)}</td>
            <td style={{ ...td, color: r.m.cashOut > 0 ? RED : T.textSub }}>{r.m.cashOut > 0 ? money(r.m.cashOut, false) : "—"}</td>
            <td style={{ ...td, color: r.bills > 0 ? T.text : T.textSub }}>{r.bills > 0 ? money(r.bills, false) : "—"}</td>
          </tr>
        ))}</tbody>
      </table>
      <div style={{ fontSize: 12, color: T.textSub, padding: "8px 0 10px", borderTop: `1px solid ${T.border}` }}>{monthLabel(ym, true)} so far — rent in vs due, money spent, bills Platinum still owes. Tap a property for its charts, every payment and expense, and tenants.</div>
    </div>
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

// Cowork pastes the JSON block from its skill here (or picks a .json file).
function UpdateSheet({ plat, by, isMobile, onClose }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const save = async (raw) => {
    setMsg(""); setBusy(true);
    try {
      const u = normalizeUpdate(raw);
      await plat.save((cur) => applyUpdate(cur, u, by || "Cowork"));
      const tx = u.months.reduce((s, m) => s + m.cashIn.length + m.cashOut.length, 0);
      setMsg(`✓ Saved — ${u.months.length} month${u.months.length === 1 ? "" : "s"}, ${tx} transaction${tx === 1 ? "" : "s"}${u.bills ? `, ${u.bills.length} unpaid bill${u.bills.length === 1 ? "" : "s"}` : ""}.`);
      setText("");
    } catch (e) { setMsg(e.message || "Couldn't read that update."); }
    setBusy(false);
  };
  return (
    <Sheet title="Cowork update" sub="Numbers from the AppFolio owner portal" isMobile={isMobile} onClose={onClose}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Platinum update JSON" placeholder='Paste the update block from Cowork — it starts with {"kind":"goldstone-appfolio-update"…' style={{ width: "100%", minHeight: 180, borderRadius: 14, border: `1px solid ${T.border}`, padding: 12, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", boxSizing: "border-box", background: T.card, color: T.text, resize: "vertical" }} />
      {msg && <div style={{ fontSize: 13, color: msg.startsWith("✓") ? GREEN : RED, margin: "8px 2px" }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button disabled={busy || !text.trim()} onClick={() => save(text)} style={{ flex: 1, minHeight: 48, borderRadius: 24, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 15, cursor: "pointer", fontFamily: "inherit", opacity: busy || !text.trim() ? 0.55 : 1 }}>{busy ? "Saving…" : "Save update"}</button>
        <button onClick={() => fileRef.current && fileRef.current.click()} style={{ minHeight: 48, padding: "0 18px", borderRadius: 24, border: "none", background: "rgba(118,118,128,0.12)", color: T.text, fontWeight: 650, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>Choose file</button>
        <input ref={fileRef} type="file" accept="application/json,.json,.txt" style={{ display: "none" }} aria-label="Platinum update file" onChange={async (e) => { const f = e.target.files && e.target.files[0]; if (f) await save(await f.text()); e.target.value = ""; }} />
      </div>
      <div style={{ fontSize: 12, color: T.textSub, marginTop: 12, lineHeight: 1.45 }}>Cowork does this Monday and Thursday mornings. Each update is kept, so the trends build up week by week.</div>
    </Sheet>
  );
}

function ResultSheet({ result, rentals, plat, isMobile, onClose }) {
  const s = result.stmt;
  const props = (s.props || []).filter((p) => !p.rollOnly);
  const th = { fontSize: 11, fontWeight: 700, color: T.textSub, padding: "8px 0 6px", textAlign: "right" };
  const td = { fontSize: 13, padding: "8px 0", borderTop: `1px solid ${T.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  return (
    <Sheet title={result.isNew ? "New Platinum packet" : "Packet updated"} sub={`${period(s)} · ${props.length} propert${props.length === 1 ? "y" : "ies"}`} isMobile={isMobile} onClose={onClose}>
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
      <a href={s.pdfUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 24, background: "rgba(118,118,128,0.12)", color: T.text, fontWeight: 650, fontSize: 15, textDecoration: "none" }}>📄 Open packet PDF</a>
      <button onClick={onClose} style={{ width: "100%", marginTop: 8, minHeight: 48, borderRadius: 24, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
    </Sheet>
  );
}

function StatementsSheet({ plat, isMobile, onClose }) {
  return (
    <Sheet title="Platinum packets" sub="Newest first" isMobile={isMobile} onClose={onClose}>
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
export function PlatinumTab({ view, live, liveKey }) {
  const [txMonth, setTxMonth] = useState(null);
  return (
    <div>
      {live && liveKey && <LiveProp live={live} k={liveKey} txMonth={txMonth} setTxMonth={setTxMonth} />}
      {view && <PacketProp view={view} hideBills={!!(live && liveKey && live.latest.bills)} />}
    </div>
  );
}

function LiveProp({ live, k, txMonth, setTxMonth }) {
  const ym = live.month;
  const cur = propMonth(live, k, ym);
  const months = live.monthList.slice(-7);
  const rent = months.map((m) => { const pm = propMonth(live, k, m); return { label: monthLabel(m), long: monthLabel(m, true), value: pm.rentDue > 0 ? pct(pm.rentCollected || 0, pm.rentDue) : 0, partial: m === ym && !live.months[m].complete, note: pm.rentDue > 0 ? `${money(pm.rentCollected || 0, false)} of ${money(pm.rentDue, false)}` : "no rent figure" }; });
  const exp = months.map((m) => ({ label: monthLabel(m), long: monthLabel(m, true), value: propMonth(live, k, m).cashOut || 0, partial: m === ym && !live.months[m].complete }));
  const bills = (live.latest.bills || []).filter((b) => b.key === k).sort((a, b) => b.amount - a.amount);
  const txMonths = [...new Set(live.txns.filter((t) => t.key === k).map((t) => monthOf(t.date)))].sort().reverse();
  const sel = txMonth && txMonths.includes(txMonth) ? txMonth : txMonths[0];
  const tx = live.txns.filter((t) => t.key === k && monthOf(t.date) === sel).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const hasRent = rent.some((r) => r.value > 0);
  const p = pct(cur.rentCollected || 0, cur.rentDue || 0);
  return (
    <>
      <div style={{ fontSize: 12.5, color: T.textSub, margin: "0 6px 8px" }}>Managed by Platinum · live from the owner portal · checked {whenAgo(live.latest.at)}</div>
      <div style={{ ...cardS, padding: "12px 14px" }}>
        {cur.rentDue > 0 && <>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: T.text }}><b>{monthLabel(ym, true)} rent</b><span style={{ fontVariantNumeric: "tabular-nums" }}><b>{money(cur.rentCollected || 0, false)}</b> <span style={{ color: T.textSub }}>of {money(cur.rentDue, false)}</span></span></div>
          <div style={{ height: 8, borderRadius: 4, background: "#E9E9EB", margin: "8px 0 4px", overflow: "hidden" }}><div style={{ width: `${Math.min(100, p || 0)}%`, height: "100%", background: GREEN, borderRadius: 4 }} /></div>
        </>}
        <div style={{ display: "flex", gap: 16, fontSize: 13, color: T.textSub, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
          <span>Cash in <b style={{ color: GREEN }}>{money(cur.cashIn, false)}</b></span>
          <span>Expenses <b style={{ color: cur.cashOut > 0 ? RED : T.text }}>{money(cur.cashOut, false)}</b></span>
          {bills.length > 0 && <span>Bills due <b style={{ color: T.text }}>{money(bills.reduce((s, b) => s + b.amount, 0), false)}</b></span>}
        </div>
      </div>
      {hasRent && <div style={{ ...cardS, padding: "12px 14px 10px" }}><b style={{ fontSize: 14.5, color: T.text }}>Rent collected</b><BarChart data={rent} color={GOLD} fmt={(v) => `${v}%`} label="% of rent due · tap a month" /></div>}
      <div style={{ ...cardS, padding: "12px 14px 10px" }}><b style={{ fontSize: 14.5, color: T.text }}>Expenses</b><BarChart data={exp} color={GRAY} fmt={(v) => money(v)} label="by month · tap a month" /></div>
      {bills.length > 0 && <>
        <div style={secS}>Bills not paid yet · {money(bills.reduce((s, b) => s + b.amount, 0))}</div>
        <div style={cardS}>
          {bills.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 13 }}>
              <span style={{ color: T.textTert, width: 44, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{dshort(b.date)}</span>
              <span style={{ flex: 1, minWidth: 0, color: T.text }}>{b.payee.replace(/\s+LLC$/i, "")} — {b.desc}{b.unit ? <span style={{ color: T.textSub }}> · {b.unit}</span> : null}</span>
              <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{money(b.amount)}</span>
            </div>
          ))}
        </div>
      </>}
      {txMonths.length > 0 && <>
        <div style={{ ...secS, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ marginRight: "auto" }}>Payments & expenses</span>
          {txMonths.slice(0, 6).map((m) => <button key={m} onClick={() => setTxMonth(m)} style={{ minHeight: 30, padding: "0 10px", borderRadius: 15, border: "none", background: m === sel ? T.text : "rgba(118,118,128,0.12)", color: m === sel ? "#fff" : T.text, fontSize: 12, fontWeight: 650, cursor: "pointer", fontFamily: "inherit", textTransform: "none", letterSpacing: 0 }}>{monthLabel(m)}</button>)}
        </div>
        <div style={cardS}>
          {tx.map((t, i) => (
            <div key={t.id} style={{ display: "flex", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 13 }}>
              <span style={{ color: T.textTert, width: 44, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{dshort(t.date)}</span>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ color: T.text }}>{t.payee || t.desc}</span>{(t.payee || t.unit) && <><br /><span style={{ color: T.textSub, fontSize: 12 }}>{[t.payee ? t.desc : "", t.unit].filter(Boolean).join(" · ")}</span></>}</span>
              <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums", color: t.dir === "in" ? GREEN : T.text }}>{t.dir === "in" ? signed(t.amount) : money(-t.amount)}</span>
            </div>
          ))}
        </div>
      </>}
    </>
  );
}

function PacketProp({ view, hideBills }) {
  const { stmt, prop, units } = view;
  const S = prop.summary || {};
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
      <div style={secS}>From the monthly packet · {period(stmt)}</div>
      {units.length > 0 && <>
        <div style={{ fontSize: 12, color: T.textSub, margin: "0 6px 6px" }}>Tenants{asOf ? ` · as of ${dshort(asOf)}` : ""}</div>
        <div style={cardS}>
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
      <div style={{ ...cardS, padding: "10px 14px" }}>
        {kv("Cash at start", S.beginning)}
        {kv("Cash in", S.cashIn, GREEN)}
        {kv("Cash out", S.cashOut)}
        {kv("Unpaid bills", S.unpaidBills, (S.unpaidBills || 0) < 0 ? RED : null)}
        {kv("Reserve they keep", S.reserve)}
        {kv("Tenant prepayments", S.prepayments)}
        {kv("Owed to you", S.netOwnerFunds, (S.netOwnerFunds || 0) < 0 ? RED : GREEN, true)}
        {S.remit > 0 && <div style={{ fontSize: 12.5, color: "#C4170C", fontWeight: 600, marginTop: 2 }}>Platinum asked you to send {money(S.remit)}</div>}
        {prop.income && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 6 }}>Net income that period: <b style={{ color: prop.income.net >= 0 ? GREEN : RED }}>{signed(prop.income.net)}</b> ({money(prop.income.totalIncome)} in − {money(prop.income.totalExpense)} expenses)</div>}
      </div>
      {!hideBills && (prop.bills || []).length > 0 && <>
        <div style={{ fontSize: 12, color: T.textSub, margin: "0 6px 6px" }}>Bills not paid yet · {money(billTot)}</div>
        <div style={cardS}>
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
        <div style={{ fontSize: 12, color: T.textSub, margin: "0 6px 6px" }}>Packet transactions</div>
        <div style={cardS}>
          {tx.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 13 }}>
              <span style={{ color: T.textTert, width: 44, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{dshort(t.date)}</span>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ color: T.text }}>{t.payee}</span><br /><span style={{ color: T.textSub, fontSize: 12 }}>{t.desc}</span></span>
              <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums", color: t.cashIn ? GREEN : T.text }}>{t.cashIn ? signed(t.cashIn) : money(-t.cashOut)}</span>
            </div>
          ))}
        </div>
      </>}
      {stmt.pdfUrl && <a href={stmt.pdfUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 24, background: "rgba(118,118,128,0.12)", color: T.text, fontWeight: 650, fontSize: 15, textDecoration: "none", marginBottom: 8 }}>📄 Open packet PDF</a>}
    </div>
  );
}
