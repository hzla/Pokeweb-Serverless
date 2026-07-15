import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { updateMoveSpaArchive } from "../pokeweb/moveSpaModel";
import { findSpaTextureReferences, parseSpaArchive, removeSpaTexture, serializeSpaArchive } from "../pokeweb/nitroSpa";
import type { SpaChildResource, SpaTexture } from "../pokeweb/nitroSpa";
import type { ProjectState } from "../pokeweb/projectStore";

describe("move SPA writeback", () => {
  it("round-trips a parsed SPA archive without changing decoded metadata", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());
    const reparsed = parseSpaArchive(serializeSpaArchive(archive));

    expect(reparsed.resourceCount).toBe(archive.resourceCount);
    expect(reparsed.textureCount).toBe(archive.textureCount);
    expect(reparsed.resources[0].emissionCount).toBe(archive.resources[0].emissionCount);
    expect(reparsed.resources[0].textureIndex).toBe(archive.resources[0].textureIndex);
    expect(reparsed.resources[0].selfMaintaining).toBe(true);
    expect(reparsed.textures[0].format).toBe(archive.textures[0].format);
    expect(reparsed.textures[0].textureSize).toBe(archive.textures[0].textureSize);
  });

  it("serializes edited optional blocks and direct-color texture replacements", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());
    const resource = archive.resources[0];
    resource.scaleAnim = { start: 0.5, mid: 1.25, end: 0.25, curveIn: 0.2, curveOut: 0.8, loop: true };
    resource.colorAnim = { start: [1, 0, 0], end: [0, 1, 0], curveIn: 0.1, curvePeak: 0.5, curveOut: 0.9, randomStartColor: true, loop: false, interpolate: true };
    resource.alphaAnim = { start: 1, mid: 0.5, end: 0, randomRange: 0.25, curveIn: 0.1, curveOut: 0.9, loop: true };
    resource.texAnim = { textures: [0, 0], textureCount: 2, step: 0.5, randomizeInit: true, loop: true };
    resource.behaviors.push({ type: "gravity", magnitude: [0, -0.5, 0] });
    archive.textures[0].format = 7;
    archive.textures[0].width = 8;
    archive.textures[0].height = 8;
    archive.textures[0].rgba = solidRgba(8, 8, [255, 64, 0, 255]);
    archive.textures[0].sourceChanged = true;

    const reparsed = parseSpaArchive(serializeSpaArchive(archive));

    expect(reparsed.resources[0].scaleAnim?.loop).toBe(true);
    expect(reparsed.resources[0].colorAnim?.randomStartColor).toBe(true);
    expect(reparsed.resources[0].alphaAnim?.loop).toBe(true);
    expect(reparsed.resources[0].texAnim?.textureCount).toBe(2);
    expect(reparsed.resources[0].behaviors.some((behavior) => behavior.type === "gravity")).toBe(true);
    expect(reparsed.textures[0].format).toBe(7);
    expect(reparsed.textures[0].rgba[0]).toBeGreaterThan(240);
  });

  it("serializes edited indexed-alpha texture replacements", () => {
    for (const [format, paletteSize] of [
      [6, 16],
      [1, 64],
    ] as const) {
      const archive = parseSpaArchive(makeSyntheticSpa());
      archive.textures[0].format = format;
      archive.textures[0].width = 8;
      archive.textures[0].height = 8;
      archive.textures[0].rgba = patternedRgba(8, 8);
      archive.textures[0].sourceChanged = true;

      const reparsed = parseSpaArchive(serializeSpaArchive(archive));

      expect(reparsed.textures[0].format).toBe(format);
      expect(reparsed.textures[0].textureSize).toBe(64);
      expect(reparsed.textures[0].paletteSize).toBe(paletteSize);
      expect(reparsed.textures[0].rgba[3]).toBe(0);
      expect(reparsed.textures[0].rgba[7]).toBeGreaterThan(120);
    }
  });

  it("serializes appended textures and updated texture references", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());
    archive.textures.push(makeAppendedTexture(archive.textures[0], 1));
    archive.textureCount = archive.textures.length;
    archive.resources[0].textureIndex = 1;
    archive.resources[0].texAnim = { textures: [1, 0], textureCount: 2, step: 0.5, randomizeInit: false, loop: true };

    const reparsed = parseSpaArchive(serializeSpaArchive(archive));

    expect(reparsed.textureCount).toBe(2);
    expect(reparsed.textures[1].index).toBe(1);
    expect(reparsed.textures[1].format).toBe(6);
    expect(reparsed.textures[1].textureSize).toBe(64);
    expect(reparsed.textures[1].paletteSize).toBe(16);
    expect(reparsed.resources[0].textureIndex).toBe(1);
    expect(reparsed.resources[0].texAnim?.textureCount).toBe(2);
    expect(reparsed.resources[0].texAnim?.textures.slice(0, 2)).toEqual([1, 0]);
  });

  it("removes textures, warns on references, and compacts later texture references", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());
    archive.textures.push(makeAppendedTexture(archive.textures[0], 1), makeAppendedTexture(archive.textures[0], 2));
    archive.textureCount = archive.textures.length;
    archive.resources[0].textureIndex = 2;
    archive.resources[0].childResource = makeChildResource(1);
    archive.resources[0].texAnim = { textures: [0, 1, 2], textureCount: 3, step: 0.5, randomizeInit: false, loop: true };
    archive.textures[2].useSharedTexture = true;
    archive.textures[2].sharedTexId = 1;

    const references = findSpaTextureReferences(archive, 1).map((reference) => reference.label);
    expect(references).toEqual([
      "Emitter 0 child texture",
      "Emitter 0 texture animation frame 1",
      "Texture 2 shared texture source",
    ]);

    removeSpaTexture(archive, 1);
    const reparsed = parseSpaArchive(serializeSpaArchive(archive));

    expect(reparsed.textureCount).toBe(2);
    expect(reparsed.textures.map((texture) => texture.index)).toEqual([0, 1]);
    expect(reparsed.resources[0].textureIndex).toBe(1);
    expect(reparsed.resources[0].childResource?.textureIndex).toBe(0);
    expect(reparsed.resources[0].texAnim?.textures.slice(0, 3)).toEqual([0, 0, 1]);
  });

  it("lazily creates move_spas, marks only the saved SPA dirty, and exports it in the ROM", async () => {
    const spaNarc = new NARC();
    spaNarc.files = [makeSyntheticSpa(), makeSyntheticSpa()];
    const romBytes = makeRomWithMoveSpas(spaNarc.save());
    const project = makeProject(romBytes);
    const archive = parseSpaArchive(spaNarc.files[1]);
    archive.resources[0].emissionCount = 7;

    await updateMoveSpaArchive(project, 1, archive);

    expect(project.narcs.move_spas?.dirty.has(1)).toBe(true);
    expect(project.narcs.move_spas?.dirty.has(0)).toBe(false);

    const exported = await exportModifiedRom(project);
    const exportedRom = new NintendoDSRom(exported);
    const exportedSpaNarc = new NARC(exportedRom.getFileByName("a/0/0/6"));
    expect(parseSpaArchive(exportedSpaNarc.files[1]).resources[0].emissionCount).toBe(7);
    expect(parseSpaArchive(exportedSpaNarc.files[0]).resources[0].emissionCount).toBe(2);
  });
});

function makeSyntheticSpa(): Uint8Array {
  const out = new Uint8Array(32 + 88 + 32 + 16 + 8);
  writeU32(out, 0, 0x53504120);
  writeU32(out, 4, 0x315f3231);
  writeU16(out, 8, 1);
  writeU16(out, 10, 1);
  writeU32(out, 16, 88);
  writeU32(out, 20, 56);
  writeU32(out, 24, 32 + 88);

  const resource = 32;
  writeU32(out, resource, 1 << 14);
  writeU32(out, resource + 16, 2 * 4096);
  writeU16(out, resource + 34, 0x001f);
  writeU32(out, resource + 44, 4096);
  writeU16(out, resource + 60, 30);
  writeU16(out, resource + 62, 45);
  writeU32(out, resource + 68, 0xff00);

  const texture = 32 + 88;
  writeU32(out, texture, 0x53505420);
  writeU32(out, texture + 4, 2 | (1 << 16));
  writeU32(out, texture + 8, 16);
  writeU32(out, texture + 12, 48);
  writeU32(out, texture + 16, 8);
  writeU32(out, texture + 20, 56);
  writeU32(out, texture + 24, 0);
  writeU32(out, texture + 28, 56);
  out.fill(0x55, texture + 32, texture + 48);
  writeU16(out, texture + 48, 0x0000);
  writeU16(out, texture + 50, 0x001f);
  writeU16(out, texture + 52, 0x03e0);
  writeU16(out, texture + 54, 0x7c00);
  return out;
}

function makeProject(originalRomBytes: Uint8Array): ProjectState {
  return {
    originalRomBytes,
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: originalRomBytes.length },
    arm9: Uint8Array.of(1, 2, 3, 4),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeRomWithMoveSpas(moveSpas: Uint8Array): Uint8Array {
  const fnt = saveFnt(
    new Folder({
      folders: [["a", new Folder({ folders: [["0", new Folder({ folders: [["0", new Folder({ files: ["6"], firstId: 0 })]] })]] })]],
    }),
  );
  const out = new Uint8Array(0x7000 + moveSpas.length);
  out.set([0x54, 0x45, 0x53, 0x54], 0);
  out.set([0x54, 0x45, 0x53, 0x54], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x2c, 4);
  writeU32(out, 0x30, 0x4800);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x5000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x5200);
  writeU32(out, 0x4c, 8);
  writeU32(out, 0x50, 0x4a00);
  writeU32(out, 0x58, 0x4c00);
  writeU32(out, 0x84, 0x4000);
  out.set([1, 2, 3, 4], 0x4000);
  out.set([5, 6, 7, 8], 0x4800);
  out.set(fnt, 0x5000);
  const fileStart = 0x5400;
  writeU32(out, 0x5200, fileStart);
  out.set(moveSpas, fileStart);
  writeU32(out, 0x5204, fileStart + moveSpas.length);
  writeU32(out, 0x80, fileStart + moveSpas.length);
  return out.slice(0, fileStart + moveSpas.length);
}

function solidRgba(width: number, height: number, color: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < out.length; offset += 4) out.set(color, offset);
  return out;
}

function makeAppendedTexture(source: SpaTexture, index: number): SpaTexture {
  return {
    ...source,
    index,
    format: 6,
    width: 8,
    height: 8,
    textureSize: 64,
    paletteSize: 16,
    paletteIndexSize: 0,
    resourceSize: 112,
    useSharedTexture: false,
    sharedTexId: 0,
    rgba: patternedRgba(8, 8),
    rawBytes: undefined,
    sourceChanged: true,
  };
}

function makeChildResource(textureIndex: number): SpaChildResource {
  return {
    usesBehaviors: false,
    hasScaleAnim: false,
    hasAlphaAnim: false,
    rotationType: 0,
    followEmitter: false,
    useChildColor: false,
    drawType: 0,
    polygonRotAxis: 0,
    polygonReferencePlane: 0,
    randomInitVelMag: 0,
    endScale: 1,
    lifeFrames: 30,
    velocityRatio: 1,
    scaleRatio: 1,
    color: [1, 1, 1],
    emissionCount: 1,
    emissionDelay: 0,
    emissionIntervalFrames: 1,
    textureIndex,
    textureTileCountS: 0,
    textureTileCountT: 0,
    flipTextureS: false,
    flipTextureT: false,
    dpolFaceEmitter: false,
  };
}

function patternedRgba(width: number, height: number): Uint8ClampedArray {
  const colors: Array<[number, number, number, number]> = [
    [0, 0, 0, 0],
    [255, 216, 220, 255],
    [210, 72, 144, 192],
    [255, 245, 252, 128],
  ];
  const out = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) out.set(colors[pixel % colors.length], pixel * 4);
  return out;
}
