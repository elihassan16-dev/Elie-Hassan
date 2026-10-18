// 🔴 The red number on the Goldstone app icon (Elie 10/18/26) — unread team /
// office / contractor messages, unread texts, missed calls and new tasks.
// While the app is open it shows the real number; the server keeps a copy
// (/api/notify/badge → lib/badge.js) so pushes that arrive while it's closed
// count up from there. iPhone/Android app = @capawesome/capacitor-badge;
// Home-Screen web app = navigator.setAppBadge.
import { useEffect } from "react";
import { isNative } from "./native";
import { qbAuthFetch } from "./net";

let last = -1, sentN = -1, sendT = null;
// The plugin object answers any property incl. "then" — never await it directly.
const plugin = () => { try { const B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Badge; return B && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable("Badge") ? { B } : null; } catch { return null; } };

export function setAppBadge(n) {
  const v = Math.max(0, Math.min(99, Math.round(Number(n) || 0)));
  if (v !== last) {
    last = v;
    if (isNative()) {
      const p = plugin();
      if (p) { try { (v ? p.B.set({ count: v }) : p.B.clear()).catch(() => {}); } catch { /* old build */ } }
    } else if (typeof navigator !== "undefined" && navigator.setAppBadge) {
      try { (v ? navigator.setAppBadge(v) : navigator.clearAppBadge()).catch(() => {}); } catch { /* not supported */ }
    }
  }
  // Tell the server (debounced) so the next push counts up from the real number.
  if (v !== sentN) {
    clearTimeout(sendT);
    sendT = setTimeout(() => {
      qbAuthFetch("/api/notify/badge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: v }) })
        .then(() => { sentN = v; }).catch(() => {});
    }, 2500);
  }
}

// Keep the icon in sync while the app is on screen (and right when it comes back).
export function useAppBadge(n, ready = true) {
  useEffect(() => { if (ready) setAppBadge(n); }, [n, ready]);
  useEffect(() => {
    if (!ready) return;
    const onVis = () => { if (document.visibilityState === "visible") { last = -1; sentN = -1; setAppBadge(n); } };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [n, ready]);
}
