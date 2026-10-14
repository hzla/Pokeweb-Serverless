import { writeU16 } from "../nds/binary";

/** Native matrix tile coordinates: X goes east, Y goes south. */
export type FollowerTileBounds = { minX?: number; maxX?: number; minY?: number; maxY?: number };
export const FOLLOWER_TILE_BOUND_KEYS = ["minX", "maxX", "minY", "maxY"] as const;
export function followerHasTileBounds(rule: FollowerTileBounds): boolean {
  return FOLLOWER_TILE_BOUND_KEYS.some(key => rule[key] !== undefined);
}
export function validateFollowerTileBounds(rule: FollowerTileBounds): void {
  for (const key of FOLLOWER_TILE_BOUND_KEYS) {
    const value = rule[key];
    if (value !== undefined && (!Number.isInteger(value) || value < -32768 || value > 32767))
      throw new Error(`Invalid follower ${key} tile coordinate; use an integer from -32768 to 32767.`);
  }
  for (const [min, max] of [["minX", "maxX"], ["minY", "maxY"]] as const)
    if (rule[min] !== undefined && rule[max] !== undefined && rule[min]! > rule[max]!)
      throw new Error(`Follower ${min} must not exceed ${max}.`);
}
export function encodeFollowerTileBounds(data: Uint8Array, at: number, rule: FollowerTileBounds): number {
  let mask = 0;
  FOLLOWER_TILE_BOUND_KEYS.forEach((key, i) => {
    if (rule[key] !== undefined) mask |= 1 << i;
    writeU16(data, at + i * 2, rule[key] ?? 0);
  });
  return mask;
}
export function decodeFollowerTileBounds(data: Uint8Array, at: number, mask: number): FollowerTileBounds {
  if (mask & ~15) throw new Error("Invalid follower tile bound flags.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), bounds: FollowerTileBounds = {};
  FOLLOWER_TILE_BOUND_KEYS.forEach((key, i) => {
    const value = view.getInt16(at + i * 2, true);
    if (mask & (1 << i)) bounds[key] = value;
    else if (value) throw new Error("Invalid unused follower tile bound.");
  });
  validateFollowerTileBounds(bounds);
  return bounds;
}
