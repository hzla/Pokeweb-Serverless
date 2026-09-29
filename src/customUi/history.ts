import { canTransform } from "./summaryCatalog";
import type { Document, Element, PhysicalScreen } from "./document";
import { nextId, newScreen } from "./document";

/** Editor session state never enters the exported document. */
export class History {
  private past: Document[] = [];
  private future: Document[] = [];
  constructor(public document: Document) {}
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  commit(next: Document) {
    if (JSON.stringify(next) === JSON.stringify(this.document)) return false;
    this.past.push(this.document); if (this.past.length > 100) this.past.shift(); this.document = structuredClone(next); this.future = []; return true;
  }
  edit(change: (document: Document) => void) { const next = structuredClone(this.document); change(next); return this.commit(next); }
  undo() { const prev = this.past.pop(); if (!prev) return false; this.future.push(this.document); this.document = prev; return true; }
  redo() { const next = this.future.pop(); if (!next) return false; this.past.push(this.document); this.document = next; return true; }
}
export function duplicateScreen(doc: Document, id: string): string {
  const old = doc.screens.find(s => s.id === id); if (!old) throw new Error("Screen not found.");
  if (old.target) throw new Error("Each native Summary page has one layout. Add custom screens for separate designs.");
  const copy = structuredClone(old); copy.id = nextId(doc, "screen"); copy.name += " copy"; doc.screens.push(copy);
  const ids = new Map<string, string>();
  for (const e of copy.elements) { const oldId = e.id; e.id = nextId(doc, "element"); ids.set(oldId, e.id); }
  for (const e of copy.elements) {
    for (const [direction, target] of Object.entries(e.neighbors)) e.neighbors[direction as keyof Element["neighbors"]] = ids.get(target!);
    if (e.action.type === "selectList") e.action.list = ids.get(e.action.list) ?? e.action.list;
    if (e.action.type === "open" && e.action.screen === id) e.action.screen = copy.id;
  }
  return copy.id;
}
export function removeScreen(doc: Document, id: string): void {
  if (doc.screens.length === 1) throw new Error("Keep at least one screen.");
  doc.screens = doc.screens.filter(s => s.id !== id);
  for (const e of doc.screens.flatMap(s => s.elements)) if (e.action.type === "open" && e.action.screen === id) e.action = { type: "back" };
  for (const launcher of ["field", "party"] as const) if (doc.launchers[launcher] === id) delete doc.launchers[launcher];
  for (const kind of ["hotkey", "party", "cgear"] as const) if (doc.access?.[kind]?.screen === id) delete doc.access[kind];
  for (const s of doc.screens) for (const [key, action] of Object.entries(s.shortcuts ?? {})) if (action.type === "open" && action.screen === id) delete s.shortcuts![key as keyof typeof s.shortcuts];
}
export function addScreen(doc: Document): string { const id = nextId(doc, "screen"); doc.screens.push(newScreen(id, `Screen ${doc.screens.length + 1}`)); return id; }
export function moveElements(elements: Element[], selected: Set<string>, dx: number, dy: number, snap: boolean): void {
  const moving = elements.filter(e => selected.has(e.id) && canTransform(e)); if (!moving.length) return;
  if (snap) { dx = Math.round((moving[0].x + dx) / 8) * 8 - moving[0].x; dy = Math.round((moving[0].y + dy) / 8) * 8 - moving[0].y; }
  dx = Math.max(-Math.min(...moving.map(e => e.x)), Math.min(dx, 256 - Math.max(...moving.map(e => e.x + e.width))));
  dy = Math.max(-Math.min(...moving.map(e => e.y)), Math.min(dy, 192 - Math.max(...moving.map(e => e.y + e.height))));
  for (const e of moving) { e.x += dx; e.y += dy; }
}
export function alignElements(elements: Element[], selected: Set<string>, axis: "left" | "right" | "top" | "bottom" | "centerX" | "centerY"): void {
  for (const physical of ["top", "bottom"] as PhysicalScreen[]) {
    const group = elements.filter(e => selected.has(e.id) && e.screen === physical && canTransform(e)); if (!group.length) continue;
    const left = group.length > 1 ? Math.min(...group.map(e => e.x)) : 0, right = group.length > 1 ? Math.max(...group.map(e => e.x + e.width)) : 256;
    const top = group.length > 1 ? Math.min(...group.map(e => e.y)) : 0, bottom = group.length > 1 ? Math.max(...group.map(e => e.y + e.height)) : 192;
    for (const e of group) { if (axis === "left") e.x = left; if (axis === "right") e.x = right - e.width; if (axis === "top") e.y = top; if (axis === "bottom") e.y = bottom - e.height; if (axis === "centerX") e.x = Math.round((left + right - e.width) / 2); if (axis === "centerY") e.y = Math.round((top + bottom - e.height) / 2); }
  }
}
