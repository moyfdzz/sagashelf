import { build } from "vite";

/**
 * Bundles `app/testing/e2e-harness.tsx` once before the run (SAG-251), with the same compiler as the
 * app and no new dependency. The result, `.e2e-harness/harness.js`, is read by `mount.ts`.
 */
export default async function globalSetup() {
  await build({
    configFile: false,
    logLevel: "error",
    resolve: { tsconfigPaths: true },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: ".e2e-harness",
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: "app/testing/e2e-harness.tsx",
        formats: ["iife"],
        name: "SagaHarness",
        fileName: () => "harness.js",
      },
    },
  });
}
