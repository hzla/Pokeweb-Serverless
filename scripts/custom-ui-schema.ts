import { writeFileSync } from "node:fs";
import { NATIVE_REGIONS } from "../src/customUi/nativeCatalog";
import { SUMMARY_REGIONS, SUMMARY_ART_KEYS } from "../src/customUi/summaryCatalog";
import { BINDINGS, DS_KEYS, SUMMARY_PAGES } from "../src/customUi/document";
const string = { type: "string" }, bool = { type: "boolean" }, id = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" }, color = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
const int = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum });
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const choice = (...values: unknown[]) => ({ enum: values });
const text = { oneOf: [obj({ literal: { type: "string", maxLength: 1024 } }), obj({ binding: choice(...BINDINGS), prefix: { type: "string", maxLength: 128 }, suffix: { type: "string", maxLength: 128 }, transform: choice("upper", "title") }, ["binding"])] };
const action = { oneOf: [obj({ type: { const: "open" }, screen: id }), ...["back", "close", "summary", "learnset", "nextEvolution"].map(type => obj({ type: { const: type } })), obj({ type: { const: "selectParty" }, index: int(0, 5) }), obj({ type: { const: "selectList" }, list: id, delta: choice(-1, 1) }), ...["family", "cycleParty"].map(type => obj({ type: { const: type }, delta: choice(-1, 1) })), obj({ type: { const: "sound" }, sound: choice("confirm", "cursor", "cancel") })] };
const paintProps = { fill: color, border: color, borderWidth: int(0, 4), foreground: color, shadow: color };
const element = obj({
  id, name: { type: "string", maxLength: 128 }, kind: choice("panel", "text", "image", "pokemon", "button", "list", "native"), native: choice(...[...NATIVE_REGIONS, ...SUMMARY_REGIONS].map(r => r.id)), screen: choice("top", "bottom"),
  x: int(0, 255), y: int(0, 191), width: int(1, 256), height: int(1, 192), hidden: bool, transparentFill: bool, locked: bool, moveIndex: int(0, 3),
  paint: obj(paintProps), text, align: choice("left", "center", "right"), wrap: bool, font: int(0, 3),
  image: { oneOf: [obj({ kind: { const: "rom" }, key: choice(...SUMMARY_ART_KEYS) }), obj({ kind: { const: "import" }, id }), obj({ kind: { const: "type" }, type: int(0, 255) }), obj({ kind: { const: "typeBinding" }, binding: choice("view.type1", "view.type2", "move.type") })] },
  pokemon: { oneOf: [obj({ kind: { const: "fixed" }, species: int(1, 65535), form: int(0, 255) }), obj({ kind: { const: "party" }, slot: { anyOf: [int(0, 5), { const: "selected" }] } }), obj({ kind: { const: "family" }, index: int(0, 2) })] },
  animate: bool, action, disabled: bool, states: obj(Object.fromEntries(["focused", "pressed", "disabled"].map(k => [k, obj(paintProps, [])])), []),
  neighbors: obj(Object.fromEntries(["up", "down", "left", "right"].map(k => [k, id])), []),
  list: obj({ source: choice("party", "moves", "learnset"), rows: int(1, 12), label: text, columns: { type: "array", maxItems: 4, items: obj({ x: int(0, 255), width: int(1, 256), text, align: choice("left", "right"), kind: choice("text", "typeIcon") }, ["x", "width", "text", "align"]) } }, ["source", "rows", "label"]),
  meter: obj({ binding: choice(...BINDINGS), maximum: int(1, 65535) }),
}, ["id", "name", "kind", "screen", "x", "y", "width", "height", "hidden", "paint", "text", "align", "wrap", "font", "pokemon", "animate", "action", "disabled", "states", "neighbors", "list"]);
const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Pokeweb Custom UI project v1", description: "Data-only authoring document. Cross-reference, ROM asset and resource checks are performed by the shared validate/compile APIs.", ...obj({
  format: { const: "pokeweb.custom-ui" }, version: { const: 1 }, name: { type: "string", minLength: 1, maxLength: 128 },
  screens: { type: "array", minItems: 1, maxItems: 32, items: obj({ id, target: obj({ kind: { const: "summary" }, page: choice(...SUMMARY_PAGES), layoutVersion: { const: 1 } }, ["kind", "page"]), name: { type: "string", minLength: 1, maxLength: 128 }, background: obj({ top: color, bottom: color }), elements: { type: "array", maxItems: 64, items: element }, shortcuts: obj(Object.fromEntries(["a", "left", "right", "l", "r"].map(k => [k, action])), []) }, ["id", "name", "background", "elements"]) },
  assets: { type: "array", maxItems: 128, items: obj({ id, name: { type: "string", maxLength: 128 }, path: { type: "string", pattern: "^assets/[a-zA-Z0-9_-]+\\.png$" }, width: int(1, 1024), height: int(1, 1024) }) },
  launchers: obj({ field: id, party: id }, []),
  access: obj({
    hotkey: obj({ screen: id, keys: { type: "array", minItems: 2, maxItems: 4, uniqueItems: true, items: choice(...DS_KEYS) } }),
    party: obj({ screen: id, label: { type: "string", minLength: 1, maxLength: 24 } }),
    cgear: obj({ screen: id, label: { type: "string", minLength: 1, maxLength: 24 }, x: int(0, 255), y: int(0, 191), width: int(16, 256), height: int(16, 192), whenOff: bool, paint: obj(paintProps) }),
  }, []),
}, ["format", "version", "name", "screens", "assets", "launchers"]) };
writeFileSync(new URL("../docs/custom-ui/project.schema.json", import.meta.url), JSON.stringify(schema, null, 2) + "\n");
