// Business texting (Quo) — the client side. One shared store for the whole
// app: texting connection status, every SMS conversation (loaded once, kept
// live via realtime), sending, and the little thread-status badges.
// When texting isn't connected, every entry point falls back to the phone's
// own sms: links exactly as before.
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { qbAuthFetch } from "./net";
import { T } from "./theme";
import { SmsChatIcon } from "./icons";

const e164 = (n) => {
  const d = String(n || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? "+" + d : "";
};

let store = { connected: null, from: "", msgs: null };
// Per-user "last read" time per conversation (keyed by E.164 number), saved in
// the account's metadata so read/unread follows you across phone and computer.
let readMap = {};
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* consumer gone */ } });
let started = false, loadT = null;

async function loadMsgs() {
  const { data, error } = await supabase.from("sms_messages").select("id,phone,data").order("updated_at", { ascending: true });
  if (!error) { store = { ...store, msgs: (data || []).map((r) => ({ ...(r.data || {}), id: r.id, phone: r.phone || (r.data || {}).phone || "" })) }; emit(); }
}
const scheduleLoad = () => { clearTimeout(loadT); loadT = setTimeout(loadMsgs, 250); };

function start() {
  if (started) return;
  started = true;
  // Authenticated: the server only reports connected:true to admins (the
  // connected Quo number is the admin's own line for now).
  qbAuthFetch("/api/texting/status").then((s) => {
    store = { ...store, connected: !!s.connected, from: s.from || "" };
    emit();
    if (s.connected) {
      loadMsgs();
      supabase.auth.getUser().then(({ data }) => { readMap = (data?.user?.user_metadata?.smsRead) || {}; emit(); }).catch(() => {});
      const ch = supabase.channel("sms-shared");
      ch.on("postgres_changes", { event: "*", schema: "public", table: "sms_messages" }, scheduleLoad);
      ch.subscribe();
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleLoad(); });
    }
  }).catch(() => { store = { ...store, connected: false }; emit(); });
}

// Opening a conversation marks it read (for this account, on every device).
function markThreadRead(phone) {
  const p = e164(phone);
  if (!p) return;
  readMap = { ...readMap, [p]: new Date().toISOString() };
  emit();
  supabase.auth.updateUser({ data: { smsRead: readMap } }).catch(() => {});
}

export function useSmsTexting() {
  const [, force] = useState(0);
  useEffect(() => {
    start();
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  const msgs = store.msgs || [];
  const threadFor = (ph) => { const p = e164(ph); return p ? msgs.filter((m) => e164(m.phone) === p) : []; };
  const statusFor = (ph) => {
    const t = threadFor(ph);
    if (!t.length) return "";
    return t[t.length - 1].direction === "in" ? "replied" : "awaiting";
  };
  // Incoming texts newer than the last time this user opened the conversation.
  const unreadFor = (ph) => {
    const p = e164(ph);
    if (!p) return 0;
    const since = readMap[p] || "";
    return threadFor(p).filter((m) => m.direction === "in" && String(m.at || "") > since).length;
  };
  const send = async (to, text) => {
    await qbAuthFetch("/api/texting/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, message: text }) });
    setTimeout(loadMsgs, 500);
  };
  return { connected: store.connected, from: store.from, threadFor, statusFor, unreadFor, send };
}

// Tiny thread-status badge for lists: ⏳ we texted, no reply yet · replied
// (green) · NEW REPLY (red) until the conversation is opened.
export function SmsBadge({ phone }) {
  const { connected, statusFor, unreadFor } = useSmsTexting();
  if (!connected) return null;
  const st = statusFor(phone);
  if (!st) return null;
  const pill = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, borderRadius: 12, padding: "2px 7px", whiteSpace: "nowrap" };
  if (st === "replied" && unreadFor(phone) > 0)
    return <span title="New reply you haven't read — open the conversation" style={{ ...pill, color: "#fff", background: T.red }}><SmsChatIcon size={10} color="#fff" strokeWidth={2.5} /> new reply</span>;
  return st === "awaiting"
    ? <span title="Text sent — waiting on their reply" style={{ ...pill, color: "#B45309", background: "#FDE9C8" }}>⏳ no reply</span>
    : <span title="They replied — open the conversation" style={{ ...pill, color: "#15803D", background: "#EDFBF1" }}><SmsChatIcon size={10} color="#15803D" strokeWidth={2.5} /> replied</span>;
}

// ─── "Which phone?" chooser ──────────────────────────────────────────────────
// On a phone, tapping Call/Text asks: business line (the Quo app / in-app
// thread) or this device's own number? Quo's deep links only work in its
// mobile app, so desktop keeps the old behavior — tel: goes to whatever the
// computer's default calling app is (Quo desktop once it's set as default).
const IS_PHONE = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");

const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : String(p || "");
};

function PhoneChooser({ phone, mode, onInApp, onClose }) {
  const { from } = useSmsTexting();
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  const go = (href) => { onClose(); window.location.href = href; };
  const opt = { display: "flex", alignItems: "center", gap: 13, width: "100%", padding: "13px 15px", borderRadius: 14, border: `1px solid ${T.border}`, background: "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left", boxSizing: "border-box" };
  return (
    <div onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 470, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 14, boxSizing: "border-box", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, borderRadius: 20, width: "min(420px,96vw)", padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8, marginBottom: "env(safe-area-inset-bottom)", boxShadow: "0 12px 48px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, padding: "4px 6px 2px", display: "flex", alignItems: "center", gap: 6 }}>{mode === "call" ? "📞 Call" : <><SmsChatIcon size={13} color="#15803D" /> Text</>} {fmtPhone(phone)} using…</div>
        <button style={opt} onClick={() => {
          if (mode === "call") go(`openphone://dial?number=${encodeURIComponent(e164(phone))}${from ? `&from=${encodeURIComponent(from)}` : ""}&action=call`);
          else if (onInApp) { onClose(); onInApp(); }
          else go(`openphone://message?number=${encodeURIComponent(e164(phone))}${from ? `&from=${encodeURIComponent(from)}` : ""}`);
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>💼</span>
          <span style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Business line{from ? ` · ${fmtPhone(from)}` : ""}</div>
            <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{mode === "call" ? "Opens the Quo app — they see the company number" : onInApp ? "Right here in the app — saved to the conversation" : "Opens the Quo app — sends from the company number"}</div>
          </span>
        </button>
        <button style={opt} onClick={() => go(mode === "call" ? `tel:${digits}` : `sms:${digits}`)}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>📱</span>
          <span style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>My phone</div>
            <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{mode === "call" ? "Regular call from this phone's own number" : "Messages app — from this phone's own number"}</div>
          </span>
        </button>
        <button onClick={onClose} style={{ ...opt, justifyContent: "center", background: T.bg, border: "none", fontWeight: 700, fontSize: 13.5, color: T.textSub, padding: "10px 15px" }}>Cancel</button>
      </div>
    </div>
  );
}

// Drop-in replacements for <a href="tel:…"> / <a href="sms:…"> links. When
// texting is connected AND we're on a phone they open the chooser above;
// otherwise they behave exactly like the plain links they replace. TextA's
// optional onInApp opens the in-app thread as the "business line" choice
// (and stays the direct desktop behavior, as before).
export function CallA({ phone, style, title, children }) {
  const { connected } = useSmsTexting();
  const [choose, setChoose] = useState(false);
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return (<>
    <a href={`tel:${digits}`} title={title} onClick={connected && IS_PHONE ? (e) => { e.preventDefault(); e.stopPropagation(); setChoose(true); } : undefined} style={style}>{children}</a>
    {choose && <PhoneChooser phone={phone} mode="call" onClose={() => setChoose(false)} />}
  </>);
}

export function TextA({ phone, style, title, onInApp, children }) {
  const { connected } = useSmsTexting();
  const [choose, setChoose] = useState(false);
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  const intercept = connected && (IS_PHONE || !!onInApp);
  return (<>
    <a href={`sms:${digits}`} title={title} onClick={intercept ? (e) => { e.preventDefault(); e.stopPropagation(); if (IS_PHONE) setChoose(true); else onInApp(); } : undefined} style={style}>{children}</a>
    {choose && <PhoneChooser phone={phone} mode="text" onInApp={onInApp} onClose={() => setChoose(false)} />}
  </>);
}

// The conversation popup: full back-and-forth with one number, template chips,
// and a composer that sends from the company line.
export function SmsThreadPopup({ phone, name, templates = [], initialKind = null, sentStamps = {}, onClearStamp, onSent, onClose }) {
  const { from, threadFor, send } = useSmsTexting();
  const init = templates.find((t) => t.kind === initialKind);
  const [draft, setDraft] = useState(init ? init.text : "");
  const [kind, setKind] = useState(init ? init.kind : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const thread = threadFor(phone);
  const scrollRef = useRef(null);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.length]);
  // Having the conversation open means you've read it — clears the red
  // "new reply" badge on every device (re-marks as new messages stream in).
  useEffect(() => { markThreadRead(phone); }, [phone, thread.length]);
  const doSend = async () => {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true); setErr("");
    try {
      await send(phone, t);
      setDraft(""); setKind(null);
      onSent && onSent(kind);
    } catch (ex) { setErr(ex.message || "Couldn't send — try again."); }
    setBusy(false);
  };
  const fmt = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 460, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, boxSizing: "border-box", backdropFilter: "blur(5px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, width: "min(480px,96vw)", height: "min(640px,90vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 48px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "13px 16px", borderBottom: `2px solid ${T.gold}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 7 }}><SmsChatIcon size={15} color="#15803D" /> {name || phone}</div>
            <div style={{ fontSize: 11, color: T.textSub }}>{phone} · from your business line {from}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.textTert, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 8, background: T.bg }}>
          {thread.length === 0 && <div style={{ textAlign: "center", color: T.textTert, fontSize: 12.5, padding: "30px 10px" }}>No texts with this number yet. Pick a template below or write your own — it sends from the company line, and their replies show up right here.</div>}
          {thread.map((m) => {
            const mine = m.direction !== "in";
            return (
              <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
                <div style={{ background: mine ? T.gold : "#fff", color: mine ? "#fff" : T.text, border: mine ? "none" : `1px solid ${T.border}`, borderRadius: 14, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>
                <div style={{ fontSize: 9.5, color: T.textTert, marginTop: 2, textAlign: mine ? "right" : "left" }}>
                  {mine ? `${(m.by || "").split(" ")[0] || "You"} · ` : ""}{fmt(m.at)}{mine ? (m.status === "delivered" ? " · ✓✓" : " · ✓") : ""}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "10px 12px max(10px,env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          {err && <div style={{ fontSize: 11.5, color: T.red, fontWeight: 600, marginBottom: 6 }}>{err}</div>}
          {templates.length > 0 && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
              {templates.map((t) => {
                const sent = sentStamps[t.kind];
                const sentD = sent ? (() => { try { return new Date(sent).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } })() : "";
                const active = kind === t.kind;
                return (
                  <span key={t.kind} style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <button onClick={() => { setDraft(t.text); setKind(t.kind); }}
                      title={sent ? `${t.label} sent ${sentD} — tap to load it again` : `Load the ${t.label.toLowerCase()} text`}
                      style={{ whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 16, border: `1px solid ${sent ? "#3BA55D" : active ? T.gold : T.border}`, background: sent ? "#EDFBF1" : active ? T.goldLight : "#fff", color: sent ? "#15803D" : active ? "#8a6d1f" : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>
                      {sent ? `✓ ${t.label} · sent ${sentD}` : t.label}
                    </button>
                    {sent && onClearStamp && <button onClick={() => { if (window.confirm(`Clear the "${t.label} sent" mark?`)) onClearStamp(t.kind); }} title="Clear the sent mark" style={{ background: "none", border: "none", color: T.textTert, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}>×</button>}
                  </span>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
            <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a text…"
              style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13.5, outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.4, boxSizing: "border-box" }} />
            <button onClick={doSend} disabled={!draft.trim() || busy} style={{ padding: "10px 16px", borderRadius: 12, border: "none", background: draft.trim() && !busy ? T.gold : T.border, color: "#fff", fontWeight: 800, fontSize: 13, cursor: draft.trim() && !busy ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
