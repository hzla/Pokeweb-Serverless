import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { replaceNarcFile } from "../pokeweb/fileSystemModel";
import { createProjectDocument } from "../pokeweb/projectDocument";
import type { ProjectState } from "../pokeweb/projectStore";
import { compileTitleArtwork, defaultTitleArtworkPlacement, fitTitleArtworkToScreen, prepareTitleArtwork, readTitleArtwork, titleArtworkDisplaySize, TITLE_ART_ASSETS } from "../pokeweb/titleScreenArtwork";
import { importTitleAssets, loadTitleScreenDocument, restoreTitleAssets, TITLE_DEMO_PATH, TITLE_GRAPHICS_PATH } from "../pokeweb/titleScreenModel";
import { romFixtureExists } from "./romFixtures";

const image = { width: 4, height: 2, rgba: Uint8Array.from([
  8, 255, 0, 0, 8, 255, 0, 255, 8, 255, 0, 255, 8, 255, 0, 255,
  255, 8, 255, 255, 255, 8, 255, 255, 255, 8, 255, 255, 255, 8, 255, 255,
]) };

const fullScreen = { width: 256, height: 192, rgba: new Uint8Array(256 * 192 * 4) };
for (let y = 0; y < fullScreen.height; y++) for (let x = 0; x < fullScreen.width; x++) {
  fullScreen.rgba.set([x < 128 ? 0 : 255, y < 96 ? 255 : 0, (x & 31) * 8, 255], (y * fullScreen.width + x) * 4);
}

it("preserves the visible PNG dimensions and transparency with an RGB555 palette", () => {
  const { image: converted, texture } = prepareTitleArtwork(image);
  expect([texture.width, texture.height]).toEqual([8, 8]);
  expect([converted.width, converted.height]).toEqual([4, 2]);
  const pixel = (x: number, y: number) => [...converted.rgba.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
  expect(pixel(0, 0)[3]).toBe(0);
  expect(pixel(3, 0)).toEqual([8, 255, 0, 255]);
  expect(pixel(3, 1)).toEqual([255, 8, 255, 255]);
  expect(() => prepareTitleArtwork({ ...image, rgba: new Uint8Array(image.rgba.length) })).toThrow(/no visible pixels/);
});

it("keeps all 256×192 image pixels and fits them one-to-one to the screen", () => {
  const { image: converted, texture } = prepareTitleArtwork(fullScreen);
  expect([texture.width, texture.height, texture.pixels.length]).toEqual([256, 256, 65536]);
  expect([converted.width, converted.height]).toEqual([256, 192]);
  expect([...converted.rgba.slice(-4)]).toEqual([255, 0, 247, 255]);
  const fit = fitTitleArtworkToScreen(converted);
  expect(defaultTitleArtworkPlacement(converted)).toEqual(fit);
  expect(fit).toEqual({ x: 128, y: 96, size: 256 });
  expect(titleArtworkDisplaySize(converted, fit.size)).toEqual({ width: 256, height: 192 });
});

describe.each([
  { version: "B2", romPath: "../cleanblack2.nds", start: 446 },
  { version: "W2", romPath: "../cleanwhite2.nds", start: 454 },
] as const)("$version title image", ({ version, romPath, start }) => {
  it.skipIf(!romFixtureExists(romPath))("round-trips placement through project saves and ROM export, and restores only the original title assets", async () => {
    const bytes = readFileSync(romPath);
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    const project: ProjectState = {
      originalRomBytes: bytes,
      session: { romName: "test.nds", baseRom: "BW2", baseVersion: version, fairy: false, fileIds: {}, blacklist: [] },
      romInfo: { title: rom.name, idCode: rom.idCode, fileName: "test.nds", size: bytes.length },
      arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    };
    const unrelated = Uint8Array.of(1, 2, 3);
    const demoId = rom.fileId(TITLE_DEMO_PATH);
    const original = new NARC(rom.files[demoId]);
    replaceNarcFile(project, rom, demoId, 0, unrelated);

    const document = await loadTitleScreenDocument(project);
    expect(readTitleArtwork(document)).toBeUndefined();
    const artwork = prepareTitleArtwork(fullScreen);
    const placement = fitTitleArtworkToScreen(artwork.image);
    const imports = compileTitleArtwork(document, artwork, placement);
    expect(await importTitleAssets(project, imports)).toBe(3);
    const saved = structuredClone(createProjectDocument(project, true).fileSystem);
    const reopened = { ...project, fileSystem: saved };
    const imported = readTitleArtwork(await loadTitleScreenDocument(reopened))!;
    expect(imported.placement).toEqual(placement);
    expect(Buffer.compare(imported.image.rgba, artwork.image.rgba)).toBe(0);

    const edited = { x: 176, y: 82, size: 120 };
    const current = await loadTitleScreenDocument(reopened);
    expect(await importTitleAssets(reopened, compileTitleArtwork(current, prepareTitleArtwork(imported.image), edited))).toBe(2);
    const exported = new NintendoDSRom(await exportModifiedRom(reopened, { forDsi: false }), { fileData: "view" });
    const editedDemo = new NARC(exported.getFileByName(TITLE_DEMO_PATH));
    const changed = editedDemo.files.flatMap((file, id) => Buffer.compare(file, original.files[id]) ? [id] : []);
    expect(changed).toEqual([0, start, start + 1, start + 3]);
    expect(Buffer.compare(exported.getFileByName(TITLE_GRAPHICS_PATH), rom.getFileByName(TITLE_GRAPHICS_PATH))).toBe(0);
    const exportedDoc = await loadTitleScreenDocument({ ...project, originalRomBytes: exported.data, fileSystem: undefined });
    expect(readTitleArtwork(exportedDoc)?.placement).toEqual(edited);
    expect(readTitleArtwork(exportedDoc)?.image).toEqual(artwork.image);

    const legacy = prepareTitleArtwork({ width: 128, height: 128, rgba: fullScreen.rgba.subarray(0, 128 * 128 * 4) });
    const legacyAssets = compileTitleArtwork(document, { ...legacy, texture: { ...legacy.texture, name: "pw_title_image" } }, edited);
    const legacyDoc = { ...document, assets: document.assets.map((asset) => ({ ...asset, bytes: legacyAssets.get(asset.id) ?? asset.bytes })) };
    expect(readTitleArtwork(legacyDoc)).toEqual({ image: legacy.image, placement: edited });

    expect(await restoreTitleAssets(reopened, TITLE_ART_ASSETS)).toBe(3);
    const restored = await loadTitleScreenDocument(reopened);
    expect(readTitleArtwork(restored)).toBeUndefined();
    expect(restored.assets.some((asset) => asset.changed)).toBe(false);
    expect(new NARC(reopened.fileSystem!.replacements[demoId]).files[0]).toEqual(unrelated);
  });
});
