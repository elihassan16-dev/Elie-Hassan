// In-sandbox preview config: serves appdemo.html with the REAL GoldstoneShell
// but demo auth/data/net/supabase swapped in via aliases, so the app renders
// offline for screenshots before anything ships to Vercel. Never production.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const r = (p) => path.resolve(__dirname, p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^\.{1,2}\/auth\/AuthProvider$/, replacement: r("src/demo/appMockAuth.jsx") },
      { find: /^\.{1,2}\/data\/DataProvider$/, replacement: r("src/demo/appMockData.jsx") },
      { find: /^\.{1,2}\/net$/, replacement: r("src/demo/appMockNet.js") },
      { find: /^\.{1,2}\/supabaseClient$/, replacement: r("src/demo/mockSupabase.js") },
    ],
  },
  server: { port: 5188, strictPort: true },
});
