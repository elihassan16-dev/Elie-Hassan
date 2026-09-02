// 🎨 Finish Spec Sheet — lives inside the Scope of Work builder as the
// "Finishes" view (Elie 9/2/26). Each finish is a card: photo (pasted, taken,
// uploaded, or pulled from a product link), a description in Elie's words,
// an optional link, who buys it, or "contractor to choose — Goldstone
// approves". Everything added is pinned to "My picks" by category so the
// next house is one tap. Prints as a section of the same PDF.
//
// Data: property.spec = { items:[{id, cat, title, desc, link, photo, buyer,
//   choose, price, pickId, at}] }
// Picks: app_settings row "spec_picks" { items:[{id, cat, title, desc, link,
//   photo, price, at, usedOn:[address]}] }
import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "../theme";
import { useData } from "../data/DataProvider";
import { qbAuthFetch, uploadAttachment } from "../net";
import { SPEC_CATS } from "./sowLibrary";
export { SPEC_CATS };
export const specCatOf = (k) => SPEC_CATS.find((c) => c.key === k) || SPEC_CATS[SPEC_CATS.length - 1];
export const SPEC_BUYER = { goldstone: "GOLDSTONE BUYS", contractor: "CONTRACTOR BUYS" };
const uid = () => `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Pull every photo into a data URL so jsPDF can draw it (public storage
// bucket + retailer images; anything that won't load is skipped quietly).
export async function loadSpecImages(items) {
  const out = {};
  await Promise.all((items || []).filter((it) => it.photo).map(async (it) => {
    try {
      const r = await fetch(it.photo, { mode: "cors" });
      const blob = await r.blob();
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      // Downscale so the PDF stays small.
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = data; });
      const c = document.createElement("canvas"); const s = Math.min(1, 360 / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      out[it.id] = { data: c.toDataURL("image/jpeg", 0.8), w: c.width, h: c.height };
    } catch { /* no picture in the PDF for this one */ }
  }));
  return out;
}

function useSpecPicks() {
  const { appSettings, setAppSettings, flushAppSettings } = useData();
  const row = (appSettings || []).find((x) => x.id === "spec_picks") || null;
  const items = useMemo(() => (row && row.items) || [], [row]);
  const write = (next) => { setAppSettings([...(appSettings || []).filter((x) => x.id !== "spec_picks"), { id: "spec_picks", items: next.slice(-600) }]); if (flushAppSettings) setTimeout(flushAppSettings, 0); };
  return {
    items,
    pin: (it, usedOn) => {
      const same = items.find((p) => p.id === it.pickId || (p.title === it.title && p.cat === it.cat));
      if (same) { write(items.map((p) => (p.id === same.id ? { ...p, ...(usedOn && !(p.usedOn || []).includes(usedOn) ? { usedOn: [...(p.usedOn || []), usedOn] } : {}) } : p))); return same.id; }
      const id = `p-${Date.now().toString(36)}`;
      write([...items, { id, cat: it.cat, title: it.title, desc: it.desc || "", link: it.link || "", photo: it.photo || "", price: it.price || "", at: new Date().toISOString(), usedOn: usedOn ? [usedOn] : [] }]);
      return id;
    },
    unpin: (id) => write(items.filter((p) => p.id !== id)),
  };
}

const btn = (kind) => ({
  padding: "9px 14px", borderRadius: 14, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", lineHeight: 1.2, minHeight: 38,
  ...(kind === "gold" ? { background: T.gold, color: "#fff", border: `1px solid ${T.gold}` } : kind === "ghost" ? { background: "transparent", color: T.textSub, border: `1px solid ${T.border}` } : { background: "#fff", color: T.text, border: `1px solid ${T.border}` }),
});
const chip = (on, color) => ({ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)", background: on ? "#fff" : "rgba(118,118,128,0.08)", color: on ? (color || T.gold) : T.textSub, fontWeight: on ? 650 : 500, fontSize: 12, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.12)" : "none", whiteSpace: "nowrap", minHeight: 34 });
const inp = { padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: T.text, width: "100%" };
const tag = (txt, bg, fg) => <span style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.03em", color: fg, background: bg, borderRadius: 10, padding: "2px 7px" }}>{txt}</span>;

function Photo({ src, size = 64, radius = 12, empty = "📷" }) {
  return src
    ? <img src={src} alt="" style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0, background: "#EEE" }} />
    : <span style={{ width: size, height: size, borderRadius: radius, background: T.bg, border: `1.5px dashed ${T.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size / 3, color: T.textTert, flexShrink: 0 }}>{empty}</span>;
}

export function FinishesView({ property, spec, setSpec, isWide, sidebar }) {
  const { currentUser } = useData();
  const picks = useSpecPicks();
  const items = (spec && spec.items) || [];
  const [cat, setCat] = useState("flooring");
  const [form, setForm] = useState(null); // null | {id?, cat, title, desc, link, photo, buyer, choose, price}
  const addr = `${property.address || ""}${property.city ? `, ${property.city}` : ""}`;
  const inCat = items.filter((it) => it.cat === cat);
  const picksInCat = picks.items.filter((p) => p.cat === cat && !items.some((it) => it.pickId === p.id));
  const setItems = (next) => setSpec({ ...(spec || {}), items: next });

  const startAdd = () => setForm({ cat, title: "", desc: "", link: "", photo: "", buyer: "goldstone", choose: false, price: "" });
  const usePick = (p) => setItems([...items, { id: uid(), cat: p.cat, title: p.title, desc: p.desc || "", link: p.link || "", photo: p.photo || "", price: p.price || "", buyer: "goldstone", choose: false, pickId: p.id, at: new Date().toISOString() }]);
  const save = (f) => {
    const title = (f.title || "").trim();
    if (!title && !f.choose && !f.photo) return;
    const base = { cat: f.cat, title: title || (f.choose ? "Contractor's choice" : "Finish"), desc: (f.desc || "").trim(), link: (f.link || "").trim(), photo: f.photo || "", price: (f.price || "").trim(), buyer: f.buyer, choose: !!f.choose };
    if (f.id) setItems(items.map((it) => (it.id === f.id ? { ...it, ...base } : it)));
    else {
      const pickId = !f.choose ? picks.pin(base, addr) : null; // your picks, saved for next time
      setItems([...items, { id: uid(), ...base, pickId, at: new Date().toISOString(), by: currentUser }]);
    }
    setForm(null);
  };

  const catList = SPEC_CATS.map((c) => ({ ...c, n: items.filter((it) => it.cat === c.key).length }));
  const card = { background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 12, overflow: "hidden" };

  const itemRow = (it) => (
    <div key={it.id} style={{ display: "flex", gap: 12, padding: "12px 14px", borderTop: `1px solid ${T.border}`, alignItems: "flex-start" }}>
      <Photo src={it.photo} empty={it.choose ? "👷" : "📷"} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text, lineHeight: 1.25 }}>{it.title}{it.price ? <span style={{ fontWeight: 500, color: T.textSub }}> · {it.price}</span> : null}</div>
        {it.desc && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 3, lineHeight: 1.4 }}>{it.desc}</div>}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          {it.choose ? tag("CONTRACTOR TO CHOOSE · GOLDSTONE APPROVES", "#FDE9C8", "#B45309") : it.buyer === "contractor" ? tag(SPEC_BUYER.contractor, "#E8F4FF", "#0A66C2") : tag(SPEC_BUYER.goldstone, T.goldLight, "#8a6d1f")}
          {it.link && <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: T.blue, textDecoration: "none", fontWeight: 600 }}>🔗 Open product</a>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        <button onClick={() => setForm({ ...it })} style={{ ...btn(), padding: "6px 10px", minHeight: 32, fontSize: 12 }}>✎</button>
        <button onClick={() => setItems(items.filter((x) => x.id !== it.id))} style={{ ...btn("ghost"), padding: "6px 10px", minHeight: 32, fontSize: 12, color: T.red }}>×</button>
      </div>
    </div>
  );

  const catNav = isWide ? (
    <div style={{ width: 220, flexShrink: 0 }}>
      {catList.map((c) => (
        <button key={c.key} onClick={() => setCat(c.key)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 12, border: "none", background: cat === c.key ? "#fff" : "transparent", color: cat === c.key ? T.text : T.textSub, fontWeight: cat === c.key ? 700 : 500, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", boxShadow: cat === c.key ? "0 1px 4px rgba(0,0,0,0.12)" : "none", minHeight: 42 }}>
          <span>{c.emoji}</span><span style={{ flex: 1 }}>{c.label}</span>{c.n > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#8a6d1f", background: T.goldLight, borderRadius: 10, padding: "1px 7px" }}>{c.n}</span>}
        </button>
      ))}
    </div>
  ) : (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
      {catList.map((c) => <button key={c.key} onClick={() => setCat(c.key)} style={chip(cat === c.key)}>{c.emoji} {c.label}{c.n ? ` · ${c.n}` : ""}</button>)}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexDirection: isWide ? "row" : "column" }}>
      {sidebar ? sidebar(catNav) : catNav}
      <div style={{ flex: 1, minWidth: 0, width: "100%" }}>
        <div style={card}>
          <div style={{ padding: "11px 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textSub, letterSpacing: "0.02em", flex: 1 }}>{specCatOf(cat).emoji} {specCatOf(cat).label.toUpperCase()} — THIS HOUSE</span>
            <button onClick={startAdd} style={btn("gold")}>＋ Add</button>
          </div>
          {inCat.length === 0 && <div style={{ padding: "6px 14px 14px", fontSize: 12.5, color: T.textTert, lineHeight: 1.45 }}>Nothing picked for {specCatOf(cat).label.toLowerCase()} yet. Add one, or tap a saved pick below.</div>}
          {inCat.map(itemRow)}
        </div>
        <div style={card}>
          <div style={{ padding: "11px 14px 8px", fontSize: 12, fontWeight: 700, color: T.textSub, letterSpacing: "0.02em" }}>📌 MY PICKS — {specCatOf(cat).label.toUpperCase()} <span style={{ fontWeight: 500, color: T.textTert }}>· tap to use here</span></div>
          {picksInCat.length === 0 && <div style={{ padding: "0 14px 14px", fontSize: 12.5, color: T.textTert }}>Everything you add gets saved here with its picture.</div>}
          {picksInCat.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isWide ? 150 : 110}px, 1fr))`, gap: 10, padding: "4px 14px 14px" }}>
              {picksInCat.map((p) => (
                <div key={p.id} style={{ position: "relative" }}>
                  <button onClick={() => usePick(p)} style={{ width: "100%", textAlign: "left", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: 8, cursor: "pointer", fontFamily: "inherit" }}>
                    {p.photo ? <img src={p.photo} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, display: "block", background: "#EEE" }} /> : <div style={{ width: "100%", aspectRatio: "1", borderRadius: 8, background: "#fff", border: `1.5px dashed ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: T.textTert }}>📷</div>}
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginTop: 6, lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.title}</div>
                    {(p.price || (p.usedOn || []).length > 0) && <div style={{ fontSize: 10.5, color: T.textTert, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[p.price, (p.usedOn || []).length ? `used on ${(p.usedOn || []).slice(-2).map((a) => String(a).split(",")[0]).join(", ")}` : ""].filter(Boolean).join(" · ")}</div>}
                  </button>
                  <button onClick={() => { if (window.confirm(`Remove "${p.title}" from My picks?`)) picks.unpin(p.id); }} title="Remove from My picks" style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {form && <FinishForm form={form} setForm={setForm} onSave={save} onClose={() => setForm(null)} />}
    </div>
  );
}

function FinishForm({ form, setForm, onSave, onClose }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const up = (patch) => setForm((f) => ({ ...f, ...patch }));
  const upload = async (file) => {
    if (!file) return;
    setBusy("Uploading the picture…"); setErr("");
    try { const a = await uploadAttachment(file, "spec"); up({ photo: a.url }); }
    catch (ex) { setErr(ex.message || "Couldn't upload that picture."); }
    setBusy("");
  };
  // ⌘V / long-press-paste a picture straight into the form.
  const onPaste = (e) => {
    const f = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (f) { e.preventDefault(); upload(f.getAsFile()); }
  };
  const fetchLink = async () => {
    const url = (form.link || "").trim(); if (!url) return;
    setBusy("Reading the product page…"); setErr("");
    try {
      const d = await qbAuthFetch(`/api/spec/link?url=${encodeURIComponent(url)}`);
      const patch = {};
      if (d.image && !form.photo) patch.photo = d.image;
      if (d.title && !form.title.trim()) patch.title = d.title;
      if (d.desc && !form.desc.trim()) patch.desc = d.desc;
      if (d.price && !form.price) patch.price = d.price;
      if (!d.image && !d.title) setErr(d.blocked ? "That store blocks automatic visitors — add a photo yourself (screenshot works)." : d.error || "Couldn't get a picture from that link — add one yourself.");
      up(patch);
    } catch (ex) { setErr(ex.message || "Couldn't read that link."); }
    setBusy("");
  };
  useEffect(() => { document.addEventListener("paste", onPaste); return () => document.removeEventListener("paste", onPaste); }); // eslint-disable-line react-hooks/exhaustive-deps
  const lbl = (t) => <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, margin: "10px 0 5px" }}>{t}</div>;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 480, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(255,255,255,0.96)", backdropFilter: "blur(20px)", width: "min(560px,100vw)", maxHeight: "92vh", borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
          <div style={{ width: 38, height: 5, borderRadius: 3, background: "#C7C7CC", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, fontSize: 16, fontWeight: 800, color: T.text }}>{form.id ? "Edit finish" : "Add a finish"} · {specCatOf(form.cat).label}</div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 17, border: "none", background: "rgba(118,118,128,0.1)", color: T.textSub, fontSize: 18, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>×</button>
          </div>
          {(busy || err) && <div style={{ marginTop: 6, fontSize: 12.5, color: err ? T.red : T.textSub }}>{busy || err}</div>}
        </div>
        <div style={{ overflowY: "auto", padding: "0 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 4px", padding: "10px 12px", borderRadius: 12, background: form.choose ? "#FDE9C8" : T.bg, border: `1px solid ${form.choose ? "#E8B45A" : T.border}`, cursor: "pointer" }}>
            <input type="checkbox" checked={!!form.choose} onChange={(e) => up({ choose: e.target.checked })} style={{ accentColor: T.gold, width: 18, height: 18 }} />
            <span style={{ fontSize: 13, color: T.text, lineHeight: 1.35 }}><b>👷 Contractor to choose</b> — they send their pick to Goldstone for approval</span>
          </label>
          {lbl("PICTURE")}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Photo src={form.photo} size={84} empty={form.choose ? "👷" : "📷"} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              <button onClick={() => fileRef.current && fileRef.current.click()} style={btn()}>📷 Take or choose a photo</button>
              <div style={{ fontSize: 11.5, color: T.textTert, lineHeight: 1.4 }}>Or paste a picture from your clipboard anywhere on this form. Or paste a link below and tap ⬇ Get picture.</div>
              {form.photo && <button onClick={() => up({ photo: "" })} style={{ ...btn("ghost"), alignSelf: "flex-start", padding: "5px 10px", minHeight: 30, fontSize: 12 }}>Remove picture</button>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { upload(e.target.files && e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
          </div>
          {lbl("LINK (optional)")}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.link} onChange={(e) => up({ link: e.target.value })} placeholder="Paste the product page link" inputMode="url" style={{ ...inp, flex: 1 }} />
            <button onClick={fetchLink} disabled={!form.link.trim() || !!busy} style={{ ...btn(), opacity: form.link.trim() && !busy ? 1 : 0.5 }}>⬇ Get picture</button>
          </div>
          {lbl("WHAT IT IS")}
          <input value={form.title} onChange={(e) => up({ title: e.target.value })} placeholder={form.choose ? "e.g. Bath floor tile — contractor picks" : "e.g. LVP — Lifeproof Sterling Oak, 7mm"} style={inp} />
          {lbl("DESCRIPTION / WHERE IT GOES")}
          <textarea value={form.desc} onChange={(e) => up({ desc: e.target.value })} rows={2} placeholder="Whole house except baths · color, size, finish, quantity…" style={{ ...inp, resize: "vertical", lineHeight: 1.4 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>{lbl("PRICE (optional)")}<input value={form.price} onChange={(e) => up({ price: e.target.value })} placeholder="$3.10/sf" style={inp} /></div>
            <div style={{ flex: 1 }}>{lbl("CATEGORY")}
              <select value={form.cat} onChange={(e) => up({ cat: e.target.value })} style={{ ...inp, appearance: "auto" }}>{SPEC_CATS.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}</select>
            </div>
          </div>
          {!form.choose && (<>
            {lbl("WHO BUYS IT")}
            <div style={{ display: "flex", gap: 2, padding: 3, borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)" }}>
              {[["goldstone", "Goldstone buys"], ["contractor", "Contractor buys"]].map(([k, l]) => (
                <button key={k} onClick={() => up({ buyer: k })} style={{ flex: 1, padding: "7px 10px", borderRadius: 14, border: "none", background: form.buyer === k ? "#fff" : "transparent", color: form.buyer === k ? T.text : T.textSub, fontWeight: form.buyer === k ? 650 : 450, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: form.buyer === k ? "0 1px 4px rgba(0,0,0,0.14)" : "none", minHeight: 36 }}>{l}</button>
              ))}
            </div>
          </>)}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={onClose} style={{ ...btn("ghost"), flex: 1 }}>Cancel</button>
            <button onClick={() => onSave(form)} disabled={!!busy || (!form.title.trim() && !form.choose && !form.photo)} style={{ ...btn("gold"), flex: 2, opacity: busy || (!form.title.trim() && !form.choose && !form.photo) ? 0.5 : 1 }}>{form.id ? "Save" : "Add to this house"}</button>
          </div>
          {!form.id && !form.choose && <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 8, textAlign: "center" }}>Also saved to My picks for next time.</div>}
        </div>
      </div>
    </div>
  );
}
