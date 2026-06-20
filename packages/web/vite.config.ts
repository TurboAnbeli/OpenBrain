import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_OPENBRAIN_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  base: "/web/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@uiw/react-codemirror") || id.includes("node_modules/@codemirror")) {
            return "codemirror";
          }
          if (id.includes("node_modules/@tanstack/react-query")) {
            return "tanstack";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "lucide";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/web/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/web\/api/, ""),
      },
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
