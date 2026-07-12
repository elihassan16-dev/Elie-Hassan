import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./auth/AuthProvider";
import Root from "./App.jsx";
import { ensureMsalReady, msalInstance, startMsalKeepAlive } from "./onedrive/msal";

// Catches render/runtime errors so a crash shows a readable message + Reload
// instead of a blank white screen.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error("[app] crashed:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif", background: "#F5F5F7" }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E" }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#8A8A8E", maxWidth: 420, wordBreak: "break-word" }}>{String(this.state.err?.message || this.state.err)}</div>
          <button
            onClick={() => { this.setState({ err: null }); if (typeof location !== "undefined") location.reload(); }}
            style={{ marginTop: 6, padding: "11px 22px", borderRadius: 12, border: "none", background: "#B8953F", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Process any Microsoft (OneDrive) redirect sign-in result — but only BLOCK the
// first render for it when the URL actually carries a Microsoft response (the
// return trip from their login page). A normal launch used to wait on MSAL
// initializing before painting anything, which read as a frozen white screen.
async function boot() {
  const fromMsRedirect = /[#?&](code|error)=/.test(window.location.hash) || /[?&](code|error)=/.test(window.location.search);
  const msal = (async () => {
    try {
      await ensureMsalReady();
      const res = await msalInstance.handleRedirectPromise();
      if (res?.account) msalInstance.setActiveAccount(res.account);
    } catch (e) {
      console.error("[msal] redirect handling failed:", e?.message || e);
    }
    // Rotate the Microsoft refresh token on every app open/resume so the Email
    // and Files sign-in stays alive (see keepMsalFresh in onedrive/msal.js).
    startMsalKeepAlive();
  })();
  if (fromMsRedirect) await msal;
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

boot();
