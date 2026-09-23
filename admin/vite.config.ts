import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev rejimida API backendga proksi qilinadi — CORS muammosiz
    proxy: { "/api": "http://localhost:8080" },
  },
});
