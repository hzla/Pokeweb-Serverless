import { recordGenericChange } from "./actionChangelog";
import { NARC } from "../nds/narc";
import {
  buildPwanOverrideSideFromPwanBytes,
  ensurePwanAnimationState,
  findPwanOverrideForSpecies,
  parsePwanArchive,
  resolvePwanSpeciesTarget,
  upsertPwanOverride,
} from "./pwanAnimationModel";
import { applyPwanCarrierPatch, loadBundledPwanCarrierTemplate, type PwanCarrierTemplate } from "./pwanCarrierPatch";
import { installPokemonIconPayload, type PokemonIconPayload } from "./pokemonSpriteModel";
import type { ProjectState, PwanAnimationOverride, PwanOverrideSide } from "./projectStore";

export type PwanLibraryCreditSource = "tracker" | "import-report" | "missing";

export type PwanLibraryEntry = {
  id: string;
  name: string;
  key: string;
  kind: string;
  speciesId: number;
  formIndex: number;
  assetIndex: number;
  hasFront: boolean;
  hasBack: boolean;
  credits: string;
  creditSource: PwanLibraryCreditSource;
  notes?: string;
  icon?: {
    maleMemberId: number;
    femaleMemberId: number;
    malePaletteId: number;
    femalePaletteId: number;
  };
};

export type PwanLibraryManifest = {
  format: "pokeweb-pwan-library-v1" | "pokeweb-pwan-library-v2";
  generatedAt: string;
  sourceRom: string;
  archivePath: string;
  archiveBytes: number;
  entryCount: number;
  iconCount?: number;
  sideCount: {
    front: number;
    back: number;
    total: number;
  };
  entries: PwanLibraryEntry[];
};

export type LoadedPwanLibrary = {
  manifest: PwanLibraryManifest;
  entries: PwanLibraryEntry[];
  overridesByEntryId: Map<string, PwanAnimationOverride>;
  iconsByEntryId: Map<string, PokemonIconPayload>;
};

export type ImportPwanLibraryEntryOptions = {
  library?: LoadedPwanLibrary;
  carrier?: PwanCarrierTemplate;
};

const PWAN_LIBRARY_MANIFEST_URL = new URL("../assets/pwan/library/manifest.json", import.meta.url);
const PWAN_LIBRARY_ARCHIVE_URL = new URL("../assets/pwan/library/pwan.narc", import.meta.url);

let loadedPwanLibraryPromise: Promise<LoadedPwanLibrary> | undefined;

export async function loadPwanLibrary(): Promise<LoadedPwanLibrary> {
  loadedPwanLibraryPromise ??= fetchPwanLibrary();
  return loadedPwanLibraryPromise;
}

export function resetPwanLibraryCacheForTests(): void {
  loadedPwanLibraryPromise = undefined;
}

export function listLoadedPwanLibraryEntries(library: LoadedPwanLibrary): PwanLibraryEntry[] {
  return library.entries;
}

export async function importPwanLibraryEntry(
  project: ProjectState,
  targetSpeciesId: number,
  libraryEntryId: string,
  options: ImportPwanLibraryEntryOptions = {},
): Promise<PwanAnimationOverride> {
  const library = options.library ?? await loadPwanLibrary();
  const carrier = options.carrier ?? await loadBundledPwanCarrierTemplate(project.session.baseVersion === "B2" ? "B2" : "W2");
  return importPwanLibraryEntryFromLoadedLibrary(project, targetSpeciesId, libraryEntryId, library, carrier);
}

export function importPwanLibraryEntryFromLoadedLibrary(
  project: ProjectState,
  targetSpeciesId: number,
  libraryEntryId: string,
  library: LoadedPwanLibrary,
  carrier: PwanCarrierTemplate,
): PwanAnimationOverride {
  if (!project.narcs.pokemon_sprites) throw new Error("Pokemon Sprites must be loaded before importing community PWAN assets.");
  const entry = library.entries.find((candidate) => candidate.id === libraryEntryId);
  if (!entry) throw new Error(`PWAN library entry is missing: ${libraryEntryId}`);
  const source = library.overridesByEntryId.get(entry.id);
  if (!source) throw new Error(`PWAN library entry ${entry.name} is not present in the bundled archive.`);
  if (!source.front && !source.back) throw new Error(`PWAN library entry ${entry.name} does not include an importable side.`);
  const icon = library.iconsByEntryId.get(entry.id);
  if (entry.icon && !icon) throw new Error(`PWAN library entry ${entry.name} has an invalid icon payload.`);
  if (icon && !project.narcs.pokemon_icons) throw new Error("Pokemon Icons must be loaded before importing a PWAN Library icon.");

  ensurePwanAnimationState(project);
  const target = resolvePwanSpeciesTarget(project, targetSpeciesId);
  const existing = findPwanOverrideForSpecies(project, targetSpeciesId);
  const front = source.front ? cloneLibrarySide(source.front, entry, "front") : existing?.front ? clonePwanSide(existing.front) : undefined;
  const back = source.back ? cloneLibrarySide(source.back, entry, "back") : existing?.back ? clonePwanSide(existing.back) : undefined;
  const nativePaletteSource = source.back || (!source.front && existing?.nativePaletteSource === "back" && back) ? "back" : "front";
  const next: PwanAnimationOverride = {
    speciesId: target.speciesId,
    formIndex: target.formIndex,
    assetIndex: target.assetIndex === target.speciesId ? undefined : target.assetIndex,
    front,
    back,
    nativePaletteSource,
    carrierTemplate: "w2u-gen6-placeholder",
  };
  upsertPwanOverride(project, next);
  const saved = findPwanOverrideForSpecies(project, targetSpeciesId);
  if (!saved) throw new Error(`PWAN library import for species ${targetSpeciesId} did not save.`);
  applyPwanCarrierPatch(project, saved, carrier);
  if (icon) installPokemonIconPayload(project, target.assetIndex, icon);
  recordGenericChange(project, "pokemon_sprites", `Imported ${entry.name} from Hzla's PWAN Library.`, `Species ${target.speciesId}`, {
    key: `pwan-library-import:${target.speciesId}:${target.formIndex}:${entry.id}`,
  });
  return saved;
}

export function parsePwanLibraryArchive(manifest: PwanLibraryManifest, archiveBytes: Uint8Array): LoadedPwanLibrary {
  const archive = new NARC(archiveBytes);
  const overrides = parsePwanArchive(archive);
  const overridesByEntryId = new Map<string, PwanAnimationOverride>();
  const iconsByEntryId = new Map<string, PokemonIconPayload>();
  for (const entry of manifest.entries) {
    const source = findLibraryOverride(overrides, entry);
    if (source) overridesByEntryId.set(entry.id, source);
    const icon = iconPayloadFromArchive(archive, entry);
    if (icon) iconsByEntryId.set(entry.id, icon);
  }
  return {
    manifest,
    entries: [...manifest.entries].sort((a, b) => a.name.localeCompare(b.name) || a.speciesId - b.speciesId || a.formIndex - b.formIndex || a.assetIndex - b.assetIndex),
    overridesByEntryId,
    iconsByEntryId,
  };
}

async function fetchPwanLibrary(): Promise<LoadedPwanLibrary> {
  const manifestResponse = await fetch(PWAN_LIBRARY_MANIFEST_URL);
  if (!manifestResponse.ok) throw new Error(`Could not load PWAN library manifest (${manifestResponse.status})`);
  const manifest = await manifestResponse.json() as PwanLibraryManifest;
  const archiveResponse = await fetch(PWAN_LIBRARY_ARCHIVE_URL);
  if (!archiveResponse.ok) throw new Error(`Could not load PWAN community asset archive (${archiveResponse.status})`);
  return parsePwanLibraryArchive(manifest, new Uint8Array(await archiveResponse.arrayBuffer()));
}

function findLibraryOverride(overrides: PwanAnimationOverride[], entry: PwanLibraryEntry): PwanAnimationOverride | undefined {
  return (
    overrides.find((override) => override.speciesId === entry.speciesId && (override.formIndex ?? 0) === entry.formIndex && (override.assetIndex ?? override.speciesId) === entry.assetIndex) ??
    overrides.find((override) => override.speciesId === entry.speciesId && (override.formIndex ?? 0) === entry.formIndex) ??
    overrides.find((override) => (override.assetIndex ?? override.speciesId) === entry.assetIndex)
  );
}

function iconPayloadFromArchive(archive: NARC, entry: PwanLibraryEntry): PokemonIconPayload | undefined {
  if (!entry.icon) return undefined;
  const male = archive.files[entry.icon.maleMemberId];
  const female = archive.files[entry.icon.femaleMemberId];
  if (!male?.length || !female) return undefined;
  return {
    male: male.slice(),
    female: female.slice(),
    malePaletteId: entry.icon.malePaletteId,
    femalePaletteId: entry.icon.femalePaletteId,
  };
}

function cloneLibrarySide(side: PwanOverrideSide, entry: PwanLibraryEntry, sideName: "front" | "back"): PwanOverrideSide {
  return {
    ...buildPwanOverrideSideFromPwanBytes(side.pwanBytes, `Hzla PWAN Library/${entry.name}/${sideName}.pwan`),
    notes: side.notes ? [...side.notes] : undefined,
  };
}

function clonePwanSide(side: PwanOverrideSide): PwanOverrideSide {
  return {
    ...side,
    sourceGifBytes: side.sourceGifBytes.slice(),
    pwanBytes: side.pwanBytes.slice(),
    scaleBasePwanBytes: side.scaleBasePwanBytes?.slice(),
    offsetBasePwanBytes: side.offsetBasePwanBytes?.slice(),
    paletteBgr555: side.paletteBgr555.slice(),
    notes: side.notes ? [...side.notes] : undefined,
  };
}
