import { newElement, newScreen, nextId, STATS, type Binding, type Document, type Element, type PhysicalScreen, type Rect, type Screen, type SummaryPage } from "./document";

export const SUMMARY_LABELS: Record<SummaryPage, string> = { info: "Information", stats: "Stats & ability", moves: "Move details", ribbons: "Ribbons" };
type Region = Rect & { id: string; page: SummaryPage; name: string; screen: PhysicalScreen; label?: string; binding?: Binding; art?: boolean; required?: boolean; guide?: boolean };
const regions: Region[] = [];
for (const page of Object.keys(SUMMARY_LABELS) as SummaryPage[]) {
  for (const screen of ["top", "bottom"] as const) regions.push({ id: `summary.${page}.${screen}-art`, name: `${screen} artwork`, page, screen, x: 0, y: 0, width: 256, height: 192, art: true, required: true });
}
const window = (page: SummaryPage, key: string, name: string, screen: PhysicalScreen, x: number, y: number, width: number, height: number, binding?: Binding, label?: string, guide = false) => regions.push({ id: `summary.${page}.${key}`, page, name, screen, x, y, width, height, binding, label, guide });
// Native windows are expressed in pixels; the editor preserves their identity
// separately from author-created overlays. These are preview layout baselines,
// not verified English binary hook addresses.
for (const [key, name, y, binding] of [
  ["dex", "Pokédex number", 8, "pokemon.species"], ["species", "Species name", 24, "view.name"],
  ["type", "Types", 40, "pokemon.type1"], ["ot", "Original trainer", 56, "pokemon.ot"],
  ["id", "Trainer ID", 72, "pokemon.trainerId"], ["experience", "Experience", 88, "pokemon.experience"],
  ["next-level", "Next level", 120, "pokemon.nextLevelExperience"],
] as const) window("info", key, name, "bottom", 16, y, 136, key === "experience" || key === "next-level" ? 32 : 16, binding, name);
window("info", "memo", "Trainer memo", "top", 32, 40, 192, 152, "pokemon.memo");
window("info", "exp-bar", "Experience bar", "bottom", 80, 152, 64, 8, undefined, "EXP", true);
const labels = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];
STATS.forEach((stat, i) => window("stats", stat, labels[i], "top", 64, i ? 56 + (i - 1) * 16 : 32, i ? 112 : 128, 16, `pokemon.stat.${stat}`, labels[i]));
window("stats", "hp-bar", "HP gauge", "top", 120, 48, 72, 8, undefined, "HP");
window("stats", "ability", "Ability & description", "top", 48, 144, 160, 48, "pokemon.ability", "Ability");
for (const page of ["stats", "moves"] as const) {
  for (let row = 0; row < 4; row++) window(page, `move-${row}`, `Move ${row + 1}`, "bottom", 8, row === 0 ? 8 : 16 + row * 32, 136, row === 0 || row === 3 ? 40 : 32);
}
window("moves", "category", "Move category", "top", 80, 48, 112, 16, "move.category", "Category");
window("moves", "power", "Move power", "top", 80, 64, 112, 16, "move.power", "Power");
window("moves", "accuracy", "Move accuracy", "top", 80, 80, 112, 16, "move.accuracy", "Accuracy");
window("moves", "description", "Move description", "top", 8, 104, 240, 48, "move.description");
window("ribbons", "description", "Ribbon description", "top", 32, 48, 192, 96, undefined, "Ribbon details", true);
window("ribbons", "grid", "Ribbon grid", "bottom", 8, 16, 136, 136, undefined, "Native ribbon grid", true);
for (const page of Object.keys(SUMMARY_LABELS) as SummaryPage[]) {
  window(page, "pokemon", "Pokémon display", "bottom", 160, 24, 96, 96, undefined, "Native Pokémon display");
  window(page, "nickname", "Nickname, gender & Poké Ball", "bottom", 152, 0, 104, 16, "pokemon.nickname");
  window(page, "level", "Level", "bottom", 152, 16, 104, 16, "pokemon.level", "Lv.");
  window(page, "item", "Held item", "bottom", 152, 136, 104, 32, "pokemon.heldItem");
}
export const SUMMARY_REGIONS: readonly Region[] = regions;
export const SUMMARY_ART_KEYS = Object.keys(SUMMARY_LABELS).flatMap(page => ["top", "bottom"].map(screen => `summary:${page}:${screen}`));
export function isSummaryElement(e: Element): boolean { return e.kind === "native" && !!e.native?.startsWith("summary."); }
export function canTransform(e: Element): boolean { return !e.locked && (e.kind !== "native" || isSummaryElement(e) && !SUMMARY_REGIONS.find(r => r.id === e.native)?.art); }
export function summaryScreen(id: string, page: SummaryPage): Screen {
  const screen = newScreen(id, `Summary · ${SUMMARY_LABELS[page]}`); screen.target = { kind: "summary", page, layoutVersion: 1 };
  screen.elements = SUMMARY_REGIONS.filter(r => r.page === page).map(r => {
    const e = newElement("native", `${id}-${r.id.split(".").at(-1)}`, r.screen);
    Object.assign(e, { native: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height, locked: !!r.art }); return e;
  }); return screen;
}
export function addSummaryPage(doc: Document, page: SummaryPage): string {
  const existing = doc.screens.find(s => s.target?.page === page); if (existing) return existing.id;
  const s = summaryScreen(nextId(doc, "summary"), page); doc.screens.push(s); return s.id;
}
export function resetSummaryElement(e: Element) {
  const r = SUMMARY_REGIONS.find(r => r.id === e.native); if (r) Object.assign(e, { x: r.x, y: r.y, width: r.width, height: r.height, screen: r.screen, hidden: false });
}
export function addStatOverlay(doc: Document, screen: Screen, physical: PhysicalScreen, kind: "ev" | "iv"): string[] {
  const ids: string[] = [];
  STATS.forEach((stat, i) => {
    const e = newElement("text", nextId(doc, "element"), physical);
    Object.assign(e, { name: `${labels[i]} ${kind.toUpperCase()}`, x: 8, y: 8 + i * 16, width: 112, height: 16, transparentFill: true });
    e.text = { binding: `pokemon.${kind}.${stat}`, prefix: `${labels[i]} ${kind.toUpperCase()} ` };
    e.paint.foreground = "#ffffff"; e.paint.shadow = "#52525a"; screen.elements.push(e); ids.push(e.id);
  }); return ids;
}
/** A placeholder keeps native actors at their authored layer position. The
 * compiler attaches decoded resources; preview draws the region without
 * resampling glyphs when its allocation is resized. */
export function resolveSummary(e: Element): Element[] {
  const r = SUMMARY_REGIONS.find(r => r.id === e.native); if (!r || e.hidden) return [];
  const base = { ...structuredClone(e), native: undefined, locked: undefined, id: `${e.id}__native` };
  if (r.art) return [{ ...base, kind: "image", image: { kind: "rom", key: `summary:${r.page}:${r.screen}` } }];
  return [{ ...base, kind: "panel", image: undefined, transparentFill: true }];
}
/** Update untouched defaults from the initial approximate preview. Preserve
 * authored rectangles, visibility, IDs, overlays and ordering. */
export function migrateSummaryLayouts(document: Document): void {
  const legacy: Record<string, Rect> = {
    "move-0": { x: 8, y: 16, width: 136, height: 32 }, "move-3": { x: 8, y: 112, width: 136, height: 32 },
    "hp-bar": { x: 136, y: 48, width: 48, height: 8 }, experience: { x: 16, y: 88, width: 136, height: 16 }, "next-level": { x: 16, y: 120, width: 136, height: 16 },
    pokemon: { x: 160, y: 32, width: 88, height: 96 }, nickname: { x: 160, y: 8, width: 88, height: 16 },
    level: { x: 168, y: 128, width: 72, height: 16 }, item: { x: 160, y: 152, width: 88, height: 32 },
  };
  for (const screen of document.screens) {
    if (!screen.target || screen.target.layoutVersion !== undefined) continue;
    for (const e of screen.elements) {
      const r = SUMMARY_REGIONS.find(r => r.id === e.native), old = legacy[e.native?.split(".").at(-1) ?? ""];
      if (r && old && (Object.keys(old) as (keyof Rect)[]).every(k => e[k] === old[k])) Object.assign(e, { x: r.x, y: r.y, width: r.width, height: r.height });
    }
    screen.target.layoutVersion = 1;
  }
}
