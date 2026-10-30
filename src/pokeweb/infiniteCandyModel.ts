import { getLevelCapsRuntime } from "./levelCapsRuntime";
import { synchronizeLevelCapsForCandy } from "./levelCapsModel";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes, replaceNarcFile } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import {
  detectBlack2UpgradeDlls, detectWhite2UpgradeDlls, getPmcInstallStatus,
  installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll,
  type CodeInjectionDllInstallResult,
} from "./pmcModel";
import { markDirty, type ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { getTextBank, parseTextEntryId, updateTextEntry } from "./textModel";
import bw1Manifest from "../assets/codeinjection/infiniteCandyBw1Manifest.json";
import bw2Manifest from "../assets/codeinjection/infiniteCandyBw2Manifest.json";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";

export const INFINITE_CANDY_ITEM_ID = 622;
export const INFINITE_CANDY_NAME = "Infinite Candy";
export const INFINITE_CANDY_DESCRIPTION = "A reusable candy that\\nraises a Pokémon's level by one.";

// Adapted PW2Code item 622 data: Key Items pocket, important flag, and the
// native Rare Candy party effect. Clear its register flag because this patch
// installs only the Bag-to-party path, not PW2Code's shortcut-menu hooks.
// Retail slot 622 already maps to Key Items in BW2's ARM9 pocket table.
const ITEM_DATA_HEX = "00000000000000003f020100010000000005000000001c00000000000000000503020000";
const RETAIL_ITEM_DATA_HEX = "00000000000000001f020000000000ff0000000000000000000000000000000000000000";
const ITEM_DATA = fromHex(ITEM_DATA_HEX);

const LAYOUTS = {
  B: {
    ...bw1Manifest.games.B, openParty: 0, pocketTable: 0, openOverlay: 10,
    bw1: true, url: new URL("../assets/codeinjection/InfiniteCandyB.dll", import.meta.url),
  },
  W: {
    ...bw1Manifest.games.W, openParty: 0, pocketTable: 0, openOverlay: 10,
    bw1: true, url: new URL("../assets/codeinjection/InfiniteCandyW.dll", import.meta.url),
  },
  B2: {
    idCode: "IREO", fileName: "InfiniteCandyB2.dll",
    url: new URL("../assets/codeinjection/InfiniteCandyB2.dll", import.meta.url),
    openParty: 0x0215b86c, subItem: 0x0219e648, pocketTable: 0x0208f4d0, iconTable: 0x02090d50,
    openOverlay: 12, partyOverlay: 165, descriptionBank: 63, nameBank: 64, bw1: false,
  },
  W2: {
    idCode: "IRDO", fileName: "InfiniteCandyW2.dll",
    url: new URL("../assets/codeinjection/InfiniteCandyW2.dll", import.meta.url),
    openParty: 0x0215b8ac, subItem: 0x0219e688, pocketTable: 0x0208f4fc, iconTable: 0x02090d7c,
    openOverlay: 12, partyOverlay: 165, descriptionBank: 63, nameBank: 64, bw1: false,
  },
} as const;
type Version = keyof typeof LAYOUTS;
type Layout = typeof LAYOUTS[Version];

export type InfiniteCandyStatus = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  message: string;
  itemId?: number;
  maxItemId?: number;
};

/** Read configuration from the verified DLL, including after an export/reimport. */
export function getInstalledInfiniteCandyItemId(project: ProjectState): number | undefined {
  const version = project.session.baseVersion;
  if (!(version in LAYOUTS) || !project.originalRomBytes) return;
  const layout = LAYOUTS[version as Version], rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  const module = listCodeInjectionDlls(project).find(m => m.path.toLowerCase() === `patches/${layout.fileName}`.toLowerCase());
  if (!module) return;
  try {
    const bytes = codeInjectionModuleBytes(project, rom, module.path);
    const rpm = bytes && parseRpm(bytes, { allowedMagics: ["DLXF"] });
    return rpm && isOwnRuntime(rpm, version as Version) ? runtimeItemId(rpm, version as Version) : undefined;
  } catch { return; }
}

export function getInfiniteCandyStatus(project: ProjectState, selectedItemId?: number): InfiniteCandyStatus {
  const unsupported = (message: string): InfiniteCandyStatus => ({ supported: false, compatible: false, installed: false, message });
  const version = project.session.baseVersion;
  if ((project.session.baseRom !== "BW2" && project.session.baseRom !== "BW") || (version !== "B2" && version !== "W2" && version !== "B" && version !== "W")) {
    return unsupported("Infinite Candy supports US Black, White, Black 2 and White 2 revision 0.");
  }
  const layout = LAYOUTS[version];
  if ((project.session.baseRom === "BW") !== layout.bw1) return unsupported("ROM family does not match the project version.");
  if (layout.bw1 && (!bw1Manifest.games.B.dsAccepted || !bw1Manifest.games.W.dsAccepted)) {
    return unsupported("BW1 Infinite Candy awaits gameplay acceptance in both Black and White.");
  }
  if (project.romInfo.idCode !== layout.idCode) {
    return unsupported("Infinite Candy requires the audited US revision-0 ROM for this game.");
  }
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) {
    return unsupported("Item 622 is reserved by the installed BW2 upgrade patch.");
  }

  const modules = listCodeInjectionDlls(project).filter((module) => module.target === "patches");
  const ownPath = `patches/${layout.fileName}`;
  const installed = modules.some((module) => module.path.toLowerCase() === ownPath.toLowerCase());
  const installedItemId = getInstalledInfiniteCandyItemId(project);
  const itemId = selectedItemId ?? installedItemId ?? INFINITE_CANDY_ITEM_ID;
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 638 || itemId === 50) {
    return { supported: true, compatible: false, installed, itemId, message: "Choose an unused item ID from 1–638, excluding Rare Candy (50)." };
  }
  if (layout.bw1 && itemId !== INFINITE_CANDY_ITEM_ID) {
    return { supported: true, compatible: false, installed, itemId, message: "Black / White uses the verified item 622 build. Custom item IDs require Black 2 / White 2." };
  }
  if (installedItemId !== undefined && installedItemId !== itemId) {
    return { supported: true, compatible: false, installed, itemId, message: `Infinite Candy already uses item ${installedItemId}. Keep that ID when reinstalling.` };
  }
  if (itemId !== 622 && modules.some(m => /^PartyQuickActions(?:B2|W2)\.dll$/iu.test(m.fileName))) {
    return { supported: true, compatible: false, installed, itemId, message: "The installed Party Toolbar build requires Infinite Candy at item 622." };
  }
  const capsModules = modules.filter(m => /^HardLevelCaps(?:B2|W2)\.dll$/iu.test(m.fileName));
  if (capsModules.length > 1 || (capsModules.length && !getLevelCapsRuntime(project))) {
    return { supported: true, compatible: false, installed, itemId, message: project.originalRomBytes
      ? "The installed Hard Level Caps DLL is unrecognized or duplicated."
      : "Reload the ROM to verify the installed Hard Level Caps DLL." };
  }
  if ((!project.narcs.items || !project.narcs.message_texts) && project.originalRomBytes) {
    project = { ...project, narcs: { ...project.narcs }, texts: structuredClone(project.texts) };
    try {
      loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }), ["items", "message_texts"]);
    } catch (error) {
      return { supported: true, compatible: false, installed, message: error instanceof Error ? error.message : String(error) };
    }
  }
  const store = project.narcs.items;
  const item = store?.rawFiles[itemId];
  if (!item || !project.narcs.message_texts) {
    return { supported: true, compatible: false, installed, message: "Load the item and message archives before installing Infinite Candy." };
  }
  const occupiedSlot = (message: string): InfiniteCandyStatus => {
    // Keep explicit choices and installed IDs. Only offer the alternate when
    // its item data, text, native hooks and companion patches all pass.
    if (selectedItemId === undefined && !installed && !layout.bw1) {
      const alternate = getInfiniteCandyStatus(project, 113);
      if (alternate.compatible) return alternate;
    }
    return { supported: true, compatible: false, installed, itemId, message };
  };
  const itemHex = toHex(item);
  if (installedItemId === itemId ? itemHex !== ITEM_DATA_HEX
    : itemId === 622 ? itemHex !== (layout.bw1 ? layout.retailItemDataHex : RETAIL_ITEM_DATA_HEX)
    : item.length !== ITEM_DATA.length || item.some(byte => byte !== 0)) {
    return occupiedSlot(`Item ${itemId} already contains custom data; choose an unused slot.`);
  }
  try {
    textEntryIndex(project, layout.descriptionBank, itemId);
    const index = textEntryIndex(project, layout.nameBank, itemId);
    if (!layout.bw1 && installedItemId === undefined && !/^(?:\?+|unused|)$/iu.test(getTextBank(project, "message_texts", layout.nameBank)[index]![1].trim())) {
      return occupiedSlot(`Item ${itemId} has an existing name; choose an unused slot.`);
    }
  } catch {
    return { supported: true, compatible: false, installed, message: "Item 622 name or description is missing from the item message banks." };
  }

  if (project.originalRomBytes) {
    try {
      const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
      if (rom.idCode !== layout.idCode || rom.data[0x1e] !== 0) {
        return { supported: true, compatible: false, installed, message: "The loaded ROM does not match the project version." };
      }
      const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
      const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([layout.openOverlay, layout.partyOverlay]));
      const openPartyBytes = project.overlays[layout.openOverlay] ?? overlays.get(layout.openOverlay)?.data;
      const subItemBytes = project.overlays[layout.partyOverlay] ?? overlays.get(layout.partyOverlay)?.data;
      if (!openPartyBytes || !subItemBytes
        || (!layout.bw1 && toHex(openPartyBytes.subarray(layout.openParty - overlays.get(layout.openOverlay)!.ramAddress, layout.openParty - overlays.get(layout.openOverlay)!.ramAddress + 4)) !== "ac308742")
        || toHex(subItemBytes.subarray(layout.subItem - overlays.get(layout.partyOverlay)!.ramAddress, layout.subItem - overlays.get(layout.partyOverlay)!.ramAddress + 8)) !== (layout.bw1 ? "08b5031c0a208001" : "08b5031ca3208000")) {
        return { supported: true, compatible: false, installed, message: "The party item hooks differ from the audited US code." };
      }
      if (!layout.bw1 && (itemId === 622 || installed) && arm9[layout.pocketTable - rom.arm9RamAddress + itemId] !== 4) {
        return { supported: true, compatible: false, installed, message: "Item 622 no longer maps to the Key Items pocket." };
      }
      if (layout.bw1) for (const signature of layout.signatures) {
        const data = signature.module === "ARM9" ? arm9 : subItemBytes;
        const base = signature.module === "ARM9" ? rom.arm9RamAddress : overlays.get(layout.partyOverlay)!.ramAddress;
        if (toHex(data.subarray(signature.address - base, signature.address - base + signature.expectedHex.length / 2)) !== signature.expectedHex) {
          throw new Error("The BW1 medicine or native item-consumption code differs from the verified profile.");
        }
      }
      const iconTableOffset = layout.iconTable - rom.arm9RamAddress;
      if (readU16(arm9, iconTableOffset + 50 * 4) !== 90
        || readU16(arm9, iconTableOffset + 50 * 4 + 2) !== 91
        || (itemId === 622 && (readU16(arm9, iconTableOffset + itemId * 4) !== 827
          || readU16(arm9, iconTableOffset + itemId * 4 + 2) !== 828))
        || (installed && itemId !== 622 && (readU16(arm9, iconTableOffset + itemId * 4) !== 90
          || readU16(arm9, iconTableOffset + itemId * 4 + 2) !== 91))) {
        return { supported: true, compatible: false, installed, message: "Item 622's icon slots differ from the audited native mapping." };
      }
      const iconNarcId = rom.filenames.idOf("a/0/2/5");
      if (iconNarcId === undefined) {
        return { supported: true, compatible: false, installed, message: "The item icon archive is missing." };
      }
      const iconNarc = new NARC(getRomFileBytes(project, rom, iconNarcId));
      if (!iconNarc.files[90] || !iconNarc.files[91] || !iconNarc.files[827] || !iconNarc.files[828]
        || (itemId === 622 && !installed && (fnv1a(iconNarc.files[827]) !== 0x4ffcab15 || fnv1a(iconNarc.files[828]) !== 0xa2acc6cc))) {
        return { supported: true, compatible: false, installed, message: "Item 622's icon slots have custom or missing graphics." };
      }
      for (const module of modules) {
        const bytes = codeInjectionModuleBytes(project, rom, module.path);
        if (!bytes) continue;
        let rpm: RpmModule;
        try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
        if (module.path.toLowerCase() === ownPath.toLowerCase()) {
          if (!isOwnRuntime(rpm, version)) {
            return { supported: true, compatible: false, installed, message: "An unrecognized DLL uses the Infinite Candy filename." };
          }
        } else if (overlapsCandyHooks(rpm, layout)) {
          return { supported: true, compatible: false, installed, message: `The ${module.fileName} DLL already hooks Infinite Candy's party path.` };
        }
      }
    } catch {
      return { supported: true, compatible: false, installed, message: "Could not verify the native party code and item mapping." };
    }
  }

  return {
    supported: true, compatible: true, installed, itemId, maxItemId: Math.min(638, store.rawFiles.length - 1),
    message: installed ? `Infinite Candy is installed as item ${itemId} in Key Items. Export the ROM to apply staged changes.`
      : `Installs Infinite Candy as item ${itemId} in Key Items.`,
  };
}

export async function installInfiniteCandy(project: ProjectState, itemId?: number): Promise<CodeInjectionDllInstallResult> {
  const staged: ProjectState = { ...project, arm9: project.arm9.slice(), overlays: structuredClone(project.overlays),
    narcs: structuredClone(project.narcs), texts: structuredClone(project.texts), fileSystem: structuredClone(project.fileSystem),
    codeInjection: structuredClone(project.codeInjection), patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog) };
  const result = await stageInfiniteCandy(staged, itemId);
  Object.assign(project, { originalRomBytes: staged.originalRomBytes, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty,
    overlays: staged.overlays, narcs: staged.narcs, texts: staged.texts, fileSystem: staged.fileSystem,
    codeInjection: staged.codeInjection, patches: staged.patches, actionChangelog: staged.actionChangelog });
  return result;
}

async function stageInfiniteCandy(project: ProjectState, selectedItemId?: number): Promise<CodeInjectionDllInstallResult> {
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing Infinite Candy.");
  loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }), ["items", "message_texts"]);
  const status = getInfiniteCandyStatus(project, selectedItemId);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const version = project.session.baseVersion as Version;
  const layout = LAYOUTS[version];
  const itemId = status.itemId!;
  const response = await fetch(layout.url);
  if (!response.ok) throw new Error(`Could not load Infinite Candy (${response.status}).`);
  let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  if (!isOwnRuntime(rpm, version) || runtimeItemId(rpm, version) !== 622) {
    throw new Error("The bundled Infinite Candy DLL does not match its game hook contract.");
  }
  if (!layout.bw1 && itemId !== 622) {
    for (const offset of bw2Manifest.games[version as "B2" | "W2"].itemIdOffsets) writeU32(rpm.code, offset, itemId);
    bytes = writeRpm(rpm, { ident: "DLXF" });
    if (!isOwnRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }), version)) throw new Error("Infinite Candy configuration failed verification.");
  }
  await synchronizeLevelCapsForCandy(project, itemId);
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const result = stageCodeInjectionDll(project, layout.fileName, bytes);
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  const iconNarcId = rom.filenames.idOf("a/0/2/5")!;
  const iconNarc = new NARC(getRomFileBytes(project, rom, iconNarcId));
  if (itemId === 622) {
    replaceNarcFile(project, rom, iconNarcId, 827, iconNarc.files[90]!.slice());
    replaceNarcFile(project, rom, iconNarcId, 828, iconNarc.files[91]!.slice());
  } else {
    project.arm9[layout.pocketTable - rom.arm9RamAddress + itemId] = 4;
    writeU16(project.arm9, layout.iconTable - rom.arm9RamAddress + itemId * 4, 90);
    writeU16(project.arm9, layout.iconTable - rom.arm9RamAddress + itemId * 4 + 2, 91);
    project.arm9Dirty = true;
  }
  const itemStore = project.narcs.items!;
  itemStore.rawFiles[itemId] = ITEM_DATA.slice();
  itemStore.records.delete(itemId);
  markDirty(project, "items", itemId);
  updateTextEntry(project, "message_texts", layout.descriptionBank, textEntryIndex(project, layout.descriptionBank, itemId), INFINITE_CANDY_DESCRIPTION);
  updateTextEntry(project, "message_texts", layout.nameBank, textEntryIndex(project, layout.nameBank, itemId), INFINITE_CANDY_NAME);
  recordGenericChange(project, "code_injection", `Infinite Candy installed in Key Items at item ${itemId}; party use retains the item.`, "Infinite Candy", {
    key: "code-injection:infinite-candy",
  });
  return result;
}

function textEntryIndex(project: ProjectState, bankId: number, itemId: number): number {
  const bank = getTextBank(project, "message_texts", bankId);
  const index = bank.findIndex((entry) => parseTextEntryId(entry[0]).entry === itemId);
  if (index < 0) throw new Error(`Item ${itemId} text is missing from bank ${bankId}.`);
  return index;
}

function codeInjectionModuleBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const stagedPath = Object.keys(project.fileSystem?.additions ?? {}).find((entry) => entry.toLowerCase() === path.toLowerCase());
  if (stagedPath) return project.fileSystem?.additions?.[stagedPath];
  const fileId = rom.filenames.idOf(path);
  return fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId);
}

function isOwnRuntime(rpm: RpmModule, version: Version): boolean {
  const layout = LAYOUTS[version];
  const targets = rpm.relocations.map(({ target }) => `${target.type}:${target.module}:${target.address}`).sort();
  if (layout.bw1) return rpm.metadata.PMCGameID === version && rpm.metadata.PMCVersion === bw1Manifest.version
    && rpm.metadata.PMCModulePriority === 4 && rpm.bssSize === 0 && !rpm.baseAddress
    && fnv1a(rpm.code).toString(16).padStart(8, "0") === layout.codeFingerprint
    && targets.join("|") === [`THUMB_BRANCH_LINK:base:${0x16}`, `THUMB_BRANCH:91:${layout.subItem}`].sort().join("|");
  const template = bw2Manifest.games[version as "B2" | "W2"], normalized = rpm.code.slice();
  const id = runtimeItemId(rpm, version);
  if (id < 1 || id > 638 || id === 50 || template.itemIdOffsets.some(offset => readU32(rpm.code, offset) !== id)) return false;
  for (const offset of template.itemIdOffsets) writeU32(normalized, offset, 622);
  const symbolTypes = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"];
  return toHex(normalized) === template.codeHex && !rpm.baseAddress
    && template.relocations.every(r => rpm.relocations.some(actual => {
      const symbol = rpm.symbols[actual.sourceSymbolIndex], expected = template.symbols[r.symbol];
      return actual.target.module === r.module && actual.target.address === r.address && actual.target.type === r.type
        && symbol?.address === expected.address && symbol.type === symbolTypes[expected.type] && symbol.attributes === expected.attributes;
    })) && rpm.metadata.PMCGameID === version && rpm.metadata.PMCVersion === "1.0.0"
    && rpm.metadata.PMCModulePriority === 4 && rpm.bssSize === 0 && rpm.relocations.length === 3
    && targets.join("|") === [
      `THUMB_BRANCH_LINK:base:${0x2a}`, `THUMB_BRANCH_LINK:12:${layout.openParty}`, `THUMB_BRANCH:165:${layout.subItem}`,
    ].sort().join("|");
}

function runtimeItemId(rpm: RpmModule, version: Version): number {
  return LAYOUTS[version].bw1 ? 622 : readU32(rpm.code, bw2Manifest.games[version as "B2" | "W2"].itemIdOffsets[0]!);
}

function overlapsCandyHooks(rpm: RpmModule, layout: Layout): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
    return (!layout.bw1 && target.module === String(layout.openOverlay) && target.address < layout.openParty + 4 && target.address + size > layout.openParty)
      || (target.module === String(layout.partyOverlay) && target.address < layout.subItem + 8 && target.address + size > layout.subItem);
  });
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu)!.map((pair) => parseInt(pair, 16)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}
