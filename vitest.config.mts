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
      PUBLIC_URL: "https://app.example.uz",
      METRICS_TOKEN: "test-metrics-token-0123456789",
      // Lokal .env dagi haqiqiy SMTP/CRM sozlamalari testlarga tushmasin (dotenv mavjud qiymatni almashtirmaydi)
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      MAIL_FROM: "",
      CRM_WEBHOOK_URL: "",
    },
    // nodemailer har bir testda mock — real SMTP serverga ulanish imkonsiz
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
  },
});
