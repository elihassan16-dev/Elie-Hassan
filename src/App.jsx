import { useEffect } from "react";
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
        minHeight: "100%",
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

export default function Root() {
  const { loading, session, isContractor } = useAuth();
  // iPadOS reserves a strip below every home-screen web app that no layout box
  // can reach — only the page canvas color paints there. Tag the html element
  // so index.css can blend that strip with whatever is directly above it
  // (gold login, or white-sidebar + gray-content inside the app).
  const authed = !loading && !!session;
  useEffect(() => {
    document.documentElement.classList.toggle("gs-authed", authed);
    document.documentElement.classList.toggle("gs-guest", !authed);
  }, [authed]);
  // ── Stale-build self-healing ────────────────────────────────────────────────
  // The service worker serves a cached shell when the network loses a 1.2s race
  // at launch — great for speed, but iOS PWAs then run DAYS-old builds with no
  // way to catch up. Compare our running bundle against the live index.html
  // (no-store, bypasses every cache) shortly after launch, on re-focus, and
  // every 10 minutes; when a newer build is live, reload once into it.
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) return; busy = true;
      try {
        const html = await fetch("/", { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
        const live = (html.match(/\/assets\/[^"']+\.js/) || [])[0] || "";
        const mine = (document.querySelector('script[src*="/assets/"]')?.getAttribute("src")) || "";
        if (live && mine && !html.includes(mine)) {
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
      {catcher}
    </DataProvider>
  );
}
