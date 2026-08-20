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
      // Contractor-portal preview (ctrdemo.html): the portal's data hook swaps
      // to an in-memory sample so the REAL portal renders offline too. Only the
      // two contractors/ pages import exactly "./data".
      { find: /^\.\/data$/, replacement: r("src/demo/ctrMockData.js") },
    ],
  },
  server: { port: 5188, strictPort: true },
  // Build mode emits a browsable bundle (assets inlined) that scripts/ can
  // fold into ONE self-contained HTML file for sharing as a clickable preview.
  build: {
    outDir: "dist-appdemo",
    rollupOptions: { input: r("appdemo.html"), output: { inlineDynamicImports: true } },
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 10000,
  },
});
