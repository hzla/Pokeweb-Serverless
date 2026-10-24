import type { NarcName } from "./constants";
import { getNarcFormats } from "./formats";
import type { NarcFormatMap } from "./formats";
import type { HeaderCollection } from "./headerModel";
import type { GrottoOddsState } from "./martGrottoModel";
import type { ActionChangelogState } from "./actionChangelog";
import type { TmState } from "./tmModel";
import type {
  ProjectSettings, NarcStore, TextState, DocGeneratorState, Map3dAreaEditState,
  FileSystemEditState, CodeInjectionState, OverworldWeatherState, PwanAnimationState,
  W2AnimAnimationState, TrainerPwanAnimationState, StarterState, PatchState,
} from "./projectStore";
import type { ProjectDocument } from "./projectDocument";

/** The mutable working set used by editors. Never pass this object to storage.
 * Flat fields keep existing models and staged installers compatible without
 * proxies, a second mutable document, or duplicate resource buffers. */
export type ProjectSession = {
  bw2ScriptRuntimeContext?: import("./bw2ScriptOverlayContext").Bw2ScriptRuntimeContext;
  bw2ScriptEditor?: import("./bw2ScriptModel").Bw2ScriptEditorState;
  cgearButtons?: import("../cgearButtons/document").Project;
  systemShops?: import("../systemShops/document").Project;
  customUi?: import("../customUi/document").Project;
  cutsceneAuthoring?: import("./cutsceneScene").CutsceneAuthoringState;
  fieldScenes?: import("./fieldScene").FieldSceneAuthoring;
  originalRomBytes?: Uint8Array;
  /** Compatibility field name for durable project settings. */
  session: ProjectSettings;
  romInfo: {
    title: string;
    idCode: string;
    fileName: string;
    size: number;
    /** SHA-256 of the exact input, computed for US Black 2 upgrade eligibility; otherwise omitted. */
    sourceSha256?: string;
  };
  arm9: Uint8Array;
  arm9Compressed?: boolean;
  arm9Dirty?: boolean;
  rigAtlas?: {
    width: number;
    height: number;
    expanded: boolean;
  };
  overlays: Partial<Record<number, Uint8Array>>;
  narcs: Partial<Record<NarcName, NarcStore>>;
  texts: TextState;
  /** Session-only derived data. Dirty decoded dictionaries are materialized before save. */
  formats: NarcFormatMap;
  trpokInfo: Array<{ template: number; numPokemon: number }>;
  headers?: HeaderCollection;
  grottoOdds?: GrottoOddsState;
  tms?: TmState;
  docs?: DocGeneratorState;
  map3dAreaEdits?: Map3dAreaEditState;
  fileSystem?: FileSystemEditState;
  /** Small ROM-backed archive retained when autosave releases originalRomBytes. */
  koMoveLearnsetSource?: { fileId: number; bytes: Uint8Array };
  trainerLocationTables?: import("./trainerLocationModel").TrainerLocationTables;
  /** Cascade DLLs and migration markers retained when autosave releases the ROM. */
  cascadePersonalSources?: Record<string, { fileId: number; bytes: Uint8Array }>;
  codeInjection?: CodeInjectionState;
  overworldWeather?: OverworldWeatherState;
  pwanAnimations?: PwanAnimationState;
  w2animAnimations?: W2AnimAnimationState;
  trainerPwanAnimations?: TrainerPwanAnimationState;
  starters?: StarterState;
  patches?: PatchState;
  flyDestinations?: import("./flyDestinationModel").FlyDestinationState;
  actionChangelog?: ActionChangelogState;
};

/** Take ownership of a deserialized document. No binary copies or parallel
 * mutable document are retained; all runtime caches start fresh. */
export function openProjectSession(document: ProjectDocument): ProjectSession {
  const narcs: ProjectSession["narcs"] = {};
  for (const [key, store] of Object.entries(document.narcs)) {
    if (!store) continue;
    narcs[key as NarcName] = {
      name: store.name, fileId: store.fileId, sourcePath: store.sourcePath,
      container: store.container, fileCount: store.fileCount, filenames: store.filenames,
      rawFiles: store.rawFiles, dirty: store.dirty, records: new Map(),
    };
  }
  const w2anim = document.w2animAnimations;
  // Legacy snapshots could contain a small archive view backed by a full ROM.
  // Detach that view even when the source store is missing and cannot hydrate.
  const w2animAnimations = w2anim && w2anim.sourceBytes.buffer.byteLength !== w2anim.sourceBytes.byteLength
    ? { ...w2anim, sourceBytes: w2anim.sourceBytes.slice() } : w2anim;
  const project: ProjectSession = {
    session: document.settings, romInfo: document.romInfo,
    arm9: document.arm9, arm9Compressed: document.arm9Compressed, arm9Dirty: document.arm9Dirty,
    rigAtlas: document.rigAtlas, overlays: document.overlays, narcs,
    texts: { banks: document.texts.banks }, formats: getNarcFormats(document.settings.baseRom), trpokInfo: [],
    tms: document.tms ? { ...document.tms, readable: {} } : undefined,
    docs: document.docs ? { ...document.docs, trainerLocations: {}, trainerDiffs: {},
      itemLocations: {}, groundItemScriptMap: {} } : undefined,
    bw2ScriptEditor: document.scriptDrafts ? { drafts: document.scriptDrafts } : undefined,
    cgearButtons: document.cgearButtons, systemShops: document.systemShops, customUi: document.customUi,
    cutsceneAuthoring: document.cutsceneAuthoring,
    fieldScenes: document.fieldScenes,
    map3dAreaEdits: document.map3dAreaEdits, fileSystem: document.fileSystem,
    codeInjection: document.codeInjection, overworldWeather: document.overworldWeather,
    pwanAnimations: document.pwanAnimations, w2animAnimations,
    trainerPwanAnimations: document.trainerPwanAnimations, starters: document.starters,
    patches: document.patches, flyDestinations: document.flyDestinations, actionChangelog: document.actionChangelog,
    // Recovery sources are the only runtime data allowed at the storage boundary.
    bw2ScriptRuntimeContext: document.recovery?.bw2ScriptRuntimeContext,
    koMoveLearnsetSource: document.recovery?.koMoveLearnsetSource,
    trainerLocationTables: document.recovery?.trainerLocationTables,
    cascadePersonalSources: document.recovery?.cascadePersonalSources,
  };
  refreshProjectSessionIndexes(project);
  return project;
}

/** Rebuild small indexes from current resource bytes without decoding/caching
 * every trainer record or loading the original ROM again. */
export function refreshProjectSessionIndexes(project: ProjectSession): void {
  const trdata = project.narcs.trdata;
  project.trpokInfo = trdata?.rawFiles.map((bytes, id) => {
    const raw = trdata.records.get(id)?.raw;
    return { template: raw?.template ?? bytes[0] ?? 0, numPokemon: raw?.num_pokemon ?? bytes[3] ?? 0 };
  }) ?? [];
  if (project.tms) for (const [field, id] of Object.entries(project.tms.raw))
    project.tms.readable[field] = project.texts.banks.moves?.[id] ?? `Move ${id}`;
}

