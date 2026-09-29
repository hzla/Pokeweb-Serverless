/** Data-only, versioned authoring format. All executable behavior is an enum. */
export const FORMAT = "pokeweb.custom-ui" as const;
export const VERSION = 1 as const;
export const SIZE = { width: 256, height: 192 } as const;
export type PhysicalScreen = "top" | "bottom";
export type Color = string;
export type Rect = { x: number; y: number; width: number; height: number };
export const STATS = ["hp", "attack", "defense", "spAttack", "spDefense", "speed"] as const;
export type Stat = typeof STATS[number];
export const DS_KEYS = ["L", "R", "A", "B", "X", "Y", "Start", "Select", "Up", "Down", "Left", "Right"] as const;
export type DsKey = typeof DS_KEYS[number];
export type Access = {
  hotkey?: { screen: string; keys: DsKey[] };
  party?: { screen: string; label: string };
  cgear?: Rect & { screen: string; label: string; whenOff: boolean; paint: Paint };
};
export const SUMMARY_PAGES = ["info", "stats", "moves", "ribbons"] as const;
export type SummaryPage = typeof SUMMARY_PAGES[number];
export const BINDINGS = [...STATS.map(s => `pokemon.ev.${s}` as const), ...STATS.map(s => `pokemon.iv.${s}` as const), ...STATS.map(s => `pokemon.stat.${s}` as const), "pokemon.ev.total", "pokemon.ability", "pokemon.abilityDescription", "pokemon.nature", "pokemon.ot", "pokemon.trainerId", "pokemon.experience", "pokemon.nextLevelExperience", "pokemon.memo", "pokemon.heldItem", "trainer.name", "trainer.playTime", "trainer.badges", "location.name", "party.count", "party.selected", "party.position", "pokemon.nickname", "pokemon.species", "pokemon.form", "pokemon.level", "pokemon.hp", "pokemon.maxHp", "pokemon.status", "pokemon.type1", "pokemon.type2", "move.name", "move.type", "move.category", "move.power", "move.accuracy", "move.pp", "move.description", "move.level", "view.name", "view.type1", "view.type2", "view.ability1", "view.ability2", "view.ability3", "view.hp", "view.attack", "view.defense", "view.spAttack", "view.spDefense", "view.speed", "view.evolutionTitle", "view.evolutionText", "view.evolutionPage"] as const;
export type Binding = typeof BINDINGS[number];
export type TextSource = { literal: string } | { binding: Binding; prefix?: string; suffix?: string; transform?: "upper" | "title" };
export type Action =
  | { type: "open"; screen: string }
  | { type: "back" | "close" | "summary" | "learnset" }
  | { type: "selectParty"; index: number }
  | { type: "selectList"; list: string; delta: number }
  | { type: "family" | "cycleParty"; delta: -1 | 1 }
  | { type: "nextEvolution" }
  | { type: "sound"; sound: "confirm" | "cancel" | "cursor" };
export type Paint = { fill: Color; border: Color; borderWidth: number; foreground: Color; shadow: Color };
export type AssetRef = { kind: "import"; id: string } | { kind: "type"; type: number } | { kind: "rom"; key: string } | { kind: "typeBinding"; binding: "view.type1" | "view.type2" | "move.type" };
export type PokemonSource = { kind: "fixed"; species: number; form: number } | { kind: "party"; slot: number | "selected" } | { kind: "family"; index: number };
export type Element = Rect & {
  id: string; name: string; screen: PhysicalScreen;
  kind: "panel" | "text" | "image" | "pokemon" | "button" | "list" | "native";
  native?: string;
  locked?: boolean;
  moveIndex?: number;
  hidden: boolean;
  transparentFill?: boolean;
  paint: Paint;
  text: TextSource;
  align: "left" | "center" | "right";
  wrap: boolean;
  font: number;
  image?: AssetRef;
  pokemon: PokemonSource;
  animate: boolean;
  action: Action;
  disabled: boolean;
  states: Partial<Record<"focused" | "pressed" | "disabled", Partial<Paint>>>;
  neighbors: Partial<Record<"up" | "down" | "left" | "right", string>>;
  list: { source: "party" | "moves" | "learnset"; rows: number; label: TextSource; columns?: { x: number; width: number; text: TextSource; align: "left" | "right"; kind?: "text" | "typeIcon" }[] };
  meter?: { binding: Binding; maximum: number };
};
export type Screen = { id: string; name: string; target?: { kind: "summary"; page: SummaryPage; layoutVersion?: 1 }; background: Record<PhysicalScreen, Color>; elements: Element[]; shortcuts?: Partial<Record<"a" | "left" | "right" | "l" | "r", Action>> };
export type ImportedAsset = { id: string; name: string; path: string; width: number; height: number };
export type Document = {
  format: typeof FORMAT; version: typeof VERSION; name: string;
  screens: Screen[]; assets: ImportedAsset[];
  launchers: { field?: string; party?: string };
  access?: Access;
};
export type Project = { document: Document; files: Record<string, Uint8Array>; installation?: { version: number; enabled: boolean; digest: string } };
export type Diagnostic = { severity: "error" | "warning"; code: string; message: string; screen?: string; element?: string };
export type Pokemon = { evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>; stats?: Partial<Record<Stat, number>>; ability?: string; abilityDescription?: string; gender?: "male" | "female" | "none"; shiny?: boolean; ball?: number; markings?: boolean[]; dexNumber?: string; speciesName?: string; experienceProgress?: number; nature?: string; ot?: string; trainerId?: string; experience?: number; nextLevelExperience?: number; memo?: string; heldItem?: string; nickname: string; species: number; form: number; level: number; hp: number; maxHp: number; status: string; types: string[]; egg: boolean; moves: Move[] };
export type Move = { name: string; type: string; category: string; power: number; accuracy: number; pp: number; maxPp?: number; description: string; level?: number };
export type SpeciesInfo = { species: number; form: number; name: string; types: string[]; abilities: { name: string; hidden: boolean }[]; stats: number[]; learnset: Move[]; family: { species: number; form: number }[]; evolutionPages: { title: string; text: string }[] };
export type GameData = { trainer: { name: string; playTime: string; badges: number }; location: { name: string }; party: Pokemon[]; learnsetInstalled: boolean; catalog?: Record<string, SpeciesInfo> };
export const DEFAULT_PAINT: Paint = { fill: "#202830", border: "#687888", borderWidth: 1, foreground: "#ffffff", shadow: "#505058" };
export function newElement(kind: Element["kind"], id: string, screen: PhysicalScreen = "top"): Element {
  return { id, name: kind, kind, screen, x: 16, y: 16, width: kind === "pokemon" ? 32 : 112, height: kind === "pokemon" ? 32 : kind === "list" ? 112 : 32,
    hidden: false, paint: { ...DEFAULT_PAINT }, text: { literal: kind === "button" ? "Button" : "Text" }, align: "left", wrap: false, font: 0,
    pokemon: { kind: "party", slot: "selected" }, animate: true, action: { type: "back" }, disabled: false,
    states: { focused: { border: "#f8d040", fill: "#384858" }, pressed: { fill: "#586878" }, disabled: { foreground: "#889098" } },
    neighbors: {}, list: { source: "party", rows: 4, label: { binding: "pokemon.nickname" } } };
}
export function newScreen(id: string, name = "Screen"): Screen { return { id, name, background: { top: "#181820", bottom: "#181820" }, elements: [] }; }
export function newProject(): Project {
  const screen = newScreen("screen-1", "Home");
  const title = newElement("text", "title"); title.text = { binding: "trainer.name", prefix: "Hello, " }; title.width = 224;
  const icon = newElement("pokemon", "pokemon"); icon.y = 56;
  const party = newElement("list", "party", "bottom"); party.width = 224; party.height = 144; party.list.rows = 6;
  const summary = newElement("button", "summary"); summary.y = 112; summary.width = 224; summary.align = "center"; summary.text = { literal: "Pokémon Summary" }; summary.action = { type: "summary" };
  screen.elements.push(title, icon, summary, party);
  return { document: { format: FORMAT, version: VERSION, name: "Custom UI", screens: [screen], assets: [], launchers: { field: screen.id, party: screen.id } }, files: {} };
}
export function nextId(doc: Document, prefix: string): string {
  const used = new Set([...doc.screens.map(s => s.id), ...doc.screens.flatMap(s => s.elements.map(e => e.id)), ...doc.assets.map(a => a.id)]);
  let i = 1; while (used.has(`${prefix}-${i}`)) i++; return `${prefix}-${i}`;
}
