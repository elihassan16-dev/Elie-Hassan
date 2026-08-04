// Business texting (Jivetel) — the client side. One shared store for the
// whole app: texting connection status, every SMS conversation (loaded once,
// kept live via realtime), sending, and the little thread-status badges.
// Each signed-in person texts from their own Jivetel line. When texting
// isn't connected for someone, their entry points fall back to the phone's
// own sms: links exactly as before.
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { qbAuthFetch } from "./net";
import { T } from "./theme";
import { SmsChatIcon } from "./icons";

// Turn bare URLs inside message text into tappable links. Returns a mixed
// array of strings and <a> elements; plain text passes through untouched.
const URL_RX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
export function linkifyText(text, mine) {
  const s = String(text ?? "");
  const parts = s.split(URL_RX);
  if (parts.length < 2) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0 || !part) return part;
    let url = part, trail = "";
    const m = url.match(/[.,!?;:)\]]+$/);
    if (m) { trail = m[0]; url = url.slice(0, url.length - trail.length); }
    const href = /^https?:/i.test(url) ? url : `https://${url}`;
    return (
      <span key={i}>
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          style={{ color: mine ? "#fff" : "#2563EB", textDecoration: "underline", wordBreak: "break-all" }}>{url}</a>{trail}
      </span>
    );
  });
}

// Some apps' share sheets (Amazon among them) put the real URL on the
// clipboard as a URL/HTML flavor while the plain-text flavor is only the
// product title. WhatsApp reads those flavors; a plain textarea doesn't — so
// fish the URL out and return the text that SHOULD have been pasted, or null
// when the default paste already carries a link (or there's none to find).
export function rescuePastedLink(e) {
  try {
    const dt = e.clipboardData;
    if (!dt) return null;
    const plain = dt.getData("text/plain") || "";
    if (/https?:\/\/|www\./i.test(plain)) return null;
    let url = (dt.getData("text/uri-list") || "").split("\n").find((l) => l && !l.startsWith("#")) || "";
    if (!url) {
      const m = (dt.getData("text/html") || "").match(/href\s*=\s*["'](https?:[^"']+)["']/i);
      if (m) url = m[1];
    }
    if (!url) return null;
    return plain.trim() ? `${plain.trim()} ${url}` : url;
  } catch { return null; }
}

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
const scheduleLoad = () => {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // visibilitychange below reloads on return
  clearTimeout(loadT); loadT = setTimeout(loadMsgs, 600);
};

function start() {
  if (started) return;
  started = true;
  // Authenticated: connected means THIS person's Jivetel line is wired up
  // (their number + API token exist). Contractors always get false.
  qbAuthFetch("/api/jivetel/send?cap=1").then((s) => {
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
    // Call rows live in the same thread but don't drive replied/awaiting.
    const t = threadFor(ph).filter((m) => m.kind !== "call");
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
    await qbAuthFetch("/api/jivetel/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, message: text }) });
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
// Tapping Call/Text asks: your Jivetel business line (click-to-call / the
// in-app conversation) or this device's own number? On desktop the business
// line is the only choice that can do anything, so it leads.
const IS_PHONE = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");

const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : String(p || "");
};

const smsHref = (phone, body) => {
  const clean = String(phone || "").replace(/[^\d+]/g, "");
  if (!body) return `sms:${clean}`;
  const sep = (typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) ? "&" : "?"; // iOS wants &body=
  return `sms:${clean}${sep}body=${encodeURIComponent(body)}`;
};

// ─── Jivetel click-to-call: is calling wired up for the signed-in user? ─────
// Asked once per session; everyone shares the answer. People without their
// own portal creds (contractors, teammates not set up yet) simply don't get
// the Jivetel option — their buttons behave exactly as before.
let jvCapPromise = null;
let jvCap = { enabled: false, from: "", why: "" };
export function useJivetelCall() {
  const [st, setSt] = useState(jvCap);
  useEffect(() => {
    if (!jvCapPromise) {
      // qbAuthFetch returns the parsed JSON (and throws with the server's
      // error message on failure) — no Response unwrapping here.
      jvCapPromise = qbAuthFetch("/api/jivetel/call?cap=1")
        .then((d) => { jvCap = { enabled: !!(d && d.enabled), from: (d && d.from) || "", why: (d && d.why) || "" }; })
        .catch((e) => { jvCap = { enabled: false, from: "", why: e?.message || "network error" }; });
    }
    let live = true;
    jvCapPromise.then(() => { if (live) setSt(jvCap); });
    return () => { live = false; };
  }, []);
  return st;
}

function PhoneChooser({ phone, mode, onInApp, templates = [], onTemplate, onClose, jivetel }) {
  const { from } = useSmsTexting();
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  // For texting with templates on offer, "My phone" opens a second step:
  // blank text or one of the templates, prefilled into the Messages app.
  const [step, setStep] = useState("main");
  // "" | "busy" | "ringing" | "err:<message>" — Jivetel call progress.
  const [calling, setCalling] = useState("");
  // Business-line texting without a caller-supplied thread opener: show the
  // in-app conversation right here.
  const [inThread, setInThread] = useState(false);
  const go = (href) => { onClose(); window.location.href = href; };
  const placeJivetelCall = async () => {
    setCalling("busy");
    try {
      // Parsed JSON on success; throws with the server's message on failure.
      await qbAuthFetch("/api/jivetel/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: phone }) });
      setCalling("ringing");
      setTimeout(onClose, 3200);
    } catch (e) {
      setCalling("err:" + (e.message || "Couldn't place the call."));
    }
  };
  const opt = { display: "flex", alignItems: "center", gap: 13, width: "100%", padding: "13px 15px", borderRadius: 14, border: `1px solid ${T.border}`, background: "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left", boxSizing: "border-box" };
  if (inThread) return <SmsThreadPopup phone={phone} name={fmtPhone(phone)} onClose={onClose} />;
  return (
    <div onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 470, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 14, boxSizing: "border-box", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, borderRadius: 20, width: "min(420px,96vw)", padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8, marginBottom: "env(safe-area-inset-bottom)", boxShadow: "0 12px 48px rgba(0,0,0,0.3)" }}>
        {calling ? (
          <div style={{ padding: "22px 12px", textAlign: "center", fontSize: 13.5, lineHeight: 1.6 }}>
            {calling === "busy" ? <b>☎️ Placing the call…</b>
              : calling === "ringing" ? <><b>☎️ Your phone is ringing</b><div style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}>Pick up, and we'll connect you to {fmtPhone(phone)}.</div></>
              : <><span style={{ color: T.red, fontWeight: 700 }}>{calling.slice(4)}</span><div><button onClick={() => setCalling("")} style={{ marginTop: 10, padding: "8px 18px", borderRadius: 10, border: `1px solid ${T.border}`, background: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700 }}>‹ Back</button></div></>}
          </div>
        ) : step === "main" ? (<>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, padding: "4px 6px 2px", display: "flex", alignItems: "center", gap: 6 }}>{mode === "call" ? "📞 Call" : <><SmsChatIcon size={13} color="#15803D" /> Text</>} {fmtPhone(phone)} using…</div>
          {mode === "call" && !jivetel?.enabled && jivetel?.why && (
            <div style={{ fontSize: 10.5, color: T.textTert, padding: "2px 8px", lineHeight: 1.5 }}>☎️ Jivetel calling unavailable — {jivetel.why}</div>
          )}
          {mode === "call" && jivetel?.enabled && (
            <button style={{ ...opt, border: `1.5px solid ${T.gold}`, background: "#FDF9EE" }} onClick={placeJivetelCall}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>☎️</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>My Jivetel line{jivetel.from ? ` · ${fmtPhone(jivetel.from)}` : ""}</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>Your Jivetel phone rings first — answer, and we connect them. They see your business number.</div>
              </span>
            </button>
          )}
          {mode === "text" && (
            <button style={opt} onClick={() => {
              if (onInApp && templates.length) setStep("business");
              else if (onInApp) { onClose(); onInApp(); }
              else setInThread(true);
            }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>💼</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Business line{from ? ` · ${fmtPhone(from)}` : ""}</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>Right here in the app — the full conversation, from your business number</div>
              </span>
            </button>
          )}
          {(mode === "text" || IS_PHONE) && (
            <button style={opt} onClick={() => { if (mode === "text" && templates.length) setStep("personal"); else go(mode === "call" ? `tel:${digits}` : `sms:${digits}`); }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>📱</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>My phone</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{mode === "call" ? "Regular call from this phone's own number" : `Messages app — from this phone's own number${templates.length ? ", blank or a template" : ""}`}</div>
              </span>
            </button>
          )}
        </>) : step === "business" ? (<>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, padding: "4px 6px 2px" }}>💼 Business line — start with…</div>
          <button style={opt} onClick={() => { onClose(); onInApp(null); }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>💬</span>
            <span style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Open the conversation</div>
              <div style={{ fontSize: 11, color: T.textSub, marginTop: 1 }}>Full history — write your own text or pick a template inside</div>
            </span>
          </button>
          {templates.map((t) => (
            <button key={t.kind} style={opt} onClick={() => { onClose(); onInApp(t.kind); }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>📋</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{t.label}</div>
                <div style={{ fontSize: 11, color: T.textSub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</div>
              </span>
            </button>
          ))}
        </>) : (<>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, padding: "4px 6px 2px" }}>📱 Text from my phone — start with…</div>
          <button style={opt} onClick={() => go(smsHref(phone))}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>✏️</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Blank text</span>
          </button>
          {templates.map((t) => (
            <button key={t.kind} style={opt} onClick={() => { onTemplate && onTemplate(t.kind); go(smsHref(phone, t.text)); }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>📋</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{t.label}</div>
                <div style={{ fontSize: 11, color: T.textSub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</div>
              </span>
            </button>
          ))}
        </>)}
        <button onClick={step === "main" ? onClose : () => setStep("main")} style={{ ...opt, justifyContent: "center", background: T.bg, border: "none", fontWeight: 700, fontSize: 13.5, color: T.textSub, padding: "10px 15px" }}>{step === "main" ? "Cancel" : "‹ Back"}</button>
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
  const jv = useJivetelCall();
  const [choose, setChoose] = useState(false);
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  // With Jivetel wired up the chooser works everywhere — including desktop,
  // where a bare tel: link was a dead end.
  const intercept = jv.enabled || (connected && IS_PHONE);
  return (<>
    <a href={`tel:${digits}`} title={title} onClick={intercept ? (e) => { e.preventDefault(); e.stopPropagation(); setChoose(true); } : undefined} style={style}>{children}</a>
    {choose && <PhoneChooser phone={phone} mode="call" jivetel={jv} onClose={() => setChoose(false)} />}
  </>);
}

export function TextA({ phone, style, title, onInApp, templates, onTemplate, children }) {
  const { connected } = useSmsTexting();
  const [choose, setChoose] = useState(false);
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  // Connected texting works everywhere now — on desktop a Text button either
  // jumps straight to the in-app thread (onInApp) or opens the chooser, whose
  // business option shows the thread right there.
  const intercept = connected;
  return (<>
    <a href={`sms:${digits}`} title={title} onClick={intercept ? (e) => { e.preventDefault(); e.stopPropagation(); if (!IS_PHONE && onInApp) onInApp(); else setChoose(true); } : undefined} style={style}>{children}</a>
    {choose && <PhoneChooser phone={phone} mode="text" onInApp={onInApp} templates={templates || []} onTemplate={onTemplate} onClose={() => setChoose(false)} />}
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
            if (m.kind === "call") {
              return (
                <div key={m.id} style={{ alignSelf: "center", textAlign: "center" }}>
                  <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color: m.missed ? "#C2410C" : T.textSub, background: m.missed ? "#FFF1EA" : "#EFEFF3", border: `1px solid ${m.missed ? "#F6C9B2" : T.border}`, borderRadius: 12, padding: "4px 11px" }}>{m.text}</span>
                  <div style={{ fontSize: 9.5, color: T.textTert, marginTop: 2 }}>{fmt(m.at)}</div>
                </div>
              );
            }
            const mine = m.direction !== "in";
            return (
              <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
                <div style={{ background: mine ? T.gold : "#fff", color: mine ? "#fff" : T.text, border: mine ? "none" : `1px solid ${T.border}`, borderRadius: 14, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{linkifyText(m.text, mine)}</div>
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
              onPaste={(e) => { const fixed = rescuePastedLink(e); if (fixed != null) { e.preventDefault(); const el = e.target, st = el.selectionStart ?? draft.length, en = el.selectionEnd ?? draft.length; setDraft(draft.slice(0, st) + fixed + draft.slice(en)); } }}
              style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13.5, outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.4, boxSizing: "border-box" }} />
            <button onClick={doSend} disabled={!draft.trim() || busy} style={{ padding: "10px 16px", borderRadius: 12, border: "none", background: draft.trim() && !busy ? T.gold : T.border, color: "#fff", fontWeight: 800, fontSize: 13, cursor: draft.trim() && !busy ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
