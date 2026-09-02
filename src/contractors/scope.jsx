// 📄 Scope of Work builder — Elie's side only (approved 9/2/26). Pick lines
// from the library by category, mark each Included / As needed / To discuss,
// write your own lines (they join the library), talk to the AI, then share a
// versioned PDF by text, WhatsApp, email, link, or straight into a contractor's
// portal job. Edit and share again → version 2, changed lines highlighted.
//
// Data: property.sow = { v, items:[{id,libId,cat,text,status,note}], updatedAt,
//   updatedBy, snapshot:[{id,text,status}] (what version v looked like),
//   sent:[{v,at,by,how,to,url}] }
// Library changes: app_settings row "sow_library" (see sowLibrary.js).
import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "../theme";
import { useData } from "../data/DataProvider";
import { supabase } from "../supabaseClient";
import { notify, qbAuthFetch, uploadAttachment } from "../net";
import { useSmsTexting } from "../sms";
import { useContractorData } from "./data";
import { SOW_CATS, SOW_STATUS, NEXT_STATUS, SOW_MAT, matOf, catOf, libraryFrom, libAdd, libEdit, libRemove, scopeToText, scopeCounts } from "./sowLibrary";
import { sowPdfFile } from "./sowPdf";
import { SowPdfPreview } from "./SowPdfPreview";
import { useSpeechToText, micBtnStyle, micGlyph } from "../useSpeech";
import { useOneDrive } from "../onedrive/useOneDrive";

const uid = () => `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const addrOf = (p) => `${p.address || ""}${p.city ? `, ${p.city}` : ""}`;
const fmtWhen = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } };

// The team's library = seed + their row in app_settings.
function useSowLibrary() {
  const { appSettings, setAppSettings, flushAppSettings } = useData();
  const row = (appSettings || []).find((x) => x.id === "sow_library") || null;
  const items = useMemo(() => libraryFrom(row), [row]);
  const write = (next) => { setAppSettings([...(appSettings || []).filter((x) => x.id !== "sow_library"), next]); if (flushAppSettings) setTimeout(flushAppSettings, 0); };
  return {
    items,
    add: (cat, text) => { const { next, item } = libAdd(row, cat, text); write(next); return item; },
    edit: (id, text) => write(libEdit(row, id, text)),
    remove: (id) => write(libRemove(row, id)),
  };
}

// What changed since the last shared version — by line id, text or status.
export function changedSince(sow) { return diffSince(sow).changed; }
// Full diff: changed ids, the PREVIOUS wording of each changed line (so the
// PDF can show "was: …"), and lines that were in the last version but are
// gone now (shown struck through under their category).
export function diffSince(sow) {
  const snapArr = (sow && sow.snapshot) || [];
  const snap = new Map(snapArr.map((s) => [s.id, s]));
  const items = (sow && sow.items) || [];
  const changed = new Set();
  const prev = {};
  items.forEach((it) => {
    const s = snap.get(it.id);
    if (!s) { changed.add(it.id); return; }
    if (s.text !== it.text || s.status !== it.status || (s.note || "") !== (it.note || "") || (s.mat || "") !== (it.mat || "")) {
      changed.add(it.id);
      if (s.text !== it.text) prev[it.id] = s.text;
    }
  });
  const have = new Set(items.map((it) => it.id));
  const removed = snapArr.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, cat: s.cat || "general", text: s.text }));
  return { changed, prev, removed };
}

// One-line summary for the property's Contractors card.
export function scopeSummary(sow) {
  const items = (sow && sow.items) || [];
  if (!items.length) return "Not written yet — pick lines from your library";
  const n = scopeCounts(items);
  const last = ((sow && sow.sent) || []).slice(-1)[0];
  const changed = changedSince(sow).size;
  return [`${n.total} line${n.total === 1 ? "" : "s"}`, n.discuss ? `${n.discuss} to discuss` : "", n.asneeded ? `${n.asneeded} as needed` : "", sow.v ? `v${sow.v}${last ? ` sent ${fmtWhen(last.at)}` : ""}` : "not sent yet", changed && sow.v ? `${changed} changed since` : ""].filter(Boolean).join(" · ");
}

const btn = (kind) => ({
  padding: "9px 14px", borderRadius: 14, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", lineHeight: 1.2, minHeight: 38,
  ...(kind === "gold" ? { background: T.gold, color: "#fff", border: `1px solid ${T.gold}` }
    : kind === "ghost" ? { background: "transparent", color: T.textSub, border: `1px solid ${T.border}` }
    : { background: "#fff", color: T.text, border: `1px solid ${T.border}` }),
});
const chip = (on, color) => ({ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)", background: on ? "#fff" : "rgba(118,118,128,0.08)", color: on ? (color || T.gold) : T.textSub, fontWeight: on ? 650 : 500, fontSize: 12, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.12)" : "none", whiteSpace: "nowrap", minHeight: 34 });
const inp = { padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: T.text, width: "100%" };

function StatusChip({ status, onCycle, small }) {
  const st = SOW_STATUS[status] || SOW_STATUS.in;
  return (
    <button onClick={(e) => { e.stopPropagation(); onCycle(); }} title="Tap to change: Included → As needed → To discuss" style={{ flexShrink: 0, padding: small ? "4px 9px" : "5px 10px", borderRadius: 12, border: "none", background: st.bg, color: st.color, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.03em", cursor: "pointer", fontFamily: "inherit", minHeight: 28 }}>
      {status === "in" ? "INCLUDED" : st.short.toUpperCase()}
    </button>
  );
}

export function ScopeBuilder({ property, onUpdate, onClose }) {
  const { currentUser } = useData();
  const lib = useSowLibrary();
  const sow = property.sow || { v: 0, items: [], sent: [] };
  const items = sow.items || [];
  const setSow = (patch) => onUpdate(property.id, "sow", { v: 0, items: [], sent: [], ...sow, ...patch, updatedAt: new Date().toISOString(), updatedBy: currentUser });
  const setItems = (next) => setSow({ items: next });

  const [view, setView] = useState("pick"); // pick | review | preview
  const [cat, setCat] = useState(SOW_CATS[0].key);
  const [editing, setEditing] = useState(null); // {id, text, note, toLib}
  const [own, setOwn] = useState("");
  const [menuFor, setMenuFor] = useState(null); // scope/library item id with the ⋯ menu open
  const [share, setShare] = useState(false);
  const [err, setErr] = useState("");
  const [brief, setBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const itemsRef = useRef(items); itemsRef.current = items;

  const counts = scopeCounts(items);
  const diff = diffSince(sow);
  const changed = diff.changed;
  const byLib = useMemo(() => new Map(items.filter((it) => it.libId).map((it) => [it.libId, it])), [items]);
  const inCat = lib.items.filter((it) => it.cat === cat);
  const pickedInCat = inCat.filter((it) => byLib.has(it.id)).length + items.filter((it) => it.cat === cat && !it.libId).length;

  const toggleLib = (li) => {
    const have = byLib.get(li.id);
    if (have) setItems(items.filter((it) => it.id !== have.id));
    else setItems([...items, { id: uid(), libId: li.id, cat: li.cat, text: li.text, status: "in" }]);
  };
  const cycle = (id) => setItems(items.map((it) => (it.id === id ? { ...it, status: NEXT_STATUS[it.status || "in"] } : it)));
  const matDefault = sow.matDefault || "contractor";
  const setMat = (id, mat) => setItems(items.map((it) => (it.id === id ? { ...it, mat: mat === matDefault ? undefined : mat } : it)));
  const removeLine = (id) => setItems(items.filter((it) => it.id !== id));
  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) { setErr("The line can't be empty."); return; }
    if (editing.scopeId) setItems(items.map((it) => (it.id === editing.scopeId ? { ...it, text, note: editing.note.trim() } : it)));
    if (editing.toLib && editing.libId) lib.edit(editing.libId, text);
    setEditing(null);
  };
  const addOwn = () => {
    const text = own.trim(); if (!text) return;
    const item = lib.add(cat, text); // saved for next time
    setItems([...items, { id: uid(), libId: item.id, cat, text, status: "in" }]);
    setOwn("");
  };
  // ✨ Talk → structured lines merged in (library wording preferred by the AI).
  const genAi = async (briefText) => {
    const b = (typeof briefText === "string" ? briefText : brief).trim();
    if (!b) { setErr("Say what to add first — talk or type it."); return; }
    setAiBusy(true); setErr("");
    try {
      const d = await qbAuthFetch("/api/ai/sow-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: b, property: addrOf(property), cats: SOW_CATS.map((c) => c.key), library: lib.items.map((it) => ({ id: it.id, cat: it.cat, text: it.text })), current: itemsRef.current }) });
      let next = itemsRef.current.filter((it) => !(d.remove || []).includes(it.id));
      (d.items || []).forEach((ai) => {
        const have = ai.libId ? next.find((it) => it.libId === ai.libId) : next.find((it) => it.text.trim().toLowerCase() === ai.text.trim().toLowerCase());
        const matPatch = ai.mat ? { mat: ai.mat === matDefault ? undefined : ai.mat } : {};
        if (have) next = next.map((it) => (it.id === have.id ? { ...it, text: ai.text, status: ai.status, ...matPatch } : it));
        else next.push({ id: uid(), libId: ai.libId || null, cat: ai.cat, text: ai.text, status: ai.status, ...matPatch });
      });
      setItems(next); setBrief(""); setView("review");
    } catch (ex) { setErr(ex.message || "AI couldn't do that."); }
    setAiBusy(false);
  };
  const { recOn, busy: recBusy, toggleRec } = useSpeechToText({ value: brief, onText: setBrief, onError: setErr, onDone: genAi });

  const previewJob = useMemo(() => ({
    propertyAddress: addrOf(property), sowItems: items, sowVersion: (sow.v || 0) + (changed.size || !sow.v ? 1 : 0), sowChanged: sow.v ? [...changed] : [], sowPrev: sow.v ? diff.prev : {}, sowRemoved: sow.v ? diff.removed : [], sowLatestUrl: sow.latestUrl || "", sowMatDefault: matDefault,
    scopeEditedAt: sow.updatedAt || new Date().toISOString(), scopeEditedBy: sow.updatedBy || currentUser,
    scope: scopeToText(items, matDefault), scopeChangedLines: [...changed], // key fields for the preview's rebuild
  }), [items, sow.v, sow.latestUrl, sow.updatedAt, sow.updatedBy, changed.size, property.address, property.city, currentUser, matDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (it, li) => {
    // it = scope line (may be null when the library line isn't picked); li = library item (may be null for AI/custom-only lines)
    const picked = !!it;
    const id = it ? it.id : li.id;
    const isEditing = editing && (editing.scopeId === (it && it.id) && editing.libId === (li && li.id));
    return (
      <div key={id} style={{ borderTop: `1px solid ${T.border}` }}>
        <div onClick={() => (li ? toggleLib(li) : null)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px 10px 14px", minHeight: 48, cursor: li ? "pointer" : "default", background: picked ? "#FFFDF7" : "transparent" }}>
          <span style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, border: `2px solid ${picked ? T.gold : "#C7C7CC"}`, background: picked ? T.gold : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 800 }}>{picked ? "✓" : ""}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.3, color: T.text }}>
            {it ? it.text : li.text}
            {it && it.note && <span style={{ display: "block", fontSize: 11.5, color: T.textSub, marginTop: 2 }}>Note: {it.note}</span>}
            {it && matOf(it, matDefault) !== matDefault && <span style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.03em", color: "#8a6d1f", background: T.goldLight, borderRadius: 10, padding: "2px 7px", marginTop: 4 }}>🛒 {SOW_MAT[matOf(it, matDefault)].who.toUpperCase()} BUYS MATERIALS</span>}
            {li && li.custom && <span style={{ display: "block", fontSize: 10.5, color: T.textTert, marginTop: 2 }}>✎ your line</span>}
          </span>
          {picked && <StatusChip status={it.status} onCycle={() => cycle(it.id)} small />}
          <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === id ? null : id); }} title="More" style={{ width: 34, height: 34, borderRadius: 17, border: "none", background: menuFor === id ? "rgba(118,118,128,0.14)" : "transparent", color: T.textTert, fontSize: 18, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, lineHeight: 1 }}>⋯</button>
        </div>
        {menuFor === id && !isEditing && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 14px 10px 47px" }}>
            {it && <button onClick={() => { setMenuFor(null); setEditing({ scopeId: it.id, libId: it.libId || null, text: it.text, note: it.note || "", toLib: false }); }} style={btn()}>✎ Edit for this house</button>}
            {li && <button onClick={() => { setMenuFor(null); setEditing({ scopeId: it ? it.id : null, libId: li.id, text: it ? it.text : li.text, note: it ? it.note || "" : "", toLib: true }); }} style={btn()}>✎ Edit in library</button>}
            {it && <button onClick={() => { setMenuFor(null); setMat(it.id, matOf(it, matDefault) === "goldstone" ? "contractor" : "goldstone"); }} style={btn()}>🛒 {matOf(it, matDefault) === "goldstone" ? "Contractor buys materials" : "Goldstone buys materials"}</button>}
            {it && <button onClick={() => { setMenuFor(null); removeLine(it.id); }} style={btn("ghost")}>Take out of this scope</button>}
            {li && <button onClick={() => { if (!window.confirm(`Remove "${li.text.slice(0, 60)}" from your library?`)) return; setMenuFor(null); lib.remove(li.id); if (it) removeLine(it.id); }} style={{ ...btn("ghost"), color: T.red }}>🗑 Remove from library</button>}
          </div>
        )}
        {isEditing && (
          <div style={{ padding: "0 14px 12px 47px", display: "flex", flexDirection: "column", gap: 7 }}>
            <textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.4 }} autoFocus />
            {editing.scopeId && <input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="Note for the contractor (optional)" style={inp} />}
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {editing.libId && <label style={{ fontSize: 12, color: T.textSub, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={editing.toLib} onChange={(e) => setEditing({ ...editing, toLib: e.target.checked })} style={{ accentColor: T.gold, width: 16, height: 16 }} /> Also update my library</label>}
              <span style={{ flex: 1 }} />
              <button onClick={() => setEditing(null)} style={btn("ghost")}>Cancel</button>
              <button onClick={saveEdit} style={btn("gold")}>Save</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const card = { background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 12, overflow: "hidden" };
  const hd = (txt, right) => <div style={{ padding: "11px 14px 8px", fontSize: 12, fontWeight: 700, color: T.textSub, letterSpacing: "0.02em", display: "flex", alignItems: "center", gap: 8 }}>{txt}<span style={{ marginLeft: "auto", fontSize: 11, color: T.textTert, fontWeight: 600 }}>{right}</span></div>;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 470, background: T.bg, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "max(10px, env(safe-area-inset-top)) 14px 8px", background: T.card, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button onClick={onClose} title="Back" style={{ width: 36, height: 36, borderRadius: 18, border: `1px solid ${T.border}`, background: "rgba(118,118,128,0.08)", color: T.gold, fontSize: 20, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, lineHeight: 1 }}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text, lineHeight: 1.1 }}>Scope of Work</div>
          <div style={{ fontSize: 11.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addrOf(property)} · {scopeSummary(sow)}</div>
        </div>
        <button onClick={() => setView(view === "preview" ? "review" : "preview")} style={btn(view === "preview" ? "gold" : undefined)}>📄 {view === "preview" ? "Back" : "Preview"}</button>
        <button onClick={() => { if (!items.length) { setErr("Pick at least one line first."); return; } setShare(true); }} style={btn("gold")}>Share</button>
      </div>
      {/* Talk / type to the AI — pinned */}
      {view !== "preview" && (
        <div style={{ padding: "10px 14px", background: T.card, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {err && <div onClick={() => setErr("")} style={{ fontSize: 12.5, color: T.red, cursor: "pointer", marginBottom: 6 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={brief} onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => e.key === "Enter" && genAi()} placeholder={recOn ? "Recording… tap ◼ when done" : recBusy ? "Transcribing…" : aiBusy ? "Adding lines…" : "✨ Talk or type: \"gut both baths, windows as needed…\""} style={{ ...inp, flex: 1, ...(recOn ? { borderColor: T.red } : {}) }} />
            <button onClick={toggleRec} disabled={recBusy || aiBusy} title="Talk — when you stop, the lines get added" style={micBtnStyle(recOn, T)}>{micGlyph(recOn, recBusy)}</button>
            <button onClick={() => genAi()} disabled={aiBusy || !brief.trim()} style={{ ...btn(), opacity: aiBusy || !brief.trim() ? 0.5 : 1 }}>✨</button>
          </div>
          <div style={{ display: "flex", gap: 2, marginTop: 10, padding: 3, borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)" }}>
            {[["pick", "Pick lines"], ["review", `Review · ${counts.total}`]].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} style={{ flex: 1, padding: "7px 10px", borderRadius: 14, border: "none", background: view === k ? "#fff" : "transparent", color: view === k ? T.text : T.textSub, fontWeight: view === k ? 650 : 450, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: view === k ? "0 1px 4px rgba(0,0,0,0.14)" : "none", minHeight: 36 }}>{l}</button>
            ))}
          </div>
        </div>
      )}
      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 40px" }}>
        {view === "pick" && (
          <>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
              {SOW_CATS.map((c) => { const n = items.filter((it) => it.cat === c.key).length; return <button key={c.key} onClick={() => setCat(c.key)} style={chip(cat === c.key)}>{c.emoji} {c.label}{n ? ` · ${n}` : ""}</button>; })}
            </div>
            <div style={card}>
              {hd(catOf(cat).long, `${pickedInCat} of ${inCat.length + items.filter((it) => it.cat === cat && !it.libId).length} picked`)}
              {inCat.map((li) => row(byLib.get(li.id) || null, li))}
              {items.filter((it) => it.cat === cat && !it.libId).map((it) => row(it, null))}
              <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 14px", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <textarea value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addOwn(); } }} rows={1} placeholder="＋ Write your own line… (saved to your library)" style={{ ...inp, resize: "none", lineHeight: 1.4, minHeight: 40 }} />
                <button onClick={addOwn} disabled={!own.trim()} style={{ ...btn("gold"), opacity: own.trim() ? 1 : 0.5 }}>Add</button>
              </div>
            </div>
          </>
        )}
        {view === "review" && (
          <>
            {!items.length && <div style={{ padding: "46px 20px", textAlign: "center", color: T.textTert, fontSize: 13.5, lineHeight: 1.6 }}>Nothing picked yet.<br />Go to Pick lines, or tap the mic and describe the job.</div>}
            {!!items.length && (
              <div style={{ ...card, padding: "10px 14px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 7 }}>🛒 MATERIALS — who buys them unless a line says otherwise</div>
                <div style={{ display: "flex", gap: 2, padding: 3, borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)" }}>
                  {[["contractor", "Contractor buys"], ["goldstone", "Goldstone buys"]].map(([k, l]) => (
                    <button key={k} onClick={() => setSow({ matDefault: k })} style={{ flex: 1, padding: "7px 10px", borderRadius: 14, border: "none", background: matDefault === k ? "#fff" : "transparent", color: matDefault === k ? T.text : T.textSub, fontWeight: matDefault === k ? 650 : 450, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: matDefault === k ? "0 1px 4px rgba(0,0,0,0.14)" : "none", minHeight: 36 }}>{l}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 7, lineHeight: 1.4 }}>Flip a single line the other way from its ⋯ menu — it gets a tag in the PDF.</div>
              </div>
            )}
            {!!items.length && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={chip(true, T.text)}>{counts.total} lines</span>
                {counts.asneeded > 0 && <span style={{ ...chip(true, SOW_STATUS.asneeded.color) }}>{counts.asneeded} as needed</span>}
                {counts.discuss > 0 && <span style={{ ...chip(true, SOW_STATUS.discuss.color) }}>{counts.discuss} to discuss</span>}
                {sow.v > 0 && changed.size > 0 && <span style={chip(true, "#B45309")}>{changed.size} changed since v{sow.v}</span>}
              </div>
            )}
            {SOW_CATS.map((c) => {
              const rows = items.filter((it) => it.cat === c.key);
              if (!rows.length) return null;
              return (
                <div key={c.key} style={card}>
                  {hd(c.long, `${rows.length}`)}
                  {rows.map((it) => row(it, it.libId ? lib.items.find((l) => l.id === it.libId) || null : null))}
                </div>
              );
            })}
            {(sow.sent || []).length > 0 && (
              <div style={card}>
                {hd("SENT")}
                {(sow.sent || []).slice().reverse().slice(0, 8).map((s, i) => (
                  <div key={i} style={{ borderTop: `1px solid ${T.border}`, padding: "9px 14px", fontSize: 12.5, color: T.textSub, display: "flex", gap: 8 }}>
                    <b style={{ color: T.text }}>v{s.v}</b><span style={{ flex: 1 }}>{s.how}{s.to ? ` → ${s.to}` : ""}</span><span style={{ color: T.textTert }}>{fmtWhen(s.at)}{s.by ? ` · ${String(s.by).split(" ")[0]}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {view === "preview" && (items.length ? <SowPdfPreview job={previewJob} /> : <div style={{ padding: 40, textAlign: "center", color: T.textTert }}>Pick some lines first.</div>)}
      </div>
      {share && <ShareSheet property={property} sow={sow} items={items} changed={changed} previewJob={previewJob} currentUser={currentUser} setSow={setSow} onClose={() => setShare(false)} />}
    </div>
  );
}

// ── Share: build the PDF once, then send it any way you like. The first send
// of a build commits the version (v+1) and snapshots the lines for the next
// "what changed" highlight; more sends of the same build reuse it.
async function uploadLatest(propertyId, file) {
  const path = `sow/latest-${propertyId}.pdf`;
  const { error } = await supabase.storage.from("attachments").upload(path, file, { contentType: "application/pdf", upsert: true, cacheControl: "60" });
  if (error) throw error;
  return supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
}

function ShareSheet({ property, sow, items, changed, previewJob, currentUser, setSow, onClose }) {
  const { orgs, jobs, save: ctrSave } = useContractorData();
  const { send: smsSend, connected: smsOn } = useSmsTexting();
  const od = useOneDrive();
  const folder = property.filesFolder && property.filesFolder.driveId ? property.filesFolder : null;
  const [highlight, setHighlight] = useState(true);
  const [built, setBuilt] = useState(null); // {file, url, latestUrl, v}
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [textTo, setTextTo] = useState("");
  const [mode, setMode] = useState(null); // null | text | email | wa | portal
  const addr = addrOf(property);
  const pJobs = (jobs || []).filter((j) => String(j.propertyId) === String(property.id) && j.status !== "removed");
  const orgOf = (id) => (orgs || []).find((o) => String(o.id) === String(id)) || null;
  const needsBump = !sow.v || changed.size > 0;
  const nextV = needsBump ? (sow.v || 0) + 1 : sow.v;

  const build = async () => {
    if (built && built.highlight === highlight) return built;
    setBusy("Building the PDF…"); setErr("");
    try {
      const latestUrlGuess = sow.latestUrl || supabase.storage.from("attachments").getPublicUrl(`sow/latest-${property.id}.pdf`).data.publicUrl;
      const job = { ...previewJob, sowVersion: nextV, sowChanged: highlight && sow.v ? [...changed] : [], sowPrev: highlight && sow.v ? previewJob.sowPrev : {}, sowRemoved: highlight && sow.v ? previewJob.sowRemoved : [], sowLatestUrl: latestUrlGuess };
      const file = await sowPdfFile(job);
      const up = await uploadAttachment(file, "sow");
      let latestUrl = latestUrlGuess;
      try { latestUrl = await uploadLatest(property.id, file); } catch { /* the versioned link still works */ }
      const b = { file, url: up.url, latestUrl, v: nextV, highlight, filed: "" };
      // 📁 A copy of every version goes into the property's OneDrive Files
      // folder (Elie 9/2/26): "Scope of Work v2 — UPDATED Sep 4 …", with the
      // changes highlighted inside. Best-effort — the share still goes out.
      if (folder && od.isConnected) {
        setBusy("Saving a copy to Files…");
        try {
          const day = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
          const named = new File([file], `Scope of Work v${nextV}${nextV > 1 ? ` — UPDATED ${day}` : ` — ${day}`}.pdf`, { type: "application/pdf" });
          await od.uploadFile(folder.driveId, folder.id, named);
          b.filed = named.name;
        } catch { b.filed = ""; }
      }
      setBuilt(b); setBusy("");
      return b;
    } catch (ex) { setErr(ex.message || "Couldn't build the PDF."); setBusy(""); return null; }
  };
  // Record a send: commits the version on the first send of this build.
  const record = (b, how, to) => {
    const entry = { v: b.v, at: new Date().toISOString(), by: currentUser, how, to: to || "", url: b.url };
    const committed = sow.v === b.v;
    setSow({
      v: b.v, latestUrl: b.latestUrl,
      snapshot: committed ? sow.snapshot : items.map((it) => ({ id: it.id, cat: it.cat, text: it.text, status: it.status, note: it.note || "", mat: it.mat || "" })),
      sent: [...(sow.sent || []), { ...entry, ...(b.filed ? { filed: b.filed } : {}) }],
    });
    setDone(`Sent v${b.v} ${how}${to ? ` → ${to}` : ""}${b.filed ? " · copy saved to Files" : folder ? "" : " · (no Files folder linked, copy not saved)"}`);
  };
  const msgText = (b) => `Scope of Work v${b.v} — ${addr}\n${b.url}\n(Always latest: ${b.latestUrl})`;

  const doText = async () => {
    const digits = textTo.replace(/\D/g, "");
    if (digits.length < 10) { setErr("Enter a 10-digit number."); return; }
    const b = await build(); if (!b) return;
    setBusy("Texting…");
    try { await smsSend(digits.length === 10 ? `+1${digits}` : `+${digits}`, msgText(b), undefined, addr); record(b, "by text", textTo); }
    catch (ex) { setErr(ex.message || "Text didn't go."); }
    setBusy(""); setMode(null);
  };
  const doWa = async (phone) => {
    const b = await build(); if (!b) return;
    const digits = String(phone || "").replace(/\D/g, "");
    window.open(`https://wa.me/${digits ? (digits.length === 10 ? "1" + digits : digits) : ""}?text=${encodeURIComponent(msgText(b))}`, "_blank");
    record(b, "on WhatsApp", phone || "");
  };
  const doEmail = async (email) => {
    const b = await build(); if (!b) return;
    window.location.href = `mailto:${email || ""}?subject=${encodeURIComponent(`Scope of Work v${b.v} — ${addr}`)}&body=${encodeURIComponent(`Hi,\n\nHere is the scope of work for ${addr} (version ${b.v}):\n${b.url}\n\nThis link always opens the latest version:\n${b.latestUrl}\n\nLines marked TO DISCUSS need a quick call before pricing.\n\nThanks,\n${currentUser}`)}`;
    record(b, "by email", email || "");
  };
  const doCopy = async () => {
    const b = await build(); if (!b) return;
    try { await navigator.clipboard.writeText(b.url); setDone(`Link copied (v${b.v})`); } catch { setErr("Couldn't copy — long-press the link instead."); }
    record(b, "link copied", "");
  };
  const doNative = async () => {
    const b = await build(); if (!b) return;
    try {
      if (navigator.canShare && navigator.canShare({ files: [b.file] })) await navigator.share({ files: [b.file], title: `Scope of Work v${b.v} — ${addr}` });
      else await navigator.share({ title: `Scope of Work v${b.v} — ${addr}`, url: b.url });
      record(b, "shared", "");
    } catch { /* cancelled */ }
  };
  const doPortal = async (j) => {
    const b = await build(); if (!b) return;
    setBusy("Sending to their portal…");
    try {
      const text = scopeToText(items, sow.matDefault || "contractor");
      await ctrSave("contractor_jobs", { ...j, scope: text, sowItems: items, sowMatDefault: sow.matDefault || "contractor", sowVersion: b.v, sowPdfUrl: b.url, sowPdfName: b.file.name, scopeChangedLines: [], scopeEditedAt: new Date().toISOString(), scopeEditedBy: currentUser });
      ctrSave("contractor_docs", { id: Date.now() + 1, jobId: j.id, orgId: j.orgId, name: b.file.name, url: b.url, mime: "application/pdf", by: currentUser, at: new Date().toISOString() }).catch(() => {});
      ctrSave("contractor_messages", { id: Date.now() + 2, jobId: j.id, orgId: j.orgId, author: currentUser, side: "team", text: `📄 Scope of Work v${b.v} — ${b.v > 1 ? "updated, changed lines are highlighted" : "please review and price it"}.`, at: new Date().toISOString(), readBy: [currentUser], attachment: { url: b.url, name: b.file.name, mime: "application/pdf", kind: "file" } }).catch(() => {});
      notify(null, { toOrg: j.orgId, title: b.v > 1 ? "Scope of work updated" : "Scope of work ready", body: `${addr}${j.title ? ` — ${j.title}` : ""} — open the PDF on the job.`, url: `/?goto=job:${j.id}` });
      record(b, "to portal", (orgOf(j.orgId) || {}).name || "");
    } catch (ex) { setErr(ex.message || "Couldn't send to the portal."); }
    setBusy(""); setMode(null);
  };

  const opt = (icon, label, sub, onClick) => (
    <button onClick={onClick} disabled={!!busy} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "11px 14px", minHeight: 52, border: "none", borderTop: `1px solid ${T.border}`, background: "transparent", cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, background: T.goldLight, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 14.5, fontWeight: 650, color: T.text }}>{label}</span>{sub && <span style={{ display: "block", fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{sub}</span>}</span>
      <span style={{ color: T.textTert, fontSize: 18 }}>›</span>
    </button>
  );
  const contacts = (orgs || []).filter((o) => o.phone || o.email);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 480, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(255,255,255,0.94)", backdropFilter: "blur(20px)", width: "min(520px,100vw)", maxHeight: "88vh", borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px 8px", flexShrink: 0 }}>
          <div style={{ width: 38, height: 5, borderRadius: 3, background: "#C7C7CC", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Share Scope of Work {needsBump ? `v${nextV}` : `v${sow.v}`}</div>
              <div style={{ fontSize: 11.5, color: T.textSub }}>{addr} · {items.length} lines{changed.size && sow.v ? ` · ${changed.size} changed since v${sow.v}` : ""}</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 17, border: "none", background: "rgba(118,118,128,0.1)", color: T.textSub, fontSize: 18, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>×</button>
          </div>
          {sow.v > 0 && changed.size > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={highlight} onChange={(e) => { setHighlight(e.target.checked); setBuilt(null); }} style={{ accentColor: T.gold, width: 17, height: 17 }} /> Highlight the {changed.size} changed line{changed.size === 1 ? "" : "s"} in the PDF
            </label>
          )}
          {(busy || err || done) && <div style={{ marginTop: 8, fontSize: 12.5, color: err ? T.red : done ? "#0F9D58" : T.textSub }}>{busy || err || done}</div>}
        </div>
        <div style={{ overflowY: "auto", flex: 1, paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          {mode === null && (
            <>
              {opt("💬", "Text it", smsOn ? "From your Goldstone line — link to the PDF" : "Texting isn't connected on this account", () => { if (!smsOn) { setErr("Texting isn't connected on this account."); return; } setMode("text"); })}
              {opt("📱", "WhatsApp", "Opens WhatsApp with the link ready", () => setMode("wa"))}
              {opt("✉️", "Email it", "Opens your mail app with the link", () => setMode("email"))}
              {opt("👷", "Send to their portal", pJobs.length ? `${pJobs.length} job${pJobs.length === 1 ? "" : "s"} on this property` : "No portal job on this property yet — use 🧾 Request a bid", () => { if (!pJobs.length) { setErr("No portal job here yet — send a 🧾 Request a bid from the Contractors tab first."); return; } setMode("portal"); })}
              {opt("🔗", "Copy the link", "Paste it anywhere", doCopy)}
              {typeof navigator !== "undefined" && navigator.share && opt("⬆️", "More…", "AirDrop, Messages, Drive — your phone's share sheet", doNative)}
            </>
          )}
          {mode === "text" && (
            <div style={{ padding: "6px 16px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 8 }}>TEXT TO</div>
              {contacts.filter((o) => o.phone).map((o) => <button key={o.id} onClick={() => setTextTo(o.phone)} style={{ ...chip(textTo === o.phone), marginRight: 6, marginBottom: 6 }}>{o.name}</button>)}
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input value={textTo} onChange={(e) => setTextTo(e.target.value)} placeholder="Phone number" inputMode="tel" style={{ ...inp, flex: 1 }} />
                <button onClick={doText} disabled={!!busy} style={btn("gold")}>Send</button>
              </div>
              <button onClick={() => setMode(null)} style={{ ...btn("ghost"), marginTop: 10 }}>‹ Back</button>
            </div>
          )}
          {(mode === "wa" || mode === "email") && (
            <div style={{ padding: "6px 16px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 8 }}>{mode === "wa" ? "WHATSAPP TO" : "EMAIL TO"}</div>
              {contacts.filter((o) => (mode === "wa" ? o.phone : o.email)).map((o) => <button key={o.id} onClick={() => (mode === "wa" ? doWa(o.phone) : doEmail(o.email))} style={{ ...chip(false), marginRight: 6, marginBottom: 6 }}>{o.name}</button>)}
              <button onClick={() => (mode === "wa" ? doWa("") : doEmail(""))} style={{ ...btn(), display: "block", marginTop: 6 }}>{mode === "wa" ? "Pick the person in WhatsApp" : "Type the address in my mail app"}</button>
              <button onClick={() => setMode(null)} style={{ ...btn("ghost"), marginTop: 10 }}>‹ Back</button>
            </div>
          )}
          {mode === "portal" && (
            <div style={{ padding: "6px 0 14px" }}>
              {pJobs.map((j) => opt("🏗", `${(orgOf(j.orgId) || {}).name || "Contractor"}${j.title ? ` — ${j.title}` : ""}`, j.status === "bid" ? "Bid request · they price each line in their portal" : `Active job${j.sowVersion ? ` · has v${j.sowVersion}` : ""}`, () => doPortal(j)))}
              <div style={{ padding: "10px 16px 0" }}><button onClick={() => setMode(null)} style={btn("ghost")}>‹ Back</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
