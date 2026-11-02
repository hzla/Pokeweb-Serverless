import { execFileSync } from "node:child_process";

// Read committed runtime changes, rather than the build time or a user's ROM.
// Keep this build-only: no repository queries or network requests in the browser.
export function runtimeReleaseDates(root) {
  const paths = {
    ability: [
      "src/assets/data/abilityRuleRuntime*.json",
      "src/pokeweb/abilityEffectsModel.ts",
      "src/pokeweb/abilityNativeRuntime.ts",
      "src/pokeweb/abilityNativeParameters.ts",
      "src/pokeweb/abilityEvents.ts",
      "src/pokeweb/abilityRules.ts",
    ],
    music: ["src/assets/codeinjection/BgmToggle*.dll", "src/pokeweb/streamedBgmModel.ts"],
  };
  return Object.fromEntries(Object.entries(paths).map(([runtime, files]) => {
    let date = null;
    try {
      const value = execFileSync("git", ["log", "-1", "--format=%cI", "--", ...files], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (value && Number.isFinite(Date.parse(value))) date = new Date(value).toISOString();
    } catch { /* Source archives may not contain Git history. */ }
    return [runtime, date];
  }));
}
