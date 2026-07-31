// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
    // Prerender a static SPA shell to dist/index.html for CDN / static hosting.
    spa: {
      enabled: true,
      prerender: {
        outputPath: "/index.html",
      },
    },
  },
  // Skip Nitro so TanStack Start owns the client/server outputs and can prerender
  // the SPA shell. Nitro's Cloudflare layout does not produce index.html.
  nitro: false,
  vite: {
    environments: {
      // Classic Vite publish dir: dist/index.html + assets/
      client: {
        build: {
          outDir: "dist",
        },
      },
      // Keep the SSR build (used only during prerender) out of the publish folder.
      ssr: {
        build: {
          outDir: ".output/server",
        },
      },
    },
  },
});
