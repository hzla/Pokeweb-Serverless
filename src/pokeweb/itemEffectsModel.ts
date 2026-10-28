import profiles from "../assets/data/itemEffectProfiles.json";
import ruleBindings from "../assets/data/itemRuleBindings.json";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordFieldChange } from "./actionChangelog";
import { getItemRecord, updateItemField } from "./moveItemModel";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { stageCodeInjectionDll } from "./pmcModel";
import { ensureFileSystemState, setRomFileReplacement } from "./fileSystemModel";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import type { ProjectState } from "./projectStore";
import { buildRuleRuntime, ITEM_RULE_API } from "./itemRuleRuntime";
import { validateItemRule, type ItemRuleSet } from "./itemRules";
import { ITEM_NATIVE_FUNCTIONS, nativeItemBranchTarget, type NativeItemResolver } from "./itemNativeRuntime";
import { isVerifiedAbilityClientTrapImport } from "./abilityEffectsModel";
import { isVerifiedBattleCounterImport } from "./battleLogModel";

type Profile = typeof profiles.rows[number];
type NativeEvent = { event: number; address: number; offset: number };
type Factory = { address: number; offset: number; table: number; events: NativeEvent[]; profile?: Profile };
type Source = { base: number; arm9Base: number; game: string; revision: number; files: Record<string, Uint8Array>; fileIds: Record<string, number> };
type Context = { project: ProjectState; source: Source; data: Uint8Array; table: number; dispatcher: number; factories: Map<number, Factory>; itemId?: number; rulesRead?: boolean; rules?: Map<number, ItemRuleSet> };
const sources = new WeakMap<ProjectState, Source>();
const verifiedRules = new WeakMap<ProjectState, { base: number; overlay: Uint8Array; arm9: Uint8Array; files: Map<string, Uint8Array>; rules: Map<number, ItemRuleSet> }>();
const signatures = new Map(Object.entries(profiles.functions).map(([name, s]) => [name, {
  ...s, bytes: fromHex(s.hex), maskBytes: fromHex(s.mask),
}]));
export const ITEM_EFFECT_OVERLAY_ID = 167;
export type ItemEffectControl = { key: string; label: string; value: number; min: number; max: number; step: number; shared: number[] };
export type ItemEffectState = {
  editable: boolean; message: string; profileId?: number; label?: string; address?: number;
  choices: Array<{ id: number; label: string }>; events: Array<{ event: number; address: number }>;
  controls: ItemEffectControl[]; typeHealing?: number; rules?: ItemRuleSet; nativeSlot?: boolean;
};

/** Retain only overlay metadata and patch DLLs when the full input ROM is released. */
export function hydrateItemEffectsSource(project: ProjectState, rom: NintendoDSRom): void {
  if (project.session.baseRom !== "BW2") return;
  const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  for (let at = 0; at + 32 <= table.length; at += 32) {
    if (readU32(table, at) !== ITEM_EFFECT_OVERLAY_ID) continue;
    const files: Record<string, Uint8Array> = {}, fileIds: Record<string, number> = {};
    for (const directory of ["patches", "lib"]) {
      for (const name of rom.filenames.folders.find(([folder]) => folder === directory)?.[1].files ?? []) {
        if (!name.toLowerCase().endsWith(".dll")) continue;
        const path = `${directory}/${name}`, id = rom.filenames.idOf(path);
        if (id !== undefined) { files[path] = rom.files[id].slice(); fileIds[path] = id; }
      }
    }
    sources.set(project, { base: readU32(table, at + 4), arm9Base: rom.arm9RamAddress, game: rom.idCode, revision: rom.data[30], files, fileIds });
    return;
  }
}

function sourceFor(project: ProjectState): Source {
  let source = sources.get(project);
  if (!source && project.originalRomBytes) {
    hydrateItemEffectsSource(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }));
    source = sources.get(project);
  }
  if (!source) throw new Error("Reload the ROM with Items selected to verify its battle overlay.");
  if (!["IRDO", "IREO"].includes(source.game) || source.revision !== 0)
    throw new Error("Native item effects currently support US revision-0 Black 2 and White 2 layouts.");
  const table = project.patches?.arm9OverlayTable;
  if (table) for (let at = 0; at + 32 <= table.length; at += 32)
    if (readU32(table, at) === 167) return { ...source, base: readU32(table, at + 4) };
  return source;
}

function nativeContext(project: ProjectState): Context {
  if (project.session.baseRom !== "BW2") throw new Error("Native item handlers require Black 2 or White 2.");
  const source = sourceFor(project), data = project.overlays[167];
  if (!data?.length) throw new Error("Reload the ROM with Items selected to load its battle overlay.");
  const candidates: number[] = [];
  const length = (profiles.rows.length + 1) * 8;
  for (let at = 0; at + length <= data.length; at += 4) {
    if (readU32(data, at) !== profiles.rows[0].id) continue;
    if (profiles.rows.every((row, index) => readU32(data, at + index * 8) === row.id)
      && readU32(data, at + profiles.rows.length * 8) === 0 && readU32(data, at + profiles.rows.length * 8 + 4) === 0) candidates.push(at);
  }
  if (candidates.length !== 1) throw new Error("The native item assignment table is missing or ambiguous; no code edits are enabled.");
  const table = candidates[0];
  // The real dispatcher must reference this table, including its pointer column.
  const dispatch = findSignature(data, "ItemEvent_AddItemCore").filter(at =>
    readU32(data, at + 0x58) === source.base + table && readU32(data, at + 0x5c) === source.base + table + 4);
  if (dispatch.length !== 1) throw new Error("The item dispatcher does not reference the detected table.");
  const context: Context = { project, source, data, table, dispatcher: dispatch[0], factories: new Map() };
  // Discover factories through their code, including factories no longer used by
  // a table row after reassignment. No retail function addresses are assumed.
  for (let at = 0; at + 12 <= data.length; at += 4) {
    if ((readU16(data, at) & 0xff00) !== 0x2100 || readU16(data, at + 2) !== 0x6001
      || readU16(data, at + 4) !== 0x4800 || readU16(data, at + 6) !== 0x4770) continue;
    const count = data[at], eventTable = readU32(data, at + 8) - source.base;
    if (count < 1 || count > 12 || eventTable < 0 || eventTable + count * 8 > data.length || eventTable % 4) continue;
    const events: NativeEvent[] = [];
    for (let n = 0; n < count; n++) {
      const address = readU32(data, eventTable + n * 8 + 4), offset = (address & ~1) - source.base;
      if (!(address & 1) || offset < 0 || offset + 2 > data.length) break;
      events.push({ event: readU32(data, eventTable + n * 8), address, offset });
    }
    if (events.length !== count) continue;
    const matches = profiles.rows.filter(row => row.events.length === count && row.events.every((event, n) =>
      event.event === events[n].event && matchesSignature(data, events[n].offset, event.handler)));
    if (matches.length) context.factories.set(source.base + at + 1, { address: source.base + at + 1, offset: at, table: eventTable, events, profile: matches[0] });
  }
  return context;
}

export function inspectItemEffect(project: ProjectState, itemId: number): ItemEffectState {
  const empty = { editable: false, message: "", choices: [], events: [], controls: [] };
  try {
    const c = nativeContext(project), row = rowOffset(c, itemId);
    const rules = readGenericRules(c)?.get(itemId);
    if (row === undefined) {
      getItemRecord(project, itemId);
      if (itemId < 1 || itemId >= 640) throw new Error("Unsupported item ID.");
      return { ...empty, editable: true, message: "Custom rules available", nativeSlot: false, rules };
    }
    const pointer = readU32(c.data, row + 4), factory = c.factories.get(pointer);
    const choices = availableFactories(c).map(f => ({ id: f.profile!.id, label: f.profile!.label }));
    const overrides = readHealingOverrides(c), override = overrides.get(itemId);
    if (!factory?.profile) return { ...empty, address: pointer, choices, message: "Unrecognized handler code; native edits are disabled for this item." };
    assertFactoryUnhooked(c, factory);
    assertNoConflict(c, row + c.source.base + 4, 4, [ITEM_EFFECTS_DLL_PATH, overridePath(itemId)]);
    for (let n = 0; n < factory.profile.events.length; n++) {
      const handler = factory.profile.events[n].handler;
      if (["HandlerLeftoversUse", "HandlerChoiceBandPower", "HandlerChoiceSpecsPower", "HandlerChoiceScarf"].includes(handler)) assertServices(c, factory.events[n].offset, handler);
    }
    const controls = controlsFor({ ...c, itemId }, factory, overrides);
    return { editable: true, message: "Verified native handler", profileId: factory.profile.id, label: factory.profile.label,
      address: pointer, choices, events: factory.events, controls, typeHealing: override, rules, nativeSlot: true };
  } catch (error) { return { ...empty, message: error instanceof Error ? error.message : String(error) }; }
}

export function assignItemEffect(project: ProjectState, itemId: number, profileId: number): void {
  const c = editableContext(project, itemId), factory = availableFactories(c).find(f => f.profile!.id === profileId);
  if (rowOffset(c, itemId) === undefined) throw new Error("Use custom effects for items without a native handler slot.");
  if (!factory) throw new Error("That handler is not recognized in this ROM.");
  assertFactoryUnhooked(c, factory);
  disableHealingOverride(c, itemId);
  const row = rowOffset(c, itemId)!, before = readU32(c.data, row + 4), next = c.data.slice();
  writeU32(next, row + 4, factory.address);
  commitOverlay(c, next, itemId, "Battle handler", formatAddress(before), factory.profile!.label);
}

export function updateItemEffectControl(project: ProjectState, itemId: number, key: string, value: number): void {
  const c = editableContext(project, itemId), factory = c.factories.get(readU32(c.data, rowOffset(c, itemId)! + 4))!;
  const control = controlsFor(c, factory).find(control => control.key === key);
  if (!control || !Number.isFinite(value) || value < control.min || value > control.max
    || Math.abs(value / control.step - Math.round(value / control.step)) > 1e-8) throw new Error("Invalid native effect value.");
  if (key === "parameter") { updateItemField(project, itemId, "gain_values", String(value)); return; }
  const next = c.data.slice();
  if (key === "healingDivisor") {
    const event = factory.events[factory.profile!.events.findIndex(e => e.handler === "HandlerLeftoversUse")];
    assertServices(c, event.offset, "HandlerLeftoversUse");
    next[event.offset + 0x34] = value;
  } else {
    const name = factory.profile!.events.find(e => /HandlerChoice(?:BandPower|SpecsPower|Scarf)$/u.test(e.handler))!.handler;
    const event = factory.events[factory.profile!.events.findIndex(e => e.handler === name)];
    assertServices(c, event.offset, name);
    const scarf = name === "HandlerChoiceScarf", mov = scarf ? 0xe : 6, shift = scarf ? 0x12 : 0x24;
    const ratio = Math.round(value * 4096);
    let exponent = 0;
    while (ratio / 2 ** exponent > 255 || !Number.isInteger(ratio / 2 ** exponent)) {
      if (++exponent > 15) throw new Error("This multiplier cannot be encoded by the native handler.");
    }
    next[event.offset + mov] = ratio / 2 ** exponent;
    writeU16(next, event.offset + shift, (readU16(next, event.offset + shift) & ~0x7c0) | exponent << 6);
  }
  commitOverlay(c, next, itemId, control.label, control.value, value);
}

function controlsFor(c: Context, factory: Factory, overrides = readHealingOverrides(c)): ItemEffectControl[] {
  const result: ItemEffectControl[] = [], profile = factory.profile!;
  const holders = profiles.rows.filter(row => {
    if (readU32(c.data, rowOffset(c, row.id)! + 4) !== factory.address) return false;
    return !overrides.has(row.id) && !readGenericRules(c)?.has(row.id);
  }).map(row => row.id);
  for (let n = 0; n < profile.events.length; n++) {
    const name = profile.events[n].handler, at = factory.events[n].offset;
    if (name === "HandlerLeftoversUse") result.push({ key: "healingDivisor", label: "Max HP healing divisor", value: c.data[at + 0x34], min: 1, max: 255, step: 1, shared: holders });
    if (/HandlerChoice(?:BandPower|SpecsPower|Scarf)$/u.test(name)) {
      const scarf = name === "HandlerChoiceScarf", mov = scarf ? 0xe : 6, shift = scarf ? 0x12 : 0x24;
      const value = c.data[at + mov] * 2 ** ((readU16(c.data, at + shift) >> 6) & 31) / 4096;
      result.push({ key: "multiplier", label: scarf ? "Speed multiplier" : "Attacking stat multiplier", value, min: 0.125, max: 8, step: 0.125, shared: holders });
    }
  }
  const handlers = profile.events.map(e => e.handler);
  const percent = handlers.some(name => signatures.get(name)?.calls.some(call => ["CommonTypeBoostingItem", "ItemAttackValueToRatio"].includes(call.target)));
  const divisor = handlers.some(name => ["HandlerShellBell", "HandlerBlackSludge", "HandlerRockyHelmet"].includes(name));
  if (percent || divisor) result.push({ key: "parameter", label: percent ? "Power bonus (%)" : "Healing / damage divisor", value: Number(getItemRecord(c.project, currentItem(c, factory)).raw.gain_values ?? 0), min: divisor ? 1 : 0, max: 255, step: 1, shared: [] });
  return result;
}

// controlsFor is also used for reassigned items, whose own parameter is authoritative.
function currentItem(c: Context, factory: Factory): number {
  return c.itemId ?? factory.profile!.id;
}
function editableContext(project: ProjectState, itemId: number): Context & { itemId: number } {
  const state = inspectItemEffect(project, itemId);
  if (!state.editable) throw new Error(state.message);
  return { ...nativeContext(project), itemId };
}
function rowOffset(c: Context, itemId: number): number | undefined {
  const index = profiles.rows.findIndex(row => row.id === itemId);
  return index < 0 ? undefined : c.table + index * 8;
}
function availableFactories(c: Context): Factory[] {
  const byProfile = new Map<number, Factory>();
  for (const factory of c.factories.values()) if (factory.profile) byProfile.set(factory.profile.id, factory);
  return [...byProfile.values()].sort((a, b) => a.profile!.label.localeCompare(b.profile!.label));
}
function matchesSignature(data: Uint8Array, at: number, name: string): boolean {
  const s = signatures.get(name);
  return !!s && at >= 0 && at + s.bytes.length <= data.length && s.bytes.every((byte, i) => (data[at + i] & s.maskBytes[i]) === (byte & s.maskBytes[i]));
}
function findSignature(data: Uint8Array, name: string): number[] {
  const result: number[] = [], s = signatures.get(name)!;
  for (let at = 0; at + s.bytes.length <= data.length; at += 2) if (matchesSignature(data, at, name)) result.push(at);
  return result;
}
function branchTarget(c: Context, at: number): number {
  const high = readU16(c.data, at), low = readU16(c.data, at + 2);
  if ((high & 0xf800) !== 0xf000 || (low & 0xf800) !== 0xf800) throw new Error("The native call is no longer a Thumb BL.");
  let displacement = (high & 0x7ff) << 12 | (low & 0x7ff) << 1;
  if (displacement & 0x400000) displacement -= 0x800000;
  return c.source.base + at + 4 + displacement;
}
function assertServices(c: Context, at: number, name: string): void {
  for (const call of signatures.get(name)!.calls) {
    const target = branchTarget(c, at + call.offset);
    if (call.target && signatures.has(call.target) && !matchesSignature(c.data, target - c.source.base, call.target))
      throw new Error(`Unrecognized native service: ${call.target}.`);
  }
}
function assertFactoryUnhooked(c: Context, factory: Factory): void {
  assertNoConflict(c, c.source.base + factory.offset, 12);
  assertNoConflict(c, c.source.base + factory.table, factory.events.length * 8);
  for (let n = 0; n < factory.events.length; n++)
    assertNoConflict(c, factory.events[n].address & ~1, signatures.get(factory.profile!.events[n].handler)!.bytes.length);
}
function patchFiles(c: Context): Map<string, Uint8Array> {
  const result = new Map(Object.entries(c.source.files));
  for (const [path, id] of Object.entries(c.source.fileIds)) if (c.project.fileSystem?.replacements?.[id]) result.set(path, c.project.fileSystem.replacements[id]);
  for (const [path, bytes] of Object.entries(c.project.fileSystem?.additions ?? {})) if (path.toLowerCase().endsWith(".dll")) result.set(path, bytes);
  return result;
}
function assertNoConflict(c: Context, address: number, size: number, except: readonly string[] = [], importedService?: string): void {
  for (const [path, bytes] of patchFiles(c)) {
    if (except.includes(path)) continue;
    let rpm: RpmModule;
    try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    for (const relocation of rpm.relocations) {
      if (relocation.target.module !== "167") continue;
      const start = relocation.target.address & ~1, count = relocation.target.type === "FULL_COPY" ? rpm.symbols[relocation.sourceSymbolIndex]?.size ?? 0
        : relocation.target.type === "OFFSET" ? 4 : 16;
      if (start < address + size && start + count > address) {
        if (start === address && relocation.target.type === "THUMB_BRANCH") {
          if (importedService === "IsMonTrapped" && isVerifiedAbilityClientTrapImport(c.project, path, address, size)) continue;
          if (importedService === "IsFainted" && isVerifiedBattleCounterImport(c.project.session.baseVersion, path, bytes, address)) continue;
        }
        throw new Error(`Conflicting native item hook: ${path}.`);
      }
    }
  }
}
function commitOverlay(c: Context, next: Uint8Array, itemId: number, label: string, before: unknown, after: unknown): void {
  c.project.overlays[167] = next;
  c.project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!c.project.patches.dirtyOverlayIds.includes(167)) c.project.patches.dirtyOverlayIds.push(167);
  recordFieldChange(c.project, "items", String(getItemRecord(c.project, itemId).readable.name), label, before, after, { key: `item-effect:${itemId}:${label}` });
}
export function formatAddress(value: number): string { return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`; }
function fromHex(value: string): Uint8Array { return Uint8Array.from(value.match(/../gu) ?? [], byte => Number.parseInt(byte, 16)); }

// A private copy of the ROM's verified Black Sludge callback provides optional
// type-gated healing. Its nonmatching-type branch returns without damage. Every
// native BL is relocated to the actual source call target; no stock imports or
// guessed free space are used. The original callback and other items stay intact.
const HEALING_VERSION = "1.0.0";
export const ITEM_EFFECTS_DLL_PATH = "patches/ItemEffects.dll";
const SHARED_VERSION = "2.0.0", ITEM_TYPE_LIMIT = 640;
// A non-executable marker keeps an existing NitroFS file ID stable while making
// PMC's four-byte IsRPM check skip it entirely, including its ModuleState.
const RETIRED_PATCH = Uint8Array.of(0x50, 0x57, 0x49, 0x52);
// Assembled ARMv5T Thumb source: runtime/item-effects/type_gate.s.
const TYPE_GATE = fromHex("10b504000800fff7feff0649884207d20549095cff2903d02000fff7feff10bd002010bd8002000000000000");
function overridePath(itemId: number): string { return `patches/ItemTypeHealing${itemId}.dll`; }
// Only retained to verify and migrate version-1 files already exported by users.
function legacyHealingModule(c: Context, itemId: number, type: number): RpmModule {
  const row = rowOffset(c, itemId);
  if (row === undefined) throw new Error("This item has no native handler slot.");
  const donor = availableFactories(c).find(f => f.profile!.events.some(e => e.handler === "HandlerBlackSludge"));
  if (!donor) throw new Error("The native type-healing template is not recognized.");
  assertFactoryUnhooked(c, donor);
  const event = donor.events[0], name = "HandlerBlackSludge";
  assertServices(c, event.offset, name);
  const body = c.data.slice(event.offset, event.offset + signatures.get(name)!.bytes.length);
  if (body[0x2b] !== 0x21 || readU16(body, 0x32) !== 0xd027) throw new Error("The native type-healing operands do not match.");
  body[0x2a] = type;
  // beq end (0x021c4910 relative to the original callback), rather than damage.
  writeU16(body, 0x32, 0xd057);
  const code = new Uint8Array(20 + body.length);
  code.set([0x01, 0x21, 0x01, 0x60, 0x00, 0x48, 0x70, 0x47], 0);
  writeU32(code, 12, 0x76); code.set(body, 20);
  const rpm: RpmModule = { code, bssSize: 0, baseAddress: 0,
    metadata: { PMCGameID: c.project.session.baseVersion, PMCVersion: HEALING_VERSION, PMCModulePriority: 4, PokewebItem: itemId, PokewebHealType: type },
    symbols: [
      { name: null, address: 0, size: 12, type: "FUNCTION_THM", attributes: 0 },
      { name: null, address: 12, size: 8, type: "SECTION", attributes: 0 },
      { name: null, address: 20, size: body.length, type: "FUNCTION_THM", attributes: 0 },
    ], relocations: [
      { target: { module: "base", address: 8, type: "OFFSET" }, sourceSymbolIndex: 1 },
      { target: { module: "base", address: 16, type: "OFFSET" }, sourceSymbolIndex: 2 },
      { target: { module: "167", address: c.source.base + row + 4, type: "OFFSET" }, sourceSymbolIndex: 0 },
    ] };
  for (const call of signatures.get(name)!.calls) {
    rpm.symbols.push({ name: null, address: branchTarget(c, event.offset + call.offset), size: 0, type: "FUNCTION_THM", attributes: 4 });
    rpm.relocations.push({ target: { module: "base", address: 20 + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.length - 1 });
  }
  return rpm;
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((byte, i) => byte === b[i]); }
function sharedHealingModule(c: Context, overrides: ReadonlyMap<number, number>): RpmModule {
  const entries = [...overrides].sort(([a], [b]) => a - b);
  if (!entries.length) throw new Error("No item effects are configured.");
  const rpm = legacyHealingModule(c, entries[0][0], entries[0][1]);
  const callbackSize = rpm.code.length - 20, gate = rpm.code.length, types = gate + TYPE_GATE.length;
  const code = new Uint8Array(types + ITEM_TYPE_LIMIT);
  code.set(rpm.code); code.set(TYPE_GATE, gate); code.fill(255, types);
  // Pass the current BattleEventItem to the common type gate, replacing the
  // donor's immediate Poison operand. The original native type matcher remains
  // responsible for dual types and all native type-pair semantics.
  writeU16(code, 20 + 0x2a, 0x1c39); // adds r1, r7, #0
  rpm.code = code;
  rpm.metadata = { PMCGameID: c.project.session.baseVersion, PMCVersion: SHARED_VERSION, PMCModulePriority: 4,
    PokewebItemEffects: "type-healing", PokewebTypeHealing: JSON.stringify(entries) };
  rpm.symbols.push({ name: null, address: gate, size: TYPE_GATE.length, type: "FUNCTION_THM", attributes: 0 },
    { name: null, address: types, size: ITEM_TYPE_LIMIT, type: "SECTION", attributes: 0 });
  const gateSymbol = rpm.symbols.length - 2, typesSymbol = rpm.symbols.length - 1;
  const matcher = rpm.relocations.find(r => r.target.module === "base" && r.target.address === 20 + 0x2c)!;
  const subId = rpm.relocations.find(r => r.target.module === "base" && r.target.address === 20 + 0x6c)!;
  rpm.relocations = rpm.relocations.filter(r => r.target.module !== "167");
  rpm.relocations.push({ target: { module: "base", address: gate + 6, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: subId.sourceSymbolIndex },
    { target: { module: "base", address: gate + 0x1a, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: matcher.sourceSymbolIndex },
    { target: { module: "base", address: gate + 0x28, type: "OFFSET" }, sourceSymbolIndex: typesSymbol });
  matcher.sourceSymbolIndex = gateSymbol;
  for (const [id, type] of entries) {
    if (!Number.isInteger(id) || id < 0 || id >= ITEM_TYPE_LIMIT || !Number.isInteger(type) || type < 0 || type > 17) throw new Error("Invalid shared item effect.");
    const row = rowOffset(c, id);
    if (row === undefined) throw new Error("This item has no native handler slot.");
    code[types + id] = type;
    rpm.relocations.push({ target: { module: "167", address: c.source.base + row + 4, type: "OFFSET" }, sourceSymbolIndex: 0 });
  }
  if (callbackSize !== 244) throw new Error("Unrecognized native healing callback size.");
  return rpm;
}
function readHealingOverrides(c: Context): Map<number, number> {
  if (readGenericRules(c)) return new Map();
  const result = new Map<number, number>(), files = patchFiles(c), shared = files.get(ITEM_EFFECTS_DLL_PATH);
  if (shared && !sameBytes(shared, RETIRED_PATCH)) {
    const rpm = parseRpm(shared, { allowedMagics: ["DLXF"] });
    if (rpm.metadata.PokewebItemEffects !== "type-healing" || typeof rpm.metadata.PokewebTypeHealing !== "string") throw new Error("Unrecognized shared item effects.");
    const entries: unknown = JSON.parse(rpm.metadata.PokewebTypeHealing);
    if (!Array.isArray(entries) || !entries.length || entries.length > profiles.rows.length) throw new Error("Invalid shared item effect table.");
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || result.has(entry[0])) throw new Error("Invalid shared item effect entry.");
      result.set(entry[0], entry[1]);
    }
    if (!sameBytes(shared, writeRpm(sharedHealingModule(c, result), { ident: "DLXF" }))) throw new Error("The shared item effects DLL has been modified.");
  }
  for (const [path, bytes] of files) {
    const match = /^patches\/ItemTypeHealing(\d+)\.dll$/u.exec(path);
    if (!match || sameBytes(bytes, RETIRED_PATCH)) continue;
    const id = Number(match[1]), rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    if (rpm.metadata.PokewebItem !== id) throw new Error("Unrecognized legacy item healing override.");
    if (rpm.metadata.PokewebHealType === 255 && rpm.code.length === 4 && rpm.relocations.length === 0
      && sameBytes(rpm.code, Uint8Array.of(0x70, 0x47, 0xc0, 0x46))) continue;
    const type = Number(rpm.metadata.PokewebHealType);
    if (!Number.isInteger(type) || type < 0 || type > 17 || result.has(id)
      || !sameBytes(bytes, writeRpm(legacyHealingModule(c, id, type), { ident: "DLXF" }))) throw new Error("The legacy item healing override has been modified or conflicts with shared effects.");
    result.set(id, type);
  }
  return result;
}
function retirePatch(c: Context, path: string): void {
  const state = ensureFileSystemState(c.project), id = c.source.fileIds[path];
  delete state.additions![path];
  if (id !== undefined) setRomFileReplacement(c.project, id, RETIRED_PATCH.slice());
  if (c.project.codeInjection?.modules) c.project.codeInjection.modules = c.project.codeInjection.modules.filter(m => m.path !== path);
}
function stageHealingOverrides(c: Context, overrides: ReadonlyMap<number, number>): void {
  // Updating one shared file republishes every retained assignment. Validate
  // those rows too, including conflicts introduced since their original edit.
  for (const id of overrides.keys()) assertNoConflict(c, c.source.base + rowOffset(c, id)! + 4, 4, [ITEM_EFFECTS_DLL_PATH, overridePath(id)]);
  if (overrides.size) stageCodeInjectionDll(c.project, "ItemEffects.dll", writeRpm(sharedHealingModule(c, overrides), { ident: "DLXF" }));
  else if (patchFiles(c).has(ITEM_EFFECTS_DLL_PATH)) retirePatch(c, ITEM_EFFECTS_DLL_PATH);
  for (const path of patchFiles(c).keys()) if (/^patches\/ItemTypeHealing\d+\.dll$/u.test(path)) retirePatch(c, path);
}
function disableHealingOverride(c: Context, itemId: number): void {
  const generic = readGenericRules(c);
  if (generic) { const next = new Map(generic); if (next.delete(itemId)) stageGenericRules(c, next); return; }
  const overrides = readHealingOverrides(c);
  if (!overrides.delete(itemId)) return;
  stageHealingOverrides(c, overrides);
}
export type ItemTypeHealingEdit = { itemId: number; type: number; divisor: number };
/** One atomic shared-module update, also used by bulk authoring/verification. */
export async function configureItemTypeHealingBatch(project: ProjectState, edits: readonly ItemTypeHealingEdit[]): Promise<void> {
  if (!edits.length) return;
  const initial = nativeContext(project);
  if (readGenericRules(initial) || edits.some(edit => rowOffset(initial, edit.itemId) === undefined)) {
    for (const edit of edits) if (!Number.isInteger(edit.type) || edit.type < 0 || edit.type > 17 || !Number.isInteger(edit.divisor) || edit.divisor < 1 || edit.divisor > 255) throw new Error("Invalid type-healing settings.");
    await configureItemRuleSets(project, edits.map(edit => ({ itemId: edit.itemId, rules: typeHealingRule(edit.type, edit.divisor) })));
    for (const edit of edits) updateItemField(project, edit.itemId, "gain_values", String(edit.divisor));
    return;
  }
  const c = nativeContext(project), overrides = readHealingOverrides(c), seen = new Set<number>();
  for (const { itemId, type, divisor } of edits) {
    if (!Number.isInteger(type) || type < 0 || type > 17 || !Number.isInteger(divisor) || divisor < 1 || divisor > 255 || seen.has(itemId)) throw new Error("Invalid type-healing settings.");
    seen.add(itemId);
    const row = rowOffset(c, itemId), factory = row === undefined ? undefined : c.factories.get(readU32(c.data, row + 4));
    if (row === undefined || !factory?.profile) throw new Error("This item has no recognized native handler slot.");
    getItemRecord(project, itemId);
    assertFactoryUnhooked(c, factory);
    assertNoConflict(c, c.source.base + row + 4, 4, [ITEM_EFFECTS_DLL_PATH, overridePath(itemId)]);
    overrides.set(itemId, type);
  }
  // Validate the complete module before installing any dependencies or edits.
  sharedHealingModule(c, overrides);
  await installCodeInjectionPatch(project, staged => {
    stageHealingOverrides({ ...c, project: staged }, overrides);
    for (const { itemId, divisor } of edits) updateItemField(staged, itemId, "gain_values", String(divisor));
  });
}
export async function configureItemTypeHealing(project: ProjectState, itemId: number, type: number, divisor: number): Promise<void> {
  await configureItemTypeHealingBatch(project, [{ itemId, type, divisor }]);
}

/** Build the exact native module for inspection and relocation verification. */
export function buildItemTypeHealingModule(project: ProjectState, itemId: number, type: number): RpmModule {
  if (!Number.isInteger(type) || type < 0 || type > 17) throw new Error("Invalid healing type.");
  const c = editableContext(project, itemId), overrides = readHealingOverrides(c);
  if (readGenericRules(c) || rowOffset(c, itemId) === undefined) {
    const rules = existingRules(c);
    rules.set(itemId, validateItemRule(typeHealingRule(type, Number(getItemRecord(project, itemId).raw.gain_values))));
    return ruleModule(c, rules);
  }
  overrides.set(itemId, type);
  return sharedHealingModule(c, overrides);
}

const ruleSignatures = new Map(Object.entries(ruleBindings.functions).map(([name, value]) => [name, { ...value, bytes: fromHex(value.hex), maskBytes: fromHex(value.mask) }]));
const nativeSignatures = new Map(Object.entries(ITEM_NATIVE_FUNCTIONS).map(([name, value]) => [name, { ...value, bytes: fromHex(value.hex), maskBytes: fromHex(value.mask) }]));
function ruleServiceMatches(c: Context, name: string, address: number): boolean {
  const signature = ruleSignatures.get(name) ?? signatures.get(name);
  if (!signature) return false;
  const arm = ruleSignatures.get(name)?.module === "ARM9", bytes = arm ? c.project.arm9 : c.data;
  const at = address - (arm ? c.source.arm9Base : c.source.base);
  return at >= 0 && at + signature.bytes.length <= bytes.length && signature.bytes.every((byte, i) => (bytes[at + i] & signature.maskBytes[i]) === (byte & signature.maskBytes[i]));
}
function nativeRuleResolver(c: Context): NativeItemResolver {
  const catalog = ITEM_NATIVE_FUNCTIONS as Record<string, typeof ITEM_NATIVE_FUNCTIONS.HandlerFlameOrb>;
  const found = new Map<string, number>();
  const body = (name: string, address: number) => {
    const entry = catalog[name];
    if (!entry) throw new Error(`Missing native effect signature: ${name}`);
    const bytes = entry.module === "ARM9" ? c.project.arm9 : c.data;
    const at = address - (entry.module === "ARM9" ? c.source.arm9Base : c.source.base);
    const { bytes: expected, maskBytes: mask } = nativeSignatures.get(name)!;
    if (at < 0 || at + expected.length > bytes.length || !expected.every((value, i) => (bytes[at + i] & mask[i]) === (value & mask[i]))) return;
    return bytes.slice(at, at + expected.length);
  };
  found.set("ItemEvent_AddItemCore", c.source.base + c.dispatcher);
  for (const factory of c.factories.values()) for (const profile of profiles.rows) {
    if (profile.events.length !== factory.events.length || !profile.events.every((event, i) => event.event === factory.events[i].event && body(event.handler, factory.events[i].address & ~1))) continue;
    for (const [index, event] of profile.events.entries()) if (!found.has(event.handler)) found.set(event.handler, factory.events[index].address & ~1);
  }
  // Resolve short or duplicated helpers through calls from verified callbacks.
  const visited = new Set<string>();
  const discover = () => {
    for (const [name, address] of found) {
      if (visited.has(name)) continue;
      visited.add(name);
      const code = body(name, address), entry = catalog[name];
      if (!code || !entry?.thumb) continue;
      for (const call of entry.calls) {
        if (!catalog[call.target]) continue;
        const target = nativeItemBranchTarget(code, call.offset, address);
        if (body(call.target, target) && !found.has(call.target)) found.set(call.target, target);
      }
    }
  };
  discover();
  return (name, address) => {
    const entry = catalog[name];
    if (!entry) throw new Error(`Missing native effect signature: ${name}`);
    if (address === undefined) address = found.get(name);
    if (address === undefined) {
      const bytes = entry.module === "ARM9" ? c.project.arm9 : c.data;
      const base = entry.module === "ARM9" ? c.source.arm9Base : c.source.base, candidates: number[] = [];
      for (let at = 0; at + entry.hex.length / 2 <= bytes.length; at += entry.thumb ? 2 : 4) if (body(name, base + at)) candidates.push(base + at);
      if (candidates.length !== 1) throw new Error(`Native effect dependency is missing or ambiguous: ${name}`);
      address = candidates[0]; found.set(name, address); discover();
    }
    const code = body(name, address);
    if (!code) throw new Error(`Unrecognized native effect dependency: ${name}`);
    if (entry.module === "167") assertNoConflict(c, address, code.length, [ITEM_EFFECTS_DLL_PATH], entry.clone ? undefined : name);
    return { address, code };
  };
}
function ruleModule(c: Context, rules: ReadonlyMap<number, ItemRuleSet>, legacy = false): RpmModule {
  assertNoConflict(c, c.source.base + c.dispatcher, 8, [ITEM_EFFECTS_DLL_PATH]);
  const located = new Map<string, number>([["ItemEvent_AddItemCore", c.dispatcher]]);
  function locate(name: string): number {
    if (located.has(name)) return located.get(name)!;
    for (const factory of c.factories.values()) {
      const index = factory.profile!.events.findIndex(event => event.handler === name);
      if (index >= 0) {
        assertFactoryUnhooked(c, factory);
        located.set(name, factory.events[index].offset);
        return factory.events[index].offset;
      }
    }
    const s = ruleSignatures.get(name) ?? signatures.get(name);
    if (!s) throw new Error(`Missing native signature: ${name}`);
    const candidates: number[] = [];
    for (let at = 0; at + s.bytes.length <= c.data.length; at += 2) if (ruleServiceMatches(c, name, c.source.base + at)) candidates.push(at);
    if (candidates.length !== 1) throw new Error(`Native service is missing or ambiguous: ${name}`);
    located.set(name, candidates[0]);
    return candidates[0];
  }
  function call(anchor: string, name: string, fallback?: number): number {
    const s = ruleSignatures.get(anchor) ?? signatures.get(anchor)!;
    const descriptor = s.calls.find(value => value.target === name);
    const offset = descriptor?.offset ?? fallback;
    if (offset === undefined) throw new Error(`Missing native call: ${name}`);
    const address = branchTarget(c, locate(anchor) + offset);
    if (!ruleServiceMatches(c, name, address)) throw new Error(`Unrecognized native service: ${name}`);
    if (ruleSignatures.get(name)?.module !== "ARM9") {
      located.set(name, address - c.source.base);
      assertNoConflict(c, address, (ruleSignatures.get(name) ?? signatures.get(name))!.bytes.length);
    }
    return address;
  }
  const addresses: Record<string, number> = {};
  for (const name of ["BattleEventVar_GetValue", "GetBattleMon", "GetPokeType", "PokeTypePair_IsMatch", "BtlServerFlow_CheckMatchup", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleHandler_StrSetup", "BattleHandler_AddArg", "BattleEventItem_GetSubID"])
    addresses[name] = call("HandlerBlackSludge", name);
  addresses.BattleEventVar_MulValue = call("HandlerChoiceBandPower", "BattleEventVar_MulValue");
  addresses.PML_MoveGetCategory = call("HandlerChoiceBandPower", "PML_MoveGetCategory", 0x1a);
  addresses.GetBattleMonStat = call("DivideMaxHPZeroCheck", "GetBattleMonStat");
  addresses.ServerEvent_GetWeather = c.source.base + locate("ServerEvent_GetWeather");
  const gem = call("HandlerFireGemDecide", "CommonGemDecide");
  located.set("CommonGemDecide", gem - c.source.base);
  addresses.BtlServerFlow_IsSimulating = call("CommonGemDecide", "BtlServerFlow_IsSimulating");
  for (const name of ["BattleEvent_AddItem", "GetMonID", "RawBattleMonStat"]) addresses[name] = call("ItemEvent_AddItemCore", name);
  const signature = signatures.get("ItemEvent_AddItemCore")!;
  const resolve = legacy ? undefined : nativeRuleResolver(c);
  const extra = ["ItemGetParam", "BattleEventVar_Push", "BattleEventVar_Pop", "BattleEventVar_SetConstValue", "IsStatChangeValid", "BtlCalc_MakeStatusCondition", "MakeConditionBadlyPoisoned", "BattleEventVar_GetValueIfExist", "RollEffectChance", "BattleEventVar_RewriteValue", "GetBattleMonSpecies", "CheckCondition", "getMoveFlag", "BattleEvent_CheckSkip", "GetBattleMonHeldItem", null, "CanMonUseHeldItem", "IsMonTrapped", null, "SetMoveEffectIndex", null, null, "BtlServerFlow_CanUseHeldItem"];
  return buildRuleRuntime({ game: c.project.session.baseVersion, rules, api: ITEM_RULE_API.map(name => addresses[name]), legacy,
    native: resolve ? { resolve, api: new Map(extra.flatMap((name, index) => name ? [[19 + index, resolve(name).address] as const] : [])) } : undefined,
    dispatcher: { address: c.source.base + c.dispatcher, code: c.data.slice(c.dispatcher, c.dispatcher + signature.bytes.length),
      calls: signature.calls.map(value => ({ offset: value.offset, address: branchTarget(c, c.dispatcher + value.offset) })) } });
}
function readGenericRules(c: Context): Map<number, ItemRuleSet> | undefined {
  if (c.rulesRead) return c.rules;
  const bytes = patchFiles(c).get(ITEM_EFFECTS_DLL_PATH);
  if (!bytes || sameBytes(bytes, RETIRED_PATCH)) { c.rulesRead = true; return; }
  const cached = verifiedRules.get(c.project), files = patchFiles(c);
  if (cached && cached.base === c.source.base && sameBytes(cached.overlay, c.data) && sameBytes(cached.arm9, c.project.arm9)
    && files.size === cached.files.size && [...files].every(([path, value]) => cached.files.has(path) && sameBytes(cached.files.get(path)!, value))) {
    c.rules = structuredClone(cached.rules); c.rulesRead = true; return c.rules;
  }
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  if (rpm.metadata.PokewebItemEffects !== "rules") { c.rulesRead = true; return; }
  if (typeof rpm.metadata.PokewebItemRules !== "string") throw new Error("Missing item rule configuration.");
  const entries: unknown = JSON.parse(rpm.metadata.PokewebItemRules), rules = new Map<number, ItemRuleSet>();
  if (!Array.isArray(entries) || !entries.length || entries.length > 639) throw new Error("Invalid item rule registry.");
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || rules.has(entry[0])) throw new Error("Invalid item rule entry.");
    rules.set(entry[0], validateItemRule(entry[1]));
  }
  if (!["3.0.0", "4.0.0"].includes(String(rpm.metadata.PMCVersion)) || !sameBytes(bytes, writeRpm(ruleModule(c, rules, rpm.metadata.PMCVersion === "3.0.0"), { ident: "DLXF" }))) throw new Error("The shared item rules DLL has been modified.");
  verifiedRules.set(c.project, { base: c.source.base, overlay: c.data.slice(), arm9: c.project.arm9.slice(), files: new Map([...files].map(([path, value]) => [path, value.slice()])), rules: structuredClone(rules) });
  c.rules = rules; c.rulesRead = true;
  return rules;
}
function typeHealingRule(type: number, divisor: number): ItemRuleSet {
  return { effects: [{ kind: "healDivisor", value: divisor }], conditions: { kind: "group", mode: "all", children: [{ kind: "type", value: type }] }, consumable: false };
}
/** Build a checked image without installing it, for local inspection/validation. */
export function buildItemRuleModule(project: ProjectState, entries: ReadonlyMap<number, ItemRuleSet>): RpmModule {
  const rules = new Map<number, ItemRuleSet>();
  for (const [id, input] of entries) {
    if (!Number.isInteger(id) || id < 1 || id >= 640) throw new Error("Invalid item ID.");
    getItemRecord(project, id); rules.set(id, validateItemRule(input));
  }
  if (!rules.size) throw new Error("Choose at least one item rule.");
  return ruleModule(nativeContext(project), rules);
}
function existingRules(c: Context): Map<number, ItemRuleSet> {
  const existing = readGenericRules(c);
  if (existing) return new Map(existing);
  return new Map([...readHealingOverrides(c)].map(([id, type]) => [id, validateItemRule(typeHealingRule(type, Number(getItemRecord(c.project, id).raw.gain_values)))]));
}
function stageGenericRules(c: Context, rules: ReadonlyMap<number, ItemRuleSet>): void {
  if (rules.size) stageCodeInjectionDll(c.project, "ItemEffects.dll", writeRpm(ruleModule(c, rules), { ident: "DLXF" }));
  else if (patchFiles(c).has(ITEM_EFFECTS_DLL_PATH)) retirePatch(c, ITEM_EFFECTS_DLL_PATH);
  for (const path of patchFiles(c).keys()) if (/^patches\/ItemTypeHealing\d+\.dll$/u.test(path)) retirePatch(c, path);
}
/** Rules are encoded inside the single shared DLL and verified again on reopen. */
export async function configureItemRuleSets(project: ProjectState, edits: readonly { itemId: number; rules: ItemRuleSet }[]): Promise<void> {
  if (!edits.length) return;
  const c = nativeContext(project), rules = existingRules(c), seen = new Set<number>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.itemId) || edit.itemId < 1 || edit.itemId >= 640 || seen.has(edit.itemId)) throw new Error("Invalid item ID.");
    getItemRecord(project, edit.itemId); seen.add(edit.itemId);
    rules.set(edit.itemId, validateItemRule(edit.rules));
  }
  ruleModule(c, rules);
  await installCodeInjectionPatch(project, staged => {
    stageGenericRules({ ...c, project: staged }, rules);
    for (const edit of edits) recordFieldChange(staged, "items", String(getItemRecord(staged, edit.itemId).readable.name), "Custom battle rules", "Previous effect", JSON.stringify(edit.rules), { key: `item-rules:${edit.itemId}` });
  });
}
export function clearItemRules(project: ProjectState, itemId: number): void {
  const c = nativeContext(project);
  disableHealingOverride(c, itemId);
}
