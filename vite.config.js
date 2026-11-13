import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createW2uLocalBridgePlugin } from "./scripts/w2u-local-bridge.js";
import { runtimeReleaseDates } from "./scripts/runtime-release-dates.js";
import { QUICK_TEST_FILES } from "./scripts/quick-test-files.js";
import { gen5TypeScale } from "./src/styles/gen5/typeScale.js";
import { gen5AccentText } from "./src/styles/gen5/accentText.js";

export default defineConfig(({ mode }) => {
  const isCodexDev = mode === "codex-dev";
  const isRomTest = mode === "rom";
  let buildId = process.env.GITHUB_SHA || "unknown";
  if (buildId === "unknown") {
    try { buildId = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { /* Source archives may not include Git metadata. */ }
  }
  return {
    base: process.env.GITHUB_PAGES_BASE || "./",
    // Runtime templates contain millions of numeric entries. Keep large JSON
    // as a parse expression instead of expanding every entry into Rollup's AST.
    json: { stringify: true },
    define: {
      __POKEWEB_BUILD_ID__: JSON.stringify(buildId),
      __POKEWEB_RUNTIME_RELEASE_DATES__: JSON.stringify(runtimeReleaseDates(fileURLToPath(new URL(".", import.meta.url)))),
    },
    // Gen 5 theme: larger type across the editor, and accent-coloured text in a readable blue.
    css: { postcss: { plugins: [gen5TypeScale(), gen5AccentText()] } },
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
          mastersheet: "mastersheet.html",
        },
      },
    },
    test: {
      include: mode === "quick" ? QUICK_TEST_FILES : ["src/test/**/*.test.ts"],
      // Bound retail ROM memory use with one worker and allow full import/export cycles.
      maxWorkers: isRomTest ? 1 : 2,
      minWorkers: 1,
      testTimeout: isRomTest ? 30000 : 5000,
      hookTimeout: isRomTest ? 30000 : 10000,
    },
  };
});
