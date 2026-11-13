// 📍 Type an address → pick it from the list (Elie 11/13/26: "Add New Lead").
// Suggestions come from /api/address/suggest (Google Places biased to New
// Jersey, OpenStreetMap as the backup). Picking one fills the input with
// "street, town, NJ zip" — the existing parseFullAddress split takes it from
// there. Typing freely still works (nothing is forced).
import { useEffect, useRef, useState } from "react";
import { T } from "./theme";
import { qbAuthFetch } from "./net";

const newSession = () => { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; } };

export function AddressAutocomplete({ value, onChange, onEnter, style, placeholder, autoFocus }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [busy, setBusy] = useState(false);
  const session = useRef(newSession());
  const lastQ = useRef("");
  const picked = useRef("");
  const seq = useRef(0);

  useEffect(() => {
    const q = String(value || "").trim();
    if (q.length < 3 || q === picked.current) { setItems([]); return; }
    const t = setTimeout(() => {
      const my = ++seq.current;
      lastQ.current = q;
      setBusy(true);
      qbAuthFetch(`/api/address/suggest?q=${encodeURIComponent(q)}&session=${session.current}`)
        .then((d) => { if (my !== seq.current) return; setItems(d.items || []); setHi(-1); setOpen(true); })
        .catch(() => { if (my === seq.current) setItems([]); })
        .finally(() => { if (my === seq.current) setBusy(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [value]);

  const choose = async (it) => {
    setOpen(false); setItems([]);
    let full = it.place ? [it.place.address, it.place.city, [it.place.state, it.place.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : [it.main, it.secondary].filter(Boolean).join(", ");
    if (it.id && it.id.startsWith("g:")) {
      try { const d = await qbAuthFetch(`/api/address/suggest?place=${encodeURIComponent(it.id)}&session=${session.current}`); if (d && d.full) full = d.full; } catch { /* keep the suggestion text */ }
      session.current = newSession(); // one Google session per pick
    }
    picked.current = full;
    onChange(full);
  };

  const onKey = (e) => {
    if (open && items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h <= 0 ? items.length - 1 : h - 1)); return; }
      if (e.key === "Enter" && hi >= 0) { e.preventDefault(); choose(items[hi]); return; }
      if (e.key === "Escape") { setOpen(false); return; }
    }
    if (e.key === "Enter" && onEnter) onEnter();
  };

  return (
    <div style={{ position: "relative" }}>
      <input style={style} value={value} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off"
        onChange={(e) => { picked.current = ""; onChange(e.target.value); }}
        onFocus={() => { if (items.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey} />
      {busy && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: T.textTert }}>…</span>}
      {open && items.length > 0 && (
        <div role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", background: "#fff", border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.14)", zIndex: 5, overflow: "hidden" }}>
          {items.map((it, i) => (
            <button key={it.id + i} type="button" role="option" aria-selected={i === hi}
              onMouseDown={(e) => { e.preventDefault(); choose(it); }} onMouseEnter={() => setHi(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "8px 12px", border: "none", borderTop: i ? `1px solid ${T.border}` : "none", background: i === hi ? T.goldLight : "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>📍</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.main}</span>
                {it.secondary && <span style={{ display: "block", fontSize: 12, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.secondary}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
