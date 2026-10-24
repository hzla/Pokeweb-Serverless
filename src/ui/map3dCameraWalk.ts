import type { CameraVector } from "../pokeweb/fieldCameraModel";
import type { Map3dChunk } from "../pokeweb/map3dModel";
import { isWaterLikePermission } from "../pokeweb/gen5PermissionModel";
export type CameraWalkDirection = "up" | "down" | "left" | "right";
export const CAMERA_WALK_KEYS: Record<string, { x: number; z: number; direction: CameraWalkDirection }> = {
  ArrowUp: { x: 0, z: -1, direction: "up" }, ArrowDown: { x: 0, z: 1, direction: "down" },
  ArrowLeft: { x: -1, z: 0, direction: "left" }, ArrowRight: { x: 1, z: 0, direction: "right" },
};
export function cameraWalkTileCenter(point: CameraVector): CameraVector {
  return { x: Math.floor(point.x / 16) * 16 + 8, y: point.y, z: Math.floor(point.z / 16) * 16 + 8 };
}

/** Choose an initial preview position on open ground instead of a chunk's arbitrary center. */
export function cameraWalkStart(chunks: ReadonlyArray<Pick<Map3dChunk, "matrixX" | "matrixY" | "worldX" | "worldY" | "worldZ" | "permissions">>, groundHeight: (x: number, z: number) => number | undefined): CameraVector {
  const first = chunks[0];
  const fallback = cameraWalkTileCenter({ x: first?.worldX ?? 0, y: first?.worldY ?? 0, z: first?.worldZ ?? 0 });
  const candidates: Array<{ x: number; z: number }> = [];
  for (const chunk of chunks) {
    const permissions = chunk.permissions;
    if (!permissions) continue;
    permissions.tiles.forEach((tile, index) => {
      if (tile.flags & 1 || tile.tileClass === 1 || tile.tileClass === 18 || isWaterLikePermission(tile)) return;
      const x = chunk.worldX + (index % permissions.width + 0.5 - permissions.width / 2) * 16;
      const z = chunk.worldZ + (Math.floor(index / permissions.width) + 0.5 - permissions.height / 2) * 16;
      if (Math.floor(x / 512) === chunk.matrixX && Math.floor(z / 512) === chunk.matrixY) candidates.push({ x, z });
    });
  }
  const distance = (p: { x: number; z: number }) => (p.x - fallback.x) ** 2 + (p.z - fallback.z) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b));
  for (const candidate of candidates) {
    const y = groundHeight(candidate.x, candidate.z);
    if (y !== undefined) return { ...candidate, y };
  }
  return { ...fallback, y: groundHeight(fallback.x, fallback.z) ?? fallback.y };
}
export function cameraWalkStep(point: CameraVector, key: string, cells: ReadonlyArray<{ matrixX: number; matrixY: number }>): (CameraVector & { direction: CameraWalkDirection }) | undefined {
  const delta = CAMERA_WALK_KEYS[key]; if (!delta) return undefined;
  const centered = cameraWalkTileCenter(point), x = centered.x + delta.x * 16, z = centered.z + delta.z * 16;
  if (!cells.some(c => c.matrixX === Math.floor(x / 512) && c.matrixY === Math.floor(z / 512))) return undefined;
  return { x, y: point.y, z, direction: delta.direction };
}
