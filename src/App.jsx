import { useAuth } from "./auth/AuthProvider";
import Login from "./auth/Login";
import { DataProvider } from "./data/DataProvider";
import { GoldstoneShell } from "./GoldstoneApp";

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
  const { loading, session } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Login />;
  return (
    <DataProvider>
      <GoldstoneShell />
    </DataProvider>
  );
}
