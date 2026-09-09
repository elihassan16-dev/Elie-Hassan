import { useEffect } from "react";
import { useAuth } from "./auth/AuthProvider";
import { useData } from "./data/DataProvider";

// Sign the team app out after two hours with no activity (Elie 9/8). A tab or
// installed app left open overnight kept running: still fetching QuickBooks,
// still auto-pinning payments, still able to fight a fresh copy on another
// device over the same deal — and still showing the financials to whoever
// walked past the desk. Activity = any touch, click, key or scroll; the last
// moment is kept in localStorage so an app that was suspended or closed for
// hours signs out the moment it comes back, not two hours later. Pending edits
// are saved first, so nothing typed is lost to the sign-out itself.
const IDLE_MS = 2 * 60 * 60 * 1000;
const KEY = "gs_last_active";

export default function IdleLogout() {
  const { signOut } = useAuth();
  const { flushAll } = useData();
  useEffect(() => {
    let lastWrite = 0;
    let out = false;
    const now = () => Date.now();
    const read = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
    const touch = () => {
      const t = now();
      if (t - lastWrite < 30000) return;   // a write every 30s is plenty
      lastWrite = t;
      try { localStorage.setItem(KEY, String(t)); } catch { /* private mode */ }
    };
    const leave = async () => {
      if (out) return; out = true;
      try { sessionStorage.setItem("gs_idle_out", "1"); } catch { /* ignore */ }
      try { if (flushAll) await flushAll(); } catch { /* best effort */ }
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      await signOut();
    };
    const check = () => {
      const last = read();
      if (last && now() - last > IDLE_MS) leave();
    };
    // Launch: a stamp older than the limit means the app sat closed or asleep
    // that long — sign out now. No stamp (first run) starts the clock fresh.
    if (!read()) touch(); else check();
    const evs = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"];
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(check, 60000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(iv);
    };
  }, [signOut, flushAll]);
  return null;
}
