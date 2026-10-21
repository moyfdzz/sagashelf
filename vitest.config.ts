import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    setupFiles: ["server/testing/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts"],
      exclude: [
        "server/**/*.test.ts",
        "server/testing/**",
        // Reads the Worker runtime bindings; covered by e2e, not unit tests.
        "server/runtime-env.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
