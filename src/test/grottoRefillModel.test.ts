import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getGrottoRefillSettings, updateGrottoRefillSettings } from "../pokeweb/grottoRefillModel";
import { loadProjectFromRomBytes, type LoadOptions } from "../pokeweb/loader";
import { getGrottoOdds, updateGrottoOddsField } from "../pokeweb/martGrottoModel";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { makeEditProject } from "./fixtures/editProject";
import { romFixtureExists } from "./romFixtures";

const routineOffset = 0x2ee0;
const routineLength = 0x5e;
const dividerLength = 0x1e4;
const native = readFileSync(new URL("./fixtures/grottoRefillNative.bin", import.meta.url));
const fixtures = [
  { game: "B2", idCode: "IREO", filename: "cleanblack2.nds", divisionOffset: 0x89868, index: 0, branch: 0xe9b2 },
  { game: "W2", idCode: "IRDO", filename: "cleanwhite2.nds", divisionOffset: 0x89894, index: 1, branch: 0xe9a8 },
] as const;
const vanilla = { steps: 256, chance: 5 };
const fastest = { steps: 1, chance: 100 };

function makeRefillProject(fixture: (typeof fixtures)[number]) {
  const project = makeEditProject();
  project.romInfo.idCode = fixture.idCode;
  project.session.baseVersion = fixture.game;
  project.arm9 = new Uint8Array(fixture.divisionOffset + dividerLength);
  project.arm9.set(native.subarray(0, dividerLength), fixture.divisionOffset);
  const start = dividerLength + fixture.index * routineLength;
  project.overlays[36] = new Uint8Array(routineOffset + routineLength + 1);
  project.overlays[36].set(native.subarray(start, start + routineLength), routineOffset);
  return project;
}

describe("Hidden Grotto refill settings", () => {
  it.each(fixtures)("recognizes vanilla and staged edits and restores the original code on $game", (fixture) => {
    const project = makeRefillProject(fixture);
    const stock = project.overlays[36]!;
    expect(getGrottoRefillSettings(project)).toEqual(vanilla);
    expect(updateGrottoRefillSettings(project, vanilla)).toBe(false);
    expect(project.patches).toBeUndefined();

    expect(updateGrottoRefillSettings(project, fastest)).toBe(true);
    expect(getGrottoRefillSettings(project)).toEqual(fastest);
    expect(project.patches?.dirtyOverlayIds).toEqual([36]);
    expect(readU16(project.overlays[36]!, routineOffset + 0x22)).toBe(fixture.branch);
    const settings = { steps: 37, chance: 0 };
    expect(updateGrottoRefillSettings(project, settings)).toBe(true);
    expect(getGrottoRefillSettings(project)).toEqual(settings);
    expect(project.patches?.dirtyOverlayIds).toEqual([36]);
    const restored = openProjectSession(structuredClone(createProjectDocument(project, false)));
    expect(getGrottoRefillSettings(restored)).toEqual(settings);

    expect(updateGrottoRefillSettings(project, vanilla)).toBe(true);
    expect(project.overlays[36]).toEqual(stock);
    expect(project.actionChangelog?.entries).toHaveLength(0);
  });

  it("rejects invalid settings and refuses to overwrite modified native code", () => {
    const project = makeRefillProject(fixtures[0]);
    for (const steps of [0, 257, 1.5, NaN]) {
      expect(() => updateGrottoRefillSettings(project, { steps, chance: 5 })).toThrow(/steps/u);
    }
    for (const chance of [-1, 101, 0.5, NaN]) {
      expect(() => updateGrottoRefillSettings(project, { steps: 128, chance })).toThrow(/percent/u);
    }
    expect(project.patches).toBeUndefined();
    const overlay = project.overlays[36]!;
    overlay[routineOffset + 0x26] ^= 1;
    expect(getGrottoRefillSettings(project)).toBeUndefined();
    expect(() => updateGrottoRefillSettings(project, fastest)).toThrow(/verify/u);
    expect(project.overlays[36]).toBe(overlay);
    const incompatible = makeRefillProject(fixtures[1]);
    incompatible.arm9[fixtures[1].divisionOffset] ^= 1;
    expect(getGrottoRefillSettings(incompatible)).toBeUndefined();
  });

  for (const { game, filename } of fixtures) {
    const url = new URL(`../../../${filename}`, import.meta.url);
    it.runIf(romFixtureExists(url))(`preserves refill and rarity edits through ${game} autosave and ROM export`, async () => {
      const source = readFileSync(url);
      const options: LoadOptions = { selectedNarcs: ["grottos"] };
      const project = await loadProjectFromRomBytes(source, filename, options);
      expect(getGrottoRefillSettings(project)).toEqual(vanilla);
      updateGrottoOddsField(project, "rare_pok_odds_0", "2");
      updateGrottoRefillSettings(project, fastest);
      const snapshot = createProjectDocument(project, true);
      expect(snapshot.overlays[36]).toEqual(project.overlays[36]);
      expect(snapshot.narcs.grotto_odds?.rawFiles[0][0]).toBe(2);

      const exported = await exportModifiedRom(project, { forDsi: false });
      const reopened = await loadProjectFromRomBytes(exported, filename, options);
      expect(getGrottoRefillSettings(reopened)).toEqual(fastest);
      expect(getGrottoOdds(reopened).raw.rare_pok_odds_0).toBe(2);
      expect(reopened.codeInjection?.pmc).toBeUndefined();
    }, 30_000);
  }
});
