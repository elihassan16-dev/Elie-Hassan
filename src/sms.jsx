// Business texting (Quo) — the client side. One shared store for the whole
// app: texting connection status, every SMS conversation (loaded once, kept
// live via realtime), sending, and the little thread-status badges.
// When texting isn't connected, every entry point falls back to the phone's
// own sms: links exactly as before.
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { qbAuthFetch } from "./net";
import { T } from "./theme";

export const e164 = (n) => {
  const d = String(n || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? "+" + d : "";
};

let store = { connected: null, from: "", msgs: null };
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
  fetch("/api/texting/status", { cache: "no-store" }).then((r) => r.json()).then((s) => {
    store = { ...store, connected: !!s.connected, from: s.from || "" };
    emit();
    if (s.connected) {
      loadMsgs();
      const ch = supabase.channel("sms-shared");
      ch.on("postgres_changes", { event: "*", schema: "public", table: "sms_messages" }, scheduleLoad);
      ch.subscribe();
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleLoad(); });
    }
  }).catch(() => { store = { ...store, connected: false }; emit(); });
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
  const send = async (to, text) => {
    await qbAuthFetch("/api/texting/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, message: text }) });
    setTimeout(loadMsgs, 500);
  };
  return { connected: store.connected, from: store.from, msgs, threadFor, statusFor, send };
}

// Tiny thread-status badge for lists: ⏳ we texted, no reply yet · 💬 they replied.
export function SmsBadge({ phone }) {
  const { connected, statusFor } = useSmsTexting();
  if (!connected) return null;
  const st = statusFor(phone);
  if (!st) return null;
  return st === "awaiting"
    ? <span title="Text sent — waiting on their reply" style={{ fontSize: 10.5, fontWeight: 800, color: "#B45309", background: "#FDE9C8", borderRadius: 12, padding: "2px 7px", whiteSpace: "nowrap" }}>⏳ no reply</span>
    : <span title="They replied — open the conversation" style={{ fontSize: 10.5, fontWeight: 800, color: "#15803D", background: "#EDFBF1", borderRadius: 12, padding: "2px 7px", whiteSpace: "nowrap" }}>💬 replied</span>;
}

const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : String(p || "");
};

// The Texts inbox: every SMS conversation on the business line, newest first.
// Lives in the Messages tab so a text from ANY number — a saved agent or a
// total stranger — always has a home. Tapping a row opens the full thread.
export function SmsInboxPanel({ nameFor, onBack, isMobile }) {
  const { from, msgs, statusFor } = useSmsTexting();
  const [pop, setPop] = useState(null); // phone of the open thread
  const byPhone = new Map();
  (msgs || []).forEach((m) => { const p = e164(m.phone); if (!p) return; if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(m); });
  const threads = [...byPhone.entries()]
    .map(([phone, list]) => ({ phone, last: list[list.length - 1] }))
    .sort((a, b) => new Date(b.last.at || 0) - new Date(a.last.at || 0));
  const fmt = (iso) => { try { const d = new Date(iso), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T.bg }}>
      <div style={{ padding: "13px 16px", borderBottom: `1px solid ${T.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {isMobile && <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 22, color: T.gold, cursor: "pointer", padding: "0 6px 0 0", lineHeight: 1 }}>‹</button>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>📱 Texts</div>
          <div style={{ fontSize: 11, color: T.textSub }}>Business line {fmtPhone(from)} — every text, sent or received, any number</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {threads.length === 0 && <div style={{ padding: "40px 24px", textAlign: "center", color: T.textTert, fontSize: 13, lineHeight: 1.6 }}>No text conversations yet. Texts you send from Showings — and anything anyone texts to the business line — will show up here.</div>}
        {threads.map((t) => {
          const name = (nameFor && nameFor(t.phone)) || "";
          const mine = t.last.direction !== "in";
          return (
            <div key={t.phone} onClick={() => setPop(t.phone)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${T.border}`, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{name || fmtPhone(t.phone)}</span>
                <span style={{ fontSize: 10.5, color: T.textTert, flexShrink: 0 }}>{fmt(t.last.at)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name && <span style={{ color: T.textTert }}>{fmtPhone(t.phone)} · </span>}{mine ? `${(t.last.by || "You").split(" ")[0]}: ` : ""}{t.last.text}
                </div>
                {statusFor(t.phone) && <SmsBadge phone={t.phone} />}
              </div>
            </div>
          );
        })}
      </div>
      {pop && <SmsThreadPopup phone={pop} name={(nameFor && nameFor(pop)) || fmtPhone(pop)} onClose={() => setPop(null)} />}
    </div>
  );
}

// The conversation popup: full back-and-forth with one number, template chips,
// and a composer that sends from the company line.
export function SmsThreadPopup({ phone, name, templates = [], initialKind = null, onSent, onClose }) {
  const { from, threadFor, send } = useSmsTexting();
  const init = templates.find((t) => t.kind === initialKind);
  const [draft, setDraft] = useState(init ? init.text : "");
  const [kind, setKind] = useState(init ? init.kind : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const thread = threadFor(phone);
  const scrollRef = useRef(null);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.length]);
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
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {name || phone}</div>
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
              {templates.map((t) => (
                <button key={t.kind} onClick={() => { setDraft(t.text); setKind(t.kind); }} style={{ whiteSpace: "nowrap", flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 16, border: `1px solid ${kind === t.kind ? T.gold : T.border}`, background: kind === t.kind ? T.goldLight : "#fff", color: kind === t.kind ? "#8a6d1f" : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>{t.label}</button>
              ))}
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
