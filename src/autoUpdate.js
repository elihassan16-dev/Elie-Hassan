// Keep every phone on the newest version (Elie 10/16/26: fixes reached his
// phone but not the contractors'). A Home-Screen app on an iPhone isn't
// reloaded when you switch back to it — it can sit in memory for days running
// the old code. So whenever the app comes back to the screen (and every 20 min
// while it's open) we compare the deployed build with the one running; if a
// newer one is out, the app reloads itself the next time it's safe:
// coming back from the background, nobody typing, no upload in flight.
// Drafts are kept on the device (usePersistentDraft) and unfinished videos
// resume from IndexedDB, so a reload loses nothing.
const SCRIPT_RE = /\/assets\/index-[\w-]+\.js/;
const running = () => {
  for (const s of document.scripts) { const m = SCRIPT_RE.exec(s.src || ""); if (m) return m[0]; }
  return null;
};
let newer = false, checking = false, hiddenAt = 0;

async function check() {
  if (checking || newer) return newer;
  const cur = running();
  if (!cur) return false; // dev server — nothing to compare
  checking = true;
  try {
    const html = await fetch(`/?v=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
    const m = SCRIPT_RE.exec(html);
    if (m && m[0] !== cur) newer = true;
  } catch { /* offline — try again later */ }
  checking = false;
  return newer;
}

const busy = () => {
  const el = document.activeElement;
  if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(button|checkbox|radio|file)$/i.test(el.type)))) return true;
  try { if (window.__gsUploading && window.__gsUploading()) return true; } catch { /* ignore */ }
  try { if (window.__gsRecording) return true; } catch { /* ignore */ }
  return false;
};

// Settings → "↻ Update now": throw away every saved copy of the app (service
// worker + caches) and load the newest version straight from the server.
export async function forceUpdate() {
  try { const regs = await navigator.serviceWorker?.getRegistrations?.(); await Promise.all((regs || []).map((r) => r.update().catch(() => {}))); } catch { /* ignore */ }
  try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k.startsWith("gs-page")).map((k) => caches.delete(k))); } catch { /* ignore */ }
  location.replace(`${location.pathname}?fresh=${Date.now()}${location.hash || ""}`);
}

export function startAutoUpdate() {
  if (typeof document === "undefined") return;
  // At launch: if the page that loaded is already behind the server (an old
  // saved copy won), reload once onto the newest build.
  setTimeout(async () => {
    let tried = false; try { tried = sessionStorage.getItem("gs_fresh_try") === "1"; } catch { /* ignore */ }
    if (tried) { try { sessionStorage.removeItem("gs_fresh_try"); } catch { /* ignore */ } return; }
    if ((await check()) && !busy()) { try { sessionStorage.setItem("gs_fresh_try", "1"); } catch { /* ignore */ } location.reload(); }
  }, 4000);
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    // Back on screen. A quick glance away (<20s) doesn't count.
    if (!hiddenAt || Date.now() - hiddenAt < 20000) return;
    if ((await check()) && !busy()) location.reload();
  });
  setInterval(() => { if (document.visibilityState === "visible") check(); }, 20 * 60 * 1000);
}
