// Admin-side contractor management (the "Contractors" nav section, admin-only):
// companies → logins, jobs (scope, contract price, change orders, payments, docs),
// tasks both directions, and the per-job message thread. Contractors see the
// mirror of this in their portal.
// NOTE: modals + job detail are module-level components (not defined inside the
// page) so a realtime update never remounts them and wipes a half-typed form.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { useData } from "../data/DataProvider";
import { T } from "../theme";
import { linkifyText, rescuePastedLink, SmsThreadPopup } from "../sms";
import { notify, qbAuthFetch, uploadAttachment, STREAM_VIDEO_CAP } from "../net";
import { startVideoUpload, resolveVideoAttachment, videoUploadState, bindCtrVideoMessage, VideoUploadBubble } from "../videoUpload";
import { usePersistentDraft } from "../useDraft";
import { useContractorData, jobTotal, jobPaid, jobLeft, jobDays, money, fmtDate, fmtWhen } from "./data";
import { openSowPdf } from "./sowPdf";
import { SowPdfPreview } from "./SowPdfPreview";
import { useSpeechToText, micBtnStyle, micGlyph } from "../useSpeech";
import { MicIcon, TeamChatIcon } from "../icons";
import { ContactCardBubble } from "../contactShare";
import { CallA } from "../sms";

const inp = { width: "100%", padding: "10px 13px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)", background: "rgba(118,118,128,0.06)", color: T.text, fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 12, fontWeight: 650, color: T.textSub, marginBottom: 5 };
const goldBtn = (on = true) => ({ padding: "10px 18px", borderRadius: 14, border: "none", background: on ? T.gold : "rgba(118,118,128,0.16)", color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: on ? "pointer" : "default", fontFamily: "inherit", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.12)" : "none" });
const ghostBtn = { padding: "10px 16px", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)", background: "rgba(118,118,128,0.08)", color: T.text, fontWeight: 650, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
// The section grammar the whole app speaks: hairline rows inside white cards,
// with a dot + title-case header above each card.
const HAIR = "1px solid rgba(0,0,0,0.055)";
const CARD = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", overflow: "hidden" };
const CIRC = { width: 28, height: 28, borderRadius: "50%", background: "rgba(118,118,128,0.08)", border: "none", fontSize: 13, color: T.textSub, cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: 0, fontFamily: "inherit" };
function SecHd({ color, action, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 4px 0" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: -0.1, flex: 1, minWidth: 0 }}>{children}</span>
      {action || null}
    </div>
  );
}
const linkBtn = (label, onClick) => <button onClick={onClick} style={{ background: "none", border: "none", color: "#8a6d1f", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "2px 4px", whiteSpace: "nowrap" }}>{label}</button>;
const numIn = (v) => String(v).replace(/[^0-9.\-]/g, "");
const today = () => new Date().toISOString().slice(0, 10);

function Modal({ title, sub, onClose, children, footer, width = 520, tone, headEnd, external }) {
  const EXT_BADGE = <span style={{ fontSize: 10, fontWeight: 800, color: "#B45309", background: "#FDE9C8", border: "1px solid #E8B45A", borderRadius: 20, padding: "2px 8px", letterSpacing: "0.05em", flexShrink: 0 }}>EXTERNAL</span>;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: external ? "#F7F1E4" : tone === "bg" ? T.bg : "#fff", borderRadius: 20, width: `min(${width}px,94vw)`, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 18px 60px rgba(0,0,0,0.28)", overflow: "hidden", border: external ? `1.5px solid ${T.gold}99` : "none", boxSizing: "border-box" }}>
        <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 10, background: "#fff", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><span style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{title}</span>{external ? EXT_BADGE : null}</div>
            {sub && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
          </div>
          {headEnd || null}
          <button onClick={onClose} aria-label="Close" style={CIRC}>✕</button>
        </div>
        <div style={{ padding: "14px 16px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(0,0,0,0.08)", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0, background: "#fff" }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── Company create/edit ────────────────────────────────────────────────────────
export function OrgModal({ orgModal, contacts = [], save, onSaved, onClose }) {
  const editing = !!orgModal?.id;
  const [f, setF] = useState({ name: orgModal?.name || "", contactName: orgModal?.contactName || "", phone: orgModal?.phone || "", email: orgModal?.email || "", address: orgModal?.address || "", notes: orgModal?.notes || "" });
  const [e2, setE2] = useState("");
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("");
  // Prefill from an existing contact (contacts store phone either flat or as phones[]).
  const cPhone = (c) => c.phone || (c.phones && c.phones[0] && c.phones[0].number) || "";
  const useContact = (c) => {
    setF({ ...f, name: c.company || c.name || "", contactName: c.name || "", phone: cPhone(c), email: c.email || "", notes: [f.notes, c.role ? `Trade: ${c.role}` : ""].filter(Boolean).join("\n") });
    setPick(false); setQ("");
  };
  const ql = q.trim().toLowerCase();
  const matches = (contacts || []).filter((c) => c && (c.name || c.company)).filter((c) => !ql || [c.name, c.company, c.role, cPhone(c), c.email].filter(Boolean).join(" ").toLowerCase().includes(ql)).sort((a, b) => (a.name || "").localeCompare(b.name || "")).slice(0, 30);
  const saveOrg = async () => {
    if (!f.name.trim()) return;
    const obj = { ...(editing ? orgModal : { id: "org_" + Date.now(), createdAt: new Date().toISOString() }), ...f, name: f.name.trim() };
    try { await save("contractor_orgs", obj); } catch (ex) { setE2(ex.message || "Save failed — try again."); return; }
    onSaved(String(obj.id)); onClose();
  };
  return (
    <Modal title={editing ? "Edit company" : "New contractor company"} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={saveOrg} style={goldBtn(!!f.name.trim())}>Save</button></>}>
      {!editing && (
        <div>
          <button onClick={() => setPick(v => !v)} style={{ width: "100%", padding: "9px 12px", borderRadius: T.radiusSm, border: `1.5px dashed ${T.gold}`, background: pick ? T.goldLight : "transparent", color: "#8a6d1f", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>👤 Start from a contact{pick ? " ▴" : " ▾"}</button>
          {pick && (
            <div style={{ marginTop: 8, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, overflow: "hidden" }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your contacts…" style={{ ...inp, border: "none", borderBottom: `1px solid ${T.border}`, borderRadius: 0 }} />
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {matches.length === 0 && <div style={{ padding: "14px 12px", fontSize: 12.5, color: T.textTert, textAlign: "center" }}>No contacts match.</div>}
                {matches.map((c) => (
                  <div key={c.id} onClick={() => useContact(c)} style={{ padding: "9px 12px", borderTop: `1px solid ${T.border}`, cursor: "pointer" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.company, c.role, cPhone(c)].filter(Boolean).join(" · ") || c.email || ""}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div><label style={lbl}>Company / contractor name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Tom's Plumbing LLC" style={inp} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><label style={lbl}>Main contact</label><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="Tom" style={inp} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>Phone</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} type="tel" style={inp} /></div>
      </div>
      <div><label style={lbl}>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" style={inp} /></div>
      <div><label style={lbl}>Mailing address</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Street, City, State ZIP" style={inp} /></div>
      <div><label style={lbl}>Notes</label><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ ...inp, minHeight: 56, resize: "vertical" }} /></div>
      {e2 && <div style={{ fontSize: 12.5, color: T.red }}>{e2}</div>}
    </Modal>
  );
}

// ── Create a portal login at a company ────────────────────────────────────────
// Suggests the company's main contact for the first login, and pulls additional
// people from the Contacts directory (anyone with an email) for secondary logins.
const genPassword = () => {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let p = "";
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
};
// ── Add a member to a company — contact row + optional portal login, and a
// one-tap "text them their invite" so nobody has to copy passwords around. ────
function AddMemberModal({ org, contacts = [], existingEmails = [], prefill = null, onSaved, onClose }) {
  const { setContacts, flushContacts } = useData() || {};
  const [f, setF] = useState({ name: prefill?.name || "", phone: prefill?.phone || "", role: prefill?.role || "", email: prefill?.email || "", password: genPassword() });
  const [withLogin, setWithLogin] = useState(prefill ? true : true);
  const [busy, setBusy] = useState(false);
  const [e2, setE2] = useState("");
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("");
  const have = new Set((existingEmails || []).map((e) => String(e).toLowerCase()));
  const cPhone = (c) => c.phone || (c.phones && c.phones[0] && c.phones[0].number) || "";
  const ql = q.trim().toLowerCase();
  const matches = (contacts || []).filter((c) => c && c.name && !(c.email && have.has(String(c.email).toLowerCase())))
    .filter((c) => !ql || [c.name, c.company, c.role, c.email, cPhone(c)].filter(Boolean).join(" ").toLowerCase().includes(ql))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "")).slice(0, 30);
  const fromContact = useRef(prefill?.contactId || null);
  const useContact = (c) => { fromContact.current = c.id; setF((p) => ({ ...p, name: c.name || "", phone: cPhone(c), email: c.email || "", role: c.role || "" })); setPick(false); setQ(""); };
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const canSave = f.name.trim() && (!withLogin || (emailOk && f.password.length >= 8));
  const inviteText = `You're set up on the Goldstone Properties portal — sign in at gpflips.com\nEmail: ${f.email.trim()}\nPassword: ${f.password}`;
  const saveMember = async (sendText) => {
    if (!canSave || busy) return;
    setBusy(true); setE2("");
    try {
      if (!fromContact.current && setContacts) {
        const id = Date.now();
        setContacts((prev) => [...prev, { id, name: f.name.trim(), company: org?.name || "", role: f.role.trim(), email: f.email.trim(), phone: f.phone.trim(), phones: f.phone.trim() ? [{ label: "Mobile", number: f.phone.trim() }] : [], tags: [] }]);
        if (flushContacts) setTimeout(flushContacts, 0);
      }
      if (withLogin) {
        await qbAuthFetch("/api/team/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name.trim(), email: f.email.trim(), password: f.password, role: "contractor", contractorOrgId: String(org.id) }) });
      }
      if (sendText && withLogin && f.phone.trim()) {
        try { await qbAuthFetch("/api/jivetel/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: f.phone.trim(), message: inviteText }) }); }
        catch { setE2("Saved — but the invite text didn't go through. Text them their email + password yourself."); setBusy(false); if (onSaved) onSaved(); return; }
      }
      if (onSaved) onSaved();
      onClose();
    } catch (ex) { setE2(ex.message || "Couldn't save the member."); }
    setBusy(false);
  };
  const frow = (label, node) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: HAIR }}>
      <span style={{ width: 76, flexShrink: 0, fontSize: 12, fontWeight: 650, color: T.textSub }}>{label}</span>
      {node}
    </div>
  );
  const bare = { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 14, fontFamily: "inherit", color: T.text, padding: 0 };
  return (
    <Modal title="Add a Member" sub={org?.name || ""} onClose={onClose}
      footer={<div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        {withLogin && <button onClick={() => saveMember(true)} disabled={!canSave || !f.phone.trim() || busy} style={{ ...goldBtn(canSave && !!f.phone.trim() && !busy), width: "100%", padding: "13px", borderRadius: 16, fontSize: 14 }}>{busy ? "Saving…" : "Save & Text Them Their Invite"}</button>}
        {withLogin && f.phone.trim() && canSave && <div style={{ fontSize: 11, color: T.textTert, textAlign: "center", lineHeight: 1.5 }}>Texts {f.phone.trim()}: “You're set up on the Goldstone portal — sign in at gpflips.com · {f.email.trim() || "their email"} · {f.password}”</div>}
        <button onClick={() => saveMember(false)} disabled={!canSave || busy} style={{ ...ghostBtn, width: "100%", padding: "12px", borderRadius: 16, textAlign: "center", justifyContent: "center", display: "inline-flex", opacity: canSave && !busy ? 1 : 0.5 }}>{withLogin ? "Save Without Sending" : "Save Member"}</button>
      </div>}>
      {!prefill && (
        <div>
          <button onClick={() => setPick(v => !v)} style={{ ...ghostBtn, width: "100%", justifyContent: "center", display: "inline-flex" }}>👤 Pick from your contacts{pick ? " ▴" : " ▾"}</button>
          {pick && (
            <div style={{ marginTop: 8, ...CARD }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your contacts…" style={{ ...inp, border: "none", borderBottom: HAIR, borderRadius: 0, background: "#fff" }} />
              <div style={{ maxHeight: 180, overflowY: "auto" }}>
                {matches.length === 0 && <div style={{ padding: "14px 12px", fontSize: 12.5, color: T.textTert, textAlign: "center" }}>No contacts match.</div>}
                {matches.map((c) => (
                  <div key={c.id} onClick={() => useContact(c)} style={{ padding: "9px 12px", borderTop: HAIR, cursor: "pointer" }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: T.text }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.company, c.role, cPhone(c), c.email].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div style={CARD}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          <span style={{ width: 76, flexShrink: 0, fontSize: 12, fontWeight: 650, color: T.textSub }}>Name</span>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Yanky Polak" style={bare} />
        </div>
        {frow("Phone", <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} type="tel" placeholder="(848) 555-0102" style={bare} />)}
        {frow("Role", <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Foreman" style={bare} />)}
      </div>
      <div>
        <SecHd color="#0EA5C5">Portal Login</SecHd>
        <div style={{ ...CARD, marginTop: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 650, color: T.text }}>Give them a login</div>
              <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>They'll see only their company's portal — jobs, tasks, messages</div>
            </span>
            <button onClick={() => setWithLogin(v => !v)} aria-label="Toggle portal login" style={{ width: 51, height: 31, borderRadius: 16, border: "none", background: withLogin ? T.green : "rgba(118,118,128,0.16)", position: "relative", cursor: "pointer", padding: 0, flexShrink: 0, transition: "background 0.15s" }}>
              <span style={{ position: "absolute", top: 2, left: withLogin ? 22 : 2, width: 27, height: 27, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 0.15s" }} />
            </button>
          </div>
          {withLogin && frow("Email", <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" placeholder="their sign-in email" style={bare} />)}
          {withLogin && frow("Password", <><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={{ ...bare, letterSpacing: 0.5 }} /><button onClick={() => setF({ ...f, password: genPassword() })} title="Generate a fresh password" style={{ ...ghostBtn, padding: "6px 11px", fontSize: 11.5, flexShrink: 0 }}>🎲 New</button></>)}
        </div>
      </div>
      {e2 && <div style={{ fontSize: 12.5, color: T.red }}>{e2}</div>}
    </Modal>
  );
}

// ── Manage an existing login: change email, reset password, remove ───────────
function ManageLoginModal({ login, onDone, onClose }) {
  const [email, setEmail] = useState(login.email || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [e2, setE2] = useState("");
  // Which channels this person gets (push / email / text) + the master mute —
  // saved instantly on tap, same controls the team roster has.
  const [chan, setChan] = useState(() => { const c = login.notify_channels || {}; return { push: c.push !== false, email: c.email !== false, sms: c.sms !== false }; });
  const [muted, setMuted] = useState(!!login.notify_muted);
  const [chanSaved, setChanSaved] = useState(false);
  const savedT = useRef(null);
  const saveChan = async (next, nextMuted) => {
    setChan(next); setMuted(nextMuted);
    const allOn = next.push && next.email && next.sms;
    const { error } = await supabase.from("users").update({ notify_channels: allOn ? null : next, notify_muted: nextMuted }).eq("id", login.id);
    if (error) { setE2(error.message); return; }
    onDone();
    setChanSaved(true);
    clearTimeout(savedT.current); savedT.current = setTimeout(() => setChanSaved(false), 2000);
  };
  const chip = (k, icon, label) => {
    const on = chan[k];
    return (
      <button onClick={() => saveChan({ ...chan, [k]: !on }, muted)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 16, border: `1px solid ${on ? T.green : T.border}`, background: on ? "#EDFBF1" : T.bg, color: on ? "#15803D" : T.textTert, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        {icon} {label} {on ? "✓" : "✕"}
      </button>
    );
  };
  const call = async (payload) => {
    setBusy(true); setE2("");
    try {
      await qbAuthFetch("/api/team/update-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: login.id, ...payload }) });
      onDone(); onClose();
    } catch (ex) { setE2(ex.message || "Couldn't update the login."); }
    setBusy(false);
  };
  const changed = email.trim().toLowerCase() !== String(login.email || "").toLowerCase();
  const ok = (changed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) || password.trim().length >= 8;
  return (
    <Modal title={`Login — ${login.name}`} onClose={onClose}
      footer={(changed || password.trim())
        ? <><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={() => call({ ...(changed ? { email: email.trim() } : {}), ...(password.trim() ? { password: password.trim() } : {}) })} disabled={!ok || busy} style={goldBtn(ok && !busy)}>{busy ? "Saving…" : "Save changes"}</button></>
        : <button onClick={onClose} style={goldBtn(true)}>Done</button>}>
      <div><label style={lbl}>Login email</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={inp} /><div style={{ fontSize: 11, color: T.textTert, marginTop: 4 }}>Changing this changes what they type to SIGN IN — takes effect immediately.</div></div>
      <div><label style={lbl}>New password (optional)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep current" style={{ ...inp, flex: 1 }} />
          <button onClick={() => setPassword(genPassword())} style={{ ...ghostBtn, padding: "10px 13px", flexShrink: 0 }}>🎲 New</button>
        </div>
      </div>
      <div>
        <label style={lbl}>Notifications {chanSaved && <span style={{ color: "#15803D", fontWeight: 800, textTransform: "none", letterSpacing: 0 }}>✓ Saved</span>}</label>
        <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 8, lineHeight: 1.45 }}>How {String(login.name || "").split(" ")[0] || "they"} gets notified about jobs, tasks and messages. These save the moment you tap them — no Save button needed.</div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {chip("push", "🔔", "Push")}
          {chip("email", "✉️", "Email")}
          {chip("sms", "📱", "Text")}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: muted ? T.red : T.textSub, fontWeight: 600, cursor: "pointer", marginTop: 9 }}>
          <input type="checkbox" checked={muted} onChange={() => saveChan(chan, !muted)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: T.red }} />
          Mute everything for {String(login.name || "").split(" ")[0] || "them"}
        </label>
      </div>
      {e2 && <div style={{ fontSize: 12.5, color: T.red }}>{e2}</div>}
      <button onClick={() => { if (window.confirm(`Remove ${login.name}'s login? They won't be able to sign in anymore. Their past messages and tasks stay.`)) call({ remove: true }); }} disabled={busy}
        style={{ padding: "10px", borderRadius: T.radiusSm, border: `1px solid ${T.red}`, background: "#FFF0EF", color: T.red, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Remove this login</button>
    </Modal>
  );
}

// ── Job create / edit basics ──────────────────────────────────────────────────
function JobModal({ org, jobModal, properties, save, onSaved, onClose }) {
  const editing = !!jobModal?.id;
  const [f, setF] = useState({ propertyId: jobModal?.propertyId || "", title: jobModal?.title || "", scope: jobModal?.scope || "", price: jobModal?.price != null ? String(jobModal.price) : "", startDate: jobModal?.startDate || today() });
  // "Already underway": bring a job that started before the portal into the
  // app mid-flight — record what's been paid so far, and tell their team the
  // job is "now in the portal" instead of announcing a brand-new job.
  const [underway, setUnderway] = useState(false);
  const [paidSoFar, setPaidSoFar] = useState("");
  const [e2, setE2] = useState("");
  const saveJob = async () => {
    const prop = properties.find((p) => String(p.id) === String(f.propertyId));
    if (!prop && !editing) return;
    const obj = {
      ...(editing ? jobModal : { id: "job_" + Date.now(), orgId: String(org.id), changeOrders: [], payments: [], status: "active", createdAt: new Date().toISOString() }),
      propertyId: f.propertyId || jobModal?.propertyId, propertyAddress: prop ? `${prop.address}${prop.city ? `, ${prop.city}` : ""}` : jobModal?.propertyAddress,
      title: f.title.trim(), scope: f.scope, price: Number(numIn(f.price)) || 0, startDate: f.startDate,
    };
    const paid = Number(numIn(paidSoFar)) || 0;
    if (!editing && underway && paid > 0) obj.payments = [{ id: Date.now(), amount: paid, date: today(), note: "Paid to date — before the portal" }];
    try { await save("contractor_jobs", obj); } catch (ex) { setE2(ex.message || "Save failed — try again."); return; }
    onSaved(obj.id); onClose();
    if (!editing) notify(null, {
      toOrg: String(org.id),
      title: underway ? "Your job is now in the Goldstone portal" : "New job from Goldstone",
      body: `${obj.propertyAddress}${obj.title ? ` — ${obj.title}` : ""}${underway ? " · scope, tasks, and messages live here from now on" : ""}`,
      url: `/?goto=job:${obj.id}`,
    });
  };
  return (
    <Modal title={editing ? "Edit job" : `New job — ${org?.name}`} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={saveJob} style={goldBtn(!!(f.propertyId || editing))}>Save</button></>}>
      <div><label style={lbl}>Property</label>
        <select value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })} style={{ ...inp, color: f.propertyId ? T.text : T.textTert }}>
          <option value="">Pick a property…</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.address}{p.city ? `, ${p.city}` : ""}</option>)}
        </select>
      </div>
      <div><label style={lbl}>Job title (optional)</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Full gut renovation / Plumbing rough-in" style={inp} /></div>
      <div><label style={lbl}>Scope of work — general or detailed; their PDF can be attached after</label><textarea value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="Describe the work…" style={{ ...inp, minHeight: 90, resize: "vertical", lineHeight: 1.5 }} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><label style={lbl}>Contract price</label><input value={f.price} onChange={(e) => setF({ ...f, price: numIn(e.target.value) })} inputMode="decimal" placeholder="e.g. 45000" style={inp} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>Start date</label><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} style={inp} /></div>
      </div>
      {!editing && (
        <div style={{ background: T.bg, borderRadius: T.radiusSm, padding: "10px 12px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={underway} onChange={(e) => setUnderway(e.target.checked)} style={{ width: 16, height: 16, accentColor: T.gold, margin: 0 }} />
            This job is already underway
          </label>
          {underway && (<>
            <div style={{ marginTop: 9 }}><label style={lbl}>Paid so far (optional)</label><input value={paidSoFar} onChange={(e) => setPaidSoFar(numIn(e.target.value))} inputMode="decimal" placeholder="e.g. 20000 — recorded as a payment dated today" style={inp} /></div>
            <div style={{ fontSize: 11, color: T.textTert, marginTop: 6, lineHeight: 1.45 }}>Their team gets "your job is now in the portal" instead of a new-job announcement, and the remaining balance starts from the right number. Individual past payments can be added later on the job.</div>
          </>)}
        </div>
      )}
      {e2 && <div style={{ fontSize: 12.5, color: T.red }}>{e2}</div>}
    </Modal>
  );
}

// ── Pull contractor payments from QuickBooks ──────────────────────────────────
// Lists the property's QB project transactions (expense side), searchable —
// prefiltered to the contractor's name — and pins the picked ones onto the job
// as payments. Already-pinned transactions are marked and can't double-apply.
export function QBPayPicker({ qbProjectId, orgName, existingQbIds, excludedQbIds = [], onAdd, onClose }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  // Prefilter with the org's FIRST word, not the full legal name — a wire whose
  // QB memo says "A/C: MCD NY LLC" (no vendor set) still matches "MCD", where
  // "MCD Builds LLC" would hide it and the payment looked unpinnable.
  const [q, setQ] = useState((orgName || "").trim().split(/\s+/)[0] || "");
  const [sel, setSel] = useState(new Set());
  useEffect(() => {
    let alive = true;
    qbAuthFetch(`/api/quickbooks/transactions?customerId=${encodeURIComponent(qbProjectId)}`)
      .then((d) => { if (alive) setItems((d.items || []).filter((t) => (t.section || "").toLowerCase() !== "income" && Math.abs(Number(t.amount) || 0) > 0)); })
      .catch((e) => { if (alive) { setItems([]); setErr(e.message || "Couldn't load QuickBooks transactions."); } });
    return () => { alive = false; };
  }, [qbProjectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const keyOf = (t) => t.id || `${t.date}|${t.vendor}|${t.amount}`;
  const have = new Set(existingQbIds || []);
  const ql = q.trim().toLowerCase();
  const shown = (items || []).filter((t) => !ql || [t.vendor, t.memo, t.account, t.type, t.num].filter(Boolean).join(" ").toLowerCase().includes(ql))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const toggle = (k) => setSel((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const picked = shown.filter((t) => sel.has(keyOf(t)));
  const total = picked.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  return (
    <Modal title="Pin payments from QuickBooks" width={560} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={() => onAdd(picked)} disabled={!picked.length} style={goldBtn(!!picked.length)}>Apply {picked.length ? `${picked.length} (${money(total)})` : ""}</button></>}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor / memo / account…" style={inp} />
      <div style={{ fontSize: 11.5, color: T.textSub }}>Showing this property's QuickBooks expenses — prefiltered to “{orgName}”. Clear the search to see everything.</div>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radiusSm, overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
        {items === null && <div style={{ padding: 20, textAlign: "center", color: T.textTert, fontSize: 13 }}>Loading QuickBooks…</div>}
        {items !== null && shown.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: T.textTert, fontSize: 13 }}>
            {err || (ql ? `Nothing matches “${q}”.` : "No expense transactions on this project.")}
            {!err && ql && (items || []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button onClick={() => setQ("")} style={{ padding: "7px 14px", borderRadius: 14, border: `1px solid ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Show all {(items || []).length} on this property</button>
              </div>
            )}
          </div>
        )}
        {shown.map((t) => {
          const k = keyOf(t);
          const already = have.has(k);
          const excluded = !already && (excludedQbIds || []).includes(k);
          const on = sel.has(k);
          return (
            <div key={k} onClick={() => !already && toggle(k)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", borderTop: `1px solid ${T.border}`, cursor: already ? "default" : "pointer", opacity: already ? 0.5 : 1, background: on ? T.goldLight : "transparent" }}>
              <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", border: `2px solid ${on ? T.gold : T.border}`, background: on ? T.gold : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>{already ? "✓" : on ? "✓" : ""}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.vendor || t.type || "Transaction"}{already ? " · already applied" : ""}{excluded ? <span style={{ color: "#B45309" }}> · excluded — tap to re-add</span> : ""}</div>
                <div style={{ fontSize: 11, color: T.textTert, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[t.date, t.account, t.memo].filter(Boolean).join(" · ")}</div>
              </div>
              <b style={{ fontSize: 13, flexShrink: 0 }}>{money(Math.abs(Number(t.amount) || 0))}</b>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ── Scope-of-work editor — edit by hand or tell AI what to change. Saving
// diffs the lines, highlights the new/changed ones in the regenerated PDF,
// alerts the contractor, and drops a note in the job thread. ─────────────────
function ScopeEditModal({ j, save, displayName, onClose }) {
  // Edits survive an iOS mid-typing reload: the working copy mirrors to this
  // device until it's saved (or matches the job's scope again).
  const [draft, setDraft, clearDraft] = usePersistentDraft(`gs-scope-draft-${j.id}`, { scope: "", brief: "" });
  const scope = draft.scope || j.scope || "";
  const brief = draft.brief;
  const setScope = (v) => setDraft((d) => ({ ...d, scope: v }));
  const setBrief = (v) => setDraft((d) => ({ ...d, brief: typeof v === "function" ? v(d.brief) : v }));
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [textEdit, setTextEdit] = useState(false); // manual tweaks — the PDF is the default view
  const [highlight, setHighlight] = useState(true); // off = send a clean PDF, no highlights or UPDATED banner
  // The mic's onDone fires from a closure captured when recording started, so
  // the AI call reads the scope through a ref to see the latest version.
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const genAi = async (briefText) => {
    const b = (typeof briefText === "string" ? briefText : brief).trim();
    if (!b) { setErr("Tell the AI what to change first — talk or type it."); return; }
    setAiBusy(true); setErr("");
    try {
      const d = await qbAuthFetch("/api/ai/sow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: b, property: j.propertyAddress || "", current: scopeRef.current }) });
      if (d.sow) setDraft((x) => ({ ...x, scope: d.sow, brief: "" }));
      setTextEdit(false);
    } catch (ex) { setErr(ex.message || "AI edit failed."); }
    setAiBusy(false);
  };
  // Stop talking → transcribe → AI applies the edit → the PDF re-renders. One tap total.
  const { recOn, busy: recBusy, toggleRec } = useSpeechToText({ value: brief, onText: setBrief, onError: setErr, onDone: genAi });
  // Preview exactly what the contractor will see after saving: pending new or
  // changed lines highlighted, same diff the save uses. Timestamp is pinned
  // once per open so the preview doesn't rebuild on every render.
  const openedAtRef = useRef(new Date().toISOString());
  const oldLines = new Set(String(j.scope || "").split("\n").map((l) => l.trim()).filter(Boolean));
  const pendingChanged = scope.split("\n").map((l, i) => (l.trim() && !oldLines.has(l.trim()) ? i : null)).filter((i) => i != null);
  const previewJob = { ...j, scope, scopeChangedLines: !highlight ? [] : pendingChanged.length ? pendingChanged : j.scopeChangedLines, scopeEditedAt: pendingChanged.length ? openedAtRef.current : j.scopeEditedAt, scopeEditedBy: pendingChanged.length ? displayName : j.scopeEditedBy };
  const saveScope = async () => {
    const txt = scope.trim();
    if (!txt) { setErr("The scope can't be empty."); return; }
    if (txt === (j.scope || "").trim()) { clearDraft(false); onClose(); return; }
    setBusy(true);
    // Line-level diff: anything not present in the old scope counts as changed
    // and gets highlighted in the contractor's PDF.
    const oldLines = new Set(String(j.scope || "").split("\n").map((l) => l.trim()).filter(Boolean));
    const changedLines = txt.split("\n").map((l, i) => (l.trim() && !oldLines.has(l.trim()) ? i : null)).filter((i) => i != null);
    try {
      // Highlighting is optional — off ships a clean PDF (no marks, no UPDATED banner).
      await save("contractor_jobs", { ...j, scope: txt, sowPdfUrl: null, scopeChangedLines: highlight ? changedLines : [], scopeEditedAt: new Date().toISOString(), scopeEditedBy: displayName });
      notify(null, { toOrg: j.orgId, title: "Scope of work updated", body: `${j.propertyAddress || ""}${j.title ? ` — ${j.title}` : ""} — open the PDF${highlight ? ", the changes are highlighted" : " for the latest version"}.`, url: `/?goto=job:${j.id}` });
      save("contractor_messages", { id: Date.now() + 3, jobId: j.id, orgId: j.orgId, author: displayName, side: "team", text: `📄 The scope of work was updated — open the PDF on this job${highlight ? "; the changed lines are highlighted" : " for the latest version"}.`, at: new Date().toISOString(), readBy: [displayName] }).catch(() => {});
      clearDraft(false);
      onClose();
    } catch (ex) { setErr(ex.message || "Couldn't save the scope."); setBusy(false); }
  };
  const inp2 = { padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
  return (
    <div onClick={scope.trim() !== (j.scope || "").trim() || brief.trim() ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 470, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "min(640px,96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, background: T.goldLight, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>✎ Edit scope of work</div>
            <div style={{ fontSize: 11.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.propertyAddress || ""} · the contractor is alerted and sees the changes highlighted</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.textTert, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        {/* Controls stay pinned above the document — you can read deep into the
            PDF and still start/stop a recording without scrolling back up.
            Recording keeps running while you scroll; only ◼ stops it. */}
        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 9, flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
          {err && <div onClick={() => setErr("")} style={{ fontSize: 12.5, color: T.red, cursor: "pointer" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={brief} onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => e.key === "Enter" && genAi()} placeholder={recOn ? "Recording… read on, tap ◼ when you're done" : recBusy ? "Transcribing…" : "✨ Tell the AI what to change — talk or type"} style={{ ...inp2, flex: 1, minWidth: 0, ...(recOn ? { borderColor: "#FF3B30" } : {}) }} />
            <button onClick={toggleRec} disabled={recBusy || aiBusy} title="Talk — when you stop, the AI applies your changes and the PDF updates" style={micBtnStyle(recOn, T)}>{micGlyph(recOn, recBusy)}</button>
            <button onClick={() => genAi()} disabled={aiBusy} style={{ padding: "9px 15px", borderRadius: 10, border: `1.5px dashed ${T.gold}`, background: T.goldLight, color: "#b8912e", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap" }}>{aiBusy ? "Rewriting…" : "✨ AI edit"}</button>
          </div>
          {scope.trim() && !aiBusy && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11.5, color: "#8a6d1f", fontWeight: 700, flex: 1, minWidth: 0 }}>{recOn ? "🔴 Recording — scroll and read while you talk" : `📄 ${pendingChanged.length ? (highlight ? "Your unsaved changes are highlighted — this is what they'll see" : "Sending the clean version — no highlights") : "This is the exact PDF the contractor sees"}`}</span>
              <button onClick={() => setTextEdit((v) => !v)} style={{ padding: "5px 11px", borderRadius: 14, border: `1px solid ${T.border}`, background: "#fff", color: T.textSub, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>{textEdit ? "👁 Back to the PDF" : "✎ Edit the text"}</button>
            </div>
          )}
        </div>
        {/* The document area scrolls on its own, under the pinned controls. */}
        <div style={{ padding: "12px 18px", overflowY: "auto", flex: 1, minHeight: 140, display: "flex", flexDirection: "column", gap: 9, background: scope.trim() && !textEdit && !aiBusy ? T.bg : "#fff" }}>
          {aiBusy
            ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 200, background: T.goldLight, borderRadius: 12, border: `1.5px dashed ${T.gold}` }}>
                <span style={{ fontSize: 26 }}>✨</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#8a6d1f" }}>Making your changes…</span>
                <span style={{ fontSize: 11.5, color: "#8a6d1f" }}>the updated PDF will appear right here</span>
              </div>
            : scope.trim()
            ? (textEdit
                ? <textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={14} style={{ ...inp2, resize: "vertical", lineHeight: 1.55, fontSize: 13, minHeight: 220, flex: 1 }} />
                : <SowPdfPreview job={previewJob} />)
            : <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 200, background: T.bg, borderRadius: 12, border: `1.5px dashed ${T.border}`, padding: "20px 24px", textAlign: "center" }}>
                <span style={{ color: T.textSub }}><MicIcon size={28} /></span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>No scope yet — tap the mic and describe the work</span>
                <span style={{ fontSize: 12, color: T.textSub, lineHeight: 1.5 }}>When you stop talking, the AI writes the scope of work and it appears here as the PDF.</span>
              </div>}
        </div>
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", flexShrink: 0 }}>
          {pendingChanged.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginRight: "auto", fontSize: 12, fontWeight: 600, color: T.textSub, cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} style={{ accentColor: T.gold, width: 15, height: 15, margin: 0 }} />
              Highlight the changes for them
            </label>
          )}
          <button onClick={onClose} style={{ padding: "10px 18px", borderRadius: 10, background: T.bg, border: "none", color: T.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>Cancel</button>
          <button onClick={saveScope} disabled={busy || !scope.trim()} style={{ padding: "10px 22px", borderRadius: 10, background: scope.trim() && !busy ? T.gold : T.border, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>{busy ? "Saving…" : "Save & notify them"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Job detail — overview (money/docs), tasks, messages ──────────────────────
// Exported: the property page's Contacts tab opens the same popup.
export function JobDetail({ j, org, isAdmin = true, qbProjectId = null, tasks, messages, docs, save, remove, displayName, onEditBasics, onClose }) {
  const total = jobTotal(j), paid = jobPaid(j), left = jobLeft(j), days = jobDays(j);
  // Per-job crew: a company can have several logins (foremen) but not all of
  // them work every job. j.crew = [user ids] limits who sees this job in the
  // portal (empty/absent = the whole company, the default). Alerts about the
  // job follow the same list — filtered server-side by the notify fan-out.
  const { ctrUsers } = useData() || {};
  const orgLogins = (ctrUsers || []).filter((u) => String(u.orgId) === String(j.orgId));
  const crew = Array.isArray(j.crew) ? j.crew : [];
  const onJob = (id) => !crew.length || crew.includes(id);
  const toggleCrew = async (u) => {
    const all = orgLogins.map((x) => x.id);
    let next = crew.length ? [...crew] : all;
    next = next.includes(u.id) ? next.filter((x) => x !== u.id) : [...next, u.id];
    if (!next.length) return; // someone has to keep the job
    if (all.every((id) => next.includes(id))) next = []; // everyone → back to the default
    try { await save("contractor_jobs", { ...j, crew: next }); } catch { /* realtime refresh restores the truth */ }
  };
  const jDocs = (docs || []).filter((d) => String(d.jobId) === String(j.id));
  const jTasks = (tasks || []).filter((t) => String(t.jobId) === String(j.id));
  const closed = (s) => s === "Completed" || s === "N/A";
  const [showDone, setShowDone] = useState(false); // completed tasks fold away
  const vis = (t) => t.status !== "Completed" || showDone;
  const doneCount = jTasks.filter((t) => t.status === "Completed").length;
  const toThem = jTasks.filter((t) => t.direction !== "to_team" && vis(t)).sort((a, b) => closed(a.status) - closed(b.status));
  const fromThem = jTasks.filter((t) => t.direction === "to_team" && vis(t)).sort((a, b) => closed(a.status) - closed(b.status));
  const thread = (messages || []).filter((m) => String(m.jobId) === String(j.id)).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const [tab2, setTab2] = useState("overview");
  const [coDraft, setCoDraft] = useState(null);
  const [askDraft, setAskDraft] = useState(null); // scope-only CO request TO them (they price it)
  const [pricePop, setPricePop] = useState(false); // original price + change orders
  const [scopeEdit, setScopeEdit] = useState(false); // ✎ edit the SOW (AI-assisted)
  const [payDraft, setPayDraft] = useState(null);
  const [qbPick, setQbPick] = useState(false);
  // Apply picked QuickBooks transactions as payments (deduped by qbId).
  const applyQb = async (rows) => {
    const have = new Set((j.payments || []).map((p) => p.qbId).filter(Boolean));
    const add = rows.filter((t) => !have.has(t.id || `${t.date}|${t.vendor}|${t.amount}`)).map((t, i) => ({ id: Date.now() + i, amount: Math.abs(Number(t.amount) || 0), date: t.date || today(), note: [t.vendor, t.memo].filter(Boolean).join(" — ") || "QuickBooks", qbId: t.id || `${t.date}|${t.vendor}|${t.amount}` }));
    // Hand-applying a wire un-excludes it — the pick is explicit.
    const appliedIds = add.map((x) => x.qbId);
    if (add.length) { await save("contractor_jobs", { ...j, payments: [...(j.payments || []), ...add], qbExcluded: (j.qbExcluded || []).filter((id) => !appliedIds.includes(id)) }); notify(null, { toOrg: j.orgId, title: "Payment recorded", body: `${money(add.reduce((s, p) => s + p.amount, 0))} — ${j.propertyAddress}`, url: `/?goto=job:${j.id}` }); }
    setQbPick(false);
  };
  // ⚡ Auto-pin — Elie 8/20/26: QuickBooks expenses on this property that carry
  // the contractor's name pin themselves as payments when the job opens.
  // Removing one (×) remembers that wire in j.qbExcluded so it never re-pins;
  // the picker can re-include it later. Runs once per open, admin only.
  const [autoPinned, setAutoPinned] = useState(0);
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !isAdmin || !qbProjectId || isRemoved || j.status === "complete") return;
    autoRan.current = true;
    let alive = true;
    qbAuthFetch(`/api/quickbooks/transactions?customerId=${encodeURIComponent(qbProjectId)}`).then(async (d) => {
      if (!alive) return;
      const items = (d.items || []).filter((t) => (t.section || "").toLowerCase() !== "income" && Math.abs(Number(t.amount) || 0) > 0);
      // Same match the picker prefilters with: the company's FIRST word, so a
      // wire whose memo says "A/C: SHIA POLAK CONST" still catches.
      const word = ((org?.name || "").trim().split(/\s+/)[0] || "").toLowerCase();
      if (word.length < 3) return;
      const kOf = (t) => t.id || `${t.date}|${t.vendor}|${t.amount}`;
      const have = new Set((j.payments || []).map((pp) => pp.qbId).filter(Boolean));
      const excl = new Set(j.qbExcluded || []);
      const fresh = items.filter((t) => [t.vendor, t.memo].filter(Boolean).join(" ").toLowerCase().includes(word) && !have.has(kOf(t)) && !excl.has(kOf(t)));
      if (!fresh.length) return;
      const add = fresh.map((t, i) => ({ id: Date.now() + i, amount: Math.abs(Number(t.amount) || 0), date: t.date || today(), note: [t.vendor, t.memo].filter(Boolean).join(" — ") || "QuickBooks", qbId: kOf(t), auto: true }));
      try {
        await save("contractor_jobs", { ...j, payments: [...(j.payments || []), ...add] });
        if (!alive) return;
        setAutoPinned(add.length);
        notify(null, { toOrg: j.orgId, title: "Payment recorded", body: `${money(add.reduce((s2, pp) => s2 + pp.amount, 0))} — ${j.propertyAddress}`, url: `/?goto=job:${j.id}` });
      } catch { /* the next open retries */ }
    }).catch(() => { /* QuickBooks unreachable — the picker still works by hand */ });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [taskDraft, setTaskDraft] = useState("");
  const [msgDraft, setMsgDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [replyTo, setReplyTo] = useState(null); // {id,author,text} → quote-reply
  const [busy, setBusy] = useState(false);
  const [err2, setErr2] = useState("");
  const attRef = useRef(null);
  const docRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.length, tab2]);

  const addCO = async () => { const a = Number(numIn(coDraft.amount)); if (!a) return; await save("contractor_jobs", { ...j, changeOrders: [...(j.changeOrders || []), { id: Date.now(), label: coDraft.label.trim() || "Change order", amount: a, date: coDraft.date }] }); setCoDraft(null); notify(null, { toOrg: j.orgId, title: "Change order added", body: `${coDraft.label.trim() || "Change order"} — ${money(a)} · ${j.propertyAddress}`, url: `/?goto=job:${j.id}` }); };
  // Scope-only change-order request FROM Goldstone: no price attached — the
  // contractor sends their price back, then it's approved like any request.
  const sendAsk = async () => {
    const label = (askDraft?.label || "").trim();
    if (!label) return;
    const r = { id: Date.now(), label: label.slice(0, 200), from: "team", askedBy: displayName, at: new Date().toISOString(), status: "awaiting_price", amount: null };
    await save("contractor_jobs", { ...j, coRequests: [...(j.coRequests || []), r] });
    notify(null, { toOrg: j.orgId, title: "Change order requested by Goldstone", body: `${label} — please send your price · ${j.propertyAddress}`, url: `/?goto=job:${j.id}` });
    save("contractor_messages", { id: Date.now() + 1, jobId: j.id, orgId: j.orgId, author: displayName, side: "team", text: `🧾 Change order requested: ${label} — please send a price.`, at: new Date().toISOString(), readBy: [displayName], taskRefId: `co:${r.id}`, taskRefText: `🧾 ${label}` }).catch(() => {});
    setAskDraft(null);
  };
  // They told you the number (phone, text, in person) — type it in yourself:
  // the request is approved at that price and becomes a real change order.
  const [priceFor, setPriceFor] = useState(null); // {id, amount} for an awaiting_price request
  // No contract price yet → a real button + inline field in the Contract card
  // (the tiny "set it ›" text was impossible to hit on a phone — Elie 8/20/26).
  const [priceDraft, setPriceDraft] = useState(null); // "" while typing, null closed
  const saveContractPrice = async () => {
    const a = Number(numIn(priceDraft || ""));
    if (!a) return;
    await save("contractor_jobs", { ...j, price: a });
    setPriceDraft(null);
    notify(null, { toOrg: j.orgId, title: "Contract price set", body: `${money(a)} — ${j.propertyAddress}${j.title ? ` · ${j.title}` : ""}`, url: `/?goto=job:${j.id}` });
  };
  const priceAsk = async (r) => {
    const a = Number(numIn(priceFor?.amount || ""));
    if (!a) return;
    const upd = {
      ...j,
      coRequests: (j.coRequests || []).map((x) => x.id === r.id ? { ...x, status: "approved", amount: a, decidedBy: displayName, decidedAt: new Date().toISOString(), pricedBy: "team" } : x),
      changeOrders: [...(j.changeOrders || []), { id: Date.now(), label: r.label, amount: a, date: today(), by: displayName, fromRequest: r.id }],
    };
    await save("contractor_jobs", upd);
    setPriceFor(null);
    notify(null, { toOrg: j.orgId, title: "Change order priced & approved ✓", body: `${r.label} — ${money(a)} · new contract total ${money(jobTotal(upd))} · ${j.propertyAddress}`, url: `/?goto=job:${j.id}` });
    save("contractor_messages", { id: Date.now() + 2, jobId: j.id, orgId: j.orgId, author: displayName, side: "team", text: `🧾 Change order priced & approved: ${r.label} — ${money(a)}`, at: new Date().toISOString(), readBy: [displayName] }).catch(() => {});
  };
  const cancelAsk = async (r) => {
    await save("contractor_jobs", { ...j, coRequests: (j.coRequests || []).filter((x) => x.id !== r.id) });
    notify(null, { toOrg: j.orgId, title: "Change order request withdrawn", body: `${r.label} · ${j.propertyAddress}`, url: `/?goto=job:${j.id}` });
  };
  // Contractor-submitted change-order requests: approving one is what actually
  // moves the contract price (it becomes a real change order).
  // Remove the CONTRACTOR but keep the job: their portal loses it instantly,
  // while the scope, tasks, thread, docs and payment history all stay here as
  // the company's record. Reversible via Restore (it was one status flip).
  const isRemoved = j.status === "removed";
  const removeContractor = async () => {
    const nm = org?.name || "this contractor";
    if (!window.confirm(`Remove ${nm} from this job?\n\nThe job disappears from their portal immediately. Everything — scope, tasks, messages, documents, payments — stays here as your record. You can restore them later if this was a mistake.`)) return;
    try { await save("contractor_jobs", { ...j, status: "removed", prevStatus: j.status || "active", removedAt: new Date().toISOString(), removedBy: displayName }); } catch (ex) { window.alert(ex.message || "Couldn't remove the contractor."); return; }
    notify(null, { toOrg: j.orgId, title: "You've been removed from a job", body: `${j.propertyAddress || ""}${j.title ? ` — ${j.title}` : ""} — reach out to Goldstone with any questions.` });
  };
  const restoreContractor = async () => {
    await save("contractor_jobs", { ...j, status: (j.prevStatus && j.prevStatus !== "removed") ? j.prevStatus : "active", prevStatus: null, removedAt: null, removedBy: null });
    notify(null, { toOrg: j.orgId, title: "Job restored", body: `${j.propertyAddress || ""}${j.title ? ` — ${j.title}` : ""} is back in your portal.`, url: `/?goto=job:${j.id}` });
  };
  // Delete the job and everything on it — tasks, thread, docs — from both
  // sides. The company is told; irreversible.
  const removeJob = async () => {
    const nm = org?.name || "this contractor";
    if (!window.confirm(`Remove this job from ${nm}?\n\nIt disappears from their portal and yours — the scope, ${jTasks.length} task${jTasks.length === 1 ? "" : "s"}, ${thread.length} message${thread.length === 1 ? "" : "s"}, ${jDocs.length} document${jDocs.length === 1 ? "" : "s"}, and all payment records on it are deleted. This can't be undone.`)) return;
    try { await remove("contractor_jobs", j.id); } catch (ex) { window.alert(ex.message || "Couldn't remove the job."); return; }
    jTasks.forEach((t) => remove("contractor_tasks", t.id).catch(() => {}));
    thread.forEach((m) => remove("contractor_messages", m.id).catch(() => {}));
    jDocs.forEach((d) => remove("contractor_docs", d.id).catch(() => {}));
    notify(null, { toOrg: j.orgId, title: "Job removed from your portal", body: `${j.propertyAddress || ""}${j.title ? ` — ${j.title}` : ""} — reach out to Goldstone with any questions.` });
    onClose();
  };
  const decideCoReq = async (r, approve) => {
    const upd = {
      ...j,
      coRequests: (j.coRequests || []).map((x) => x.id === r.id ? { ...x, status: approve ? "approved" : "denied", decidedBy: displayName, decidedAt: new Date().toISOString() } : x),
      ...(approve ? { changeOrders: [...(j.changeOrders || []), { id: Date.now(), label: r.label, amount: Number(r.amount) || 0, date: today(), by: r.by, fromRequest: r.id }] } : {}),
    };
    await save("contractor_jobs", upd);
    notify(null, {
      toOrg: j.orgId,
      title: approve ? "Change order approved ✓" : "Change order denied",
      body: `${r.label} — ${money(r.amount)}${approve ? ` · new contract total ${money(jobTotal(upd))}` : ""} · ${j.propertyAddress}`,
    });
    save("contractor_messages", { id: Date.now() + 2, jobId: j.id, orgId: j.orgId, author: displayName, side: "team", text: `🧾 Change order ${approve ? "approved ✓" : "denied"}: ${r.label} — ${money(r.amount)}`, at: new Date().toISOString(), readBy: [displayName] }).catch(() => {});
  };
  const addPay = async () => { const a = Number(numIn(payDraft.amount)); if (!a) return; await save("contractor_jobs", { ...j, payments: [...(j.payments || []), { id: Date.now(), amount: a, date: payDraft.date, note: payDraft.note.trim() }] }); setPayDraft(null); notify(null, { toOrg: j.orgId, title: "Payment recorded", body: `${money(a)} — ${j.propertyAddress}`, url: `/?goto=job:${j.id}` }); };
  const addTask = async () => { const txt = taskDraft.trim(); if (!txt) return; await save("contractor_tasks", { id: Date.now(), jobId: j.id, orgId: j.orgId, text: txt, status: "Not Started", direction: "to_contractor", createdBy: displayName, createdAt: new Date().toISOString() }); setTaskDraft(""); notify(null, { toOrg: j.orgId, title: "New task from Goldstone", body: `${txt} — ${j.propertyAddress}`, url: `/?goto=job:${j.id}` }); };
  const setTaskStatus = async (t, s) => {
    if (s === (t.status || "Not Started")) return;
    await save("contractor_tasks", { ...t, status: s, statusBy: displayName, doneAt: s === "Completed" ? new Date().toISOString() : null, doneBy: s === "Completed" ? displayName : null });
    notify(null, { toOrg: t.orgId, title: "Task updated by Goldstone", body: `${t.text} — ${s}`, url: `/?goto=job:${t.jobId}` });
  };
  const statusPill = (t) => {
    const STS = ["Not Started", "In Progress", "Completed", "N/A"];
    const v = STS.includes(t.status) ? t.status : "Not Started";
    const c = v === "Completed" ? T.green : v === "In Progress" ? T.blue : v === "N/A" ? "#6b6b70" : T.textSub;
    return (
      <select value={v} onChange={(e) => setTaskStatus(t, e.target.value)} title="Change status"
        style={{ padding: "3px 6px", borderRadius: 20, border: "none", background: c + "22", color: c, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
        {STS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  };
  const pickAtt = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    // Several photos at once (up to 10) → one message with a photo grid.
    if (files.length > 1) {
      const imgs = files.filter((f) => (f.type || "").startsWith("image/")).slice(0, 10);
      if (!imgs.length) { setErr2("Videos and PDFs go one at a time — photos can be sent up to 10 together."); return; }
      setErr2(imgs.length < files.length ? "Only photos can go together — the other files were skipped." : "");
      setBusy(true);
      try {
        const items = await Promise.all(imgs.map((f) => uploadAttachment(f, "portal")));
        setPending({ kind: "images", items, name: `${items.length} photos`, url: items[0].url });
      } catch (ex) { setErr2(ex.message || "Upload failed."); }
      setBusy(false);
      return;
    }
    const file = files[0];
    // Videos upload in the background — the message can go out immediately with a
    // placeholder that becomes the playable video once the upload lands.
    if ((file.type || "").startsWith("video/")) {
      if (file.size > STREAM_VIDEO_CAP) { setErr2("Video is too large (max 5 GB)."); return; }
      setErr2("");
      setPending(startVideoUpload(file, "portal"));
      return;
    }
    setBusy(true);
    try { setPending(await uploadAttachment(file, "portal")); }
    catch (ex) { setErr2(ex.message || "Upload failed."); }
    setBusy(false);
  };
  const sendMsg = async () => {
    const txt = msgDraft.trim(); if ((!txt && !pending) || busy) return;
    if (pending && pending.uploadId && videoUploadState(pending.uploadId)?.status === "failed") { setErr2("The video didn't upload — remove it (×) and try again."); return; }
    const msg = { id: Date.now(), jobId: j.id, orgId: j.orgId, author: displayName, side: "team", text: txt, at: new Date().toISOString(), readBy: [displayName] };
    if (pending) msg.attachment = resolveVideoAttachment(pending);
    if (replyTo) msg.replyTo = { id: replyTo.id, author: replyTo.author, text: (replyTo.text || (replyTo.attachment ? "📎 attachment" : "")).slice(0, 140) };
    setMsgDraft(""); setPending(null); setReplyTo(null);
    try { await save("contractor_messages", msg); }
    catch (ex) {
      setMsgDraft(txt); if (msg.attachment) setPending(msg.attachment);
      setErr2(`Couldn't send — ${ex.message || "try again."}`);
      return;
    }
    if (msg.attachment && msg.attachment.pending && msg.attachment.uploadId) bindCtrVideoMessage(msg.attachment.uploadId, msg.id);
    notify(null, { toOrg: j.orgId, title: `Goldstone — ${j.propertyAddress}`, body: txt || "(attachment)", url: `/?goto=job:${j.id}` });
  };
  const uploadDoc = async (e) => { const file = (e.target.files || [])[0]; e.target.value = ""; if (!file) return; setBusy(true); try { const up = await uploadAttachment(file, "portal"); await save("contractor_docs", { id: Date.now(), jobId: j.id, orgId: j.orgId, name: up.name, url: up.url, mime: up.mime, by: displayName, at: new Date().toISOString() }); } catch { setErr2("Upload failed."); } setBusy(false); };

  const secHdr = (t, right) => <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 8px" }}><div style={{ fontSize: 11, fontWeight: 800, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t}</div>{right}</div>;
  const miniBtn = (label, onClick) => <button onClick={onClick} style={{ padding: "5px 12px", borderRadius: 16, border: `1px solid ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>;

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const pendingReqs = (j.coRequests || []).filter((r) => r.status === "pending");
  const waitingReqs = (j.coRequests || []).filter((r) => r.status === "awaiting_price");
  const needsOk = pendingReqs.length + waitingReqs.length;
  const heroCol = (label, val, valColor, subEl, first) => (
    <div style={{ flex: 1, minWidth: 0, ...(first ? {} : { borderLeft: "1px solid rgba(0,0,0,0.07)", paddingLeft: isMobile ? 12 : 18 }) }}>
      <div style={{ fontSize: 10.5, fontWeight: 650, color: T.textTert, letterSpacing: "0.02em" }}>{label}</div>
      <div style={{ fontSize: isMobile ? 19 : 23, fontWeight: 750, letterSpacing: "-0.4px", color: valColor, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{val}</div>
      {subEl}
    </div>
  );
  const heroSub = (txt, onClick) => <div onClick={onClick} style={{ fontSize: 10.5, color: onClick ? "#8a6d1f" : T.textTert, marginTop: 2, cursor: onClick ? "pointer" : "default", fontWeight: onClick ? 650 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{txt}</div>;
  const rowCss = { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderTop: HAIR };
  const totCss = { ...rowCss, background: T.cardAlt };
  return (
    <Modal title={j.propertyAddress} sub={`${org?.name || ""}${j.title ? ` · ${j.title}` : ""} — their team sees this job`} width={680} tone="bg" external onClose={onClose}
      headEnd={isAdmin && !isRemoved ? <button onClick={() => save("contractor_jobs", { ...j, status: j.status === "complete" ? "active" : "complete" })} title={j.status === "complete" ? "Reopen job" : "Mark complete"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: isMobile ? 0 : "7px 13px", width: isMobile ? 34 : "auto", height: isMobile ? 34 : "auto", borderRadius: 100, border: "none", background: j.status === "complete" ? "rgba(118,118,128,0.08)" : "#EAF7EE", color: j.status === "complete" ? T.textSub : "#248A3D", fontSize: isMobile ? 15 : 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>{j.status === "complete" ? (isMobile ? "↺" : "Reopen job") : (isMobile ? "✓" : "✓ Mark Complete")}</button> : null}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)", padding: 3, gap: 2, maxWidth: "100%", overflowX: "auto", overflowY: "hidden", overscrollBehavior: "contain" }}>
          {[["overview", "Overview"], ["tasks", `Tasks${jTasks.length ? ` · ${jTasks.filter(t => !closed(t.status)).length}` : ""}`], ["messages", `Messages${thread.length ? ` · ${thread.length}` : ""}`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab2(k)} style={{ flex: "0 0 auto", whiteSpace: "nowrap", padding: "7px 16px", borderRadius: 14, border: "none", background: tab2 === k ? "#fff" : "transparent", color: tab2 === k ? T.text : T.textSub, fontWeight: tab2 === k ? 650 : 450, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: tab2 === k ? "0 1px 4px rgba(0,0,0,0.14)" : "none", transition: "all 0.15s" }}>{l}</button>
          ))}
        </div>
      </div>
      {isRemoved && (
        <div style={{ ...CARD, border: `1.5px solid ${T.red}55`, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontSize: 12.5, color: T.red, fontWeight: 650 }}>🚫 {org?.name || "The contractor"} was removed from this job{j.removedAt ? ` ${fmtDate(j.removedAt)}` : ""}{j.removedBy ? ` by ${j.removedBy}` : ""}. All records are kept — their portal no longer shows it.</div>
          {isAdmin && <button onClick={restoreContractor} style={{ padding: "7px 14px", borderRadius: 100, border: `1px solid ${T.red}44`, background: "#fff", color: T.red, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Restore</button>}
        </div>
      )}
      {err2 && <div onClick={() => setErr2("")} style={{ fontSize: 12.5, color: T.red, cursor: "pointer" }}>{err2}</div>}

      {tab2 === "overview" && (<>
        <div>
          <SecHd color={T.gold}>Contract</SecHd>
          <div style={{ ...CARD, padding: "13px 16px", marginTop: 7 }}>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              {heroCol("TOTAL", total > 0 ? money(total) : "—", T.text, heroSub(total > 0 ? ((j.changeOrders || []).length ? `incl. ${(j.changeOrders || []).length} change order${(j.changeOrders || []).length !== 1 ? "s" : ""} ›` : "contract price") : "no contract price yet", total > 0 && (j.changeOrders || []).length ? () => setPricePop(true) : undefined), true)}
              {heroCol("PAID SO FAR", money(paid), "#248A3D", heroSub(`${(j.payments || []).length} payment${(j.payments || []).length !== 1 ? "s" : ""}`))}
              {heroCol("LEFT", total > 0 ? money(left) : "—", "#B8912E", heroSub(days != null && j.status !== "complete" ? `day ${days} of the job` : j.status === "complete" ? "job complete" : ""))}
            </div>
            {total > 0 && <div style={{ marginTop: 11, height: 6, borderRadius: 3, background: "rgba(118,118,128,0.14)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.round((paid / total) * 100))}%`, height: "100%", background: T.green, borderRadius: 3 }} />
            </div>}
            {total === 0 && isAdmin && (priceDraft == null
              ? <button onClick={() => setPriceDraft("")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", minHeight: 44, marginTop: 12, borderRadius: 14, border: `1.5px dashed ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>＋ Set the Contract Price</button>
              : <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                  <input autoFocus value={priceDraft} onChange={(e) => setPriceDraft(numIn(e.target.value))} onKeyDown={(e) => e.key === "Enter" && saveContractPrice()} inputMode="decimal" placeholder="Contract price — e.g. 85000" style={{ ...inp, flex: 1, minWidth: 150, minHeight: 44 }} />
                  <button onClick={saveContractPrice} style={{ ...goldBtn(!!Number(numIn(priceDraft))), minHeight: 44 }}>Save</button>
                  <button onClick={() => setPriceDraft(null)} style={{ ...ghostBtn, minHeight: 44 }}>Cancel</button>
                </div>)}
          </div>
        </div>
        {pricePop && (
          <div onClick={() => setPricePop(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 460, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, width: "min(400px,94vw)", boxShadow: "0 18px 60px rgba(0,0,0,0.28)", overflow: "hidden" }}>
              <div style={{ padding: "13px 17px", borderBottom: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: T.text }}>Contract Price Breakdown</div>
                <button onClick={() => setPricePop(false)} aria-label="Close" style={CIRC}>✕</button>
              </div>
              <div style={{ padding: "4px 0 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "10px 17px" }}><span style={{ color: T.textSub }}>Original contract</span><b style={{ fontVariantNumeric: "tabular-nums" }}>{money(j.price)}</b></div>
                {(j.changeOrders || []).map((c) => (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "10px 17px", borderTop: HAIR }}>
                    <span style={{ color: T.textSub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>+ {c.label || "Change order"}{c.date ? ` · ${fmtDate(c.date)}` : ""}{c.by ? ` · ${c.by.split(" ")[0]}` : ""}</span><b style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{money(c.amount)}</b>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "11px 17px", borderTop: HAIR, background: T.cardAlt }}><b>Total</b><b style={{ color: "#B8912E", fontVariantNumeric: "tabular-nums" }}>{money(total)}</b></div>
              </div>
            </div>
          </div>
        )}

        {needsOk > 0 && (
          <div>
            <SecHd color="#FF9500">Needs Your OK <span style={{ color: T.textTert, fontWeight: 500 }}>· {needsOk}</span></SecHd>
            <div style={{ ...CARD, border: `1.5px solid ${T.gold}88`, marginTop: 7 }}>
              {pendingReqs.map((r, i) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderTop: i ? HAIR : "none", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 170 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{r.label} — <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(r.amount)}</span></div>
                    <div style={{ fontSize: 11, color: T.textSub, marginTop: 1 }}>Change order request · {r.by}{r.at ? ` · ${fmtDate(r.at)}` : ""}{r.note ? ` · “${r.note}”` : ""}</div>
                  </div>
                  <button onClick={() => setTab2("messages")} title="Open this job's messages" style={{ ...CIRC, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><TeamChatIcon size={13} /></button>
                  {isAdmin ? (<>
                    <button onClick={() => decideCoReq(r, true)} style={{ padding: "8px 15px", borderRadius: 100, border: "none", background: T.green, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 4px rgba(0,0,0,0.12)", flexShrink: 0 }}>✓ Approve</button>
                    <button onClick={() => decideCoReq(r, false)} style={{ padding: "8px 14px", borderRadius: 100, border: "1px solid rgba(0,0,0,0.05)", background: "rgba(118,118,128,0.08)", color: "#D70015", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Deny</button>
                  </>) : <span style={{ fontSize: 10.5, fontWeight: 700, color: "#B45309", background: "#FDE9C8", borderRadius: 100, padding: "4px 10px", flexShrink: 0 }}>pending — admin decides</span>}
                </div>
              ))}
              {waitingReqs.map((r, i) => (
                <div key={r.id} style={{ borderTop: (i || pendingReqs.length) ? HAIR : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: T.text }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: T.textSub, marginTop: 1 }}>You asked for their price{r.askedBy ? ` · ${r.askedBy.split(" ")[0]}` : ""}{r.at ? ` · ${fmtDate(r.at)}` : ""}</div>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#B45309", background: "#FDE9C8", borderRadius: 100, padding: "4px 10px", flexShrink: 0 }}>waiting on their price</span>
                    {isAdmin && <button onClick={() => setPriceFor(priceFor && priceFor.id === r.id ? null : { id: r.id, amount: "" })} title="They told you the number? Type it in yourself" style={{ padding: "6px 12px", borderRadius: 100, border: "1px solid rgba(0,0,0,0.05)", background: priceFor && priceFor.id === r.id ? T.goldLight : "#fff", color: "#8a6d1f", fontWeight: 700, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>✎ Price It</button>}
                    {isAdmin && <button onClick={() => cancelAsk(r)} title="Withdraw this request" style={CIRC}>✕</button>}
                  </div>
                  {isAdmin && priceFor && priceFor.id === r.id && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px 11px", background: T.cardAlt, flexWrap: "wrap" }}>
                      <input autoFocus value={priceFor.amount} onChange={(e) => setPriceFor({ ...priceFor, amount: numIn(e.target.value) })} onKeyDown={(e) => e.key === "Enter" && priceAsk(r)} inputMode="decimal" placeholder="Their price — e.g. 8400" style={{ ...inp, flex: 1, minWidth: 140, background: "#fff" }} />
                      <button onClick={() => priceAsk(r)} style={goldBtn(!!Number(numIn(priceFor.amount)))}>Approve at This Price</button>
                      <span style={{ flexBasis: "100%", fontSize: 10.5, color: T.textTert, lineHeight: 1.45 }}>Becomes a change order on the contract — they're notified of the approved price.</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 14, flexDirection: isMobile ? "column" : "row" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SecHd color="#AF52DE" action={isAdmin && !isRemoved ? <span style={{ whiteSpace: "nowrap" }}>{linkBtn("＋ Add", () => setCoDraft({ label: "", amount: "", date: today() }))}{linkBtn("🧾 Ask price", () => setAskDraft({ label: "" }))}</span> : null}>Change Orders</SecHd>
            <div style={{ ...CARD, marginTop: 7 }}>
              {(j.changeOrders || []).map((c, i) => (
                <div key={c.id} style={{ ...rowCss, borderTop: i ? HAIR : "none" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                  <span style={{ color: T.textTert, fontSize: 11 }}>{fmtDate(c.date)}</span><b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{money(c.amount)}</b>
                  {isAdmin && <button onClick={() => save("contractor_jobs", { ...j, changeOrders: (j.changeOrders || []).filter((x) => x.id !== c.id) })} style={{ background: "none", border: "none", color: T.textTert, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
                </div>
              ))}
              {(j.changeOrders || []).length === 0 && !coDraft && <div style={{ padding: "12px 14px", fontSize: 12, color: T.textTert }}>No change orders yet.</div>}
              {(j.changeOrders || []).length > 0 && <div style={{ ...totCss, borderTop: HAIR }}><span style={{ flex: 1, fontSize: 12, color: T.textSub }}>Original contract</span><b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{money(j.price)}</b></div>}
              {coDraft && (
                <div style={{ padding: "10px 12px", borderTop: HAIR, background: T.cardAlt, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input autoFocus value={coDraft.label} onChange={(e) => setCoDraft({ ...coDraft, label: e.target.value })} placeholder="What's added? e.g. 2nd bathroom" style={{ ...inp, flex: 2, minWidth: 130, background: "#fff" }} />
                  <input value={coDraft.amount} onChange={(e) => setCoDraft({ ...coDraft, amount: numIn(e.target.value) })} inputMode="decimal" placeholder="$" style={{ ...inp, flex: 1, minWidth: 70, background: "#fff" }} />
                  <input type="date" value={coDraft.date} onChange={(e) => setCoDraft({ ...coDraft, date: e.target.value })} style={{ ...inp, flex: 1, minWidth: 115, background: "#fff", borderRadius: 100 }} />
                  <button onClick={addCO} style={goldBtn(!!Number(numIn(coDraft.amount)))}>Add</button>
                  <button onClick={() => setCoDraft(null)} style={{ ...ghostBtn, padding: "10px 13px" }}>Cancel</button>
                </div>
              )}
              {askDraft && (
                <div style={{ padding: "10px 12px", borderTop: HAIR, background: T.cardAlt, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input autoFocus value={askDraft.label} onChange={(e) => setAskDraft({ label: e.target.value })} onKeyDown={(e) => e.key === "Enter" && sendAsk()} placeholder="Work you want priced — e.g. Frame out the basement bath" style={{ ...inp, flex: 1, minWidth: 170, background: "#fff" }} />
                  <button onClick={sendAsk} style={goldBtn(!!(askDraft.label || "").trim())}>Send</button>
                  <button onClick={() => setAskDraft(null)} style={{ ...ghostBtn, padding: "10px 13px" }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SecHd color={T.green} action={isAdmin ? <span style={{ whiteSpace: "nowrap" }}>{linkBtn("＋ Add", () => setPayDraft({ amount: "", date: today(), note: "" }))}{qbProjectId ? linkBtn("🔍 QuickBooks", () => setQbPick(true)) : null}</span> : null}>Payments</SecHd>
            <div style={{ ...CARD, marginTop: 7 }}>
              {(j.payments || []).map((pm, i) => (
                <div key={pm.id} style={{ ...rowCss, borderTop: i ? HAIR : "none" }}>
                  {pm.qbId && <span title="Pinned from QuickBooks" style={{ fontSize: 9, fontWeight: 800, color: "#248A3D", background: "#EAF7EE", borderRadius: 100, padding: "2px 6px", flexShrink: 0 }}>QB</span>}
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pm.note || "Payment"}</span>
                  <span style={{ color: T.textTert, fontSize: 11 }}>{fmtDate(pm.date)}</span><b style={{ fontSize: 12.5, color: "#248A3D", fontVariantNumeric: "tabular-nums" }}>{money(pm.amount)}</b>
                  {isAdmin && <button title={pm.qbId ? "Remove — this wire stays excluded from auto-pinning" : "Remove this payment"} onClick={() => save("contractor_jobs", { ...j, payments: (j.payments || []).filter((x) => x.id !== pm.id), ...(pm.qbId ? { qbExcluded: [...(j.qbExcluded || []), pm.qbId] } : {}) })} style={{ background: "none", border: "none", color: T.textTert, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
                </div>
              ))}
              {(j.payments || []).length === 0 && !payDraft && <div style={{ padding: "12px 14px", fontSize: 12, color: T.textTert }}>Nothing paid on this job yet.</div>}
              {autoPinned > 0 && <div style={{ padding: "8px 14px", borderTop: HAIR, background: "#FDF6E4", fontSize: 11, color: "#8a6d1f", fontWeight: 600, lineHeight: 1.45 }}>⚡ {autoPinned} wire{autoPinned !== 1 ? "s" : ""} pinned automatically from QuickBooks. Not theirs? Tap × — it stays excluded.</div>}
              {(j.payments || []).length > 0 && <div style={{ ...totCss, borderTop: HAIR }}><span style={{ flex: 1, fontSize: 12, color: T.textSub }}>Paid so far</span><b style={{ fontSize: 12.5, color: "#248A3D", fontVariantNumeric: "tabular-nums" }}>{money(paid)}</b></div>}
              {payDraft && (
                <div style={{ padding: "10px 12px", borderTop: HAIR, background: T.cardAlt, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input autoFocus value={payDraft.amount} onChange={(e) => setPayDraft({ ...payDraft, amount: numIn(e.target.value) })} inputMode="decimal" placeholder="$" style={{ ...inp, flex: 1, minWidth: 80, background: "#fff" }} />
                  <input type="date" value={payDraft.date} onChange={(e) => setPayDraft({ ...payDraft, date: e.target.value })} style={{ ...inp, flex: 1, minWidth: 115, background: "#fff", borderRadius: 100 }} />
                  <input value={payDraft.note} onChange={(e) => setPayDraft({ ...payDraft, note: e.target.value })} placeholder="Note (check #, draw…)" style={{ ...inp, flex: 2, minWidth: 120, background: "#fff" }} />
                  <button onClick={addPay} style={goldBtn(!!Number(numIn(payDraft.amount)))}>Add</button>
                  <button onClick={() => setPayDraft(null)} style={{ ...ghostBtn, padding: "10px 13px" }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <SecHd color="#0EA5C5" action={<span style={{ whiteSpace: "nowrap" }}>{j.scope ? linkBtn("📄 Open PDF", () => openSowPdf(j).catch(() => {})) : null}{isAdmin ? linkBtn("✎ Edit", () => setScopeEdit(true)) : null}{isAdmin && onEditBasics ? linkBtn("✎ Basics", onEditBasics) : null}</span>}>Scope of Work</SecHd>
          <div style={{ ...CARD, marginTop: 7, padding: "12px 14px" }}>
            <div style={{ fontSize: 12.5, color: j.scope ? T.textSub : T.textTert, whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 130, overflow: "hidden" }}>{j.scope || "No scope written — edit the job or let the contractor upload their SOW PDF."}</div>
          </div>
        </div>

        {isAdmin && orgLogins.length > 1 && (
          <div>
            <SecHd color="#8E8E93">{org?.name || "Their"} People on This Job</SecHd>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
              {orgLogins.map((u) => { const on = onJob(u.id); return (
                <button key={u.id} onClick={() => toggleCrew(u)} title={on ? "On this job — tap to remove them" : "Removed — tap to add them back"} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 13px", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)", background: on ? "#fff" : "rgba(118,118,128,0.08)", color: on ? "#8a6d1f" : T.textTert, fontSize: 12.5, fontWeight: on ? 650 : 500, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.12)" : "none", textDecoration: on ? "none" : "line-through" }}>{on ? "✓" : "✕"} {u.name}</button>
              ); })}
            </div>
            <div style={{ fontSize: 11, color: T.textTert, marginTop: 6, paddingLeft: 4 }}>Tap a name to remove or re-add them. Removed people don't see this job in their portal.</div>
          </div>
        )}

        <div>
          <SecHd color="#B8912E" action={linkBtn(busy ? "Uploading…" : "＋ Upload", () => docRef.current && docRef.current.click())}>Documents</SecHd>
          <input ref={docRef} type="file" accept="application/pdf,image/*" onChange={uploadDoc} style={{ display: "none" }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
            {jDocs.length === 0 && <div style={{ fontSize: 12, color: T.textTert, paddingLeft: 4 }}>No documents yet. Their uploaded SOW PDFs land here too.</div>}
            {jDocs.map((d) => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", color: T.text, fontSize: 12, fontWeight: 600, textDecoration: "none", maxWidth: 230 }}>📄 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span><span style={{ color: T.textTert, fontWeight: 400 }}>· {d.by}</span></a>)}
          </div>
        </div>

        {isAdmin && (
          <div style={{ ...CARD, marginTop: 2 }}>
            {!isRemoved && (
              <button onClick={removeContractor} style={{ display: "block", width: "100%", textAlign: "center", padding: "12px 14px", border: "none", background: "none", color: T.red, fontWeight: 650, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                Remove {org?.name || "the Contractor"} from This Job — Keep All Records
              </button>
            )}
            <button onClick={removeJob} style={{ display: "block", width: "100%", textAlign: "center", padding: "12px 14px", borderTop: isRemoved ? "none" : HAIR, borderLeft: "none", borderRight: "none", borderBottom: "none", background: "none", color: T.red, fontWeight: 650, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
              Delete This Job Entirely — Erases Scope, Tasks, Messages & Payments
            </button>
          </div>
        )}
        <div style={{ fontSize: 10.5, color: "#B45309", fontWeight: 600, textAlign: "center", padding: "0 8px 2px", lineHeight: 1.5 }}>👁 {org?.name || "Their"}'s team sees this job in their portal — contract, change orders, payments, scope, tasks & messages. Your internal chat stays hidden from them.</div>
      </>)}

      {tab2 === "tasks" && (<>
        <div>
          <SecHd color={T.gold}>Tasks for {org?.name || "Them"}</SecHd>
          <div style={{ ...CARD, marginTop: 7 }}>
            {toThem.map((t, i) => (
              <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", borderTop: i ? HAIR : "none" }}>
                {statusPill(t)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: T.text, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: closed(t.status) ? 0.6 : 1 }}>{t.text}</div>
                  <div style={{ fontSize: 11, color: T.textTert }}>{(t.statusBy || t.doneBy) ? `${t.status === "Completed" ? "✓ " : ""}${t.statusBy || t.doneBy}` : ""}</div>
                </div>
                {isAdmin && <button onClick={() => remove("contractor_tasks", t.id)} style={{ background: "none", border: "none", color: T.textTert, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>}
              </div>
            ))}
            {toThem.length === 0 && <div style={{ padding: "12px 14px", fontSize: 12, color: T.textTert }}>Nothing delegated on this job yet.</div>}
            {!isRemoved && <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: toThem.length ? HAIR : "none", background: T.cardAlt }}>
              <input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="Delegate a task to them…" style={{ ...inp, flex: 1, background: "#fff" }} />
              <button onClick={addTask} style={goldBtn(!!taskDraft.trim())}>Add</button>
            </div>}
          </div>
        </div>
        <div>
          <SecHd color="#0EA5C5">Requests From Them</SecHd>
          <div style={{ ...CARD, marginTop: 7 }}>
            {fromThem.map((t, i) => (
              <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", borderTop: i ? HAIR : "none" }}>
                {statusPill(t)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: T.text, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: closed(t.status) ? 0.6 : 1 }}>{t.text}</div>
                  <div style={{ fontSize: 11, color: T.textTert }}>from {t.createdBy || org?.name} · {fmtDate(t.createdAt)}{(t.statusBy || t.doneBy) ? ` · ${t.status === "Completed" ? "✓ " : ""}${t.statusBy || t.doneBy}` : ""}</div>
                </div>
              </div>
            ))}
            {fromThem.length === 0 && <div style={{ padding: "12px 14px", fontSize: 12, color: T.textTert }}>No requests from them on this job.</div>}
          </div>
        </div>
        {doneCount > 0 && (
          <button onClick={() => setShowDone((v) => !v)} style={{ alignSelf: "flex-start", padding: "7px 14px", borderRadius: 100, border: "1px solid rgba(0,0,0,0.05)", background: showDone ? "#fff" : "rgba(118,118,128,0.08)", color: "#248A3D", fontSize: 12, fontWeight: 650, cursor: "pointer", fontFamily: "inherit", boxShadow: showDone ? "0 1px 4px rgba(0,0,0,0.12)" : "none" }}>
            {showDone ? "Hide" : "Show"} Completed · {doneCount}
          </button>
        )}
      </>)}

      {tab2 === "messages" && (<>
        <div ref={scrollRef} style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
          {thread.length === 0 && <div style={{ textAlign: "center", color: T.textTert, fontSize: 13, padding: "26px 0" }}>No messages on this job yet.</div>}
          {thread.map((m) => { const mine = m.side === "team"; return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%" }}>
              {!mine && <div style={{ fontSize: 10, color: T.textTert, margin: "0 0 2px 8px" }}>{(m.author || "").split(" ")[0]}{m.mentions && m.mentions.length ? ` → ${m.mentions.map((n) => n.split(" ")[0]).join(", ")}` : ""} · {fmtWhen(m.at)}</div>}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 5, flexDirection: mine ? "row-reverse" : "row" }}>
                <div style={{ background: mine ? T.gold : "#fff", color: mine ? "#fff" : T.text, border: mine ? "none" : "1px solid rgba(0,0,0,0.06)", borderRadius: 18, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", minWidth: 0 }}>
                  {m.replyTo && <div style={{ fontSize: 11, marginBottom: 4, padding: "4px 8px", borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.6)" : T.gold}`, borderRadius: 5, background: mine ? "rgba(255,255,255,0.15)" : T.cardAlt, color: mine ? "rgba(255,255,255,0.92)" : T.textSub, overflow: "hidden" }}><b>{(m.replyTo.author || "").split(" ")[0]}</b>: {m.replyTo.text}</div>}
                  {m.taskRefText && <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 3, color: mine ? "rgba(255,255,255,0.9)" : "#8a6d1f" }}>↳ Task: {m.taskRefText}</div>}
                  {linkifyText(m.text, mine)}
                  {m.attachment && (m.attachment.kind === "contact" && m.attachment.contact
                  ? <ContactCardBubble c={m.attachment.contact} mine={mine} />
                  : m.attachment.kind === "video" && (m.attachment.pending || m.attachment.failed)
                  ? <VideoUploadBubble att={m.attachment} mine={mine} />
                  : m.attachment.kind === "images" && Array.isArray(m.attachment.items)
                  ? <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 216, marginTop: 6 }}>{m.attachment.items.map((it, i) => <a key={i} href={it.url} target="_blank" rel="noreferrer" style={{ display: "block" }}><img src={it.url} alt="" loading="lazy" style={{ width: m.attachment.items.length === 2 ? 104 : 68, height: m.attachment.items.length === 2 ? 104 : 68, borderRadius: 8, objectFit: "cover", display: "block" }} /></a>)}</div>
                  : m.attachment.kind === "image"
                  ? <a href={m.attachment.url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6 }}><img src={m.attachment.url} alt="" loading="lazy" decoding="async" style={{ width: 200, height: 210, borderRadius: 9, display: "block", objectFit: "cover", background: "#eee" }} /></a>
                  : m.attachment.kind === "video" && m.attachment.stream
                  ? <iframe src={m.attachment.url} title={m.attachment.name || "video"} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen style={{ marginTop: 6, width: "min(300px,70vw)", aspectRatio: "16/9", border: "none", borderRadius: 9, display: "block", background: "#000" }} />
                  : m.attachment.kind === "video"
                  ? <video src={m.attachment.url} controls playsInline preload="metadata" style={{ marginTop: 6, maxWidth: 220, width: "100%", borderRadius: 9, display: "block", background: "#000" }} />
                  : <a href={m.attachment.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "6px 9px", borderRadius: 9, background: mine ? "rgba(255,255,255,0.18)" : T.cardAlt, color: mine ? "#fff" : T.text, textDecoration: "none", fontSize: 11.5, fontWeight: 600, maxWidth: 210 }}>📄 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.attachment.name}</span></a>)}
                </div>
                <button onClick={() => setReplyTo(m)} title="Reply" style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid rgba(0,0,0,0.06)", background: replyTo && replyTo.id === m.id ? T.goldLight : "rgba(118,118,128,0.08)", color: T.textSub, fontSize: 12, cursor: "pointer", flexShrink: 0, padding: 0, fontFamily: "inherit" }}>↩</button>
              </div>
              {mine && <div style={{ fontSize: 10, color: T.textTert, margin: "2px 8px 0", textAlign: "right" }}>{fmtWhen(m.at)}</div>}
            </div>
          ); })}
        </div>
        {replyTo && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.cardAlt, borderLeft: `3px solid ${T.gold}`, borderRadius: 8 }}><span style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↩ Replying to <b>{(replyTo.author || "").split(" ")[0]}</b>: {replyTo.text || (replyTo.attachment ? "📎 attachment" : "")}</span><button onClick={() => setReplyTo(null)} style={{ background: "none", border: "none", color: T.textTert, fontSize: 15, cursor: "pointer" }}>×</button></div>}
        {pending && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.goldLight, border: `1px solid ${T.gold}55`, borderRadius: 10 }}><span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pending.pending ? "🎬 " : "📎 "}{pending.name}{pending.pending ? " — uploading in background, OK to send" : ""}</span><button onClick={() => setPending(null)} style={{ background: "none", border: "none", color: T.textTert, fontSize: 15, cursor: "pointer" }}>×</button></div>}
        {isRemoved ? <div style={{ fontSize: 12.5, color: T.textTert, textAlign: "center", padding: "8px 0" }}>Contractor removed — the thread is kept as a record. Restore them to message again.</div> : <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <input ref={attRef} type="file" multiple accept="image/*,video/*,application/pdf" onChange={pickAtt} style={{ display: "none" }} />
          <button onClick={() => attRef.current && attRef.current.click()} disabled={busy} style={{ width: 38, height: 38, flexShrink: 0, borderRadius: "50%", border: "1px solid rgba(0,0,0,0.05)", background: "rgba(118,118,128,0.08)", fontSize: 15, cursor: "pointer" }}>📎</button>
          <textarea rows={1} value={msgDraft} onChange={(e) => setMsgDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }} onPaste={(e) => { const fixed = rescuePastedLink(e); if (fixed != null) { e.preventDefault(); const el = e.target, st = el.selectionStart ?? msgDraft.length, en = el.selectionEnd ?? msgDraft.length; setMsgDraft(msgDraft.slice(0, st) + fixed + msgDraft.slice(en)); } }} placeholder={`Message ${org?.name}…`} disabled={busy}
            style={{ flex: 1, minWidth: 0, padding: "10px 14px", borderRadius: 18, border: "1px solid rgba(0,0,0,0.05)", background: "rgba(118,118,128,0.08)", fontSize: 14, outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.4, maxHeight: 110, boxSizing: "border-box" }} />
          <button onClick={sendMsg} disabled={(!msgDraft.trim() && !pending) || busy} style={{ ...goldBtn(!!(msgDraft.trim() || pending) && !busy), height: 38, padding: "0 18px", borderRadius: 19, display: "inline-flex", alignItems: "center" }}>Send</button>
        </div>}
      </>)}
      {scopeEdit && <ScopeEditModal j={j} save={save} displayName={displayName} onClose={() => setScopeEdit(false)} />}
      {qbPick && qbProjectId && <QBPayPicker qbProjectId={qbProjectId} orgName={org?.name || ""} existingQbIds={(j.payments || []).map((p) => p.qbId).filter(Boolean)} excludedQbIds={j.qbExcluded || []} onAdd={applyQb} onClose={() => setQbPick(false)} />}
    </Modal>
  );
}


// ── One company's pane: header, members & logins, jobs — used by the merged
// People section (and reachable standalone). Admin sees everything; the same
// markup renders read-only facts for non-admin teammates. ────────────────────
const normCo = (v) => String(v || "").toLowerCase().replace(/\b(llc|inc|corp|co|ltd|construction|builders?|contracting|group)\b/g, "").replace(/[^a-z0-9]/g, "");
export function sameOrgCompany(a, b) { const x = normCo(a), y = normCo(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); }

export function OrgPane({ org, onBack }) {
  const { displayName, isAdmin } = useAuth();
  const { sharedProps, contacts } = useData();
  const { jobs, tasks, messages, docs, save, remove, error } = useContractorData();
  const [orgModal, setOrgModal] = useState(null);
  const [jobModal, setJobModal] = useState(null);
  const [openJobId, setOpenJobId] = useState(null);
  const [addMember, setAddMember] = useState(null); // {} new · {prefill} for an existing contact
  const [manageLogin, setManageLogin] = useState(null);
  const [loginsBump, setLoginsBump] = useState(0);
  const [logins, setLogins] = useState([]);
  const [textTo, setTextTo] = useState(null); // {phone,name}
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const orgJobs = (jobs || []).filter((j) => org && j.orgId === String(org.id)).sort((a, b) => ((a.status === "complete" || a.status === "removed") ? 1 : 0) - ((b.status === "complete" || b.status === "removed") ? 1 : 0) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const openJob = orgJobs.find((j) => String(j.id) === String(openJobId)) || null;
  const properties = (sharedProps || []).filter((p) => !p.archived).sort((a, b) => (a.address || "").localeCompare(b.address || ""));
  const activeJobs = orgJobs.filter((j) => j.status !== "complete" && j.status !== "removed");
  const contracted = activeJobs.reduce((s2, j) => s2 + jobTotal(j), 0);

  useEffect(() => {
    if (!org) { setLogins([]); return; }
    let alive = true;
    supabase.from("users").select("id,name,email,notify_muted,notify_channels").eq("contractor_org_id", String(org.id)).then(({ data }) => { if (alive) setLogins(data || []); });
    return () => { alive = false; };
  }, [org?.id, addMember, loginsBump]); // eslint-disable-line react-hooks/exhaustive-deps

  // Members = portal logins + contacts filed under this company (matched by
  // email or name so a login and their contact card make ONE row).
  const cPhone = (c) => c.phone || (c.phones && c.phones[0] && c.phones[0].number) || "";
  const memberContacts = (contacts || []).filter((c) => c && sameOrgCompany(c.company, org?.name));
  const rows = [];
  const usedC = new Set();
  (logins || []).forEach((u) => {
    const c = memberContacts.find((mc) => (mc.email && u.email && String(mc.email).toLowerCase() === String(u.email).toLowerCase()) || (mc.name && u.name && String(mc.name).trim().toLowerCase() === String(u.name).trim().toLowerCase())) || null;
    if (c) usedC.add(c.id);
    rows.push({ key: "u" + u.id, login: u, contact: c, name: u.name || (c && c.name) || u.email, phone: (c && cPhone(c)) || "", email: u.email || "", role: (c && c.role) || "" });
  });
  memberContacts.filter((c) => !usedC.has(c.id)).forEach((c) => rows.push({ key: "c" + c.id, login: null, contact: c, name: c.name || "(no name)", phone: cPhone(c), email: c.email || "", role: c.role || "" }));
  if (org?.contactName && !rows.some((r) => String(r.name).trim().toLowerCase() === String(org.contactName).trim().toLowerCase())) {
    rows.unshift({ key: "main", login: null, contact: null, name: org.contactName, phone: org.phone || "", email: org.email || "", role: "main contact" });
  }
  const initialsOf = (n) => String(n || "").replace(/[^a-zA-Z\s]/g, "").trim().split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase() || "🔨";

  if (!org) return null;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 22px 28px", background: T.bg }}>
      {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: "#8a6d1f", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", padding: "0 0 10px" }}>‹ People</button>}

      <div style={{ ...CARD, borderRadius: 16, padding: "15px 17px 13px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span style={{ width: 46, height: 46, borderRadius: "50%", background: "#F5E9C8", color: "#8a6d1f", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initialsOf(org.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 750, color: T.text, letterSpacing: -0.3 }}>{org.name}</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
              {org.contactName && <span>👤 {org.contactName}</span>}
              {org.phone && <CallA phone={org.phone} style={{ color: T.text, textDecoration: "none" }}>📞 {org.phone}</CallA>}
              {org.email && <a href={`mailto:${org.email}`} style={{ color: T.text, textDecoration: "none" }}>✉️ {org.email}</a>}
              {org.address && <span>🏠 {org.address}</span>}
            </div>
          </div>
          {isAdmin && <button onClick={() => setOrgModal(org)} style={{ ...ghostBtn, padding: "7px 13px", fontSize: 12, flexShrink: 0 }}>✎ Edit</button>}
        </div>
        <div style={{ display: "flex", gap: 7, marginTop: 11, flexWrap: "wrap" }}>
          {logins.length > 0
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 100, background: "#EAF7EE", color: "#248A3D", border: "1px solid rgba(36,138,61,0.2)", fontSize: 11, fontWeight: 700 }}>● Portal active</span>
            : <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 100, background: "rgba(118,118,128,0.08)", color: T.textSub, border: "1px solid rgba(0,0,0,0.05)", fontSize: 11, fontWeight: 700 }}>No portal logins yet</span>}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 100, background: "rgba(118,118,128,0.08)", color: T.textSub, border: "1px solid rgba(0,0,0,0.05)", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{activeJobs.length} active job{activeJobs.length !== 1 ? "s" : ""}{contracted > 0 ? ` · ${money(contracted)} contracted` : ""}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "16px 6px 7px" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.gold, flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text, letterSpacing: -0.1 }}>Members</span>
        <span style={{ fontSize: 12, color: T.textTert }}>· {rows.length}</span>
        <span style={{ flex: 1 }} />
        {isAdmin && <button onClick={() => setAddMember({})} style={{ background: "none", border: "none", color: "#8a6d1f", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>＋ Add Member</button>}
      </div>
      <div style={{ ...CARD, borderRadius: 16 }}>
        {rows.length === 0 && <div style={{ padding: "16px 14px", fontSize: 12.5, color: T.textTert, textAlign: "center" }}>No members yet — add their first person and send them a login.</div>}
        {rows.map((r, i) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: i ? HAIR : "none" }}>
            <span style={{ width: 34, height: 34, borderRadius: "50%", background: r.login ? "#F5E9C8" : "#E8E8ED", color: r.login ? "#8a6d1f" : T.textSub, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initialsOf(r.name)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 650, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                {r.login
                  ? <span style={{ fontSize: 10, fontWeight: 700, background: "#EAF7EE", color: "#248A3D", borderRadius: 100, padding: "2px 8px", flexShrink: 0 }}>portal login{r.login.notify_muted ? " · muted" : ""}</span>
                  : <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(118,118,128,0.08)", color: T.textSub, border: "1px solid rgba(0,0,0,0.05)", borderRadius: 100, padding: "2px 8px", flexShrink: 0 }}>no login</span>}
              </span>
              <span style={{ display: "block", fontSize: 11.5, color: T.textSub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[r.email, r.phone, r.role].filter(Boolean).join(" · ") || "—"}</span>
            </span>
            {r.phone && <CallA phone={r.phone} title="Call" style={{ ...CIRC, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", boxSizing: "border-box" }}>📞</CallA>}
            {r.phone && <button onClick={() => setTextTo({ phone: r.phone, name: r.name })} title="Text" style={{ ...CIRC, width: 32, height: 32 }}>💬</button>}
            {isAdmin && (r.login
              ? <button onClick={() => setManageLogin(r.login)} title="Manage their login" style={{ background: "none", border: "none", color: "#C7C7CC", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: "0 2px" }}>›</button>
              : <button onClick={() => setAddMember({ prefill: { name: r.name, phone: r.phone, email: r.email, role: r.role, contactId: r.contact ? r.contact.id : "x" } })} title="Create their portal login" style={{ background: "none", border: "none", color: "#8a6d1f", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, whiteSpace: "nowrap" }}>＋ Login</button>)}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "16px 6px 7px" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#0EA5C5", flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text, letterSpacing: -0.1, flex: 1 }}>Jobs</span>
        {isAdmin && <button onClick={() => setJobModal({})} style={{ ...goldBtn(true), padding: "8px 15px", fontSize: 12.5, borderRadius: 100 }}>＋ New Job</button>}
      </div>
      <div style={{ ...CARD, borderRadius: 16 }}>
        {orgJobs.length === 0 && <div style={{ padding: "20px 16px", textAlign: "center", color: T.textTert, fontSize: 13 }}>No jobs yet for {org.name}.</div>}
        {orgJobs.map((j, i) => {
          const total = jobTotal(j), paid = jobPaid(j), days = jobDays(j);
          const done = j.status === "complete", removed = j.status === "removed", bid = j.status === "bid";
          const needsOk = (j.coRequests || []).filter((r) => r.status === "pending").length;
          const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
          return (
            <div key={j.id} onClick={() => setOpenJobId(j.id)} style={{ padding: "13px 14px", borderTop: i ? HAIR : "none", cursor: "pointer", opacity: done || removed ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.propertyAddress}{j.title ? ` — ${j.title}` : ""}</span>
                {bid && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#B45309", background: "#FDE9C8", borderRadius: 100, padding: "3px 9px", flexShrink: 0 }}>BID REQUEST</span>}
                {!done && !removed && !bid && days != null && <span style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)", borderRadius: 100, padding: "3px 9px", flexShrink: 0 }}>DAY {days}</span>}
                {needsOk > 0 && !removed && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#B45309", background: "#FDE9C8", borderRadius: 100, padding: "3px 9px", flexShrink: 0 }}>{needsOk} needs your OK</span>}
                {removed && <span style={{ fontSize: 10, fontWeight: 700, background: "#FFF0EF", color: T.red, borderRadius: 100, padding: "3px 9px", flexShrink: 0 }}>REMOVED</span>}
                {done && <span style={{ fontSize: 10.5, fontWeight: 700, background: "#EAF7EE", color: "#248A3D", borderRadius: 100, padding: "3px 9px", flexShrink: 0 }}>✓ Complete</span>}
                <span style={{ color: "#C7C7CC", fontSize: 15, flexShrink: 0 }}>›</span>
              </div>
              {bid
                ? <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 3 }}>Waiting on their bid</div>
                : done || removed
                ? <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{money(total)}{paid >= total && total > 0 ? " · paid in full" : ` · ${money(paid)} paid`}</div>
                : <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                    <span style={{ flex: 1, maxWidth: 260, height: 5, borderRadius: 3, background: "rgba(118,118,128,0.14)", overflow: "hidden" }}><span style={{ display: "block", width: `${pct}%`, height: "100%", background: T.green, borderRadius: 3 }} /></span>
                    <span style={{ fontSize: 11.5, color: T.textSub, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(paid)} of {money(total)} paid</span>
                  </div>}
            </div>
          );
        })}
      </div>

      {error && <div style={{ position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)", background: "#FFF0EF", border: `1.5px solid ${T.red}`, color: T.red, borderRadius: 12, padding: "10px 16px", fontSize: 12.5, fontWeight: 600, zIndex: 500 }}>{error}</div>}
      {orgModal && <OrgModal orgModal={orgModal} contacts={contacts} save={save} onSaved={() => {}} onClose={() => setOrgModal(null)} />}
      {addMember && <AddMemberModal org={org} contacts={contacts} existingEmails={logins.map((u) => u.email)} prefill={addMember.prefill || null} onSaved={() => setLoginsBump((x) => x + 1)} onClose={() => setAddMember(null)} />}
      {manageLogin && <ManageLoginModal login={manageLogin} onDone={() => setLoginsBump((x) => x + 1)} onClose={() => setManageLogin(null)} />}
      {jobModal && <JobModal org={org} jobModal={jobModal.id ? jobModal : null} properties={properties} save={save} onSaved={setOpenJobId} onClose={() => setJobModal(null)} />}
      {openJob && <JobDetail j={openJob} org={org} isAdmin={isAdmin} qbProjectId={(properties.find((p) => String(p.id) === String(openJob.propertyId)) || {}).qbProjectId || null} tasks={tasks} messages={messages} docs={docs} save={save} remove={remove} displayName={displayName} onEditBasics={() => setJobModal(openJob)} onClose={() => setOpenJobId(null)} />}
      {textTo && <SmsThreadPopup phone={textTo.phone} name={textTo.name} onClose={() => setTextTo(null)} />}
    </div>
  );
}

// Legacy standalone page (the old Contractors nav section) — now a thin shell
// around OrgPane; the merged People section is the primary home.
export function ContractorsAdminPage() {
  const { isAdmin } = useAuth();
  const { contacts } = useData();
  const { orgs, jobs, save } = useContractorData();
  const [selOrgId, setSelOrgId] = useState(null);
  const [orgModal, setOrgModal] = useState(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const orgList = (orgs || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const org = orgList.find((o) => String(o.id) === String(selOrgId)) || null;
  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: T.bg }}>
      <div style={{ width: isMobile ? "100%" : 300, flexShrink: 0, display: isMobile && org ? "none" : "flex", flexDirection: "column", borderRight: isMobile ? "none" : `1px solid ${T.border}`, background: T.card, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: HAIR, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 750, color: T.text, flex: 1 }}>Contractors <span style={{ color: T.textTert, fontWeight: 500 }}>· {orgList.length}</span></div>
          {isAdmin && <button onClick={() => setOrgModal({})} style={{ ...goldBtn(true), padding: "7px 13px", fontSize: 12, borderRadius: 100 }}>＋ Company</button>}
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {orgList.map((o) => {
            const n = (jobs || []).filter((jj) => jj.orgId === String(o.id) && jj.status !== "complete" && jj.status !== "removed").length;
            const on = String(selOrgId) === String(o.id);
            return (
              <div key={o.id} onClick={() => setSelOrgId(String(o.id))} style={{ padding: "12px 14px", borderBottom: HAIR, cursor: "pointer", background: on ? T.goldLight : "transparent" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{o.name}</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{n} active job{n !== 1 ? "s" : ""}{o.contactName ? ` · ${o.contactName}` : ""}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, display: isMobile && !org ? "none" : "flex", flexDirection: "column", overflow: "hidden" }}>
        {org ? <OrgPane org={org} onBack={isMobile ? () => setSelOrgId(null) : null} />
          : <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: T.textSub, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 30 }}>👷</div><div style={{ fontSize: 15, fontWeight: 700 }}>Pick a contractor</div>
            </div>}
      </div>
      {orgModal && <OrgModal orgModal={null} contacts={contacts} save={save} onSaved={setSelOrgId} onClose={() => setOrgModal(null)} />}
    </div>
  );
}
