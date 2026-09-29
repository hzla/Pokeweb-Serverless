import type { Diagnostic, Document } from "./document";
import { NATIVE_REGIONS } from "./nativeCatalog";
import { validate } from "./validate";

export type NativeLearnset = { bytes?: Uint8Array; diagnostics: Diagnostic[] };
/** Native adapters are an explicit capability boundary, not arbitrary code. */
export function compileLearnsetNative(document: Document): NativeLearnset {
  const diagnostics = validate(document);
  const error = (message: string, element?: string) => diagnostics.push({ severity: "error", code: "native-adapter", message, screen: document.screens[0]?.id, element });
  if (diagnostics.some(d => d.severity === "error")) return { diagnostics };
  if (document.screens.length !== 1) error("The Learnset adapter currently supports one native screen.");
  if (document.access?.hotkey) error("Overworld key access can be authored and previewed, but its native launcher is not installed by this adapter.");
  if (document.access?.cgear) error("The C-Gear overlay can be authored and previewed, but its native launcher is not installed by this adapter.");
  if (document.access?.party && document.access.party.label.toLowerCase() !== "custom ui") error("The current native party command uses the label Custom UI. Custom labels need a runtime update.");
  if (document.screens.some(s => s.target)) error("Native Summary layout changes and overlays are authoring previews. Summary hooks have not been verified for installation.");
  const screen = document.screens[0];
  if (document.launchers.field) error("The field-menu launcher is not verified yet. Unassign it to install the party-launched native preset.");
  if (document.launchers.party !== screen.id) error("Assign this screen to the party launcher.");
  const requiredShortcuts = { a: { type: "nextEvolution" }, left: { type: "cycleParty", delta: -1 }, right: { type: "cycleParty", delta: 1 }, l: { type: "family", delta: -1 }, r: { type: "family", delta: 1 } };
  if (!screen.shortcuts || Object.keys(screen.shortcuts).length !== Object.keys(requiredShortcuts).length || Object.entries(requiredShortcuts).some(([key, expected]) => {
    const actual = screen.shortcuts?.[key as keyof typeof screen.shortcuts];
    return !actual || actual.type !== expected.type || ("delta" in expected && (!("delta" in actual) || actual.delta !== expected.delta));
  })) error("The native Learnset adapter owns A, Left/Right, and L/R navigation.");
  let mask = 0;
  const seen = new Set<string>();
  for (const e of screen.elements) {
    const region = e.kind === "native" && e.native && NATIVE_REGIONS.find(r => r.id === e.native);
    if (!region) { error("This adapter accepts native Learnset regions. Independent components are available in design preview; mixed native/custom rendering is not implemented yet.", e.id); continue; }
    if (seen.has(region.id)) error(`The ${region.name} region can appear only once.`, e.id); seen.add(region.id);
    if (e.x !== region.x || e.y !== region.y || e.width !== region.width || e.height !== region.height || e.screen !== region.screen) error(`${region.name} retains its native position and size. Moving live native controls needs a layout adapter.`, e.id);
    if (e.hidden && region.required) error(`${region.name} is required by this native adapter.`, e.id);
    if (!e.hidden) mask |= region.mask;
  }
  for (const region of NATIVE_REGIONS.filter(r => r.required)) if (!seen.has(region.id)) error(`Add the required ${region.name} region.`);
  if (diagnostics.some(d => d.severity === "error")) return { diagnostics };
  const bytes = new Uint8Array(32), v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PWUN")); v.setUint16(4, 1, true); v.setUint16(6, 1, true); v.setUint32(8, 32, true); v.setUint32(12, mask, true);
  return { bytes, diagnostics };
}
