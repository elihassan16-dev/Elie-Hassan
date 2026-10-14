// Preview of the real sign-in screen (tutorial recording only).
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../index.css";
import Login from "../auth/Login";
import { AuthCtx } from "/src/auth/AuthProvider.jsx";
createRoot(document.getElementById("root")).render(<AuthCtx.Provider value={{ signIn: async () => ({ error: null }) }}><Login /></AuthCtx.Provider>);
