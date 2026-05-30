import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU32 } from "../nds/binary";
import { compressLz11Literal, decompressNitro } from "../pokeweb/pokemonSpriteModel";
import type { NarcStore, ProjectState, PwanAnimationOverride } from "../pokeweb/projectStore";
import {
  applyPwanCarrierPatch,
  deriveBackNcecY,
  PWAN_BACK_NCEC_Y,
  PWAN_CARRIER_METADATA_OFFSETS,
  PWAN_FRONT_NCEC_Y,
  type PwanCarrierTemplate,
} from "../pokeweb/pwanCarrierPatch";
import { compileGifToPwan, pwanPalette } from "../pokeweb/pwanCompiler";

describe("pwanCarrierPatch", () => {
  it("copies placeholder metadata and patches fallback graphics, palettes, and NCEC Y", () => {
    const project = makeProject();
    const front = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const back = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const override = makeOverride(2, front.pwanBytes, back.pwanBytes);
    const carrier = makeCarrier();

    applyPwanCarrierPatch(project, override, carrier);

    const store = project.narcs.pokemon_sprites!;
    expect(store.rawFiles[44]).toEqual(carrier[4]);
    expect(store.rawFiles[55]).toEqual(carrier[15]);
    expect(store.dirty.has(40)).toBe(true);
    expect(store.dirty.has(42)).toBe(true);
    expect(store.dirty.has(49)).toBe(true);
    expect(store.dirty.has(51)).toBe(true);
    expect(store.dirty.has(58)).toBe(true);
    expect(store.dirty.has(59)).toBe(true);

    const frontNcgr = decompressNitro(store.rawFiles[40]!);
    expect(frontNcgr.slice(frontNcgr.length - 0x1200).some((byte) => byte !== 0)).toBe(true);
    const frontWide = decompressNitro(store.rawFiles[42]!);
    expect(frontWide.slice(frontWide.length - 0x4000).some((byte) => byte !== 0)).toBe(true);

    const palette = pwanPalette(back.pwanBytes);
    expect(readU16(store.rawFiles[58]!, 0x28)).toBe(palette[0]);
    expect(readU16(store.rawFiles[58]!, 0x2a)).toBe(palette[1]);
    expect(readU16(store.rawFiles[59]!, 0x2a)).toBe(palette[1]);

    expect(readU32(store.rawFiles[48]!, 16)).toBe(PWAN_FRONT_NCEC_Y << 8);
    expect(readU32(store.rawFiles[57]!, 16)).toBe(PWAN_FRONT_NCEC_Y << 8);
  });

  it("lifts tall back carriers", () => {
    expect(deriveBackNcecY(makeTallPwan())).toBe(PWAN_BACK_NCEC_Y);
  });
});

function makeProject(): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { pokemon_sprites: 4 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      pokemon_sprites: makeStore(Array.from({ length: 80 }, () => new Uint8Array())),
    },
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeStore(rawFiles: Uint8Array[]): NarcStore {
  const store: NarcStore = {
    name: "pokemon_sprites",
    fileId: 1,
    sourcePath: "a/0/0/4",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
  for (const base of [40]) {
    store.rawFiles[base] = makeCompressedNcgr(0x1200);
    store.rawFiles[base + 2] = makeCompressedNcgr(0x4000);
    store.rawFiles[base + 9] = makeCompressedNcgr(0x1200);
    store.rawFiles[base + 11] = makeCompressedNcgr(0x4000);
    store.rawFiles[base + 18] = makePaletteFile();
    store.rawFiles[base + 19] = makePaletteFile();
  }
  return store;
}

function makeCarrier(): PwanCarrierTemplate {
  const carrier: Partial<PwanCarrierTemplate> = {};
  for (const offset of PWAN_CARRIER_METADATA_OFFSETS) {
    carrier[offset] = offset === 8 || offset === 17 ? makeNcecFile() : new Uint8Array([0xc0, offset]);
  }
  return carrier as PwanCarrierTemplate;
}

function makeOverride(speciesId: number, frontPwan: Uint8Array, backPwan: Uint8Array): PwanAnimationOverride {
  const side = (pwanBytes: Uint8Array) => ({
    sourceFileName: "test.gif",
    sourceGifBytes: new Uint8Array(),
    pwanBytes,
    visibleHeight: 1,
    frameCount: 1,
    uniqueFrameCount: 1,
    timelineCount: 1,
    totalTicks: 6,
    paletteBgr555: pwanPalette(pwanBytes),
  });
  return {
    speciesId,
    front: side(frontPwan),
    back: side(backPwan),
    nativePaletteSource: "back",
    carrierTemplate: "w2u-gen6-placeholder",
    backNcecY: 48,
  };
}

function makeCompressedNcgr(dataBytes: number): Uint8Array {
  const out = new Uint8Array(48 + dataBytes);
  out.set([0x52, 0x47, 0x43, 0x4e], 0);
  return compressLz11Literal(out);
}

function makePaletteFile(): Uint8Array {
  const out = new Uint8Array(0x28 + 32);
  out.set([0x52, 0x4c, 0x43, 0x4e], 0);
  return out;
}

function makeNcecFile(): Uint8Array {
  const out = new Uint8Array(12 + 48);
  writeU32(out, 0, 1);
  writeU32(out, 16, PWAN_FRONT_NCEC_Y << 8);
  writeU32(out, 40, PWAN_FRONT_NCEC_Y << 8);
  return out;
}

function makeTallPwan(): Uint8Array {
  const source = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
  const tall = source.pwanBytes.slice();
  const frameOffset = readU32(tall, 36);
  tall[frameOffset] = 0x11;
  return tall;
}

const SINGLE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==";
