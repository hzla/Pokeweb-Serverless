import { equalBytes, readU16, writeU16 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import type { NarcName } from "./constants";
import type { Gen5PermissionTileLike } from "./gen5PermissionModel";
import { invalidateMap3dAssets } from "./map3dModel";
import { ensure } from "./nitroResourceWriter";
import { markDirty, type ProjectState } from "./projectStore";
import type { MatrixSeason } from "./seasonalMatrixModel";

/**
 * What every map brush (grass, trees, ledges, objects, thick grass, fences, models) shares about a stroke: the files
 * it rewrote, the tiles it saved so erasing restores them, and the tiles it skipped. A brush describes itself once
 * with a `BrushStrokeKind`; writing, undoing and redoing a stroke then work the same way for every brush.
 */

/** A collision tile record in a map chunk's permission file: a 16-bit class and 16-bit flags every 8 bytes. */
export function permission(bytes: Uint8Array, index: number): Gen5PermissionTileLike {
  const at = 8 + index * 8;
  return { tileClass: readU16(bytes, at), flags: readU16(bytes, at + 2) };
}

export function writePermission(bytes: Uint8Array, index: number, { tileClass, flags }: Gen5PermissionTileLike) {
  const at = 8 + index * 8;
  writeU16(bytes, at, tileClass);
  writeU16(bytes, at + 2, flags);
}

/** One file a stroke rewrote. */
export type BrushFileChange = { id: number; before: Uint8Array; after: Uint8Array };
/** A file in a NARC other than the map chunks and texture packs. */
export type BrushStoreChange = BrushFileChange & { store: NarcName };
/** A map chunk a stroke rewrote, with the tiles the brush had saved for it before and after. */
export type BrushMapChange<Originals> = BrushFileChange & { originalsBefore?: Originals; originalsAfter?: Originals };
export type BrushSkip<Reason extends string> = { reason: Reason; count: number; season?: MatrixSeason };

export type BrushStroke<Action extends string, Reason extends string, Originals> = {
  action: Action;
  maps: BrushMapChange<Originals>[];
  /** Map texture packs (a/0/1/4). */
  textures: BrushFileChange[];
  count: number;
  skipped: number;
  skipReasons: BrushSkip<Reason>[];
};

type AnyBrushStroke = {
  action: string;
  maps: BrushMapChange<unknown>[];
  textures?: BrushFileChange[];
  archives?: BrushStoreChange[];
  count: number;
  skipped: number;
  skipReasons: BrushSkip<string>[];
};

/** Project fields where each brush keeps, per map chunk, the tiles its placements replaced. */
export type BrushOriginalsField =
  | "mapGrassOriginalPermissions" | "mapTreeOriginalPermissions" | "mapLedgeOriginalPermissions" | "mapStampOriginalPermissions"
  | "mapThickGrassOriginalPermissions" | "mapFenceOriginalPermissions" | "mapFenceTileOriginals" | "mapPropOriginals";

export type BrushStrokeKind<S extends AnyBrushStroke> = {
  originals: BrushOriginalsField;
  /** What the brush edits, for messages such as "Undid a tree edit" and "The saved tree tiles changed". */
  thing: string;
  /** The stroke's count with its noun, such as "3 trees". */
  counted: (count: number) => string;
  /** Per action: how the changelog starts ("Placed") and the changelog label ("Place Trees"). */
  actions: Record<S["action"], { done: string; label: string }>;
  /** Whether the stroke changed what the 3D view has cached. Defaults to whether it changed texture packs. */
  changesAssets?: (stroke: S) => boolean;
  /** State outside the NARCs, such as texture animation files. */
  extra?: {
    what: string;
    matches: (project: ProjectState, stroke: S, side: "before" | "after") => boolean;
    write: (project: ProjectState, stroke: S, undo: boolean) => void;
  };
  /** Runs after the stroke is written, for caches only this brush has. */
  afterWrite?: (project: ProjectState, stroke: S) => void;
};

/** `counted` for nouns that just take an "s". */
export const countedAs = (noun: string) => (count: number) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function emptyBrushStroke<Action extends string>(action: Action) {
  return { action, maps: [], textures: [], count: 0, skipped: 0, skipReasons: [] };
}

/** Start a stroke. `skip` counts a skipped tile under its reason and season. */
export function startBrushStroke<S extends AnyBrushStroke>(result: S) {
  return {
    result,
    skip(reason: S["skipReasons"][number]["reason"], season?: MatrixSeason) {
      result.skipped++;
      const group = result.skipReasons.find(entry => entry.reason === reason && entry.season === season);
      if (group) group.count++;
      else result.skipReasons.push({ reason, count: 1, ...(season ? { season } : {}) });
    },
  };
}

function storeChanges(stroke: AnyBrushStroke): BrushStoreChange[] {
  return [
    ...stroke.maps.map(({ id, before, after }) => ({ store: "maps" as const, id, before, after })),
    ...(stroke.textures ?? []).map(change => ({ ...change, store: "map_textures" as const })),
    ...(stroke.archives ?? []),
  ];
}

const savedOriginals = (project: ProjectState, field: BrushOriginalsField): Readonly<Record<number, unknown>> | undefined => project[field];

/** Apply a stroke's files and saved tiles (`undo` puts back the `before` side), then record it in the changelog. */
export function writeBrushStroke<S extends AnyBrushStroke>(project: ProjectState, kind: BrushStrokeKind<S>, stroke: S, undo: boolean) {
  for (const { store: name, id, before, after } of storeChanges(stroke)) {
    const store = project.narcs[name];
    ensure(store, "Reload the map before editing it.");
    store.rawFiles[id] = (undo ? before : after).slice();
    store.records.delete(id);
    markDirty(project, name, id);
  }
  kind.extra?.write(project, stroke, undo);
  const originals: Record<number, unknown> = { ...savedOriginals(project, kind.originals) };
  for (const { id, originalsBefore, originalsAfter } of stroke.maps) {
    const next = undo ? originalsBefore : originalsAfter;
    if (next) originals[id] = next;
    else delete originals[id];
  }
  Object.assign(project, { [kind.originals]: Object.keys(originals).length ? originals : undefined });
  if (kind.changesAssets ? kind.changesAssets(stroke) : stroke.textures?.length) invalidateMap3dAssets();
  kind.afterWrite?.(project, stroke);
  const action = kind.actions[stroke.action as S["action"]];
  const article = /^[aeiou]/i.test(kind.thing) ? "an" : "a";
  recordGenericChange(project, "maps3d",
    undo ? `Undid ${article} ${kind.thing} edit (${kind.counted(stroke.count)}).` : `${action.done} ${kind.counted(stroke.count)}.`, action.label);
}

/** Throws `message` unless every file the stroke touched still holds its `side` bytes. */
export function assertStoresMatch(project: ProjectState, stroke: AnyBrushStroke, side: "before" | "after", message: string) {
  ensure(storeChanges(stroke).every(change => {
    const bytes = project.narcs[change.store]?.rawFiles[change.id];
    return bytes && equalBytes(bytes, change[side]);
  }), message);
}

function replayBrushStroke<S extends AnyBrushStroke>(project: ProjectState, kind: BrushStrokeKind<S>, stroke: S, undo: boolean) {
  if (!stroke.count) return;
  // Undo expects the stroke's result to still be there, and redo expects what undo left.
  const side = undo ? "after" : "before";
  const when = `this ${kind.thing} edit${undo ? "" : " was undone"}`;
  assertStoresMatch(project, stroke, side, `Map resources changed after ${when}.`);
  if (kind.extra) ensure(kind.extra.matches(project, stroke, side), `${kind.extra.what} changed after ${when}.`);
  const saved = savedOriginals(project, kind.originals);
  ensure(stroke.maps.every(change => saved?.[change.id] === (undo ? change.originalsAfter : change.originalsBefore)),
    `The saved ${kind.thing} tiles changed after ${when}.`);
  writeBrushStroke(project, kind, stroke, undo);
}

/** Take back a stroke, as long as nothing changed its files or saved tiles since. */
export function undoBrushStroke<S extends AnyBrushStroke>(project: ProjectState, kind: BrushStrokeKind<S>, stroke: S) {
  replayBrushStroke(project, kind, stroke, true);
}

/** Re-apply a stroke that `undoBrushStroke` took back, as long as nothing changed since. */
export function redoBrushStroke<S extends AnyBrushStroke>(project: ProjectState, kind: BrushStrokeKind<S>, stroke: S) {
  replayBrushStroke(project, kind, stroke, false);
}
