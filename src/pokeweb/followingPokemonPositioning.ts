import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { FOLLOWER_MAX_DIRECTIONAL_GAP, followerCrc32, followerDefaultDirectionalGaps, followerKey, type FollowerRegistry } from "./followingPokemonModel";

export const FOLLOWER_POSITIONING_PATH = "following/positioning.narc";
export type FollowerRiderAdjustments = [[number, number], [number, number], [number, number], [number, number]];
export type FollowerSurfAdjustments = Record<string, FollowerRiderAdjustments>;
const MAGIC = 0x4f505746; // FWPO
const HEADER = 24, LAND_STRIDE = 12, SURF_STRIDE = 8;

export function followerSurfKey(species: number, form: number, gender: number, shiny: number): string {
  return `${species}:${form}:${gender}:${shiny}`;
}
function signed(byte: number): number { return (byte << 24) >> 24; }
function checkRider(pairs: FollowerRiderAdjustments): void {
  if (!Array.isArray(pairs) || pairs.length !== 4 || pairs.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
    pair.some(value => !Number.isInteger(value) || value < -32 || value > 32)))
    throw new Error("Rider adjustments must have four x/y pairs between -32 and 32.");
}
export function validateSurfAdjustments(registryBytes: Uint8Array, adjustments: FollowerSurfAdjustments): void {
  const keys = new Set<string>();
  for (let i = 0, count = readU16(registryBytes, 8); i < count; ++i) {
    const at = 16 + i * 8;
    keys.add(followerSurfKey(readU16(registryBytes, at), registryBytes[at + 2], registryBytes[at + 3], registryBytes[at + 4]));
  }
  for (const [key, pairs] of Object.entries(adjustments)) {
    if (!keys.has(key)) throw new Error(`Unknown Surf appearance ${key}.`);
    checkRider(pairs);
  }
}
/** One ROM-resident NARC member. Native code seeks directly to the chosen
 * 12-byte land or 8-byte Surf row; it never loads this archive into heap. */
export function encodeFollowerPositioningNarc(registry: FollowerRegistry, registryBytes: Uint8Array,
  landAnchors?: Uint8Array, surfRegistryBytes?: Uint8Array, surfAdjustments: FollowerSurfAdjustments = {}): Uint8Array {
  const landCount = registry.descriptorCount - 1008, surfCount = surfRegistryBytes ? readU16(surfRegistryBytes, 8) : 0;
  if (landCount < 0 || landCount > 6144 || Boolean(landAnchors) !== Boolean(surfRegistryBytes) ||
      (landAnchors && (landAnchors.length !== 16 + landCount * 8 || readU32(landAnchors, 8) !== followerCrc32(registryBytes))) ||
      (surfRegistryBytes && (surfRegistryBytes.length !== 16 + surfCount * 8 || surfCount > 4095)))
    throw new Error("Positioning source catalogs do not match.");
  if (surfRegistryBytes) validateSurfAdjustments(surfRegistryBytes, surfAdjustments);
  const member = new Uint8Array(HEADER + landCount * LAND_STRIDE + surfCount * SURF_STRIDE);
  writeU32(member, 0, MAGIC); writeU16(member, 4, 1); writeU16(member, 6, landCount);
  writeU16(member, 8, surfCount); member[10] = LAND_STRIDE; member[11] = SURF_STRIDE;
  writeU32(member, 12, followerCrc32(registryBytes)); writeU32(member, 16, surfRegistryBytes ? followerCrc32(surfRegistryBytes) : 0);
  const usedRows = new Set<number>();
  for (const entry of registry.entries) {
    const row = entry.descriptorRow - 1008;
    if (row < 0 || row >= landCount || usedRows.has(row)) throw new Error(`Duplicate positioning row for ${followerKey(entry.key)}.`);
    usedRows.add(row);
    const at = HEADER + row * LAND_STRIDE;
    const gaps = entry.directionalGaps ?? followerDefaultDirectionalGaps(entry);
    if (gaps.length !== 4 || gaps.some(value => !Number.isInteger(value) || value < 0 || value > FOLLOWER_MAX_DIRECTIONAL_GAP)) throw new Error("Invalid directional gap.");
    member.set(gaps, at);
    if (entry.riderAdjustments) checkRider(entry.riderAdjustments);
    for (let i = 0; i < 8; ++i) {
      const base = landAnchors ? signed(landAnchors[16 + row * 8 + i]) : 0;
      const value = landAnchors ? base + (entry.riderAdjustments?.[i >> 1][i & 1] ?? 0) : 0;
      if (value < -128 || value > 127) throw new Error("Land rider position exceeds the runtime range.");
      member[at + 4 + i] = value & 255;
    }
  }
  if (usedRows.size !== landCount) throw new Error("Land positioning rows are incomplete.");
  for (let i = 0; i < surfCount; ++i) {
    const row = 16 + i * 8;
    const key = followerSurfKey(readU16(surfRegistryBytes!, row), surfRegistryBytes![row + 2], surfRegistryBytes![row + 3], surfRegistryBytes![row + 4]);
    const pairs = surfAdjustments[key];
    if (pairs) for (let j = 0; j < 8; ++j) member[HEADER + landCount * LAND_STRIDE + i * SURF_STRIDE + j] = pairs[j >> 1][j & 1] & 255;
  }
  writeU32(member, 20, followerCrc32(member.subarray(HEADER)));
  const narc = new NARC(); narc.files = [member]; return narc.save();
}
export function decodeFollowerPositioningNarc(bytes: Uint8Array, registryBytes: Uint8Array, surfRegistryBytes?: Uint8Array): { land: Uint8Array; surf: Uint8Array } {
  const narc = new NARC(bytes);
  if (narc.files.length !== 1) throw new Error("Positioning archive needs one member.");
  const member = narc.files[0];
  if (member.length < HEADER || readU32(member, 0) !== MAGIC || readU16(member, 4) !== 1 ||
      member[10] !== LAND_STRIDE || member[11] !== SURF_STRIDE ||
      readU32(member, 12) !== followerCrc32(registryBytes) || readU32(member, 16) !== (surfRegistryBytes ? followerCrc32(surfRegistryBytes) : 0) ||
      readU16(member, 6) !== readU16(registryBytes, 16) - 1008 || readU16(member, 8) !== (surfRegistryBytes ? readU16(surfRegistryBytes, 8) : 0) ||
      member.length !== HEADER + readU16(member, 6) * LAND_STRIDE + readU16(member, 8) * SURF_STRIDE ||
      readU32(member, 20) !== followerCrc32(member.subarray(HEADER)))
    throw new Error("Positioning archive does not match the installed artwork.");
  const land = member.slice(HEADER, HEADER + readU16(member, 6) * LAND_STRIDE);
  if (Array.from({ length: readU16(member, 6) }, (_, i) => land.subarray(i * LAND_STRIDE, i * LAND_STRIDE + 4))
    .some(row => row.some(value => value > FOLLOWER_MAX_DIRECTIONAL_GAP))) throw new Error("Positioning archive has an invalid follower gap.");
  const surf = member.slice(HEADER + land.length);
  if (surf.some(byte => signed(byte) < -32 || signed(byte) > 32))
    throw new Error("Positioning archive has an invalid Surf rider adjustment.");
  return { land, surf };
}
