import { describe, expect, it, vi } from "vitest";
import { NintendoDSRom } from "../nds/rom";
import { writeU16, writeU32 } from "../nds/binary";
import { findPwanOverrideForSpecies, getPwanRuntimeStatus, installPwanRuntime, materializePwanAnimations } from "../pokeweb/pwanAnimationModel";
import { findTrainerPwanOverride, installTrainerPwanRuntime } from "../pokeweb/trainerPwanAnimationModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { decodeW2AnimFrame, parseW2Anim } from "../pokeweb/w2animCodec";
import { hydrateW2AnimFromRom, materializeW2AnimAnimations, w2animEditorToLinear, w2animLinearToEditor } from "../pokeweb/w2animAnimationModel";
import { streamFixture } from "./w2animFixture";

function projectFixture(): { project: ProjectState; rom: NintendoDSRom } {
  const bytes = streamFixture();
  const sheet = new Uint8Array(48 + 16384); sheet.set(new TextEncoder().encode("RAHC"), 16);
  writeU32(sheet, 40, 16384); writeU32(sheet, 44, 24);
  const rawFiles = Array.from({ length: 40 }, () => new Uint8Array()); rawFiles[22] = sheet; rawFiles[23] = sheet.slice();
  for (const member of [38, 39]) {
    const palette = new Uint8Array(72); palette.set(new TextEncoder().encode("TTLP"), 16); writeU32(palette, 36, 16);
    for (let n = 0; n < 16; n++) writeU16(palette, 40 + n * 2, n * 123);
    rawFiles[member] = palette;
  }
  const project = { session: { baseVersion: "W2", baseRom: "BW2" }, romInfo: { idCode: "IRDO" },
    narcs: { pokemon_sprites: { rawFiles, fileCount: 40, records: new Map(), dirty: new Set() },
      trainer_sprites: { rawFiles: Array.from({ length: 24 }, () => Uint8Array.of(0)), records: new Map(), dirty: new Set(), fileCount: 24 } },
    texts: { banks: {} }, arm9: new Uint8Array(), overlays: {} } as unknown as ProjectState;
  const rom = { idCode: "IRDO", filenames: { idOf: (path: string) => path === "w2anim/streams.bin" ? 7 : undefined }, files: { 7: bytes } } as unknown as NintendoDSRom;
  hydrateW2AnimFromRom(project, rom);
  return { project, rom };
}

describe("w2anim authoring bridge", () => {
  it("blocks both PWAN installers before any fetch or project mutation", async () => {
    const { project } = projectFixture(), before = structuredClone(project);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      await expect(installPwanRuntime(project)).rejects.toThrow(/w2anim/);
      await expect(installTrainerPwanRuntime(project)).rejects.toThrow(/w2anim/);
      expect(fetch).not.toHaveBeenCalled(); expect(project).toEqual(before);
      expect(getPwanRuntimeStatus(project).message).toContain("w2anim");
    } finally { vi.unstubAllGlobals(); }
  });

  it("viewing Pokémon/trainer streams does not dirty or rewrite the archive", async () => {
    const { project, rom } = projectFixture();
    expect(findPwanOverrideForSpecies(project, 1)?.front?.totalTicks).toBe(15);
    expect(findTrainerPwanOverride(project, 2)?.animation.totalTicks).toBe(4);
    expect(project.pwanAnimations?.dirty).toBe(false); expect(project.trainerPwanAnimations?.dirty).toBe(false);
    await materializePwanAnimations(project, rom);
    expect(project.fileSystem).toBeUndefined();
  });

  it("pixel/timing changes preserve shiny mapping and shared female references", async () => {
    const { project, rom } = projectFixture(), original = parseW2Anim(rom.files[7]!);
    const side = findPwanOverrideForSpecies(project, 1)!.front!;
    side.pwanBytes[side.pwanBytes.length - 1] = 0x55;
    project.pwanAnimations!.dirty = true;
    await materializeW2AnimAnimations(project, rom);
    const bytes = project.fileSystem!.replacements[7]!, after = parseW2Anim(bytes);
    expect(after.entries[0]!.maniOffset).toBe(after.entries[1]!.maniOffset);
    const mani = after.manis.get(after.entries[0]!.maniOffset)!;
    expect(mani.shinyPalette).toEqual(original.manis.get(64)!.shinyPalette);
    expect(mani.sequence).toEqual(original.manis.get(64)!.sequence);
    expect(project.narcs.pokemon_sprites!.dirty).toEqual(new Set([22, 23]));
    expect(project.codeInjection?.modules).toBeUndefined();
  });

  it("trainer conversion obeys the checkout's eight-row carrier convention", async () => {
    const { project, rom } = projectFixture();
    const side = findTrainerPwanOverride(project, 2)!.animation;
    const framesAt = new DataView(side.pwanBytes.buffer).getUint32(36, true);
    const linear = w2animEditorToLinear(side.pwanBytes.subarray(framesAt, framesAt + 4608));
    expect(linear.subarray(0, 8 * 48).every(value => value === 0)).toBe(true);
    linear[8 * 48] = 0x98; side.pwanBytes.set(w2animLinearToEditor(linear), framesAt);
    project.trainerPwanAnimations!.dirty = true;
    await materializeW2AnimAnimations(project, rom);
    const after = parseW2Anim(project.fileSystem!.replacements[7]!);
    const mani = after.manis.get(after.entries[2]!.maniOffset)!;
    expect(decodeW2AnimFrame(after, mani, 0)[0]).toBe(0x98);
    expect(after.entries[2]!.flags).toBe(1); expect(after.entries[2]!.shinyNclrFile).toBe(20);
  });

  it("rejects unsupported trainer crop without staging partial edits", async () => {
    const { project, rom } = projectFixture(), side = findTrainerPwanOverride(project, 2)!.animation;
    const framesAt = new DataView(side.pwanBytes.buffer).getUint32(36, true);
    side.pwanBytes[framesAt] = 0x12; project.trainerPwanAnimations!.dirty = true;
    await expect(materializeW2AnimAnimations(project, rom)).rejects.toThrow(/eight rows/);
    expect(project.fileSystem).toBeUndefined(); expect(project.narcs.pokemon_sprites!.dirty.size).toBe(0);
  });

  it("preserves unsupported millisecond streams and explicitly rejects edits", () => {
    const { project } = projectFixture(), bytes = project.w2animAnimations!.sourceBytes.slice();
    bytes[70] = bytes[70]! & ~4; project.w2animAnimations!.sourceBytes = bytes;
    expect(() => findPwanOverrideForSpecies(project, 1)).toThrow(/Millisecond/);
    expect(project.fileSystem).toBeUndefined(); expect(project.pwanAnimations!.overrides).toEqual([]);
  });

  it("invalid import leaves all prior project state untouched", () => {
    const { project, rom } = projectFixture(), before = structuredClone(project);
    rom.files[7] = new Uint8Array(16);
    expect(() => hydrateW2AnimFromRom(project, rom)).toThrow(); expect(project).toEqual(before);
  });
});
