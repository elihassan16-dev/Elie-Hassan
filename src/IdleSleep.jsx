import { useEffect, useState } from "react";
import { useData } from "./data/DataProvider";

// 💤 Sleep after two hours with no activity (Elie 10/11/26 — replaced the
// 9/8 auto sign-out the team disliked). The sign-out existed for three
// reasons; sleep keeps all three without anyone re-typing a password:
//  • background work (QuickBooks pulls, auto-pinning) — the whole app is
//    unmounted while asleep, so every timer and fetch inside it stops;
//  • a stale copy overwriting newer work from another device — pending
//    edits are saved before sleeping, and waking RELOADS the app, so it
//    always comes back with the latest data before anything can be saved;
//  • financials on an unattended desk — the sleeping screen covers them
//    (tap anywhere to continue). Phones have their own lock screen, so a
//    phone coming back after 2h just refreshes straight away.
// Activity = any touch, click, key or scroll; the last moment is kept in
// localStorage so an app that sat suspended for hours notices on return.
const IDLE_MS = 2 * 60 * 60 * 1000;
const KEY = "gs_last_active";
const isPhone = () => { try { return window.matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 820; } catch { return false; } };

export default function IdleSleep({ children }) {
  const { flushAll } = useData();
  const [state, setState] = useState("awake"); // awake | asleep | waking
  useEffect(() => {
    if (state !== "awake") return undefined;
    let lastWrite = 0;
    let gone = false;
    const now = () => Date.now();
    const read = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
    const touch = (force) => {
      const t = now();
      if (!force && t - lastWrite < 30000) return;   // a write every 30s is plenty
      lastWrite = t;
      try { localStorage.setItem(KEY, String(t)); } catch { /* private mode */ }
    };
    const sleep = async (returning) => {
      if (gone) return; gone = true;
      try { if (flushAll) await flushAll(); } catch { /* best effort */ }
      // A phone coming back after 2h: just refresh — its own lock screen
      // already kept the screen private.
      if (returning && isPhone()) { setState("waking"); setTimeout(() => window.location.reload(), 250); return; }
      setState("asleep");
    };
    const idle = () => { const last = read(); return last && now() - last > IDLE_MS; };
    // A fresh launch already has fresh data — restart the clock.
    touch(true);
    const onAct = () => touch(false);
    const evs = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"];
    evs.forEach((e) => window.addEventListener(e, onAct, { passive: true, capture: true }));
    const onVis = () => { if (document.visibilityState === "visible" && idle()) sleep(true); };
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => { if (idle()) sleep(false); }, 60000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, onAct, { capture: true }));
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(iv);
    };
  }, [state, flushAll]);
  if (state === "awake") return children;
  const wake = () => { setState("waking"); try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setTimeout(() => window.location.reload(), 150); };
  return (
    <div onClick={state === "asleep" ? wake : undefined} role={state === "asleep" ? "button" : undefined} tabIndex={0} onKeyDown={(e) => { if (state === "asleep" && (e.key === "Enter" || e.key === " ")) wake(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center", cursor: state === "asleep" ? "pointer" : "default",
        background: "radial-gradient(120% 120% at 50% 0%, #D4A843 0%, #B8953F 55%, #8C6F2D 100%)", color: "#FBF6EA", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif" }}>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 30, letterSpacing: "0.06em" }}>Goldstone</div>
      {state === "asleep" ? <>
        <div style={{ fontSize: 17, fontWeight: 600 }}>Paused while you were away</div>
        <div style={{ fontSize: 14, opacity: 0.85, maxWidth: 320, lineHeight: 1.5 }}>Everything you did is saved. Tap anywhere to pick up where you left off — with the latest numbers.</div>
        <div style={{ marginTop: 6, minHeight: 44, padding: "0 26px", borderRadius: 22, background: "rgba(255,255,255,0.95)", color: "#8C6F2D", fontSize: 15, fontWeight: 650, display: "flex", alignItems: "center" }}>Continue</div>
      </> : <div style={{ fontSize: 16, fontWeight: 600 }}>Welcome back — refreshing…</div>}
    </div>
  );
}
