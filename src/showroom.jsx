// 🛋 Showroom — every product Elie has ever picked, in one place (approved
// 9/18/26): departments (the spec-sheet categories), one row per product —
// picture left, name + description right, 🔗 opens the store page — search,
// auto sub-groups from the product names, and a picker sheet the property
// spec sheet uses to pull several products onto a house at once.
//
// Data is the same app_settings row the spec sheet always used ("spec_picks"),
// so nothing already saved moves. Pictures are copied into Goldstone's own
// storage the moment they're added (api/spec/img) so a store changing its
// image address can't blank them; "Recover missing pictures" re-copies the
// older ones from each product's saved link.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { useData } from "./data/DataProvider";
import { qbAuthFetch } from "./net";
import { SPEC_CATS } from "./contractors/sowLibrary";
import { useSpecPicks, FinishForm, absUrl, ROOM_PICKS, isOurPhoto, mirrorPhoto } from "./contractors/spec";

const catOf = (k) => SPEC_CATS.find((c) => c.key === k) || SPEC_CATS[SPEC_CATS.length - 1];
// "homedepot.com" → "Home Depot" for the little store caption under a product.
const STORES = [["homedepot", "Home Depot"], ["lowes", "Lowe's"], ["amazon", "Amazon"], ["wayfair", "Wayfair"], ["build.com", "Build.com"], ["ferguson", "Ferguson"], ["floordecor", "Floor & Decor"], ["flooranddecor", "Floor & Decor"], ["ikea", "IKEA"], ["overstock", "Overstock"], ["target", "Target"], ["walmart", "Walmart"], ["menards", "Menards"], ["costco", "Costco"], ["signaturehardware", "Signature Hardware"], ["lumberliquidators", "LL Flooring"], ["llflooring", "LL Flooring"], ["zoro", "Zoro"], ["supplyhouse", "SupplyHouse"], ["daltile", "Daltile"], ["msisurfaces", "MSI"], ["tilebar", "TileBar"], ["lampsplus", "Lamps Plus"], ["etsy", "Etsy"], ["ebay", "eBay"]];
export const storeOf = (link) => {
  const s = absUrl(link); if (!s) return "";
  let host = ""; try { host = new URL(s).hostname.toLowerCase(); } catch { return ""; }
  const hit = STORES.find(([k]) => host.includes(k)); if (hit) return hit[1];
  return host.replace(/^www\./, "").split(".").slice(0, -1).join(".") || host;
};
// Auto sub-groups: the first keyword a product's name/description mentions.
// Only shown when a department splits into 2+ groups — nothing to tag by hand.
const SUBS = {
  lighting: ["vanity", "flush mount", "pendant", "chandelier", "recessed", "sconce", "fan", "lantern", "exterior", "under cabinet", "track", "bulb"],
  plumbing: ["kitchen faucet", "bath faucet", "faucet", "shower", "tub", "toilet", "sink", "vanity", "garbage disposal", "water heater", "valve", "drain"],
  flooring: ["lvp", "vinyl", "laminate", "hardwood", "engineered", "carpet", "tile", "underlayment", "stair", "transition"],
  tile: ["floor", "shower", "backsplash", "wall", "mosaic", "grout", "trim", "niche"],
  kitchen: ["cabinet", "countertop", "quartz", "granite", "backsplash", "range", "hood", "dishwasher", "refrigerator", "microwave", "sink", "faucet", "hardware", "pull", "knob"],
  bath: ["vanity", "mirror", "medicine cabinet", "toilet", "tub", "shower door", "towel", "accessor", "exhaust", "fan"],
  paint: ["wall", "trim", "ceiling", "exterior", "primer", "cabinet", "door", "stain"],
  doors: ["interior door", "exterior door", "front door", "closet", "bifold", "barn", "handle", "lever", "knob", "hinge", "deadbolt", "lock", "hardware"],
  exterior: ["siding", "roof", "gutter", "window", "shutter", "railing", "deck", "fence", "mailbox", "house number", "garage door", "landscap", "stone", "paver"],
  other: ["appliance", "smart", "thermostat", "smoke", "outlet", "switch", "blind", "shade", "closet", "shelv"],
};
export const subOf = (p) => {
  const txt = `${p.title || ""} ${p.desc || ""}`.toLowerCase();
  const hit = (SUBS[p.cat] || []).find((k) => txt.includes(k));
  return hit ? hit.replace(/^\w/, (c) => c.toUpperCase()) : "";
};
export const pickPhotoMissing = (p) => !p.photo;

const btn = (kind) => ({
  padding: "9px 14px", borderRadius: 14, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", lineHeight: 1.2, minHeight: 38,
  ...(kind === "gold" ? { background: T.gold, color: "#fff", border: `1px solid ${T.gold}` } : kind === "ghost" ? { background: "transparent", color: T.textSub, border: `1px solid ${T.border}` } : { background: "#fff", color: T.text, border: `1px solid ${T.border}` }),
});
const chip = (on) => ({ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 16, border: "1px solid rgba(0,0,0,0.05)", background: on ? "#fff" : "rgba(118,118,128,0.08)", color: on ? T.gold : T.textSub, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0, boxShadow: on ? "0 1px 3px rgba(0,0,0,0.08)" : "none", minHeight: 34 });
const card = { background: T.card, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden" };
const searchS = { width: "100%", padding: "10px 12px 10px 34px", borderRadius: 12, border: "none", background: "rgba(118,118,128,0.12)", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: T.text };
const pill = (txt, bg = T.goldLight, fg = "#8a6d1f") => <span style={{ display: "inline-block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.03em", color: fg, background: bg, borderRadius: 9, padding: "2px 6px", whiteSpace: "nowrap" }}>{txt}</span>;

function SearchBox({ value, onChange, placeholder, autoFocus }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: T.textTert, pointerEvents: "none" }}>🔍</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} style={searchS} />
      {value && <button onClick={() => onChange("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 26, height: 26, borderRadius: 13, border: "none", background: "rgba(118,118,128,0.2)", color: "#fff", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>×</button>}
    </div>
  );
}

// The round 🔗 that opens the store page in a new tab — only when there is a link.
export function LinkBtn({ link, size = 38 }) {
  if (!link) return null;
  return <a href={absUrl(link)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={`Open on ${storeOf(link) || "the store's site"}`} style={{ width: size, height: size, minWidth: size, borderRadius: size / 2, border: `1px solid ${T.border}`, background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, textDecoration: "none", color: T.blue, flexShrink: 0 }}>🔗</a>;
}

// Product photo — 72px on phones; a dashed frame when it's missing or dead.
export function ProductPhoto({ src, size = 72, onDead }) {
  const [dead, setDead] = useState(false);
  useEffect(() => { setDead(false); }, [src]);
  if (!src || dead) return <span style={{ width: size, height: size, borderRadius: 12, background: T.bg, border: `1.5px dashed ${T.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size / 3.2, color: T.textTert, flexShrink: 0 }}>📷</span>;
  return <img src={src} alt="" onError={() => { setDead(true); if (onDead) onDead(); }} style={{ width: size, height: size, borderRadius: 12, objectFit: "cover", flexShrink: 0, background: "#EEE", display: "block" }} />;
}

// One row per product: [☐] photo · name / description / price · store · N houses · 🔗
export function ProductRow({ p, houses = 0, onOpen, selectable, selected, disabled, disabledNote, sub, first, dense }) {
  const store = storeOf(p.link);
  const meta = [p.price, store].filter(Boolean).join(" · ");
  return (
    <div onClick={() => { if (disabled) return; if (onOpen) onOpen(p); }} style={{ display: "flex", gap: 12, padding: dense ? "9px 12px" : "11px 12px", alignItems: "center", borderTop: first ? "none" : `1px solid ${T.border}`, cursor: onOpen && !disabled ? "pointer" : "default", background: selected ? "#FBF6E8" : "transparent", opacity: disabled ? 0.55 : 1, minHeight: 60 }}>
      {selectable && <span style={{ width: 26, height: 26, minWidth: 26, borderRadius: 13, background: selected ? T.gold : "#fff", border: `1.5px solid ${selected ? T.gold : "rgba(0,0,0,0.18)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 800 }}>{selected ? "✓" : ""}</span>}
      <ProductPhoto src={p.photo} size={dense ? 56 : 72} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, lineHeight: 1.25 }}>{p.title || "Untitled product"}</div>
        {p.desc && !dense && <div style={{ fontSize: 12, color: T.textSub, marginTop: 3, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.desc}</div>}
        <div style={{ fontSize: 11, color: T.textTert, marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {disabledNote ? <span style={{ color: "#8a6d1f", fontWeight: 700 }}>{disabledNote}</span> : <>
            {meta && <span>{meta}</span>}
            {houses > 0 && pill(`${houses} HOUSE${houses === 1 ? "" : "S"}`)}
            {sub && pill(sub, "rgba(118,118,128,0.1)", T.textSub)}
            {!p.photo && <span style={{ color: T.red, fontWeight: 700 }}>Picture missing · tap to add one</span>}
          </>}
        </div>
      </div>
      <LinkBtn link={p.link} />
    </div>
  );
}

// Houses a product has been on: the spec sheets that reference it, plus the
// addresses stamped on it when it was picked.
export function useHousesOf() {
  const { sharedProps } = useData();
  return useMemo(() => {
    const m = new Map();
    const add = (id, addr) => { if (!id || !addr) return; if (!m.has(id)) m.set(id, new Set()); m.get(id).add(addr); };
    (sharedProps || []).forEach((p) => { const addr = `${p.address || ""}${p.city ? `, ${p.city}` : ""}`; ((p.spec && p.spec.items) || []).forEach((it) => add(it.pickId, addr)); });
    return { count: (p) => new Set([...(m.get(p.id) || []), ...(p.usedOn || [])]).size, list: (p) => [...new Set([...(m.get(p.id) || []), ...(p.usedOn || [])])] };
  }, [sharedProps]);
}

const matches = (p, q) => { const s = q.trim().toLowerCase(); if (!s) return true; return `${p.title || ""} ${p.desc || ""} ${p.price || ""} ${storeOf(p.link)} ${catOf(p.cat).label}`.toLowerCase().includes(s); };

// ─── The Showroom page (More → 🛋 Showroom) ────────────────────────────────
export function ShowroomPage({ isMobile }) {
  const picks = useSpecPicks();
  const houses = useHousesOf();
  const items = picks.items;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(null); // null = home
  const [sub, setSub] = useState("");
  const [form, setForm] = useState(null);
  const [fix, setFix] = useState(null); // {done,total,ok,bad} while recovering pictures
  const counts = useMemo(() => Object.fromEntries(SPEC_CATS.map((c) => [c.key, items.filter((p) => p.cat === c.key).length])), [items]);
  const recent = useMemo(() => [...items].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 4), [items]);
  const searching = q.trim().length > 0;
  const inCat = useMemo(() => { const list = searching ? items.filter((p) => matches(p, q)) : cat ? items.filter((p) => p.cat === cat) : []; return [...list].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))); }, [items, cat, q, searching]);
  const subs = useMemo(() => { if (searching || !cat) return []; const m = new Map(); inCat.forEach((p) => { const s = subOf(p); if (s) m.set(s, (m.get(s) || 0) + 1); }); return m.size >= 2 ? [...m.entries()].sort((a, b) => b[1] - a[1]) : []; }, [inCat, cat, searching]);
  const shown = sub ? inCat.filter((p) => subOf(p) === sub) : inCat;
  useEffect(() => { setSub(""); }, [cat]);
  const missing = items.filter((p) => !p.photo || !isOurPhoto(p.photo));
  const recover = async () => {
    const todo = items.filter((p) => (!p.photo && p.link) || (p.photo && !isOurPhoto(p.photo)));
    if (!todo.length) { window.alert("Every picture is already saved in Goldstone's storage."); return; }
    setFix({ done: 0, total: todo.length, ok: 0, bad: 0 });
    let ok = 0, bad = 0;
    for (let i = 0; i < todo.length; i++) {
      const p = todo[i];
      try {
        let src = p.photo;
        if (!src && p.link) { const d = await qbAuthFetch(`/api/spec/link?url=${encodeURIComponent(absUrl(p.link))}`); src = d.image || ""; }
        const url = src ? await mirrorPhoto(src) : "";
        if (url && isOurPhoto(url)) { picks.update(p.id, { photo: url }); ok++; } else bad++;
      } catch { bad++; }
      setFix({ done: i + 1, total: todo.length, ok, bad });
    }
    setTimeout(() => setFix(null), 6000);
  };
  const openNew = () => setForm({ cat: cat || "lighting", title: "", desc: "", link: "", photo: "", price: "", showroom: true });
  const openEdit = (p) => setForm({ ...p, showroom: true, houses: houses.list(p) });
  const save = (f) => {
    const base = { cat: f.cat, title: (f.title || "").trim() || "Product", desc: (f.desc || "").trim(), link: absUrl(f.link), photo: f.photo || "", price: (f.price || "").trim() };
    if (f.id) picks.update(f.id, base); else picks.add(base);
    setForm(null);
  };
  const remove = (id) => { picks.unpin(id); setForm(null); };

  const header = (
    <div style={{ padding: isMobile ? "6px 16px 10px" : "6px 0 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {cat && !searching ? <button onClick={() => setCat(null)} style={{ background: "none", border: "none", padding: 0, color: T.gold, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>‹ Showroom</button> : null}
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.4px", color: T.text }}>{cat && !searching ? `${catOf(cat).emoji} ${catOf(cat).label}` : "🛋 Showroom"}</div>
          <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2 }}>{searching ? `${inCat.length} match${inCat.length === 1 ? "" : "es"} for “${q.trim()}”` : cat ? `${counts[cat] || 0} product${counts[cat] === 1 ? "" : "s"} · 🔗 opens the store page` : `Every product you've ever picked · ${items.length} item${items.length === 1 ? "" : "s"}`}</div>
        </div>
        {!isMobile && <button onClick={openNew} style={btn("gold")}>＋ Add a product</button>}
      </div>
      <div style={{ marginTop: 10 }}><SearchBox value={q} onChange={setQ} placeholder="Search products, stores, model numbers…" /></div>
      {fix && <div style={{ marginTop: 8, fontSize: 12, color: T.textSub }}>{fix.done < fix.total ? `Recovering pictures… ${fix.done} of ${fix.total}` : `Done — ${fix.ok} picture${fix.ok === 1 ? "" : "s"} saved${fix.bad ? `, ${fix.bad} couldn't be recovered (paste those by hand)` : ""}.`}</div>}
    </div>
  );
  const deptList = (
    <div>
      {SPEC_CATS.map((c) => (
        <button key={c.key} onClick={() => { setQ(""); setCat(c.key); }} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "11px 14px", borderRadius: 16, border: `1px solid ${T.border}`, background: cat === c.key && !isMobile ? T.goldLight : T.card, boxShadow: T.shadow, marginBottom: 8, cursor: "pointer", fontFamily: "inherit", minHeight: 62 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: T.goldLight, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 21, flexShrink: 0 }}>{c.emoji}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: T.text }}>{c.label}</span>
            <span style={{ display: "block", fontSize: 12, color: T.textTert, marginTop: 1 }}>{counts[c.key] || 0} product{counts[c.key] === 1 ? "" : "s"}</span>
          </span>
          <span style={{ color: "#C7C7CC", fontSize: 18 }}>›</span>
        </button>
      ))}
      {missing.length > 0 && (
        <button onClick={recover} disabled={!!fix} style={{ ...btn("ghost"), width: "100%", marginTop: 4, opacity: fix ? 0.6 : 1 }}>🩹 Recover missing pictures{missing.length ? ` · ${missing.length}` : ""}</button>
      )}
    </div>
  );
  const rows = (list, empty) => (
    <div style={card}>
      {list.length === 0 && <div style={{ padding: "22px 14px", fontSize: 12.5, color: T.textTert, textAlign: "center", lineHeight: 1.5 }}>{empty}</div>}
      {list.map((p, i) => <ProductRow key={p.id} p={p} first={i === 0} houses={houses.count(p)} onOpen={openEdit} sub={cat && !sub ? subOf(p) : ""} />)}
    </div>
  );
  const secH = (t) => <div style={{ fontSize: 11, fontWeight: 800, color: T.textTert, letterSpacing: "0.05em", textTransform: "uppercase", margin: "12px 2px 8px" }}>{t}</div>;
  const catBody = (
    <>
      {subs.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "2px 0 10px", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          <button onClick={() => setSub("")} style={chip(!sub)}>All {inCat.length}</button>
          {subs.map(([s, n]) => <button key={s} onClick={() => setSub(sub === s ? "" : s)} style={chip(sub === s)}>{s} {n}</button>)}
        </div>
      )}
      {rows(shown, `Nothing in ${catOf(cat).label.toLowerCase()} yet. Tap ＋ to add a product, or add one from any property's spec sheet — it lands here too.`)}
      <div style={{ fontSize: 11.5, color: T.textTert, textAlign: "center", margin: "10px 16px 0", lineHeight: 1.4 }}>Tap a row to edit it or see which houses used it.</div>
    </>
  );
  const recentBlock = recent.length > 0 ? <>{secH("Recently added")}{rows(recent)}</> : null;
  const home = (
    <>
      {recentBlock}
      {secH("Departments")}
      {deptList}
      {items.length === 0 && <div style={{ padding: "18px 14px", fontSize: 12.5, color: T.textTert, textAlign: "center", lineHeight: 1.5 }}>The Showroom fills up on its own — anything you add to a property's Finish Spec Sheet is saved here with its picture.</div>}
    </>
  );

  // The page frame hides overflow (every page scrolls itself, like Media) —
  // without this the Showroom couldn't scroll on the phone (Elie 9/18/26).
  if (isMobile) return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 0 110px", background: T.bg }}>
      {header}
      <div style={{ padding: "0 16px" }}>
        {searching ? rows(inCat, "No products match that.") : cat ? catBody : home}
      </div>
      <button onClick={openNew} title="Add a product" style={{ position: "fixed", right: 18, bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)", width: 54, height: 54, borderRadius: 27, border: "none", background: T.gold, color: "#fff", fontSize: 30, fontWeight: 800, cursor: "pointer", boxShadow: "0 6px 18px rgba(184,145,46,0.45)", zIndex: 40, fontFamily: "inherit", lineHeight: 1 }}>＋</button>
      {form && <FinishForm form={form} setForm={setForm} onSave={save} onClose={() => setForm(null)} onDelete={form.id ? () => remove(form.id) : null} />}
    </div>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
    <div style={{ padding: "18px 24px 40px", maxWidth: 1180, margin: "0 auto" }}>
      {header}
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        <div style={{ width: 300, flexShrink: 0, position: "sticky", top: 12 }}>{deptList}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {searching ? rows(inCat, "No products match that.") : cat ? catBody : recentBlock}
          {!searching && !cat && items.length === 0 && <div style={{ padding: "40px 20px", textAlign: "center", color: T.textTert, fontSize: 13.5, lineHeight: 1.6 }}>Pick a department on the left, or add your first product.</div>}
          {!searching && !cat && items.length > 0 && recent.length > 0 && <div style={{ fontSize: 12, color: T.textTert, marginTop: 10 }}>Pick a department on the left to see everything in it.</div>}
        </div>
      </div>
      {form && <FinishForm form={form} setForm={setForm} onSave={save} onClose={() => setForm(null)} onDelete={form.id ? () => remove(form.id) : null} />}
    </div>
    </div>
  );
}

// ─── Picker sheet — “🛋 From the Showroom” inside a property's spec sheet ────
export function ShowroomPicker({ property, initialCat, onHouseIds = [], onAdd, onNew, onClose }) {
  const picks = useSpecPicks();
  const houses = useHousesOf();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(initialCat || "lighting");
  const [sel, setSel] = useState([]);
  const searching = q.trim().length > 0;
  const on = new Set((onHouseIds || []).map(String));
  const list = useMemo(() => {
    const base = searching ? picks.items.filter((p) => matches(p, q)) : picks.items.filter((p) => p.cat === cat);
    return [...base].sort((a, b) => (on.has(String(a.id)) ? 1 : 0) - (on.has(String(b.id)) ? 1 : 0) || String(b.at || "").localeCompare(String(a.at || "")));
  }, [picks.items, q, cat, searching]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (p) => setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]));
  const addr = property.address || "this house";
  const counts = Object.fromEntries(SPEC_CATS.map((c) => [c.key, picks.items.filter((p) => p.cat === c.key).length]));
  // Sheets render at the document root: inside a scrolling page iOS can paint
  // the tab bar over a fixed sheet's bottom row (Elie 9/18/26).
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 480, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(255,255,255,0.96)", backdropFilter: "blur(20px)", width: "min(640px,100vw)", height: "min(88vh, 900px)", borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
          <div style={{ width: 38, height: 5, borderRadius: 3, background: "#C7C7CC", margin: "0 auto 10px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ flex: 1, fontSize: 16, fontWeight: 800, color: T.text }}>🛋 From the Showroom</div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 17, border: "none", background: "rgba(118,118,128,0.1)", color: T.textSub, fontSize: 18, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>×</button>
          </div>
          <SearchBox value={q} onChange={setQ} placeholder="Search the Showroom…" />
          {!searching && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 0 8px", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
              {SPEC_CATS.map((c) => <button key={c.key} onClick={() => setCat(c.key)} style={chip(cat === c.key)}>{c.emoji} {c.label}{counts[c.key] ? ` · ${counts[c.key]}` : ""}</button>)}
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 10px" }}>
          <div style={card}>
            {list.length === 0 && <div style={{ padding: "22px 14px", fontSize: 12.5, color: T.textTert, textAlign: "center", lineHeight: 1.5 }}>{searching ? "No products match that." : `Nothing in ${catOf(cat).label.toLowerCase()} yet — add something new below and it's saved here for next time.`}</div>}
            {list.map((p, i) => { const already = on.has(String(p.id)); return <ProductRow key={p.id} p={p} first={i === 0} dense houses={houses.count(p)} selectable={!already} selected={sel.includes(p.id)} disabled={already} disabledNote={already ? "Already on this house" : ""} onOpen={toggle} />; })}
          </div>
        </div>
        <div style={{ padding: "8px 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, background: "#fff", flexShrink: 0 }}>
          <button onClick={() => { if (sel.length) onAdd(picks.items.filter((p) => sel.includes(p.id))); }} disabled={!sel.length} style={{ ...btn("gold"), width: "100%", padding: 14, fontSize: 15, opacity: sel.length ? 1 : 0.5, boxShadow: sel.length ? "0 2px 10px rgba(184,145,46,0.35)" : "none" }}>{sel.length ? `Add ${sel.length} to ${addr} ↓` : "Tap products to select them"}</button>
          <button onClick={onNew} style={{ ...btn(), width: "100%", marginTop: 8 }}>＋ Something new (photo, paste or link)</button>
          <div style={{ fontSize: 11.5, color: T.textTert, textAlign: "center", marginTop: 8 }}>Tap rows to select several · pick rooms after</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Rooms step after picking — one choice applied to everything just added ─
export function RoomsSheet({ count, known = [], onDone, onClose }) {
  const [rooms, setRooms] = useState([]);
  const [draft, setDraft] = useState("");
  const all = [...new Set([...known, ...ROOM_PICKS])].filter(Boolean);
  const add = () => { const r = draft.trim(); if (!r) return; setRooms((s) => (s.includes(r) ? s : [...s, r])); setDraft(""); };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 481, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(255,255,255,0.96)", backdropFilter: "blur(20px)", width: "min(560px,100vw)", maxHeight: "80vh", borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
          <div style={{ width: 38, height: 5, borderRadius: 3, background: "#C7C7CC", margin: "0 auto 10px" }} />
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Which rooms?</div>
          <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2 }}>Applies to the {count} product{count === 1 ? "" : "s"} you just added · leave empty for the whole house · you can change each one later</div>
        </div>
        <div style={{ overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Type a room, or tap below" style={{ flex: 1, padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 14, fontFamily: "inherit", outline: "none", color: T.text }} />
            <button onClick={add} disabled={!draft.trim()} style={{ ...btn(), opacity: draft.trim() ? 1 : 0.5 }}>Add</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {[...new Set([...rooms, ...all])].slice(0, 30).map((r) => { const onIt = rooms.includes(r); return <button key={r} onClick={() => setRooms(onIt ? rooms.filter((x) => x !== r) : [...rooms, r])} style={chip(onIt)}>{onIt ? "✓ " : ""}{r}</button>; })}
          </div>
        </div>
        <div style={{ padding: "8px 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={() => onDone([])} style={{ ...btn("ghost"), flex: 1 }}>Whole house</button>
          <button onClick={() => onDone(rooms)} style={{ ...btn("gold"), flex: 2 }}>{rooms.length ? `Done · ${rooms.join(", ")}` : "Done"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
