// Share a contact in chat — from the Goldstone directory, the phone's contact
// picker (where the browser supports it), or typed in. The shared card renders
// with tap-to-call / text / email and a Save button that downloads a .vcf the
// phone opens straight into Contacts.
import { useState } from "react";
import { T } from "./theme";

export const vcfHref = (c) => "data:text/vcard;charset=utf-8," + encodeURIComponent(
  `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name || "Contact"}\n${c.company ? `ORG:${c.company}\n` : ""}${c.phone ? `TEL;TYPE=CELL:${c.phone}\n` : ""}${c.email ? `EMAIL:${c.email}\n` : ""}END:VCARD`
);

export function ContactCardBubble({ c, mine }) {
  if (!c) return null;
  const chip = (bg, fg, br) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 11px", borderRadius: 14, background: bg, color: fg, border: `1px solid ${br || bg}`, fontSize: 11.5, fontWeight: 700, textDecoration: "none", fontFamily: "inherit" });
  const num = String(c.phone || "").replace(/[^\d+]/g, "");
  return (
    <div style={{ marginTop: 6, background: mine ? "rgba(255,255,255,0.16)" : "#fff", border: `1px solid ${mine ? "rgba(255,255,255,0.4)" : T.border}`, borderRadius: 12, padding: "10px 12px", maxWidth: 250 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: `linear-gradient(135deg,${T.gold},#8a6d1f)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{(c.name || "?")[0]}</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: mine ? "#fff" : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || "Contact"}</span>
          {(c.company || c.role) && <span style={{ display: "block", fontSize: 11, color: mine ? "rgba(255,255,255,0.85)" : T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.role, c.company].filter(Boolean).join(" · ")}</span>}
          {c.phone && <span style={{ display: "block", fontSize: 11.5, color: mine ? "rgba(255,255,255,0.9)" : T.textSub }}>{c.phone}</span>}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
        {num && <a href={`tel:${num}`} style={chip("#EDFBF1", "#15803D", T.green)}>📞 Call</a>}
        {num && <a href={`sms:${num}`} style={chip("#EBF4FF", T.blue, T.blue)}>💬 Text</a>}
        {c.email && <a href={`mailto:${c.email}`} style={chip(T.goldLight, "#8a6d1f", T.gold)}>✉️ Email</a>}
        <a href={vcfHref(c)} download={`${(c.name || "contact").replace(/[^a-zA-Z0-9 ]/g, "")}.vcf`} style={chip("#fff", T.textSub, T.border)}>⬇ Save</a>
      </div>
    </div>
  );
}

export function ContactShareModal({ webContacts = null, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [man, setMan] = useState({ name: "", phone: "", email: "", company: "" });
  const canPhone = typeof navigator !== "undefined" && navigator.contacts && navigator.contacts.select;
  const pickPhone = async () => {
    try {
      const res = await navigator.contacts.select(["name", "tel", "email"], { multiple: false });
      const p = res && res[0];
      if (p) onPick({ name: (p.name || [])[0] || "Contact", phone: (p.tel || [])[0] || "", email: (p.email || [])[0] || "", company: "" });
    } catch { /* user cancelled */ }
  };
  const list = (webContacts || []).filter((c) => `${c.name} ${c.company || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const inp = { width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
  const hdr = (t) => <div style={{ fontSize: 10.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", margin: "12px 0 6px" }}>{t}</div>;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 480, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "min(420px,94vw)", maxHeight: "84vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}>
        <div style={{ padding: "13px 17px", borderBottom: `1px solid ${T.border}`, background: T.goldLight, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: 14.5, fontWeight: 800, color: T.text }}>👤 Share a contact</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 21, color: T.textTert, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "10px 16px 16px", overflowY: "auto" }}>
          {canPhone && (
            <button onClick={pickPhone} style={{ width: "100%", marginTop: 8, padding: "11px", borderRadius: 12, border: `1.5px dashed ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>📱 Pick from your phone's contacts</button>
          )}
          {webContacts && webContacts.length > 0 && (<>
            {hdr("From your contacts")}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" style={inp} />
            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6 }}>
              {list.map((c, i) => (
                <div key={i} onClick={() => onPick(c)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 6px", borderBottom: `1px solid ${T.border}`, cursor: "pointer" }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: T.goldLight, color: "#8a6d1f", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{(c.name || "?")[0]}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <span style={{ display: "block", fontSize: 11, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.company, c.phone].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span style={{ fontSize: 12, color: T.gold, fontWeight: 700, flexShrink: 0 }}>Share ›</span>
                </div>
              ))}
              {list.length === 0 && <div style={{ padding: "14px 6px", fontSize: 12.5, color: T.textTert }}>No matches.</div>}
            </div>
          </>)}
          {hdr("Or type it in")}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <input value={man.name} onChange={(e) => setMan((m) => ({ ...m, name: e.target.value }))} placeholder="Name" style={inp} />
            <input value={man.phone} onChange={(e) => setMan((m) => ({ ...m, phone: e.target.value }))} inputMode="tel" placeholder="Phone" style={inp} />
            <input value={man.email} onChange={(e) => setMan((m) => ({ ...m, email: e.target.value }))} inputMode="email" placeholder="Email (optional)" style={inp} />
            <input value={man.company} onChange={(e) => setMan((m) => ({ ...m, company: e.target.value }))} placeholder="Company (optional)" style={inp} />
            <button onClick={() => man.name.trim() && (man.phone.trim() || man.email.trim()) && onPick({ ...man, name: man.name.trim() })} disabled={!man.name.trim() || (!man.phone.trim() && !man.email.trim())}
              style={{ padding: "11px", borderRadius: 12, border: "none", background: man.name.trim() && (man.phone.trim() || man.email.trim()) ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>Share this contact</button>
          </div>
        </div>
      </div>
    </div>
  );
}
