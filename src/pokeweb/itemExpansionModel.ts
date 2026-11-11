import manifest from "../assets/codeinjection/itemExpansionManifest.json";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { battleLogSaveGuard, type BattleLogGuardVersion } from "./battleLogSaveGuard";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import {
  convertSaveToExpanded, convertSaveToRetail, detectSaveFormat, validateExpandedBag, type ItemSaveConversionReport,
  type ItemSaveRules, type SaveFamily,
} from "./itemSaveFormat";
import { canRemoveStagedCodeInjectionDll, detectBlack2UpgradeDlls, detectWhite2UpgradeDlls, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import { markDirty, type ProjectState } from "./projectStore";
import { commitTextBank, getTextBank } from "./textModel";

/**
 * Item expansion: item IDs 0-1023, pokebw2's shared 1,023-slot bag and its save format (Black 2 / White 2, and the
 * same design on Black / White).
 *
 * PMC DLLs (runtime/item-expansion): a resident core (save format, admission, pool bag API, item ID range) and
 * overlay-scoped parts (Black 2 / White 2: field bag 142, battle bag 286, field 36, battle 167; Black / White: field
 * bag 70, battle bag 197, field 21, battle 93). Battle Log's save guard is a dependency: it keeps the retail Wi-Fi /
 * Pal Pad code away from the save blocks this format resizes. Items above the retail range (639-1023, or 627-1023 on
 * Black / White) start as "???" placeholders; naming one in the item editor makes it exist (see catalogFor).
 */

export type ItemExpansionVersion = "B2" | "W2" | "B" | "W";
type Part = "core" | "bag" | "battleBag" | "field" | "battle";
const PART_ORDER: Part[] = ["core", "bag", "battleBag", "field", "battle"];

export const ITEM_CAPACITY = 1024;
/** Black 2 / White 2 values (see itemFamily for both families). */
export const NATIVE_ITEM_COUNT = 639;
export const ITEM_TEXT_BANKS = { descriptions: 63, names: 64, articles: 481, plurals: 482 } as const;
const PLACEHOLDER = "???";

type ItemFamily = {
  save: SaveFamily;
  nativeCount: number;
  textBanks: { descriptions: number; names: number; articles: number; plurals: number };
  battlePocketArchive: string;
  iconNone: [number, number];
  /** The retail pockets table ("PWIP") the Black / White DLLs carry. */
  pocketTable: boolean;
  /** The parts that carry the item tables Pokeweb rewrites. */
  tableParts: Part[];
  games: string;
};
const FAMILIES: Record<"BW2" | "BW1", ItemFamily> = {
  BW2: { save: "BW2", nativeCount: NATIVE_ITEM_COUNT, textBanks: ITEM_TEXT_BANKS, battlePocketArchive: "a/2/2/8",
    iconNone: [1021, 1022], pocketTable: false, tableParts: ["core", "bag", "battleBag", "field"], games: "Black 2 / White 2" },
  BW1: { save: "BW1", nativeCount: 627, textBanks: { descriptions: 53, names: 54, articles: 279, plurals: 280 },
    battlePocketArchive: "a/2/3/2", iconNone: [1001, 1002], pocketTable: true, tableParts: ["core"], games: "Black / White" },
};
const familyOf = (version: ItemExpansionVersion): ItemFamily => FAMILIES[version === "B" || version === "W" ? "BW1" : "BW2"];

/** The project's item family (Black / White values for a Black / White ROM, else Black 2 / White 2). */
export function itemFamily(project: ProjectState): ItemFamily {
  return FAMILIES[project.session.baseRom === "BW" ? "BW1" : "BW2"];
}

const DLL_URLS: Record<ItemExpansionVersion, Partial<Record<Part, URL>>> = {
  W2: {
    core: new URL("../assets/codeinjection/PokewebItemsCoreW2.dll", import.meta.url),
    bag: new URL("../assets/codeinjection/PokewebItemsBagW2.dll", import.meta.url),
    battleBag: new URL("../assets/codeinjection/PokewebItemsBattleBagW2.dll", import.meta.url),
    field: new URL("../assets/codeinjection/PokewebItemsFieldW2.dll", import.meta.url),
    battle: new URL("../assets/codeinjection/PokewebItemsBattleW2.dll", import.meta.url),
  },
  B2: {
    core: new URL("../assets/codeinjection/PokewebItemsCoreB2.dll", import.meta.url),
    bag: new URL("../assets/codeinjection/PokewebItemsBagB2.dll", import.meta.url),
    battleBag: new URL("../assets/codeinjection/PokewebItemsBattleBagB2.dll", import.meta.url),
    field: new URL("../assets/codeinjection/PokewebItemsFieldB2.dll", import.meta.url),
    battle: new URL("../assets/codeinjection/PokewebItemsBattleB2.dll", import.meta.url),
  },
  B: {
    core: new URL("../assets/codeinjection/PokewebItemsCoreB.dll", import.meta.url),
    bag: new URL("../assets/codeinjection/PokewebItemsBagB.dll", import.meta.url),
    battleBag: new URL("../assets/codeinjection/PokewebItemsBattleBagB.dll", import.meta.url),
    field: new URL("../assets/codeinjection/PokewebItemsFieldB.dll", import.meta.url),
    battle: new URL("../assets/codeinjection/PokewebItemsBattleB.dll", import.meta.url),
  },
  W: {
    core: new URL("../assets/codeinjection/PokewebItemsCoreW.dll", import.meta.url),
    bag: new URL("../assets/codeinjection/PokewebItemsBagW.dll", import.meta.url),
    battleBag: new URL("../assets/codeinjection/PokewebItemsBattleBagW.dll", import.meta.url),
    field: new URL("../assets/codeinjection/PokewebItemsFieldW.dll", import.meta.url),
    battle: new URL("../assets/codeinjection/PokewebItemsBattleW.dll", import.meta.url),
  },
};

type GameManifest = { dlls: Partial<Record<Part, { fileName: string; sha256: string; size: number }>> };
const games = manifest.games as Partial<Record<ItemExpansionVersion, GameManifest>>;
/** The game's DLL parts, in order: the ones its manifest and bundled URLs both have. */
const partsOf = (version: ItemExpansionVersion): Part[] => PART_ORDER.filter((part) => games[version]?.dlls[part] && DLL_URLS[version][part]);

export type ItemExpansionStatus = {
  supported: boolean;
  installed: boolean;
  complete: boolean;
  updateAvailable: boolean;
  compatible: boolean;
  canUninstall: boolean;
  authoredExtraItems: number;
  message: string;
};

export function itemExpansionVersion(project: ProjectState): ItemExpansionVersion | undefined {
  const version = project.session.baseVersion;
  return (version === "W2" || version === "B2" || version === "B" || version === "W") && games[version] ? version : undefined;
}

function dllPath(version: ItemExpansionVersion, part: Part): string {
  return `patches/${games[version]!.dlls[part]!.fileName}`;
}

function stagedPaths(project: ProjectState, version: ItemExpansionVersion): Part[] {
  const paths = new Set(listCodeInjectionDlls(project).map((module) => module.path.toLowerCase()));
  return partsOf(version).filter((part) => paths.has(dllPath(version, part).toLowerCase()));
}

export function isItemExpansionInstalled(project: ProjectState): boolean {
  const version = itemExpansionVersion(project);
  return Boolean(version && project.codeInjection?.itemExpansion && stagedPaths(project, version).length > 0);
}

export function getItemExpansionStatus(project: ProjectState): ItemExpansionStatus {
  const version = itemExpansionVersion(project);
  const status: ItemExpansionStatus = { supported: false, installed: false, complete: false, updateAvailable: false, compatible: false, canUninstall: false, authoredExtraItems: 0, message: "" };
  if (!version) return { ...status, message: "The item expansion supports US Black, White, Black 2 and White 2." };
  status.supported = true;
  const parts = stagedPaths(project, version);
  status.installed = parts.length > 0 && Boolean(project.codeInjection?.itemExpansion);
  status.complete = parts.length === partsOf(version).length;
  status.updateAvailable = status.installed && (!status.complete || project.codeInjection?.itemExpansion?.version !== manifest.version);
  status.canUninstall = status.installed && parts.every((part) => canRemoveStagedCodeInjectionDll(project, dllPath(version, part)));
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) {
    return { ...status, message: "White 2 Upgrade / Black 2 Upgrade manage their own items and save format." };
  }
  status.compatible = true;
  if (project.narcs.items && project.narcs.message_texts) status.authoredExtraItems = catalogFor(project).filter((entry) => entry.authored).length;
  status.message = status.installed ? "Item expansion is installed." : "Ready to install.";
  return status;
}

function openRom(project: ProjectState): NintendoDSRom {
  if (!project.originalRomBytes) throw new Error("Reload the ROM before changing the item expansion.");
  return new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname.split("/").pop()}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Pads the item data archive and the four item text banks to 1,024 entries. Idempotent. */
function padItemData(project: ProjectState): number {
  const family = itemFamily(project);
  const store = project.narcs.items!;
  const template = store.rawFiles[0] ?? new Uint8Array(36);
  let added = 0;
  while (store.rawFiles.length < ITEM_CAPACITY) {
    const id = store.rawFiles.length;
    store.rawFiles.push(new Uint8Array(template.length));
    store.records.delete(id);
    markDirty(project, "items", id);
    added++;
  }
  store.fileCount = store.rawFiles.length;
  for (const [kind, bankId] of Object.entries(family.textBanks)) {
    const bank = getTextBank(project, "message_texts", bankId);
    if (bank.length >= ITEM_CAPACITY) continue;
    for (let entry = bank.length; entry < ITEM_CAPACITY; entry++) bank.push([`0_${entry}`, kind === "descriptions" ? "" : PLACEHOLDER, 0]);
    commitTextBank(project, "message_texts", bankId);
  }
  return added;
}

/** The battle bag pockets per item (archive 228; 232 on Black / White) grow to 1,024 bytes; retail bytes are kept. */
function battlePocketArchive(project: ProjectState, rom: NintendoDSRom): { id: number; narc: NARC } {
  const id = rom.filenames.idOf(itemFamily(project).battlePocketArchive);
  if (id === undefined) throw new Error("The battle bag pocket archive is missing.");
  return { id, narc: new NARC(getRomFileBytes(project, rom, id)) };
}

export type ItemCatalogEntry = {
  id: number;
  authored: boolean;
  pocket: number;
  battlePockets: number;
  holdable: boolean;
  icon: [number, number];
};

/** Items above the retail range: an item exists once it has a name; pocket and battle pockets come from its data. */
export function catalogFor(project: ProjectState): ItemCatalogEntry[] {
  const store = project.narcs.items;
  if (!store) throw new Error("Item data is not loaded.");
  const family = itemFamily(project);
  const names = getTextBank(project, "message_texts", family.textBanks.names);
  const icons = project.codeInjection?.itemExpansion?.icons ?? {};
  const entries: ItemCatalogEntry[] = [];
  for (let id = family.nativeCount; id < ITEM_CAPACITY; id++) {
    const record = store.rawFiles[id];
    const name = names[id]?.[1]?.trim() ?? "";
    const attributes = record && record.length >= 10 ? record[8] | (record[9] << 8) : 0;
    const pocket = (attributes >> 7) & 0xf;
    const authored = name !== "" && name !== PLACEHOLDER && pocket <= 4;
    entries.push({ id, authored, pocket: authored ? pocket : 0, battlePockets: authored ? (attributes >> 11) & 0x1f : 0,
      holdable: authored && pocket !== 2 && pocket !== 4, icon: icons[id] ?? family.iconNone });
  }
  return entries;
}

/** Sort-by-name ranks for every ID (the bag's name sort); unnamed IDs sort last. */
export function sortRanksFor(project: ProjectState): number[] {
  const family = itemFamily(project);
  const names = getTextBank(project, "message_texts", family.textBanks.names);
  const catalog = new Map(catalogFor(project).map((entry) => [entry.id, entry]));
  const ids = [...Array(ITEM_CAPACITY).keys()].filter((id) => id > 0 && (id < family.nativeCount || catalog.get(id)?.authored));
  ids.sort((a, b) => (names[a]?.[1] ?? "").localeCompare(names[b]?.[1] ?? "", "en", { sensitivity: "base" }) || a - b);
  const ranks = new Array<number>(ITEM_CAPACITY).fill(0xffff);
  ids.forEach((id, rank) => { ranks[id] = rank; });
  ranks[0] = 0;
  return ranks;
}

function findTag(bytes: Uint8Array, tag: string, version: number): number {
  const code = [...tag].map((c) => c.charCodeAt(0));
  for (let i = 0; i + 8 <= bytes.length; i += 4) {
    if (code.every((c, n) => bytes[i + n] === c) && bytes[i + 4] === version && bytes[i + 5] === 0) return i;
  }
  return -1;
}

function writeTables(bytes: Uint8Array, catalog: ItemCatalogEntry[], nativeCount: number, ranks?: number[], pockets?: number[]): Uint8Array {
  const out = bytes.slice();
  const at = findTag(out, "PWIC", 1);
  if (at < 0) throw new Error("An item expansion DLL has no catalog table.");
  if ((out[at + 6] | (out[at + 7] << 8)) !== nativeCount || (out[at + 8] | (out[at + 9] << 8)) !== ITEM_CAPACITY - nativeCount) {
    throw new Error("An item expansion DLL has an unexpected catalog table.");
  }
  catalog.forEach((entry, index) => {
    const o = at + 12 + index * 8;
    out[o] = entry.icon[0] & 0xff; out[o + 1] = entry.icon[0] >> 8;
    out[o + 2] = entry.icon[1] & 0xff; out[o + 3] = entry.icon[1] >> 8;
    out[o + 4] = entry.pocket;
    out[o + 5] = (entry.authored ? 1 : 0) | (entry.holdable ? 2 : 0);
    out[o + 6] = entry.battlePockets;
    out[o + 7] = 0;
  });
  if (ranks) {
    const r = findTag(out, "PWIR", 1);
    if (r < 0) throw new Error("The bag DLL has no rank table.");
    ranks.forEach((rank, id) => { out[r + 8 + id * 2] = rank & 0xff; out[r + 9 + id * 2] = rank >> 8; });
  }
  if (pockets) {
    // Black / White: the retail IDs' pockets (the game reads them out of each item's data file).
    const p = findTag(out, "PWIP", 1);
    if (p < 0 || (out[p + 6] | (out[p + 7] << 8)) !== pockets.length) throw new Error("A Black / White item expansion DLL has no pocket table.");
    pockets.forEach((pocket, id) => { out[p + 8 + id] = pocket; });
  }
  return out;
}

/** Black / White: the pocket of every retail ID 0-626 from its item data (0xff for none). */
function retailPocketsFor(project: ProjectState): number[] {
  const store = project.narcs.items!;
  return [...Array(itemFamily(project).nativeCount).keys()].map((id) => {
    const record = store.rawFiles[id];
    if (id === 0 || !record || record.length < 10) return 0xff;
    const pocket = ((record[8] | (record[9] << 8)) >> 7) & 0xf;
    return pocket <= 4 ? pocket : 0xff;
  });
}

/**
 * Rewrites the DLL tables and archive 228 from the project's current item data and names. Called on install and
 * before every export, so item edits never leave the runtime describing different items than the ROM.
 */
export function materializeItemExpansionTables(project: ProjectState, rom: NintendoDSRom = openRom(project)): void {
  const version = itemExpansionVersion(project);
  if (!version || !isItemExpansionInstalled(project)) return;
  loadCodeInjectionNarcs(project, rom, ["items", "message_texts"]);
  padItemData(project);
  const family = familyOf(version);
  const catalog = catalogFor(project);
  const ranks = sortRanksFor(project);
  const pockets = family.pocketTable ? retailPocketsFor(project) : undefined;
  const additions = project.fileSystem?.additions ?? {};
  for (const part of stagedPaths(project, version)) {
    const path = Object.keys(additions).find((candidate) => candidate.toLowerCase() === dllPath(version, part).toLowerCase());
    if (!path || !family.tableParts.includes(part)) continue;
    additions[path] = writeTables(additions[path], catalog, family.nativeCount, part === "bag" && !family.pocketTable ? ranks : undefined, pockets);
  }
  const { id, narc } = battlePocketArchive(project, rom);
  const flags = narc.files[0] ?? new Uint8Array();
  if (flags.length < family.nativeCount) throw new Error("The battle bag pocket archive is incomplete.");
  const next = new Uint8Array(ITEM_CAPACITY);
  next.set(flags.subarray(0, family.nativeCount));
  for (const entry of catalog) next[entry.id] = entry.battlePockets;
  if (flags.length !== next.length || flags.some((value, index) => value !== next[index])) {
    narc.files[0] = next;
    setRomFileReplacement(project, id, narc.save());
  }
}

export type ItemExpansionInstallResult = { addedItemSlots: number; dlls: string[] };

/** Install (or update) on a staged project; use through installCodeInjectionPatch. */
export async function stageItemExpansion(project: ProjectState): Promise<ItemExpansionInstallResult> {
  const version = itemExpansionVersion(project);
  if (!version) throw new Error("The item expansion supports US Black, White, Black 2 and White 2.");
  const status = getItemExpansionStatus(project);
  if (!status.compatible) throw new Error(status.message);
  const rom = openRom(project);
  const game = games[version]!;
  const parts = await Promise.all(partsOf(version).map(async (part) => [part, await fetchBytes(DLL_URLS[version][part]!)] as const));
  for (const [part, bytes] of parts) {
    if ((await sha256Hex(bytes)) !== game.dlls[part]!.sha256) throw new Error(`Bundled ${game.dlls[part]!.fileName} is invalid; reload Pokeweb.`);
  }
  const guard = battleLogSaveGuard(version as BattleLogGuardVersion);
  const guardBytes = await fetchBytes(new URL(guard.url));
  loadCodeInjectionNarcs(project, rom, ["items", "message_texts"]);
  const addedItemSlots = padItemData(project);
  for (const [part, bytes] of parts) stageCodeInjectionDll(project, game.dlls[part]!.fileName, bytes, "patches", project.originalRomBytes);
  if (!listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === guard.path.toLowerCase())) {
    stageCodeInjectionDll(project, guard.filename, guardBytes, "patches", project.originalRomBytes);
  }
  project.codeInjection ??= {};
  project.codeInjection.itemExpansion = { version: manifest.version, icons: project.codeInjection.itemExpansion?.icons ?? {} };
  materializeItemExpansionTables(project, rom);
  recordGenericChange(project, "code_injection",
    `Item expansion v${manifest.version}: item IDs up to 1023 (${addedItemSlots} new placeholder slots), the shared 1,023-slot bag and its save format, Pal Pad / Wi-Fi save blocks isolated. Existing saves must be converted.`,
    "Item Expansion", { key: "code-injection:item-expansion" });
  return { addedItemSlots, dlls: parts.map(([part]) => game.dlls[part]!.fileName) };
}

/** Removes the runtime. The padded data stays (it is inert without the runtime); saves must be converted back. */
export function uninstallItemExpansion(project: ProjectState): void {
  const version = itemExpansionVersion(project);
  if (!version) return;
  if (catalogFor(project).some((entry) => entry.authored)) {
    throw new Error(`Rename or remove items ${familyOf(version).nativeCount}-1023 first: a retail-format ROM cannot use them.`);
  }
  for (const part of stagedPaths(project, version)) removeStagedCodeInjectionDll(project, dllPath(version, part));
  if (project.codeInjection) delete project.codeInjection.itemExpansion;
  recordGenericChange(project, "code_injection", "Item expansion removed. Convert saves back to the retail format.", "Item Expansion", { key: "code-injection:item-expansion" });
}

/** The conversion rules for this project's ROM: its pockets, from item data (equal to the ARM9 table in retail). */
export function itemSaveRules(project: ProjectState): ItemSaveRules {
  const store = project.narcs.items;
  if (!store) throw new Error("Item data is not loaded.");
  const family = itemFamily(project);
  const catalog = new Map(catalogFor(project).map((entry) => [entry.id, entry]));
  return {
    family: family.save,
    pocketOf: (item) => {
      if (item <= 0 || item >= ITEM_CAPACITY) return undefined;
      if (item >= family.nativeCount) { const entry = catalog.get(item); return entry?.authored ? entry.pocket : undefined; }
      const record = store.rawFiles[item];
      return record ? ((record[8] | (record[9] << 8)) >> 7) & 0xf : undefined;
    },
  };
}

/** Checks an expanded bag block (the pool) the way the game does at boot; undefined when it is valid. */
export function validateBagForProject(project: ProjectState, bag: Uint8Array): string | undefined {
  return validateExpandedBag(bag, itemSaveRules(project));
}

export type SaveConversion = { bytes: Uint8Array; report: ItemSaveConversionReport };

export function convertSaveForItemExpansion(project: ProjectState, save: Uint8Array): SaveConversion {
  return convertSaveToExpanded(save, itemSaveRules(project));
}

export function convertSaveFromItemExpansion(project: ProjectState, save: Uint8Array): SaveConversion {
  return convertSaveToRetail(save, itemSaveRules(project));
}

/** For tools that build retail-layout saves (test battles, warps, quick launch): convert when the ROM needs it. */
export function adaptSaveForProject(project: ProjectState, save: Uint8Array): Uint8Array {
  if (!isItemExpansionInstalled(project) || save.length !== 0x80000) return save;
  const rules = itemSaveRules(project);
  return detectSaveFormat(save, rules.family) === "retail" ? convertSaveToExpanded(save, rules).bytes : save;
}
