import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { readU16 } from "../nds/binary";
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
import { parseRpm, type RpmModule } from "./rpm";
import { getTextBank, parseTextEntryId, updateTextEntry } from "./textModel";

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
  B2: {
    idCode: "IREO", fileName: "InfiniteCandyB2.dll",
    url: new URL("../assets/codeinjection/InfiniteCandyB2.dll", import.meta.url),
    openParty: 0x0215b86c, subItem: 0x0219e648, pocketTable: 0x0208f4d0, iconTable: 0x02090d50,
  },
  W2: {
    idCode: "IRDO", fileName: "InfiniteCandyW2.dll",
    url: new URL("../assets/codeinjection/InfiniteCandyW2.dll", import.meta.url),
    openParty: 0x0215b8ac, subItem: 0x0219e688, pocketTable: 0x0208f4fc, iconTable: 0x02090d7c,
  },
} as const;
type Version = keyof typeof LAYOUTS;
type Layout = typeof LAYOUTS[Version];

export type InfiniteCandyStatus = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  message: string;
};

export function getInfiniteCandyStatus(project: ProjectState): InfiniteCandyStatus {
  const unsupported = (message: string): InfiniteCandyStatus => ({ supported: false, compatible: false, installed: false, message });
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2")) {
    return unsupported("Infinite Candy supports US Black 2 and White 2 only.");
  }
  const layout = LAYOUTS[version];
  if (project.romInfo.idCode !== layout.idCode) {
    return unsupported("Infinite Candy requires a US Black 2 or White 2 ROM.");
  }
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) {
    return unsupported("Item 622 is reserved by the installed BW2 upgrade patch.");
  }

  const modules = listCodeInjectionDlls(project).filter((module) => module.target === "patches");
  const ownPath = `patches/${layout.fileName}`;
  const installed = modules.some((module) => module.path.toLowerCase() === ownPath.toLowerCase());
  const store = project.narcs.items;
  const item = store?.rawFiles[INFINITE_CANDY_ITEM_ID];
  if (!item || !project.narcs.message_texts) {
    return { supported: true, compatible: false, installed, message: "Load the BW2 item and message archives before installing Infinite Candy." };
  }
  const itemHex = toHex(item);
  if (itemHex !== RETAIL_ITEM_DATA_HEX && itemHex !== ITEM_DATA_HEX) {
    return { supported: true, compatible: false, installed, message: "Item 622 already contains custom data; Infinite Candy will not overwrite it." };
  }
  try {
    textEntryIndex(project, 63, INFINITE_CANDY_ITEM_ID);
    textEntryIndex(project, 64, INFINITE_CANDY_ITEM_ID);
  } catch {
    return { supported: true, compatible: false, installed, message: "Item 622 name or description is missing from the BW2 message banks." };
  }

  if (project.originalRomBytes) {
    try {
      const rom = new NintendoDSRom(project.originalRomBytes);
      if (rom.idCode !== layout.idCode) {
        return { supported: true, compatible: false, installed, message: "The loaded ROM does not match the project version." };
      }
      const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
      const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([12, 165]));
      const openPartyBytes = project.overlays[12] ?? overlays.get(12)?.data;
      const subItemBytes = project.overlays[165] ?? overlays.get(165)?.data;
      if (!openPartyBytes || !subItemBytes
        || toHex(openPartyBytes.subarray(layout.openParty - overlays.get(12)!.ramAddress, layout.openParty - overlays.get(12)!.ramAddress + 4)) !== "ac308742"
        || toHex(subItemBytes.subarray(layout.subItem - overlays.get(165)!.ramAddress, layout.subItem - overlays.get(165)!.ramAddress + 8)) !== "08b5031ca3208000") {
        return { supported: true, compatible: false, installed, message: "The party item hooks differ from the audited US BW2 code." };
      }
      if (arm9[layout.pocketTable - rom.arm9RamAddress + INFINITE_CANDY_ITEM_ID] !== 4) {
        return { supported: true, compatible: false, installed, message: "Item 622 no longer maps to the Key Items pocket." };
      }
      const iconTableOffset = layout.iconTable - rom.arm9RamAddress;
      if (readU16(arm9, iconTableOffset + 50 * 4) !== 90
        || readU16(arm9, iconTableOffset + 50 * 4 + 2) !== 91
        || readU16(arm9, iconTableOffset + INFINITE_CANDY_ITEM_ID * 4) !== 827
        || readU16(arm9, iconTableOffset + INFINITE_CANDY_ITEM_ID * 4 + 2) !== 828) {
        return { supported: true, compatible: false, installed, message: "Item 622's icon slots differ from the audited BW2 mapping." };
      }
      const iconNarcId = rom.filenames.idOf("a/0/2/5");
      if (iconNarcId === undefined) {
        return { supported: true, compatible: false, installed, message: "The BW2 item icon archive is missing." };
      }
      const iconNarc = new NARC(getRomFileBytes(project, rom, iconNarcId));
      if (!iconNarc.files[90] || !iconNarc.files[91] || !iconNarc.files[827] || !iconNarc.files[828]
        || (!installed && (fnv1a(iconNarc.files[827]) !== 0x4ffcab15 || fnv1a(iconNarc.files[828]) !== 0xa2acc6cc))) {
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
      return { supported: true, compatible: false, installed, message: "Could not verify the BW2 party code and item pocket table." };
    }
  }

  return {
    supported: true, compatible: true, installed,
    message: installed ? "Infinite Candy is installed as item 622 in Key Items. Export the ROM to apply staged changes."
      : "Installs PMC when needed, adds item 622 to Key Items, and leaves Rare Candy unchanged.",
  };
}

export async function installInfiniteCandy(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing Infinite Candy.");
  const status = getInfiniteCandyStatus(project);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const version = project.session.baseVersion as Version;
  const layout = LAYOUTS[version];
  const response = await fetch(layout.url);
  if (!response.ok) throw new Error(`Could not load Infinite Candy (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isOwnRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }), version)) {
    throw new Error("The bundled Infinite Candy DLL does not match its BW2 hook contract.");
  }
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const result = stageCodeInjectionDll(project, layout.fileName, bytes);
  const rom = new NintendoDSRom(project.originalRomBytes);
  const iconNarcId = rom.filenames.idOf("a/0/2/5")!;
  const iconNarc = new NARC(getRomFileBytes(project, rom, iconNarcId));
  replaceNarcFile(project, rom, iconNarcId, 827, iconNarc.files[90]!.slice());
  replaceNarcFile(project, rom, iconNarcId, 828, iconNarc.files[91]!.slice());
  const itemStore = project.narcs.items!;
  itemStore.rawFiles[INFINITE_CANDY_ITEM_ID] = ITEM_DATA.slice();
  itemStore.records.delete(INFINITE_CANDY_ITEM_ID);
  markDirty(project, "items", INFINITE_CANDY_ITEM_ID);
  updateTextEntry(project, "message_texts", 63, textEntryIndex(project, 63, INFINITE_CANDY_ITEM_ID), INFINITE_CANDY_DESCRIPTION);
  updateTextEntry(project, "message_texts", 64, textEntryIndex(project, 64, INFINITE_CANDY_ITEM_ID), INFINITE_CANDY_NAME);
  recordGenericChange(project, "code_injection", "Infinite Candy installed in Key Items at item 622; party use retains the item.", "Infinite Candy", {
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
  return rpm.metadata.PMCGameID === version && rpm.metadata.PMCVersion === "1.0.0"
    && rpm.metadata.PMCModulePriority === 4 && rpm.bssSize === 0 && rpm.relocations.length === 3
    && targets.join("|") === [
      `THUMB_BRANCH_LINK:base:${0x2a}`, `THUMB_BRANCH_LINK:12:${layout.openParty}`, `THUMB_BRANCH:165:${layout.subItem}`,
    ].sort().join("|");
}

function overlapsCandyHooks(rpm: RpmModule, layout: Layout): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
    return (target.module === "12" && target.address < layout.openParty + 4 && target.address + size > layout.openParty)
      || (target.module === "165" && target.address < layout.subItem + 8 && target.address + size > layout.subItem);
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
