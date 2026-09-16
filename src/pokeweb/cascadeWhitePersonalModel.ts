import { readAscii, readU16, readU32 } from "../nds/binary";
import type { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { detectCascadeWhiteRom } from "./cascadeWhiteModel";
import { addRomFile, getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls } from "./pmcModel";
import { decodeRecord, markDirty, type NarcRecord, type ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";
import { parseRpm } from "./rpm";

export const CASCADE_PERSONAL_MARKER_PATH = "codeinjection/cascade-personal-v1.bin";
export const CASCADE_CHANCES_MARKER_PATH = "codeinjection/cascade-hidden-ability-chances-v1.bin";
export const CASCADE_AI_FIELDS = ["ability_4", "ability_5", "ability_6"] as const;
const MARKER = new TextEncoder().encode("Pokeweb Cascade personal v1: AI=39,3a,3b; HA=3e\n");
const CHANCES_MARKER = new TextEncoder().encode("Pokeweb Cascade hidden ability chances v1: raw WhiteListedPokemon u8 -> 3e\n");
const PERSONAL_SIZE = 0x4c;
const AI_ROW_COUNT = 651;
type AbilityRow = readonly [number, number, number];
type AbilityTable = readonly AbilityRow[];
type AbilitySource = { path: string; rows: AbilityTable };
const romCache = new WeakMap<Uint8Array, NintendoDSRom>();
const tableCache = new WeakMap<Uint8Array, AbilityTable | null>();
const chanceTableCache = new WeakMap<Uint8Array, readonly number[] | null>();
const migrationCache = new WeakMap<ProjectState, { files: Uint8Array[]; revision: number; migrated: boolean }>();

// CascadeWhite2CodeInjection/___BasicCodeInjectionForSharing/A_CoreBattle/
// A9_DamageCalc.cpp: FourthAbility and WhiteListedPokemon[651]. Older builds
// used enum-sized fields; current builds use u8. Locate the table in the actual
// DLL, so changed rows and custom ability IDs come from the loaded variant.
const TABLE_ANCHOR = [70, 34, 122, 70, 34, 122, 70, 34, 122, 70, 22, 163, 70, 22, 163, 70, 22, 163];

export function readCascadeAiAbilityTable(bytes: Uint8Array): AbilityTable | undefined {
  const cached = tableCache.get(bytes);
  if (cached !== undefined) return cached ?? undefined;
  const matches: AbilityTable[] = [];
  try {
    const { code } = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    for (const size of [1, 2, 4]) {
      const read = (offset: number): number => size === 1 ? code[offset] : size === 2 ? readU16(code, offset) : readU32(code, offset);
      const length = AI_ROW_COUNT * 3 * size;
      for (let start = 0; start + length <= code.length; start += 1) {
        if (!TABLE_ANCHOR.every((value, index) => read(start + (index + 3) * size) === value)) continue;
        const rows: AbilityRow[] = [];
        for (let row = 0; row < AI_ROW_COUNT; row += 1) {
          const offset = start + row * 3 * size;
          rows.push([read(offset), read(offset + size), read(offset + size * 2)]);
        }
        if (rows.every((row) => row.every((value) => value <= 255))) matches.push(rows);
      }
    }
  } catch {
    // A filename alone is insufficient evidence for copying ability data.
  }
  const table = matches.length === 1 ? matches[0] : undefined;
  tableCache.set(bytes, table ?? null);
  return table;
}

// D_NonBattleItemChanges/newitems_support_structs.h: the separate u8
// WhiteListedPokemon[651] compiled into D2_FieldOverlays.dll. These are raw
// chance multipliers, not percentages. Keep variant values unchanged.
const CHANCE_TABLE_ANCHOR = [0, 4, 4, 4, 4, 4, 4, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10, 10, 10, 0, 0, 0, 0, 8, 8, 4, 4, 0, 0, 6, 6, 6];

export function readCascadeHiddenAbilityChanceTable(bytes: Uint8Array): readonly number[] | undefined {
  const cached = chanceTableCache.get(bytes);
  if (cached !== undefined) return cached ?? undefined;
  const matches: number[][] = [];
  try {
    const { code } = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    for (let start = 0; start + AI_ROW_COUNT <= code.length; start += 1) {
      if (CHANCE_TABLE_ANCHOR.every((value, index) => code[start + index] === value)) {
        matches.push(Array.from(code.subarray(start, start + AI_ROW_COUNT)));
      }
    }
  } catch {
    // Only copy a uniquely identified table from a supported injection DLL.
  }
  const table = matches.length === 1 ? matches[0] : undefined;
  chanceTableCache.set(bytes, table ?? null);
  return table;
}

function originalRom(project: ProjectState): NintendoDSRom | undefined {
  const bytes = project.originalRomBytes;
  if (!bytes) return undefined;
  try {
    let rom = romCache.get(bytes);
    if (!rom) {
      rom = new NintendoDSRom(bytes, { fileData: "view" });
      romCache.set(bytes, rom);
    }
    return rom;
  } catch {
    return undefined;
  }
}

export function hydrateCascadePersonalSources(project: ProjectState, rom: NintendoDSRom): void {
  // The live project drops originalRomBytes on its first autosave. Retain the
  // small source files needed by synchronous detection, including export markers.
  // Rehydrate from the base ROM on restore, including older saved projects.
  if (project.session.baseRom !== "BW2") {
    delete project.cascadePersonalSources;
    return;
  }
  const sources: NonNullable<ProjectState["cascadePersonalSources"]> = {};
  const collectDlls = (folder: Folder, parent: string): void => {
    folder.files.forEach((name, index) => {
      const fileId = folder.firstId + index;
      const bytes = rom.files[fileId];
      if (/\.dll$/iu.test(name) && bytes && readAscii(bytes, 0, 4) === "DLXF") {
        sources[`${parent}/${name}`] = { fileId, bytes: bytes.slice() };
      }
    });
    for (const [name, child] of folder.folders) collectDlls(child, `${parent}/${name}`);
  };
  for (const [name, folder] of rom.filenames.folders) {
    if (name.toLowerCase() === "patches") collectDlls(folder, name);
  }
  for (const path of [CASCADE_PERSONAL_MARKER_PATH, CASCADE_CHANCES_MARKER_PATH]) {
    const fileId = rom.filenames.idOf(path);
    if (fileId !== undefined) sources[path] = { fileId, bytes: rom.files[fileId].slice() };
  }
  if (Object.keys(sources).length > 0) project.cascadePersonalSources = sources;
  else delete project.cascadePersonalSources;
}

function pathBytes(project: ProjectState, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find((key) => key.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const rom = originalRom(project);
  const id = rom?.filenames.idOf(path);
  if (rom) return id !== undefined ? getRomFileBytes(project, rom, id) : undefined;
  const source = Object.entries(project.cascadePersonalSources ?? {}).find(([key]) => key.toLowerCase() === path.toLowerCase())?.[1];
  return source && (project.fileSystem?.replacements?.[source.fileId] ?? source.bytes);
}

function injectedTableSource<T>(project: ProjectState, readTable: (bytes: Uint8Array) => T | undefined): { path: string; rows: T } | undefined {
  if (!detectCascadeWhiteRom(project)) return undefined;
  const sources: Array<{ path: string; rows: T }> = [];
  const paths = new Set([
    ...listCodeInjectionDlls(project).filter((module) => module.target === "patches").map((module) => module.path),
    ...Object.keys(project.cascadePersonalSources ?? {}).filter((path) => /^patches\/.+\.dll$/iu.test(path)),
  ]);
  for (const path of paths) {
    const bytes = pathBytes(project, path);
    const rows = bytes && readTable(bytes);
    if (rows) sources.push({ path, rows });
  }
  // Conflicting injected tables need an explicit runtime choice, not a guess.
  if (sources.slice(1).some((source) => JSON.stringify(source.rows) !== JSON.stringify(sources[0].rows))) return undefined;
  return sources[0];
}

function abilitySource(project: ProjectState): AbilitySource | undefined {
  return injectedTableSource(project, readCascadeAiAbilityTable);
}

function markerPresent(project: ProjectState, path = CASCADE_PERSONAL_MARKER_PATH, expected = MARKER): boolean {
  const bytes = pathBytes(project, path);
  return bytes?.length === expected.length && expected.every((value, index) => bytes[index] === value);
}

export function hasCascadePersonalData(project: ProjectState): boolean {
  if (!detectCascadeWhiteRom(project)) return false;
  if (project.patches?.applied?.cascadePersonalData || markerPresent(project)) return true;
  const store = project.narcs.personal;
  if (!store) return false;
  const revision = store.revision ?? 0;
  const cached = migrationCache.get(project);
  if (cached?.files === store.rawFiles && cached.revision === revision) return cached.migrated;
  // These bytes are zero in unmodified personal records. Recognize a copied
  // a/0/1/6 even after edits or DLL updates, without requiring external markers.
  // Include alternate forms, but exclude regional Dex lookup records.
  const migrated = store.rawFiles.some((bytes) => bytes.length === PERSONAL_SIZE
    && (bytes[0x39] !== 0 || bytes[0x3a] !== 0 || bytes[0x3b] !== 0 || bytes[0x3e] !== 0));
  migrationCache.set(project, { files: store.rawFiles, revision, migrated });
  return migrated;
}

export function enrichCascadePersonalRecord(project: ProjectState, record: NarcRecord): void {
  const { raw, readable } = record;
  if (record.bytes.length !== PERSONAL_SIZE || !raw || !readable || !hasCascadePersonalData(project)) return;
  CASCADE_AI_FIELDS.forEach((field, slot) => {
    raw[field] ??= ((raw.padding ?? 0) >>> (slot * 8)) & 255;
    readable[field] = project.texts.banks.abilities?.[raw[field]] ?? String(raw[field]);
  });
  raw.hidden_ability_chance ??= ((raw.driftveil_tutor ?? 0) >>> 16) & 255;
  readable.hidden_ability_chance = raw.hidden_ability_chance;
}

export function cascadePersonalAbilityId(project: ProjectState, personalId: number, slot: number, form = 0): number | undefined {
  if (slot < 4 || slot > 6 || !hasCascadePersonalData(project) || project.narcs.personal?.rawFiles[personalId]?.length !== PERSONAL_SIZE) return undefined;
  if (form > 0) {
    const base = decodeRecord(project, "personal", personalId).raw!;
    if (base.form_id > 0 && form < base.num_forms) personalId = base.form_id + form - 1;
    if (project.narcs.personal?.rawFiles[personalId]?.length !== PERSONAL_SIZE) return undefined;
  }
  return decodeRecord(project, "personal", personalId).raw?.[`ability_${slot}`];
}

export function preserveCascadePersonalMigration(project: ProjectState): void {
  // Keep detection even if the last nonzero custom value is edited back to zero.
  if (!markerPresent(project)) addRomFile(project, CASCADE_PERSONAL_MARKER_PATH, MARKER.slice());
  project.patches ??= { dirtyOverlayIds: [] };
  (project.patches.applied ??= {}).cascadePersonalData = true;
}

export type CascadePersonalMigrationStatus = { visible: boolean; installed: boolean; canMigrate: boolean; message: string; sourcePath?: string; abilitiesMigrated?: boolean };

export function getCascadePersonalMigrationStatus(project: ProjectState): CascadePersonalMigrationStatus {
  if (!detectCascadeWhiteRom(project)) return { visible: false, installed: false, canMigrate: false, message: "" };
  const abilitiesMigrated = hasCascadePersonalData(project);
  if (abilitiesMigrated && markerPresent(project, CASCADE_CHANCES_MARKER_PATH, CHANCES_MARKER)) return { visible: true, installed: true, canMigrate: false, abilitiesMigrated, message: "AI abilities and Hidden Ability Chance were imported and are editable in the Pokémon personal editor." };
  const source = abilitiesMigrated ? undefined : abilitySource(project);
  if (!abilitiesMigrated && !source) return { visible: false, installed: false, canMigrate: false, message: "No unambiguous supported AI ability table was found in the loaded Cascade DLLs." };
  const chances = injectedTableSource(project, readCascadeHiddenAbilityChanceTable);
  if (!chances) return { visible: true, installed: false, canMigrate: false, abilitiesMigrated, message: "No unambiguous supported Hidden Ability Chance table was found in the loaded Cascade DLLs." };
  try {
    migrationRows(project, source?.rows, chances.rows, abilitiesMigrated);
    return { visible: true, installed: false, canMigrate: true, abilitiesMigrated, sourcePath: source?.path ?? chances.path, message: abilitiesMigrated
      ? "Import this ROM’s Hidden Ability Chance values into the earlier migration’s zero-valued fields. Existing AI abilities and nonzero chances are preserved."
      : "Copy this ROM’s AI ability slots and raw Hidden Ability Chance values into personal data and enable editing." };
  } catch (error) {
    return { visible: true, installed: false, canMigrate: false, abilitiesMigrated, message: error instanceof Error ? error.message : String(error) };
  }
}

function migrationRows(project: ProjectState, table: AbilityTable | undefined, chances: readonly number[], abilitiesMigrated: boolean): Array<{ id: number; abilities?: AbilityRow; chance: number }> {
  const store = project.narcs.personal;
  if (!store || chances.some((_row, id) => store.rawFiles[id]?.length !== PERSONAL_SIZE)) throw new Error("Load the complete Cascade personal archive before migrating.");
  if (pathBytes(project, CASCADE_PERSONAL_MARKER_PATH) && !markerPresent(project)) throw new Error("An unrecognized Cascade personal migration marker already exists.");
  if (pathBytes(project, CASCADE_CHANCES_MARKER_PATH) && !markerPresent(project, CASCADE_CHANCES_MARKER_PATH, CHANCES_MARKER)) throw new Error("An unrecognized Cascade chance import marker already exists.");
  const owners = new Map<number, number>();
  for (let species = 1; species < 650; species += 1) {
    const raw = decodeRecord(project, "personal", species).raw!;
    if (raw.form_id > 0) for (let form = 1; form < raw.num_forms; form += 1) owners.set(raw.form_id + form - 1, species);
  }
  const result: Array<{ id: number; abilities?: AbilityRow; chance: number }> = [];
  store.rawFiles.forEach((bytes, id) => {
    if (bytes.length !== PERSONAL_SIZE) return; // Regional Dex tables are not personal records.
    const raw = decodeRecord(project, "personal", id).raw!;
    const existingChance = raw.hidden_ability_chance ?? (((raw.driftveil_tutor ?? 0) >>> 16) & 255);
    if (!abilitiesMigrated && ((raw.padding ?? 0) !== 0 || existingChance !== 0)) {
      throw new Error(`Pokémon #${id} already has data in the migration bytes. No personal data was changed.`);
    }
    const sourceId = owners.get(id) ?? id;
    result.push({ id, abilities: table?.[sourceId], chance: existingChance || chances[sourceId] || 0 });
  });
  return result;
}

export async function migrateCascadePersonalData(project: ProjectState): Promise<RomPatchApplyResult> {
  if (!detectCascadeWhiteRom(project)) throw new Error("This migration requires a Cascade White BW2 ROM with its AI injection patch.");
  const abilitiesMigrated = hasCascadePersonalData(project);
  if (abilitiesMigrated && markerPresent(project, CASCADE_CHANCES_MARKER_PATH, CHANCES_MARKER)) return { patchId: "cascadePersonalData", status: "already-applied", summary: "Cascade personal migration and chance import are already present. Existing edits were preserved." };
  const source = abilitiesMigrated ? undefined : abilitySource(project);
  if (!abilitiesMigrated && !source) throw new Error("Unable to identify a unique AI ability table in the loaded Cascade DLLs.");
  const chances = injectedTableSource(project, readCascadeHiddenAbilityChanceTable);
  if (!chances) throw new Error("Unable to identify a unique Hidden Ability Chance table in the loaded Cascade DLLs.");
  const rows = migrationRows(project, source?.rows, chances.rows, abilitiesMigrated); // Validate every record before writing any.
  project.patches ??= { dirtyOverlayIds: [] };
  (project.patches.applied ??= {}).cascadePersonalData = true;
  for (const { id, abilities, chance } of rows) {
    const record = decodeRecord(project, "personal", id);
    if (!abilitiesMigrated) CASCADE_AI_FIELDS.forEach((field, slot) => { record.raw![field] = abilities?.[slot] ?? 0; });
    record.raw!.hidden_ability_chance = chance;
    enrichCascadePersonalRecord(project, record);
    markDirty(project, "personal", id);
  }
  preserveCascadePersonalMigration(project);
  addRomFile(project, CASCADE_CHANCES_MARKER_PATH, CHANCES_MARKER.slice());
  recordGenericChange(project, "personal", `${source ? `Migrated AI ability slots from ${source.path} and imported` : "Imported"} raw Hidden Ability Chance values from ${chances.path} into ${rows.length} Cascade personal records.`, "Cascade personal migration");
  return { patchId: "cascadePersonalData", status: "applied", summary: abilitiesMigrated
    ? "Imported raw Hidden Ability Chance values into zero-valued fields. Existing AI abilities and nonzero chances were preserved."
    : "Migrated Cascade AI abilities and raw Hidden Ability Chance values into personal data. Runtime support must be updated separately." };
}
