import { useState } from "react";
import { useAuth } from "./AuthProvider";

const GOLD = "#B8953F";
const GOLD_MID = "#D4A843";
const GOLD_LIGHT = "#F8F1E0";

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setErr(error.message || "Sign-in failed. Check your email and password.");
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        paddingTop: "max(24px, env(safe-area-inset-top))",
        paddingBottom: "max(24px, env(safe-area-inset-bottom))",
        background: `radial-gradient(120% 120% at 50% 0%, ${GOLD_MID} 0%, ${GOLD} 45%, #8C6F2D 100%)`,
        fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          borderRadius: 24,
          boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
          padding: "36px 28px 30px",
          boxSizing: "border-box",
        }}
      >
        {/* Brand mark */}
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div
            style={{
              width: 72,
              height: 72,
              margin: "0 auto 16px",
              borderRadius: 20,
              background: `linear-gradient(135deg, ${GOLD_MID}, ${GOLD})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 8px 24px ${GOLD}66`,
              fontFamily: "Georgia, serif",
              fontWeight: 700,
              fontSize: 40,
              color: GOLD_LIGHT,
            }}
          >
            G
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.01em" }}>
            Goldstone Properties
          </div>
          <div style={{ fontSize: 14, color: "#8A8A8E", marginTop: 4 }}>Sign in to your portfolio</div>
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Email">
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              style={inputStyle}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={inputStyle}
            />
          </Field>

          {err && (
            <div
              style={{
                background: "#FFF0EF",
                border: "1px solid #FF3B30",
                color: "#FF3B30",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 6,
              minHeight: 48,
              borderRadius: 12,
              border: "none",
              background: busy ? "#C9AE6E" : GOLD,
              color: "#fff",
              fontWeight: 700,
              fontSize: 16,
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
              boxShadow: `0 6px 18px ${GOLD}55`,
              transition: "background 0.15s",
            }}
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "#AEAEB2", lineHeight: 1.5 }}>
          Accounts are created by your administrator.
          <br />
          Need access? Contact your Goldstone admin.
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  minHeight: 48,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "#F9F9FB",
  color: "#1C1C1E",
  fontSize: 16, // 16px avoids iOS Safari zoom-on-focus
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: "#8A8A8E",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
