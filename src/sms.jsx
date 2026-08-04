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
  return { connected: store.connected, from: store.from, msgs, threadFor, statusFor, unreadFor, send };
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
              : calling === "sent" ? <><b>📲 Check your phone</b><div style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}>Tap the notification and the dialer opens with {fmtPhone(phone)}.</div></>
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
          {mode === "call" && !IS_PHONE && (
            <button style={opt} onClick={async () => {
              setCalling("busy");
              try { await sendToMyPhone({ phone, mode: "call" }); setCalling("sent"); setTimeout(onClose, 3800); }
              catch (e) { setCalling("err:" + (e.message || "Couldn't reach your phone.")); }
            }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>📲</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>My cell phone</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>We ping your phone — one tap there and the dialer opens with their number</div>
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

// ─── 📲 Desktop → phone handoff ─────────────────────────────────────────────
// Pushes a notification to YOUR OWN phone; tapping it opens the app for a
// beat, which bounces straight into Messages (prefilled) or the dialer.
// Nothing sends without the final tap on the phone.
export async function sendToMyPhone({ phone, message = "", mode = "text" }) {
  const digits = e164(phone);
  const target = mode === "call" ? `tel:${digits}`
    : mode === "whatsapp" ? `https://wa.me/${digits.replace(/\D/g, "")}${message ? `?text=${encodeURIComponent(message)}` : ""}`
    : `sms:${digits}${message ? `&body=${encodeURIComponent(message)}` : ""}`;
  const appName = mode === "call" ? "the dialer" : mode === "whatsapp" ? "WhatsApp" : "Messages";
  await qbAuthFetch("/api/notify/send", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toSelf: true, pushOnly: true,
      title: `📲 ${mode === "call" ? "Call" : mode === "whatsapp" ? "WhatsApp" : "Text"} ${fmtPhone(phone)} from your cell`,
      body: message ? `“${message.slice(0, 120)}” — tap to open ${appName} ready to send.` : `Tap to open ${appName}.`,
      url: `/?handoff=${encodeURIComponent(target)}`,
      tag: `handoff-${Date.now()}`,
    }),
  });
  // Park it in the account too: even if the notification gets cleared, the
  // phone shows the handoff bar on next open until it's tapped or dismissed.
  try { await supabase.auth.updateUser({ data: { pendingHandoff: { target, at: new Date().toISOString() } } }); } catch { /* best-effort */ }
}
// Catches an arriving handoff — a ?handoff=sms:…/tel:… in the URL, or the
// service worker's notification-tap message when the PWA was already open —
// and shows a bar with a REAL button. iOS only honors a jump into Messages /
// the dialer from a genuine in-app tap, so the auto-attempt is best-effort
// and the button is the guarantee.
const isHandoffTarget = (h) => /^(sms:|tel:)/i.test(h || "") || /^https:\/\/wa\.me\//i.test(h || "");
export function HandoffCatcher() {
  const [pend, setPend] = useState(null); // "sms:…" | "tel:…" | "https://wa.me/…"
  const clear = () => {
    setPend(null);
    supabase.auth.updateUser({ data: { pendingHandoff: null } }).catch(() => {});
  };
  useEffect(() => {
    const accept = (h, auto = true) => {
      if (!isHandoffTarget(h)) return;
      setPend(h);
      // Auto-bounce for sms:/tel: where the platform allows it. wa.me is a
      // regular https link — auto-navigating would replace the app, so that
      // one always waits for the button.
      if (auto && /^(sms:|tel:)/i.test(h)) setTimeout(() => { try { window.location.href = h; } catch { /* blocked — the button remains */ } }, 350);
    };
    try {
      const q = new URLSearchParams(window.location.search);
      const h = q.get("handoff");
      if (h) {
        q.delete("handoff");
        const rest = q.toString();
        window.history.replaceState({}, "", window.location.pathname + (rest ? "?" + rest : ""));
        accept(h);
      }
    } catch { /* no query support — ignore */ }
    // Parked handoff: survives a cleared notification. Shown on the phone
    // whenever the app opens or comes back to the front, until dealt with.
    let live = true;
    const checkParked = async () => {
      try {
        if (!IS_PHONE) return;
        const { data } = await supabase.auth.getUser();
        const ph = data?.user?.user_metadata?.pendingHandoff;
        if (!live || !ph || !isHandoffTarget(ph.target)) return;
        if (Date.now() - new Date(ph.at || 0).getTime() > 24 * 3600000) return; // stale — ignore
        setPend((p) => p || ph.target);
      } catch { /* offline — try again next focus */ }
    };
    checkParked();
    const onVis = () => { if (document.visibilityState === "visible") checkParked(); };
    document.addEventListener("visibilitychange", onVis);
    let offMsg = () => {};
    if ("serviceWorker" in navigator) {
      const onMsg = (e) => {
        const d = e.data || {};
        if (d.type !== "notification-url" || !d.url) return;
        try { accept(new URL(d.url, window.location.origin).searchParams.get("handoff")); } catch { /* malformed */ }
      };
      navigator.serviceWorker.addEventListener("message", onMsg);
      offMsg = () => navigator.serviceWorker.removeEventListener("message", onMsg);
    }
    return () => { live = false; document.removeEventListener("visibilitychange", onVis); offMsg(); };
  }, []);
  if (!pend) return null;
  const isCall = /^tel:/i.test(pend);
  const isWa = /^https:\/\/wa\.me\//i.test(pend);
  const digits = isWa ? pend.split("wa.me/")[1].split("?")[0] : pend.replace(/^(sms:|tel:)/i, "").split(/[?&]/)[0];
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999, padding: "12px 14px calc(14px + env(safe-area-inset-bottom))", background: "rgba(27,31,39,0.95)", backdropFilter: "blur(6px)", display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ flex: 1, minWidth: 0, color: "#fff", fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📲 {isCall ? "Ready to call" : isWa ? "WhatsApp ready for" : "Text ready for"} {fmtPhone(digits)}</span>
      <a href={pend} target={isWa ? "_blank" : undefined} rel={isWa ? "noopener noreferrer" : undefined} onClick={() => setTimeout(clear, 900)} style={{ padding: "10px 16px", borderRadius: 12, background: isWa ? "#25D366" : T.gold, color: "#fff", fontWeight: 800, fontSize: 13, textDecoration: "none", flexShrink: 0 }}>{isCall ? "Open dialer" : isWa ? "Open WhatsApp" : "Open Messages"}</a>
      <button onClick={clear} style={{ background: "none", border: "none", color: "#98A0AA", fontSize: 19, cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: "0 2px" }}>×</button>
    </div>
  );
}

// ─── 📞 Missed calls + 💬 New texts — Tasks-page cards ──────────────────────
// Two rail cards: missed calls awaiting a callback, and unread texts with a
// one-tap reply. A missed call clears itself once ANY outbound text or call
// to that number happens after it (the CDR/webhook writes make that visible),
// or via the × (per-user, saved in account prefs). Empty cards render nothing.
export function CallTextCards({ prefs = {}, savePrefs }) {
  const { connected, msgs, threadFor, unreadFor } = useSmsTexting();
  const jv = useJivetelCall();
  const [open, setOpen] = useState(null);      // {phone,name} → thread popup
  const [ringing, setRinging] = useState("");  // phone being called back
  const now = Date.now();
  const rel = (iso) => {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    const m = Math.floor(Math.max(0, now - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return "yesterday";
    if (d < 7) return `${d}d ago`;
    try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; }
  };
  const dism = prefs.callDismiss || {};
  // Latest outbound touch per number — anything after a missed call clears it.
  const lastOut = {};
  msgs.forEach((m) => {
    if (m.direction === "out" || m.direction === "call-out") {
      const p = e164(m.phone);
      if (p && (!lastOut[p] || String(m.at) > lastOut[p])) lastOut[p] = String(m.at);
    }
  });
  const byPhone = {};
  msgs.forEach((m) => {
    if (m.kind !== "call" || !m.missed || m.direction !== "call-in") return;
    const p = e164(m.phone);
    if (p && (!byPhone[p] || String(m.at) > String(byPhone[p].at))) byPhone[p] = m;
  });
  const missed = Object.values(byPhone).filter((m) => {
    if (dism[m.id]) return false;
    const p = e164(m.phone);
    if (lastOut[p] && lastOut[p] > String(m.at)) return false;
    const t = new Date(m.at).getTime();
    return !isNaN(t) && now - t < 7 * 86400000;
  }).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
  const texts = [...new Set(msgs.filter((m) => m.kind !== "call").map((m) => e164(m.phone)).filter(Boolean))]
    .map((p) => {
      if (!unreadFor(p)) return null;
      const t = threadFor(p).filter((m) => m.kind !== "call");
      const lastIn = [...t].reverse().find((m) => m.direction === "in");
      return lastIn ? { phone: p, name: lastIn.by || "", text: lastIn.text || "", at: lastIn.at } : null;
    })
    .filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
  if (!connected || (missed.length === 0 && texts.length === 0)) return open ? <SmsThreadPopup phone={open.phone} name={open.name} onClose={() => setOpen(null)} /> : null;
  const dismiss = (id) => {
    if (!savePrefs) return;
    const next = { ...dism, [id]: new Date().toISOString() };
    Object.keys(next).forEach((k) => { const t = new Date(next[k]).getTime(); if (!isNaN(t) && now - t > 14 * 86400000) delete next[k]; });
    Promise.resolve(savePrefs({ callDismiss: next })).catch(() => {});
  };
  const callBack = async (phone) => {
    setRinging(phone);
    try {
      await qbAuthFetch("/api/jivetel/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: phone }) });
      setTimeout(() => setRinging(""), 4000);
    } catch (e) { setRinging(""); window.alert(e.message || "Couldn't place the call."); }
  };
  const card = { background: "#fff", borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden" };
  const hd = (icon, label, n, bg, fg, bd) => (
    <div style={{ padding: "11px 14px 9px", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 800, color: T.text, display: "flex", alignItems: "center", gap: 6 }}>
      {icon} {label}
      <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, background: bg, color: fg, border: `1px solid ${bd}`, borderRadius: 10, padding: "2px 8px" }}>{n}</span>
    </div>
  );
  const initials = (n) => String(n || "").trim().split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase() || "?";
  const ico = { width: 27, height: 27, borderRadius: "50%", border: `1px solid ${T.border}`, background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer", flexShrink: 0, padding: 0, fontFamily: "inherit" };
  const row = { display: "flex", gap: 8, alignItems: "center", padding: "9px 12px", borderBottom: `1px solid ${T.border}55` };
  return (<>
    {missed.length > 0 && (
      <div style={card}>
        {hd("📞", "Missed calls", missed.length, "#FFF1EA", "#C2410C", "#F6C9B2")}
        {missed.map((m) => (
          <div key={m.id} style={row}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#FFE4D6", color: "#C2410C", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(m.by)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block", fontSize: 12.5, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.by || fmtPhone(m.phone)}</b>
              <span style={{ display: "block", fontSize: 10, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ringing === m.phone ? "☎️ Your phone is ringing — pick up to connect" : `${m.by ? fmtPhone(m.phone) + " · " : ""}${rel(m.at)}${m.ext ? ` · rang ext ${m.ext}` : ""}`}
              </span>
            </span>
            {jv.enabled && <button onClick={() => callBack(m.phone)} title="Call back on your Jivetel line" style={{ ...ico, background: T.gold, border: "none", color: "#fff" }}>📞</button>}
            <button onClick={() => setOpen({ phone: m.phone, name: m.by || fmtPhone(m.phone) })} title="Open the conversation" style={ico}>💬</button>
            <button onClick={() => dismiss(m.id)} title="Dismiss" style={{ ...ico, border: "none", fontSize: 15, color: T.textTert }}>×</button>
          </div>
        ))}
        <div style={{ padding: "7px 14px", fontSize: 9.5, color: T.textTert, textAlign: "center" }}>clears itself once you call or text them back</div>
      </div>
    )}
    {texts.length > 0 && (
      <div style={card}>
        {hd("💬", "New texts", texts.length, "#FDE9C8", "#B45309", "#EAD9A9")}
        {texts.map((t) => (
          <div key={t.phone} onClick={() => setOpen({ phone: t.phone, name: t.name || fmtPhone(t.phone) })} style={{ ...row, cursor: "pointer" }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#EEE7D4", color: "#8a6d1f", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(t.name)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block", fontSize: 12.5, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name || fmtPhone(t.phone)}</b>
              <span style={{ display: "block", fontSize: 10, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>“{String(t.text).slice(0, 60)}” · {rel(t.at)}</span>
            </span>
            <button onClick={(e) => { e.stopPropagation(); setOpen({ phone: t.phone, name: t.name || fmtPhone(t.phone) }); }} title="Reply" style={{ ...ico, background: "#0F9D58", border: "none", color: "#fff" }}>↩</button>
          </div>
        ))}
      </div>
    )}
    {open && <SmsThreadPopup phone={open.phone} name={open.name} onClose={() => setOpen(null)} />}
  </>);
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
  const [note, setNote] = useState(""); // 📲 handoff confirmation
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
          {note && <div style={{ fontSize: 11.5, color: "#15803D", fontWeight: 700, marginBottom: 6 }}>{note} <button onClick={async () => { try { await sendToMyPhone({ phone, message: draft.trim() }); setNote("📲 Re-sent — check your phone."); } catch { /* keep old note */ } }} style={{ marginLeft: 6, padding: "3px 10px", borderRadius: 9, border: "1px solid #2563EB", background: "#EFF6FF", color: "#2563EB", fontWeight: 800, fontSize: 10.5, cursor: "pointer", fontFamily: "inherit" }}>↻ Resend</button></div>}
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
            {!IS_PHONE && <button onClick={async () => {
              try { await sendToMyPhone({ phone, message: draft.trim() }); setNote("📲 Sent to your phone — tap the notification (or just open the app there: the bar waits for you)."); }
              catch (ex) { setErr(ex.message || "Couldn't reach your phone."); }
            }} title="Send this text from your cell instead — your phone gets a notification that opens Messages prefilled" style={{ padding: "10px 12px", borderRadius: 12, border: "1.5px solid #2563EB", background: "#EFF6FF", color: "#2563EB", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>📲</button>}
            <button onClick={doSend} disabled={!draft.trim() || busy} style={{ padding: "10px 16px", borderRadius: 12, border: "none", background: draft.trim() && !busy ? T.gold : T.border, color: "#fff", fontWeight: 800, fontSize: 13, cursor: draft.trim() && !busy ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
