import { defineConfig } from "vite";
import { createW2uLocalBridgePlugin } from "./scripts/w2u-local-bridge.js";

export default defineConfig(({ mode }) => {
  const isCodexDev = mode === "codex-dev";
  return {
    base: process.env.GITHUB_PAGES_BASE || "./",
    plugins: [
      createW2uLocalBridgePlugin({
        devRomPath: isCodexDev ? process.env.POKEWEB_DEV_ROM || "../cleanwhite2.nds" : undefined,
      }),
    ],
    build: {
      // Keep even very small DLXF modules as independently fetchable binary
      // assets. Black2Upgrade companions are intentionally tiny after strip.
      assetsInlineLimit: (filePath) => (filePath.toLowerCase().endsWith(".dll") ? false : undefined),
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
  };
});
