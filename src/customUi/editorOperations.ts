import { nextId, type Document, type Element, type PhysicalScreen } from "./document";
import { NATIVE_REGIONS } from "./nativeCatalog";
import { SUMMARY_REGIONS, canTransform } from "./summaryCatalog";

export function duplicateElements(doc: Document, screenId: string, selected: Set<string>): string[] {
  const s = doc.screens.find(s => s.id === screenId)!;
  const originals = s.elements.filter(e => selected.has(e.id) && e.kind !== "native"), ids = new Map<string, string>();
  const copies = originals.map(e => {
    const copy = structuredClone(e); copy.id = nextId(doc, "element"); copy.name += " copy"; copy.locked = false;
    copy.x = Math.min(256 - copy.width, copy.x + 8); copy.y = Math.min(192 - copy.height, copy.y + 8);
    s.elements.push(copy); ids.set(e.id, copy.id); return copy;
  });
  for (const copy of copies) {
    for (const d of Object.keys(copy.neighbors) as (keyof Element["neighbors"])[]) copy.neighbors[d] = ids.get(copy.neighbors[d]!) ?? copy.neighbors[d];
    if (copy.action.type === "selectList") copy.action.list = ids.get(copy.action.list) ?? copy.action.list;
  }
  return copies.map(e => e.id);
}
export function deleteElements(doc: Document, screenId: string, selected: Set<string>): void {
  const s = doc.screens.find(s => s.id === screenId)!;
  const removed = new Set(s.elements.filter(e => selected.has(e.id) && !e.locked && !(e.kind === "native" && [...NATIVE_REGIONS, ...SUMMARY_REGIONS].find(r => r.id === e.native)?.required)).map(e => e.id));
  s.elements = s.elements.filter(e => !removed.has(e.id));
  for (const e of s.elements) {
    for (const d of Object.keys(e.neighbors) as (keyof Element["neighbors"])[]) if (removed.has(e.neighbors[d]!)) delete e.neighbors[d];
    if (e.action.type === "selectList" && removed.has(e.action.list)) e.action = { type: "back" };
  }
}
export function transferElements(elements: Element[], selected: Set<string>, physical: PhysicalScreen) {
  for (const e of elements) if (selected.has(e.id) && e.kind !== "native" && !e.locked) e.screen = physical;
}
export function resizeElement(e: Element, width: number, height: number, snap: boolean) {
  if (!canTransform(e)) return;
  const step = snap || e.kind === "native" ? 8 : 1;
  e.width = Math.max(step, Math.min(256 - e.x, Math.round(width / step) * step));
  e.height = Math.max(step, Math.min(192 - e.y, Math.round(height / step) * step));
  if (e.kind === "pokemon") e.width = e.height = 32;
}
