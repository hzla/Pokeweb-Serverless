import { defineConfig } from "vite";
import { createW2uLocalBridgePlugin } from "./scripts/w2u-local-bridge.js";

export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || "./",
  plugins: [createW2uLocalBridgePlugin()],
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
