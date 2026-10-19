import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split vendor dependencies into separate chunks
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) {
              return "react-vendor";
            }
            if (id.includes("react-router-dom")) {
              return "router-vendor";
            }
            if (id.includes("lucide-react") || id.includes("react-hot-toast")) {
              return "ui-vendor";
            }
            if (id.includes("i18next") || id.includes("react-i18next")) {
              return "i18n-vendor";
            }
            // All other node_modules go into vendor chunk
            return "vendor";
          }

          // Split large components
          if (id.includes("/components/")) {
            if (id.includes("DynamicOverlays")) {
              return "dynamic-overlays";
            }

            if (id.includes("Dashboard") || id.includes("Settings") || id.includes("Config")) {
              return "main-ui";
            }

            if (id.includes("RuntimeHistory") || id.includes("RuntimeStats")) {
              return "runtime";
            }

            if (id.includes("AssetOverview") || id.includes("AssetManager")) {
              return "assets";
            }
          }
        },
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 3000,
    proxy: {
      // API Requests
      "/api": {
        target: "",
        changeOrigin: true,
      },
      // WebSocket
      "/ws": {
        target: "",
        ws: true,
      },
      // Assets
      "/assets": {
        target: "",
        changeOrigin: true,
      },
      // Assets
      "/poster_assets": {
        target: "",
        changeOrigin: true,
      },
      // Test-Bilder
      "/test": {
        target: "",
        changeOrigin: true,
      },
    },
  },
});
