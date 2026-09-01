import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii, readU16, readU32, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import {
  detectBundledFormEvolutionDll,
  detectBundledMainMenuSkipDll,
  detectBundledOverworldWeatherRuntime,
  detectPmcInstallFromRom,
  detectBundledDoubleBattleFixDll,
  detectWhite2UpgradeDlls,
  getPmcInstallStatus,
  installPmcBytes,
  listCodeInjectionDlls,
  PMC_OVERLAY_ID_PATH,
  PMC_OVERLAY_RESERVED_SIZE,
  PMC_OVERLAY_SIZE,
  PMC_PATCHES_KEEP_PATH,
  PMC_SYMBOL_PATH,
  OVERWORLD_WEATHER_RUNTIME_W2_FILENAME,
  prepareBw2FormEvolutionCodeInjection,
  prepareBw2TestBattleCodeInjection,
  stageCodeInjectionDll,
  validateCodeInjectionDll,
} from "../pokeweb/pmcModel";
import { repairRomNarcs } from "../pokeweb/romRepairModel";
import { parseRpm, writeRelocationDataByType, writeRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";

const pmcB2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/PMC_B2.rpm", import.meta.url)));
const pmcW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/PMC_W2.rpm", import.meta.url)));
const doubleBattleFixW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/DoubleBattleFixW2.dll", import.meta.url)));
const mainMenuSkipB2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/MainMenuSkipB2.dll", import.meta.url)));
const mainMenuSkipW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/MainMenuSkipW2.dll", import.meta.url)));
const formEvolutionB2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/FormEvolutionB2.dll", import.meta.url)));
const formEvolutionW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/FormEvolutionW2.dll", import.meta.url)));
const overworldWeatherRuntimeW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/PokewebOverworldWeatherW2.dll", import.meta.url)));

describe("PMC installer", () => {
  it("parses bundled PMC metadata", () => {
    expect(parseRpm(pmcB2).metadata).toMatchObject({ PMCGameID: "B2", PMCVersion: "13.2.4" });
    expect(parseRpm(pmcW2).metadata).toMatchObject({ PMCGameID: "W2", PMCVersion: "13.2.4" });
  });

  it("does not double-count BSS when writing a packed code RPM", () => {
    const rpm = {
      code: Uint8Array.of(1, 2, 3, 4),
      bssSize: 0x10,
      baseAddress: 0,
      symbols: [],
      relocations: [],
      metadata: {},
    };

    const packed = writeRpm(rpm, { writeBss: true });

    expect(readU32(packed, 4)).toBe(packed.length);
  });

  it("writes Thumb BLX when a Thumb relocation targets ARM code", () => {
    const rpm = makeRelocationRpm("FUNCTION_ARM", 0x02001000);
    const out = new Uint8Array(4);

    writeRelocationDataByType(rpm, rpm.relocations[0]!, out, 0x02100000, 0x02100000);

    expect(readU16(out, 2) & 0xf800).toBe(0xe800);
  });

  it("keeps Thumb BL when a Thumb relocation targets Thumb code", () => {
    const rpm = makeRelocationRpm("FUNCTION_THM", 0x02001000);
    const out = new Uint8Array(4);

    writeRelocationDataByType(rpm, rpm.relocations[0]!, out, 0x02100000, 0x02100000);

    expect(readU16(out, 2) & 0xf800).toBe(0xf800);
  });

  it("rejects a bundled PMC binary for the wrong BW2 version", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    expect(() => installPmcBytes(project, pmcB2, romBytes)).toThrow(/for B2/u);
  });

  it("stages a CTRMap-compatible PMC overlay and exports its overlay table entry", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");

    const result = installPmcBytes(project, pmcW2, romBytes);
    expect(result.overlayId).toBe(344);
    expect(getPmcInstallStatus(project)).toMatchObject({ installed: true, overlayId: 344, version: "13.2.4" });

    const overlayBytes = project.fileSystem?.additions?.["overlay/overlay_0344.bin"];
    expect(overlayBytes).toBeTruthy();
    expect(readAscii(overlayBytes!, overlayBytes!.length - 0x10, 4)).toBe("OVL0");
    expect(new TextDecoder().decode(project.fileSystem?.additions?.[PMC_OVERLAY_ID_PATH])).toBe("344");
    expect(project.fileSystem?.additions?.[PMC_SYMBOL_PATH]?.length).toBeGreaterThan(0);
    expect(readU32(project.arm9, 0x400c)).not.toBe(0);

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    const overlayEntry = 344 * 32;
    const overlayFileId = rom.fileId("overlay/overlay_0344.bin");
    const fatOffset = readU32(exported, 0x48);
    expect(rom.arm9OverlayTable.length).toBe(345 * 32);
    expect(readU16(rom.fntData, 4)).toBe(344);
    expect(rom.filenames.files).toEqual(["base.bin"]);
    expect(duplicateFntFileIds(rom.fntData)).toEqual([]);
    expect(readU32(rom.arm9OverlayTable, overlayEntry)).toBe(344);
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 8)).toBe(PMC_OVERLAY_SIZE);
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 12)).toBe(0x5000);
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 24)).toBe(overlayFileId);
    expect(rom.filenames.idOf("base.bin")).toBe(344);
    expect([...rom.files[344]]).toEqual([344 & 0xff]);
    expect(overlayFileId).toBeGreaterThan(344);
    expect(readU32(exported, fatOffset + overlayFileId * 8)).toBeLessThan(readU32(exported, fatOffset + 344 * 8));
    expect(new TextDecoder().decode(rom.getFileByName(PMC_OVERLAY_ID_PATH))).toBe("344");
    expect(new TextDecoder().decode(rom.getFileByName(PMC_PATCHES_KEEP_PATH))).toBe("pokeweb");
    expect(readAscii(rom.getFileByName("overlay/overlay_0344.bin"), 0x2ff0, 4)).toBe("OVL0");
    expect(readU32(project.arm9, 0x7b41c)).toBe(result.overlayBaseAddress + 0x8000);
  });

  it("repairs a legacy short-read PMC overlay row on every later export", async () => {
    const romBytes = makeBw2LikeRom();
    const installedProject = makeProject(romBytes, "W2");
    installPmcBytes(installedProject, pmcW2, romBytes);
    const installedBytes = await exportModifiedRom(installedProject);
    const installedRom = new NintendoDSRom(installedBytes);
    const overlayId = 344;
    const overlayEntry = overlayId * 32;

    const legacyTable = installedRom.arm9OverlayTable.slice();
    writeU32(legacyTable, overlayEntry + 8, PMC_OVERLAY_RESERVED_SIZE);
    writeU32(legacyTable, overlayEntry + 12, 0);
    const legacyBytes = installedRom.save({ arm9OverlayTable: legacyTable });

    // Simulate an old serialized project that did not retain PMC metadata.
    const reopenedProject = makeProject(legacyBytes, "W2");
    reopenedProject.codeInjection = undefined;
    const repairedRom = new NintendoDSRom(await exportModifiedRom(reopenedProject));

    expect(readU32(repairedRom.arm9OverlayTable, overlayEntry + 8)).toBe(PMC_OVERLAY_SIZE);
    expect(readU32(repairedRom.arm9OverlayTable, overlayEntry + 12)).toBe(0x5000);
    expect(repairedRom.fileId("base.bin")).toBe(344);
  });

  it("restores retail root FNT names erased by legacy PMC exports", async () => {
    const retailNames = ["skb.narc", "soundstatus.narc", "swan_sound_data.sdat"];
    const romBytes = makeBw2LikeRom(347, new Folder({ files: retailNames, firstId: 344 }));
    const installedProject = makeProject(romBytes, "W2");
    installPmcBytes(installedProject, pmcW2, romBytes);
    const installedRom = new NintendoDSRom(await exportModifiedRom(installedProject));

    const legacyBytes = installedRom.save({
      arm9OverlayTable: installedRom.arm9OverlayTable,
      alignFntFirstFileToArm9OverlayCount: true,
    });
    const legacyRom = new NintendoDSRom(legacyBytes);
    expect(legacyRom.filenames.files).toEqual([]);
    expect(legacyRom.filenames.firstId).toBe(345);

    const reopenedProject = makeProject(legacyBytes, "W2");
    reopenedProject.codeInjection = undefined;
    const repairedRom = new NintendoDSRom(await exportModifiedRom(reopenedProject));

    expect(repairedRom.filenames.files).toEqual(retailNames);
    expect(retailNames.map((name) => repairedRom.fileId(name))).toEqual([344, 345, 346]);
  });

  it("repairs legacy PMC layout and root names through the standalone Repair ROM tool", async () => {
    const retailNames = ["skb.narc", "soundstatus.narc", "swan_sound_data.sdat"];
    const romBytes = makeBw2LikeRom(347, new Folder({ files: retailNames, firstId: 344 }));
    const installedProject = makeProject(romBytes, "W2");
    installPmcBytes(installedProject, pmcW2, romBytes);
    const installedBytes = await exportModifiedRom(installedProject);
    const installedRom = new NintendoDSRom(installedBytes);
    const overlayEntry = 344 * 32;

    // A valid PMC ROM must not be mistaken for the generic Frost FNT mismatch.
    const unchanged = repairRomNarcs(installedBytes);
    expect(unchanged.headerRepair).toBeUndefined();
    expect(new NintendoDSRom(unchanged.bytes).filenames.files).toEqual(retailNames);

    const legacyTable = installedRom.arm9OverlayTable.slice();
    writeU32(legacyTable, overlayEntry + 8, PMC_OVERLAY_RESERVED_SIZE);
    writeU32(legacyTable, overlayEntry + 12, 0);
    const legacyBytes = installedRom.save({
      arm9OverlayTable: legacyTable,
      alignFntFirstFileToArm9OverlayCount: true,
    });

    const result = repairRomNarcs(legacyBytes);
    const repairedRom = new NintendoDSRom(result.bytes);
    expect(result.headerRepair?.reasons).toEqual(["legacy_pmc_overlay_layout", "legacy_pmc_root_fnt"]);
    expect(readU32(repairedRom.arm9OverlayTable, overlayEntry + 8)).toBe(PMC_OVERLAY_SIZE);
    expect(readU32(repairedRom.arm9OverlayTable, overlayEntry + 12)).toBe(0x5000);
    expect(repairedRom.filenames.files).toEqual(retailNames);
    expect(retailNames.map((name) => repairedRom.fileId(name))).toEqual([344, 345, 346]);
    expect(repairRomNarcs(result.bytes).headerRepair).toBeUndefined();
  });

  it("places a new PMC overlay after ARM9 data reserved by an earlier patch", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    project.arm9 = new Uint8Array(0x1fb540);

    const result = installPmcBytes(project, pmcW2, romBytes);

    expect(result.overlayBaseAddress).toBe(0x021fb540);
    expect(readU32(project.arm9, 0x7b41c)).toBe(result.overlayBaseAddress + 0x8000);
  });

  it("skips the PMC keep marker when patches already has files before later ROMFS entries", async () => {
    const romBytes = makeBw2LikeRom(
      347,
      new Folder({
        files: ["base.bin"],
        firstId: 344,
        folders: [
          ["patches", new Folder({ files: ["Existing.dll"], firstId: 345 })],
          ["zz_pokeweb_pwan", new Folder({ files: ["pwan.narc"], firstId: 346 })],
        ],
      }),
    );
    const project = makeProject(romBytes, "W2");

    installPmcBytes(project, pmcW2, romBytes);
    expect(project.fileSystem?.additions?.[PMC_PATCHES_KEEP_PATH]).toBeUndefined();

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);

    expect(rom.fileId("patches/Existing.dll")).toBe(345);
    expect(rom.fileId("zz_pokeweb_pwan/pwan.narc")).toBe(346);
    expect(rom.filenames.idOf(PMC_PATCHES_KEEP_PATH)).toBeUndefined();
  });

  it("prunes stale staged PMC keep markers during export for non-tail patches folders", async () => {
    const romBytes = makeBw2LikeRom(
      347,
      new Folder({
        files: ["base.bin"],
        firstId: 344,
        folders: [
          ["patches", new Folder({ files: ["Existing.dll"], firstId: 345 })],
          ["zz_pokeweb_pwan", new Folder({ files: ["pwan.narc"], firstId: 346 })],
        ],
      }),
    );
    const project = makeProject(romBytes, "W2");
    project.fileSystem = {
      replacements: {},
      additions: { [PMC_PATCHES_KEEP_PATH]: new TextEncoder().encode("pokeweb") },
    };

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);

    expect(project.fileSystem.additions?.[PMC_PATCHES_KEEP_PATH]).toBeUndefined();
    expect(rom.fileId("patches/Existing.dll")).toBe(345);
    expect(rom.fileId("zz_pokeweb_pwan/pwan.narc")).toBe(346);
    expect(rom.filenames.idOf(PMC_PATCHES_KEEP_PATH)).toBeUndefined();
  });

  it("inserts new patch DLLs into an existing non-tail patches folder", async () => {
    const romBytes = makeBw2LikeRom(
      347,
      new Folder({
        files: ["base.bin"],
        firstId: 344,
        folders: [
          ["patches", new Folder({ files: ["Existing.dll"], firstId: 345 })],
          ["zz_pokeweb_pwan", new Folder({ files: ["pwan.narc"], firstId: 346 })],
        ],
      }),
    );
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    stageCodeInjectionDll(project, "NewPatch.dll", makeDllFromRpm(pmcW2), "patches");

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    const overlayEntry = 344 * 32;
    const overlayFileId = rom.fileId("overlay/overlay_0344.bin");

    expect(rom.fileId("patches/Existing.dll")).toBe(345);
    expect(rom.fileId("patches/NewPatch.dll")).toBe(346);
    expect(rom.fileId("zz_pokeweb_pwan/pwan.narc")).toBe(347);
    expect(readAscii(rom.getFileByName("patches/NewPatch.dll"), 0, 4)).toBe("DLXF");
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 24)).toBe(overlayFileId);
  });

  it("stages built DLXF patch and library DLLs after PMC is installed", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    const dll = makeDllFromRpm(pmcW2);

    const patch = stageCodeInjectionDll(project, "../My Patch.dll", dll, "patches");
    const library = stageCodeInjectionDll(project, "Helper", dll, "lib");

    expect(patch.path).toBe("patches/My Patch.dll");
    expect(library.path).toBe("lib/Helper.dll");
    expect(listCodeInjectionDlls(project).map((module) => module.path)).toEqual(["patches/My Patch.dll", "lib/Helper.dll"]);

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    expect(readAscii(rom.getFileByName("patches/My Patch.dll"), 0, 4)).toBe("DLXF");
    expect(readAscii(rom.getFileByName("lib/Helper.dll"), 0, 4)).toBe("DLXF");
  });

  it("updates an embedded DLL by file ID when persisted project state no longer holds the ROM bytes", () => {
    const source = new NintendoDSRom(makeBw2LikeRom(
      346,
      new Folder({
        files: ["base.bin"],
        firstId: 344,
        folders: [["patches", new Folder({ files: ["Existing.dll"], firstId: 345 })]],
      }),
    ));
    const oldDll = makeDllFromRpm(pmcW2);
    source.files[345] = oldDll;
    const romBytes = source.save();
    const project = makeProject(romBytes, "W2");
    delete project.originalRomBytes;
    project.codeInjection = {
      pmc: { overlayId: 344, overlayPath: "overlay/overlay_0344.bin" },
    };
    project.fileSystem = {
      replacements: {},
      additions: { "patches/Existing.dll": oldDll },
    };
    const updatedDll = oldDll.slice();
    updatedDll[updatedDll.length - 1] ^= 0x5a;

    stageCodeInjectionDll(project, "Existing.dll", updatedDll, "patches", romBytes);

    expect(project.fileSystem.additions).toEqual({});
    expect(project.fileSystem.replacements[345]).toEqual(updatedDll);
    expect(project.codeInjection.modules?.map((module) => module.path)).toEqual(["patches/Existing.dll"]);
  });

  it("lists DLXF DLLs already present in a reimported ROM filesystem", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    const dll = makeDllFromRpm(pmcW2);
    stageCodeInjectionDll(project, "My Patch.dll", dll, "patches");
    stageCodeInjectionDll(project, "Helper.dll", dll, "lib");

    const exported = await exportModifiedRom(project);
    const reimportedRom = new NintendoDSRom(exported);
    const reimportedProject = makeProject(exported, "W2");
    reimportedProject.codeInjection = detectPmcInstallFromRom(reimportedRom);

    expect(listCodeInjectionDlls(reimportedProject).map((module) => module.path)).toEqual(["lib/Helper.dll", "patches/My Patch.dll"]);
    expect(reimportedProject.codeInjection?.modules?.map((module) => module.path)).toEqual(["lib/Helper.dll", "patches/My Patch.dll"]);
  });

  it("detects White2Upgrade DLLs from staged or reimported code injection modules", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    stageCodeInjectionDll(project, "White2Upgrade.dll", makeDllFromRpm(pmcW2), "patches");

    expect(detectWhite2UpgradeDlls(project)).toBe(true);

    const reimportedRom = new NintendoDSRom(await exportModifiedRom(project));
    const reimportedProject = makeProject(reimportedRom.save(), "W2");
    reimportedProject.codeInjection = detectPmcInstallFromRom(reimportedRom);

    expect(detectWhite2UpgradeDlls(reimportedProject)).toBe(true);
    expect(reimportedProject.codeInjection?.modules?.map((module) => module.path)).toContain("patches/White2Upgrade.dll");
  });

  it("recognizes the bundled single-NPC double battle fix DLL", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);

    expect(detectBundledDoubleBattleFixDll(project)).toBe("unpatched");
    stageCodeInjectionDll(project, "DoubleBattleFixW2.dll", doubleBattleFixW2, "patches");

    expect(detectBundledDoubleBattleFixDll(project)).toBe("patched");
    expect(parseRpm(doubleBattleFixW2, { allowedMagics: ["DLXF"] }).metadata).toMatchObject({ PMCModulePriority: 4 });
  });

  it("bundles and recognizes the White 2 overworld weather runtime", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);

    expect(readAscii(overworldWeatherRuntimeW2, 0, 4)).toBe("DLXF");
    expect(readU32(overworldWeatherRuntimeW2, 4)).toBeGreaterThanOrEqual(0x2ea0);
    const runtime = parseRpm(overworldWeatherRuntimeW2, { allowedMagics: ["DLXF"] });
    expect(new TextDecoder().decode(runtime.code)).toContain("PWTH-W2-RUNTIME-ABI3");
    expect(new TextDecoder().decode(runtime.code)).toContain("3.0.0");
    expect(runtime.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining([
      "PWW_OverworldWeatherRuntimeAbi",
      "PWW_OverworldWeatherRegistryFormat",
      "PWW_OverworldWeatherRuntimeSignature",
      "PWW_WeatherDispatchTable",
      "PWW_ReloadWeatherRegistry",
    ]));
    expect(runtime.symbols.filter((symbol) => (symbol.attributes & 4) !== 0)).toEqual([]);
    expect([...new Set(runtime.relocations
      .filter((relocation) => relocation.target.module !== "base")
      .map((relocation) => relocation.target.module))]).toEqual(["36"]);
    expect(runtime.relocations.filter((relocation) =>
      relocation.target.type === "FULL_COPY" && relocation.target.module === "36",
    ).map((relocation) => relocation.target.address).sort((left, right) => left - right)).toEqual([
      0x02180e0a, 0x0219923c, 0x02199240, 0x02199364, 0x02199368, 0x021993dc,
    ]);
    const zoneSentinelPatch = runtime.symbols.find((symbol) => symbol.name === "FULL_COPY_36_0x2180E0A");
    const setHook = runtime.symbols.find((symbol) => symbol.name === "THUMB_BRANCH_36_0x21991E0");
    const taskStartHook = runtime.symbols.find((symbol) => symbol.name === "THUMB_BRANCH_36_0x2199658");
    const dispatchLiteralPatches = runtime.symbols.filter((symbol) =>
      symbol.name?.startsWith("FULL_COPY_36_0x2199") && symbol.size === 4,
    );
    expect(zoneSentinelPatch).toBeDefined();
    expect(setHook).toBeDefined();
    expect(taskStartHook).toBeDefined();
    expect(dispatchLiteralPatches).toHaveLength(5);
    expect(dispatchLiteralPatches.every((symbol) => (symbol.address & 3) === 0)).toBe(true);
    expect([...runtime.code.subarray(zoneSentinelPatch!.address, zoneSentinelPatch!.address + 4)]).toEqual([0xc0, 0x46, 0xc0, 0x46]);
    expect(readU16(runtime.code, setHook!.address + 18)).toBe(0x0005); // movs r5, r0
    expect(readU16(runtime.code, setHook!.address + 20)).toBe(0x89a8); // ldrh r0, [r5, #12]
    expect(readU16(runtime.code, taskStartHook!.address + 14)).toBe(0x6201); // descriptor is stored before r1 is reused
    expect(readU16(runtime.code, taskStartHook!.address + 18)).toBe(0xbc02); // pop PMC veneer's saved LR
    expect(readU16(runtime.code, taskStartHook!.address + 20)).toBe(0x468e); // return directly to the retail caller
    expect(readU16(runtime.code, taskStartHook!.address + 24)).toBe(0x0001); // movs r1, r0
    expect(readU16(runtime.code, taskStartHook!.address + 26)).toBe(0x3124); // adds r1, #36
    expect(readU16(runtime.code, taskStartHook!.address + 30)).toBe(0x4718); // bx r3 remains outside aligned ABS32 words
    expect(hasU32(runtime.code, 0x021991e9)).toBe(true);
    expect(hasU32(runtime.code, 0x02199661)).toBe(true);
    expect(detectBundledOverworldWeatherRuntime(project)).toBe("unpatched");
    stageCodeInjectionDll(project, OVERWORLD_WEATHER_RUNTIME_W2_FILENAME, overworldWeatherRuntimeW2, "patches");
    expect(detectBundledOverworldWeatherRuntime(project)).toBe("patched");

    const b2Project = makeProject(romBytes, "B2");
    expect(detectBundledOverworldWeatherRuntime(b2Project)).toBe("unsupported");
  });

  it("recognizes bundled BW2 main menu skip DLLs", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);

    expect(detectBundledMainMenuSkipDll(project)).toBe("unpatched");
    stageCodeInjectionDll(project, "MainMenuSkipW2.dll", mainMenuSkipW2, "patches");

    expect(detectBundledMainMenuSkipDll(project)).toBe("patched");
    expect(readAscii(mainMenuSkipB2, 0, 4)).toBe("DLXF");
    expect(readAscii(mainMenuSkipW2, 0, 4)).toBe("DLXF");
    expect([...mainMenuSkipB2]).not.toEqual([...mainMenuSkipW2]);
  });

  it("bundles versioned form-evolution hooks for both BW2 revisions", () => {
    for (const [version, dll, hooks, symbols] of [
      [
        "B2",
        formEvolutionB2,
        ["284:21e355c:THUMB_BRANCH_LINK", "284:21e4e22:THUMB_BRANCH_LINK"],
        { PML_PersonalGetParamSingle: 0x0201ef1c, PokeParty_ChangeForme: 0x0201c864, setChangedPkmSpecies: 0x0201c7b4 },
      ],
      [
        "W2",
        formEvolutionW2,
        ["284:21e359c:THUMB_BRANCH_LINK", "284:21e4e62:THUMB_BRANCH_LINK"],
        { PML_PersonalGetParamSingle: 0x0201ef48, PokeParty_ChangeForme: 0x0201c890, setChangedPkmSpecies: 0x0201c7e0 },
      ],
    ] as const) {
      expect(readAscii(dll, 0, 4)).toBe("DLXF");
      const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
      expect(rpm.metadata).toMatchObject({
        PMCGameID: version,
        PMCModulePriority: 4,
        PMCVersion: "1.0.0",
      });
      expect(rpm.symbols.filter((symbol) => (symbol.attributes & 2) !== 0)).toEqual([]);
      for (const [name, address] of Object.entries(symbols)) {
        const external = rpm.symbols.find((symbol) => symbol.name === name);
        expect(external).toMatchObject({ address, type: "FUNCTION_THM", attributes: expect.any(Number) });
        expect((external!.attributes & 2) !== 0).toBe(false);
        expect((external!.attributes & 4) !== 0).toBe(true);
      }
      expect(externalHooks(dll)).toEqual([...hooks].sort());
    }
  });

  it("prepares the matching BW2 form-evolution runtime only once", async () => {
    for (const [version, expectedDll] of [
      ["B2", formEvolutionB2],
      ["W2", formEvolutionW2],
    ] as const) {
      const project = makeProject(makeBw2LikeRom(), version);

      await withBundledCodeInjectionFetch(async () => {
        const first = await prepareBw2FormEvolutionCodeInjection(project);
        const second = await prepareBw2FormEvolutionCodeInjection(project);

        expect(first).toMatchObject({
          path: `patches/FormEvolution${version}.dll`,
          fileName: `FormEvolution${version}.dll`,
          target: "patches",
          gameId: version,
          version: "1.0.0",
        });
        expect(second).toEqual(first);
        expect(getPmcInstallStatus(project)).toMatchObject({ installed: true, gameId: version });
        expect(detectBundledFormEvolutionDll(project)).toBe("patched");
        expect(project.fileSystem?.additions?.[`patches/FormEvolution${version}.dll`]).toEqual(expectedDll);
        expect(listCodeInjectionDlls(project).filter((module) => module.fileName === `FormEvolution${version}.dll`)).toHaveLength(1);

        const exportedRom = new NintendoDSRom(await exportModifiedRom(project));
        const reimportedProject = makeProject(exportedRom.save(), version);
        reimportedProject.codeInjection = detectPmcInstallFromRom(exportedRom);
        expect(detectBundledFormEvolutionDll(reimportedProject)).toBe("patched");
      });
    }
  });

  it("prepares BW2 Test Battle code injection with bundled PMC and main menu skip", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "B2");

    await withBundledCodeInjectionFetch(async () => {
      const result = await prepareBw2TestBattleCodeInjection(project);

      expect(result).toMatchObject({ path: "patches/MainMenuSkipB2.dll", fileName: "MainMenuSkipB2.dll", target: "patches" });
      expect(getPmcInstallStatus(project)).toMatchObject({ installed: true, overlayId: 344, version: "13.2.4", gameId: "B2" });
      expect(detectBundledMainMenuSkipDll(project)).toBe("patched");
      expect(project.fileSystem?.additions?.["patches/MainMenuSkipB2.dll"]).toEqual(mainMenuSkipB2);

      const exported = new NintendoDSRom(await exportModifiedRom(project));
      expect(readAscii(exported.getFileByName("patches/MainMenuSkipB2.dll"), 0, 4)).toBe("DLXF");
      expect(new TextDecoder().decode(exported.getFileByName(PMC_OVERLAY_ID_PATH))).toBe("344");
    });
  });

  it("does not auto-stage the bundled main menu skip for White2Upgrade Test Battle ROMs", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    stageCodeInjectionDll(project, "White2Upgrade.dll", makeDllFromRpm(pmcW2), "patches");

    await withBundledCodeInjectionFetch(async () => {
      const result = await prepareBw2TestBattleCodeInjection(project);

      expect(result).toBeUndefined();
      expect(detectWhite2UpgradeDlls(project)).toBe(true);
      expect(detectBundledMainMenuSkipDll(project)).toBe("unpatched");
      expect(project.fileSystem?.additions?.["patches/MainMenuSkipW2.dll"]).toBeUndefined();
    });
  });

  it("rejects Windows DLLs and unconverted RPM modules for user patch upload", () => {
    expect(() => validateCodeInjectionDll(Uint8Array.of(0x4d, 0x5a, 0, 0))).toThrow(/Windows DLL/u);
    expect(() => validateCodeInjectionDll(pmcW2)).toThrow(/RPM module/u);
  });
});

function makeProject(originalRomBytes: Uint8Array, baseVersion: "B2" | "W2"): ProjectState {
  return {
    originalRomBytes,
    session: {
      romName: "test",
      baseVersion,
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: originalRomBytes.length },
    arm9: new Uint8Array(0x80000),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeRelocationRpm(type: "FUNCTION_ARM" | "FUNCTION_THM", address: number) {
  return {
    code: new Uint8Array(),
    bssSize: 0,
    baseAddress: 0,
    symbols: [{ name: "target", size: 4, address, type, attributes: 1 << 2 }],
    relocations: [{ target: { module: "base", address: 0, type: "THUMB_BRANCH_LINK" as const }, sourceSymbolIndex: 0 }],
    metadata: {},
  };
}

function makeBw2LikeRom(fileCount = 345, filenames = new Folder({ files: ["base.bin"], firstId: 344 })): Uint8Array {
  const files = Array.from({ length: fileCount }, (_value, index) => Uint8Array.of(index & 0xff));
  const fnt = saveFnt(filenames);
  const overlayTable = new Uint8Array(344 * 32);
  writeU32(overlayTable, 0, 0);
  writeU32(overlayTable, 4, 0x021f8000);
  writeU32(overlayTable, 8, 0x2000);
  writeU32(overlayTable, 24, 0);

  const arm9 = new Uint8Array(0x80000);
  const out = new Uint8Array(0x100000);
  out.set([0x54, 0x45, 0x53, 0x54], 0);
  out.set([0x49, 0x52, 0x44, 0x4f], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x28, 0x02000000);
  writeU32(out, 0x2c, arm9.length);
  writeU32(out, 0x30, 0x84000);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x85000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x85200);
  writeU32(out, 0x4c, files.length * 8);
  writeU32(out, 0x50, 0x86000);
  writeU32(out, 0x54, overlayTable.length);
  writeU32(out, 0x58, 0x88c00);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set(arm9, 0x4000);
  out.set([5, 6, 7, 8], 0x84000);
  out.set(fnt, 0x85000);
  out.set(overlayTable, 0x86000);
  let cursor = 0x88e00;
  files.forEach((file, index) => {
    cursor = align(cursor, 0x200);
    writeU32(out, 0x85200 + index * 8, cursor);
    out.set(file, cursor);
    cursor += file.length;
    writeU32(out, 0x85200 + index * 8 + 4, cursor);
  });
  writeU32(out, 0x80, cursor);
  return out.slice(0, align(cursor, 4));
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

function hasU32(bytes: Uint8Array, value: number): boolean {
  for (let offset = 0; offset + 4 <= bytes.length; offset += 2) {
    if (readU32(bytes, offset) === value) return true;
  }
  return false;
}

function duplicateFntFileIds(fnt: Uint8Array): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  const stack: number[] = [0];
  while (stack.length > 0) {
    const folderOffset = stack.shift()!;
    let fileId = readU16(fnt, folderOffset + 4);
    let offset = readU32(fnt, folderOffset);
    while (fnt[offset] !== 0) {
      const length = fnt[offset] & 0x7f;
      const isFolder = (fnt[offset] & 0x80) !== 0;
      offset += length + 1;
      if (isFolder) {
        stack.push((readU16(fnt, offset) & 0x0fff) * 8);
        offset += 2;
      } else {
        if (seen.has(fileId)) duplicates.add(fileId);
        seen.add(fileId);
        fileId += 1;
      }
    }
  }
  return [...duplicates].sort((a, b) => a - b);
}

function makeDllFromRpm(rpm: Uint8Array): Uint8Array {
  const dll = rpm.slice();
  dll.set([0x44, 0x4c, 0x58, 0x46], 0);
  return dll;
}

function externalHooks(bytes: Uint8Array): string[] {
  return parseRpm(bytes, { allowedMagics: ["DLXF"] }).relocations
    .filter((relocation) => relocation.target.module !== "base")
    .map((relocation) => `${relocation.target.module}:${relocation.target.address.toString(16)}:${relocation.target.type}`)
    .sort();
}

async function withBundledCodeInjectionFetch(run: () => Promise<void>): Promise<void> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
    const fileName = url.pathname.split("/").pop();
    if (fileName === "PMC_B2.rpm") return new Response(pmcB2);
    if (fileName === "PMC_W2.rpm") return new Response(pmcW2);
    if (fileName === "MainMenuSkipB2.dll") return new Response(mainMenuSkipB2);
    if (fileName === "MainMenuSkipW2.dll") return new Response(mainMenuSkipW2);
    if (fileName === "FormEvolutionB2.dll") return new Response(formEvolutionB2);
    if (fileName === "FormEvolutionW2.dll") return new Response(formEvolutionW2);
    return new Response(undefined, { status: 404 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}
