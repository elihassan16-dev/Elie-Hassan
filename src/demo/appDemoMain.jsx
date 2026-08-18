// In-sandbox preview entry: the REAL GoldstoneShell with mocked auth/data/net,
// so UI changes can be rendered + screenshotted here BEFORE going to Vercel.
// Loaded only by appdemo.html via vite.appdemo.config.js — never in production.
import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { AuthProvider } from "../auth/AuthProvider";
import { DataProvider } from "../data/DataProvider";
import { GoldstoneShell } from "../GoldstoneApp";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("[appdemo] crashed:", err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 30, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap" }}>
          APPDEMO CRASH: {String(this.state.err?.stack || this.state.err?.message || this.state.err)}
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <AuthProvider>
      <DataProvider>
        <GoldstoneShell />
      </DataProvider>
    </AuthProvider>
  </ErrorBoundary>
);
