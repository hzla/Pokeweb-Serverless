import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import type { NarcName } from "../pokeweb/constants";
import type { MoveBackgroundFiles } from "../pokeweb/moveBackgroundCompiler";
import {
  appendEmptyMoveBackground,
  getMoveBackgroundIds,
  getReferencedMoveBackgroundCatalog,
  importMoveBackgroundImage,
  moveBackgroundReferenceLabel,
} from "../pokeweb/moveBackgroundModel";
import { invalidateMoveBackgroundCache, loadMoveBackground } from "../pokeweb/moveAnimationPreviewModel";
import { compileMoveAnimation } from "../pokeweb/moveAnimationModel";
import { parseNitroBackground } from "../pokeweb/nitroBg";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("moveBackgroundModel", () => {
  it("collects unique LoadBackground references from move and battle animation scripts", () => {
    const project = makeProject();
    project.narcs.move_animations = makeStore("move_animations", [
      makeScript(126, 126),
      new Uint8Array([1, 2, 3]),
    ]);
    project.narcs.battle_animations = makeStore("battle_animations", [makeScript(4, 126)]);

    const catalog = getReferencedMoveBackgroundCatalog(project);

    expect(catalog.scannedScriptCount).toBe(2);
    expect(catalog.skippedScriptCount).toBe(1);
    expect(catalog.backgrounds.map((background) => background.backgroundId)).toEqual([4, 126]);
    expect(catalog.backgrounds[1]?.references).toMatchObject([
      { storeName: "move_animations", scriptIndex: 0, moveId: 0, moveName: "Pound" },
      { storeName: "battle_animations", scriptIndex: 0, moveId: 561, moveName: "Relic Song" },
    ]);
    expect(moveBackgroundReferenceLabel(catalog.backgrounds[1]!.references[1]!)).toBe("Relic Song (#561)");
  });

  it("appends an empty triplet and replaces it with converted image data", async () => {
    const templates = makeBackgroundTemplates();
    const archive = new NARC();
    archive.files = [templates.screen, templates.characters, templates.palette];
    const project = makeArchiveProject(makeRomWithMoveBackgrounds(archive.save()));

    expect(await getMoveBackgroundIds(project)).toEqual([0]);
    const backgroundId = await appendEmptyMoveBackground(project);
    expect(backgroundId).toBe(3);
    expect(await getMoveBackgroundIds(project)).toEqual([0, 3]);

    const afterAdd = new NARC(project.fileSystem!.replacements[0]!);
    const empty = parseNitroBackground(3, afterAdd.files[3]!, afterAdd.files[4]!, afterAdd.files[5]!, { paletteBankOffset: 8, transparentIndexZero: true });
    expect(empty.hasTransparency).toBe(true);
    expect(empty.indexed.palette).toHaveLength(96);

    const pixels = new Uint8ClampedArray(64 * 48 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([186, 80, 232, 255], offset);
    const imported = await importMoveBackgroundImage(project, backgroundId, { width: 64, height: 48, pixels }, "terrain.png");
    expect(imported.report).toMatchObject({ sourceWidth: 64, sourceHeight: 48, paletteBankCount: 6 });
    expect(imported.background.rgba[3]).toBe(255);
    invalidateMoveBackgroundCache(project, backgroundId);
    expect((await loadMoveBackground(project, backgroundId)).rgba[3]).toBe(255);

    const afterImport = new NARC(project.fileSystem!.replacements[0]!);
    expect(afterImport.files).toHaveLength(6);
    expect(String.fromCharCode(...afterImport.files[3]!.subarray(0, 4))).toBe("RCSN");
    expect(project.actionChangelog?.entries.map((entry) => entry.text)).toEqual([
      "Move background 3 added.",
      "Move background 3 imported from terrain.png.",
    ]);
  });
});

function makeScript(...backgroundIds: number[]): Uint8Array {
  return compileMoveAnimation({} as ProjectState, 0, `${backgroundIds.map((backgroundId) => `LoadBackground ${backgroundId}`).join("\n")}\nTerminateMoveScript`);
}

function makeProject(): ProjectState {
  const moves: string[] = [];
  moves[0] = "Pound";
  moves[561] = "Relic Song";
  return {
    narcs: {},
    texts: { banks: { moves } },
  } as unknown as ProjectState;
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeBackgroundTemplates(): MoveBackgroundFiles {
  const screen = new Uint8Array(36 + 64 * 64 * 2);
  writeNnsHeader(screen, "RCSN");
  writeAscii(screen, 16, "NRCS");
  writeU32(screen, 20, screen.length - 16);
  writeU16(screen, 24, 512);
  writeU16(screen, 26, 512);
  writeU32(screen, 32, 64 * 64 * 2);

  const characters = new Uint8Array(48 + 1024 * 32);
  writeNnsHeader(characters, "RGCN");
  writeAscii(characters, 16, "RAHC");
  writeU32(characters, 20, characters.length - 16);
  writeU16(characters, 24, 32);
  writeU16(characters, 26, 32);
  writeU32(characters, 28, 3);
  writeU32(characters, 40, 1024 * 32);

  const palette = new Uint8Array(40 + 96 * 2);
  writeNnsHeader(palette, "RLCN");
  writeAscii(palette, 16, "TTLP");
  writeU32(palette, 20, palette.length - 16);
  writeU32(palette, 24, 3);
  writeU32(palette, 32, 96 * 2);
  return { screen, characters, palette };
}

function makeArchiveProject(originalRomBytes: Uint8Array): ProjectState {
  return {
    originalRomBytes,
    session: { romName: "test.nds", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "Test", idCode: "IREO", fileName: "test.nds", size: originalRomBytes.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeRomWithMoveBackgrounds(backgroundNarc: Uint8Array): Uint8Array {
  const fnt = saveFnt(new Folder({
    folders: [["a", new Folder({
      folders: [["0", new Folder({
        folders: [["9", new Folder({ files: ["4"], firstId: 0 })]],
      })]],
    })]],
  }));
  const out = new Uint8Array(0x5600 + backgroundNarc.length);
  writeAscii(out, 0, "TEST");
  writeAscii(out, 12, "IREO");
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x2c, 4);
  writeU32(out, 0x30, 0x4800);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x5000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x5200);
  writeU32(out, 0x4c, 8);
  writeU32(out, 0x84, 0x4000);
  out.set([1, 2, 3, 4], 0x4000);
  out.set([5, 6, 7, 8], 0x4800);
  out.set(fnt, 0x5000);
  writeU32(out, 0x5200, 0x5400);
  writeU32(out, 0x5204, 0x5400 + backgroundNarc.length);
  out.set(backgroundNarc, 0x5400);
  writeU32(out, 0x80, 0x5400 + backgroundNarc.length);
  return out;
}

function writeNnsHeader(bytes: Uint8Array, stampValue: string): void {
  writeAscii(bytes, 0, stampValue);
  writeU16(bytes, 4, 0xfeff);
  writeU16(bytes, 6, 1);
  writeU32(bytes, 8, bytes.length);
  writeU16(bytes, 12, 16);
  writeU16(bytes, 14, 1);
}

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
}
