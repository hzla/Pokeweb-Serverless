import { readU16, writeU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { loadFlyDestinationEditorData, getFlyDestinations, type FlyLanding } from "./flyDestinationModel";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { recordGenericChange } from "./actionChangelog";
import { parseHeaders } from "./headerModel";
import { markDirty, type ProjectState, type NarcStore } from "./projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "./text";
import { equalTownMapBytes, readTownMapLayer, TOWN_MAP_LAYERS, type TownMapGraphicFiles } from "./townMapGraphics";
import { prepareTownMapRuntime } from "./townMapRuntime";
import { townMapCapacity, assertTownMapCapacity } from "./townMapCapacity";

export const TOWN_MAP_STOCK_COUNT = 85, TOWN_MAP_MAX_COUNT = 128, TOWN_MAP_STRIDE = 54, TOWN_MAP_TEXT_BANK = 377;
export const TOWN_MAP_NONE = 0xffff;
export const TOWN_MAP_TYPES = ["Town / city", "Route", "Landmark", "Facility", "Special location", "Unity Tower"] as const;
export const TOWN_MAP_CONDITIONS = [
  { value: 65535, label: "Always / no condition" },
  { value: 61440, label: "Dream Radar condition" },
  { value: 61441, label: "Unity Tower visited" },
  { value: 61442, label: "Plasma Frigate at sea" },
  { value: 61443, label: "Never (disabled)" },
] as const;
export type TownMapPoint = { x: number; y: number };
export type TownMapArea = {
  zone: number; radius: number; position: TownMapPoint; cursor: TownMapPoint;
  hit: { start: TownMapPoint; end: TownMapPoint; radius: number };
  type: number; fly: number; unknown13: number; unknown14: number;
  arrivalFlag: number; visibilityFlag: number; description: number; landmarks: number[];
  habitat: { animation: number; x: number; y: number };
};
export type TownMapDraft = {
  areas: TownMapArea[]; graphics: TownMapGraphicFiles; habitatGraphics: TownMapGraphicFiles; texts: Gen5TextEntry[];
  landings: Record<number, FlyLanding>;
  baseline: { areas: Uint8Array; graphics: TownMapGraphicFiles; habitatGraphics: TownMapGraphicFiles; texts: Uint8Array; landings: string };
};
const signed = (v: number) => v >= 32768 ? v - 65536 : v;
export function parseTownMapAreas(bytes: Uint8Array): TownMapArea[] {
  if (bytes.length % TOWN_MAP_STRIDE || bytes.length < TOWN_MAP_STOCK_COUNT * TOWN_MAP_STRIDE || bytes.length > TOWN_MAP_MAX_COUNT * TOWN_MAP_STRIDE)
    throw new Error("Town Map must contain 85–128 complete 54-byte area records.");
  return Array.from({ length: bytes.length / TOWN_MAP_STRIDE }, (_, i) => {
    const p = Array.from({ length: 27 }, (_, n) => readU16(bytes, i * TOWN_MAP_STRIDE + n * 2));
    return { zone: p[0], radius: p[1], position: { x: p[2], y: p[3] }, cursor: { x: p[4], y: p[5] },
      hit: { start: { x: p[6], y: p[7] }, end: { x: p[8], y: p[9] }, radius: p[10] },
      type: p[11], fly: p[12], unknown13: p[13], unknown14: p[14], arrivalFlag: p[15], visibilityFlag: p[16],
      description: p[17], landmarks: p.slice(18, 24), habitat: { animation: p[24], x: signed(p[25]), y: signed(p[26]) } };
  });
}
export function townMapAreaWords(a: TownMapArea): number[] {
  return [a.zone, a.radius, a.position.x, a.position.y, a.cursor.x, a.cursor.y, a.hit.start.x, a.hit.start.y,
    a.hit.end.x, a.hit.end.y, a.hit.radius, a.type, a.fly, a.unknown13, a.unknown14, a.arrivalFlag,
    a.visibilityFlag, a.description, ...a.landmarks, a.habitat.animation, a.habitat.x & 65535, a.habitat.y & 65535];
}
export function writeTownMapAreas(areas: TownMapArea[]): Uint8Array {
  if (areas.length < 85 || areas.length > 128) throw new Error("Town Map supports 85–128 records.");
  const out = new Uint8Array(areas.length * TOWN_MAP_STRIDE);
  areas.forEach((area, i) => {
    const words = townMapAreaWords(area);
    if (words.length !== 27 || words.some(v => !Number.isInteger(v) || v < 0 || v > 65535)
      || !Number.isInteger(area.habitat.x) || area.habitat.x < -32768 || area.habitat.x > 32767
      || !Number.isInteger(area.habitat.y) || area.habitat.y < -32768 || area.habitat.y > 32767) throw new Error(`Area ${i + 1} has invalid field values.`);
    words.forEach((v, n) => writeU16(out, i * TOWN_MAP_STRIDE + n * 2, v));
  });
  return out;
}
export async function loadTownMapDraft(project: ProjectState): Promise<TownMapDraft> {
  if (project.session.baseRom !== "BW2" || !["IRDO", "IREO"].includes(project.romInfo.idCode)) throw new Error("Town Map editing supports US Black 2 and White 2.");
  await loadFlyDestinationEditorData(project);
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  if (project.originalRomBytes![30] !== 0) throw new Error("Town Map editing requires a revision-0 ROM.");
  loadCodeInjectionNarcs(project, rom, ["town_map_graphics", "town_map_habitat_graphics", "message_texts"]);
  const areas = project.narcs.town_map!.rawFiles[0], textBytes = project.narcs.message_texts!.rawFiles[TOWN_MAP_TEXT_BANK];
  if (!textBytes) throw new Error("The Town Map text bank is missing.");
  const graphics = new Map(project.narcs.town_map_graphics!.rawFiles.map((bytes, id) => [id, bytes.slice()]));
  const habitatGraphics = new Map(project.narcs.town_map_habitat_graphics!.rawFiles.map((bytes, id) => [id, bytes.slice()]));
  TOWN_MAP_LAYERS.forEach(layer => readTownMapLayer(graphics, layer));
  project.headers ??= parseHeaders(project);
  return { areas: parseTownMapAreas(areas), graphics, habitatGraphics, texts: structuredClone(project.texts.messageTexts?.[TOWN_MAP_TEXT_BANK] ?? decodeGen5TextBank(textBytes)),
    landings: Object.fromEntries(getFlyDestinations(project).map(d => [d.zone, d.landing])),
    baseline: { areas: areas.slice(), graphics: new Map([...graphics].map(([id, bytes]) => [id, bytes.slice()])), habitatGraphics: new Map([...habitatGraphics].map(([id, bytes]) => [id, bytes.slice()])), texts: textBytes.slice(), landings: JSON.stringify(project.flyDestinations ?? null) } };
}
export function moveTownMapArea(area: TownMapArea, dx: number, dy: number, linked: boolean, target: "marker" | "cursor" | "hitStart" | "hitEnd" | "habitat" = "marker"): void {
  if (![dx, dy].every(Number.isInteger)) throw new Error("Movement must use whole pixels.");
  const points = target === "marker" && linked ? [area.position, area.cursor, area.hit.start, area.hit.end]
    : [target === "marker" ? area.position : target === "cursor" ? area.cursor : target === "hitStart" ? area.hit.start : target === "hitEnd" ? area.hit.end : area.habitat];
  const min = target === "habitat" ? -32768 : 0, max = target === "habitat" ? 32767 : 65535;
  if (points.some(p => p.x + dx < min || p.x + dx > max || p.y + dy < min || p.y + dy > max)) throw new Error("Position would exceed its native coordinate range.");
  points.forEach(p => { p.x += dx; p.y += dy; });
}
export function townMapHit(area: TownMapArea, x: number, y: number): boolean {
  const { start: a, end: b, radius } = area.hit, dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <= radius ** 2;
}
export function appendTownMapArea(draft: TownMapDraft, sourceIndex: number, zone: number): number {
  if (draft.areas.length >= 128) throw new Error("The 128-area limit has been reached.");
  if (draft.areas.some(a => a.zone === zone)) throw new Error("That map header already has a Town Map record.");
  const source = draft.areas[sourceIndex]; if (!source) throw new Error("Select an area to duplicate.");
  const area = structuredClone(source); area.zone = zone; area.fly = 0; area.arrivalFlag = 65535;
  draft.areas.push(area); delete draft.landings[zone]; return draft.areas.length - 1;
}
/** Copy-on-write text entries keep unrelated areas from changing with this one. */
export function editTownMapText(draft: TownMapDraft, index: number, slot: number, value: string, shared = false): void {
  value = value.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\\n");
  const area = draft.areas[index]; if (!area || slot < 0 || slot > 6) throw new Error("Invalid Town Map text slot.");
  let id = slot === 0 ? area.description : area.landmarks[slot - 1];
  const references = draft.areas.reduce((n, a) => n + [a.description, ...a.landmarks].filter(v => v === id).length, 0);
  if (id === 65535 || !draft.texts[id] || (!shared && references > 1)) {
    id = draft.texts.length;
    if (id >= 65535) throw new Error("Town Map text bank is full.");
    draft.texts.push([`0_${id}`, value, 0]);
    if (slot === 0) area.description = id; else area.landmarks[slot - 1] = id;
  } else draft.texts[id][1] = value;
}
export function validateTownMapDraft(project: ProjectState, draft: TownMapDraft): void {
  writeTownMapAreas(draft.areas);
  const city = draft.areas.findIndex(a => a.zone === 0);
  if (city < 0 || draft.areas[city + 1]?.zone !== 424) throw new Error("Keep the Black City / White Forest record pair together.");
  const zones = new Set<number>();
  draft.areas.forEach((area, index) => {
    if (zones.has(area.zone)) throw new Error(`Map ${area.zone} appears more than once.`); zones.add(area.zone);
    if (!project.headers?.rows[area.zone + 1]) throw new Error(`Area ${index + 1} references missing map header ${area.zone}.`);
    if (area.type > 5) throw new Error(`Area ${index + 1} has an unsupported place type.`);
    for (const flag of [area.arrivalFlag, area.visibilityFlag])
      if (!(flag === 65535 || flag >= 1 && flag <= 3059 || flag >= 61440 && flag <= 61442 || flag === 61443 && flag === area.visibilityFlag)) throw new Error(`Area ${index + 1} has an invalid condition.`);
    if (area.fly && area.arrivalFlag === 65535) throw new Error(`Area ${index + 1} needs a visit condition before enabling Fly.`);
    if (area.landmarks.length !== 6 || [area.description, ...area.landmarks].some(id => id !== 65535 && !draft.texts[id])) throw new Error(`Area ${index + 1} references a missing text entry.`);
  });
  TOWN_MAP_LAYERS.forEach(layer => readTownMapLayer(draft.graphics, layer));
  assertTownMapCapacity(townMapCapacity(draft));
  encodeGen5TextBank(draft.texts);
}
function assertBaseline(project: ProjectState, draft: TownMapDraft): void {
  if (!equalTownMapBytes(project.narcs.town_map!.rawFiles[0], draft.baseline.areas)
    || !equalTownMapBytes(project.narcs.message_texts!.rawFiles[TOWN_MAP_TEXT_BANK], draft.baseline.texts)
    || [...draft.baseline.graphics].some(([i, bytes]) => !equalTownMapBytes(project.narcs.town_map_graphics!.rawFiles[i], bytes))
    || [...draft.baseline.habitatGraphics].some(([i, bytes]) => !equalTownMapBytes(project.narcs.town_map_habitat_graphics!.rawFiles[i], bytes))
    || JSON.stringify(project.flyDestinations ?? null) !== draft.baseline.landings)
    throw new Error("Town Map data changed elsewhere. Reload the editor before applying this draft.");
}
export async function applyTownMapDraft(project: ProjectState, draft: TownMapDraft): Promise<void> {
  validateTownMapDraft(project, draft); assertBaseline(project, draft);
  const staged: ProjectState = { ...project, narcs: { ...project.narcs }, texts: structuredClone(project.texts),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), overlays: { ...project.overlays }, flyDestinations: structuredClone(project.flyDestinations),
    actionChangelog: structuredClone(project.actionChangelog) };
  for (const name of ["town_map", "town_map_graphics", "town_map_habitat_graphics", "message_texts"] as const) {
    const store = project.narcs[name]!;
    staged.narcs[name] = { ...store, rawFiles: [...store.rawFiles], records: new Map(store.records), dirty: new Set(store.dirty) } as NarcStore;
  }
  const set = (name: "town_map" | "town_map_graphics" | "town_map_habitat_graphics" | "message_texts", id: number, bytes: Uint8Array) => {
    const store = staged.narcs[name]!;
    if (equalTownMapBytes(store.rawFiles[id], bytes)) return;
    store.rawFiles[id] = bytes; store.records.delete(id); markDirty(staged, name, id);
  };
  set("town_map", 0, writeTownMapAreas(draft.areas));
  draft.graphics.forEach((bytes, id) => set("town_map_graphics", id, bytes));
  draft.habitatGraphics.forEach((bytes, id) => set("town_map_habitat_graphics", id, bytes));
  const textChanged = JSON.stringify(draft.texts) !== JSON.stringify(decodeGen5TextBank(draft.baseline.texts));
  if (textChanged) {
    set("message_texts", TOWN_MAP_TEXT_BANK, encodeGen5TextBank(draft.texts));
    if (staged.texts.messageTexts) staged.texts.messageTexts[TOWN_MAP_TEXT_BANK] = structuredClone(draft.texts);
  }
  await prepareTownMapRuntime(staged, draft);
  assertBaseline(project, draft);
  recordGenericChange(staged, "town_map", `Town Map updated (${draft.areas.length} areas).`, "Town Map", { key: "town-map" });
  for (const key of ["narcs", "texts", "fileSystem", "codeInjection", "patches", "overlays", "flyDestinations", "actionChangelog", "arm9", "arm9Dirty", "originalRomBytes"] as const)
    Object.assign(project, { [key]: staged[key] });
}
export type TownMapSnapshot = Pick<TownMapDraft, "areas" | "graphics" | "habitatGraphics" | "texts" | "landings">;
export class TownMapHistory {
  private past: TownMapSnapshot[] = []; private future: TownMapSnapshot[] = [];
  get canUndo() { return this.past.length > 0; } get canRedo() { return this.future.length > 0; }
  private snapshot(draft: TownMapDraft): TownMapSnapshot { return structuredClone({ areas: draft.areas, graphics: draft.graphics, habitatGraphics: draft.habitatGraphics, texts: draft.texts, landings: draft.landings }); }
  checkpoint(draft: TownMapDraft): void { this.past.push(this.snapshot(draft)); if (this.past.length > 64) this.past.shift(); this.future = []; }
  undo(draft: TownMapDraft): boolean {
    const value = this.past.pop(); if (!value) return false; this.future.push(this.snapshot(draft)); Object.assign(draft, value); return true;
  }
  redo(draft: TownMapDraft): boolean {
    const value = this.future.pop(); if (!value) return false; this.past.push(this.snapshot(draft)); Object.assign(draft, value); return true;
  }
}
