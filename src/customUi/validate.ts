import { BINDINGS, DS_KEYS, SUMMARY_PAGES, FORMAT, VERSION, type Diagnostic, type Document } from "./document";
import { NATIVE_REGIONS } from "./nativeCatalog";
import { SUMMARY_REGIONS, SUMMARY_ART_KEYS } from "./summaryCatalog";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
const color = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export function validate(input: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];
  let screen: string | undefined, element: string | undefined;
  const error = (code: string, message: string) => out.push({ severity: "error", code, message, screen, element });
  const keys = (v: Record<string, unknown>, allowed: string[]) => {
    for (const k of Object.keys(v)) if (!allowed.includes(k)) error("unknown-property", `Unsupported property: ${k}.`);
  };
  const text = (v: unknown) => {
    if (!object(v)) return error("text", "Text must be a literal or a supported binding.");
    keys(v, ["literal", "binding", "prefix", "suffix", "transform"]);
    if ("literal" in v) { if (typeof v.literal !== "string" || v.literal.length > 1024 || "binding" in v) error("text", "Invalid literal text (maximum 1024 characters)."); }
    else if (!(BINDINGS as readonly unknown[]).includes(v.binding)) error("binding", `Unsupported binding: ${String(v.binding)}.`);
    if (v.transform !== undefined && !["upper", "title"].includes(String(v.transform))) error("text", "Invalid text transform.");
    for (const k of ["prefix", "suffix"]) if (k in v && (typeof v[k] !== "string" || (v[k] as string).length > 128)) error("text", `Invalid text ${k}.`);
  };
  const paint = (v: unknown, partial = false) => {
    if (!object(v)) return error("paint", "Missing paint properties.");
    keys(v, ["fill", "border", "borderWidth", "foreground", "shadow"]);
    for (const k of ["fill", "border", "foreground", "shadow"]) if ((!partial || k in v) && !color(v[k])) error("color", `${k} must be a six-digit hexadecimal color.`);
    if ((!partial || "borderWidth" in v) && !integer(v.borderWidth, 0, 4)) error("border", "Border width must be 0–4 pixels.");
  };
  if (!object(input)) { error("document", "Expected a Custom UI document."); return out; }
  keys(input, ["format", "version", "name", "screens", "assets", "launchers", "access"]);
  if (input.format !== FORMAT || input.version !== VERSION) error("version", "Unsupported Custom UI document version.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 128) error("name", "Project name must be 1–128 characters.");
  if (!Array.isArray(input.screens) || input.screens.length < 1 || input.screens.length > 32) { error("screens", "A project needs 1–32 screens."); return out; }
  const allIds = new Set<string>();
  const unique = (v: unknown) => { if (!id(v) || allIds.has(String(v))) error("id", "IDs must be unique, with 1–64 letters, digits, underscores or hyphens."); allIds.add(String(v)); };
  const screenIds = new Set(input.screens.filter(object).map(s => s.id));
  const assetIds = new Set(Array.isArray(input.assets) ? input.assets.filter(object).map(a => a.id) : []);
  for (const s of input.screens) {
    element = undefined; screen = object(s) ? String(s.id) : undefined;
    if (!object(s)) { error("screen", "Invalid screen."); continue; }
    keys(s, ["id", "name", "background", "elements", "shortcuts", "target"]); unique(s.id);
    if (s.target !== undefined) {
      if (!object(s.target) || s.target.kind !== "summary" || !(SUMMARY_PAGES as readonly unknown[]).includes(s.target.page)) error("summary", "Choose a supported Summary page.");
      else { keys(s.target, ["kind", "page", "layoutVersion"]); if (s.target.layoutVersion !== undefined && s.target.layoutVersion !== 1) error("summary", "Unsupported Summary layout version."); if (input.screens.filter(object).some(other => other !== s && object(other.target) && other.target.page === (s.target as Record<string, unknown>).page)) error("summary", "Each Summary page has only one layout."); }
    }
    if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 128) error("name", "Screen name must be 1–128 characters.");
    if (!object(s.background) || !color(s.background.top) || !color(s.background.bottom)) error("background", "Both screens need a background color.");
    if (!Array.isArray(s.elements) || s.elements.length > 64) { error("elements", "A screen can contain up to 64 elements."); continue; }
    if (s.shortcuts !== undefined) {
      if (!object(s.shortcuts)) error("shortcuts", "Invalid input shortcuts.");
      else { keys(s.shortcuts, ["a", "left", "right", "l", "r"]); for (const a of Object.values(s.shortcuts)) {
        if (!object(a) || !["family", "cycleParty", "nextEvolution", "back", "close"].includes(String(a.type))) error("shortcuts", "Only read-only navigation is supported in screen shortcuts.");
        else { keys(a, a.type === "family" || a.type === "cycleParty" ? ["type", "delta"] : ["type"]); if ((a.type === "family" || a.type === "cycleParty") && a.delta !== 1 && a.delta !== -1) error("shortcuts", "Navigation delta must be -1 or 1."); }
      } }
    }
    const focusIds = new Set(s.elements.filter(object).filter(e => e.kind === "button" || e.kind === "list").map(e => e.id));
    for (const e of s.elements) {
      element = object(e) ? String(e.id) : undefined;
      if (!object(e)) { error("element", "Invalid element."); continue; }
      keys(e, ["id", "name", "kind", "native", "locked", "moveIndex", "screen", "x", "y", "width", "height", "hidden", "transparentFill", "paint", "text", "align", "wrap", "font", "image", "pokemon", "animate", "action", "disabled", "states", "neighbors", "list", "meter"]);
      unique(e.id);
      if (typeof e.name !== "string" || e.name.length > 128) error("name", "Invalid element name.");
      if (!["panel", "text", "image", "pokemon", "button", "list", "native"].includes(String(e.kind))) error("kind", "Unsupported component.");
      if (e.kind === "native" && ![...NATIVE_REGIONS, ...SUMMARY_REGIONS].some(r => r.id === e.native)) error("native-region", "Unsupported native UI region.");
      const summary = SUMMARY_REGIONS.find(r => r.id === e.native);
      if (summary?.art && (e.x !== 0 || e.y !== 0 || e.width !== 256 || e.height !== 192 || e.hidden)) error("summary", "The Summary background must fill its physical screen and remain visible.");
      if (summary && (!object(s.target) || s.target.page !== summary.page || e.screen !== summary.screen)) error("summary", "Native Summary elements must remain on their original page and physical screen.");
      if (summary && s.elements.filter(object).filter(v => v.native === e.native).length > 1) error("summary", "A native Summary element may only appear once per page.");
      if (e.locked !== undefined && typeof e.locked !== "boolean") error("boolean", "Invalid locked state.");
      if (e.moveIndex !== undefined && !integer(e.moveIndex, 0, 3)) error("binding", "Move index must be 0–3.");
      if (!["top", "bottom"].includes(String(e.screen))) error("screen", "Choose the top or bottom screen.");
      for (const [k, max] of [["x", 255], ["y", 191], ["width", 256], ["height", 192]] as const) if (!integer(e[k], k === "x" || k === "y" ? 0 : 1, max)) error("bounds", `Invalid ${k}.`);
      if (Number(e.x) + Number(e.width) > 256 || Number(e.y) + Number(e.height) > 192) error("bounds", "Element extends outside the physical screen.");
      for (const k of ["hidden", "wrap", "animate", "disabled"]) if (typeof e[k] !== "boolean") error("boolean", `Invalid ${k}.`);
      if (!integer(e.font, 0, 3)) error("font", "Unsupported native font.");
      if (!["left", "center", "right"].includes(String(e.align))) error("align", "Invalid text alignment.");
      text(e.text); paint(e.paint);
      if (!object(e.states)) error("states", "Invalid appearance states.");
      else { keys(e.states, ["focused", "pressed", "disabled"]); Object.values(e.states).forEach(v => paint(v, true)); }
      if (!object(e.neighbors)) error("focus", "Invalid focus overrides.");
      else { keys(e.neighbors, ["up", "down", "left", "right"]); for (const target of Object.values(e.neighbors)) if (!focusIds.has(target)) error("focus", `Focus target ${String(target)} is not a control on this screen.`); }
      if (e.transparentFill !== undefined && typeof e.transparentFill !== "boolean") error("boolean", "Invalid transparentFill.");
      if (e.image !== undefined) {
        if (!object(e.image)) error("asset", "Invalid image source.");
        else { keys(e.image, e.image.kind === "rom" ? ["kind", "key"] : e.image.kind === "import" ? ["kind", "id"] : e.image.kind === "typeBinding" ? ["kind", "binding"] : ["kind", "type"]);
          if (e.image.kind === "rom" ? !SUMMARY_ART_KEYS.includes(String(e.image.key)) : e.image.kind === "typeBinding" ? !["view.type1", "view.type2", "move.type"].includes(String(e.image.binding)) : e.image.kind === "import" ? !assetIds.has(e.image.id) : e.image.kind !== "type" || !integer(e.image.type, 0, 255)) error("asset", "Missing or unsupported image asset."); }
      }
      if (!object(e.pokemon)) error("pokemon", "Missing Pokémon source.");
      else { keys(e.pokemon, e.pokemon.kind === "fixed" ? ["kind", "species", "form"] : e.pokemon.kind === "family" ? ["kind", "index"] : ["kind", "slot"]);
        if (e.pokemon.kind === "family" ? !integer(e.pokemon.index, 0, 2) : e.pokemon.kind === "fixed" ? !integer(e.pokemon.species, 1, 65535) || !integer(e.pokemon.form, 0, 255) : e.pokemon.kind !== "party" || !(e.pokemon.slot === "selected" || integer(e.pokemon.slot, 0, 5))) error("pokemon", "Invalid Pokémon source."); }
      if (!object(e.list) || !["party", "moves", "learnset"].includes(String(e.list.source)) || !integer(e.list.rows, 1, 12)) error("list", "Lists need 1–12 visible rows and a supported source.");
      else { keys(e.list, ["source", "rows", "label", "columns"]); text(e.list.label); if (e.kind === "list" && Number(e.height) / Number(e.list.rows) < 16) error("list", "Each list row must be at least 16 pixels high."); }
      if (object(e.list) && e.list.columns !== undefined) {
        if (!Array.isArray(e.list.columns) || e.list.columns.length > 4) error("columns", "Lists support up to four columns.");
        else for (const c of e.list.columns) { if (!object(c)) { error("columns", "Invalid column."); continue; } keys(c, ["x", "width", "text", "align", "kind"]); text(c.text); if (c.kind !== undefined && !["text", "typeIcon"].includes(String(c.kind))) error("columns", "Unsupported column kind."); if (!integer(c.x, 0, 255) || !integer(c.width, 1, 256) || Number(c.x) + Number(c.width) > Number(e.width) || !["left", "right"].includes(String(c.align))) error("columns", "Column exceeds list bounds."); }
      }
      if (e.meter !== undefined) { if (!object(e.meter) || e.kind !== "panel" || !(BINDINGS as readonly unknown[]).includes(e.meter.binding) || !integer(e.meter.maximum, 1, 65535)) error("meter", "A panel meter needs a supported binding and maximum."); else keys(e.meter, ["binding", "maximum"]); }
      if (!object(e.action)) error("action", "Missing action.");
      else { const a = e.action;
        const fields: Record<string, string[]> = { family: ["delta"], cycleParty: ["delta"], nextEvolution: [], open: ["screen"], back: [], close: [], summary: [], learnset: [], selectParty: ["index"], selectList: ["list", "delta"], sound: ["sound"] };
        if (!(typeof a.type === "string" && Object.hasOwn(fields, a.type))) error("action", "Unsupported action; executable scripts are not allowed.");
        else keys(a, ["type", ...fields[a.type]]);
        if (a.type === "open" && !screenIds.has(a.screen)) error("action-target", "Navigation target does not exist.");
        if (a.type === "open" && input.screens.filter(object).some(s => s.id === a.screen && s.target)) error("action-target", "Use the read-only Summary action to open native Summary; it is not a custom navigation destination.");
        if ((a.type === "family" || a.type === "cycleParty") && a.delta !== 1 && a.delta !== -1) error("action-target", "Navigation delta must be -1 or 1.");
        if (a.type === "selectParty" && !integer(a.index, 0, 5)) error("action-target", "Party slot must be 0–5.");
        if (a.type === "selectList" && (!s.elements.some(v => object(v) && v.id === a.list && v.kind === "list") || ![-1, 1].includes(Number(a.delta)))) error("action-target", "Select an existing list and a delta of -1 or 1.");
        if (a.type === "sound" && !["confirm", "cancel", "cursor"].includes(String(a.sound))) error("sound", "Unsupported UI sound.");
      }
    }
  }
  screen = element = undefined;
  if (!object(input.launchers)) error("launchers", "Missing launcher assignments.");
  else { keys(input.launchers, ["field", "party"]); for (const v of Object.values(input.launchers)) if (!screenIds.has(v)) error("launcher", "Launcher screen does not exist."); }
  if (input.access !== undefined) {
    if (!object(input.access)) error("access", "Invalid access configuration.");
    else {
      keys(input.access, ["hotkey", "party", "cgear"]);
      for (const [kind, a] of Object.entries(input.access)) {
        if (!object(a)) { error("access", `Invalid ${kind} access settings.`); continue; }
        keys(a, kind === "hotkey" ? ["screen", "keys"] : kind === "party" ? ["screen", "label"] : ["screen", "label", "x", "y", "width", "height", "whenOff", "paint"]);
        const destination = input.screens.filter(object).find(s => s.id === a.screen);
        if (!destination || destination.target) error("access", "Access methods must open an existing custom screen, not a native Summary page.");
        if (kind === "hotkey") {
          if (!Array.isArray(a.keys) || a.keys.length < 2 || a.keys.length > 4 || a.keys.some(k => !(DS_KEYS as readonly unknown[]).includes(k)) || new Set(a.keys).size !== a.keys.length) error("hotkey", "Choose two to four different DS buttons.");
          else if (["L", "R", "Start", "Select"].every(k => (a.keys as unknown[]).includes(k))) error("hotkey", "L + R + Start + Select is reserved for the game's reset shortcut.");
          else if (["Up", "Down"].every(k => (a.keys as unknown[]).includes(k)) || ["Left", "Right"].every(k => (a.keys as unknown[]).includes(k))) error("hotkey", "Opposite D-pad directions cannot be held together.");
        } else if (typeof a.label !== "string" || !a.label.trim() || a.label.length > 24) error("access", "Access labels need 1–24 characters.");
        if (kind === "cgear") {
          if (!integer(a.x, 0, 255) || !integer(a.y, 0, 191) || !integer(a.width, 16, 256) || !integer(a.height, 16, 192) || Number(a.x) + Number(a.width) > 256 || Number(a.y) + Number(a.height) > 192) error("access", "The overworld touch button must fit the 256×192 bottom screen and be at least 16×16.");
          if (typeof a.whenOff !== "boolean") error("access", "Choose whether the button is available with C-Gear off.");
          paint(a.paint);
        }
      }
      if (object(input.launchers) && input.launchers.field) error("access", "Remove the legacy field-menu assignment when using the Access panel.");
      if (object(input.launchers) && input.launchers.party !== (object(input.access.party) ? input.access.party.screen : undefined)) error("access", "Party assignment and access destination must agree.");
    }
  }
  if (!Array.isArray(input.assets) || input.assets.length > 128) error("assets", "A project supports up to 128 imported assets.");
  else for (const a of input.assets) {
    if (!object(a)) { error("asset", "Invalid imported asset."); continue; }
    keys(a, ["id", "name", "path", "width", "height"]); unique(a.id);
    if (typeof a.name !== "string" || a.name.length > 128 || typeof a.path !== "string" || !/^assets\/[a-zA-Z0-9_-]+\.png$/.test(a.path)) error("asset-path", "Assets must use safe assets/<id>.png paths.");
    if (!integer(a.width, 1, 1024) || !integer(a.height, 1, 1024)) error("asset-size", "PNG dimensions must be 1–1024 pixels.");
  }
  return out;
}
export function parseDocument(value: unknown): Document {
  const errors = validate(value).filter(d => d.severity === "error");
  if (errors.length) throw new Error(errors.map(d => `${d.element ?? d.screen ?? "project"}: ${d.message}`).join("\n"));
  return value as Document;
}
