import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import bw2 from "../assets/codeinjection/cgearQuickActionsManifest.json";
import bw1 from "../assets/codeinjection/cgearQuickActionsBw1Manifest.json";
import redux from "../assets/codeinjection/cgearQuickActionsReduxManifest.json";
import { parseRpm } from "../pokeweb/rpm";

const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("C-Gear release bundle consistency", () => {
  it("binds the Redux adapter to its version, native patch set, repel owner and PC script", () => {
    const blob = asset(redux.assetFileName), rpm = parseRpm(blob, { allowedMagics: ["DLXF"] });
    expect(sha256(blob)).toBe(redux.games.W2.sha256);
    expect(rpm.metadata).toMatchObject({ PMCGameID: "W2", PMCVersion: redux.version, PMCModulePriority: 4 });
    expect(rpm.relocations.filter(r => r.target.module !== "base")).toHaveLength(redux.games.W2.signatures.filter(s => s.patchSize).length);
    expect(rpm.relocations.some(r => r.target.module === "36" && [0x21824bc,0x21a0b2c].includes(r.target.address))).toBe(false);
    expect(sha256(new Uint8Array(readFileSync(new URL("./fixtures/cgear-redux-toggle-repel.dll", import.meta.url))))).toBe(redux.repelModule.sha256);
    expect(sha256(new Uint8Array(readFileSync(new URL("./fixtures/cgear-redux-pc-script.bin", import.meta.url))))).toBe(redux.pcScript.sha256);
  });
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
