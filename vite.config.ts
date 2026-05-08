// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually:
//   tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//   componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//   error logger plugins, and sandbox detection.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  vite: {
    plugins: [
      VitePWA({
        // injectManifest lets us write our own SW (push + offline + custom logic)
        // while still getting Workbox precaching of the build assets.
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "autoUpdate",
        // CRITICAL: never enable in dev (Lovable preview iframe)
        devOptions: { enabled: false },
        injectRegister: false, // we register manually with iframe/preview guards
        manifest: false, // we ship our own public/manifest.webmanifest
        injectManifest: {
          // Don't try to precache server bundles
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webp,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
  },
});
