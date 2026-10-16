// 📱 The iPhone / Android app (Capacitor, Elie 10/16/26). The app is a native
// shell that opens gpflips.com, so this SAME web code runs inside it — this
// file is the bridge to what only a real app can do:
//   • Push notifications through Apple (APNs) / Google (FCM). Web push doesn't
//     exist inside an app, so the device token is saved in push_subscriptions
//     as endpoint "apns:<token>" / "fcm:<token>" and lib/nativePush.js sends.
//   • Tapping a notification opens the exact place it points to.
//   • Save / Share hand real files to the phone's share sheet.
// In a normal browser every function here is a no-op (isNative() is false) and
// the plugin code is never even downloaded.
import { supabase } from "./supabaseClient";

export const isNative = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  catch { return false; }
};
export const nativePlatform = () => (isNative() ? window.Capacitor.getPlatform() : "web");

let perm = "default"; // granted | denied | default (mirrors Notification.permission)
let pushP = null;
const push = () => (pushP ||= import("@capacitor/push-notifications").then((m) => m.PushNotifications));
let tokenWaiters = [];
let lastToken = "";
let wantName = "";

// Never let a slow/unanswered native call hold up the app (Android showed a
// black screen while boot waited on one — Elie 10/16/26).
const within = (p, ms = 2500) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
// Android push needs the Firebase config baked into the build — without it the
// plugin's register() crashes the app. CI adds "GoldstoneFCM" to the app's user
// agent only when google-services.json was included.
const pushReady = () => nativePlatform() !== "android" || /GoldstoneFCM/.test(navigator.userAgent || "");
const mapPerm = (r) => (r === "granted" ? "granted" : r === "denied" ? "denied" : "default");

async function saveToken(token) {
  if (!token) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const kind = nativePlatform() === "ios" ? "apns" : "fcm";
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint: `${kind}:${token}`, p256dh: "native", auth: nativePlatform(), user_id: user.id, user_name: wantName || "" },
    { onConflict: "endpoint" }
  );
  return !error;
}

// The listeners that receive Apple's/Google's answer are attached on their own
// (and again on demand) — they used to sit behind the startup permission check,
// so a slow first launch left nobody listening and "Turn on" spun forever on
// Elie's iPhone (10/16/26).
let listenersP = null;
let lastError = "";
function ensureListeners() {
  if (listenersP) return listenersP;
  listenersP = (async () => {
    const P = await push();
    await P.addListener("registration", async (t) => {
      lastToken = t.value;
      let ok = false;
      try { ok = await saveToken(t.value); } catch { ok = false; }
      if (!ok) lastError = "Couldn't save this phone for notifications — check your connection and try again.";
      tokenWaiters.forEach((fn) => fn(ok));
      tokenWaiters = [];
    });
    await P.addListener("registrationError", (e) => {
      lastError = `Apple/Google didn't register this phone${e && e.error ? ` (${e.error})` : ""}.`;
      tokenWaiters.forEach((fn) => fn(false)); tokenWaiters = [];
    });
    // Tapped a notification → go where it points (same links web push uses).
    await P.addListener("pushNotificationActionPerformed", (a) => {
      const url = a && a.notification && a.notification.data && a.notification.data.url;
      if (!url) return;
      try { window.location.href = new URL(url, window.location.origin).href; } catch { /* malformed */ }
    });
  })().catch((e) => { listenersP = null; throw e; });
  return listenersP;
}

// Called once at launch (main.jsx) before the app renders.
export async function initNative() {
  if (!isNative()) return;
  const root = document.documentElement;
  root.classList.add("gs-native", `gs-native-${nativePlatform()}`);
  try { await within(ensureListeners(), 5000); } catch { /* retried when turning notifications on */ }
  try {
    const P = await push();
    perm = mapPerm((await within(P.checkPermissions())).receive);
    if (nativePlatform() === "android") {
      // Heads-up banners need a high-importance channel (the server sends to it).
      try { await within(P.createChannel({ id: "messages", name: "Messages & tasks", description: "Chats, tasks and urgent alerts", importance: 5, visibility: 1, sound: "default", vibration: true })); } catch { /* older Android */ }
    }
  } catch { /* plugin missing — the app still works, just without push */ }
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await within(StatusBar.setStyle({ style: Style.Light }));
    if (nativePlatform() === "android") await within(StatusBar.setOverlaysWebView({ overlay: false }));
  } catch { /* fine */ }
}

export const nativePermission = () => perm;

function waitForToken(ms = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    tokenWaiters.push((ok) => { clearTimeout(t); resolve(ok); });
  });
}

// "Turn on notifications" inside the app.
export async function nativeEnablePush(userName) {
  wantName = userName || wantName;
  if (!pushReady()) throw new Error("Notifications for the Android app are being set up — they'll turn on in the next app update.");
  const P = await push();
  await within(ensureListeners(), 8000);
  let r = await within(P.checkPermissions(), 8000);
  if (r.receive !== "granted") r = await within(P.requestPermissions(), 120000);
  perm = mapPerm(r.receive);
  if (perm !== "granted") throw new Error("Notifications are off for this app. Open your phone's Settings → Notifications → Goldstone Properties → Allow Notifications.");
  lastError = "";
  const wait = waitForToken(20000);
  await within(P.register(), 10000);
  const ok = await wait;
  if (!ok) throw new Error(lastError || "Apple/Google didn't answer — check your connection and try again in a minute.");
  return true;
}

// Every launch: keep this phone's token on file (tokens can change).
export async function nativeRefreshPush(userName) {
  wantName = userName || wantName;
  if (perm !== "granted" || !pushReady()) return false;
  try {
    if (lastToken) return await saveToken(lastToken);
    await within(ensureListeners(), 8000);
    const wait = waitForToken();
    await within((await push()).register(), 10000);
    return await wait;
  } catch { return false; }
}

// Save / Share inside the app: write the real files to the app's cache and
// open the phone's share sheet with them (Save Image/Video, Files, WhatsApp…).
const toB64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
export async function nativeShareFiles(files) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const uris = [];
  for (const f of files) {
    const path = `share/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${f.name}`;
    const w = await Filesystem.writeFile({ path, data: await toB64(f), directory: Directory.Cache, recursive: true });
    uris.push(w.uri);
  }
  try { await Share.share({ files: uris }); return "done"; }
  catch (e) { if (/cancel/i.test((e && e.message) || "")) return "cancel"; throw e; }
}
