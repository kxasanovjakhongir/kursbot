import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Standart: backend bilan bir serverda /app/ ostida. Alohida hostingda (Vercel) domen ildizida: VITE_BASE=/
export default defineConfig({
  base: process.env.VITE_BASE ?? "/app/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Dev: API backendga proksi — CORS muammosiz
    proxy: { "/api": "http://localhost:8080" },
  },
  build: { target: "es2020" },
});
