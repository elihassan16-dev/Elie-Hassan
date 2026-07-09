import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split dependencies out of the app bundle so they stay byte-identical
        // (and therefore browser/SW-cached) across our frequent deploys — a
        // deploy only invalidates the app chunk, not React/Supabase/MSAL.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@azure") || id.includes("msal")) return "msal";
          if (id.includes("@supabase")) return "supabase";
          return "vendor";
        },
      },
    },
  },
});
