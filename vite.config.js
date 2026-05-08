import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || "./",
  test: {
    include: ["src/test/**/*.test.ts"],
  },
});
