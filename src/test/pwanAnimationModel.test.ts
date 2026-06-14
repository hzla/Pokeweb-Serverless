import { describe, expect, it } from "vitest";
import { readAscii, readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import {
  buildPwanArchive,
  buildPwanConfig,
  buildPwanOverrideSideFromPwanBytes,
  ensurePwanAnimationState,
  findPwanOverrideForSpecies,
  getPwanRuntimeStatus,
  hasPwanRuntimeDll,
  normalizePwanFrameScaleMode,
  normalizePwanOutlineThreshold,
  parsePwanArchive,
  pwanArchiveMemberId,
  pwanAssetIndex,
  pwanAssetPath,
  setPwanOverrideSideSpeed,
  PWAN_RUNTIME_PATH,
  PWAN_ARCHIVE_PATH,
  PWAN_CONFIG_BACK_FLAG,
  PWAN_CONFIG_FRONT_FLAG,
  PWAN_CONFIG_VERSION,
  PWAN_DEFAULT_FRAME_SCALE_MODE,
  PWAN_DEFAULT_OUTLINE_THRESHOLD,
  PWAN_MAX_OUTLINE_THRESHOLD,
  PWAN_MIN_OUTLINE_THRESHOLD,
  resolvePwanSpeciesTarget,
} from "../pokeweb/pwanAnimationModel";
import { PWAN_FRONT_NCEC_Y } from "../pokeweb/pwanCarrierPatch";
import { compileGifToPwan, pwanTimeline, PWAN_FRAME_BYTES, PWAN_HEIGHT, PWAN_MAX_TIMELINE, PWAN_PALETTE_COLORS, PWAN_WIDTH } from "../pokeweb/pwanCompiler";
import type { NarcStore, ProjectState, PwanAnimationOverride } from "../pokeweb/projectStore";

describe("pwanAnimationModel", () => {
  it("initializes empty project state", () => {
    const project = { pwanAnimations: undefined } as ProjectState;
    const state = ensurePwanAnimationState(project);

    expect(state.overrides).toEqual([]);
    expect(state.dirty).toBe(false);
    expect(state.nativeCarrierBackups).toEqual({});
    expect(project.pwanAnimations).toBe(state);
  });

  it("detects the PWAN DLL even when PMC metadata is absent", () => {
    const project = {
      session: { baseVersion: "W2", baseRom: "BW2" },
      romInfo: { idCode: "IRDO" },
      fileSystem: {
        replacements: {},
        additions: {
          [PWAN_RUNTIME_PATH]: new Uint8Array(),
        },
      },
    } as unknown as ProjectState;

    expect(hasPwanRuntimeDll(project)).toBe(true);
    expect(getPwanRuntimeStatus(project)).toMatchObject({ supported: true, installed: true, pmcInstalled: false });
  });

  it("builds deterministic v3 config entries and asset members", () => {
    const config = buildPwanConfig([makeOverride(498, 3, 5), makeOverride(25, 2, 4)]);

    expect(String.fromCharCode(...config.slice(0, 4))).toBe("PWNC");
    expect(readU16(config, 4)).toBe(PWAN_CONFIG_VERSION);
    expect(readU16(config, 6)).toBe(2);
    expect(readU32(config, 8)).toBe(PWAN_MAX_TIMELINE);
    expect(readU32(config, 12)).toBe(16);
    expect(readU16(config, 16)).toBe(25);
    expect(config[18]).toBe((PWAN_CONFIG_FRONT_FLAG | PWAN_CONFIG_BACK_FLAG) << 5);
    expect(readU16(config, 19)).toBe(25);
    expect(readU16(config, 21)).toBe(498);
    expect(config[23]).toBe((PWAN_CONFIG_FRONT_FLAG | PWAN_CONFIG_BACK_FLAG) << 5);
    expect(readU16(config, 24)).toBe(498);
    expect(pwanArchiveMemberId(7, "front")).toBe(15);
    expect(pwanArchiveMemberId(7, "back")).toBe(16);
    expect(pwanAssetPath(7, "front")).toBe(`${PWAN_ARCHIVE_PATH}:0015.bin`);
  });

  it("builds form-aware v3 config entries with one paired asset index", () => {
    const config = buildPwanConfig([makeOverride(303, 6, 7, { formIndex: 1, assetIndex: 783 })]);

    expect(String.fromCharCode(...config.slice(0, 4))).toBe("PWNC");
    expect(readU16(config, 4)).toBe(PWAN_CONFIG_VERSION);
    expect(readU16(config, 6)).toBe(1);
    expect(readU32(config, 8)).toBe(PWAN_MAX_TIMELINE);
    expect(readU32(config, 12)).toBe(16);
    expect(readU16(config, 16)).toBe(303);
    expect(config[18]).toBe(1 | ((PWAN_CONFIG_FRONT_FLAG | PWAN_CONFIG_BACK_FLAG) << 5));
    expect(readU16(config, 19)).toBe(783);
    expect(pwanAssetIndex(makeOverride(303, 1, 1, { formIndex: 1, assetIndex: 783 }))).toBe(783);
    expect(pwanAssetPath(783, "front")).toBe(`${PWAN_ARCHIVE_PATH}:1567.bin`);
  });

  it("encodes front-only and back-only overrides with side flags", () => {
    const frontOnly = makeOverride(4, 8, 0);
    delete frontOnly.back;
    const backOnly = makeOverride(5, 0, 9);
    delete backOnly.front;

    const config = buildPwanConfig([frontOnly, backOnly]);

    expect(readU16(config, 16)).toBe(4);
    expect(config[18]).toBe(PWAN_CONFIG_FRONT_FLAG << 5);
    expect(readU16(config, 19)).toBe(4);
    expect(readU16(config, 21)).toBe(5);
    expect(config[23]).toBe(PWAN_CONFIG_BACK_FLAG << 5);
    expect(readU16(config, 24)).toBe(5);
    expect(readU32(config, 8)).toBe(PWAN_MAX_TIMELINE);
  });

  it("builds a sparse W2U PWAN archive", () => {
    const override = makeOverride(7, 2, 3);
    override.front!.pwanBytes = Uint8Array.of(1, 2, 3);
    override.back!.pwanBytes = Uint8Array.of(4, 5);
    const bytes = buildPwanArchive([override]);
    const archive = new NARC(bytes);
    const fntbOffset = 0x10 + readU32(bytes, 0x14);
    const fimgOffset = fntbOffset + readU32(bytes, fntbOffset + 4);

    expect(archive.files[0]).toEqual(buildPwanConfig([override]));
    expect(archive.files[pwanArchiveMemberId(7, "front")]).toEqual(override.front?.pwanBytes);
    expect(archive.files[pwanArchiveMemberId(7, "back")]).toEqual(override.back?.pwanBytes);
    expect(archive.files.slice(1, pwanArchiveMemberId(7, "front")).every((file) => file.length === 0)).toBe(true);
    expect([...bytes.slice(4, 8)]).toEqual([0xfe, 0xff, 0x00, 0x01]);
    expect(readU16(bytes, 0x18)).toBe(pwanArchiveMemberId(7, "back") + 1);
    expect(readAscii(bytes, fntbOffset, 4)).toBe("BTNF");
    expect(readU32(bytes, fntbOffset + 4)).toBe(0x10);
    expect(readU32(bytes, fntbOffset + 8)).toBe(4);
    expect(readU16(bytes, fntbOffset + 12)).toBe(0);
    expect(readU16(bytes, fntbOffset + 14)).toBe(1);
    expect(readAscii(bytes, fimgOffset, 4)).toBe("GMIF");
  });

  it("parses a v3 W2U PWAN archive into previewable overrides", () => {
    const source = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const override: PwanAnimationOverride = {
      speciesId: 303,
      formIndex: 1,
      assetIndex: 783,
      front: {
        sourceFileName: "front.gif",
        sourceGifBytes: new Uint8Array(),
        pwanBytes: source.pwanBytes,
        visibleHeight: source.visibleHeight,
        frameCount: source.frameCount,
        uniqueFrameCount: source.uniqueFrameCount,
        timelineCount: source.timelineCount,
        totalTicks: source.totalTicks,
        paletteBgr555: source.paletteBgr555,
      },
      back: {
        sourceFileName: "back.gif",
        sourceGifBytes: new Uint8Array(),
        pwanBytes: source.pwanBytes,
        visibleHeight: source.visibleHeight,
        frameCount: source.frameCount,
        uniqueFrameCount: source.uniqueFrameCount,
        timelineCount: source.timelineCount,
        totalTicks: source.totalTicks,
        paletteBgr555: source.paletteBgr555,
      },
      nativePaletteSource: "back",
      carrierTemplate: "w2u-gen6-placeholder",
      backNcecY: PWAN_FRONT_NCEC_Y,
    };

    const parsed = parsePwanArchive(new NARC(buildPwanArchive([override])));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ speciesId: 303, formIndex: 1, assetIndex: 783 });
    expect(parsed[0]?.front?.pwanBytes).toEqual(source.pwanBytes);
    expect(parsed[0]?.back?.pwanBytes).toEqual(source.pwanBytes);
    expect(parsed[0]?.front?.sourceGifBytes).toHaveLength(0);
    expect(parsed[0]?.front?.frameCount).toBe(source.timelineCount);
    expect(parsed[0]?.front?.uniqueFrameCount).toBe(source.uniqueFrameCount);
  });

  it("parses current W2U assets with 192 timeline entries", () => {
    const pwanBytes = makePwanBytes(PWAN_MAX_TIMELINE);
    const override = makeOverride(771, PWAN_MAX_TIMELINE, PWAN_MAX_TIMELINE);
    override.front!.pwanBytes = pwanBytes;
    override.back!.pwanBytes = pwanBytes;

    const archive = new NARC(buildPwanArchive([override]));
    const parsed = parsePwanArchive(archive);

    expect(readU32(archive.files[0]!, 8)).toBe(PWAN_MAX_TIMELINE);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.front?.timelineCount).toBe(PWAN_MAX_TIMELINE);
    expect(parsed[0]?.back?.timelineCount).toBe(PWAN_MAX_TIMELINE);
  });

  it("rescales one saved PWAN side speed without requiring the other side", () => {
    const override = makeOverride(785, 2, 0);
    override.front!.pwanBytes = makePwanBytes(2, 6);
    override.front!.totalTicks = 12;
    override.front!.speedScale = 1;
    delete override.back;
    const project = { pwanAnimations: { dirty: false, overrides: [override] } } as ProjectState;

    const side = setPwanOverrideSideSpeed(project, 785, "front", 2, { recordChange: false });

    expect(side?.speedScale).toBe(2);
    expect(side?.totalTicks).toBe(6);
    expect(pwanTimeline(side!.pwanBytes).map((entry) => entry.ticks)).toEqual([3, 3]);
    expect(project.pwanAnimations?.dirty).toBe(true);
  });

  it("defaults PWAN side scale mode and outline threshold for existing assets", () => {
    const side = buildPwanOverrideSideFromPwanBytes(makePwanBytes(1, 6), "front.pwan");

    expect(side.scaleMode).toBe(PWAN_DEFAULT_FRAME_SCALE_MODE);
    expect(side.outlineThreshold).toBe(PWAN_DEFAULT_OUTLINE_THRESHOLD);
    expect(normalizePwanFrameScaleMode(undefined)).toBe("nearest");
    expect(normalizePwanFrameScaleMode("outlineFill")).toBe("outlineFill");
    expect(normalizePwanOutlineThreshold(Number.NaN)).toBe(PWAN_DEFAULT_OUTLINE_THRESHOLD);
    expect(normalizePwanOutlineThreshold(-1)).toBe(PWAN_MIN_OUTLINE_THRESHOLD);
    expect(normalizePwanOutlineThreshold(999)).toBe(PWAN_MAX_OUTLINE_THRESHOLD);
  });

  it("finds form PWAN overrides when the editor is routed by expanded personal id", () => {
    const override = makeOverride(448, 2, 3, { formIndex: 1, assetIndex: 815 });
    const project = makeW2uPwanLookupProject([override]);

    expect(resolvePwanSpeciesTarget(project, 1076)).toEqual({
      requestedSpeciesId: 1076,
      speciesId: 448,
      formIndex: 1,
      assetIndex: 815,
    });
    expect(findPwanOverrideForSpecies(project, 1076)).toBe(override);
    expect(findPwanOverrideForSpecies(project, 448)).toBeUndefined();
  });

  it("rejects config tables that exceed the native runtime config limit", () => {
    expect(() => buildPwanConfig(Array.from({ length: 501 }, (_value, index) => makeOverride(index + 1, 1, 1)))).toThrow(/500/u);
  });
});

const SINGLE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==";

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
  for (let index = 0; index < timelineCount; index += 1) {
    view.setUint16(timelineOffset + index * 4, 0, true);
    view.setUint16(timelineOffset + index * 4 + 2, ticks, true);
  }
  return out;
}

function makeW2uPwanLookupProject(overrides: PwanAnimationOverride[]): ProjectState {
  const formats = getNarcFormats("BW2");
  const personalFormat = formats.personal!;
  const personal = Array.from({ length: 1077 }, () => packRows(personalFormat, [{}]));
  personal[448] = packRows(personalFormat, [{ form_id: 1076, num_forms: 2, form: 91 }]);
  personal[1076] = packRows(personalFormat, [{ num_forms: 2 }]);
  return {
    session: {
      romName: "W2U",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "W2U", idCode: "IRDO", fileName: "w2u.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", personal),
    },
    texts: { banks: { pokedex: [] } },
    formats,
    trpokInfo: [],
    pwanAnimations: {
      dirty: false,
      overrides,
      nativeCarrierBackups: {},
    },
  } as ProjectState;
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

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
  });
  return out;
}

function writeInt(bytes: Uint8Array, offset: number, size: number, value: number): void {
  for (let index = 0; index < size; index += 1) bytes[offset + index] = (value >>> (index * 8)) & 0xff;
}

function makeOverride(
  speciesId: number,
  frontTimeline: number,
  backTimeline: number,
  options: Partial<Pick<PwanAnimationOverride, "formIndex" | "assetIndex">> = {},
): PwanAnimationOverride {
  const side = (timelineCount: number) => ({
    sourceFileName: "test.gif",
    sourceGifBytes: new Uint8Array(),
    pwanBytes: new Uint8Array(),
    visibleHeight: 1,
    frameCount: 1,
    uniqueFrameCount: 1,
    timelineCount,
    totalTicks: 6,
    paletteBgr555: new Uint16Array(16),
  });
  return {
    speciesId,
    ...options,
    front: side(frontTimeline),
    back: side(backTimeline),
    nativePaletteSource: "back",
    carrierTemplate: "w2u-gen6-placeholder",
    backNcecY: PWAN_FRONT_NCEC_Y,
  };
}
