import type { NarcName } from "./constants";
import type { Folder } from "../nds/fnt";
import type { Bw2ScriptDraft } from "./bw2ScriptModel";
import type { ProjectSession } from "./projectSession";
import type {
  ProjectSettings, DocGeneratorState, Map3dAreaEditState, FileSystemEditState,
  CodeInjectionState, OverworldWeatherState, PwanAnimationState, W2AnimAnimationState,
  TrainerPwanAnimationState, StarterState, PatchState, TextState,
} from "./projectStore";
import type { TmState } from "./tmModel";
import type { ActionChangelogState } from "./actionChangelog";
import { materializeProjectEdits } from "./projectMaterialize";
import { W2ANIM_PATH } from "./w2animCodec";

export const PROJECT_DOCUMENT_FORMAT = "pokeweb.project";
export const PROJECT_DOCUMENT_VERSION = 1;
// Missing source-backed members carry no writable bytes. Share one placeholder
// instead of allocating and serializing thousands of zero-length typed arrays.
const MISSING_SOURCE_BYTES = new Uint8Array();

/** Binary edits and their source identity, without decoded records or revisions. */
export type NarcDocument = {
  name: NarcName;
  fileId: number;
  sourcePath: string;
  container?: "narc" | "file";
  fileCount: number;
  rawFiles: Uint8Array[];
  filenames?: Folder;
  dirty: Set<number>;
};

/** Only needed when the matching source ROM is unavailable during a save. */
export type ProjectSourceRecovery = Pick<ProjectSession,
  "bw2ScriptRuntimeContext" | "koMoveLearnsetSource" | "trainerLocationTables" | "cascadePersonalSources">;

/** Durable contract. Add authored features here deliberately; live fields are not serialized implicitly. */
export type ProjectDocument = {
  format: typeof PROJECT_DOCUMENT_FORMAT;
  version: typeof PROJECT_DOCUMENT_VERSION;
  settings: ProjectSettings;
  romInfo: ProjectSession["romInfo"];
  arm9: Uint8Array;
  arm9Compressed?: boolean;
  arm9Dirty?: boolean;
  rigAtlas?: ProjectSession["rigAtlas"];
  overlays: Partial<Record<number, Uint8Array>>;
  narcs: Partial<Record<NarcName, NarcDocument>>;
  /** Small name lists used by unloaded editors; decoded text banks stay in the session. */
  texts: Pick<TextState, "banks">;
  tms?: Pick<TmState, "offset" | "byteLength" | "raw" | "dirty">;
  docs?: Pick<DocGeneratorState, "romTitle" | "mastersheetMarkdown" | "mastersheetHighlights">;
  scriptDrafts?: Record<number, Bw2ScriptDraft>;
  cgearButtons?: import("../cgearButtons/document").Project;
  systemShops?: import("../systemShops/document").Project;
  customUi?: import("../customUi/document").Project;
  map3dAreaEdits?: Map3dAreaEditState;
  fileSystem?: FileSystemEditState;
  codeInjection?: CodeInjectionState;
  overworldWeather?: OverworldWeatherState;
  pwanAnimations?: PwanAnimationState;
  w2animAnimations?: W2AnimAnimationState;
  trainerPwanAnimations?: TrainerPwanAnimationState;
  starters?: StarterState;
  patches?: PatchState;
  flyDestinations?: import("./flyDestinationModel").FlyDestinationState;
  actionChangelog?: ActionChangelogState;
  recovery?: ProjectSourceRecovery;
};

// A new live field must get an explicit storage role instead of silently losing
// authored work or entering a snapshot as a cache. This check emits no code.
type SessionOnlyField = "originalRomBytes" | "formats" | "trpokInfo" | "headers" | "grottoOdds" | keyof ProjectSourceRecovery;
type MustBeNever<T extends never> = T;
type ProjectFieldClassificationCheck = MustBeNever<Exclude<
  keyof ProjectSession, keyof ProjectDocument | "session" | "bw2ScriptEditor" | SessionOnlyField
>>;

/** Materialize authored dictionaries first. Retained buffers are borrowed until
 * IndexedDB's synchronous put serialization; do not hold this as a second state. */
export function createProjectDocument(project: ProjectSession, hasMatchingSource: boolean): ProjectDocument {
  materializeProjectEdits(project);
  const dirtyOverlayIds = new Set(project.patches?.dirtyOverlayIds ?? []);
  const narcs: ProjectDocument["narcs"] = {};
  for (const [key, store] of Object.entries(project.narcs)) {
    if (!store) continue;
    narcs[key as NarcName] = {
      name: store.name, fileId: store.fileId, sourcePath: store.sourcePath,
      container: store.container, fileCount: store.fileCount, filenames: store.filenames,
      dirty: store.dirty,
      rawFiles: hasMatchingSource
        ? store.rawFiles.map((bytes, id) => store.dirty.has(id) ? bytes : MISSING_SOURCE_BYTES)
        : store.rawFiles,
    };
  }
  return {
    format: PROJECT_DOCUMENT_FORMAT, version: PROJECT_DOCUMENT_VERSION,
    settings: project.session, romInfo: project.romInfo,
    arm9: hasMatchingSource && !project.tms?.dirty && !project.arm9Dirty ? MISSING_SOURCE_BYTES : project.arm9,
    arm9Compressed: project.arm9Compressed, arm9Dirty: project.arm9Dirty, rigAtlas: project.rigAtlas,
    overlays: hasMatchingSource
      ? Object.fromEntries(Object.entries(project.overlays).filter(([id]) => dirtyOverlayIds.has(Number(id))))
      : project.overlays,
    narcs, texts: { banks: project.texts.banks },
    tms: project.tms ? { offset: project.tms.offset, byteLength: project.tms.byteLength,
      raw: project.tms.raw, dirty: project.tms.dirty } : undefined,
    docs: project.docs ? { romTitle: project.docs.romTitle, mastersheetMarkdown: project.docs.mastersheetMarkdown,
      mastersheetHighlights: project.docs.mastersheetHighlights } : undefined,
    scriptDrafts: project.bw2ScriptEditor?.drafts,
    cgearButtons: project.cgearButtons, systemShops: project.systemShops, customUi: project.customUi,
    map3dAreaEdits: project.map3dAreaEdits, fileSystem: project.fileSystem,
    codeInjection: project.codeInjection, overworldWeather: project.overworldWeather,
    pwanAnimations: project.pwanAnimations,
    // Source bytes can be reloaded, but authoring baselines/targets must survive
    // to distinguish unchanged bridges, deletions, and unapplied animation work.
    w2animAnimations: project.w2animAnimations ? {
      fileId: project.w2animAnimations.fileId,
      sourceBytes: hasMatchingSource && !project.fileSystem?.additions?.[W2ANIM_PATH]
        ? MISSING_SOURCE_BYTES : project.w2animAnimations.sourceBytes,
      editorOriginals: project.w2animAnimations.editorOriginals,
      editorTargets: project.w2animAnimations.editorTargets,
    } : undefined,
    trainerPwanAnimations: project.trainerPwanAnimations, starters: project.starters,
    patches: project.patches, flyDestinations: project.flyDestinations, actionChangelog: project.actionChangelog,
    recovery: hasMatchingSource ? undefined : {
      bw2ScriptRuntimeContext: project.bw2ScriptRuntimeContext,
      koMoveLearnsetSource: project.koMoveLearnsetSource,
      trainerLocationTables: project.trainerLocationTables,
      cascadePersonalSources: project.cascadePersonalSources,
    },
  };
}

export class ProjectDocumentError extends Error {
  constructor(message: string) { super(message); this.name = "ProjectDocumentError"; }
}

/** Read-only migration: storage is replaced only by a subsequent successful save. */
export function readProjectDocument(value: unknown): { document: ProjectDocument; originalRomBytes?: Uint8Array } {
  if (!value || typeof value !== "object") throw new ProjectDocumentError("The saved project data could not be read.");
  if ("format" in value || "version" in value) {
    const candidate = value as ProjectDocument;
    if (candidate.format !== PROJECT_DOCUMENT_FORMAT)
      throw new ProjectDocumentError("This saved project uses an unrecognized format.");
    if (candidate.version !== PROJECT_DOCUMENT_VERSION)
      throw new ProjectDocumentError(`Saved project version ${candidate.version} is not supported by this Pokeweb version. Open it with the version that saved it or a newer compatible version.`);
    validateCore(candidate.settings, candidate);
    return { document: candidate };
  }
  const legacy = value as ProjectSession;
  validateCore(legacy.session, legacy);
  return { document: createProjectDocument(legacy, false), originalRomBytes: legacy.originalRomBytes };
}

function validateCore(settings: ProjectSettings | undefined, value: Pick<ProjectDocument, "romInfo" | "arm9" | "narcs" | "overlays" | "texts">): void {
  if (!settings || !["BW", "BW2", "DP", "Pt", "HGSS"].includes(settings.baseRom) ||
      !value.romInfo || !(value.arm9 instanceof Uint8Array) || !value.narcs || !value.overlays || !value.texts?.banks)
    throw new ProjectDocumentError("The saved project's required data is incomplete. Your stored project has been preserved.");
  for (const store of Object.values(value.narcs)) {
    if (store && (!Array.isArray(store.rawFiles) || !(store.dirty instanceof Set)))
      throw new ProjectDocumentError("The saved project's archive data is incomplete. Your stored project has been preserved.");
  }
}
