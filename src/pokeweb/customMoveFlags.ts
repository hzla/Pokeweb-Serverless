import { writeU16 } from "../nds/binary";

// The existing recipe filter byte reserves 0–13 for native/built-in filters.
// Custom IDs occupy 14–255 without changing existing recipe records.
export const MAX_CUSTOM_MOVE_FLAGS = 242;
export const MAX_CUSTOM_MOVE_FLAG_ASSIGNMENTS = 4096;
export type CustomMoveFlag = { id: number; name: string; moves: number[] };
export type CustomMoveFlagRegistry = { version: 1; nextId: number; flags: CustomMoveFlag[] };
export const emptyCustomMoveFlags = (): CustomMoveFlagRegistry => ({ version: 1, nextId: 1, flags: [] });
export const customMoveFlagId = (filter: number): number | undefined => Number.isInteger(filter) && filter >= 14 && filter <= 255 ? filter - 13 : undefined;
export const customMoveFlagFilter = (id: number): number => id + 13;
const reservedNames = new Set(["biting", "pulse", "ball / bomb", "slicing", "powder", "wind", "healing"]);
export function customMoveFlagName(input: string): string {
  const name = input.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/u.test(input) || reservedNames.has(name.toLowerCase())) throw Error("Choose a unique custom flag name of 1–32 characters.");
  return name;
}
export function validateCustomMoveFlags(input: unknown): CustomMoveFlagRegistry {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid custom move flags.");
  const source = input as CustomMoveFlagRegistry;
  if (Object.keys(source).sort().join() !== "flags,nextId,version" || source.version !== 1 || !Number.isInteger(source.nextId) || source.nextId < 1 || source.nextId > MAX_CUSTOM_MOVE_FLAGS + 1 || !Array.isArray(source.flags) || source.flags.length > MAX_CUSTOM_MOVE_FLAGS) throw Error("Invalid custom move flag registry.");
  const ids = new Set<number>(), names = new Set<string>(); let assignments = 0;
  const flags = source.flags.map(flag => {
    if (!flag || Object.keys(flag).sort().join() !== "id,moves,name" || !Number.isInteger(flag.id) || flag.id < 1 || flag.id >= source.nextId || ids.has(flag.id) || typeof flag.name !== "string" || !Array.isArray(flag.moves)) throw Error("Invalid custom move flag.");
    const name = customMoveFlagName(flag.name), key = name.toLowerCase();
    if (names.has(key)) throw Error("Custom flag names must be unique.");
    ids.add(flag.id); names.add(key);
    const moves = new Set<number>();
    for (const id of flag.moves) {
      if (!Number.isInteger(id) || id < 0 || id > 65535 || moves.has(id)) throw Error("Invalid custom flag move assignment.");
      moves.add(id);
    }
    assignments += moves.size;
    return { id: flag.id, name, moves: [...moves].sort((a,b) => a-b) };
  }).sort((a,b) => a.id-b.id);
  if (assignments > MAX_CUSTOM_MOVE_FLAG_ASSIGNMENTS) throw Error(`Custom flags exceed ${MAX_CUSTOM_MOVE_FLAG_ASSIGNMENTS} move assignments.`);
  return { version: 1, nextId: source.nextId, flags };
}
/** One sorted (move ID, flag ID) table: a query performs a single binary search. */
export function encodeCustomMoveFlags(input: CustomMoveFlagRegistry): Uint8Array {
  const registry = validateCustomMoveFlags(input), pairs = registry.flags.flatMap(flag => flag.moves.map(move => [move,flag.id] as const)).sort(([a,x],[b,y]) => a-b || x-y);
  const bytes = new Uint8Array(2 + pairs.length*4); writeU16(bytes,0,pairs.length);
  pairs.forEach(([move,flag],i) => { writeU16(bytes,2+i*4,move); writeU16(bytes,4+i*4,flag); });
  return bytes;
}
