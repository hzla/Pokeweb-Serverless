import type { HeaderRow } from "./headerModel";
import type { Map3dSceneData, Map3dTile } from "./map3dModel";
import type { MapCameraTestPosition } from "./mapCameraTest";
import { mapTestProfile } from "./mapTestRuntime";
import { loadMatrixEditorData, type MatrixCell, type MatrixSnapshot } from "./matrixModel";
import type { ProjectState } from "./projectStore";
import { getMapReplacementBytes, replacementRules, resolveSeasonalMatrix } from "./seasonalMatrixModel";

type WarpCell = { zoneId: number; cell: MatrixCell };

function matrixCell(matrix: MatrixSnapshot, x: number, y: number) {
  return x >= 0 && y >= 0 && x < matrix.width && y < matrix.height ? matrix.cells[y * matrix.width + x] : undefined;
}

/** Resolve the same header or parent assignment used by the zone viewer. */
function headerOwnsCell(matrix: MatrixSnapshot, header: HeaderRow, cell: MatrixCell) {
  if (!matrix.hasHeaders) return true;
  if (cell.headerId === header.index) return true;
  return cell.headerId === Number(header.parent_map_id)
    && !matrix.cells.some(other => other.headerId === header.index);
}

export async function prepareMapExploreDestination(project: ProjectState, data: Map3dSceneData) {
  mapTestProfile(project);
  await loadMatrixEditorData(project, { seasons: true });
  return mapExploreDestinationPicker(project, data);
}

/** Read existing routes only. A chunk preview can use a graphics-only header, so verify ownership independently. */
export function mapExploreDestinationPicker(project: ProjectState, data: Map3dSceneData) {
  const headers = Object.values(project.headers?.rows ?? {});
  const currentHeader = headers.find(row => row.index === data.zoneId);
  const rules = replacementRules(getMapReplacementBytes(project));
  const snapshots = new Map<number, MatrixSnapshot>();
  function matrix(id: number) {
    const cached = snapshots.get(id);
    if (cached) return cached;
    const resolved = resolveSeasonalMatrix(project, id, data.season, undefined, rules);
    snapshots.set(id, resolved);
    return resolved;
  }

  function linkedCell(chunk: Map3dSceneData["chunks"][number]): WarpCell {
    const shown = matrix(data.sourceMatrixId);
    const displayedCell = matrixCell(shown, chunk.matrixX, chunk.matrixY);
    if (shown.id !== data.matrixId || displayedCell?.mapId !== chunk.chunkId) {
      throw new Error("Map assignments changed. Reload the map before testing a warp.");
    }

    const headerMatrixId = Number(currentHeader?.matrix_id);
    if (currentHeader && headerMatrixId === data.sourceMatrixId && headerOwnsCell(shown, currentHeader, displayedCell)) {
      // An isolated preview only identifies a header when it has an explicit owner
      // or exactly one header points to its headerless matrix.
      const ownsPreview = shown.hasHeaders ? displayedCell.headerId === currentHeader.index
        : !headers.some(header => header !== currentHeader && Number(header.matrix_id) === headerMatrixId);
      if (!data.matrixCell || ownsPreview) {
        return { zoneId: currentHeader.index, cell: displayedCell };
      }
    }
    if (!data.matrixCell) throw new Error("The selected tile is no longer assigned to this header. Reload the map.");

    const exact = new Map<string, WarpCell>(), elsewhere = new Map<string, WarpCell>();
    const headersByMatrix = new Map<number, HeaderRow[]>();
    for (const header of headers) {
      const id = Number(header.matrix_id);
      if (!project.narcs.matrix?.rawFiles[id]?.length) continue;
      const group = headersByMatrix.get(id) ?? [];
      group.push(header);
      headersByMatrix.set(id, group);
    }
    for (const [id, group] of headersByMatrix) {
      let route: MatrixSnapshot;
      try { route = matrix(id); }
      catch { continue; } // An unreadable unrelated matrix has no usable warp route.
      for (const cell of route.cells) {
        if (cell.mapId !== chunk.chunkId) continue;
        const owner = route.hasHeaders ? group.find(header => header.index === cell.headerId) : undefined;
        const eligible = owner ? [owner] : group.filter(header => headerOwnsCell(route, header, cell));
        const matches = route.id === shown.id && cell.x === displayedCell.x && cell.y === displayedCell.y ? exact : elsewhere;
        for (const { index: zoneId } of eligible) matches.set(`${zoneId}:${cell.x},${cell.y}`, { zoneId, cell });
      }
    }
    const routes = exact.size ? exact : elsewhere;
    if (routes.size === 1) return routes.values().next().value!;
    if (routes.size > 1) throw new Error("This map has multiple in-game locations. Open it through the header you want to test.");
    throw new Error("Assign this map to an in-game header before testing a warp.");
  }

  return (selection: Map3dTile): MapCameraTestPosition => {
    const { matrixX, matrixY, tileX, tileY } = selection;
    const chunk = data.chunks.find(chunk => chunk.matrixX === matrixX && chunk.matrixY === matrixY);
    const permissions = chunk?.permissions;
    if (!chunk || !permissions || ![tileX, tileY].every(value => Number.isInteger(value) && value >= 0 && value < 32)
      || tileX >= permissions.width || tileY >= permissions.height) {
      throw new Error("Select a tile in the loaded map.");
    }
    const { zoneId, cell } = linkedCell(chunk);
    const x = cell.x * 32 + tileX, z = cell.y * 32 + tileY;
    if (x > 2047 || z > 2047) throw new Error("The selected tile is outside the native map warp range.");
    // The game resolves the walking height when the warp loads the existing zone.
    return { zoneId, tileX: x, tileZ: z, height: 0, facing: "up" };
  };
}
