import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import {
  buildPwanArchive,
  buildPwanOverrideSideFromPwanBytes,
  materializePwanAnimations,
  mergePwanArchive,
  parsePwanArchive,
  PWAN_ARCHIVE_PATH,
  PWAN_W2_RUNTIME_PATHS,
} from "../pokeweb/pwanAnimationModel";
import { compileGifToPwan } from "../pokeweb/pwanCompiler";
import {
  buildTrainerPwanConfig,
  ensureTrainerPwanAnimationState,
  parseTrainerPwanArchive,
  removeTrainerPwanOverride,
  trainerPwanAssetMemberId,
  TRAINER_PWAN_ASSET_MEMBER_BASE,
  TRAINER_PWAN_CONFIG_MEMBER_ID,
  TRAINER_PWAN_CONFIG_VERSION,
  TRAINER_PWAN_W2_RUNTIME_PATH,
  hasTrainerPwanRuntimeDll,
  installTrainerPwanRuntime,
  uninstallTrainerPwanRuntime,
  upsertTrainerPwanOverride,
} from "../pokeweb/trainerPwanAnimationModel";
import type { ProjectState, TrainerPwanAnimationOverride } from "../pokeweb/projectStore";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { detectTrainerPwanCompatibility } from "../pokeweb/trainerPwanCompatibilityModel";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { buildTrainerPwanCarrierFiles } from "../pokeweb/trainerSpriteModel";
import { decompressNitro, parsePokemonMultiCells, parseRigCells } from "../pokeweb/pokemonSpriteModel";

describe("trainerPwanAnimationModel", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("initializes independent trainer PWAN state", () => {
    const project = {} as ProjectState;
    expect(ensureTrainerPwanAnimationState(project)).toMatchObject({ dirty: false, overrides: [] });
    expect(project.pwanAnimations).toBeUndefined();
  });

  it.each(["cleanwhite2.nds", "cleanblack2.nds"])("grounds the carrier at the native trainer origin in %s", async (fileName) => {
    const romUrl = new URL(`../../../${fileName}`, import.meta.url);
    if (!existsSync(romUrl)) return;
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), fileName, { selectedNarcs: ["trainer_sprites"] });
    const original = project.narcs.trainer_sprites!.rawFiles.map((file) => file.slice());
    const carrier = buildTrainerPwanCarrierFiles(project);
    const unpack = (file: Uint8Array) => file[0] === 0x10 || file[0] === 0x11 ? decompressNitro(file) : file;
    const [cell] = parseRigCells(unpack(carrier[6]!)).cells;
    const multiCells = parsePokemonMultiCells(unpack(carrier[4]!)).cells;
    expect(cell).toMatchObject({ cellX: 0, cellY: 0, width: 96, height: 96, spriteX: -48, spriteY: 96 });
    for (const multiCell of multiCells) {
      expect(multiCell.nodes).toHaveLength(1);
      const node = multiCell.nodes[0]!;
      expect(node).toMatchObject({ x: 0, y: 0, visible: true });
      // MCSS adds node coordinates but negates the cell's upward-positive Y.
      // The old -96 cell Y plus its +144 node put all pixels off-screen.
      expect([node.x + cell!.spriteX, node.y - cell!.spriteY]).toEqual([-48, -96]);
    }
    expect(project.narcs.trainer_sprites!.rawFiles).toEqual(original);
  });

  it("encodes the versioned PWNT mapping and carrier", () => {
    const config = buildTrainerPwanConfig([makeOverride(17), makeOverride(94)], 188);
    expect(readAscii(config, 0, 4)).toBe("PWNT");
    expect(readU16(config, 4)).toBe(TRAINER_PWAN_CONFIG_VERSION);
    expect(readU16(config, 6)).toBe(2);
    expect(readU16(config, 10)).toBe(188);
    expect(readU32(config, 12)).toBe(16);
    expect(readU16(config, 16)).toBe(17);
    expect(readU16(config, 18)).toBe(17);
  });

  it("round-trips trainer-only archives without changing the species config contract", () => {
    const override = makeOverride(42);
    const archive = new NARC(buildPwanArchive([], [override], 188));
    expect(readAscii(archive.files[0]!, 0, 4)).toBe("PWNC");
    expect(readU16(archive.files[0]!, 6)).toBe(0);
    expect(readAscii(archive.files[TRAINER_PWAN_CONFIG_MEMBER_ID]!, 0, 4)).toBe("PWNT");
    expect(archive.files[trainerPwanAssetMemberId(42)]).toEqual(override.animation.pwanBytes);
    expect(archive.files.length).toBe(TRAINER_PWAN_ASSET_MEMBER_BASE + 43);
    expect(parseTrainerPwanArchive(archive)).toMatchObject({ carrierGraphicIndex: 188, overrides: [{ graphicIndex: 42 }] });
  });

  it("keeps a species-only archive compact and treats a missing PWNT member as empty", () => {
    const archive = new NARC(buildPwanArchive([]));
    expect(archive.files.length).toBe(1);
    expect(parseTrainerPwanArchive(archive)).toEqual({ overrides: [], carrierGraphicIndex: 0xffff });
  });

  it("round-trips species and trainer entries together without member collisions", () => {
    const side = makeOverride(42).animation;
    const archive = new NARC(buildPwanArchive([{
      speciesId: 25,
      front: side,
      nativePaletteSource: "front",
      carrierTemplate: "w2u-gen6-placeholder",
    }], [makeOverride(42)], 188));
    expect(parsePwanArchive(archive)).toMatchObject([{ speciesId: 25, front: { pwanBytes: side.pwanBytes } }]);
    expect(parseTrainerPwanArchive(archive)).toMatchObject({ carrierGraphicIndex: 188, overrides: [{ graphicIndex: 42 }] });
  });

  it("preserves every existing species member when adding and removing trainers above the species editor limit", () => {
    const source = makeLargeSpeciesArchive();
    expect(parsePwanArchive(source)).toHaveLength(501);
    const combined = new NARC(mergePwanArchive(source, {
      trainer: { overrides: [makeOverride(17)], carrierGraphicIndex: 188 },
    }));

    expect(combined.files.slice(0, source.files.length)).toEqual(source.files);
    expect(parsePwanArchive(combined)).toHaveLength(501);
    expect(parseTrainerPwanArchive(combined)).toMatchObject({ overrides: [{ graphicIndex: 17 }] });
    const removed = new NARC(mergePwanArchive(combined, { trainer: { overrides: [], carrierGraphicIndex: 0xffff } }));
    expect(removed.files).toEqual(source.files);
    expect(parseTrainerPwanArchive(removed).overrides).toEqual([]);
  });

  it("preserves trainer config and unreferenced trainer assets when changing species", () => {
    const source = new NARC(buildPwanArchive([], [makeOverride(17)], 188));
    // Preserve opaque config bytes too, instead of decoding and re-encoding them.
    source.files[TRAINER_PWAN_CONFIG_MEMBER_ID] = Uint8Array.from([...source.files[TRAINER_PWAN_CONFIG_MEMBER_ID]!, 0xab, 0xcd]);
    source.files.push(Uint8Array.of(0xde, 0xad));
    const output = new NARC(mergePwanArchive(source, { species: [{
      speciesId: 25,
      front: makeOverride(17).animation,
      nativePaletteSource: "front",
      carrierTemplate: "w2u-gen6-placeholder",
    }] }));

    expect(output.files.slice(TRAINER_PWAN_CONFIG_MEMBER_ID)).toEqual(source.files.slice(TRAINER_PWAN_CONFIG_MEMBER_ID));
    expect(parsePwanArchive(output)).toMatchObject([{ speciesId: 25 }]);
  });

  it.each(["rom", "addition", "replacement"] as const)("preserves a large species archive from the %s during repeated trainer materialization", async (location) => {
    const source = makeLargeSpeciesArchive();
    const originalArchive = new NARC(buildPwanArchive([]));
    const rom = new NintendoDSRom(new NintendoDSRom(new Uint8Array(0x200)).save({
      addedFiles: location === "addition" ? [] : [{ path: PWAN_ARCHIVE_PATH, bytes: (location === "rom" ? source : originalArchive).save() }],
    }));
    const project = {
      originalRomBytes: rom.data,
      session: { baseVersion: "W2", baseRom: "BW2" },
      romInfo: { idCode: "IRDO" },
      narcs: { trainer_sprites: { rawFiles: [Uint8Array.of(1)] } },
      pwanAnimations: { dirty: false, overrides: parsePwanArchive(source) },
      trainerPwanAnimations: { dirty: true, overrides: [] },
      fileSystem: {
        replacements: location === "replacement" ? { [rom.fileId(PWAN_ARCHIVE_PATH)]: source.save() } : {},
        additions: location === "addition" ? { [PWAN_ARCHIVE_PATH]: source.save() } : {},
      },
    } as unknown as ProjectState;
    // An existing ROM's species runtime need not be the editor's split DLLs.
    // Only the modified trainer domain should trigger installation checks.
    for (let pass = 0; pass < 2; pass += 1) {
      await materializePwanAnimations(project);
      const bytes = location === "addition" ? project.fileSystem!.additions![PWAN_ARCHIVE_PATH] : project.fileSystem!.replacements[rom.fileId(PWAN_ARCHIVE_PATH)];
      expect(new NARC(bytes).files).toEqual(source.files);
    }
  });

  it("retains the last staged archive if trainer runtime validation fails", async () => {
    const bytes = makeLargeSpeciesArchive().save();
    const project = {
      session: { baseVersion: "W2", baseRom: "BW2" },
      romInfo: { idCode: "IRDO" },
      narcs: {},
      fileSystem: { replacements: {}, additions: { [PWAN_ARCHIVE_PATH]: bytes } },
      trainerPwanAnimations: { dirty: true, overrides: [makeOverride(17)] },
    } as unknown as ProjectState;
    await expect(materializePwanAnimations(project)).rejects.toThrow(/Install the trainer PWAN runtime/u);
    expect(project.fileSystem!.additions![PWAN_ARCHIVE_PATH]).toBe(bytes);
  });

  it("upserts by shared graphic index and removes without changing native data", () => {
    const project = { trainerPwanAnimations: { overrides: [] }, narcs: {} } as unknown as ProjectState;
    upsertTrainerPwanOverride(project, makeOverride(17));
    upsertTrainerPwanOverride(project, makeOverride(17));
    expect(project.trainerPwanAnimations?.overrides).toHaveLength(1);
    expect(removeTrainerPwanOverride(project, 17)).toBe(true);
    expect(project.trainerPwanAnimations?.overrides).toEqual([]);
    expect(project.narcs).toEqual({});
  });

  it("rejects truncated trainer configs", () => {
    const archive = new NARC(buildPwanArchive([], [makeOverride(2)], 188));
    archive.files[TRAINER_PWAN_CONFIG_MEMBER_ID] = archive.files[TRAINER_PWAN_CONFIG_MEMBER_ID]!.slice(0, 17);
    expect(() => parseTrainerPwanArchive(archive)).toThrow(/truncated/u);
  });

  it("appends one carrier without changing native graphics and removes it cleanly", async () => {
    const romUrl = new URL("../../../cleanwhite2.nds", import.meta.url);
    if (!existsSync(romUrl)) return;
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), "cleanwhite2.nds", { selectedNarcs: ["trainer_sprites"] });
    const store = project.narcs.trainer_sprites!;
    const original = store.rawFiles.map((file) => file.slice());
    project.fileSystem ??= { replacements: {}, additions: {} };
    project.fileSystem.additions ??= {};
    project.fileSystem.additions[TRAINER_PWAN_W2_RUNTIME_PATH] = Uint8Array.of(0x44, 0x4c, 0x58, 0x46);
    upsertTrainerPwanOverride(project, makeOverride(17));

    await materializePwanAnimations(project);
    const carrierCount = store.rawFiles.length;
    expect(carrierCount).toBe(original.length + 8);
    expect(store.rawFiles.slice(0, original.length)).toEqual(original);
    expect(project.fileSystem.additions[PWAN_ARCHIVE_PATH]?.length).toBeGreaterThan(0);

    await materializePwanAnimations(project);
    expect(store.rawFiles).toHaveLength(carrierCount);

    const exported = await exportModifiedRom(project, { preserveOriginalLength: true });
    const reloaded = await loadProjectFromRomBytes(exported, "trainer-pwan.nds", { selectedNarcs: ["trainer_sprites"] });
    expect(reloaded.trainerPwanAnimations).toMatchObject({ carrierGraphicIndex: original.length / 8, overrides: [{ graphicIndex: 17 }] });
    expect(reloaded.narcs.trainer_sprites?.rawFiles).toHaveLength(carrierCount);

    removeTrainerPwanOverride(project, 17);
    await materializePwanAnimations(project);
    expect(store.rawFiles).toEqual(original);
  });

  it("does not rematerialize unchanged Pokemon carriers during a trainer-only export", async () => {
    const romUrl = new URL("../../../cleanwhite2.nds", import.meta.url);
    if (!existsSync(romUrl)) return;
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), "cleanwhite2.nds", { selectedNarcs: ["trainer_sprites"] });
    const missingMember = 1097 * 20;
    const sparsePokemonFiles = Array.from({ length: missingMember + 20 }, () => new Uint8Array());
    project.narcs.pokemon_sprites = {
      name: "pokemon_sprites",
      fileId: 4,
      sourcePath: "a/0/0/4",
      fileCount: sparsePokemonFiles.length,
      rawFiles: sparsePokemonFiles,
      records: new Map(),
      dirty: new Set(),
    };
    project.pwanAnimations = {
      dirty: false,
      overrides: parsePwanArchive(makeLargeSpeciesArchive()),
    };
    project.fileSystem ??= { replacements: {}, additions: {} };
    project.fileSystem.additions ??= {};
    for (const path of [...PWAN_W2_RUNTIME_PATHS, TRAINER_PWAN_W2_RUNTIME_PATH]) {
      project.fileSystem.additions[path] = Uint8Array.of(0x44, 0x4c, 0x58, 0x46);
    }
    const source = makeLargeSpeciesArchive();
    project.fileSystem.additions[PWAN_ARCHIVE_PATH] = source.save();
    upsertTrainerPwanOverride(project, makeOverride(17));

    await expect(materializePwanAnimations(project)).resolves.toBeUndefined();
    expect(project.narcs.pokemon_sprites.rawFiles[missingMember]).toHaveLength(0);
    const archive = new NARC(project.fileSystem.additions[PWAN_ARCHIVE_PATH]!);
    expect(archive.files.slice(0, source.files.length)).toEqual(source.files);
    expect(parsePwanArchive(archive)).toHaveLength(501);
    expect(parsePwanArchive(archive)[500]).toMatchObject({ speciesId: 501, assetIndex: 1097 });
    expect(parseTrainerPwanArchive(archive)).toMatchObject({ overrides: [{ graphicIndex: 17 }] });

    const exported = new NintendoDSRom(await exportModifiedRom(project));
    const exportedArchive = new NARC(exported.getFileByName(PWAN_ARCHIVE_PATH));
    expect(exportedArchive.files.slice(0, source.files.length)).toEqual(source.files);
    expect(parseTrainerPwanArchive(exportedArchive)).toMatchObject({ overrides: [{ graphicIndex: 17 }] });
  });

  it("matches the trainer lifecycle hooks in clean White 2 and Black 2 and rejects a changed hook", async () => {
    for (const [fileName, version] of [["cleanwhite2.nds", "W2"], ["cleanblack2.nds", "B2"]] as const) {
      const romUrl = new URL(`../../../${fileName}`, import.meta.url);
      if (!existsSync(romUrl)) continue;
      const bytes = new Uint8Array(readFileSync(romUrl));
      const rom = new NintendoDSRom(bytes);
      const project = {
        originalRomBytes: bytes,
        session: { baseVersion: version, baseRom: "BW2" },
        romInfo: { idCode: rom.idCode },
        overlays: {},
      } as unknown as ProjectState;
      expect(detectTrainerPwanCompatibility(project)).toMatchObject({ compatible: true, passed: 4 });
      const source = rom.loadArm9Overlays([168]).get(168)!;
      project.overlays[168] = source.data.slice();
      const hookAddress = version === "W2" ? 0x021e68d2 : 0x021e6892;
      project.overlays[168]![hookAddress - source.ramAddress] ^= 0xff;
      expect(detectTrainerPwanCompatibility(project).compatible).toBe(false);
    }
  });

  it("installs and removes the standalone trainer DLL without staging Pokémon PWAN modules", async () => {
    const romUrl = new URL("../../../cleanwhite2.nds", import.meta.url);
    if (!existsSync(romUrl)) return;
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), "cleanwhite2.nds", { selectedNarcs: ["trainer_sprites"] });
    project.codeInjection = { pmc: { overlayId: 344, overlayPath: "overlay/overlay_0344.bin" } };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const name = new URL(input instanceof Request ? input.url : String(input)).pathname.split("/").pop()!;
      return new Response(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)), { status: 200 });
    }));

    await installTrainerPwanRuntime(project);
    expect(hasTrainerPwanRuntimeDll(project)).toBe(true);
    expect(project.fileSystem?.additions?.[TRAINER_PWAN_W2_RUNTIME_PATH]?.slice(0, 4)).toEqual(Uint8Array.of(0x44, 0x4c, 0x58, 0x46));
    expect(project.codeInjection.modules?.filter((module) => /Pwan/u.test(module.fileName))).toHaveLength(1);

    uninstallTrainerPwanRuntime(project);
    expect(hasTrainerPwanRuntimeDll(project)).toBe(false);
    expect(project.trainerPwanAnimations?.overrides).toEqual([]);
  });
});

function makeOverride(graphicIndex: number): TrainerPwanAnimationOverride {
  const result = compileGifToPwan(new Uint8Array(Buffer.from("R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==", "base64")));
  return { graphicIndex, animation: buildPwanOverrideSideFromPwanBytes(result.pwanBytes, `trainer-${graphicIndex}.gif`) };
}

function makeLargeSpeciesArchive(): NARC {
  // Model a ROM with its own larger runtime/config. All entries share one
  // asset to keep this regression small while retaining the reported index.
  const config = new Uint8Array(32 + 501 * 5 + 2);
  config.set(new TextEncoder().encode("PWNC"));
  writeU16(config, 4, 3);
  writeU16(config, 6, 501);
  writeU32(config, 8, 192);
  writeU32(config, 12, 32);
  config[16] = 0xab;
  config[config.length - 1] = 0xcd;
  for (let index = 0; index < 501; index += 1) {
    const offset = 32 + index * 5;
    writeU16(config, offset, index + 1);
    config[offset + 2] = 1 << 5;
    writeU16(config, offset + 3, 1097);
  }
  const archive = new NARC();
  archive.files = Array.from({ length: TRAINER_PWAN_CONFIG_MEMBER_ID }, () => new Uint8Array());
  archive.files[0] = config;
  archive.files[1097 * 2 + 1] = makeOverride(17).animation.pwanBytes;
  archive.files[TRAINER_PWAN_CONFIG_MEMBER_ID - 1] = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
  return archive;
}
