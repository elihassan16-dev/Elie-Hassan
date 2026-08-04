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

export default function Root() {
  const { loading, session, isContractor } = useAuth();
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
