import { defineConfig } from "vitest/config";

// Tests that need a real Postgres (`npm run db:up`). They run one file at a time because
// they share one database, which global-setup rebuilds from the migration files.
export default defineConfig({
  test: {
    name: "integration",
    environment: "node",
    include: ["db/**/*.integration.test.ts"],
    globalSetup: ["db/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
