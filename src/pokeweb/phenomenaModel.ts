import manifest from "../assets/codeinjection/phenomenaManifest.json";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { applyRemoveDustCloudGemRewardsToOverlay } from "./romPatchModel";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";

/** Dust clouds in caves and the flying Pokémon shadows of Driftveil Drawbridge. */
export type PhenomenonKind = "dust" | "shadow";
export type PhenomenaGame = "B" | "W" | "B2" | "W2";
export type PhenomenonItem = { item: number; weight: number };
export type PhenomenonSettings = { encounterPermille: number; items: PhenomenonItem[] };
export type PhenomenonZoneGroup = {
  kind: PhenomenonKind;
  zones: number[];
  /** null keeps the phenomenon's own encounter chance. */
  encounterPermille: number | null;
  /** Empty keeps the phenomenon's own items. */
  items: PhenomenonItem[];
};
export type PhenomenaConfig = { dust: PhenomenonSettings; shadow: PhenomenonSettings; groups: PhenomenonZoneGroup[] };
export type PhenomenaStatus = {
  game?: PhenomenaGame;
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  /** The Patches page "Remove Items from Dust Clouds" branch is applied; saving restores it. */
  legacyItemPatch: boolean;
  message: string;
};

export const PHENOMENON_KINDS: readonly PhenomenonKind[] = ["dust", "shadow"];
export const PHENOMENA_LIMITS = { items: 48, groups: 8, zones: 32, weight: 0xffff, permille: 1000 } as const;
const MAGIC = 0x314e4850; // "PHN1"
const CONFIG_VERSION = 1;
const CONFIG_SIZE = manifest.configSize;
const TABLE_SIZE = 4 + PHENOMENA_LIMITS.items * 4;
const GROUP_SIZE = 4 + PHENOMENA_LIMITS.zones * 2 + TABLE_SIZE;
const GROUPS_OFFSET = 12 + 2 * TABLE_SIZE;
const INHERIT = 0xffff;
const ID_CODES: Record<PhenomenaGame, string> = { B: "IRBO", W: "IRAO", B2: "IREO", W2: "IRDO" };
type GameManifest = (typeof manifest.games)[PhenomenaGame];
const DLL_URLS: Record<PhenomenaGame, URL> = {
  B: new URL("../assets/codeinjection/PhenomenaB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/PhenomenaW.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/PhenomenaB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/PhenomenaW2.dll", import.meta.url),
};
const SYMBOL_TYPES = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"] as const;
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) => Uint8Array.from(value.match(/../gu) ?? [], (b) => Number.parseInt(b, 16));

export function getPhenomenaGame(project: ProjectState): PhenomenaGame | undefined {
  const version = project.session.baseVersion;
  return version === "B" || version === "W" || version === "B2" || version === "W2" ? version : undefined;
}

export function phenomenaDllFileName(game: PhenomenaGame): string {
  return manifest.games[game].fileName;
}

/** The retail outcome of each phenomenon, expressed as weights in tenths of a percent. */
export function vanillaPhenomenaConfig(game: PhenomenaGame): PhenomenaConfig {
  const d = manifest.games[game].defaults;
  return {
    dust: { encounterPermille: d.dustEncounterPermille, items: d.dust.map((e) => ({ ...e })) },
    shadow: { encounterPermille: d.shadowEncounterPermille, items: d.shadow.map((e) => ({ ...e })) },
    groups: d.groups.map((g) => ({ kind: g.kind as PhenomenonKind, zones: [...g.zones], encounterPermille: g.encounterPermille, items: g.items.map((e) => ({ ...e })) })),
  };
}

export type PhenomenaValidationLimits = { itemCount?: number; zoneCount?: number };

export function validatePhenomenaConfig(config: PhenomenaConfig, limits: PhenomenaValidationLimits = {}): void {
  const permille = (value: number, label: string) => {
    if (!Number.isInteger(value) || value < 0 || value > PHENOMENA_LIMITS.permille) throw new Error(`${label} must be between 0% and 100%.`);
  };
  const table = (items: PhenomenonItem[], label: string, allowEmpty: boolean) => {
    if (items.length > PHENOMENA_LIMITS.items) throw new Error(`${label} can list at most ${PHENOMENA_LIMITS.items} items.`);
    if (!allowEmpty && items.length === 0) throw new Error(`${label} needs at least one item.`);
    for (const { item, weight } of items) {
      if (!Number.isInteger(item) || item < 1 || item > 0xffff || (limits.itemCount !== undefined && item >= limits.itemCount))
        throw new Error(`${label} has an item that does not exist (${item}).`);
      if (!Number.isInteger(weight) || weight < 0 || weight > PHENOMENA_LIMITS.weight) throw new Error(`${label} has an invalid weight.`);
    }
    if (items.length > 0 && items.every((e) => e.weight === 0)) throw new Error(`${label} needs at least one item with a weight above 0.`);
  };
  for (const kind of PHENOMENON_KINDS) {
    permille(config[kind].encounterPermille, `${phenomenonLabel(kind)} encounter chance`);
    table(config[kind].items, `${phenomenonLabel(kind)} items`, false);
  }
  if (config.groups.length > PHENOMENA_LIMITS.groups) throw new Error(`At most ${PHENOMENA_LIMITS.groups} zone overrides are supported.`);
  config.groups.forEach((group, index) => {
    const label = `Zone override ${index + 1}`;
    if (!PHENOMENON_KINDS.includes(group.kind)) throw new Error(`${label} has an unknown phenomenon.`);
    if (group.zones.length === 0) throw new Error(`${label} needs at least one zone.`);
    if (group.zones.length > PHENOMENA_LIMITS.zones) throw new Error(`${label} can list at most ${PHENOMENA_LIMITS.zones} zones.`);
    for (const zone of group.zones)
      if (!Number.isInteger(zone) || zone < 0 || zone > 0xfffe || (limits.zoneCount !== undefined && zone >= limits.zoneCount))
        throw new Error(`${label} has a zone that does not exist (${zone}).`);
    if (new Set(group.zones).size !== group.zones.length) throw new Error(`${label} lists a zone twice.`);
    if (group.encounterPermille !== null) permille(group.encounterPermille, `${label} encounter chance`);
    table(group.items, `${label} items`, true);
  });
}

export function phenomenonLabel(kind: PhenomenonKind): string {
  return kind === "dust" ? "Dust cloud" : "Flying shadow";
}

export function encodePhenomenaConfig(config: PhenomenaConfig): Uint8Array {
  validatePhenomenaConfig(config);
  const bytes = new Uint8Array(CONFIG_SIZE);
  writeU32(bytes, 0, MAGIC);
  writeU16(bytes, 4, CONFIG_VERSION);
  writeU16(bytes, 6, config.groups.length);
  writeU16(bytes, 8, config.dust.encounterPermille);
  writeU16(bytes, 10, config.shadow.encounterPermille);
  const table = (at: number, items: PhenomenonItem[]) => {
    writeU16(bytes, at, items.length);
    items.forEach((e, i) => { writeU16(bytes, at + 4 + i * 4, e.item); writeU16(bytes, at + 6 + i * 4, e.weight); });
  };
  table(12, config.dust.items);
  table(12 + TABLE_SIZE, config.shadow.items);
  config.groups.forEach((group, index) => {
    const at = GROUPS_OFFSET + index * GROUP_SIZE;
    bytes[at] = group.kind === "dust" ? 0 : 1;
    bytes[at + 1] = group.zones.length;
    writeU16(bytes, at + 2, group.encounterPermille ?? INHERIT);
    group.zones.forEach((zone, i) => writeU16(bytes, at + 4 + i * 2, zone));
    table(at + 4 + PHENOMENA_LIMITS.zones * 2, group.items);
  });
  return bytes;
}

/** Decode a configuration block; an empty default table means the retail picker. */
export function decodePhenomenaConfig(bytes: Uint8Array, game: PhenomenaGame): PhenomenaConfig {
  if (bytes.length < CONFIG_SIZE || readU32(bytes, 0) !== MAGIC || readU16(bytes, 4) !== CONFIG_VERSION)
    throw new Error("Unrecognized phenomenon configuration.");
  const groupCount = readU16(bytes, 6);
  if (groupCount > PHENOMENA_LIMITS.groups) throw new Error("Invalid phenomenon zone override count.");
  const table = (at: number): PhenomenonItem[] => {
    const count = readU16(bytes, at);
    if (count > PHENOMENA_LIMITS.items) throw new Error("Invalid phenomenon item count.");
    return Array.from({ length: count }, (_, i) => ({ item: readU16(bytes, at + 4 + i * 4), weight: readU16(bytes, at + 6 + i * 4) }));
  };
  const vanilla = vanillaPhenomenaConfig(game);
  const dust = table(12), shadow = table(12 + TABLE_SIZE);
  const config: PhenomenaConfig = {
    dust: { encounterPermille: readU16(bytes, 8), items: dust.length ? dust : vanilla.dust.items },
    shadow: { encounterPermille: readU16(bytes, 10), items: shadow.length ? shadow : vanilla.shadow.items },
    groups: Array.from({ length: groupCount }, (_, index) => {
      const at = GROUPS_OFFSET + index * GROUP_SIZE;
      const zoneCount = bytes[at + 1];
      if (bytes[at] > 1 || zoneCount > PHENOMENA_LIMITS.zones) throw new Error("Invalid phenomenon zone override.");
      const encounter = readU16(bytes, at + 2);
      return {
        kind: bytes[at] === 0 ? "dust" : "shadow",
        zones: Array.from({ length: zoneCount }, (_, i) => readU16(bytes, at + 4 + i * 2)),
        encounterPermille: encounter === INHERIT ? null : encounter,
        items: table(at + 4 + PHENOMENA_LIMITS.zones * 2),
      } satisfies PhenomenonZoneGroup;
    }),
  };
  validatePhenomenaConfig(config);
  return config;
}

/** Accept only the bundled runtime with any configuration block. */
export function inspectPhenomenaRuntime(rpm: RpmModule, game: PhenomenaGame): PhenomenaConfig | undefined {
  const expected = manifest.games[game];
  if (rpm.metadata.PMCGameID !== game || rpm.metadata.PMCVersion !== manifest.version || rpm.metadata.PMCModulePriority !== 4
    || rpm.baseAddress !== 0 || rpm.bssSize !== expected.bssSize || rpm.code.length * 2 !== expected.codeHex.length
    || rpm.symbols.length !== expected.symbols.length || rpm.relocations.length !== expected.relocations.length) return undefined;
  const { configOffset: at } = expected;
  const normalized = rpm.code.slice();
  normalized.set(fromHex(expected.codeHex.slice(at * 2, (at + CONFIG_SIZE) * 2)), at);
  if (hex(normalized) !== expected.codeHex) return undefined;
  if (!expected.symbols.every((symbol, i) => {
    const actual = rpm.symbols[i]!;
    return actual.address === symbol.address && actual.size === symbol.size && actual.type === SYMBOL_TYPES[symbol.type] && actual.attributes === symbol.attributes;
  })) return undefined;
  if (!expected.relocations.every((r) => rpm.relocations.filter((a) => a.target.address === r.address && a.target.module === r.module
    && a.target.type === r.type && a.sourceSymbolIndex === r.symbol).length === 1)) return undefined;
  try { return decodePhenomenaConfig(rpm.code.subarray(at, at + CONFIG_SIZE), game); } catch { return undefined; }
}

export function configurePhenomenaRuntime(bytes: Uint8Array, game: PhenomenaGame, config: PhenomenaConfig): Uint8Array {
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  if (!inspectPhenomenaRuntime(rpm, game)) throw new Error("The bundled phenomenon runtime failed its integrity check.");
  rpm.code.set(encodePhenomenaConfig(config), manifest.games[game].configOffset);
  const configured = writeRpm(rpm, { ident: "DLXF" });
  const check = inspectPhenomenaRuntime(parseRpm(configured, { allowedMagics: ["DLXF"] }), game);
  if (!check || JSON.stringify(check) !== JSON.stringify(normalizeForCompare(config, game))) throw new Error("Phenomenon configuration failed verification.");
  return configured;
}

function normalizeForCompare(config: PhenomenaConfig, game: PhenomenaGame): PhenomenaConfig {
  return decodePhenomenaConfig(encodePhenomenaConfig(config), game);
}

type Sources = { rom: NintendoDSRom; game: PhenomenaGame; spec: GameManifest };
const romCache = new WeakMap<Uint8Array, NintendoDSRom>();
function openRom(bytes: Uint8Array): NintendoDSRom {
  let rom = romCache.get(bytes);
  if (!rom) { rom = new NintendoDSRom(bytes, { fileData: "view" }); romCache.set(bytes, rom); }
  return rom;
}

function moduleBytes(project: ProjectState, rom: NintendoDSRom | undefined, path: string): Uint8Array | undefined {
  const staged = Object.keys(project.fileSystem?.additions ?? {}).find((p) => p.toLowerCase() === path.toLowerCase());
  if (staged) return project.fileSystem!.additions![staged];
  const id = rom?.filenames.idOf(path);
  return rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined;
}

function phenomenonOverlay(project: ProjectState, { rom, spec }: Sources): { data: Uint8Array; ramAddress: number } {
  const id = spec.overlay;
  const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([id])).get(id);
  if (!overlay) throw new Error(`Overlay ${id} is missing from this ROM.`);
  return { data: project.overlays[id] ?? overlay.data, ramAddress: overlay.ramAddress };
}

function sources(project: ProjectState, romBytes: Uint8Array | undefined): Sources | undefined {
  const game = getPhenomenaGame(project);
  if (!game || !romBytes) return undefined;
  const rom = openRom(romBytes);
  return rom.idCode === ID_CODES[game] && rom.data[0x1e] === 0 ? { rom, game, spec: manifest.games[game] } : undefined;
}

type HookState = { legacyItemPatch: boolean; gemPatch: boolean };
function checkHooks(project: ProjectState, src: Sources): HookState {
  const { data, ramAddress } = phenomenonOverlay(project, src);
  const { signature } = src.spec;
  const at = signature.address - ramAddress;
  const actual = data.subarray(at, at + signature.expectedHex.length / 2);
  const expected = fromHex(signature.expectedHex);
  if (at < 0 || actual.length !== expected.length) throw new Error("The phenomenon handler is missing from this ROM.");
  const branch = signature.dustBranchAddress - signature.address;
  let legacyItemPatch = false;
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] === expected[i]) continue;
    if (i === branch && actual[i] === signature.dustBranchLegacy) { legacyItemPatch = true; continue; }
    throw new Error("The dust cloud and shadow handler differs from the clean US ROM.");
  }
  const gem = applyRemoveDustCloudGemRewardsToOverlay(data);
  return { legacyItemPatch, gemPatch: gem?.status === "already-applied" };
}

function overlapsHooks(rpm: RpmModule, spec: GameManifest): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" || target.type === "ARM_BRANCH" ? 8 : 4;
    return spec.hooks.some((hook) => target.module === hook.module && target.address < hook.address + hook.patchSize && target.address + size > hook.address);
  });
}

type RuntimeState = { config?: PhenomenaConfig; path?: string };
function runtimeState(project: ProjectState, src: Sources): RuntimeState {
  const ownName = src.spec.fileName.toLowerCase();
  const state: RuntimeState = {};
  for (const entry of listCodeInjectionDlls(project)) {
    const bytes = moduleBytes(project, src.rom, entry.path);
    let rpm: RpmModule | undefined;
    try { if (bytes) rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { /* checked below */ }
    const config = rpm && inspectPhenomenaRuntime(rpm, src.game);
    if (entry.fileName.toLowerCase() === ownName) {
      if (entry.target !== "patches" || !config) throw new Error(`An unrecognized DLL uses the ${src.spec.fileName} filename.`);
      if (state.path) throw new Error(`Remove the duplicate ${src.spec.fileName}.`);
      Object.assign(state, { config, path: entry.path });
    } else if (config || (rpm && overlapsHooks(rpm, src.spec))) {
      throw new Error(`${entry.fileName} already changes the dust cloud and shadow handler.`);
    }
  }
  return state;
}

/** romBytes: the loaded ROM (project.originalRomBytes or loadActiveRomBytes()). */
export function getPhenomenaStatus(project: ProjectState, romBytes = project.originalRomBytes): PhenomenaStatus {
  const game = getPhenomenaGame(project);
  const status: PhenomenaStatus = { game, supported: false, compatible: false, installed: false, legacyItemPatch: false,
    message: "The Phenomena editor supports English US revision-0 Black, White, Black 2 and White 2." };
  if (!game) return status;
  if (!romBytes) return { ...status, supported: true, message: "Reload the ROM to verify the phenomenon handler." };
  const src = sources(project, romBytes);
  if (!src) return status;
  status.supported = true;
  try {
    status.installed = Boolean(runtimeState(project, src).path);
    status.legacyItemPatch = checkHooks(project, src).legacyItemPatch;
    status.compatible = true;
    status.message = status.installed ? "Installed. Export the ROM to apply changes." : "Saving installs PMC and the phenomenon runtime.";
  } catch (error) {
    status.message = error instanceof Error ? error.message : String(error);
  }
  return status;
}

/** The configuration the game currently uses: the installed runtime's, or the retail behavior. */
export function getPhenomenaConfig(project: ProjectState, romBytes = project.originalRomBytes): PhenomenaConfig {
  const game = getPhenomenaGame(project);
  if (!game) throw new Error("Unsupported game.");
  const src = sources(project, romBytes);
  if (src) {
    const runtime = runtimeState(project, src);
    if (runtime.config) return runtime.config;
    const vanilla = vanillaPhenomenaConfig(game);
    const hooks = checkHooks(project, src);
    // Reflect the Patches-page dust cloud edits that this editor replaces.
    if (hooks.gemPatch) {
      const stones = vanilla.dust.items.filter((e) => e.weight === 10);
      vanilla.dust.items = [...stones, { item: 229, weight: 1000 - stones.length * 10 }];
    }
    if (hooks.legacyItemPatch) vanilla.dust.encounterPermille = PHENOMENA_LIMITS.permille;
    return vanilla;
  }
  return vanillaPhenomenaConfig(game);
}

export function isPhenomenaRuntimeStaged(project: ProjectState): boolean {
  const game = getPhenomenaGame(project);
  if (!game) return false;
  const name = manifest.games[game].fileName.toLowerCase();
  return listCodeInjectionDlls(project).some((entry) => entry.fileName.toLowerCase() === name);
}

function validationLimits(project: ProjectState): PhenomenaValidationLimits {
  return { itemCount: project.narcs.items?.fileCount || undefined, zoneCount: project.headers?.count || undefined };
}

/** Install or reconfigure the runtime; publishes nothing unless every step succeeds. */
export async function savePhenomenaConfig(project: ProjectState, config: PhenomenaConfig): Promise<void> {
  validatePhenomenaConfig(config, validationLimits(project));
  await installCodeInjectionPatch(project, async (staged) => {
    const src = sources(staged, staged.originalRomBytes);
    if (!src) throw new Error(getPhenomenaStatus(staged).message);
    const runtime = runtimeState(staged, src);
    const hooks = checkHooks(staged, src);
    if (hooks.legacyItemPatch) {
      const { data, ramAddress } = phenomenonOverlay(staged, src);
      const restored = data.slice();
      restored[src.spec.signature.dustBranchAddress - ramAddress] = src.spec.signature.dustBranchNative;
      const id = src.spec.overlay;
      staged.overlays[id] = restored;
      staged.patches ??= { dirtyOverlayIds: [], applied: {} };
      staged.patches.applied ??= {};
      delete staged.patches.applied.removeDustCloudItems;
      if (!staged.patches.dirtyOverlayIds.includes(id)) staged.patches.dirtyOverlayIds.push(id);
    }
    const response = await fetch(DLL_URLS[src.game]);
    if (!response.ok) throw new Error(`Could not load the phenomenon runtime (${response.status}).`);
    const bytes = configurePhenomenaRuntime(new Uint8Array(await response.arrayBuffer()), src.game, config);
    stageCodeInjectionDll(staged, runtime.path?.split("/").pop() ?? src.spec.fileName, bytes);
    recordGenericChange(staged, "code_injection", describeChange(config), "Phenomena", { key: "code-injection:phenomena" });
  });
}

function describeChange(config: PhenomenaConfig): string {
  const pct = (permille: number) => `${permille / 10}%`;
  const overrides = config.groups.length ? `; ${config.groups.length} zone override${config.groups.length === 1 ? "" : "s"}` : "";
  return `Dust clouds: ${pct(config.dust.encounterPermille)} encounters, ${config.dust.items.length} items. `
    + `Flying shadows: ${pct(config.shadow.encounterPermille)} encounters, ${config.shadow.items.length} items${overrides}.`;
}

/** Share of each item, in percent, for display. */
export function phenomenonItemShares(items: PhenomenonItem[]): number[] {
  const total = items.reduce((sum, e) => sum + e.weight, 0);
  return items.map((e) => (total ? (e.weight / total) * 100 : 0));
}
