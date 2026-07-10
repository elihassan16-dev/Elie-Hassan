// Tutorial-recording config: serves demo.html with the real ContractorPortal
// but demo data/auth/net swapped in via aliases. Never used for production.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const r = (p) => path.resolve(__dirname, p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^\.\.\/auth\/AuthProvider$/, replacement: r("src/demo/mockAuth.jsx") },
      { find: /^\.\.\/net$/, replacement: r("src/demo/mockNet.js") },
      { find: /^\.\/data$/, replacement: r("src/demo/mockData.js") },
    ],
  },
  server: { port: 5199, strictPort: true },
});
