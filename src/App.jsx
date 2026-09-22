import { useEffect, useRef } from "react";
import IdleLogout from "./IdleLogout";
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
function useIos26Tag() {
  useEffect(() => {
    try {
      const ua = navigator.userAgent || "";
      const m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)_/);
      const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
      if (m && Number(m[1]) >= 26 && standalone) document.documentElement.classList.add("gs-ios26");
    } catch { /* ignore */ }
  }, []);
}

export default function Root() {
  const { loading, session, isContractor } = useAuth();
  useIos26Tag();
  // ── Stale-build self-healing ────────────────────────────────────────────────
  // The service worker serves a cached shell when the network loses a 1.2s race
  // at launch — great for speed, but iOS PWAs then run DAYS-old builds with no
  // way to catch up. Compare our running bundle against the live index.html
  // (no-store, bypasses every cache) shortly after launch, on re-focus, and
  // every 10 minutes; when a newer build is live, reload once into it.
  const seen = useRef("");
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) return; busy = true;
      try {
        const html = await fetch("/", { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
        const live = (html.match(/\/assets\/[^"']+\.js/) || [])[0] || "";
        const mine = (document.querySelector('script[src*="/assets/"]')?.getAttribute("src")) || "";
        // Never yank the page out from under a running walkthrough (the
        // transcription lives in this tab) or a video upload.
        try { if ((window.__gsWalkBusy && window.__gsWalkBusy()) || (window.__gsUploads || 0) > 0) return; } catch { /* ignore */ }
        // During a deploy the edge can hand back the old and new page in turns;
        // only act when the same newer build shows up twice in a row.
        if (live && mine && !html.includes(mine)) {
          if (seen.current !== live) { seen.current = live; return; }
          // one attempt per target build — if the reload loses the race again,
          // the next interval retries instead of loop-reloading
          const key = "gs_reload_for";
          if (sessionStorage.getItem(key) !== live) {
            sessionStorage.setItem(key, live);
            window.location.reload();
          }
        }
      } catch { /* offline — the next check catches up */ }
      busy = false;
    };
    const t = setTimeout(check, 4000);
    const iv = setInterval(check, 10 * 60000);
    const vis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(t); clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, []);
  // The 📲 desktop→phone handoff bar — catches the push tap (URL param or
  // service-worker message) and offers the real tap iOS requires to jump
  // into Messages or the dialer. Rendered on every branch.
  const catcher = <HandoffCatcher />;
  if (loading) return <><Splash />{catcher}</>;
  if (!session) return <><Login />{catcher}</>;
  // Contractor logins get the simple portal — NOT the team app (and not the
  // DataProvider: database rules block them from team tables anyway).
  if (isContractor) return <><ContractorPortal />{catcher}</>;
  return (
    <DataProvider>
      <GoldstoneShell />
      <IdleLogout />
      {catcher}
    </DataProvider>
  );
}
