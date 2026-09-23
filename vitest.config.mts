import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integratsion testlar TEST_DATABASE_URL bo'lsa ishlaydi (alohida test bazasi!)
    env: {
      BOT_TOKEN: "test:token-for-unit-tests",
      JWT_SECRET: "test-secret-test-secret-test-secret-123",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/unused",
      LOG_LEVEL: "silent",
    },
    fileParallelism: false,
  },
});
