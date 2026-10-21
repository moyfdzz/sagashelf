import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // Without DATABASE_URL the commands run against the local Docker database
    // (`npm run db:up`), never against a remote one by accident. For Neon, set
    // DATABASE_URL in your own terminal for that one command and never write it in a file.
    url:
      process.env.DATABASE_URL ??
      "postgres://sagashelf@127.0.0.1:5432/sagashelf",
  },
});
