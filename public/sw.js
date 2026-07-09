/* Goldstone Properties — service worker for Web Push notifications.
   Shows a banner when a push arrives (even with the app closed), and focuses/opens
   the app when the banner is tapped. No offline caching here — push only. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: "Goldstone Properties", body: event.data ? event.data.text() : "" }; }

  const title = data.title || "Goldstone Properties";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,     // same tag replaces an earlier banner instead of stacking
    renotify: !!data.tag,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { try { await c.navigate(url); } catch { /* ignore */ } return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

/* ── App-shell caching ─────────────────────────────────────────────────────────
   Launches were fully network-bound: every open re-downloaded index.html and the
   whole JS bundle before anything rendered. Now:
   - Hashed build assets (/assets/*) are immutable → cache-first, cached forever.
   - Navigations are network-first with a short timeout → on a slow connection the
     cached shell renders in ~2s instead of hanging; on a good one you always get
     the newest deploy. The cached shell's assets are cached with it, so offline /
     flaky launches stay consistent.
   - /api/*, non-GET, and cross-origin (Supabase, Graph, QuickBooks) are untouched. */
const ASSET_CACHE = "gs-assets-v1";
const PAGE_CACHE = "gs-page-v1";

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([ASSET_CACHE, PAGE_CACHE]);
    for (const k of await caches.keys()) if (!k.startsWith("gs-") || !keep.has(k)) await caches.delete(k);
  })());
});

const fetchWithTimeout = (req, ms) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), ms);
  fetch(req).then((res) => { clearTimeout(t); resolve(res); }, () => { clearTimeout(t); resolve(null); });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase / Graph / etc.
  if (url.pathname.startsWith("/api/")) return;      // live data — never cached

  // The page itself: try the network briefly (fresh deploys win), fall back to
  // the cached shell so slow/offline launches still render instantly.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      const fresh = await fetchWithTimeout(req, 2500);
      if (fresh && fresh.ok) { cache.put("/__shell__", fresh.clone()); return fresh; }
      const cached = await cache.match("/__shell__");
      if (cached) {
        // Keep trying in the background so the next launch has the newest build.
        event.waitUntil(fetch(req).then((r) => { if (r && r.ok) return cache.put("/__shell__", r.clone()); }).catch(() => {}));
        return cached;
      }
      const slow = await fetch(req).catch(() => null);
      return slow || new Response("You're offline and the app isn't cached yet. Connect and reload once.", { status: 503, headers: { "Content-Type": "text/plain" } });
    })());
    return;
  }

  // Hashed immutable build assets + icons: cache-first.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});
