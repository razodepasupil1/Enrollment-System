import { defineConfig } from "vitest/config";

// Tests TRUNCATE and re-seed tables, so they must never touch the dev database.
// This overrides any DATABASE_URL (including one from .env) with the dedicated test database.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "mysql://enroll:enroll_pw@127.0.0.1:3307/enrollment_test";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/helpers/globalSetup.ts"],
    // DB-backed tests share one MySQL schema, so files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
