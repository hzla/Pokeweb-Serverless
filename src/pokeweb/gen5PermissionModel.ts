export type Gen5PermissionTileLike = {
  tileClass: number;
  flags: number;
};

export const GEN5_PERMISSION_FLAGS = [
  { bit: 0x0001, label: "Blocked" },
  { bit: 0x0002, label: "Water" },
  { bit: 0x0004, label: "Encounter" },
  { bit: 0x0008, label: "Footmarks" },
  { bit: 0x0010, label: "Splash" },
  { bit: 0x0020, label: "Grass" },
  { bit: 0x0040, label: "Reflection" },
  { bit: 0x0080, label: "Shadow" },
  { bit: 0x0100, label: "Unknown 0100" },
  { bit: 0x0200, label: "Unknown 0200" },
  { bit: 0x0400, label: "Unknown 0400" },
  { bit: 0x0800, label: "Unknown 0800" },
  { bit: 0x1000, label: "Unknown 1000" },
  { bit: 0x2000, label: "Unknown 2000" },
  { bit: 0x4000, label: "Unknown 4000" },
  { bit: 0x8000, label: "Geometry split" },
] as const;

export function clampU16(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0xffff, Math.round(value)));
}

export function formatHex16(value: number): string {
  return `0x${(value & 0xffff).toString(16).padStart(4, "0")}`;
}

export function gen5PermissionColorHex(tile: Gen5PermissionTileLike): string {
  const color = gen5PermissionColorNumber(tile);
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function gen5PermissionColorNumber(tile: Gen5PermissionTileLike): number {
  if (isWaterLikePermission(tile)) return 0x3da5ff;
  if (isGrassLikePermission(tile)) return 0x42d66b;
  if (isSandLikePermission(tile.tileClass)) return 0xd8b35a;
  if ((tile.flags & 0x0001) !== 0 || tile.tileClass === 1 || tile.tileClass === 18) return 0xff4d4f;
  if ((tile.flags & 0x0004) !== 0 || [10, 12, 13, 22, 32, 35, 161].includes(tile.tileClass)) return 0xffc857;
  if ([14, 15, 16, 24, 160, 164, 165, 166, 167, 168].includes(tile.tileClass)) return 0x8de8ff;
  if ((tile.flags & 0x0040) !== 0 || tile.tileClass === 27) return 0xa78bfa;
  if ((tile.flags & 0x0080) !== 0) return 0xa5b4c8;
  if (tile.tileClass === 0 && tile.flags === 0) return 0x7bd88f;
  return hslToRgbNumber(((tile.tileClass * 47 + tile.flags * 13) % 360) / 360, 0.72, tile.flags === 0 ? 0.46 : 0.62);
}

export function isWaterLikePermission(tile: Gen5PermissionTileLike): boolean {
  return (
    (tile.flags & 0x0002) !== 0 ||
    [20, 21, 23, 26, 28, 61, 62, 63, 64, 65, 66, 67, 68, 148, 149, 150, 151, 152, 153, 154, 155, 156, 176].includes(tile.tileClass)
  );
}

export function isGrassLikePermission(tile: Gen5PermissionTileLike): boolean {
  return (tile.flags & 0x0020) !== 0 || [4, 5, 6, 7, 8, 9, 33, 34, 162].includes(tile.tileClass);
}

export function isSandLikePermission(tileClass: number): boolean {
  return [11, 12, 19, 25, 35, 124].includes(tileClass);
}

function hslToRgbNumber(h: number, s: number, l: number): number {
  const hueToRgb = (p: number, q: number, t: number) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, h) * 255);
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
}
