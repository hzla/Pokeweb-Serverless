import { readU16, readU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { detectCascadeWhiteRom } from "./cascadeWhiteModel";
import { addRomFile, getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls } from "./pmcModel";
import { decodeRecord, markDirty, type NarcRecord, type ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";
import { parseRpm } from "./rpm";

export const CASCADE_PERSONAL_MARKER_PATH = "codeinjection/cascade-personal-v1.bin";
export const CASCADE_AI_FIELDS = ["ability_4", "ability_5", "ability_6"] as const;
const MARKER = new TextEncoder().encode("Pokeweb Cascade personal v1: AI=39,3a,3b; HA=3e\n");
const PERSONAL_SIZE = 0x4c;
const AI_ROW_COUNT = 651;
type AbilityRow = readonly [number, number, number];
type AbilityTable = readonly AbilityRow[];
type AbilitySource = { path: string; rows: AbilityTable };
const romCache = new WeakMap<Uint8Array, NintendoDSRom>();
const tableCache = new WeakMap<Uint8Array, AbilityTable | null>();
const migrationCache = new WeakMap<ProjectState, { files: Uint8Array[]; revision: number; source: AbilityTable; migrated: boolean }>();

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

function originalRom(project: ProjectState): NintendoDSRom | undefined {
  const bytes = project.originalRomBytes;
  if (!bytes) return undefined;
  try {
    let rom = romCache.get(bytes);
    if (!rom) {
      rom = new NintendoDSRom(bytes);
      romCache.set(bytes, rom);
    }
    return rom;
  } catch {
    return undefined;
  }
}

function pathBytes(project: ProjectState, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find((key) => key.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const rom = originalRom(project);
  const id = rom?.filenames.idOf(path);
  return rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined;
}

function abilitySource(project: ProjectState): AbilitySource | undefined {
  if (!detectCascadeWhiteRom(project)) return undefined;
  const sources: AbilitySource[] = [];
  for (const module of listCodeInjectionDlls(project)) {
    if (module.target !== "patches") continue;
    const bytes = pathBytes(project, module.path);
    const rows = bytes && readCascadeAiAbilityTable(bytes);
    if (rows) sources.push({ path: module.path, rows });
  }
  // Conflicting injected tables need an explicit runtime choice, not a guess.
  if (sources.slice(1).some((source) => JSON.stringify(source.rows) !== JSON.stringify(sources[0].rows))) return undefined;
  return sources[0];
}

function markerPresent(project: ProjectState): boolean {
  const bytes = pathBytes(project, CASCADE_PERSONAL_MARKER_PATH);
  return bytes?.length === MARKER.length && MARKER.every((value, index) => bytes[index] === value);
}

export function hasCascadePersonalData(project: ProjectState): boolean {
  if (!detectCascadeWhiteRom(project)) return false;
  if (project.patches?.applied?.cascadePersonalData || markerPresent(project)) return true;
  const store = project.narcs.personal;
  const source = abilitySource(project);
  if (!store || !source) return false;
  const revision = store.revision ?? 0;
  const cached = migrationCache.get(project);
  if (cached?.files === store.rawFiles && cached.revision === revision && cached.source === source.rows) return cached.migrated;
  // Recognize a complete prior data migration even without our marker. Do not
  // classify a handful of nonzero padding bytes as a completed migration.
  const migrated = source.rows.slice(0, 650).every((row, id) => {
    const bytes = store.rawFiles[id];
    return bytes?.length === PERSONAL_SIZE && row.every((value, slot) => bytes[0x39 + slot] === value);
  });
  migrationCache.set(project, { files: store.rawFiles, revision, source: source.rows, migrated });
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
  // A ROM recognized by its original migrated values needs a durable marker
  // before editing those values, otherwise reimport could no longer detect it.
  if (!markerPresent(project)) addRomFile(project, CASCADE_PERSONAL_MARKER_PATH, MARKER.slice());
  project.patches ??= { dirtyOverlayIds: [] };
  (project.patches.applied ??= {}).cascadePersonalData = true;
}

export type CascadePersonalMigrationStatus = { visible: boolean; installed: boolean; canMigrate: boolean; message: string; sourcePath?: string };

export function getCascadePersonalMigrationStatus(project: ProjectState): CascadePersonalMigrationStatus {
  if (!detectCascadeWhiteRom(project)) return { visible: false, installed: false, canMigrate: false, message: "" };
  if (hasCascadePersonalData(project)) return { visible: true, installed: true, canMigrate: false, message: "AI abilities and Hidden Ability Chance are editable in the Pokémon personal editor." };
  const source = abilitySource(project);
  if (!source) return { visible: false, installed: false, canMigrate: false, message: "No unambiguous supported AI ability table was found in the loaded Cascade DLLs." };
  try {
    migrationRows(project, source.rows);
    return { visible: true, installed: false, canMigrate: true, sourcePath: source.path, message: "Copy this ROM’s AI ability slots into personal data and enable editing." };
  } catch (error) {
    return { visible: true, installed: false, canMigrate: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function migrationRows(project: ProjectState, table: AbilityTable): Array<{ id: number; abilities?: AbilityRow }> {
  const store = project.narcs.personal;
  if (!store || table.some((_row, id) => store.rawFiles[id]?.length !== PERSONAL_SIZE)) throw new Error("Load the complete Cascade personal archive before migrating.");
  if (pathBytes(project, CASCADE_PERSONAL_MARKER_PATH)) throw new Error("An unrecognized Cascade personal migration marker already exists.");
  const owners = new Map<number, number>();
  for (let species = 1; species < 650; species += 1) {
    const raw = decodeRecord(project, "personal", species).raw!;
    if (raw.form_id > 0) for (let form = 1; form < raw.num_forms; form += 1) owners.set(raw.form_id + form - 1, species);
  }
  const result: Array<{ id: number; abilities?: AbilityRow }> = [];
  store.rawFiles.forEach((bytes, id) => {
    if (bytes.length !== PERSONAL_SIZE) return; // Regional Dex tables are not personal records.
    const raw = decodeRecord(project, "personal", id).raw!;
    if ((raw.padding ?? 0) !== 0 || (((raw.driftveil_tutor ?? 0) >>> 16) & 255) !== 0) {
      throw new Error(`Pokémon #${id} already has data in the migration bytes. No personal data was changed.`);
    }
    result.push({ id, abilities: table[owners.get(id) ?? id] });
  });
  return result;
}

export async function migrateCascadePersonalData(project: ProjectState): Promise<RomPatchApplyResult> {
  if (!detectCascadeWhiteRom(project)) throw new Error("This migration requires a Cascade White BW2 ROM with its AI injection patch.");
  if (hasCascadePersonalData(project)) return { patchId: "cascadePersonalData", status: "already-applied", summary: "Cascade personal migration is already present. Existing edits were preserved." };
  const source = abilitySource(project);
  if (!source) throw new Error("Unable to identify a unique AI ability table in the loaded Cascade DLLs.");
  const rows = migrationRows(project, source.rows); // Validate every record before writing any.
  project.patches ??= { dirtyOverlayIds: [] };
  (project.patches.applied ??= {}).cascadePersonalData = true;
  for (const { id, abilities } of rows) {
    const record = decodeRecord(project, "personal", id);
    CASCADE_AI_FIELDS.forEach((field, slot) => { record.raw![field] = abilities?.[slot] ?? 0; });
    record.raw!.hidden_ability_chance = 0;
    enrichCascadePersonalRecord(project, record);
    markDirty(project, "personal", id);
  }
  preserveCascadePersonalMigration(project);
  recordGenericChange(project, "personal", `Migrated Cascade AI ability slots from ${source.path} into ${rows.length} personal records.`, "Cascade personal migration");
  return { patchId: "cascadePersonalData", status: "applied", summary: "Migrated Cascade AI abilities into personal data. Hidden Ability Chance starts at 0 and is reserved for future runtime support." };
}
