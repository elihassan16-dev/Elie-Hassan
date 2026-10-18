// 🔐 Face ID (Elie 10/18/26) — iPhone/Android app only, each person turns it on
// for their own phone in Settings. Two things:
//   • Lock: opening the app, or coming back after LOCK_MS away, covers the app
//     with a gold screen until Face ID passes (passcode as a fallback). It's
//     only a cover — the app keeps running underneath, so uploads, chats and
//     notifications carry on exactly as before.
//   • Sign in with Face ID: the email + password are kept in the phone's
//     Keychain/Keystore (readable only after Face ID), so after signing out
//     or a reinstall the sign-in screen has a "Sign in with Face ID" button.
// Old app builds without the plugin simply never show any of this.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isNative, nativePlatform } from "./native";
import { supabase } from "./supabaseClient";

const SERVER = "gpflips.com";
const ON_KEY = "gs_faceid_on";       // "1" = turned on on this phone
const EMAIL_KEY = "gs_faceid_email"; // whose sign-in is stored (not secret)
const SEEN_KEY = "gs_lock_seen";     // sessionStorage: last moment the app was open + unlocked
const LOCK_MS = 2 * 60000;

const GOLD = "#B8953F";
const GOLD_DEEP = "#9B7C33";

// The plugin object answers ANY property, including "then" — never await it
// directly or resolve a promise with it (see native.js). Always { B }.
const plugin = () => {
  try { const B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric; return B ? { B } : null; }
  catch { return null; }
};
const pluginOn = () => { try { return isNative() && !!window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable("NativeBiometric"); } catch { return false; } };

const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } };
const ssGet = (k) => { try { return Number(sessionStorage.getItem(k) || 0); } catch { return 0; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch { /* ignore */ } };

export const faceIdOn = () => pluginOn() && lsGet(ON_KEY) === "1";
export const faceIdEmail = () => lsGet(EMAIL_KEY);

// → { ok, label } — label is what the phone calls it ("Face ID", "Touch ID", "Fingerprint").
let availP = null;
export function faceIdAvailable() {
  if (!pluginOn()) return Promise.resolve({ ok: false, label: "Face ID" });
  return (availP ||= (async () => {
    const p = plugin(); if (!p) return { ok: false, label: "Face ID" };
    try {
      const r = await p.B.isAvailable({ useFallback: false });
      const t = r && r.biometryType;
      const label = nativePlatform() === "ios" ? (t === 1 ? "Touch ID" : "Face ID") : "Fingerprint";
      return { ok: !!(r && r.isAvailable), label };
    } catch { return { ok: false, label: "Face ID" }; }
  })());
}
export function useFaceIdAvailable() {
  const [a, setA] = useState({ ok: false, label: "Face ID" });
  useEffect(() => { let live = true; faceIdAvailable().then((r) => { if (live) setA(r); }); return () => { live = false; }; }, []);
  return a;
}

async function verify(reason) {
  const p = plugin(); if (!p) throw new Error("Face ID isn't available in this version of the app.");
  await p.B.verifyIdentity({ reason, title: "Goldstone Properties", useFallback: true, maxAttempts: 3 });
}
// Plugin codes: 11 app cancel, 15 system cancel, 16 user cancel.
const cancelled = (e) => ["11", "15", "16"].includes(String(e && e.code)) || /cancel/i.test(String((e && e.message) || ""));

// Turn on: check the password (also proves who's holding the phone), keep it
// behind Face ID, then one Face ID check so they see it work.
export async function enableFaceId(email, password) {
  const p = plugin(); if (!p) throw new Error("Face ID needs the newest version of the app.");
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error("That password isn't right.");
  try { await p.B.deleteCredentials({ server: SERVER }); } catch { /* none yet */ }
  await p.B.setCredentials({ username: email.trim().toLowerCase(), password, server: SERVER, accessControl: 2 /* BIOMETRY_ANY */, title: "Turn on Face ID" });
  await verify("Turn on Face ID for Goldstone");
  lsSet(ON_KEY, "1"); lsSet(EMAIL_KEY, email.trim().toLowerCase());
  ssSet(SEEN_KEY, Date.now());
}
export async function disableFaceId() {
  const p = plugin();
  if (p) { try { await p.B.deleteCredentials({ server: SERVER }); } catch { /* nothing stored */ } }
  lsSet(ON_KEY, ""); lsSet(EMAIL_KEY, "");
}
// After a normal password sign-in on a phone with Face ID on, keep the stored
// password current (e.g. it was changed) — only for the same person. When it's
// off, hold the password in memory for a few minutes so the one-time "Use Face
// ID?" offer can turn it on without asking for it again.
let pending = null; // { email, password, at }
export async function faceIdRememberPassword(email, password) {
  if (!faceIdOn()) { pending = { email: (email || "").trim(), password, at: Date.now() }; return; }
  const e = (email || "").trim().toLowerCase();
  if (!e || e !== faceIdEmail()) return;
  const p = plugin(); if (!p) return;
  try { await p.B.setCredentials({ username: e, password, server: SERVER, accessControl: 2, title: "Update Face ID sign-in" }); } catch { /* keep the old one */ }
}
// Sign-in screen button.
export async function faceIdSignIn() {
  const p = plugin(); if (!p) throw new Error("Face ID isn't available.");
  let c;
  try { c = await p.B.getSecureCredentials({ server: SERVER, reason: "Sign in to Goldstone" }); }
  catch (e) { if (cancelled(e)) return false; throw new Error("Face ID sign-in isn't set up on this phone anymore — sign in with your password."); }
  const { error } = await supabase.auth.signInWithPassword({ email: c.username, password: c.password });
  if (error) {
    await disableFaceId();
    throw new Error("Your password changed — sign in with it once, then turn Face ID back on in Settings.");
  }
  ssSet(SEEN_KEY, Date.now());
  return true;
}

// ── The lock ─────────────────────────────────────────────────────────────────
// Wraps the signed-in app. Children stay mounted the whole time.
export function FaceIdLock({ children, onSignOut, email }) {
  const enabled = faceIdOn();
  const fresh = () => Date.now() - ssGet(SEEN_KEY) < LOCK_MS;
  const [locked, setLocked] = useState(() => enabled && !fresh());
  const [covered, setCovered] = useState(false);
  const [err, setErr] = useState("");
  const [label, setLabel] = useState("Face ID");
  const verifying = useRef(false);
  const hiddenAt = useRef(0);

  const unlock = async () => {
    if (verifying.current) return;
    verifying.current = true; setErr("");
    try { await verify("Unlock Goldstone"); ssSet(SEEN_KEY, Date.now()); setLocked(false); setCovered(false); }
    catch (e) { if (!cancelled(e)) setErr("Didn't match — try again."); }
    verifying.current = false;
  };

  useEffect(() => { if (enabled) faceIdAvailable().then((a) => setLabel(a.label)); }, [enabled]);
  // Ask right away whenever the lock comes up.
  useEffect(() => { if (locked) { const t = setTimeout(unlock, 350); return () => clearTimeout(t); } }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (verifying.current) return; // the Face ID sheet itself can blur the page
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        if (!locked) ssSet(SEEN_KEY, Date.now());
        setCovered(true); // hides the app in the app switcher
      } else {
        const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
        if (away >= LOCK_MS) setLocked(true);
        else setCovered(false);
      }
    };
    // While open + unlocked, keep the "last seen" fresh so a reload (new
    // version) doesn't ask again.
    const iv = setInterval(() => { if (!locked && document.visibilityState === "visible") ssSet(SEEN_KEY, Date.now()); }, 20000);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [enabled, locked]);

  const show = enabled && (locked || covered);
  return (
    <>
      {children}
      {!enabled && email && <FaceIdOffer email={email} />}
      {show && createPortal(
        <div role="dialog" aria-label="Locked" style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: `linear-gradient(180deg, ${GOLD} 0%, ${GOLD_DEEP} 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "24px 16px", color: "#fff", fontFamily: "inherit", textAlign: "center" }}>
          <div style={{ width: 84, height: 84, borderRadius: 22, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}>
            <img src="/logo.png" alt="" style={{ width: 60, height: 60, objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.2 }}>Goldstone Properties</div>
          {locked && <>
            <button onClick={unlock} style={{ minHeight: 50, padding: "0 26px", borderRadius: 25, border: "none", background: "#fff", color: GOLD_DEEP, fontWeight: 700, fontSize: 16, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 6px 18px rgba(0,0,0,0.15)" }}>
              <FaceIcon /> Unlock with {label}
            </button>
            {err && <div style={{ fontSize: 14, fontWeight: 600 }}>{err}</div>}
            {onSignOut && <button onClick={() => { ssSet(SEEN_KEY, 0); onSignOut(); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", minHeight: 44, padding: "0 12px" }}>Sign out</button>}
          </>}
        </div>,
        document.body
      )}
    </>
  );
}
export function FaceIcon({ size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16a3.5 3.5 0 0 0 5 0" />
    </svg>
  );
}

// ── One-time offer ───────────────────────────────────────────────────────────
// Shown once per phone (team + contractors) a few seconds after the app opens,
// only inside the app on a phone with Face ID / fingerprint set up.
const OFFER_KEY = "gs_faceid_offered";
function FaceIdOffer({ email }) {
  const avail = useFaceIdAvailable();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fromLogin = pending && Date.now() - pending.at < 5 * 60000 && pending.email.toLowerCase() === String(email).toLowerCase() ? pending : null;
  useEffect(() => {
    if (!avail.ok || lsGet(OFFER_KEY) === "1") return;
    const t = setTimeout(() => setOpen(true), 4000);
    return () => clearTimeout(t);
  }, [avail.ok]);
  if (!open) return null;
  const done = () => { lsSet(OFFER_KEY, "1"); pending = null; setOpen(false); };
  const turnOn = async () => {
    const password = fromLogin ? fromLogin.password : pw;
    if (!password || busy) return;
    setBusy(true); setErr("");
    try { await enableFaceId(email, password); done(); }
    catch (e) { if (!cancelled(e)) setErr((e && e.message) || "Couldn't turn it on."); }
    setBusy(false);
  };
  return createPortal(
    <div onClick={done} style={{ position: "fixed", inset: 0, zIndex: 2147482000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px,100%)", background: "#fff", borderRadius: "22px 22px 0 0", padding: "22px 20px calc(18px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", fontFamily: "inherit" }}>
        <div style={{ width: 60, height: 60, borderRadius: 18, background: "#F8F1E0", color: GOLD_DEEP, display: "flex", alignItems: "center", justifyContent: "center" }}><FaceIcon size={32} /></div>
        <div style={{ fontSize: 19, fontWeight: 700, color: "#1C1C1E" }}>Use {avail.label}?</div>
        <div style={{ fontSize: 14, color: "#6E6E73", lineHeight: 1.45, maxWidth: 360 }}>Lock the app when you're away and sign in without typing your password. Notifications and uploads keep working.</div>
        {!fromLogin && <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") turnOn(); }} placeholder="Your password"
          style={{ width: "100%", minHeight: 46, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", fontSize: 16, fontFamily: "inherit", outline: "none", background: "#F9F9FB", boxSizing: "border-box", marginTop: 4 }} />}
        {err && <div style={{ fontSize: 13, color: "#FF3B30" }}>{err}</div>}
        <button onClick={turnOn} disabled={busy || (!fromLogin && !pw)} style={{ width: "100%", minHeight: 50, borderRadius: 14, border: "none", background: GOLD, color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "inherit", cursor: "pointer", marginTop: 4, opacity: busy || (!fromLogin && !pw) ? 0.6 : 1 }}>{busy ? "Turning on…" : `Turn on ${avail.label}`}</button>
        <button onClick={done} style={{ width: "100%", minHeight: 44, border: "none", background: "none", color: "#6E6E73", fontWeight: 600, fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>Not now</button>
      </div>
    </div>,
    document.body
  );
}

// ── Settings row (team Settings + contractor portal) ─────────────────────────
// Shows only inside the app on a phone that has Face ID / fingerprint set up.
export function FaceIdSetting({ email, T, wrap }) {
  const avail = useFaceIdAvailable();
  const [on, setOn] = useState(() => faceIdOn());
  const [ask, setAsk] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!avail.ok) return null;
  const C = T || { text: "#1C1C1E", textSub: "#6E6E73", border: "rgba(0,0,0,0.08)", red: "#FF3B30", green: "#34C759" };
  const toggle = async () => {
    setErr("");
    if (on) { await disableFaceId(); setOn(false); return; }
    setAsk(true);
  };
  const confirm = async () => {
    if (!pw || busy) return;
    setBusy(true); setErr("");
    try { await enableFaceId(email, pw); lsSet(OFFER_KEY, "1"); setOn(true); setAsk(false); setPw(""); }
    catch (e) { if (!cancelled(e)) setErr((e && e.message) || "Couldn't turn it on."); }
    setBusy(false);
  };
  const body = (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", minHeight: 52 }}>
        <span style={{ width: 28, display: "flex", justifyContent: "center", color: GOLD }}><FaceIcon size={22} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, color: C.text }}>Use {avail.label}</div>
          <div style={{ fontSize: 12.5, color: C.textSub, marginTop: 1, lineHeight: 1.35 }}>Lock the app when you're away and sign in without your password</div>
        </div>
        <button onClick={toggle} role="switch" aria-checked={on} aria-label={`Use ${avail.label}`} style={{ width: 51, height: 31, borderRadius: 16, border: "none", background: on ? (C.green || "#34C759") : "rgba(118,118,128,0.16)", position: "relative", cursor: "pointer", padding: 0, flexShrink: 0, transition: "background 0.15s" }}>
          <span style={{ position: "absolute", top: 2, left: on ? 22 : 2, width: 27, height: 27, borderRadius: 14, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.2)", transition: "left 0.15s" }} />
        </button>
      </div>
      {ask && (
        <div style={{ padding: "0 16px 14px 56px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, color: C.textSub }}>Enter your password once to turn on {avail.label}.</div>
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} placeholder="Password" autoFocus
            style={{ minHeight: 44, padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 16, fontFamily: "inherit", outline: "none", background: "rgba(118,118,128,0.08)", color: C.text }} />
          {err && <div style={{ fontSize: 13, color: C.red || "#FF3B30" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirm} disabled={!pw || busy} style={{ flex: 1, minHeight: 44, borderRadius: 12, border: "none", background: GOLD, color: "#fff", fontWeight: 700, fontSize: 15, fontFamily: "inherit", cursor: "pointer", opacity: !pw || busy ? 0.6 : 1 }}>{busy ? "Turning on…" : `Turn on ${avail.label}`}</button>
            <button onClick={() => { setAsk(false); setPw(""); setErr(""); }} style={{ minHeight: 44, padding: "0 16px", borderRadius: 12, border: "none", background: "rgba(118,118,128,0.12)", color: C.text, fontWeight: 600, fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
  return wrap ? wrap(body) : body;
}

// ── Sign-in screen ───────────────────────────────────────────────────────────
let autoTried = false; // ask by itself once per app launch, never right after "Sign out"
export function FaceIdSignInButton({ onError }) {
  const avail = useFaceIdAvailable();
  const [busy, setBusy] = useState(false);
  const ready = avail.ok && faceIdOn() && !!faceIdEmail();
  const go = async () => {
    if (busy) return;
    setBusy(true); onError && onError("");
    try { await faceIdSignIn(); }
    catch (e) { onError && onError((e && e.message) || "Face ID sign-in didn't work."); }
    setBusy(false);
  };
  useEffect(() => {
    if (!ready || autoTried) return;
    autoTried = true;
    let signedOut = false; try { signedOut = sessionStorage.getItem("gs_signed_out") === "1"; } catch { /* ignore */ }
    if (!signedOut) go();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return null;
  return (
    <button type="button" onClick={go} disabled={busy}
      style={{ minHeight: 48, borderRadius: 12, border: `1.5px solid ${GOLD}`, background: "#fff", color: GOLD_DEEP, fontWeight: 700, fontSize: 16, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <FaceIcon /> {busy ? "Signing in…" : `Sign in with ${avail.label}`}
    </button>
  );
}
