import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: "FitTrackr",
        short_name: "FitTrackr",
        // "any" and "maskable" are separate assets: maskable icons get cropped to a
        // circle (80% of the icon) on Android, so they use a smaller, safe-zone glyph.
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ],
        theme_color: "#F0C800",
        background_color: "#F0C800",
        display: "standalone",
      }
    })
  ]
});