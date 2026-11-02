import stock from "../assets/data/abilityMoveClasses.json";
import expanded from "../assets/data/abilityMoveClassesExpanded.json";
import { hasExpandedMoveFlagLayout } from "./moveExpansionPatch";
import { getTextBank, parseTextEntryId } from "./textModel";
import type { ProjectState } from "./projectStore";
import { writeU16 } from "../nds/binary";

export const MOVE_DLL_FLAGS = [
  { key: "bite", label: "Biting", mask: 1 },
  { key: "pulse", label: "Pulse", mask: 2 },
  { key: "ball", label: "Ball / bomb", mask: 4 },
  { key: "slicing", label: "Slicing", mask: 8 },
  { key: "powder", label: "Powder", mask: 16 },
  { key: "wind", label: "Wind", mask: 32 },
  { key: "healing", label: "Healing", mask: 64 },
] as const;
const defaults = new Map<number, number>();
for (const flag of MOVE_DLL_FLAGS) for (const id of stock.classes[flag.key]) defaults.set(id, (defaults.get(id) ?? 0) | flag.mask);
export const defaultMoveDllFlags = (moveId: number): number => defaults.get(moveId) ?? 0;
export const moveDllFlags = (overrides: ReadonlyMap<number, number>, moveId: number, automatic: ReadonlyMap<number, number> = new Map()): number => overrides.get(moveId) ?? automatic.get(moveId) ?? defaultMoveDllFlags(moveId);
const normalized = (name:string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const expandedFacts = new Map(expanded.moves.map(row => [normalized(String(row[1])),Number(row[2])]));
/** Reviewed animation routing identifies the layout; names identify populated
 * records within that layout, avoiding Frost's empty Pound placeholders. */
export function expandedMoveDllDefaults(project: ProjectState): Map<number, number> {
  const result = new Map<number,number>();
  if (!hasExpandedMoveFlagLayout(project)) return result;
  let names = project.texts.banks.moves;
  // Frost expands BW's mixed-case battle-name bank, but may leave its separate
  // uppercase UI bank at 560. Use the real names rather than that truncated view.
  if (project.session.baseRom === "BW" && (project.texts.messageTexts?.[203] || project.narcs.message_texts?.rawFiles[203]?.length)) {
    names = [...(names??[])];
    for (const entry of getTextBank(project,"message_texts",203)) {
      const id=parseTextEntryId(entry[0]);
      if(id.block===0 && entry[1]) names[id.entry]=entry[1];
    }
  }
  if (!names) return result;
  for(let id=560;id<Math.min(project.narcs.moves?.fileCount??names.length,1000);++id){
    const flags=expandedFacts.get(normalized(names[id]??""));
    if(flags)result.set(id,flags);
  }
  return result;
}
export function mergedMoveClassData(overrides:ReadonlyMap<number,number>, automatic:ReadonlyMap<number,number>):Map<number,number>{
  const combined=new Map(automatic);for(const[id,mask]of overrides)combined.set(id,mask);
  for(const[id,mask]of combined)if(mask===defaultMoveDllFlags(id))combined.delete(id);
  return combined;
}

/** Sparse overrides include zero, which explicitly clears a stock classification. */
export function validateMoveClassOverrides(input: unknown, automatic:ReadonlyMap<number,number> = new Map(), allowDefaults = false): Map<number, number> {
  if (!Array.isArray(input) || input.length > 65535) throw Error("Invalid expanded move flags.");
  const result = new Map<number, number>();
  for (const row of input) {
    if (!Array.isArray(row) || row.length !== 2 || !Number.isInteger(row[0]) || row[0] < 0 || row[0] > 65535 || !Number.isInteger(row[1]) || row[1] < 0 || row[1] > 127 || result.has(row[0]) || !allowDefaults && row[1] === (automatic.get(row[0])??defaultMoveDllFlags(row[0]))) throw Error("Invalid expanded move flag override.");
    result.set(row[0], row[1]);
  }
  return new Map([...result].sort(([a], [b]) => a - b));
}
export function encodeMoveClassOverrides(input: ReadonlyMap<number, number>): Uint8Array {
  const entries = [...validateMoveClassOverrides([...input])];
  const bytes = new Uint8Array(2 + entries.length * 4); writeU16(bytes, 0, entries.length);
  entries.forEach(([id, mask], index) => { writeU16(bytes, 2 + index * 4, id); writeU16(bytes, 4 + index * 4, mask); });
  return bytes;
}
