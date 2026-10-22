import { useEffect } from "react";
import IdleSleep from "./IdleSleep";
import { FaceIdLock } from "./faceId";
import { useAuth } from "./auth/AuthProvider";
import Login from "./auth/Login";
import { DataProvider } from "./data/DataProvider";
import { GoldstoneShell } from "./GoldstoneApp";
import { ContractorPortal } from "./contractors/ContractorPortal";
import { HandoffCatcher } from "./sms";

function Splash() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(120% 120% at 50% 0%, #D4A843 0%, #B8953F 55%, #8C6F2D 100%)",
        color: "#F8F1E0",
        fontFamily: "Georgia, serif",
        fontWeight: 700,
        fontSize: 44,
        letterSpacing: "0.02em",
      }}
    >
      G
    </div>
  );
}

// iOS 26+ home-screen app: the system frosts the first ~35pt of the page
// below the status bar no matter which status-bar setting the icon was added
// with (re-adding confirmed it, Elie 9/22/26) — the top bar's logo, title and
// icons sat inside that zone and read as faded. Tag the document so CSS can
// drop the bar's contents below the zone on these phones only.
// Safari 26+ freezes the "iPhone OS 18_x" token in the user agent, so the OS
// number can't be read from it any more; feature-detect the WebKit that ships
// with iOS 26+ instead (WebGPU, CSS anchor positioning, or a Version/26+ token
// where Safari still includes one).
export function isIos26Plus() {
  try {
    const ua = navigator.userAgent || "";
    const apple = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!apple) return false;
    const v = ua.match(/Version\/(\d+)/);
    if (v && Number(v[1]) >= 26) return true;
    if (typeof navigator.gpu !== "undefined") return true;
    if (window.CSS && CSS.supports && CSS.supports("anchor-name", "--gs")) return true;
  } catch { /* ignore */ }
  return false;
}
function useIos26Tag() {
  useEffect(() => {
    try {
      const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
      if (standalone && isIos26Plus()) document.documentElement.classList.add("gs-ios26");
    } catch { /* ignore */ }
  }, []);
}

export default function Root() {
  const { loading, session, isContractor, signOut } = useAuth();
  useIos26Tag();
  // New builds are picked up by src/autoUpdate.js — at launch, or when the
  // app comes back from the background. (A second checker here used to reload
  // the page every 10 minutes WHILE someone was using it — Elie 10/22/26:
  // "glitchy".)
  // The 📲 desktop→phone handoff bar — catches the push tap (URL param or
  // service-worker message) and offers the real tap iOS requires to jump
  // into Messages or the dialer. Rendered on every branch.
  const catcher = <HandoffCatcher />;
  if (loading) return <><Splash />{catcher}</>;
  if (!session) return <><Login />{catcher}</>;
  // Contractor logins get the simple portal — NOT the team app (and not the
  // DataProvider: database rules block them from team tables anyway).
  // 🔐 Face ID lock (only when the person turned it on, inside the phone app).
  if (isContractor) return <FaceIdLock onSignOut={signOut} email={session.user?.email || ""}><ContractorPortal />{catcher}</FaceIdLock>;
  return (
    <FaceIdLock onSignOut={signOut} email={session.user?.email || ""}>
      <DataProvider>
        <IdleSleep><GoldstoneShell /></IdleSleep>
        {catcher}
      </DataProvider>
    </FaceIdLock>
  );
}
