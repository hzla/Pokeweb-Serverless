import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { replaceNarcFile } from "../pokeweb/fileSystemModel";
import type { ProjectState, NarcStore } from "../pokeweb/projectStore";
import {
  decodeTitleAsset, decodeTitleComposition, encodeTitleLz10, exportTitleBundle, importTitleAssets,
  loadTitleScreenDocument, parseTitleCamera, readTitleBundle, titleAssetDefinitions, titleCameraFrame,
} from "../pokeweb/titleScreenModel";

describe("title screen assets", () => {
  it.each(["B2", "W2"] as const)("loads %s resources and round-trips native bundles without recompression", async (version) => {
    const project = makeProject(version);
    const document = await loadTitleScreenDocument(project);
    expect(document.assets).toHaveLength(19);
    expect(document.assets.find((asset) => asset.id === "model-01")?.member).toBe(version === "B2" ? 447 : 455);
    expect(decodeTitleComposition(document).prompt.frames).toHaveLength(1);
    const imports = readTitleBundle(exportTitleBundle(document), version);
    expect(await importTitleAssets(project, imports)).toBe(0);
    expect(project.fileSystem).toBeUndefined();
    expect(project.actionChangelog).toBeUndefined();
  });

  it("writes an edited compressed layer and preserves all other members through ROM export", async () => {
    const project = makeProject("W2");
    const originalRom = new NintendoDSRom(project.originalRomBytes!);
    const document = await loadTitleScreenDocument(project);
    const tiles = document.assets.find((asset) => asset.id === "logo-tiles")!.bytes.slice();
    tiles[48] = 1;
    expect(await importTitleAssets(project, new Map([["logo-tiles", tiles]]))).toBe(1);
    const exported = new NintendoDSRom(await exportModifiedRom(project));
    const before = new NARC(originalRom.getFileByName("a/0/2/6"));
    const after = new NARC(exported.getFileByName("a/0/2/6"));
    expect(after.files[0][0]).toBe(0x10);
    expect(decodeTitleAsset(after.files[0])).toEqual(tiles);
    expect(after.files.slice(1)).toEqual(before.files.slice(1));
    expect(exported.getFileByName("a/1/5/8")).toEqual(originalRom.getFileByName("a/1/5/8"));
    expect((await loadTitleScreenDocument(project)).assets.filter((asset) => asset.changed).map((asset) => asset.id)).toEqual(["logo-tiles"]);
  });

  it("merges file-system edits and preserves the other game's 3D assets", async () => {
    const project = makeProject("B2");
    const rom = new NintendoDSRom(project.originalRomBytes!);
    replaceNarcFile(project, rom, 0, 14, Uint8Array.of(99));
    replaceNarcFile(project, rom, 1, 470, Uint8Array.of(77));
    const before = new NARC(project.fileSystem!.replacements[1]);
    const doc = await loadTitleScreenDocument(project);
    const camera = doc.camera.bytes.slice();
    new DataView(camera.buffer).setFloat32(8, 12.5, true);
    const palette = doc.assets.find((asset) => asset.id === "logo-palette")!.bytes.slice(); palette[42] = 3;
    await importTitleAssets(project, new Map([["camera", camera], ["logo-palette", palette]]));
    const graphics = new NARC(project.fileSystem!.replacements[0]);
    const demo = new NARC(project.fileSystem!.replacements[1]);
    expect(graphics.files[14]).toEqual(Uint8Array.of(99));
    expect(demo.files[470]).toEqual(Uint8Array.of(77));
    expect(demo.files.slice(454, 462)).toEqual(before.files.slice(454, 462));
    expect(demo.files[453]).toEqual(camera);
  });

  it("uses an already-loaded archive store as the authoritative edit owner", async () => {
    const project = makeProject("W2");
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const archive = new NARC(rom.files[0]);
    project.narcs.moves = { name: "moves", fileId: 0, sourcePath: "a/0/2/6", rawFiles: archive.files, fileCount: archive.files.length, records: new Map(), dirty: new Set() } satisfies NarcStore;
    // Existing store data must take precedence over stale filesystem replacements.
    const stale = new NARC(rom.files[0]); stale.files[14] = Uint8Array.of(88);
    project.fileSystem = { replacements: { 0: stale.save() } };
    const doc = await loadTitleScreenDocument(project);
    const palette = doc.assets.find((asset) => asset.id === "logo-palette")!.bytes.slice(); palette[42] = 2;
    await importTitleAssets(project, new Map([["logo-palette", palette]]));
    expect(project.narcs.moves.rawFiles[2]).toEqual(palette);
    expect(project.narcs.moves.rawFiles[14]).toEqual(archive.files[14]);
    expect(project.narcs.moves.dirty.has(2)).toBe(true);
    expect(project.fileSystem.replacements[0]).toBeUndefined();
  });

  it("rejects broken references atomically without committing a second valid asset", async () => {
    const project = makeProject("W2");
    const doc = await loadTitleScreenDocument(project);
    const map = doc.assets.find((asset) => asset.id === "logo-map")!.bytes.slice();
    writeU16(map, 36, 511); // Only one tile in the test graphics.
    const camera = doc.camera.bytes.slice(); new DataView(camera.buffer).setFloat32(8, 2, true);
    await expect(importTitleAssets(project, new Map([["camera", camera], ["logo-map", map]]))).rejects.toThrow(/references tiles/);
    expect(project.fileSystem).toBeUndefined();
  });

  it("rejects wrong resource types and camera tracks that omit title events", async () => {
    const project = makeProject("W2");
    const doc = await loadTitleScreenDocument(project);
    await expect(importTitleAssets(project, new Map([["logo-palette", doc.assets[0].bytes]]))).rejects.toThrow(/requires NCLR/);
    await expect(importTitleAssets(project, new Map([["camera", cameraBytes(20)]]))).rejects.toThrow(/7780/);
    expect(project.fileSystem).toBeUndefined();
  });

  it("rejects sprite animation references to missing cells", async () => {
    const project = makeProject("W2");
    const doc = await loadTitleScreenDocument(project);
    const animation = doc.assets.find((asset) => asset.id === "prompt-animation")!.bytes.slice();
    writeU16(animation, 72, 3);
    await expect(importTitleAssets(project, new Map([["prompt-animation", animation]]))).rejects.toThrow(/missing cell/);
    expect(project.fileSystem).toBeUndefined();
  });

  it("keeps uncompressed camera frame counts ending in 0x10 distinct from LZ10", async () => {
    const project = makeProject("W2");
    await importTitleAssets(project, new Map([["camera", cameraBytes(7952)]]));
    expect((await loadTitleScreenDocument(project)).camera.frameCount).toBe(7952);
  });

  it("rejects cross-version and missing-file bundles", async () => {
    const doc = await loadTitleScreenDocument(makeProject("W2"));
    expect(() => readTitleBundle(exportTitleBundle(doc), "B2")).toThrow(/for B2/);
    const bad = zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "pokeweb-title-screen", version: 1, game: "W2", assets: [{ id: "camera", file: "native/title_w_camera.bin" }] })) });
    expect(() => readTitleBundle(bad, "W2")).toThrow(/missing/);
  });

  it("rejects unsupported games before looking up ROM files", async () => {
    const project = makeProject("W2"); project.session.baseRom = "BW";
    await expect(loadTitleScreenDocument(project)).rejects.toThrow(/Black 2 and White 2/);
  });
});

describe("camera and compression validation", () => {
  it("reads float camera channels in rotation/translation order and validates frame bounds", () => {
    const bytes = cameraBytes(2), view = new DataView(bytes.buffer);
    [23, 40, 0, 38.5, 4, 46].forEach((value, i) => view.setFloat32(32 + i * 4, value, true));
    const camera = parseTitleCamera(bytes);
    expect(titleCameraFrame(camera, 1)).toEqual({ scale: undefined, rotation: [23, 40, 0], position: [38.5, 4, 46] });
    expect(() => titleCameraFrame(camera, 2)).toThrow(/outside/);
    expect(() => titleCameraFrame(camera, 0.5)).toThrow(/outside/);
    view.setFloat32(8, NaN, true);
    expect(() => parseTitleCamera(bytes)).toThrow(/non-finite/);
    expect(() => parseTitleCamera(bytes.subarray(0, 20))).toThrow(/size/);
  });

  it("round-trips LZ10 literals and rejects truncated and invalid back-references", () => {
    const bytes = Uint8Array.from({ length: 37 }, (_, i) => i * 7);
    expect(decodeTitleAsset(encodeTitleLz10(bytes))).toEqual(bytes);
    expect(decodeTitleAsset(Uint8Array.of(0x10, 6, 0, 0, 0x10, 1, 2, 3, 0, 2))).toEqual(Uint8Array.of(1, 2, 3, 1, 2, 3));
    expect(() => decodeTitleAsset(Uint8Array.of(0x10, 4, 0, 0, 0x80, 0, 0))).toThrow(/back-reference/);
    expect(() => decodeTitleAsset(Uint8Array.of(0x10, 4, 0, 0, 0, 1))).toThrow(/Truncated/);
  });
});

function makeProject(version: "B2" | "W2"): ProjectState {
  const title = new NARC();
  title.files = [...titleAssetDefinitions(version).slice(0, 11).map(assetBytes), ...Array.from({ length: 4 }, (_, i) => Uint8Array.of(i))];
  const demo = new NARC(); demo.files = Array.from({ length: 479 }, (_, i) => Uint8Array.of(i & 255));
  for (const game of ["B2", "W2"] as const) for (const asset of titleAssetDefinitions(game).slice(11)) demo.files[asset.member] = assetBytes(asset);
  const fnt = saveFnt(new Folder({ folders: [["a", new Folder({ folders: [
    ["0", new Folder({ folders: [["2", new Folder({ files: ["6"], firstId: 0 })]] })],
    ["1", new Folder({ folders: [["5", new Folder({ files: ["8"], firstId: 1 })]] })],
  ] })]] }));
  const files = [title.save(), demo.save()];
  const originalRomBytes = new Uint8Array(0x5600 + files.reduce((sum, file) => sum + file.length, 0));
  ascii(originalRomBytes, 0, "TITLE TEST"); ascii(originalRomBytes, 12, version === "B2" ? "IREO" : "IRDO");
  for (const [offset, value] of [[0x20, 0x4000], [0x28, 0x02000000], [0x2c, 4], [0x30, 0x4800], [0x3c, 4], [0x40, 0x5000], [0x44, fnt.length], [0x48, 0x5200], [0x4c, 16], [0x84, 0x4000]]) writeU32(originalRomBytes, offset, value);
  originalRomBytes.set(fnt, 0x5000); let cursor = 0x5400;
  files.forEach((file, i) => { writeU32(originalRomBytes, 0x5200 + i * 8, cursor); originalRomBytes.set(file, cursor); cursor += file.length; writeU32(originalRomBytes, 0x5204 + i * 8, cursor); });
  writeU32(originalRomBytes, 0x80, cursor);
  return { originalRomBytes, session: { romName: "test.nds", baseRom: "BW2", baseVersion: version, fairy: false, fileIds: {}, blacklist: [] }, romInfo: { title: "Test", idCode: version === "B2" ? "IREO" : "IRDO", fileName: "test.nds", size: originalRomBytes.length }, arm9: new Uint8Array(4), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [] };
}

function assetBytes(asset: ReturnType<typeof titleAssetDefinitions>[number]): Uint8Array {
  let bytes: Uint8Array;
  if (asset.format === "camera") return cameraBytes(7781);
  if (asset.format === "NCGR") { const isLogo = asset.id === "logo-tiles"; bytes = nitro("RGCN", "RAHC", 48 + (isLogo ? 64 : 32)); writeU32(bytes, 28, isLogo ? 4 : 3); writeU32(bytes, 40, isLogo ? 64 : 32); }
  else if (asset.format === "NCLR") { bytes = nitro("RLCN", "TTLP", 552); writeU32(bytes, 32, 512); }
  else if (asset.format === "NSCR") { bytes = nitro("RCSN", "NRCS", 36 + 1536); writeU16(bytes, 24, 256); writeU16(bytes, 26, 192); writeU32(bytes, 32, 1536); }
  else if (asset.format === "NCER") { bytes = nitro("RECN", "KBEC", 62); writeU16(bytes, 24, 1); writeU32(bytes, 28, 24); writeU16(bytes, 48, 1); }
  else if (asset.format === "NANR") { bytes = nitro("RNAN", "KNBA", 74); writeU16(bytes, 24, 1); writeU16(bytes, 26, 1); writeU32(bytes, 28, 24); writeU32(bytes, 32, 40); writeU32(bytes, 36, 48); writeU16(bytes, 48, 1); writeU32(bytes, 52, 1 << 16); writeU32(bytes, 56, 2); writeU16(bytes, 68, 32); }
  else if (asset.format === "NSBMD") { bytes = nitro("BMD0", "", 40); writeU16(bytes, 14, 2); writeU32(bytes, 16, 24); writeU32(bytes, 20, 32); ascii(bytes, 24, "MDL0"); writeU32(bytes, 28, 8); ascii(bytes, 32, "TEX0"); writeU32(bytes, 36, 8); }
  else { bytes = nitro(asset.format === "NSBCA" ? "BCA0" : "BTA0", "", 76); writeU32(bytes, 16, 20); ascii(bytes, 20, asset.format === "NSBCA" ? "JNT0" : "SRT0"); writeU32(bytes, 24, 56); bytes[29] = 1; writeU16(bytes, 34, 16); writeU16(bytes, 44, 4); writeU32(bytes, 48, 48); ascii(bytes, 68, asset.format === "NSBCA" ? "J\0AC" : "M\0AT"); writeU16(bytes, 72, 7781); }
  return asset.compressed ? encodeTitleLz10(bytes) : bytes;
}
function nitro(stamp: string, block: string, size: number): Uint8Array {
  const bytes = new Uint8Array(size); ascii(bytes, 0, stamp); writeU16(bytes, 4, 0xfeff); writeU16(bytes, 6, 1); writeU32(bytes, 8, size); writeU16(bytes, 12, 16); writeU16(bytes, 14, 1); ascii(bytes, 16, block); writeU32(bytes, 20, size - 16); return bytes;
}
function cameraBytes(frames: number): Uint8Array { const bytes = new Uint8Array(8 + frames * 24); writeU32(bytes, 0, frames); bytes[5] = bytes[6] = 1; return bytes; }
function ascii(bytes: Uint8Array, offset: number, text: string): void { bytes.set(new TextEncoder().encode(text), offset); }
