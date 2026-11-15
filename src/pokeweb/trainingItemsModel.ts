import manifest from "../assets/codeinjection/trainingItemsManifest.json";
import { readU16, writeU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { recordGenericChange } from "./actionChangelog";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { NATURES } from "./constants";
import { getRomFileBytes } from "./fileSystemModel";
import {
  expandedItemArticle, getItemExpansionStatus, hydrateItemExpansionFromRom, ITEM_CAPACITY, itemExpansionVersion, itemFamily, materializeItemExpansionTables,
  stageItemExpansion,
} from "./itemExpansionModel";
import { writeExpandedItemIcons } from "./itemSpriteModel";
import { getOverlayInfo, getOverlayWorkingBytes } from "./overlayEditModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import { markDirty, type ProjectState } from "./projectStore";
import { parseRpm } from "./rpm";
import { commitTextBank, getTextBank, parseTextEntryId } from "./textModel";

const GAMES = {
  B: { rom: "IRBO", dialog: 157, url: new URL("../assets/codeinjection/PokewebTrainingItemsB.dll", import.meta.url), ...manifest.B },
  W: { rom: "IRAO", dialog: 157, url: new URL("../assets/codeinjection/PokewebTrainingItemsW.dll", import.meta.url), ...manifest.W },
  B2: { rom: "IREO", dialog: 178, url: new URL("../assets/codeinjection/PokewebTrainingItemsB2.dll", import.meta.url), ...manifest.B2 },
  W2: { rom: "IRDO", dialog: 178, url: new URL("../assets/codeinjection/PokewebTrainingItemsW2.dll", import.meta.url), ...manifest.W2 },
};
type Profile = typeof GAMES[keyof typeof GAMES];

export const TRAINING_ITEMS = [
  ...NATURES.map(nature => ({ name: `${nature} Mint`, description: `Changes a Pokémon’s\\nnature to ${nature}.` })),
  { name: "Silver Bottle Cap", description: "Maxes out the IV of one\\nstat you choose." },
  { name: "Gold Bottle Cap", description: "Maxes out all six IVs." },
  { name: "Ability Capsule", description: "Swaps a Pokémon’s regular\\nAbility for its other one." },
  { name: "Ability Patch", description: "Grants a Hidden Ability.\\nUse again to restore the\\nfirst regular Ability." },
];
const DIALOG = [
  "Which stat?\\nIts IV will reach 31.",
  "Use this item?",
  "The item took effect!",
  "It won’t have any effect.",
  "HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed", "Cancel",
];
// Keep the fixed Mega Stone region available regardless of installation order.
const FIRST_SLOT = 781;
const CONFIG_SIZE = 8 + TRAINING_ITEMS.length * 2;
const pathOf = (profile: Profile) => `patches/${profile.fileName}`;
const profileFor = (project: ProjectState) => {
  const version = itemExpansionVersion(project);
  return version && GAMES[version];
};

function moduleBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const addition = Object.entries(project.fileSystem?.additions ?? {}).find(([key]) => key.toLowerCase() === path.toLowerCase());
  if (addition) return addition[1];
  const id = rom.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}

function configOffset(bytes: Uint8Array, version: number): number {
  for (let offset = 0; offset <= bytes.length - CONFIG_SIZE; offset += 4) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x57 && bytes[offset + 2] === 0x54
      && bytes[offset + 3] === 0x52 && readU16(bytes, offset + 4) === version) return offset;
  }
  throw new Error("Invalid Training Items runtime configuration.");
}

const RUNTIME_VERSION = 2;

function installedConfig(bytes: Uint8Array, profile: Profile) {
  const legacy = bytes.length === profile.legacy.size;
  const asset = legacy ? profile.legacy : profile;
  if (bytes.length !== asset.size) return undefined;
  const offset = configOffset(bytes, legacy ? 1 : RUNTIME_VERSION);
  const ids = TRAINING_ITEMS.map((_, index) => readU16(bytes, offset + 8 + 2 * index));
  if (new Set(ids).size !== ids.length || ids.some(id => id < FIRST_SLOT || id >= ITEM_CAPACITY)) return undefined;
  const normalized = bytes.slice();
  normalized.fill(0, offset + 6, offset + CONFIG_SIZE);
  if (sha256Hex(normalized) !== asset.sha256) return undefined;
  return { legacy, ids, firstMessage: readU16(bytes, offset + 6) };
}

export function getTrainingItemsStatus(project: ProjectState): "available" | "installed" | "update" | "incompatible" {
  const profile = profileFor(project);
  if (!profile || !project.originalRomBytes || project.romInfo?.idCode !== profile.rom || project.originalRomBytes[30] !== 0) return "incompatible";
  if (!listCodeInjectionDlls(project).some(module => module.path.toLowerCase() === pathOf(profile).toLowerCase())) return "available";
  try {
    const bytes = moduleBytes(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }), pathOf(profile));
    const config = bytes && installedConfig(bytes, profile);
    return config ? config.legacy ? "update" : "installed" : "incompatible";
  } catch {
    return "incompatible";
  }
}

function configureRuntime(bytes: Uint8Array, ids: readonly number[], firstMessage: number): void {
  const offset = configOffset(bytes, RUNTIME_VERSION);
  writeU16(bytes, offset + 6, firstMessage);
  ids.forEach((id, index) => writeU16(bytes, offset + 8 + 2 * index, id));
}

function checkBindings(project: ProjectState, rom: NintendoDSRom, profile: Profile): void {
  const segments = new Map<string, { base: number; data: Uint8Array }>([["ARM9", { base: rom.arm9RamAddress, data: project.arm9 }]]);
  for (const check of profile.checks) {
    let segment = segments.get(check.segment);
    if (!segment) {
      const info = getOverlayInfo(project, rom, Number(check.segment));
      if (!info) throw new Error("The native Training Items party menu is missing.");
      segment = { base: info.ramAddress, data: getOverlayWorkingBytes(project, rom, info.overlayId) };
      segments.set(check.segment, segment);
    }
    const at = check.address - segment.base;
    const actual = segment.data.subarray(at, at + check.bytes.length / 2);
    if (at < 0 || Array.from(actual, byte => byte.toString(16).padStart(2, "0")).join("") !== check.bytes) {
      throw new Error(`The ROM changes a native Training Items dependency at 0x${check.address.toString(16)}.`);
    }
  }
  for (const module of listCodeInjectionDlls(project)) {
    if (module.target !== "patches" || module.path.toLowerCase() === pathOf(profile).toLowerCase()) continue;
    const bytes = moduleBytes(project, rom, module.path);
    if (!bytes?.length) continue;
    let rpm;
    try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    for (const { target, sourceSymbolIndex } of rpm.relocations) {
      const at = target.address & ~1;
      const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4;
      if (profile.targets.some(site => site.segment === target.module && at < Number(site.address) + 4 && at + size > Number(site.address))) {
        throw new Error(`Training Items conflicts with the party menu hook in ${module.fileName}.`);
      }
    }
  }
}

/** Install on a transaction staged by installCodeInjectionPatch. Returns assigned ROM item IDs in pack order. */
export async function stageTrainingItems(project: ProjectState): Promise<number[]> {
  const profile = profileFor(project);
  if (!profile || !project.originalRomBytes || project.romInfo?.idCode !== profile.rom || project.originalRomBytes[30] !== 0) {
    throw new Error("Training Items supports US revision-0 Black, White, Black 2 and White 2.");
  }
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  const existing = moduleBytes(project, rom, pathOf(profile));
  const installed = existing?.length ? installedConfig(existing, profile) : undefined;
  if (existing?.length && !installed) throw new Error("The installed Training Items runtime is unrecognized.");
  if (installed && !installed.legacy) return installed.ids;
  hydrateItemExpansionFromRom(project, rom);
  const expansion = getItemExpansionStatus(project);
  if (!expansion.compatible) throw new Error(expansion.message);
  if (!expansion.installed || !expansion.complete || expansion.updateAvailable) await stageItemExpansion(project);
  loadCodeInjectionNarcs(project, rom, ["items", "message_texts"]);
  checkBindings(project, rom, profile);

  const [response, iconResponse] = await Promise.all([
    fetch(profile.url),
    installed ? undefined : fetch(new URL("../assets/codeinjection/trainingItemIcons.bin", import.meta.url)),
  ]);
  if (!response.ok || (iconResponse && !iconResponse.ok)) throw new Error("Could not load the Training Items pack.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256Hex(bytes) !== profile.sha256) throw new Error("The bundled Training Items runtime failed its integrity check.");
  if (installed) {
    configureRuntime(bytes, installed.ids, installed.firstMessage);
    stageCodeInjectionDll(project, profile.fileName, bytes, "patches", project.originalRomBytes);
    recordGenericChange(project, "code_injection", "Updated Training Items to preserve ability choices through evolution and form changes.", "Training Items", { key: "code-injection:training-items" });
    return installed.ids;
  }
  const store = project.narcs.items!;
  const banks = Object.values(itemFamily(project).textBanks).map(id => ({ id, entries: getTextBank(project, "message_texts", id) }));
  const ids: number[] = [];
  for (let id = ITEM_CAPACITY - 1; id >= FIRST_SLOT && ids.length < TRAINING_ITEMS.length; id--) {
    const edited = store.dirty.has(id) && Object.values(store.records.get(id)?.raw ?? {}).some(value => value !== 0);
    if (edited || !store.rawFiles[id]?.length || store.rawFiles[id].some(byte => byte !== 0)
      || project.codeInjection?.itemExpansion?.icons?.[id]
      || banks.some(({ entries }) => !entries[id] || !["", "???"].includes(entries[id][1]))) continue;
    ids.push(id);
  }
  if (ids.length !== TRAINING_ITEMS.length) throw new Error("Training Items needs 29 unused item slots above the Mega Stone range.");
  ids.reverse();

  const dialog = getTextBank(project, "message_texts", profile.dialog);
  if (!dialog.length) throw new Error("The native party menu text bank is missing.");
  const rows = dialog.map(([id]) => parseTextEntryId(id));
  const firstMessage = Math.max(...rows.map(row => row.entry)) + 1;
  if (firstMessage + DIALOG.length > 0xffff) throw new Error("The party menu text bank is full.");
  const blockCount = Math.max(...rows.map(row => row.block)) + 1;
  for (let block = 0; block < blockCount; block++) {
    DIALOG.forEach((line, index) => dialog.push([`${block}_${firstMessage + index}`, line, 0]));
  }
  commitTextBank(project, "message_texts", profile.dialog);

  for (const [index, id] of ids.entries()) {
    const item = TRAINING_ITEMS[index];
    const data = store.rawFiles[id];
    writeU16(data, 8, 0x009f); // Medicine, no battle pocket.
    data[10] = 1; // Opens the party menu when used from the Bag.
    data[14] = 1; // Match other consumable field items.
    data[15] = 1; // Medicine sort order.
    store.records.delete(id);
    markDirty(project, "items", id);
    const text = [item.description, item.name, expandedItemArticle(item.name), `${item.name}s`];
    banks.forEach(({ entries }, bank) => { entries[id][1] = text[bank]; });
  }
  for (const { id } of banks) commitTextBank(project, "message_texts", id);
  configureRuntime(bytes, ids, firstMessage);
  writeExpandedItemIcons(project, project.originalRomBytes, ids, new Uint8Array(await iconResponse!.arrayBuffer()));
  stageCodeInjectionDll(project, profile.fileName, bytes, "patches", project.originalRomBytes);
  materializeItemExpansionTables(project, rom);
  recordGenericChange(project, "code_injection", "Installed 25 nature mints, two Bottle Caps, Ability Capsule and Ability Patch.", "Training Items", { key: "code-injection:training-items" });
  return ids;
}
