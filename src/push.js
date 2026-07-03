// Client-side Web Push helpers: register the service worker, ask permission,
// subscribe, and save the subscription to Supabase so the server can push to it.
import { supabase } from "./supabaseClient";

const urlB64ToUint8 = (base64) => {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const notificationsSupported = () =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

export const notificationPermission = () =>
  typeof Notification !== "undefined" ? Notification.permission : "denied";

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js"); }
  catch { return null; }
}

// Re-subscribe silently if permission is already granted (e.g. on every app open),
// so a device that opted in stays subscribed without prompting again.
export async function refreshSubscription(userName) {
  if (!notificationsSupported() || notificationPermission() !== "granted") return false;
  try { return await subscribeAndSave(userName); } catch { return false; }
}

// Full opt-in flow: prompt for permission, subscribe, persist. Throws a friendly
// message on any blocker so the UI can show it.
export async function enablePush(userName) {
  if (!notificationsSupported())
    throw new Error("This device or browser doesn't support notifications. On iPhone, add the app to your Home Screen first.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted")
    throw new Error("Notifications are turned off. Allow them for this app in your browser/phone settings, then try again.");
  const ok = await subscribeAndSave(userName);
  if (!ok) throw new Error("Notifications aren't configured on the server yet. (Missing VAPID key.)");
  return true;
}

async function subscribeAndSave(userName) {
  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const cfg = await fetch("/api/notify/config").then((r) => r.json()).catch(() => null);
  if (!cfg || !cfg.vapidPublicKey) return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(cfg.vapidPublicKey),
    });
  }
  const j = sub.toJSON();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: user.id, user_name: userName || "" },
    { onConflict: "endpoint" }
  );
  return !error;
}
