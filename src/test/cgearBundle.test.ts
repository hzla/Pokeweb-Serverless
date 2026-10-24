import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import bw2 from "../assets/codeinjection/cgearQuickActionsManifest.json";
import bw1 from "../assets/codeinjection/cgearQuickActionsBw1Manifest.json";
import { parseRpm } from "../pokeweb/rpm";

const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("C-Gear release bundle consistency", () => {
  for (const [family, manifest, archive] of [
    ["BW2", bw2, "cgearQuickActions.narc"],
    ["BW1", bw1, "cgearQuickActionsBw1.narc"],
  ] as const) {
    it(`${family} graphics match the release manifest`, () => {
      expect(sha256(asset(archive))).toBe(manifest.archiveSha256);
    });
    for (const [game, profile] of Object.entries(manifest.games)) {
      it(`${game} DLL matches the release hash and version`, () => {
        const bytes = asset(profile.fileName);
        expect(sha256(bytes), `${profile.fileName} must be recovered with its matching manifest`).toBe(profile.sha256);
        const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
        expect(rpm.metadata.PMCVersion).toBe(manifest.version);
        expect(rpm.metadata.PMCGameID).toBe(game);
      });
    }
  }
});
