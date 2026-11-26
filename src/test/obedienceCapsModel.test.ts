import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { applyGeneralPatchSections, parseGeneralPatch } from "../pokeweb/generalPatchModel";
import { loadProjectFromRomBytes, type LoadOptions } from "../pokeweb/loader";
import { getObedienceCaps, updateObedienceCap, VANILLA_OBEDIENCE_CAPS } from "../pokeweb/obedienceCapsModel";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { makeEditProject } from "./fixtures/editProject";
import { romFixtureExists } from "./romFixtures";

const routines = readFileSync(new URL("./fixtures/obedienceCapsNative.bin", import.meta.url));
const fixtures = [
  { game: "B", id: "IRBO", file: "cleanblack.nds", overlay: 93, base: 0x21b6100, offset: 0x6eac, size: 0xd2, index: 0, gate: 0x6ef4 },
  { game: "W", id: "IRAO", file: "cleanwhite.nds", overlay: 93, base: 0x21b6120, offset: 0x6eac, size: 0xd2, index: 0xd2, gate: 0x6ef4 },
  { game: "B2", id: "IREO", file: "cleanblack2.nds", overlay: 167, base: 0x21998c0, offset: 0x7184, size: 0xe2, index: 0x1a4, gate: 0x71dc },
  { game: "W2", id: "IRDO", file: "cleanwhite2.nds", overlay: 167, base: 0x2199900, offset: 0x7184, size: 0xe2, index: 0x286, gate: 0x71dc },
] as const;

function makeFixture(profile: (typeof fixtures)[number]) {
  const project = makeEditProject();
  project.session.baseVersion = profile.game;
  project.session.baseRom = profile.overlay === 93 ? "BW" : "BW2";
  project.romInfo.idCode = profile.id;
  const stock = new Uint8Array(profile.offset + profile.size + 1);
  stock.set(routines.subarray(profile.index, profile.index + profile.size), profile.offset);
  const table = new Uint8Array(32);
  writeU32(table, 0, profile.overlay);
  writeU32(table, 4, profile.base);
  writeU32(table, 8, stock.length);
  const rom = { idCode: profile.id, data: new Uint8Array(32), arm9OverlayTable: table, files: [stock] } as NintendoDSRom;
  return { project, stock, rom };
}

describe("Obedience caps", () => {
  it.each(fixtures)("edits all badge counts in place and restores the stock routine on $game", profile => {
    const { project, stock, rom } = makeFixture(profile);
    expect(getObedienceCaps(project, rom)).toEqual(VANILLA_OBEDIENCE_CAPS);
    expect(updateObedienceCap(project, rom, 8, 100)).toBe(false);
    const caps = [1, 13, 27, 42, 55, 63, 80, 100, 92];
    caps.forEach((cap, badges) => expect(updateObedienceCap(project, rom, badges, cap)).toBe(true));
    expect(getObedienceCaps(project, rom)).toEqual(caps);
    expect(project.patches?.dirtyOverlayIds).toEqual([profile.overlay]);
    const patched = project.overlays[profile.overlay]!;
    expect(patched.subarray(0, profile.gate)).toEqual(stock.subarray(0, profile.gate));
    expect(patched.subarray(profile.gate + 0x36)).toEqual(stock.subarray(profile.gate + 0x36));
    const restored = openProjectSession(structuredClone(createProjectDocument(project, true)));
    expect(getObedienceCaps(restored, rom)).toEqual(caps);
    VANILLA_OBEDIENCE_CAPS.forEach((cap, badges) => updateObedienceCap(restored, rom, badges, cap));
    expect(restored.overlays[profile.overlay]).toEqual(stock);
  });

  it("rejects invalid values and leaves incompatible code untouched", () => {
    const { project, stock, rom } = makeFixture(fixtures[0]);
    expect(() => updateObedienceCap(project, rom, 9, 10)).toThrow(/badge count/u);
    for (const cap of [0, 101, 3.5, NaN]) expect(() => updateObedienceCap(project, rom, 0, cap)).toThrow(/whole level/u);
    stock[fixtures[0].gate + 4] ^= 1;
    expect(() => updateObedienceCap(project, rom, 0, 50)).toThrow(/different obedience/u);
    expect(project.patches).toBeUndefined();
    expect(project.overlays[93]).toBeUndefined();
  });

  it("writes at the relocated file offset when the routine keeps its RAM address", () => {
    const profile = fixtures[0];
    const { project, stock, rom } = makeFixture(profile);
    const prefix = new Uint8Array(0x2100).fill(0x5a);
    const expanded = new Uint8Array(prefix.length + stock.length);
    expanded.set(prefix);
    expanded.set(stock, prefix.length);
    writeU32(rom.arm9OverlayTable, 4, profile.base - prefix.length);
    writeU32(rom.arm9OverlayTable, 8, expanded.length);
    rom.files[0] = expanded;

    expect(getObedienceCaps(project, rom)).toEqual(VANILLA_OBEDIENCE_CAPS);
    updateObedienceCap(project, rom, 0, 21);
    const patched = project.overlays[profile.overlay]!;
    expect(patched[profile.gate + prefix.length + 0x2c]).toBe(21);
    expect(patched.subarray(0, prefix.length)).toEqual(prefix);
  });

  for (const profile of fixtures) {
    const url = new URL(`../../../${profile.file}`, import.meta.url);
    it.runIf(romFixtureExists(url))(`exports and reopens ${profile.game} with the custom caps`, async () => {
      const source = readFileSync(url);
      const options: LoadOptions = { selectedNarcs: ["message_texts"] };
      const project = await loadProjectFromRomBytes(source, profile.file, options);
      const rom = new NintendoDSRom(source, { fileData: "view" });
      expect(getObedienceCaps(project, rom)).toEqual(VANILLA_OBEDIENCE_CAPS);
      updateObedienceCap(project, rom, 0, 21);
      updateObedienceCap(project, rom, 8, 95);
      const exported = await exportModifiedRom(project, { forDsi: false });
      const reopened = await loadProjectFromRomBytes(exported, profile.file, options);
      const outputRom = new NintendoDSRom(exported, { fileData: "view" });
      expect(getObedienceCaps(reopened, outputRom)).toEqual([21, 20, 30, 40, 50, 60, 70, 80, 95]);
      expect(reopened.codeInjection?.pmc).toBeUndefined();
    }, 30_000);

    it.runIf(romFixtureExists(url))(`preserves both obedience and Fairy Type Support edits on ${profile.game}`, async () => {
      const source = readFileSync(url);
      const options: LoadOptions = { selectedNarcs: ["message_texts"] };
      const project = await loadProjectFromRomBytes(source, profile.file, options);
      const rom = new NintendoDSRom(source, { fileData: "view" });
      const fairyFile = new URL(`../assets/patches/fairy-${profile.game.toLowerCase()}.bin`, import.meta.url);
      updateObedienceCap(project, rom, 0, 21);
      await applyGeneralPatchSections(project, parseGeneralPatch(readFileSync(fairyFile)));
      expect(getObedienceCaps(project, rom)[0]).toBe(21);
      updateObedienceCap(project, rom, 8, 95);

      const exported = await exportModifiedRom(project, { forDsi: false });
      const reopened = await loadProjectFromRomBytes(exported, profile.file, options);
      const outputRom = new NintendoDSRom(exported, { fileData: "view" });
      expect(getObedienceCaps(reopened, outputRom)).toEqual([21, 20, 30, 40, 50, 60, 70, 80, 95]);
      const battle = outputRom.loadArm9Overlays([profile.overlay]).get(profile.overlay)!;
      expect(battle.ramAddress).toBeLessThan(profile.base);
      const start = profile.base + profile.gate + 0x2c - battle.ramAddress;
      expect(Array.from(battle.data.subarray(start, start + 9))).toEqual(getObedienceCaps(reopened, outputRom));
    }, 30_000);
  }
});
