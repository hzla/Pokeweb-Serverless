import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || "./",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        hgMoveAnimation: "hg-move-animation.html",
        testBattleEmulator: "test-battle-emulator.html",
      },
    },
  },
  test: {
    include: ["src/test/**/*.test.ts"],
  },
});
