import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./auth/AuthProvider";
import Root from "./App.jsx";
import { ensureMsalReady, msalInstance } from "./onedrive/msal";

// Process any Microsoft (OneDrive) redirect sign-in result before rendering, so a
// user returning from the Microsoft login lands connected on whatever page they're on.
async function boot() {
  try {
    await ensureMsalReady();
    const res = await msalInstance.handleRedirectPromise();
    if (res?.account) msalInstance.setActiveAccount(res.account);
  } catch (e) {
    console.error("[msal] redirect handling failed:", e?.message || e);
  }
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </React.StrictMode>
  );
}

boot();
