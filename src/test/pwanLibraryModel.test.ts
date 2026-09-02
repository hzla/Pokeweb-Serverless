import { statSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { buildPwanArchive } from "../pokeweb/pwanAnimationModel";
import { PWAN_CARRIER_METADATA_OFFSETS, PWAN_FRONT_NCEC_Y, type PwanCarrierTemplate } from "../pokeweb/pwanCarrierPatch";
import { PWAN_FRAME_BYTES, PWAN_HEIGHT, PWAN_PALETTE_COLORS, PWAN_WIDTH, pwanPalette } from "../pokeweb/pwanCompiler";
import { compressLz11Literal } from "../pokeweb/pokemonSpriteModel";
import { importPwanLibraryEntry, importPwanLibraryEntryFromLoadedLibrary, parsePwanLibraryArchive, type PwanLibraryManifest } from "../pokeweb/pwanLibraryModel";
import type { NarcStore, ProjectState, PwanAnimationOverride } from "../pokeweb/projectStore";

describe("pwanLibraryModel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("imports a two-sided library entry and immediately patches static carrier assets", () => {
    const source = makeOverride(4, makePwanBytes(2), makePwanBytes(3));
    const entry = makeEntry("4-0-4", 4, 0, 4, true, true);
    const library = parsePwanLibraryArchive(makeManifest([entry]), buildPwanArchive([source]));
    const project = makeProject();

    const saved = importPwanLibraryEntryFromLoadedLibrary(project, 2, entry.id, library, makeCarrier());

    expect(saved).toMatchObject({ speciesId: 2, formIndex: 0, nativePaletteSource: "back" });
    expect(saved.front?.sourceFileName).toBe("Hzla PWAN Library/Testmon/front.pwan");
    expect(saved.back?.sourceFileName).toBe("Hzla PWAN Library/Testmon/back.pwan");
    expect(saved.front?.pwanBytes).toEqual(source.front?.pwanBytes);
    expect(saved.back?.pwanBytes).toEqual(source.back?.pwanBytes);
    expect(project.pwanAnimations?.dirty).toBe(true);
    expect(project.narcs.pokemon_sprites?.dirty.has(40)).toBe(true);
    expect(project.narcs.pokemon_sprites?.dirty.has(49)).toBe(true);
    expect(project.narcs.pokemon_sprites?.dirty.has(58)).toBe(true);
    expect(project.narcs.pokemon_sprites?.dirty.has(59)).toBe(true);
  });

  it("preserves a target side when importing a one-sided library entry", () => {
    const source = makeOverride(5, makePwanBytes(2), undefined);
    const entry = makeEntry("5-0-5", 5, 0, 5, true, false);
    const library = parsePwanLibraryArchive(makeManifest([entry]), buildPwanArchive([source]));
    const preservedBack = makeSide(makePwanBytes(4), "existing-back.pwan");
    const project = makeProject();
    project.pwanAnimations = {
      dirty: false,
      overrides: [{
        speciesId: 2,
        formIndex: 0,
        back: preservedBack,
        nativePaletteSource: "back",
        carrierTemplate: "w2u-gen6-placeholder",
      }],
      nativeCarrierBackups: {},
    };

    const saved = importPwanLibraryEntryFromLoadedLibrary(project, 2, entry.id, library, makeCarrier());

    expect(saved.front?.pwanBytes).toEqual(source.front?.pwanBytes);
    expect(saved.back?.pwanBytes).toEqual(preservedBack.pwanBytes);
    expect(saved.nativePaletteSource).toBe("front");
  });

  it("installs a bundled icon and its palette assignment into the selected target", () => {
    const source = makeOverride(4, makePwanBytes(2), makePwanBytes(3));
    const entry = makeEntry("4-0-4", 4, 0, 4, true, true);
    const archive = new NARC(buildPwanArchive([source]));
    const male = Uint8Array.of(1, 2, 3, 4);
    const female = Uint8Array.of(5, 6, 7);
    entry.icon = {
      maleMemberId: archive.files.length,
      femaleMemberId: archive.files.length + 1,
      malePaletteId: 2,
      femalePaletteId: 1,
    };
    archive.files.push(male, female);
    const library = parsePwanLibraryArchive(makeManifest([entry]), archive.save());
    const project = makeProject(80, true);

    importPwanLibraryEntryFromLoadedLibrary(project, 2, entry.id, library, makeCarrier());

    expect(project.narcs.pokemon_icons?.rawFiles[12]).toEqual(male);
    expect(project.narcs.pokemon_icons?.rawFiles[13]).toEqual(female);
    expect(project.narcs.pokemon_icons?.dirty.has(12)).toBe(true);
    expect(project.narcs.pokemon_icons?.dirty.has(13)).toBe(true);
    expect(project.arm9[0x8c578 + 2]).toBe(0x12);
  });

  it("uses the Black 2 carrier set for bundled community imports", async () => {
    const source = makeOverride(4, makePwanBytes(2), makePwanBytes(3));
    const entry = makeEntry("4-0-4", 4, 0, 4, true, true);
    const library = parsePwanLibraryArchive(makeManifest([entry]), buildPwanArchive([source]));
    const project = makeProject();
    project.session.baseVersion = "B2";
    project.romInfo.idCode = "IREO";
    const carrier = makeCarrier();
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requestedUrls.push(url.pathname);
      const match = /file(\d+)\.bin$/u.exec(url.pathname);
      const offset = Number(match?.[1]);
      const bytes = new Uint8Array(carrier[offset]?.length ?? 0);
      if (carrier[offset]) bytes.set(carrier[offset]);
      return new Response(bytes.buffer);
    }));

    const saved = await importPwanLibraryEntry(project, 2, entry.id, { library });

    expect(saved).toMatchObject({ speciesId: 2, formIndex: 0 });
    expect(requestedUrls).toHaveLength(PWAN_CARRIER_METADATA_OFFSETS.length);
    expect(requestedUrls.every((url) => url.includes("/pwan/carrier-b2/"))).toBe(true);
  });

  it("keeps the generated W2U library manifest in sync with the bundled archive", () => {
    const manifest = JSON.parse(readFileSync(new URL("../assets/pwan/library/manifest.json", import.meta.url), "utf8")) as PwanLibraryManifest;
    const archiveUrl = new URL("../assets/pwan/library/pwan.narc", import.meta.url);
    const archive = statSync(archiveUrl);
    const loaded = parsePwanLibraryArchive(manifest, new Uint8Array(readFileSync(archiveUrl)));
    const missingCredits = manifest.entries.filter((entry) => entry.credits.trim().length === 0);

    expect(manifest.format).toBe("pokeweb-pwan-library-v2");
    expect(manifest.entryCount).toBe(297);
    expect(manifest.iconCount).toBe(297);
    expect(manifest.sideCount).toEqual({ front: 297, back: 283, total: 580 });
    expect(manifest.entries).toHaveLength(297);
    expect(manifest.entries.every((entry) => entry.icon)).toBe(true);
    expect(loaded.iconsByEntryId.size).toBe(297);
    expect(manifest.entries.filter((entry) => entry.hasFront !== entry.hasBack)).toHaveLength(14);
    expect(missingCredits).toEqual([]);
    expect(archive.size).toBe(manifest.archiveBytes);
  });
});

function makeManifest(entries: PwanLibraryManifest["entries"]): PwanLibraryManifest {
  return {
    format: "pokeweb-pwan-library-v1",
    generatedAt: "test",
    sourceRom: "test.nds",
    archivePath: "zz_pokeweb_pwan/pwan.narc",
    archiveBytes: 0,
    entryCount: entries.length,
    sideCount: {
      front: entries.filter((entry) => entry.hasFront).length,
      back: entries.filter((entry) => entry.hasBack).length,
      total: entries.filter((entry) => entry.hasFront).length + entries.filter((entry) => entry.hasBack).length,
    },
    entries,
  };
}

function makeEntry(id: string, speciesId: number, formIndex: number, assetIndex: number, hasFront: boolean, hasBack: boolean): PwanLibraryManifest["entries"][number] {
  return {
    id,
    name: "Testmon",
    key: "SPECIES_TESTMON",
    kind: "base species",
    speciesId,
    formIndex,
    assetIndex,
    hasFront,
    hasBack,
    credits: "artist",
    creditSource: "tracker",
  };
}

function makeOverride(speciesId: number, frontPwan: Uint8Array | undefined, backPwan: Uint8Array | undefined): PwanAnimationOverride {
  return {
    speciesId,
    front: frontPwan ? makeSide(frontPwan, "front.pwan") : undefined,
    back: backPwan ? makeSide(backPwan, "back.pwan") : undefined,
    nativePaletteSource: backPwan ? "back" : "front",
    carrierTemplate: "w2u-gen6-placeholder",
    backNcecY: backPwan ? PWAN_FRONT_NCEC_Y : undefined,
  };
}

function makeSide(pwanBytes: Uint8Array, sourceFileName: string): NonNullable<PwanAnimationOverride["front"]> {
  return {
    sourceFileName,
    sourceGifBytes: new Uint8Array(),
    pwanBytes,
    visibleHeight: 1,
    frameCount: 1,
    uniqueFrameCount: 1,
    timelineCount: 1,
    totalTicks: 6,
    paletteBgr555: pwanPalette(pwanBytes),
  };
}

function makePwanBytes(timelineCount: number, ticks = 1): Uint8Array {
  const headerBytes = 0x30;
  const paletteOffset = headerBytes;
  const timelineOffset = paletteOffset + PWAN_PALETTE_COLORS * 2;
  const frameOffset = timelineOffset + timelineCount * 4;
  const out = new Uint8Array(frameOffset + PWAN_FRAME_BYTES);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("PWAN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, PWAN_WIDTH, true);
  view.setUint16(8, PWAN_HEIGHT, true);
  view.setUint16(10, 4, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, timelineCount, true);
  view.setUint32(16, timelineCount * ticks, true);
  view.setUint32(20, PWAN_FRAME_BYTES, true);
  view.setUint32(24, PWAN_PALETTE_COLORS, true);
  view.setUint32(28, paletteOffset, true);
  view.setUint32(32, timelineOffset, true);
  view.setUint32(36, frameOffset, true);
  view.setUint16(paletteOffset + 2, 0x7fff, true);
  for (let index = 0; index < timelineCount; index += 1) {
    view.setUint16(timelineOffset + index * 4, 0, true);
    view.setUint16(timelineOffset + index * 4 + 2, ticks, true);
  }
  out[frameOffset] = 0x11;
  return out;
}

function makeProject(spriteFileCount = 80, withIcons = false): ProjectState {
  const arm9 = new Uint8Array(withIcons ? 0x8c578 + 756 : 0);
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
    arm9,
    overlays: {},
    narcs: {
      pokemon_sprites: makeStore(Array.from({ length: spriteFileCount }, () => new Uint8Array())),
      ...(withIcons ? { pokemon_icons: makeStore(Array.from({ length: 80 }, () => new Uint8Array())) } : {}),
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
  for (let base = 0; base + 19 < rawFiles.length; base += 20) {
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
