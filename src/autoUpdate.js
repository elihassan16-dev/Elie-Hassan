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

export function startAutoUpdate() {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    // Back on screen. A quick glance away (<20s) doesn't count.
    if (!hiddenAt || Date.now() - hiddenAt < 20000) return;
    if ((await check()) && !busy()) location.reload();
  });
  setInterval(() => { if (document.visibilityState === "visible") check(); }, 20 * 60 * 1000);
}
