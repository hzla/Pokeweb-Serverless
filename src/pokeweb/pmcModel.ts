import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { cloneFolder, type Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { getStreamedBgmConfigs, type ProjectState } from "./projectStore";
import {
  OVERWORLD_WEATHER_REGISTRY_PATH,
  serializeProjectOverworldWeatherRegistry,
} from "./overworldWeatherRegistry";
import {
  cloneRpm,
  createCodeOnlyRpm,
  createSymbolOnlyRpm,
  findRpmSymbol,
  parseRpm,
  setRpmBaseAddress,
  updateRpmCodeImageForBase,
  writeRelocationDataByType,
  writeRpm,
  type RpmModule,
} from "./rpm";
import italianPmcContract from "../../runtime/following-pokemon/italy-pmc-contract.json";

export type PmcInstallStatus =
  | { installed: false; supported: boolean; message: string }
  | { installed: true; supported: boolean; overlayId: number; overlayBaseAddress?: number; version?: string; gameId?: string; message: string };

export type PmcInstallResult = {
  overlayId: number;
  overlayBaseAddress: number;
  version?: string;
  gameId?: string;
  symbolPath: string;
};

export type CodeInjectionDllTarget = "patches" | "lib";

type CodeInjectionModule = NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]>[number];
type OriginalRomDllCacheEntry = {
  originalRomBytes: Uint8Array;
  modules: CodeInjectionModule[];
};

const originalRomDllCache = new WeakMap<ProjectState, OriginalRomDllCacheEntry>();

export type CodeInjectionDllInstallResult = {
  path: string;
  fileName: string;
  target: CodeInjectionDllTarget;
  version?: string;
  gameId?: string;
};

export const PMC_OVERLAY_SIZE = 0x3000;
export const PMC_OVERLAY_RESERVED_SIZE = 0x8000;
export const PMC_OVERLAY_ID_PATH = "codeinjection/pmc_overlay.txt";
export const PMC_RPM_UID = "PMC.rpm";
export const PMC_PATCHES_KEEP_PATH = "patches/.pokeweb_keep";
export const PMC_SYMBOL_PATH = "codeinjection/RPMSYM-PMC.rpm";
export const WHITE2UPGRADE_DLL_FILENAMES = new Set(["white2upgrade.dll"]);

const GEN5_RETAIL_ROOT_FILES: Record<"BW" | "BW2", { firstId: number; names: string[] }> = {
  BW: {
    firstId: 237,
    names: ["gfl_font.dat", "skb.narc", "soundstatus.narc", "titledemo.narc", "wb_sound_data.sdat"],
  },
  BW2: {
    firstId: 344,
    names: ["skb.narc", "soundstatus.narc", "swan_sound_data.sdat"],
  },
};

const PMC_B2_URL = new URL("../assets/codeinjection/PMC_B2.rpm", import.meta.url);
const PMC_W2_URL = new URL("../assets/codeinjection/PMC_W2.rpm", import.meta.url);
const PMC_W2I_URL = new URL("../assets/codeinjection/PMC_W2I.rpm", import.meta.url);
const DOUBLE_BATTLE_FIX_B2_URL = new URL("../assets/codeinjection/DoubleBattleFixB2.dll", import.meta.url);
const DOUBLE_BATTLE_FIX_W2_URL = new URL("../assets/codeinjection/DoubleBattleFixW2.dll", import.meta.url);
const MAIN_MENU_SKIP_B2_URL = new URL("../assets/codeinjection/MainMenuSkipB2.dll", import.meta.url);
const MAIN_MENU_SKIP_W2_URL = new URL("../assets/codeinjection/MainMenuSkipW2.dll", import.meta.url);
const FORM_EVOLUTION_B2_URL = new URL("../assets/codeinjection/FormEvolutionB2.dll", import.meta.url);
const FORM_EVOLUTION_W2_URL = new URL("../assets/codeinjection/FormEvolutionW2.dll", import.meta.url);
const BGM_TOGGLE_B2_URL = new URL("../assets/codeinjection/BgmToggleB2.dll", import.meta.url);
const BGM_TOGGLE_W2_URL = new URL("../assets/codeinjection/BgmToggleW2.dll", import.meta.url);
const OVERWORLD_WEATHER_RUNTIME_W2_URL = new URL("../assets/codeinjection/PokewebOverworldWeatherW2.dll", import.meta.url);

const DOUBLE_BATTLE_FIX_FILENAMES: Record<"B2" | "W2", string> = {
  B2: "DoubleBattleFixB2.dll",
  W2: "DoubleBattleFixW2.dll",
};

const MAIN_MENU_SKIP_FILENAMES: Record<"B2" | "W2", string> = {
  B2: "MainMenuSkipB2.dll",
  W2: "MainMenuSkipW2.dll",
};

const FORM_EVOLUTION_FILENAMES: Record<"B2" | "W2", string> = {
  B2: "FormEvolutionB2.dll",
  W2: "FormEvolutionW2.dll",
};

const BGM_TOGGLE_FILENAMES: Record<"B2" | "W2", string> = {
  B2: "BgmToggleB2.dll",
  W2: "BgmToggleW2.dll",
};

const BGM_RUNTIME_CONFIG_HASH = 0x59ce771e;
const BGM_RUNTIME_CONFIG_MAGIC = 0x53424750;
const BGM_RUNTIME_CONFIG_MARKER = 0x32474250;
const BGM_RUNTIME_CONFIG_SIZE = 32;
const BGM_RUNTIME_ENTRY_SIZE = 10;
const BGM_RUNTIME_HOOK_BYTES: Record<"B2" | "W2", Array<{ address: number; bytes: number[] }>> = {
  B2: [
    { address: 0x02005336, bytes: [0x00, 0xf0, 0x6f, 0xfc] },
    { address: 0x02005e02, bytes: [0xff, 0xf7, 0xc9, 0xff] },
    { address: 0x02005e62, bytes: [0x65, 0xf0, 0xbb, 0xff] },
    { address: 0x02005eb0, bytes: [0x65, 0xf0, 0xd8, 0xff] },
    { address: 0x02005fa2, bytes: [0x65, 0xf0, 0x8d, 0xff] },
    { address: 0x0206dc58, bytes: [0xff, 0xf7, 0x40, 0xfa] },
  ],
  W2: [
    { address: 0x02005336, bytes: [0x00, 0xf0, 0x6f, 0xfc] },
    { address: 0x02005e02, bytes: [0xff, 0xf7, 0xc9, 0xff] },
    { address: 0x02005e62, bytes: [0x65, 0xf0, 0xd1, 0xff] },
    { address: 0x02005eb0, bytes: [0x65, 0xf0, 0xee, 0xff] },
    { address: 0x02005fa2, bytes: [0x65, 0xf0, 0xa3, 0xff] },
    { address: 0x0206dc84, bytes: [0xff, 0xf7, 0x40, 0xfa] },
  ],
};

export type BgmRuntimeMapping = {
  targetSequenceId: number;
  streamId: number;
  originalSequenceFileId: number;
  shadowFileId: number;
  streamFileId: number;
};

export type BgmRuntimeConfig = BgmRuntimeMapping & {
  shortcutEnabled: boolean;
  streamedBgmEnabled: boolean;
  mappings?: BgmRuntimeMapping[];
  abiVersion?: number;
};

export const OVERWORLD_WEATHER_RUNTIME_W2_FILENAME = "PokewebOverworldWeatherW2.dll";
const OVERWORLD_WEATHER_RUNTIME_W2_SIGNATURE = "PWTH-W2-RUNTIME-ABI5";

type Bw1Version = "B" | "W";

type Bw1PmcLayout = {
  overlayId: number;
  overlayBaseExtra: number;
  bootFsInitAddress: number;
  bytePatchAddress: number;
  hookTargets: {
    heapStart: number;
    overlayMaximum: number;
    overlayLoad: number;
    overlayUnload: number;
  };
  symbols: Record<string, { address: number; type: "FUNCTION_ARM" | "FUNCTION_THM" | "VALUE" }>;
};

const BW1_PMC_LAYOUTS: Record<Bw1Version, Bw1PmcLayout> = {
  W: {
    overlayId: 237,
    overlayBaseExtra: 0x4000,
    bootFsInitAddress: 0x02075cc4,
    bytePatchAddress: 0x02078d8f,
    hookTargets: {
      heapStart: 0x0208675c,
      overlayMaximum: 0x02078ec0,
      overlayLoad: 0x02034b94,
      overlayUnload: 0x02034a68,
    },
    symbols: {
      fs_normalize_path: { address: 0x02078090, type: "FUNCTION_ARM" },
      fs_call_syscmd: { address: 0x02077d98, type: "FUNCTION_ARM" },
      memmove: { address: 0x0209237c, type: "FUNCTION_ARM" },
      memcpy: { address: 0x0209235c, type: "FUNCTION_ARM" },
      strtoul: { address: 0x02095ec4, type: "FUNCTION_ARM" },
      GFLAppInit: { address: 0x0200545d, type: "FUNCTION_THM" },
      os_MemRegionStarts: { address: 0x02fffda0, type: "VALUE" },
      romfs_fseek: { address: 0x02078b5c, type: "FUNCTION_ARM" },
      sys_mount_overlay: { address: 0x02078ec8, type: "FUNCTION_ARM" },
      romfs_fgetsize: { address: 0x02078aac, type: "FUNCTION_ARM" },
      sys_unload_overlay: { address: 0x020792d0, type: "FUNCTION_ARM" },
      sys_uncomp_blz: { address: 0x02004df4, type: "FUNCTION_ARM" },
      memset: { address: 0x020923c8, type: "FUNCTION_ARM" },
      cp15_flushDC: { address: 0x02086308, type: "FUNCTION_ARM" },
      hw_isDSi: { address: 0x02085d54, type: "FUNCTION_ARM" },
      os_MemRegionEnds: { address: 0x02fffdc4, type: "VALUE" },
      fs_call_filecmd: { address: 0x02079c14, type: "FUNCTION_ARM" },
      romfs_fclose: { address: 0x02078a98, type: "FUNCTION_ARM" },
      romfs_fread: { address: 0x02078b88, type: "FUNCTION_ARM" },
      romfs_fopen_id: { address: 0x020789bc, type: "FUNCTION_ARM" },
      sys_load_overlay: { address: 0x0207927c, type: "FUNCTION_ARM" },
      sys_get_overlay_size: { address: 0x02078cc8, type: "FUNCTION_ARM" },
      strlen: { address: 0x02094794, type: "FUNCTION_ARM" },
      sys_read_overlay_header: { address: 0x02078d4c, type: "FUNCTION_ARM" },
      finit: { address: 0x020788c4, type: "FUNCTION_ARM" },
    },
  },
  B: {
    overlayId: 237,
    overlayBaseExtra: 0x4000,
    bootFsInitAddress: 0x02075cac,
    bytePatchAddress: 0x02078d77,
    hookTargets: {
      heapStart: 0x02086744,
      overlayMaximum: 0x02078ea8,
      overlayLoad: 0x02034b7c,
      overlayUnload: 0x02034a50,
    },
    symbols: {
      fs_normalize_path: { address: 0x02078078, type: "FUNCTION_ARM" },
      fs_call_syscmd: { address: 0x02077d80, type: "FUNCTION_ARM" },
      memmove: { address: 0x02092364, type: "FUNCTION_ARM" },
      memcpy: { address: 0x02092344, type: "FUNCTION_ARM" },
      strtoul: { address: 0x02095eac, type: "FUNCTION_ARM" },
      GFLAppInit: { address: 0x0200545d, type: "FUNCTION_THM" },
      os_MemRegionStarts: { address: 0x02fffda0, type: "VALUE" },
      romfs_fseek: { address: 0x02078b44, type: "FUNCTION_ARM" },
      sys_mount_overlay: { address: 0x02078eb0, type: "FUNCTION_ARM" },
      romfs_fgetsize: { address: 0x02078a94, type: "FUNCTION_ARM" },
      sys_unload_overlay: { address: 0x020792b8, type: "FUNCTION_ARM" },
      sys_uncomp_blz: { address: 0x02004df4, type: "FUNCTION_ARM" },
      memset: { address: 0x020923b0, type: "FUNCTION_ARM" },
      cp15_flushDC: { address: 0x020862f0, type: "FUNCTION_ARM" },
      hw_isDSi: { address: 0x02085d3c, type: "FUNCTION_ARM" },
      os_MemRegionEnds: { address: 0x02fffdc4, type: "VALUE" },
      fs_call_filecmd: { address: 0x02079bfc, type: "FUNCTION_ARM" },
      romfs_fclose: { address: 0x02078a80, type: "FUNCTION_ARM" },
      romfs_fread: { address: 0x02078b70, type: "FUNCTION_ARM" },
      romfs_fopen_id: { address: 0x020789a4, type: "FUNCTION_ARM" },
      sys_load_overlay: { address: 0x02079264, type: "FUNCTION_ARM" },
      sys_get_overlay_size: { address: 0x02078cb0, type: "FUNCTION_ARM" },
      strlen: { address: 0x0209477c, type: "FUNCTION_ARM" },
      sys_read_overlay_header: { address: 0x02078d34, type: "FUNCTION_ARM" },
      finit: { address: 0x020788ac, type: "FUNCTION_ARM" },
    },
  },
};

export async function installBundledPmc(project: ProjectState): Promise<PmcInstallResult> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing PMC.");
  const idCode = readAscii(romBytes, 12, 4);
  return installPmcBytes(project, await loadBundledPmcBytes(project.session.baseVersion, idCode), romBytes);
}

export async function loadBundledPmcBytes(version: ProjectState["session"]["baseVersion"], idCode?: string): Promise<Uint8Array> {
  const response = await fetch(idCode === "IRDI" ? PMC_W2I_URL : version === "B2" ? PMC_B2_URL : PMC_W2_URL);
  if (!response.ok) throw new Error(`Could not load bundled PMC binary (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function validateItalianPmcInstallSites(arm9: Uint8Array, rom: NintendoDSRom, romBytes: Uint8Array): void {
  if (rom.idCode !== italianPmcContract.target.gameCode || romBytes[30] !== italianPmcContract.target.revision)
    throw new Error("The Italian PMC loader requires IRDI revision 0.");
  for (const site of [...italianPmcContract.hooks, ...italianPmcContract.imports]) {
    const offset = site.address - rom.arm9RamAddress;
    const expected = site.expectedHex;
    if (offset < 0 || offset + expected.length / 2 > arm9.length ||
        Array.from(arm9.subarray(offset, offset + expected.length / 2), byte => byte.toString(16).padStart(2, "0")).join("") !== expected)
      throw new Error(`Italian PMC binary signature mismatch: ${site.id}`);
  }
}

export function installPmcBytes(project: ProjectState, rpmBytes: Uint8Array, romBytes: Uint8Array): PmcInstallResult {
  if (project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") {
    throw new Error("Bundled PMC installation is only available for Gen V Black/White ROMs.");
  }
  const rom = new NintendoDSRom(romBytes);
  const rpm = cloneRpm(parseRpm(rpmBytes));
  const activeArm9 = project.arm9.length > 0 ? project.arm9 : decompressCode(rom.arm9);
  const existingOverlayId = readPmcOverlayId(project, rom);
  const bw1Version = project.session.baseRom === "BW" && (project.session.baseVersion === "B" || project.session.baseVersion === "W")
    ? project.session.baseVersion
    : undefined;
  if (bw1Version) {
    retargetPmcForBw1(rpm, bw1Version);
    validateBw1PmcInstallSites(activeArm9, rom.arm9RamAddress, bw1Version, existingOverlayId !== undefined);
  }
  if (rom.idCode === "IRDI" && existingOverlayId === undefined) validateItalianPmcInstallSites(activeArm9, rom, romBytes);
  const gameId = stringMeta(rpm, "PMCGameID");
  const version = stringMeta(rpm, "PMCVersion");
  const expectedGameId = rom.idCode === "IRDI" ? "W2I" : project.session.baseVersion;
  if (gameId && gameId !== expectedGameId) throw new Error(`This PMC binary is for ${gameId}, but the loaded ROM is ${expectedGameId}.`);

  const overlayId = existingOverlayId ?? rom.arm9OverlayTable.length / 32;
  if (project.session.baseRom === "BW2" && overlayId !== 344) {
    throw new Error(`BW2 PMC requires overlay 344, but the selected overlay is ${overlayId}. The ROM may already contain an unrecognized PMC installation; refusing to add a second loader.`);
  }
  if (bw1Version && overlayId !== BW1_PMC_LAYOUTS[bw1Version].overlayId) {
    throw new Error(`BW1 PMC requires overlay 237, but the next available overlay is ${overlayId}.`);
  }
  const existingEntry = findOverlayEntry(rom.arm9OverlayTable, overlayId);
  const previousMaxOverlayEnd = maxOverlayEnd(rom.arm9OverlayTable);
  const arm9ReservedEnd = align(rom.arm9RamAddress + activeArm9.length, 0x20);
  const newOverlayFloor = previousMaxOverlayEnd + (bw1Version ? BW1_PMC_LAYOUTS[bw1Version].overlayBaseExtra : 0);
  const overlayBaseAddress = existingEntry
    ? readU32(rom.arm9OverlayTable, existingEntry + 4)
    : Math.max(newOverlayFloor, arm9ReservedEnd);
  const heapStart = Math.max(previousMaxOverlayEnd, arm9ReservedEnd, overlayBaseAddress + PMC_OVERLAY_RESERVED_SIZE);
  const overlayPath = overlayPathForId(overlayId);

  const heapSymbol =
    findRpmSymbol(rpm, (symbol) => symbol.name === "FULL_COPY_ARM9_0x0207B41C_ResizeMemoryForOvl344") ??
    findRpmSymbol(rpm, (symbol) => Boolean(symbol.name?.endsWith("AdjustHeapStart")));
  if (!heapSymbol) throw new Error("Could not find PMC heap-start patch symbol.");
  writeU32(rpm.code, heapSymbol.address, heapStart);

  setRpmBaseAddress(rpm, overlayBaseAddress);
  updateRpmCodeImageForBase(rpm);
  rpm.metadata.SymbolFile = "RPMSYM-PMC.rpm";
  applyExternalRelocations(project, rom, rpm);
  if (bw1Version) applyBw1PmcBytePatch(project.arm9, rom.arm9RamAddress, bw1Version);

  const symbolRpm = createSymbolOnlyRpm(rpm);
  const codeRpm = createCodeOnlyRpm(rpm);
  const symbolBytes = writeRpm(symbolRpm);
  const codeBytes = writeRpm(codeRpm, { writeBss: true });
  const overlayBytes = buildPmcOverlay(overlayBaseAddress, codeBytes);

  stageRomPath(project, rom, PMC_OVERLAY_ID_PATH, asciiBytes(String(overlayId)));
  stageRomPath(project, rom, PMC_SYMBOL_PATH, symbolBytes);
  stageRomPath(project, rom, overlayPath, overlayBytes);
  stagePatchesKeepPath(project, rom);

  project.codeInjection ??= {};
  project.codeInjection.pmc = {
    overlayId,
    overlayBaseAddress,
    overlayPath,
    version,
    gameId,
    symbolPath: PMC_SYMBOL_PATH,
  };

  recordGenericChange(project, "code_injection", `PMC installed into overlay ${overlayId}${version ? ` (${version})` : ""}.`, "PMC", {
    key: "code-injection:pmc",
  });

  return { overlayId, overlayBaseAddress, version, gameId, symbolPath: PMC_SYMBOL_PATH };
}

export async function stageBundledDoubleBattleFixDll(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  if (project.session.baseRom !== "BW2") {
    throw new Error("The bundled single-NPC double battle fix currently requires the BW2 PMC runtime.");
  }
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error(`No bundled double battle fix is available for ${project.session.baseVersion}.`);
  }

  const url = project.session.baseVersion === "B2" ? DOUBLE_BATTLE_FIX_B2_URL : DOUBLE_BATTLE_FIX_W2_URL;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load bundled double battle fix (${response.status})`);

  const fileName = DOUBLE_BATTLE_FIX_FILENAMES[project.session.baseVersion];
  const result = stageCodeInjectionDll(project, fileName, new Uint8Array(await response.arrayBuffer()), "patches");
  recordGenericChange(project, "code_injection", `${fileName} staged for single-NPC double trainer battles.`, "Double Battle Fix", {
    key: "code-injection:double-battle-fix",
  });
  return result;
}

export async function installBundledOverworldWeatherRuntime(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  if (project.session.baseRom !== "BW2" || project.session.baseVersion !== "W2") {
    throw new Error("The bundled overworld weather runtime currently requires stock US White 2 (IRDO).");
  }
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing the overworld weather runtime.");
  if (!getPmcInstallStatus(project).installed) {
    adoptExistingPmcInstall(project, romBytes);
    if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  }

  const response = await fetch(OVERWORLD_WEATHER_RUNTIME_W2_URL);
  if (!response.ok) throw new Error(`Could not load bundled overworld weather runtime (${response.status})`);
  const result = stageCodeInjectionDll(
    project,
    OVERWORLD_WEATHER_RUNTIME_W2_FILENAME,
    new Uint8Array(await response.arrayBuffer()),
    "patches",
    romBytes,
  );
  for (const effect of project.overworldWeather?.customEffects ?? []) {
    if (effect.clone) effect.clone.runtimeReady = true;
  }
  stageRomPath(
    project,
    new NintendoDSRom(romBytes),
    OVERWORLD_WEATHER_REGISTRY_PATH,
    serializeProjectOverworldWeatherRegistry(project),
  );
  recordGenericChange(
    project,
    "code_injection",
    `${OVERWORLD_WEATHER_RUNTIME_W2_FILENAME} and its 49-slot PWTH registry were staged for six-bit overworld weather IDs.`,
    "Overworld Weather Runtime",
    { key: "code-injection:overworld-weather" },
  );
  return result;
}

/**
 * Restore missing serialized PMC state from the loaded ROM before a feature
 * considers installing Pokeweb's bundled runtime. Older CTRMap/PMC installs
 * commonly keep the overlay binary in an anonymous FAT slot referenced only
 * by the overlay table. When the marker is absent, validate the executable's
 * metadata and startup wrapper too; do not replace that installation merely
 * because it lacks Pokeweb's marker or overlay filename.
 */
export function adoptExistingPmcInstall(project: ProjectState, romBytes: Uint8Array): boolean {
  const detected = detectPmcInstallFromRom(new NintendoDSRom(romBytes));
  if (!detected?.pmc) return false;

  const existingModules = project.codeInjection?.modules ?? [];
  const modules = [...(detected.modules ?? [])];
  for (const module of existingModules) {
    const index = modules.findIndex((candidate) => candidate.path.toLowerCase() === module.path.toLowerCase());
    if (index === -1) modules.push(module);
    else modules[index] = module;
  }

  project.codeInjection = {
    ...project.codeInjection,
    pmc: detected.pmc,
    modules: modules.length > 0 ? modules : undefined,
  };
  return true;
}

export async function syncBundledOverworldWeatherRegistry(project: ProjectState): Promise<void> {
  if (detectBundledOverworldWeatherRuntime(project) !== "patched") {
    throw new Error("Install the bundled White 2 overworld weather runtime before writing PWTH registry entries.");
  }
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before updating the overworld weather registry.");
  stageRomPath(
    project,
    new NintendoDSRom(romBytes),
    OVERWORLD_WEATHER_REGISTRY_PATH,
    serializeProjectOverworldWeatherRegistry(project),
  );
}

export async function stageBundledMainMenuSkipDll(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  if (project.session.baseRom !== "BW2") {
    throw new Error("The bundled main menu skip patch currently requires the BW2 PMC runtime.");
  }
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error(`No bundled main menu skip patch is available for ${project.session.baseVersion}.`);
  }

  const url = project.session.baseVersion === "B2" ? MAIN_MENU_SKIP_B2_URL : MAIN_MENU_SKIP_W2_URL;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load bundled main menu skip patch (${response.status})`);

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before preparing Test Battle startup skipping.");
  const fileName = MAIN_MENU_SKIP_FILENAMES[project.session.baseVersion];
  const result = stageCodeInjectionDll(project, fileName, new Uint8Array(await response.arrayBuffer()), "patches", romBytes);
  recordGenericChange(project, "code_injection", `${fileName} staged for Test Battle startup skipping.`, "Main Menu Skip", {
    key: "code-injection:main-menu-skip",
  });
  return result;
}

export async function prepareBw2TestBattleCodeInjection(project: ProjectState): Promise<CodeInjectionDllInstallResult | undefined> {
  if (project.session.baseRom !== "BW2") return undefined;
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error(`No bundled main menu skip patch is available for ${project.session.baseVersion}.`);
  }
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) return undefined;
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  return stageBundledMainMenuSkipDll(project);
}

export async function prepareBw2FormEvolutionCodeInjection(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  if (project.session.baseRom !== "BW2" || (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2")) {
    throw new Error("Safe personal-form evolution targets currently require a Black 2 or White 2 ROM.");
  }

  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);

  const version = project.session.baseVersion;
  const fileName = FORM_EVOLUTION_FILENAMES[version];
  const path = `patches/${fileName}`;
  const existing = listCodeInjectionDlls(project).find((module) => module.path.toLowerCase() === path.toLowerCase());
  if (existing) return existing;

  const response = await fetch(version === "B2" ? FORM_EVOLUTION_B2_URL : FORM_EVOLUTION_W2_URL);
  if (!response.ok) throw new Error(`Could not load bundled ${version} form-evolution runtime (${response.status})`);
  const result = stageCodeInjectionDll(project, fileName, new Uint8Array(await response.arrayBuffer()), "patches");
  recordGenericChange(
    project,
    "code_injection",
    `${fileName} staged so evolution targets can safely reference personal-form IDs.`,
    "Form Evolution Runtime",
    { key: "code-injection:form-evolution" },
  );
  return result;
}

export async function installBundledBgmToggleDll(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  if (project.session.baseRom !== "BW2" || (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2")) {
    throw new Error("The bundled background-music toggle requires a US Black 2 or White 2 ROM.");
  }

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing the background-music toggle.");
  assertBundledBgmRuntimeCompatibility(project, romBytes);
  if (!getPmcInstallStatus(project).installed) {
    adoptExistingPmcInstall(project, romBytes);
    if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  }

  const version = project.session.baseVersion;
  const fileName = BGM_TOGGLE_FILENAMES[version];
  const runtimePath = `patches/${fileName}`;
  const streamed = getStreamedBgmConfigs(project);
  const stagedRuntime = Object.entries(project.fileSystem?.additions ?? {}).find(([path]) => path.toLowerCase() === runtimePath.toLowerCase())?.[1];
  const sourceRom = new NintendoDSRom(romBytes, { fileData: "view" });
  const existingRuntimeFileId = sourceRom.filenames.idOf(runtimePath);
  const existingRuntime = stagedRuntime ?? (existingRuntimeFileId === undefined ? undefined : getRomFileBytes(project, sourceRom, existingRuntimeFileId));
  const importedConfig = existingRuntime ? readBgmRuntimeConfig(existingRuntime) : undefined;
  if (existingRuntime && !importedConfig) throw new Error("The installed music runtime has an unreadable configuration; cannot safely replace it.");
  const mappings = streamed.length ? streamed : importedConfig?.mappings ?? [];
  const bytes = await configureBundledBgmRuntime(version, {
    shortcutEnabled: true,
    mappings,
  });
  const result = stageCodeInjectionDll(project, fileName, bytes, "patches", romBytes);
  streamed.forEach((mapping) => { mapping.toggleEnabled = true; });
  recordGenericChange(
    project,
    "code_injection",
    `${fileName} staged to mute or unmute the native background-music channel with L + R + Select.`,
    "Background Music Toggle",
    { key: "code-injection:bgm-toggle" },
  );
  return result;
}

export function assertBundledBgmRuntimeCompatibility(project: ProjectState, romBytes: Uint8Array): void {
  const version = project.session.baseVersion;
  if (version !== "B2" && version !== "W2") throw new Error("The background-music runtime supports US Black 2 and White 2 only.");
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  const expectedId = version === "B2" ? "IREO" : "IRDO";
  if (rom.idCode !== expectedId) throw new Error(`The loaded ROM is ${rom.idCode}, not the supported ${expectedId} revision.`);
  const arm9 = project.arm9.length > 0 ? project.arm9 : decompressCode(rom.arm9);
  for (const hook of BGM_RUNTIME_HOOK_BYTES[version]) {
    const offset = hook.address - rom.arm9RamAddress;
    const actual = arm9.subarray(offset, offset + hook.bytes.length);
    if (actual.length !== hook.bytes.length || hook.bytes.some((value, index) => actual[index] !== value)) {
      throw new Error(`The ARM9 background-music hook at 0x${hook.address.toString(16)} is incompatible with this ROM.`);
    }
  }
}

export async function configureBundledBgmRuntime(
  version: "B2" | "W2",
  config: BgmRuntimeConfig | { shortcutEnabled: boolean; mappings: BgmRuntimeMapping[] },
): Promise<Uint8Array> {
  const response = await fetch(version === "B2" ? BGM_TOGGLE_B2_URL : BGM_TOGGLE_W2_URL);
  if (!response.ok) throw new Error(`Could not load bundled ${version} background-music runtime (${response.status})`);
  const rpm = parseRpm(new Uint8Array(await response.arrayBuffer()), { allowedMagics: ["DLXF"] });
  const symbol = rpm.symbols.find((candidate) => candidate.nameHash === BGM_RUNTIME_CONFIG_HASH);
  if (!symbol || symbol.size !== BGM_RUNTIME_CONFIG_SIZE || symbol.address + symbol.size > rpm.code.length) {
    throw new Error("The bundled background-music runtime has no compatible configuration block.");
  }
  const offset = symbol.address;
  if (readU32(rpm.code, offset) !== BGM_RUNTIME_CONFIG_MAGIC || readU32(rpm.code, offset + 20) !== BGM_RUNTIME_CONFIG_MARKER) {
    throw new Error("The bundled background-music runtime configuration failed its integrity check.");
  }
  const mappings = [...(config.mappings ?? ("streamedBgmEnabled" in config && config.streamedBgmEnabled ? [config] : []))]
    .sort((a, b) => a.targetSequenceId - b.targetSequenceId);
  validateBgmMappings(mappings);
  // Materialize BSS in place before appending the variable-length table. All
  // existing symbol addresses and relocation targets remain unchanged.
  const tableOffset = Math.ceil((rpm.code.length + rpm.bssSize) / 4) * 4;
  const code = new Uint8Array(tableOffset + mappings.length * BGM_RUNTIME_ENTRY_SIZE);
  code.set(rpm.code);
  rpm.code = code;
  rpm.bssSize = 0;
  mappings.forEach((mapping, index) => bgmMappingIds(mapping).forEach((id, field) => {
    writeU16(code, tableOffset + index * BGM_RUNTIME_ENTRY_SIZE + field * 2, id);
  }));
  writeU16(rpm.code, offset + 4, 2);
  writeU16(rpm.code, offset + 6, (config.shortcutEnabled ? 1 : 0) | (mappings.length ? 2 : 0));
  writeU32(rpm.code, offset + 8, tableOffset - offset);
  writeU16(rpm.code, offset + 12, mappings.length);
  writeU16(rpm.code, offset + 14, BGM_RUNTIME_ENTRY_SIZE);
  writeU16(rpm.code, offset + 18, BGM_RUNTIME_CONFIG_SIZE);
  writeU32(rpm.code, offset + 24, bgmTableHash(code.subarray(tableOffset)));
  return writeRpm(rpm, { ident: "DLXF" });
}

function bgmMappingIds(mapping: BgmRuntimeMapping): number[] {
  return [mapping.targetSequenceId, mapping.streamId, mapping.originalSequenceFileId, mapping.shadowFileId, mapping.streamFileId];
}

function validateBgmMappings(mappings: BgmRuntimeMapping[]): void {
  if (mappings.length > 0xffff) throw new Error("Too many background-music mappings for the native 16-bit IDs.");
  const targets = new Set<number>();
  const streams = new Set<number>();
  const ownedFiles = new Set<number>();
  for (const mapping of mappings) {
    if (bgmMappingIds(mapping).some((id) => !Number.isInteger(id) || id < 0 || id >= 0xffff)) {
      throw new Error("Background-music runtime IDs must fit in 16 bits and cannot use the 0xffff sentinel.");
    }
    if (targets.has(mapping.targetSequenceId) || streams.has(mapping.streamId) || mapping.streamId === 0
      || ownedFiles.has(mapping.shadowFileId) || ownedFiles.has(mapping.streamFileId) || mapping.shadowFileId === mapping.streamFileId) {
      throw new Error("Background-music mappings contain duplicate targets, streams, or owned files.");
    }
    targets.add(mapping.targetSequenceId);
    streams.add(mapping.streamId);
    ownedFiles.add(mapping.shadowFileId);
    ownedFiles.add(mapping.streamFileId);
  }
}

function bgmTableHash(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}

export function readBgmRuntimeConfig(bytes: Uint8Array): BgmRuntimeConfig | undefined {
  try {
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    const symbol = rpm.symbols.find((candidate) => candidate.nameHash === BGM_RUNTIME_CONFIG_HASH);
    if (!symbol || ![24, BGM_RUNTIME_CONFIG_SIZE].includes(symbol.size) || symbol.address + symbol.size > rpm.code.length) return undefined;
    const offset = symbol.address;
    if (readU32(rpm.code, offset) !== BGM_RUNTIME_CONFIG_MAGIC || readU16(rpm.code, offset + 18) !== symbol.size) return undefined;
    const abiVersion = readU16(rpm.code, offset + 4);
    const flags = readU16(rpm.code, offset + 6);
    if (flags & ~3) return undefined;
    const readMapping = (at: number): BgmRuntimeMapping => ({
      targetSequenceId: readU16(rpm.code, at), streamId: readU16(rpm.code, at + 2),
      originalSequenceFileId: readU16(rpm.code, at + 4), shadowFileId: readU16(rpm.code, at + 6),
      streamFileId: readU16(rpm.code, at + 8),
    });
    let mappings: BgmRuntimeMapping[];
    if (abiVersion === 1 && symbol.size === 24 && readU32(rpm.code, offset + 20) === 0x31474250) {
      mappings = flags & 2 ? [readMapping(offset + 8)] : [];
    } else if (abiVersion === 2 && symbol.size === 32 && readU32(rpm.code, offset + 20) === BGM_RUNTIME_CONFIG_MARKER) {
      const count = readU16(rpm.code, offset + 12);
      const start = offset + readU32(rpm.code, offset + 8);
      const end = start + count * BGM_RUNTIME_ENTRY_SIZE;
      if (readU16(rpm.code, offset + 14) !== BGM_RUNTIME_ENTRY_SIZE || start < offset + symbol.size
        || start % 2 || end > rpm.code.length || Boolean(flags & 2) !== Boolean(count)
        || bgmTableHash(rpm.code.subarray(start, end)) !== readU32(rpm.code, offset + 24)) return undefined;
      mappings = Array.from({ length: count }, (_, index) => readMapping(start + index * BGM_RUNTIME_ENTRY_SIZE));
      if (mappings.some((mapping, index) => index > 0 && mapping.targetSequenceId <= mappings[index - 1]!.targetSequenceId)) return undefined;
    } else return undefined;
    validateBgmMappings(mappings);
    return {
      shortcutEnabled: (flags & 1) !== 0,
      streamedBgmEnabled: (flags & 2) !== 0,
      ...(mappings[0] ?? { targetSequenceId: 0xffff, streamId: 0xffff, originalSequenceFileId: 0xffff, shadowFileId: 0xffff, streamFileId: 0xffff }),
      mappings,
      abiVersion,
    };
  } catch {
    return undefined;
  }
}

export function detectBundledFormEvolutionDll(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseRom !== "BW2" || (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2")) {
    return "unsupported";
  }
  const path = `patches/${FORM_EVOLUTION_FILENAMES[project.session.baseVersion]}`;
  return listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === path.toLowerCase()) ? "patched" : "unpatched";
}

export function detectBundledBgmToggleDll(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseRom !== "BW2" || (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2")) {
    return "unsupported";
  }
  const path = `patches/${BGM_TOGGLE_FILENAMES[project.session.baseVersion]}`;
  return listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === path.toLowerCase()) ? "patched" : "unpatched";
}

export function detectBundledOverworldWeatherRuntime(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseRom !== "BW2" || project.session.baseVersion !== "W2") return "unsupported";
  const path = `patches/${OVERWORLD_WEATHER_RUNTIME_W2_FILENAME}`;
  if (!listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === path.toLowerCase())) return "unpatched";
  const stagedPath = Object.keys(project.fileSystem?.additions ?? {}).find((candidate) => candidate.toLowerCase() === path.toLowerCase());
  let bytes = stagedPath ? project.fileSystem?.additions?.[stagedPath] : undefined;
  if (!bytes && project.originalRomBytes) {
    try {
      const rom = new NintendoDSRom(project.originalRomBytes);
      const fileId = rom.filenames.idOf(path);
      if (fileId !== undefined) bytes = getRomFileBytes(project, rom, fileId);
    } catch {
      // The module listing remains useful for older saved projects without parseable ROM bytes.
    }
  }
  if (!bytes) return "patched";
  try {
    const runtime = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    return new TextDecoder().decode(runtime.code).includes(OVERWORLD_WEATHER_RUNTIME_W2_SIGNATURE)
      ? "patched"
      : "unpatched";
  } catch {
    return "unpatched";
  }
}

export function getPmcInstallStatus(project: ProjectState): PmcInstallStatus {
  if (project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") {
    return { installed: false, supported: false, message: "PMC is only supported for Gen V Black/White projects." };
  }
  const stagedOverlayId = parseOverlayIdBytes(project.fileSystem?.additions?.[PMC_OVERLAY_ID_PATH]);
  const state = project.codeInjection?.pmc;
  const overlayId = state?.overlayId ?? stagedOverlayId;
  if (overlayId === undefined) return { installed: false, supported: true, message: "PMC is not installed in this project." };
  return {
    installed: true,
    supported: true,
    overlayId,
    overlayBaseAddress: state?.overlayBaseAddress,
    version: state?.version,
    gameId: state?.gameId,
    message: `PMC is staged on overlay ${overlayId}.`,
  };
}

/**
 * Explain the destructive parts of replacing an existing PMC installation
 * when its ROM layout was not produced by Pokeweb's current installer. This
 * includes the anonymous overlay FAT slot used by CTRMap/Cascade projects.
 */
export function getPmcUpdateConfirmationMessage(project: ProjectState, romBytes: Uint8Array): string | undefined {
  const rom = new NintendoDSRom(romBytes);
  const overlayId = readPmcOverlayId(project, rom);
  if (overlayId === undefined) return undefined;

  const expectedPath = overlayPathForId(overlayId);
  // A PMC staged by the current project has not reached the source ROM yet,
  // but its eventual layout is already known and does not need this warning.
  if (project.fileSystem?.additions?.[expectedPath]) return undefined;

  const entry = findOverlayEntry(rom.arm9OverlayTable, overlayId);
  const expectedFileId = rom.filenames.idOf(expectedPath);
  const reasons: string[] = [];
  let currentLayout = `Overlay ${overlayId}`;

  if (entry === undefined) {
    reasons.push(`The marker names overlay ${overlayId}, but that overlay has no ARM9 overlay-table row.`);
  } else {
    const fileSize = readU32(rom.arm9OverlayTable, entry + 8);
    const bssSize = readU32(rom.arm9OverlayTable, entry + 12);
    const fileId = readU32(rom.arm9OverlayTable, entry + 24);
    const sourcePath = listNamedRomFiles(rom.filenames).find((file) => file.id === fileId)?.path;
    currentLayout = `Overlay ${overlayId} currently loads from ${sourcePath ? `“${sourcePath}”` : `anonymous NitroFS file ${fileId}`} and declares ${hex(fileSize)} file-backed bytes plus ${hex(bssSize)} BSS bytes.`;
    if (expectedFileId !== fileId) {
      reasons.push(expectedFileId === undefined
        ? `The current PMC executable is not stored at “${expectedPath}”.`
        : `The overlay row uses file ${fileId}, while “${expectedPath}” is file ${expectedFileId}.`);
    }
    if (fileSize + bssSize !== PMC_OVERLAY_RESERVED_SIZE) {
      reasons.push(`Its declared memory range is ${hex(fileSize + bssSize)}, not Pokeweb’s ${hex(PMC_OVERLAY_RESERVED_SIZE)} reserved range.`);
    }
  }

  if (reasons.length === 0) return undefined;
  return [
    "Existing external/legacy PMC layout detected.",
    "",
    currentLayout,
    ...reasons.map((reason) => `• ${reason}`),
    "",
    "Updating PMC in Pokeweb will:",
    `• Replace the PMC executable and ${PMC_SYMBOL_PATH} with Pokeweb’s bundled runtime.`,
    "• Reapply PMC hooks to ARM9 and target overlays and recalculate the heap-start patch.",
    `• Write the PMC executable at “${expectedPath}” and reserve ${hex(PMC_OVERLAY_RESERVED_SIZE)} bytes for its overlay.`,
    "• Keep existing files under patches/ and lib/, but compatibility with the replaced PMC cannot be guaranteed.",
    "",
    "This is a replacement, not a merge or repair, and is not required to install the Overworld Weather Runtime.",
    "",
    "Continue with Update PMC?",
  ].join("\n");
}

export function stageCodeInjectionDll(
  project: ProjectState,
  fileName: string,
  bytes: Uint8Array,
  target: CodeInjectionDllTarget = "patches",
  romBytes: Uint8Array | undefined = project.originalRomBytes,
): CodeInjectionDllInstallResult {
  const status = getPmcInstallStatus(project);
  if (!status.installed) throw new Error("Install PMC before adding patch DLLs.");
  const safeName = sanitizeDllFilename(fileName);
  validateCodeInjectionDll(bytes);

  let version: string | undefined;
  let gameId: string | undefined;
  try {
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    version = stringMeta(rpm, "PMCVersion");
    gameId = stringMeta(rpm, "PMCGameID");
    // Persisted browser projects keep their ROM bytes in IndexedDB. Use the
    // loaded ROM identity when the caller has no in-memory byte buffer.
    const romIdCode = romBytes ? readAscii(romBytes, 12, 4) : project.romInfo?.idCode;
    const expectedGameId = romIdCode === "IRDI" ? "W2I" : project.session.baseVersion;
    if (gameId && gameId !== expectedGameId) {
      throw new Error(`This DLL is for ${gameId}, but the loaded ROM is ${expectedGameId}.`);
    }
  } catch (error) {
    if (error instanceof Error && /This DLL is for/u.test(error.message)) throw error;
  }

  const path = `${target}/${safeName}`;
  const existingRomFileId = (() => {
    if (!romBytes) return undefined;
    try {
      return new NintendoDSRom(romBytes, { fileData: "view" }).filenames.idOf(path);
    } catch {
      return undefined;
    }
  })();
  if (existingRomFileId === undefined) addRomFile(project, path, bytes);
  else {
    const duplicateAddition = Object.keys(project.fileSystem?.additions ?? {}).find(
      (candidate) => candidate.toLowerCase() === path.toLowerCase(),
    );
    if (duplicateAddition) delete project.fileSystem?.additions?.[duplicateAddition];
    setRomFileReplacement(project, existingRomFileId, bytes);
  }
  project.codeInjection ??= {};
  const modules = (project.codeInjection.modules ??= []);
  const index = modules.findIndex((module) => module.path === path);
  const entry = { path, target, fileName: safeName, version, gameId };
  if (index === -1) modules.push(entry);
  else modules[index] = entry;
  return entry;
}

export function canRemoveStagedCodeInjectionDll(project: ProjectState, path: string): boolean {
  const normalized = path.replace(/^\/+|\\/gu, "/");
  return Object.keys(project.fileSystem?.additions ?? {}).some((candidate) => candidate.toLowerCase() === normalized.toLowerCase());
}

export function removeStagedCodeInjectionDll(project: ProjectState, path: string): void {
  const normalized = path.replace(/^\/+|\\/gu, "/");
  const stagedPath = Object.keys(project.fileSystem?.additions ?? {}).find(
    (candidate) => candidate.toLowerCase() === normalized.toLowerCase(),
  );
  if (!stagedPath) {
    throw new Error(`${normalized} is part of the loaded ROM and cannot be removed until NitroFS file deletion is supported.`);
  }
  delete project.fileSystem?.additions?.[stagedPath];
  if (project.codeInjection?.modules) {
    project.codeInjection.modules = project.codeInjection.modules.filter(
      (module) => module.path.toLowerCase() !== normalized.toLowerCase(),
    );
  }
}

export function listCodeInjectionDlls(project: ProjectState): NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> {
  const fromState = project.codeInjection?.modules ?? [];
  const seen = new Set<string>();
  const modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> = [];
  for (const module of fromState) {
    seen.add(module.path);
    modules.push(module);
  }
  for (const path of Object.keys(project.fileSystem?.additions ?? {}).sort((a, b) => a.localeCompare(b))) {
    addDllModuleFromPath(path, seen, modules);
  }
  for (const module of codeInjectionDllsFromOriginalRom(project)) addDllModule(module, seen, modules);
  return modules;
}

function codeInjectionDllsFromOriginalRom(project: ProjectState): CodeInjectionModule[] {
  const originalRomBytes = project.originalRomBytes;
  if (!originalRomBytes) return [];
  const cached = originalRomDllCache.get(project);
  if (cached?.originalRomBytes === originalRomBytes) return cached.modules;

  let modules: CodeInjectionModule[] = [];
  try {
    modules = detectCodeInjectionDllsFromRom(new NintendoDSRom(originalRomBytes, { fileData: "view" }));
  } catch {
    // Older saved projects may not include parseable ROM bytes; staged DLLs still cover active edits.
  }
  originalRomDllCache.set(project, { originalRomBytes, modules });
  return modules;
}

export function detectWhite2UpgradeDlls(project: ProjectState): boolean {
  if (project.session.baseRom !== "BW2") return false;
  return listCodeInjectionDlls(project).some((module) => isWhite2UpgradeDllPath(module.path));
}

export function detectBlack2UpgradeDlls(project: ProjectState): boolean {
  if (project.session.baseVersion !== "B2") return false;
  return listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === "patches/black2upgrade.dll");
}

export function detectBundledDoubleBattleFixDll(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseRom !== "BW2") return "unsupported";
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return "unsupported";
  const fileName = DOUBLE_BATTLE_FIX_FILENAMES[project.session.baseVersion];
  const path = `patches/${fileName}`;
  return listCodeInjectionDlls(project).some((module) => module.path === path) ? "patched" : "unpatched";
}

export function detectBundledMainMenuSkipDll(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseRom !== "BW2") return "unsupported";
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return "unsupported";
  const fileName = MAIN_MENU_SKIP_FILENAMES[project.session.baseVersion];
  const path = `patches/${fileName}`;
  return listCodeInjectionDlls(project).some((module) => module.path === path) ? "patched" : "unpatched";
}

export function validateCodeInjectionDll(bytes: Uint8Array): void {
  const magic = bytes.length >= 4 ? readAscii(bytes, 0, 4) : "";
  if (magic !== "DLXF") {
    if (magic.startsWith("MZ")) throw new Error("This looks like a Windows DLL. Pokeweb needs a Gen V/libRPM DLL built for PMC.");
    if (magic === "RPM0") throw new Error("This is an RPM module, not an installed DLL. Convert it to a DLXF .dll with the RPM tooling first.");
    throw new Error("This file is not a Gen V/libRPM DLL. Expected DLXF magic.");
  }
}

export function detectPmcInstallFromRom(rom: NintendoDSRom): NonNullable<ProjectState["codeInjection"]> | undefined {
  const modules = detectCodeInjectionDllsFromRom(rom);
  const markerId = parseOverlayIdBytes(getRomPathBytes(rom, PMC_OVERLAY_ID_PATH));
  const external = markerId === undefined ? detectMarkerlessBw2Pmc(rom) : undefined;
  const overlayId = markerId ?? external?.overlayId;
  if (overlayId === undefined) return modules.length > 0 ? { modules } : undefined;
  const entry = findOverlayEntry(rom.arm9OverlayTable, overlayId);
  const symbolBytes = getRomPathBytes(rom, PMC_SYMBOL_PATH);
  let version: string | undefined = external?.version;
  let gameId: string | undefined = external?.gameId;
  if (symbolBytes) {
    try {
      const rpm = parseRpm(symbolBytes);
      version = stringMeta(rpm, "PMCVersion");
      gameId = stringMeta(rpm, "PMCGameID");
    } catch {
      // A hand-edited ROM may have a missing or older symbol RPM; the overlay marker is still useful status.
    }
  }
  return {
    pmc: {
      overlayId,
      overlayBaseAddress: entry === undefined ? undefined : readU32(rom.arm9OverlayTable, entry + 4),
      overlayPath: overlayPathForId(overlayId),
      symbolPath: PMC_SYMBOL_PATH,
      version,
      gameId,
    },
    modules: modules.length > 0 ? modules : undefined,
  };
}

/** Recognize the active CTRMap-style loader, not just a DLL directory or RPM
 * signature. Preserve its anonymous FAT file and original overlay reservation.
 * A markerless ROM must have matching metadata, relocation base, overlay row,
 * and a startup wrapper that both loads and calls that same overlay. */
function detectMarkerlessBw2Pmc(rom: NintendoDSRom): { overlayId: number; version: string; gameId: string } | undefined {
  const gameId = rom.idCode === "IRDO" ? "W2" : rom.idCode === "IREO" ? "B2" : undefined;
  if (!gameId) return undefined;
  const overlayId = 344;
  const row = findOverlayEntry(rom.arm9OverlayTable, overlayId);
  if (row === undefined) return undefined;
  const base = readU32(rom.arm9OverlayTable, row + 4);
  const size = readU32(rom.arm9OverlayTable, row + 8);
  const bytes = rom.files[readU32(rom.arm9OverlayTable, row + 24)];
  if (!bytes || size < 0x20 || size > PMC_OVERLAY_RESERVED_SIZE || bytes.length !== size
    || (readU32(rom.arm9OverlayTable, row + 28) & 0x01000000) !== 0
    || readU32(rom.arm9OverlayTable, row + 16) !== base
    || readU32(rom.arm9OverlayTable, row + 20) !== base) return undefined;
  try {
    const rpm = parseRpm(bytes);
    const version = stringMeta(rpm, "PMCVersion");
    if (!version || stringMeta(rpm, "PMCGameID") !== gameId
      || stringMeta(rpm, "SymbolFile") !== "RPMSYM-PMC.rpm" || rpm.baseAddress !== base) return undefined;
    const arm9 = decompressCode(rom.arm9);
    const offset = 0x0200400c - rom.arm9RamAddress;
    if (offset < 0 || offset + 24 > arm9.length) return undefined;
    if (readU16(arm9, offset) !== 0xb500 || readU16(arm9, offset + 6) !== 0x2000
      || readU16(arm9, offset + 8) !== 0x4902 || readU16(arm9, offset + 18) !== 0xbd00
      || readU32(arm9, offset + 20) !== overlayId) return undefined;
    const branchTarget = (address: number): number | undefined => {
      const at = address - rom.arm9RamAddress;
      if (at < 0 || at + 4 > arm9.length) return undefined;
      const high = readU16(arm9, at), low = readU16(arm9, at + 2);
      if ((high & 0xf800) !== 0xf000 || (low & 0xf800) !== 0xf800) return undefined;
      const displacement = (((high & 0x7ff) << 12 | (low & 0x7ff) << 1) << 9) >> 9;
      return address + 4 + displacement;
    };
    // US W2/B2 main -> wrapper -> GFLAppInit -> sys_load_overlay -> PMC.
    // A dormant wrapper or a load call to another routine is not sufficient.
    if (branchTarget(0x0200512a) !== 0x0200400c || branchTarget(0x0200400e) !== 0x020054b8
      || branchTarget(0x02004016) !== (gameId === "W2" ? 0x020712dc : 0x020712b0)) return undefined;
    const target = branchTarget(0x0200401a);
    if (target === undefined || target < base + 0x20 || target >= base + 0x20 + rpm.code.length) return undefined;
    return { overlayId, version, gameId };
  } catch {
    return undefined;
  }
}

export type LegacyPmcRomStructureRepair = {
  detected: boolean;
  arm9OverlayTable?: Uint8Array;
  repairedOverlayLayout: boolean;
  repairedRootFnt: boolean;
};

export function repairLegacyPmcRomStructure(rom: NintendoDSRom): LegacyPmcRomStructureRepair {
  const pmc = detectPmcInstallFromRom(rom)?.pmc;
  if (!pmc) return { detected: false, repairedOverlayLayout: false, repairedRootFnt: false };

  let arm9OverlayTable: Uint8Array | undefined;
  const entry = findOverlayEntry(rom.arm9OverlayTable, pmc.overlayId);
  const overlayBytes = getRomPathBytes(rom, pmc.overlayPath);
  if (entry !== undefined && overlayBytes && overlayBytes.length <= PMC_OVERLAY_RESERVED_SIZE) {
    const expectedBssSize = PMC_OVERLAY_RESERVED_SIZE - overlayBytes.length;
    if (readU32(rom.arm9OverlayTable, entry + 8) !== overlayBytes.length || readU32(rom.arm9OverlayTable, entry + 12) !== expectedBssSize) {
      arm9OverlayTable = rom.arm9OverlayTable.slice();
      writeU32(arm9OverlayTable, entry + 8, overlayBytes.length);
      writeU32(arm9OverlayTable, entry + 12, expectedBssSize);
    }
  }

  const family = gen5FamilyForIdCode(rom.idCode);
  const expected = family === undefined ? undefined : GEN5_RETAIL_ROOT_FILES[family];
  const repairedRootFnt = expected !== undefined
    && pmc.overlayId === expected.firstId
    && restoreLegacyPmcRootFnt(rom, pmc.overlayId, expected);

  return {
    detected: true,
    arm9OverlayTable,
    repairedOverlayLayout: arm9OverlayTable !== undefined,
    repairedRootFnt,
  };
}

export function buildCodeInjectionOverlayTable(
  project: ProjectState,
  rom: NintendoDSRom,
  baseTable: Uint8Array,
  resolveFileId?: (path: string) => number | undefined,
): Uint8Array | undefined {
  // Fall back to the marker and existing overlay row so every export repairs
  // ROMs made by the legacy Pokeweb installer, including old cached projects
  // whose serialized state predates codeInjection.pmc detection.
  const stagedPmc = project.codeInjection?.pmc;
  const overlayId = stagedPmc?.overlayId ?? readPmcOverlayId(project, rom);
  if (overlayId === undefined) return undefined;
  const overlayPath = stagedPmc?.overlayPath ?? overlayPathForId(overlayId);
  const existingEntry = findOverlayEntry(baseTable, overlayId);
  const overlayBaseAddress = stagedPmc?.overlayBaseAddress
    ?? (existingEntry === undefined ? undefined : readU32(baseTable, existingEntry + 4));
  if (overlayBaseAddress === undefined) return undefined;
  const overlayBytes = project.fileSystem?.additions?.[overlayPath] ?? getRomPathBytes(rom, overlayPath);
  if (!overlayBytes) return undefined;
  if (overlayBytes.length > PMC_OVERLAY_RESERVED_SIZE) {
    throw new Error(`PMC overlay is larger than its reserved memory range (${hex(overlayBytes.length)} > ${hex(PMC_OVERLAY_RESERVED_SIZE)}).`);
  }
  const fileId = resolveFileId?.(overlayPath) ?? fileIdForPathWithAdditions(project, rom, overlayPath);
  const table = existingEntry === undefined ? appendOverlayEntry(baseTable) : baseTable.slice();
  const offset = existingEntry ?? table.length - 32;
  writeU32(table, offset, overlayId);
  writeU32(table, offset + 4, overlayBaseAddress);
  // Overlay RAM size is the amount the retail loader reads from NitroFS. The
  // remainder of PMC's reserved address range must be BSS; declaring the full
  // 0x8000 as file-backed code makes a 0x3000 PMC image fail with a short read.
  writeU32(table, offset + 8, overlayBytes.length);
  writeU32(table, offset + 12, PMC_OVERLAY_RESERVED_SIZE - overlayBytes.length);
  writeU32(table, offset + 16, overlayBaseAddress);
  writeU32(table, offset + 20, overlayBaseAddress);
  writeU32(table, offset + 24, fileId);
  writeU32(table, offset + 28, 0);
  return table;
}

export function repairLegacyPmcRootFnt(project: ProjectState, rom: NintendoDSRom): boolean {
  if (project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") return false;
  const overlayId = readPmcOverlayId(project, rom);
  if (overlayId === undefined) return false;

  const expected = GEN5_RETAIL_ROOT_FILES[project.session.baseRom];
  if (overlayId !== expected.firstId) return false;
  return restoreLegacyPmcRootFnt(rom, overlayId, expected);
}

function restoreLegacyPmcRootFnt(
  rom: NintendoDSRom,
  overlayId: number,
  expected: { firstId: number; names: string[] },
): boolean {
  if (rom.filenames.files.length !== 0 || rom.filenames.firstId !== overlayId + 1) return false;
  if (expected.firstId + expected.names.length > rom.files.length) return false;

  // Pokeweb exports from 2026-08-03 through 2026-08-06 erased these retail
  // root labels while leaving their FAT slots untouched. Restore only this
  // exact marker-backed legacy shape; no file IDs or file bytes move.
  rom.filenames = cloneFolder(rom.filenames);
  rom.filenames.firstId = expected.firstId;
  rom.filenames.files = [...expected.names];
  return true;
}

function gen5FamilyForIdCode(idCode: string): "BW" | "BW2" | undefined {
  const prefix = idCode.toUpperCase().slice(0, 3);
  if (prefix === "IRA" || prefix === "IRB") return "BW";
  if (prefix === "IRD" || prefix === "IRE") return "BW2";
  return undefined;
}

export function codeInjectionInsertedFiles(project: ProjectState, rom: NintendoDSRom): Array<{ fileId: number; path: string; bytes: Uint8Array }> {
  void project;
  void rom;
  // Normal exports keep existing NitroFS file IDs stable. The explicit Frost
  // compatibility export reserves an overlay-first slot as a separate final
  // conversion; do not apply that layout change to every Pokeweb export.
  return [];
}

function applyExternalRelocations(project: ProjectState, rom: NintendoDSRom, rpm: RpmModule): void {
  const arm9 = project.arm9.length > 0 ? project.arm9 : decompressCode(rom.arm9);
  for (const relocation of rpm.relocations) {
    if (relocation.target.module === "base") continue;
    if (relocation.target.module === "ARM9") {
      writeRelocationDataByType(rpm, relocation, arm9, relocation.target.address & 0xfffffffe, rom.arm9RamAddress);
      continue;
    }
    const overlayId = Number(relocation.target.module);
    if (!Number.isInteger(overlayId)) throw new Error(`Unsupported PMC relocation target module: ${relocation.target.module}`);
    const entry = findOverlayEntry(rom.arm9OverlayTable, overlayId);
    const overlay = project.overlays[overlayId];
    if (entry === undefined || !overlay) throw new Error(`PMC relocation target overlay ${overlayId} is not loaded.`);
    writeRelocationDataByType(rpm, relocation, overlay, relocation.target.address & 0xfffffffe, readU32(rom.arm9OverlayTable, entry + 4));
  }
  project.arm9 = arm9;
  project.arm9Dirty = true;
}

function retargetPmcForBw1(rpm: RpmModule, version: Bw1Version): void {
  const layout = BW1_PMC_LAYOUTS[version];
  rpm.metadata.PMCGameID = version;
  rpm.metadata.PMCVersion = `${String(rpm.metadata.PMCVersion ?? "13.2.4")}-bw1`;

  for (const symbol of rpm.symbols) {
    if (!symbol.name) continue;
    const replacement = layout.symbols[symbol.name];
    if (!replacement) continue;
    symbol.address = replacement.address;
    symbol.type = replacement.type;
  }

  // The boot FULL_COPY has to invoke the late FS initializer immediately
  // before loading overlay 237. Keep the public GFLAppInit export accurate
  // for future BW1 QoL DLLs and redirect only this private boot relocation.
  const gflAppInitIndex = rpm.symbols.findIndex((symbol) => symbol.name === "GFLAppInit");
  const bootFsRelocation = rpm.relocations.find(
    (relocation) => relocation.target.module === "base"
      && relocation.target.address === 2
      && relocation.sourceSymbolIndex === gflAppInitIndex,
  );
  if (gflAppInitIndex < 0 || !bootFsRelocation) {
    throw new Error("Bundled PMC boot initializer relocation no longer matches the BW1 retargeter.");
  }
  const bootFsSymbolIndex = rpm.symbols.length;
  rpm.symbols.push({
    name: null,
    size: 0,
    address: layout.bootFsInitAddress,
    type: "FUNCTION_ARM",
    attributes: 1 << 2,
  });
  bootFsRelocation.sourceSymbolIndex = bootFsSymbolIndex;

  // BW1's original main call initializes the game's heap and application
  // globals. Redirecting that call to the late FS initializer is necessary to
  // make the appended PMC overlay visible, but it also skips GFLAppInit and
  // leaves every normal heap slot uninitialized. Run GFLAppInit after the PMC
  // overlay has mounted and before PMC scans/starts patch DLLs.
  appendBw1BootInitializerWrapper(rpm, gflAppInitIndex);

  for (const relocation of rpm.relocations) {
    if (relocation.target.module !== "ARM9") continue;
    const symbolName = rpm.symbols[relocation.sourceSymbolIndex]?.name;
    if (symbolName?.endsWith("AdjustHeapStart")) {
      relocation.target.address = layout.hookTargets.heapStart;
    } else if (symbolName?.endsWith("UncapOverlayMaximum")) {
      relocation.target.address = layout.hookTargets.overlayMaximum;
    } else if (symbolName === "THUMB_BRANCH_LINK_GFL_OvlLoad_0x76") {
      relocation.target.address = layout.hookTargets.overlayLoad;
      relocation.target.type = "ARM_BRANCH_LINK";
    } else if (symbolName === "THUMB_BRANCH_LINK_GFL_OvlEntryUnload_0xA") {
      relocation.target.address = layout.hookTargets.overlayUnload;
      relocation.target.type = "ARM_BRANCH_LINK";
    }
  }

  const overlaySymbol = findRpmSymbol(rpm, (symbol) => symbol.name === "OVL_344");
  if (!overlaySymbol || readU32(rpm.code, overlaySymbol.address) !== 344) {
    throw new Error("Bundled PMC overlay-ID constant no longer matches the BW1 retargeter.");
  }
  writeU32(rpm.code, overlaySymbol.address, layout.overlayId);

  // System::Init encodes 344 as `movs r2, #172; lsls r2, r2, #1`.
  if (readU16(rpm.code, 0x4a8) !== 0x22ac || readU16(rpm.code, 0x4ac) !== 0x0052) {
    throw new Error("Bundled PMC System::Init overlay-ID sequence no longer matches the BW1 retargeter.");
  }
  writeU16(rpm.code, 0x4a8, 0x22ed);
  writeU16(rpm.code, 0x4ac, 0x46c0);
}

function appendBw1BootInitializerWrapper(rpm: RpmModule, gflAppInitIndex: number): void {
  const pmcSystemInitIndex = rpm.symbols.findIndex((symbol) => symbol.name === "_PMCSystemInit");
  const bootSystemInitRelocation = rpm.relocations.find(
    (relocation) => relocation.target.module === "base"
      && relocation.target.address === 14
      && relocation.sourceSymbolIndex === pmcSystemInitIndex,
  );
  if (gflAppInitIndex < 0 || pmcSystemInitIndex < 0 || !bootSystemInitRelocation) {
    throw new Error("Bundled PMC system initializer relocation no longer matches the BW1 boot wrapper.");
  }

  const wrapperOffset = rpm.code.length;
  const wrapperSize = 12;

  // The serialized RPM places BSS immediately after the code image. Moving
  // that boundary requires moving its local/exported symbols by the same
  // amount; absolute game symbols carry the GLOBAL attribute and stay fixed.
  for (const symbol of rpm.symbols) {
    if ((symbol.attributes & (1 << 2)) === 0 && symbol.address >= wrapperOffset) {
      symbol.address += wrapperSize;
    }
  }

  const code = new Uint8Array(wrapperOffset + wrapperSize);
  code.set(rpm.code);
  writeU16(code, wrapperOffset, 0xb500); // push {lr}
  writeU16(code, wrapperOffset + 10, 0xbd00); // pop {pc}
  rpm.code = code;

  const wrapperSymbolIndex = rpm.symbols.length;
  rpm.symbols.push({
    name: "__PokewebBw1BootInitializerWrapper",
    size: wrapperSize,
    address: wrapperOffset,
    type: "FUNCTION_THM",
    attributes: 0,
  });
  rpm.relocations.push(
    {
      target: { module: "base", address: wrapperOffset + 2, type: "THUMB_BRANCH_LINK" },
      sourceSymbolIndex: gflAppInitIndex,
    },
    {
      target: { module: "base", address: wrapperOffset + 6, type: "THUMB_BRANCH_LINK" },
      sourceSymbolIndex: pmcSystemInitIndex,
    },
  );
  bootSystemInitRelocation.sourceSymbolIndex = wrapperSymbolIndex;
}

function validateBw1PmcInstallSites(arm9: Uint8Array, arm9RamAddress: number, version: Bw1Version, updating: boolean): void {
  if (updating) return;
  const layout = BW1_PMC_LAYOUTS[version];
  const expected = [
    { address: 0x0200512a, bytes: hexBytes("00f097f9"), label: "main boot hook" },
    { address: layout.hookTargets.overlayLoad, bytes: hexBytes("b81101eb"), label: "overlay-load hook" },
    { address: layout.hookTargets.overlayUnload, bytes: hexBytes("181201eb"), label: "overlay-unload hook" },
    { address: layout.hookTargets.overlayMaximum, bytes: hexBytes("ed000000"), label: "overlay maximum" },
  ];
  for (const check of expected) {
    const offset = check.address - arm9RamAddress;
    const actual = offset >= 0 ? arm9.subarray(offset, offset + check.bytes.length) : new Uint8Array();
    if (!bytesEqual(actual, check.bytes)) {
      throw new Error(`The US ${version === "B" ? "Black" : "White"} PMC ${check.label} does not match at ${hex(check.address)}.`);
    }
  }
  const bytePatchOffset = layout.bytePatchAddress - arm9RamAddress;
  if (arm9[bytePatchOffset] !== 0x0a) {
    throw new Error(`The US ${version === "B" ? "Black" : "White"} overlay-header fallback does not match at ${hex(layout.bytePatchAddress)}.`);
  }
}

function applyBw1PmcBytePatch(arm9: Uint8Array, arm9RamAddress: number, version: Bw1Version): void {
  const address = BW1_PMC_LAYOUTS[version].bytePatchAddress;
  const offset = address - arm9RamAddress;
  if (offset < 0 || offset >= arm9.length || (arm9[offset] !== 0x0a && arm9[offset] !== 0xea)) {
    throw new Error(`The BW1 overlay-header fallback changed before patching at ${hex(address)}.`);
  }
  arm9[offset] = 0xea;
}

function buildPmcOverlay(overlayBaseAddress: number, codeRpmBytes: Uint8Array): Uint8Array {
  const codeLength = align(codeRpmBytes.length, 0x10);
  const entrySize = PMC_RPM_UID.length + 1 + 12;
  const patchDataLength = 0x10 + entrySize + 8;
  const patchTableOffset = (PMC_OVERLAY_SIZE - patchDataLength) & ~0xf;
  if (codeLength > patchTableOffset) throw new Error(`Bundled PMC code RPM does not fit in the ${hex(PMC_OVERLAY_SIZE)} overlay.`);

  const overlay = new Uint8Array(PMC_OVERLAY_SIZE);
  overlay.set(codeRpmBytes, 0);
  let offset = patchTableOffset;
  writeU32(overlay, offset, 1);
  offset += 4;
  writeU32(overlay, offset, patchTableOffset + 8);
  offset += 4;
  overlay.set(asciiBytes(PMC_RPM_UID), offset);
  offset += PMC_RPM_UID.length;
  overlay[offset++] = 0;
  writeU32(overlay, offset, 0);
  writeU32(overlay, offset + 4, codeRpmBytes.length);
  writeU32(overlay, offset + 8, 0);

  const headerOffset = PMC_OVERLAY_SIZE - 0x10;
  overlay.set(asciiBytes("OVL0"), headerOffset);
  writeU32(overlay, headerOffset + 4, overlayBaseAddress);
  writeU32(overlay, headerOffset + 8, patchTableOffset);
  return overlay;
}

function stageRomPath(project: ProjectState, rom: NintendoDSRom, path: string, bytes: Uint8Array): void {
  const existingId = rom.filenames.idOf(path);
  if (existingId === undefined) addRomFile(project, path, bytes);
  else setRomFileReplacement(project, existingId, bytes);
}

function stagePatchesKeepPath(project: ProjectState, rom: NintendoDSRom): void {
  const bytes = asciiBytes("pokeweb");
  const existingId = rom.filenames.idOf(PMC_PATCHES_KEEP_PATH);
  if (existingId !== undefined) {
    setRomFileReplacement(project, existingId, bytes);
    return;
  }

  if (romFolderHasFiles(rom.filenames, "patches")) {
    delete project.fileSystem?.additions?.[PMC_PATCHES_KEEP_PATH];
    return;
  }

  addRomFile(project, PMC_PATCHES_KEEP_PATH, bytes);
}

export function pruneRedundantPatchesKeepAddition(project: ProjectState, rom: NintendoDSRom): void {
  const additions = project.fileSystem?.additions;
  if (!additions || !(PMC_PATCHES_KEEP_PATH in additions)) return;
  if (rom.filenames.idOf(PMC_PATCHES_KEEP_PATH) !== undefined || romFolderHasFiles(rom.filenames, "patches")) {
    delete additions[PMC_PATCHES_KEEP_PATH];
  }
}

function findRomFolder(root: Folder, path: string): Folder | undefined {
  let folder: Folder | undefined = root;
  for (const part of path.split("/").filter(Boolean)) {
    folder = folder?.folders.find(([name]) => name === part)?.[1];
    if (!folder) return undefined;
  }
  return folder;
}

function romFolderHasFiles(root: Folder, path: string): boolean {
  return (findRomFolder(root, path)?.files.length ?? 0) > 0;
}

function readPmcOverlayId(project: ProjectState, rom: NintendoDSRom): number | undefined {
  return project.codeInjection?.pmc?.overlayId ?? parseOverlayIdBytes(project.fileSystem?.additions?.[PMC_OVERLAY_ID_PATH]) ?? parseOverlayIdBytes(getRomPathBytes(rom, PMC_OVERLAY_ID_PATH)) ?? detectMarkerlessBw2Pmc(rom)?.overlayId;
}

function parseOverlayIdBytes(bytes: Uint8Array | undefined): number | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  const value = Number.parseInt(new TextDecoder().decode(bytes).trim(), 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function getRomPathBytes(rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const fileId = rom.filenames.idOf(path);
  return fileId === undefined ? undefined : rom.files[fileId];
}

function fileIdForPathWithAdditions(project: ProjectState, rom: NintendoDSRom, path: string): number {
  const existingId = rom.filenames.idOf(path);
  if (existingId !== undefined) return existingId;
  const inserted = codeInjectionInsertedFiles(project, rom).find((file) => file.path === path);
  if (inserted) return inserted.fileId;
  const additions = Object.keys(project.fileSystem?.additions ?? {}).sort((a, b) => a.localeCompare(b));
  const index = additions.indexOf(path);
  if (index === -1) throw new Error(`ROM addition is missing: ${path}`);
  return rom.files.length + index;
}

function findOverlayEntry(table: Uint8Array, overlayId: number): number | undefined {
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    if (readU32(table, offset) === overlayId) return offset;
  }
  return undefined;
}

function maxOverlayEnd(table: Uint8Array): number {
  let max = 0;
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    const address = readU32(table, offset + 4);
    if ((address & 0xfff00000) > 0x02300000) continue;
    max = Math.max(max, address + readU32(table, offset + 8));
  }
  return align(max, 16);
}

function appendOverlayEntry(table: Uint8Array): Uint8Array {
  const out = new Uint8Array(table.length + 32);
  out.set(table);
  return out;
}

function overlayPathForId(overlayId: number): string {
  return `overlay/overlay_${String(overlayId).padStart(4, "0")}.bin`;
}

function addDllModuleFromPath(
  path: string,
  seen: Set<string>,
  modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]>,
): void {
  const match = /^(patches|lib)\/(.+\.dll)$/iu.exec(path);
  if (!match || seen.has(path)) return;
  seen.add(path);
  modules.push({ path, target: match[1].toLowerCase() as CodeInjectionDllTarget, fileName: basename(match[2]) });
}

function addDllModule(
  module: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]>[number],
  seen: Set<string>,
  modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]>,
): void {
  if (seen.has(module.path)) return;
  seen.add(module.path);
  modules.push(module);
}

function detectCodeInjectionDllsFromRom(rom: NintendoDSRom): NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> {
  const seen = new Set<string>();
  const modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> = [];
  for (const file of listNamedRomFiles(rom.filenames).sort((a, b) => a.path.localeCompare(b.path))) {
    const bytes = rom.files[file.id];
    if (!bytes || readAscii(bytes, 0, 4) !== "DLXF") continue;
    const previousCount = modules.length;
    addDllModuleFromPath(file.path, seen, modules);
    if (modules.length > previousCount) {
      try {
        const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
        modules[previousCount]!.version = stringMeta(rpm, "PMCVersion");
        modules[previousCount]!.gameId = stringMeta(rpm, "PMCGameID");
      } catch {
        // Still list an opaque legacy DLL, but never guess its version.
      }
    }
  }
  return modules;
}

function isWhite2UpgradeDllPath(path: string): boolean {
  const fileName = basename(path).toLowerCase();
  return WHITE2UPGRADE_DLL_FILENAMES.has(fileName) || /^w2u.*\.dll$/iu.test(fileName);
}

function listNamedRomFiles(root: Folder, parent = ""): Array<{ id: number; path: string }> {
  const files = root.files.map((name, index) => ({ id: root.firstId + index, path: parent ? `${parent}/${name}` : name }));
  for (const [name, folder] of root.folders) files.push(...listNamedRomFiles(folder, parent ? `${parent}/${name}` : name));
  return files;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function stringMeta(rpm: RpmModule, key: string): string | undefined {
  const value = rpm.metadata[key];
  return value === undefined ? undefined : String(value);
}

function asciiBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_unused, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sanitizeDllFilename(fileName: string): string {
  const baseName = fileName
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/[^\w .-]/gu, "_")
    .replace(/^\.+/u, "") ?? "";
  const withName = baseName || "Patch.dll";
  return /\.dll$/iu.test(withName) ? withName : `${withName}.dll`;
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}
