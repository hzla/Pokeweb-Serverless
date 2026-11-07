import { readGen5MapBin, equalMapBytes } from "./gen5MapImportFormats";
import { invalidateMap3dAssets, packGameFreakContainer } from "./map3dModel";
import { recordGenericChange } from "./actionChangelog";
import { markDirty, type ProjectState } from "./projectStore";
import type { generateGen5MapHeights } from "./gen5MapHeightGeneration";
export type GeneratedMapHeights = ReturnType<typeof generateGen5MapHeights>;
export type MapHeightEdit = { mapId: number; before: Uint8Array; after: Uint8Array; applied: boolean };
export function prepareMapHeightEdit(mapId: number, source: Uint8Array, result: GeneratedMapHeights): MapHeightEdit {
  if (!result.canApply) throw new Error("Resolve missing, overlapping or unrepresentable walking surfaces before applying heights.");
  const parsed = readGen5MapBin(source), files = parsed.files.map(f => f.slice());
  files[1] = result.primary;
  if (result.secondary && parsed.placements === 3) files[2] = result.secondary;
  return { mapId, before: source.slice(), after: packGameFreakContainer(parsed.signature, files), applied: false };
}
export function applyMapHeightEdit(project: ProjectState, edit: MapHeightEdit, undo = false) {
  if (undo !== edit.applied) throw new Error(undo ? "These heights are not applied." : "These heights are already applied.");
  const store = project.narcs.maps;
  if (!store || !equalMapBytes(store.rawFiles[edit.mapId], undo ? edit.after : edit.before)) throw new Error("This map changed. Generate heights again before applying or undoing them.");
  store.rawFiles[edit.mapId] = (undo ? edit.before : edit.after).slice(); store.records.delete(edit.mapId);
  markDirty(project, "maps", edit.mapId); invalidateMap3dAssets(); edit.applied = !undo;
  recordGenericChange(project, "maps3d", `${undo ? "Restored" : "Generated"} walking heights in map ${edit.mapId}.`, `Map ${edit.mapId}`, { key: `map-height-generation:${edit.mapId}` });
}
