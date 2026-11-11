import { defineConfig } from "vitest/config";

// The tests of `app/` that draw a page with `renderToString`, with the file that saves the HTML
// (SAG-249). A page drawn another way (`renderToStaticMarkup`, a stream) is not saved. Run it
// through `npm run test:a11y`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.tsx"],
    globalSetup: ["server/testing/a11y-clean.ts"],
    setupFiles: ["server/testing/setup.ts", "server/testing/a11y-capture.ts"],
  },
});
