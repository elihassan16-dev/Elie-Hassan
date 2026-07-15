// Per-chat media gallery — every photo & video ever sent in the thread, newest
// first, in one grid. Shared by the team app (which tags items that came from
// the external contractor thread and lets admins select-and-delete) and the
// contractor portal (view-only, no tags — it's all one chat to them).
import { useState } from "react";
import { T } from "./theme";

// Pull media out of a message list. Handles single attachments and photo grids
// ({kind:"images", items}). `extOf(m)` returns a label when the message came
// from the external thread (null/undefined = internal).
export function collectMedia(messages, extOf) {
  const out = [];
  (messages || []).forEach((m) => {
    const att = m.attachment;
    if (!att) return;
    const base = { msgId: m.id, at: m.at || "", author: m.author || "", ext: extOf ? (extOf(m) || null) : null };
    if (att.kind === "images" && Array.isArray(att.items)) {
      att.items.forEach((it, i) => { if (it && it.url) out.push({ ...base, key: `${m.id}:${i}`, idx: i, kind: "image", url: it.url, name: it.name || "" }); });
    } else if (att.kind === "image" && att.url) {
      out.push({ ...base, key: String(m.id), kind: "image", url: att.url, name: att.name || "" });
    } else if (att.kind === "video" && !att.pending && !att.failed && att.url) {
      out.push({ ...base, key: String(m.id), kind: "video", url: att.watch || att.url, thumb: att.thumbnail || "", name: att.name || "" });
    }
  });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function MediaGallery({ title, items, canDelete, onDelete, onClose }) {
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState(new Set());
  const toggle = (k) => setSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const exitSel = () => { setSelMode(false); setSel(new Set()); };
  const doDelete = () => {
    if (!sel.size) return;
    if (!window.confirm(`Delete ${sel.size} item${sel.size !== 1 ? "s" : ""} from this chat? Everyone stops seeing them — including the other side.`)) return;
    onDelete(items.filter((x) => sel.has(x.key)));
    exitSel();
  };
  const open = (x) => { if (selMode) { toggle(x.key); return; } window.open(x.url, "_blank", "noreferrer"); };
  const fmt = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 470, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, boxSizing: "border-box", backdropFilter: "blur(5px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, width: "min(600px,96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 48px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "13px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: T.text }}>🖼 Media · {items.length}</div>
            {title && <div style={{ fontSize: 11.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>}
          </div>
          {canDelete && items.length > 0 && !selMode && <button onClick={() => setSelMode(true)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 20, color: T.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "5px 13px", flexShrink: 0 }}>Select</button>}
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.textTert, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        {selMode && (
          <div style={{ padding: "8px 14px", background: T.goldLight, borderBottom: `1px solid ${T.gold}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{sel.size} selected</span>
            <button onClick={() => setSel(sel.size === items.length ? new Set() : new Set(items.map((x) => x.key)))} style={{ background: "none", border: "none", color: T.gold, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>{sel.size === items.length ? "Clear all" : "Select all"}</button>
            <div style={{ flex: 1 }} />
            <button onClick={doDelete} disabled={!sel.size} style={{ padding: "6px 14px", borderRadius: 20, border: "none", background: sel.size ? T.red : T.border, color: "#fff", fontSize: 12, fontWeight: 700, cursor: sel.size ? "pointer" : "default", fontFamily: "inherit" }}>🗑 Delete</button>
            <button onClick={exitSel} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 20, color: T.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, padding: "5px 12px" }}>Cancel</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {items.length === 0 && <div style={{ textAlign: "center", color: T.textTert, fontSize: 13, padding: "44px 0" }}>No photos or videos in this chat yet.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(105px,1fr))", gap: 8 }}>
            {items.map((x) => {
              const picked = sel.has(x.key);
              return (
                <div key={x.key} onClick={() => open(x)} style={{ position: "relative", cursor: "pointer", borderRadius: 10, overflow: "hidden", background: "#111", aspectRatio: "1", outline: picked ? `3px solid ${T.gold}` : "none", opacity: selMode && !picked ? 0.72 : 1 }}>
                  {x.kind === "image"
                    ? <img src={x.url} alt={x.name || "photo"} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : x.thumb
                    ? <img src={x.thumb} alt={x.name || "video"} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 24 }}>🎬</div>}
                  {x.kind === "video" && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,0.7)", pointerEvents: "none" }}>▶</span>}
                  {x.ext && <span title={x.ext} style={{ position: "absolute", top: 5, left: 5, fontSize: 8.5, fontWeight: 800, color: "#B45309", background: "#FDE9C8", border: "1px solid #E8B45A", borderRadius: 10, padding: "1px 6px", letterSpacing: "0.04em" }}>👷 EXT</span>}
                  {selMode && <span style={{ position: "absolute", top: 5, right: 5, width: 19, height: 19, borderRadius: "50%", background: picked ? T.gold : "rgba(255,255,255,0.85)", border: picked ? "none" : "1.5px solid rgba(0,0,0,0.25)", color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{picked ? "✓" : ""}</span>}
                  <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 6px 4px", fontSize: 9, fontWeight: 600, color: "#fff", background: "linear-gradient(transparent,rgba(0,0,0,0.65))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{(x.author || "").split(" ")[0]}{x.at ? ` · ${fmt(x.at)}` : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
