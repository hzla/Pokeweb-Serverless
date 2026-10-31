import { encodeMoveRecipeBook, decodeMoveRecipeBook } from "./moveRecipeBook";
import { inspectAbilityEffects, upgradeAbilityRuntime } from "./abilityEffectsModel";
import bindings from "../assets/data/moveRecipeBindings.json";
import template from "../assets/data/moveRuleRuntime.json";
import { NintendoDSRom } from "../nds/rom";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { BATTLE_RUNTIME_SIGNATURES, battleBranchTarget, battleRuntimeResolver, type BattleRuntimeSignature } from "./battleRuntimeBindings";
import { checkedMoveEventList, encodeMoveRules, moveRecipeEvents, validateMoveRule, validateMoveRuleCategory, type MoveRuleSet } from "./moveRules";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { ensureFileSystemState, setRomFileReplacement } from "./fileSystemModel";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { stageCodeInjectionDll } from "./pmcModel";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { recordGenericChange } from "./actionChangelog";

export const MOVE_EFFECTS_DLL_PATH = "patches/MoveEffects.dll";
export const MOVE_RULE_API = ["BattleEventVar_GetValue", "BattleEventVar_GetValueIfExist", "BattleEventVar_RewriteValue", "BattleEventVar_MulValue", "GetBattleMon", "GetBattleMonStat", "GetPokeType", "PokeTypePair_IsMatch", "ServerEvent_GetWeather", "BtlServerFlow_IsSimulating", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleEventVar_Push", "BattleEventVar_Pop", "BattleEventVar_SetConstValue", "BattleEventVar_SetRewriteOnceValue", "IsAllyMonID", "CheckCondition", "BtlServerFlow_IsMonInBattle", "GetMonID", "GetBattleMonSpecies", "PML_MoveGetCategory", "GetTurnFlag", "RollEffectChance", "IsStatChangeValid", "IsFieldEffectActive", "ServerControl_CheckFloating", "BtlServerFlow_CheckMatchup", "BattleEventVar_SetValue", "BattleEvent_CallHandlers", "BtlCalc_MakeStatusCondition", "BattleEventItem_GetSubID", null, "DoesMoveEventExist", "BattleEvent_AddItem", null, null] as const;
const signatures = { ...BATTLE_RUNTIME_SIGNATURES, ...bindings.functions } as Record<string, BattleRuntimeSignature>;
const retired = Uint8Array.of(80, 87, 77, 82);
type Source = { base: number; armBase: number; game: string; revision: number; files: Map<string, Uint8Array>; ids: Map<string, number> };
const sources = new WeakMap<ProjectState, Source>();
export function hydrateMoveEffectsSource(project: ProjectState, rom: NintendoDSRom): void {
  if (!supportsMoveRecipes(project)) return;
  const table=project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  for(let at=0;at+32<=table.length;at+=32)if(readU32(table,at)===167){
    const files=new Map<string,Uint8Array>(),ids=new Map<string,number>();
    for(const directory of ["patches","lib"])for(const name of rom.filenames.folders.find(([n])=>n===directory)?.[1].files??[]){
      if(!name.toLowerCase().endsWith(".dll"))continue;
      const path=`${directory}/${name}`,id=rom.filenames.idOf(path);
      if(id!==undefined){files.set(path,rom.files[id].slice());ids.set(path,id);}
    }
    sources.set(project,{base:readU32(table,at+4),armBase:rom.arm9RamAddress,game:rom.idCode,revision:rom.data[30],files,ids});return;
  }
}
type Snapshot = Record<string, number>;
type Saved = { rules: Map<number, MoveRuleSet>; originals: Map<number, Snapshot> };
export const MOVE_RECIPE_MANAGED_FIELDS = ["effect_category", "result_effect", "effect_chance", "status", "min_turns", "max_turns", "healing", "recoil", "flinch", ...[1, 2, 3].flatMap(n => [`stat_${n}`, `magnitude_${n}`, `stat_chance_${n}`])];
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export const supportsMoveRecipes = (project: ProjectState) => project.session.baseRom === "BW2";

function context(project: ProjectState, requireMoves = true) {
  if (!supportsMoveRecipes(project)) throw Error("Move recipes currently support Black 2 and White 2.");
  if(!sources.has(project)&&project.originalRomBytes)hydrateMoveEffectsSource(project,new NintendoDSRom(project.originalRomBytes,{fileData:"view"}));
  const source=sources.get(project);if(!source)throw Error("Reload the ROM with Moves selected before editing recipes.");
  if(!["IRDO","IREO"].includes(source.game)||source.revision!==0)throw Error("Move recipes require a recognized US revision-0 Black 2 or White 2 ROM.");
  let base=source.base;
  const table=project.patches?.arm9OverlayTable;
  if(table)for(let at=0;at+32<=table.length;at+=32)if(readU32(table,at)===167)base=readU32(table,at+4);
  const overlay = project.overlays[167];
  if (!base || !overlay?.length || requireMoves && !project.narcs.moves) throw Error("Reload the ROM with Moves selected.");
  const resolver = battleRuntimeResolver(overlay, base, project.arm9, source.armBase, signatures);
  const dispatcher = resolver.resolve("MoveEvent_AddItem");
  const first = readU32(dispatcher.code, 108), second = readU32(dispatcher.code, 116), count = readU32(dispatcher.code, 112);
  if (second !== first + 4 || ![258, 384].includes(count)) throw Error("Unrecognized native move registry.");
  const offset = first - base;
  if (offset < 0 || offset + count * 8 > overlay.length || !bindings.rows.every((id, n) => readU32(overlay, offset + n * 8) === id || count === 384 && id === 216 && readU32(overlay, offset + n * 8) === 0 && readU32(overlay, offset + n * 8 + 4) === 0) || count === 384 && Array.from({length: 126}, (_, n) => n + 258).some(n => readU32(overlay, offset + n * 8) || readU32(overlay, offset + n * 8 + 4))) throw Error("Unrecognized native move assignments.");
  const getters = new Map<number, { name: string; events: Array<{ event: number; handler: string }> }>();
  for (const [key, getter] of Object.entries(bindings.getters)) {
    const id = Number(key), index = bindings.rows.indexOf(id), address = readU32(overlay, offset + index * 8 + 4) & ~1;
    if (!resolver.matches(getter.name, address)) continue;
    const eventAt = readU32(overlay, address - base + getter.tableRef) - base;
    if (eventAt < 0 || eventAt + getter.events.length * 8 > overlay.length || !getter.events.every((e, n) => readU32(overlay, eventAt + n * 8) === e.event && resolver.matches(e.handler, readU32(overlay, eventAt + n * 8 + 4) & ~1))) continue;
    resolver.seed(getter.name, address);
    getter.events.forEach((e, n) => resolver.seed(e.handler, readU32(overlay, eventAt + n * 8 + 4) & ~1));
    getters.set(id, getter);
  }
  const files = new Map(source.files);
  for(const[path,id]of source.ids)if(project.fileSystem?.replacements?.[id])files.set(path,project.fileSystem.replacements[id]);
  for (const [name, data] of Object.entries(project.fileSystem?.additions ?? {})) if (name.toLowerCase().endsWith(".dll")) files.set(name, data);
  return { project, source, base, overlay, resolver, getters, files, moveCount: project.narcs.moves?.fileCount ?? 65535 };
}
type Context = ReturnType<typeof context>;
function needsAbilityUpgrade(c:Context):boolean {
  const bytes=c.files.get("patches/AbilityEffects.dll");if(!bytes||same(bytes,Uint8Array.of(80,87,65,82)))return false;
  const module=parseRpm(bytes,{allowedMagics:["DLXF"]});
  if(module.metadata.PokewebAbilityEffects!=="rules")throw Error("Verify the installed shared ability runtime in Abilities before applying move recipes.");
  const state=inspectAbilityEffects(c.project);if(!state.editable)throw Error(state.message);
  return state.runtimeVersion===1;
}
function checkHook(c: Context, name: string, address: number, size: number) {
  for (const [path, bytes] of c.files) {
    if (path === MOVE_EFFECTS_DLL_PATH || same(bytes, retired)) continue;
    let module: RpmModule; try { module = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    for (const relocation of module.relocations) {
      if (relocation.target.module !== (signatures[name].module === "ARM9" ? "0" : "167")) continue;
      const start = relocation.target.address & ~1, length = relocation.target.type === "FULL_COPY" ? module.symbols[relocation.sourceSymbolIndex]?.size ?? 0 : relocation.target.type === "OFFSET" ? 4 : 16;
      if (start < address + size && start + length > address) throw Error(`Conflicting move service hook: ${path} (${name}).`);
    }
  }
}
function stored(c: Context): Saved {
  const bytes = c.files.get(MOVE_EFFECTS_DLL_PATH);
  if (!bytes || same(bytes, retired)) return { rules: new Map(), originals: new Map() };
  const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  if (module.metadata.PokewebMoveRecipes !== 1 || typeof module.metadata.MoveRecipeBook !== "string") throw Error("The installed move DLL is not a supported recipe module.");
  const {rules,originals:original} = decodeMoveRecipeBook(module.metadata.MoveRecipeBook, MOVE_RECIPE_MANAGED_FIELDS);
  if (!rules.size || rules.size !== original.size) throw Error("Invalid saved move recipes.");
  for (const [id, rule] of rules) {
    if (!Number.isInteger(id) || id <= 0 || id >= c.moveCount || !sameRule(rule, validateMoveRule(rule))) throw Error("Invalid saved move recipe.");
    const snapshot = original.get(id);
    if (!snapshot || Object.keys(snapshot).length !== MOVE_RECIPE_MANAGED_FIELDS.length || MOVE_RECIPE_MANAGED_FIELDS.some(f => !Number.isInteger(snapshot[f]) || snapshot[f] < 0 || snapshot[f] > 65535)) throw Error("Invalid saved native move data.");
  }
  const saved = { rules, originals: original };
  if (!same(writeRpm(moduleFor(c, saved), { ident: "DLXF" }), bytes)) throw Error("The installed move DLL has unrecognized edits.");
  return saved;
}
/** Allow ordinary callers to use this exact transparent adapter; copied bodies must fail. */
export function isVerifiedMoveServiceImport(project: ProjectState, path: string, bytes: Uint8Array, name: string, address: number): boolean {
  if (path !== MOVE_EFFECTS_DLL_PATH || name !== "IsAffectedBySheerForce") return false;
  try {
    const c = context(project, false); stored(c);
    const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    return module.relocations.some(r => r.target.module === "167" && r.target.address === address && r.target.type === "THUMB_BRANCH" && module.symbols[r.sourceSymbolIndex]?.name === "MoveSheerForce");
  } catch { return false; }
}
const sameRule = (a: MoveRuleSet, b: MoveRuleSet) => JSON.stringify(a) === JSON.stringify(b);
function moduleFor(c: Context, saved: Saved): RpmModule {
  if (!saved.rules.size) throw Error("Choose at least one move recipe.");
  const rules = new Map([...saved.rules].sort(([a], [b]) => a - b).map(([id, rule]) => [id, validateMoveRule(rule)]));
  const rpm = structuredClone(template) as unknown as RpmModule; rpm.code = Uint8Array.from(template.code);
  const bssBase = (rpm.code.length + 3) & ~3, bss = rpm.symbols.filter(s => !(s.attributes & 4) && s.address >= bssBase);
  const named = (name: string) => { const symbol = rpm.symbols.find(s => s.name === name); if (!symbol) throw Error(`Missing move runtime symbol ${name}`); return symbol; };
  const append = (bytes: Uint8Array, name: string | null = null, type: "SECTION" | "FUNCTION_THM" = "SECTION") => {
    const at = (rpm.code.length + 3) & ~3, code = new Uint8Array(at + bytes.length); code.set(rpm.code); code.set(bytes, at); rpm.code = code;
    rpm.symbols.push({ name, address: at, size: bytes.length, type, attributes: 0 }); return rpm.symbols.length - 1;
  };
  const api = named("MoveRuleApi").address;
  MOVE_RULE_API.forEach((name, index) => { if (!name) return; const service = c.resolver.resolve(name); checkHook(c, name, service.address, service.code.length); writeU32(rpm.code, api + index * 4, service.address | 1); });
  const copyGateway = (name: string, wrapper: string, index: number) => {
    const service = c.resolver.resolve(name); checkHook(c, name, service.address, service.code.length);
    const copy = append(service.code, null, "FUNCTION_THM"), at = rpm.symbols[copy].address;
    for (const call of signatures[name].calls) {
      const target = battleBranchTarget(service.code, call.offset, service.address);
      if (!c.resolver.matches(call.target, target)) throw Error(`Unrecognized move dependency ${call.target}`);
      rpm.symbols.push({ name: null, address: target, size: 0, type: "FUNCTION_THM", attributes: 4 });
      rpm.relocations.push({ target: { module: "base", address: at + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.length - 1 });
    }
    rpm.relocations.push({ target: { module: "base", address: api + index * 4, type: "OFFSET" }, sourceSymbolIndex: copy }, { target: { module: "167", address: service.address, type: "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named(wrapper)) });
  };
  copyGateway("MoveEvent_AddItem", "MoveDispatch", 32);
  copyGateway("IsAffectedBySheerForce", "MoveSheerForce", 35);
  copyGateway("sub_21AB1BC", "MoveFlinchChance", 36);
  const requiredGetters = [...new Set([...rules.values()].flatMap(r => [...(r.nativeBase ? [r.nativeBase] : []), ...r.effects.filter(e => e.kind === "native").map(e => e.value)]))].sort((a, b) => a - b);
  if (requiredGetters.length > 20) throw Error("Too many native move operations.");
  requiredGetters.forEach((id, index) => {
    const getter = c.getters.get(id); if (!getter) throw Error(`Native move ${id} has unrecognized handlers.`);
    const service = c.resolver.resolve(getter.name); checkHook(c, getter.name, service.address, service.code.length);
    writeU16(rpm.code, named("MoveNativeIds").address + index * 2, id);
    writeU32(rpm.code, named("MoveNativeGetters").address + index * 4, service.address | 1);
  });
  const encoded = encodeMoveRules(rules), data = append(encoded, "MoveRecipeConfig");
  rpm.relocations.push({ target: { module: "base", address: named("MoveRuleData").address, type: "OFFSET" }, sourceSymbolIndex: data });
  for (const [index, [id, rule]] of [...rules].entries()) {
    if(rule.nativeBase && rule.effects.some(e=>["power","hpPower"].includes(e.kind)) && c.getters.get(rule.nativeBase)!.events.some(e=>e.event===0x37)) throw Error("This native base already sets power. Use a recipe power effect instead.");
    const events = new Set(moveRecipeEvents(rule));
    if (rule.nativeBase) c.getters.get(rule.nativeBase)!.events.forEach(e => events.add(e.event));
    const list = checkedMoveEventList(events), bytes = new Uint8Array(list.length * 8);
    list.forEach((event, n) => writeU32(bytes, n * 8, event));
    const table = append(bytes), start = rpm.symbols[table].address;
    list.forEach((event, n) => rpm.relocations.push({ target: { module: "base", address: start + n * 8 + 4, type: "OFFSET" }, sourceSymbolIndex: rpm.symbols.indexOf(named(`MoveEvent_${event.toString(16).padStart(2, "0")}`)) }));
    const entry = rpm.symbols[data].address + 4 + index * 16; writeU16(rpm.code, entry + 2, list.length);
    rpm.relocations.push({ target: { module: "base", address: entry + 8, type: "OFFSET" }, sourceSymbolIndex: table });
    if (id >= c.moveCount) throw Error("The move does not exist in this ROM.");
  }
  const shift = ((rpm.code.length + 3) & ~3) - bssBase; bss.forEach(s => s.address += shift);
  rpm.metadata = { PMCGameID: c.project.session.baseVersion, PMCVersion: "1.0.0", PMCModulePriority: 4, PokewebMoveRecipes: 1, MoveRecipeBook: encodeMoveRecipeBook(rules, saved.originals, MOVE_RECIPE_MANAGED_FIELDS) };
  const serialized = writeRpm(rpm, { ident: "DLXF" });
  if (rpm.code.length + rpm.bssSize > 49152 || serialized.length + rpm.code.length + rpm.bssSize > 96 * 1024) throw Error("Move recipes exceed the shared DLL memory budget.");
  return rpm;
}
export function buildMoveRuleModule(project: ProjectState, rules: ReadonlyMap<number, MoveRuleSet>): RpmModule {
  if(needsAbilityUpgrade(context(project)))throw Error("Update the verified ability runtime before building a move module.");
  const snapshots = new Map<number, Snapshot>();
  for (const [id] of rules) { const raw = decodeRecord(project, "moves", id).raw; if (!raw) throw Error("Move data unavailable."); snapshots.set(id, Object.fromEntries(MOVE_RECIPE_MANAGED_FIELDS.map(f => [f, raw[f] ?? 0]))); }
  return moduleFor(context(project), { rules: new Map(rules), originals: snapshots });
}
export function inspectMoveEffects(project: ProjectState): { editable: boolean; rules: Map<number, MoveRuleSet>; message: string } {
  try { const c = context(project), saved = stored(c); return { editable: true, rules: saved.rules, message: saved.rules.size ? "Custom effects · Shared DLL" : "Native behavior" }; }
  catch (error) { return { editable: false, rules: new Map(), message: error instanceof Error ? error.message : String(error) }; }
}
function writeFields(project: ProjectState, id: number, fields: Snapshot) {
  const record = decodeRecord(project, "moves", id); if (!record.raw) throw Error("Move data unavailable.");
  for (const [key, value] of Object.entries(fields)) record.raw[key] = value;
  markDirty(project, "moves", id);
}
function recipeFields(project: ProjectState, id: number, rule: MoveRuleSet) {
  const raw = decodeRecord(project, "moves", id).raw!;
  const fields: Snapshot = Object.fromEntries(MOVE_RECIPE_MANAGED_FIELDS.map(f => [f, 0]));
  fields.effect_category = raw.category === 0 ? 13 : 0;

  writeFields(project, id, fields);
}
export async function configureMoveRuleSets(project: ProjectState, edits: readonly { moveId: number; rules: MoveRuleSet }[]): Promise<void> {
  if (!edits.length) return;
  const c = context(project), saved = stored(c), seen = new Set<number>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.moveId) || edit.moveId <= 0 || edit.moveId >= project.narcs.moves!.fileCount || seen.has(edit.moveId)) throw Error("Choose unique move IDs present in this ROM.");
    seen.add(edit.moveId);const rules=validateMoveRule(edit.rules);validateMoveRuleCategory(rules,decodeRecord(project,"moves",edit.moveId).raw!.category);saved.rules.set(edit.moveId,rules);
    if (!saved.originals.has(edit.moveId)) { const raw = decodeRecord(project, "moves", edit.moveId).raw!; saved.originals.set(edit.moveId, Object.fromEntries(MOVE_RECIPE_MANAGED_FIELDS.map(f => [f, raw[f] ?? 0]))); }
  }
  moduleFor(c, saved);const upgrade=needsAbilityUpgrade(c);
  await installCodeInjectionPatch(project, async staged => {
    if(upgrade)await upgradeAbilityRuntime(staged);
    stageCodeInjectionDll(staged, "MoveEffects.dll", writeRpm(moduleFor(context(staged), saved), { ident: "DLXF" }));
    for (const edit of edits) recipeFields(staged, edit.moveId, saved.rules.get(edit.moveId)!);
    recordGenericChange(staged, "moves", `Applied recipes to ${edits.length} moves.`, "Move effects");
  });
}
export async function clearMoveRules(project: ProjectState, id: number): Promise<void> {
  const saved = stored(context(project)), original = saved.originals.get(id); if (!original) return;
  saved.rules.delete(id); saved.originals.delete(id);
  await installCodeInjectionPatch(project, staged => {
    if (saved.rules.size) stageCodeInjectionDll(staged, "MoveEffects.dll", writeRpm(moduleFor(context(staged), saved), { ident: "DLXF" }));
    else {
      const c = context(staged), fileId = c.source.ids.get(MOVE_EFFECTS_DLL_PATH);
      if (fileId !== undefined) setRomFileReplacement(staged, fileId, retired);
      else delete ensureFileSystemState(staged).additions![MOVE_EFFECTS_DLL_PATH];
      if (staged.codeInjection?.modules) staged.codeInjection.modules = staged.codeInjection.modules.filter(m => m.path !== MOVE_EFFECTS_DLL_PATH);
    }
    writeFields(staged, id, original);
    recordGenericChange(staged, "moves", `Restored native behavior for move ${id}.`, "Move effects");
  });
}
