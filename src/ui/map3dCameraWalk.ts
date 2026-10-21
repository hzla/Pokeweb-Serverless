import type { CameraVector } from "../pokeweb/fieldCameraModel";
export type CameraWalkDirection = "up" | "down" | "left" | "right";
export const CAMERA_WALK_KEYS: Record<string, { x: number; z: number; direction: CameraWalkDirection }> = {
  ArrowUp: { x: 0, z: -1, direction: "up" }, ArrowDown: { x: 0, z: 1, direction: "down" },
  ArrowLeft: { x: -1, z: 0, direction: "left" }, ArrowRight: { x: 1, z: 0, direction: "right" },
};
export function cameraWalkTileCenter(point: CameraVector): CameraVector {
  return { x: Math.floor(point.x / 16) * 16 + 8, y: point.y, z: Math.floor(point.z / 16) * 16 + 8 };
}
export function cameraWalkStep(point: CameraVector, key: string, cells: ReadonlyArray<{ matrixX: number; matrixY: number }>): (CameraVector & { direction: CameraWalkDirection }) | undefined {
  const delta = CAMERA_WALK_KEYS[key]; if (!delta) return undefined;
  const centered = cameraWalkTileCenter(point), x = centered.x + delta.x * 16, z = centered.z + delta.z * 16;
  if (!cells.some(c => c.matrixX === Math.floor(x / 512) && c.matrixY === Math.floor(z / 512))) return undefined;
  return { x, y: point.y, z, direction: delta.direction };
}
