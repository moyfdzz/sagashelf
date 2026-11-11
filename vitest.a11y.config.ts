import { defineConfig } from "vitest/config";

// The render tests only, with the file that saves the HTML they draw (SAG-249). Run it through
// `npm run test:a11y`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["app/**/*.render.test.tsx"],
    setupFiles: ["server/testing/setup.ts", "server/testing/a11y-capture.ts"],
  },
});
