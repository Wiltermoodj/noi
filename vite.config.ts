import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "icon.svg",
          "apple-touch-icon.png",
          "pwa-192x192.png",
          "pwa-512x512.png",
          "pwa-maskable-512x512.png",
          "northern-vietnam-icon-96.png",
          "central-vietnam-icon-96.png",
          "southern-vietnam-icon-96.png",
          "privacy.html",
        ],
        manifest: {
          id: "/",
          name: "Nói — Spoken Vietnamese",
          short_name: "Nói",
          description:
            "Offline spoken Vietnamese phrasebook and bidirectional translator with Northern, Central, and Southern dialects.",
          lang: "en",
          dir: "ltr",
          orientation: "portrait-primary",
          categories: ["education", "travel"],
          prefer_related_applications: false,
          theme_color: "#0F766E",
          background_color: "#FAFAFA",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          shortcuts: [
            {
              name: "Study Deck",
              short_name: "Learn",
              url: "/?tab=learn",
              icons: [{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" }],
            },
            {
              name: "Phrase Library",
              short_name: "Library",
              url: "/?tab=phrases",
              icons: [{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" }],
            },
            {
              name: "Translate",
              short_name: "Translate",
              url: "/?tab=translate",
              icons: [{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" }],
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,json}"],
          globIgnores: ["**/*-vietnam-icon-t.png"],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: "index.html",
          navigateFallbackDenylist: [/^\/api\//, /^\/privacy/, /^\/healthz$/, /^\/\.well-known\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-cache",
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "gstatic-fonts-cache",
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: "module",
          navigateFallback: "index.html",
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "."),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "vendor-react",
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              {
                name: "vendor-icons",
                test: /node_modules[\\/]lucide-react[\\/]/,
                priority: 25,
              },
              {
                name: "data-phrases",
                test: /src[\\/]data[\\/]phrases\.ts$/,
                priority: 20,
              },
              {
                name: "data-dictionary",
                test: /src[\\/]data[\\/]dictionary\.ts$/,
                priority: 20,
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env["DISABLE_HMR"] !== "true",
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env["DISABLE_HMR"] === "true" ? null : {},
    },
  };
});
