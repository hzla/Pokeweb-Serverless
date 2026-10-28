import { NATIVE_ABILITY_PROFILES, linkNativeAbilities, nativeAbilityProfile } from "./abilityNativeRuntime";
import bindings from "../assets/data/abilityBindings.json";
import recipeTemplate from "../assets/data/abilityRuleRuntimeRecipes.json";
import {recipeAbilityEffect} from "./abilityRecipeEffects";
import template from "../assets/data/abilityRuleRuntime.json";
import priorityTemplate from "../assets/data/abilityRuleRuntimePriority.json";
import libraryTemplate from "../assets/data/abilityRuleRuntimeLibrary.json";
import clientTemplate from "../assets/data/abilityRuleRuntimeClient.json";
import { libraryAbilityEffect } from "./abilityLibraryEffects";
import { NintendoDSRom } from "../nds/rom";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { battleRuntimeResolver, battleBranchTarget, BATTLE_RUNTIME_SIGNATURES } from "./battleRuntimeBindings";
import { validateAbilityRule, encodeAbilityRules, EMPTY_ABILITY_RULE, type AbilityRuleSet } from "./abilityRules";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { stageCodeInjectionDll } from "./pmcModel";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { ensureFileSystemState, setRomFileReplacement } from "./fileSystemModel";
import { addTextEntries, getTextBank, updateTextEntry } from "./textModel";
import { recordFieldChange } from "./actionChangelog";
import { isVerifiedBattleCounterImport } from "./battleLogModel";
import { detectSpecifyTrainerNaturesPatch, specifyTrainerNatures } from "./romPatchModel";
import type { ProjectState } from "./projectStore";
export const ABILITY_EFFECTS_DLL_PATH = "patches/AbilityEffects.dll";
const retired = Uint8Array.of(80, 87, 65, 82);
type Source = {
    base: number;
    armBase: number;
    game: string;
    revision: number;
    files: Map<string, Uint8Array>;
    ids: Map<string, number>;
};
const sources = new WeakMap<ProjectState, Source>();
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export function hydrateAbilityEffectsSource(project: ProjectState, rom: NintendoDSRom): void {
    if (project.session.baseRom !== "BW2")
        return;
    const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
    for (let at = 0; at + 32 <= table.length; at += 32)
        if (readU32(table, at) === 167) {
            const files = new Map<string, Uint8Array>(), ids = new Map<string, number>();
            for (const directory of ["patches", "lib"])
                for (const name of rom.filenames.folders.find(([folder]) => folder === directory)?.[1].files ?? []) {
                    if (!name.toLowerCase().endsWith(".dll"))
                        continue;
                    const path = `${directory}/${name}`, id = rom.filenames.idOf(path);
                    if (id !== undefined) {
                        files.set(path, rom.files[id].slice());
                        ids.set(path, id);
                    }
                }
            sources.set(project, { base: readU32(table, at + 4), armBase: rom.arm9RamAddress, game: rom.idCode, revision: rom.data[30], files, ids });
            return;
        }
}
function context(project: ProjectState) {
    if (project.session.baseRom !== "BW2")
        throw new Error("Ability effects require Black 2 or White 2.");
    if (!sources.has(project) && project.originalRomBytes)
        hydrateAbilityEffectsSource(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }));
    const original = sources.get(project);
    if (!original)
        throw new Error("Reload the ROM with Pokémon and Items selected.");
    const source = { ...original }, table = project.patches?.arm9OverlayTable;
    if (table)
        for (let at = 0; at + 32 <= table.length; at += 32)
            if (readU32(table, at) === 167)
                source.base = readU32(table, at + 4);
    if (!["IRDO", "IREO"].includes(source.game) || source.revision !== 0)
        throw new Error("Ability effects currently require a recognized US revision-0 BW2 ROM.");
    const overlay = project.overlays[167];
    if (!overlay?.length)
        throw new Error("Reload the ROM with Pokémon selected to load the battle overlay.");
    const resolver = battleRuntimeResolver(overlay, source.base, project.arm9, source.armBase);
    const dispatcher = resolver.resolve("AbilityEvent_AddItem");
    const pointers = bindings.tableRefs.map(ref => readU32(dispatcher.code, ref.offset) - ref.column);
    if (pointers[0] !== pointers[1])
        throw new Error("Unrecognized native ability assignment table.");
    const at = pointers[0] - source.base;
    if (at < 0 || at + bindings.rows.length * 8 > overlay.length || !bindings.rows.every((id, i) => readU32(overlay, at + i * 8) === id))
        throw new Error("Unrecognized native ability assignment table.");
    const availableNative = new Set<number>();
    const fromHex = (s: string) => Uint8Array.from(s.match(/../gu) ?? [], v => Number.parseInt(v, 16));
    for (const profile of NATIVE_ABILITY_PROFILES) {
        const index = bindings.rows.indexOf(profile.id), factory = (readU32(overlay, at + index * 8 + 4) & ~1) - source.base;
        const expected = fromHex(profile.factoryHex), mask = fromHex(profile.factoryMask);
        if (factory < 0 || factory + expected.length > overlay.length || !expected.every((v, i) => (overlay[factory + i] & mask[i]) === (v & mask[i])))
            continue;
        if (!(profile.factoryCalls??[]).every(call => resolver.matches(call.target, battleBranchTarget(overlay, factory + call.offset, source.base)))) continue;
        const table = readU32(overlay, factory + profile.tableRefOffset) - source.base;
        if (table < 0 || table + profile.events.length * 8 > overlay.length)
            continue;
        if (!profile.events.every((e, i) => readU32(overlay, table + i * 8) === e.event && resolver.matches(e.handler, readU32(overlay, table + i * 8 + 4) & ~1)))
            continue;
        availableNative.add(profile.id);
        profile.events.forEach((e, i) => resolver.seed(e.handler, readU32(overlay, table + i * 8 + 4) & ~1));
    }
    const files = new Map(source.files);
    for (const [path, id] of source.ids)
        if (project.fileSystem?.replacements?.[id])
            files.set(path, project.fileSystem.replacements[id]);
    for (const [path, bytes] of Object.entries(project.fileSystem?.additions ?? {}))
        if (path.toLowerCase().endsWith(".dll"))
            files.set(path, bytes);
    return { project, source, overlay, resolver, dispatcher, files, availableNative };
}
type Context = ReturnType<typeof context>;
function assertUnhooked(c: Context, name: string, address: number, size: number, copied = false): void {
    const module = BATTLE_RUNTIME_SIGNATURES[name].module;
    for (const [path, bytes] of c.files) {
        if (path === ABILITY_EFFECTS_DLL_PATH)
            continue;
        let rpm: RpmModule;
        try {
            rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
        }
        catch {
            continue;
        }
        for (const r of rpm.relocations) {
            if (r.target.module !== (module === "ARM9" ? "0" : module))
                continue;
            const start = r.target.address & ~1, count = r.target.type === "FULL_COPY" ? rpm.symbols[r.sourceSymbolIndex]?.size ?? 0 : r.target.type === "OFFSET" ? 4 : 16;
            if (start < address + size && start + count > address) {
                // Import the installed RPC's transparent ordinary-call path. A
                // copied body would bypass it; another hook would overwrite it.
                if (!copied && name === "IsFainted" && module === "167" && start === address
                    && r.target.type === "THUMB_BRANCH"
                    && isVerifiedBattleCounterImport(c.project.session.baseVersion, path, bytes, address)) continue;
                throw new Error(`Conflicting ability service hook: ${path} (${name}).`);
            }
        }
    }
}
export const ABILITY_RULE_API = ["BattleEventVar_GetValue", "BattleEventVar_MulValue", "GetBattleMon", "GetBattleMonStat", "GetPokeType", "PokeTypePair_IsMatch", "ServerEvent_GetWeather", "BtlServerFlow_IsSimulating", "BtlServerFlow_CheckMatchup", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleHandler_StrSetup", "BattleHandler_AddArg", "BattleEventItem_GetSubID", "BattleEvent_AddItem", "GetMonID", "RawBattleMonStat", "PML_MoveGetCategory", null, null, "BattleHandler_PushRun", null, null, "IsStatChangeValid", "BtlCalc_MakeStatusCondition", "MakeConditionBadlyPoisoned", "BattleEventVar_GetValueIfExist", "RollEffectChance", "BattleEventVar_RewriteValue", "GetBattleMonSpecies", "CheckCondition", "getMoveFlag", "BattleEvent_CheckSkip"] as const;
function moduleFor(c: Context, entries: ReadonlyMap<number, AbilityRuleSet>, previewHook = false, clientHooks = true): RpmModule {
    for (const rule of entries.values())
        for (const e of rule.effects) {
            const p = nativeAbilityProfile(e.kind);
            if (p && !c.availableNative.has(p.id))
                throw new Error(`Native ability ${p.id} has unrecognized or modified handlers.`);
        }
    const priority = [...entries.values()].some(r=>r.effects.some(e=>nativeAbilityProfile(e.kind)?.priority===4));
    const library = [...entries.values()].some(r=>r.effects.some(e=>libraryAbilityEffect(e.kind)));
    const recipes=[...entries.values()].some(r=>r.effects.some(e=>recipeAbilityEffect(e.kind)));
    const traps = clientHooks && [...entries.values()].some(r => r.effects.some(e => e.kind === "nativeAbility:42"));
    const selectedTemplate = traps ? clientTemplate : recipes ? recipeTemplate : library ? libraryTemplate : priority ? priorityTemplate : template;
    const rpm = structuredClone(selectedTemplate) as unknown as RpmModule;
    rpm.code = Uint8Array.from(selectedTemplate.code);
    const bssBase = (rpm.code.length + 3) & ~3, bss = rpm.symbols.filter(s => !(s.attributes & 4) && s.address >= bssBase);
    const named = (name: string) => { const s = rpm.symbols.find(s => s.name === name); if (!s)
        throw new Error(`Missing ability runtime symbol: ${name}`); return s; };
    const append = (code: Uint8Array, type: "FUNCTION_THM" | "SECTION") => { const at = (rpm.code.length + 3) & ~3, expanded = new Uint8Array(at + code.length); expanded.set(rpm.code); expanded.set(code, at); rpm.code = expanded; rpm.symbols.push({ name: null, address: at, size: code.length, type, attributes: 0 }); return rpm.symbols.length - 1; };
    const api = named("AbilityRuleApi").address;
    ABILITY_RULE_API.forEach((name, i) => { if (!name)
        return; const { address, code } = c.resolver.resolve(name); assertUnhooked(c, name, address, code.length); writeU32(rpm.code, api + i * 4, address | 1); });
    if(library||recipes)for(const[index,name]of [[34,"BtlCalc_GetEffectivenessCategory"],[35,"PML_MoveGetParam"]] as const){const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,api+index*4,service.address|1);}
    for (const [name, index, wrapper] of [["AbilityEvent_AddItem", 18, "AbilityDispatch"], ["HandlerMoldBreakerSkipCheck", 19, "AbilityMoldSkip"]] as const) {
        const { address, code } = c.resolver.resolve(name);
        assertUnhooked(c, name, address, code.length, true);
        const symbol = append(code, "FUNCTION_THM"), at = rpm.symbols[symbol].address;
        rpm.relocations.push({ target: { module: "base", address: api + index * 4, type: "OFFSET" }, sourceSymbolIndex: symbol }, { target: { module: "167", address, type: name === "HandlerMoldBreakerSkipCheck" && !previewHook ? "THUMB_BRANCH_SAFESTACK" : "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named(wrapper)) });
        for (const call of BATTLE_RUNTIME_SIGNATURES[name].calls) {
            const target = battleBranchTarget(code, call.offset, address);
            if (!c.resolver.matches(call.target, target))
                throw new Error(`Unrecognized ability dependency: ${call.target}`);
            assertUnhooked(c, call.target, target, BATTLE_RUNTIME_SIGNATURES[call.target].hex.length / 2);
            rpm.symbols.push({ name: null, address: target, size: 0, type: "FUNCTION_THM", attributes: 4 });
            rpm.relocations.push({ target: { module: "base", address: at + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.length - 1 });
        }
    }
    if(priority){
        const remove=c.resolver.resolve("AbilityEvent_RemoveItem"),swap=c.resolver.resolve("AbilityEvent_Swap");
        assertUnhooked(c,"AbilityEvent_RemoveItem",remove.address,remove.code.length);assertUnhooked(c,"AbilityEvent_Swap",swap.address,swap.code.length,true);
        writeU32(rpm.code,api+33*4,remove.address|1);
        rpm.relocations.push({target:{module:"167",address:swap.address,type:"THUMB_BRANCH"},sourceSymbolIndex:rpm.symbols.indexOf(named("AbilitySwap"))});
    }
    if(recipes){
        const recipeApi=named("AbilityRecipeApi").address;
        const services=[null,null,null,null,null,null,"BattleEvent_CallHandlers","BattleEventVar_Push","BattleEventVar_Pop","BattleEventVar_SetConstValue","IsAllyMonID","BtlServerFlow_IsMonInBattle","BtlServerFlow_IsSideEffectSet","GetSideFromMonID","PML_ItemIsBerry","CommonAbilityCureStatusCore","GetFieldWeather","MakeConditionPermanentTurnsParam","GetBattleMonHeldItem","BtlServerFlow_IsTargetOutOfRange","IsSubstituteActive","GetAdditionalConditionFlag",null];
        services.forEach((name,i)=>{if(!name)return;const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,recipeApi+i*4,service.address|1);});
        for(const[name,index,wrapper]of [["BattleEvent_CallHandlersCore",22,"AbilityRecipeHandlers"],["BattleEvent_Init",0,"AbilityRecipeInit"],["ServerEvent_GetMoveParam",1,"AbilityRecipeMoveParam"],["ServerEvent_CheckCritical",2,"AbilityRecipeCritical"],["ServerControl_CheckMoveEffectiveness",3,"AbilityRecipeEffectiveness"],["ServerControl_ChangeHeldItem",4,"AbilityRecipeChangeItem"],["BattleHandler_ForceUseItem",5,"AbilityRecipeForceItem"]]as const){
            const{address,code}=c.resolver.resolve(name);assertUnhooked(c,name,address,code.length,true);const symbol=append(code,"FUNCTION_THM"),at=rpm.symbols[symbol].address;
            rpm.relocations.push({target:{module:"base",address:recipeApi+index*4,type:"OFFSET"},sourceSymbolIndex:symbol},{target:{module:"167",address,type:name==="ServerControl_CheckMoveEffectiveness"?"THUMB_BRANCH_SAFESTACK":"THUMB_BRANCH"},sourceSymbolIndex:rpm.symbols.indexOf(named(wrapper))});
            for(const call of BATTLE_RUNTIME_SIGNATURES[name].calls){
                const target=battleBranchTarget(code,call.offset,address);if(!c.resolver.matches(call.target,target))throw new Error(`Unrecognized recipe dependency: ${call.target}`);
                assertUnhooked(c,call.target,target,BATTLE_RUNTIME_SIGNATURES[call.target].hex.length/2);
                let targetSymbol:number;
                if(name==="ServerEvent_CheckCritical"&&call.target==="BattleEvent_CallHandlers")targetSymbol=rpm.symbols.indexOf(named("AbilityRecipeCriticalHandlers"));
                else{rpm.symbols.push({name:null,address:target,size:0,type:BATTLE_RUNTIME_SIGNATURES[call.target].thumb===false?"FUNCTION_ARM":"FUNCTION_THM",attributes:4});targetSymbol=rpm.symbols.length-1;}
                rpm.relocations.push({target:{module:"base",address:at+call.offset,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:targetSymbol});
            }
        }
    }
    const data = append(encodeAbilityRules(entries), "SECTION");
    rpm.relocations.push({ target: { module: "base", address: named("AbilityRuleData").address, type: "OFFSET" }, sourceSymbolIndex: data });
    linkNativeAbilities(rpm, entries, rpm.symbols[data].address, c.resolver.resolve, (name, address, size, copied) => assertUnhooked(c, name, address, size, copied));
    if (traps) {
        const original = c.resolver.resolve("IsMonTrapped");
        assertUnhooked(c, "IsMonTrapped", original.address, original.code.length, true);
        const prefix = [0xf0, 0xb5, 0x85, 0xb0, 0x0e, 0x1c, 0x05, 0x1c];
        if (!prefix.every((v, i) => original.code[i] === v)) throw new Error("Unrecognized client trapping prologue.");
        // Run the untouched native remainder at its original address. Its first
        // eight bytes have no PC-relative instructions; r4 is assigned locally.
        const gateway = new Uint8Array(16); gateway.set(original.code.subarray(0, 8));
        writeU16(gateway, 8, 0x4c00); writeU16(gateway, 10, 0x4720); writeU32(gateway, 12, (original.address + 8) | 1);
        const symbol = append(gateway, "FUNCTION_THM"), clientApi = named("AbilityClientApi").address;
        rpm.relocations.push({ target: { module: "base", address: clientApi, type: "OFFSET" }, sourceSymbolIndex: symbol },
            { target: { module: "167", address: original.address, type: "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named("AbilityClientTrapped")) });
        for (const [i, name] of ["MonIDToBattlePos", "ExpandPosFlagsToMonIDs", "GetPokeParam", "DoesMonHaveType"].entries()) {
            const service = c.resolver.resolve(name); assertUnhooked(c, name, service.address, service.code.length);
            writeU32(rpm.code, clientApi + (i + 1) * 4, service.address | 1);
        }
        const table = named("AbilityClientTrapTypes").address;
        for (const [id, rule] of entries) {
            const effect = rule.effects.find(e => e.kind === "nativeAbility:42");
            if (effect) rpm.code[table + id] = (effect.parameters?.trapType ?? 8) + 1;
        }
    }
    const shift = ((rpm.code.length + 3) & ~3) - bssBase;
    bss.forEach(s => s.address += shift);
    rpm.metadata = { PMCGameID: c.project.session.baseVersion, PMCVersion: "1.0.0", PMCModulePriority: 4, PokewebAbilityEffects: "rules", PokewebAbilityRules: JSON.stringify([...entries].sort(([a], [b]) => a - b)) };
    if (traps) rpm.metadata.PokewebAbilityClientTraps = 1;
    const serialized = writeRpm(rpm, { ident: "DLXF" });
    if (rpm.code.length + rpm.bssSize > 65536 || serialized.length + rpm.code.length + rpm.bssSize > 112 * 1024)
        throw new Error("Ability effects exceed the shared DLL memory budget. Reduce rule complexity.");
    return rpm;
}
const verified = new WeakMap<ProjectState, {
    overlay: Uint8Array;
    arm9: Uint8Array;
    bytes: Uint8Array;
    files: Map<string, Uint8Array>;
    base: number;
    rules: Map<number, AbilityRuleSet>;
}>();
function readRules(c: Context): Map<number, AbilityRuleSet> {
    const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
    if (!bytes || same(bytes, retired))
        return new Map();
    const cached = verified.get(c.project);
    if (cached && cached.base === c.source.base && same(cached.overlay, c.overlay) && same(cached.arm9, c.project.arm9) && same(cached.bytes, bytes) && cached.files.size === c.files.size && [...c.files].every(([p, b]) => cached.files.has(p) && same(cached.files.get(p)!, b)))
        return structuredClone(cached.rules);
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    if (rpm.metadata.PokewebAbilityEffects !== "rules" || rpm.metadata.PMCVersion !== "1.0.0" || typeof rpm.metadata.PokewebAbilityRules !== "string")
        throw new Error("Unrecognized shared ability effects DLL.");
    const entries: unknown = JSON.parse(rpm.metadata.PokewebAbilityRules), rules = new Map<number, AbilityRuleSet>();
    if (!Array.isArray(entries) || !entries.length || entries.length > 255)
        throw new Error("Invalid ability registry.");
    for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 1 || entry[0] > 255 || rules.has(entry[0]))
            throw new Error("Invalid ability registry entry.");
        rules.set(entry[0], validateAbilityRule(entry[1]));
    }
    const clientHooks = rpm.metadata.PokewebAbilityClientTraps === 1;
    if (!same(bytes, writeRpm(moduleFor(c, rules, false, clientHooks), { ident: "DLXF" })) && !same(bytes, writeRpm(moduleFor(c, rules, true, clientHooks), { ident: "DLXF" })))
        throw new Error("The shared ability effects DLL has been modified.");
    verified.set(c.project, { overlay: c.overlay.slice(), arm9: c.project.arm9.slice(), base: c.source.base, bytes: bytes.slice(), files: new Map([...c.files].map(([p, b]) => [p, b.slice()])), rules: structuredClone(rules) });
    return rules;
}
export function inspectAbilityEffects(project: ProjectState): {
    editable: boolean;
    message: string;
    rules: Map<number, AbilityRuleSet>;
} {
    try {
        const c = context(project), rules = readRules(c);
        if (!rules.size)
            moduleFor(c, new Map([[1, validateAbilityRule(EMPTY_ABILITY_RULE)]]));
        return { editable: true, message: rules.size ? "Shared DLL verified" : "Native ability runtime verified", rules };
    }
    catch (error) {
        return { editable: false, message: error instanceof Error ? error.message : String(error), rules: new Map() };
    }
}
/** Native item queries may import the canonical ability-aware client service. */
export function isVerifiedAbilityClientTrapImport(project: ProjectState, path: string, address: number, size: number): boolean {
    if (path !== ABILITY_EFFECTS_DLL_PATH) return false;
    try {
        const c = context(project), bytes = c.files.get(path);
        if (!bytes || parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata.PokewebAbilityClientTraps !== 1) return false;
        const service = c.resolver.resolve("IsMonTrapped");
        return service.address === address && service.code.length === size && readRules(c).size > 0;
    } catch { return false; }
}
export function buildAbilityRuleModule(project: ProjectState, entries: ReadonlyMap<number, AbilityRuleSet>): RpmModule {
    const checked = new Map([...entries].map(([id, r]) => [id, validateAbilityRule(r)]));
    if (!checked.size)
        throw new Error("Choose an ability effect.");
    return moduleFor(context(project), checked);
}
function setName(project: ProjectState, id: number, name: string): void {
    for (const bankId of [487, 374, 375]) {
        const bank = getTextBank(project, "message_texts", bankId);
        if (!bank.length)
            throw new Error("Ability name text banks are unavailable.");
        if (bank.length <= id)
            addTextEntries(project, "message_texts", bankId, id + 1 - bank.length);
        if (bankId !== 375 || !bank[id]?.[1])
            updateTextEntry(project, "message_texts", bankId, id, bankId === 375 ? "Custom battle ability." : name);
    }
    for (const record of project.narcs.personal?.records.values() ?? []) {
        if (!record.raw || !record.readable) continue;
        for (const [field, value] of Object.entries(record.raw)) {
            if (/^ability_\d+$/u.test(field) && value === id) record.readable[field] = name;
        }
    }
}
export type AbilityEdit = {
    abilityId: number;
    rules: AbilityRuleSet;
    name?: string;
};
export async function configureAbilityRuleSets(project: ProjectState, edits: readonly AbilityEdit[]): Promise<void> {
    if (!edits.length)
        return;
    const c = context(project), rules = readRules(c), seen = new Set<number>();
    const checked = edits.map(edit => {
        const id = edit.abilityId;
        if (!Number.isInteger(id) || id < 1 || id > 255 || seen.has(id))
            throw new Error("Ability IDs must be unique and between 1 and 255.");
        seen.add(id);
        const name = edit.name?.trim();
        if (edit.name !== undefined && (!name || name.length > 15 || /[\\\r\n\x00-\x1f]/u.test(name)))
            throw new Error("Use an ability name of 1–15 characters without text controls.");
        if (!name && !project.texts.banks.abilities?.[id])
            throw new Error("Give the new ability a name.");
        const canonical = validateAbilityRule(edit.rules);
        rules.set(id, canonical);
        return { ...edit, name, rules: canonical };
    });
    moduleFor(c, rules);
    await installCodeInjectionPatch(project, async staged => {
        // The legacy inline helper shares memory with the live DLL loader.
        // Preserve the installed feature through its verified PMC migration.
        if (detectSpecifyTrainerNaturesPatch(staged) === "legacy") await specifyTrainerNatures(staged);
        stageCodeInjectionDll(staged, "AbilityEffects.dll", writeRpm(moduleFor(context(staged), rules), { ident: "DLXF" }));
        for (const edit of checked) {
            if (edit.name)
                setName(staged, edit.abilityId, edit.name);
            recordFieldChange(staged, "message_texts", edit.name ?? `Ability ${edit.abilityId}`, "Battle effects", "Previous effect", JSON.stringify(edit.rules), { key: `ability-rules:${edit.abilityId}` });
        }
    });
    verified.delete(project);
}
export function nextCustomAbilityId(project: ProjectState): number | undefined {
    const names = project.texts.banks.abilities ?? [];
    let last = 164;
    for (let id = 1; id <= 255; ++id)
        if (names[id]?.trim())
            last = id;
    return last < 255 ? last + 1 : undefined;
}
export async function createCustomAbility(project: ProjectState, name: string, rules: AbilityRuleSet = EMPTY_ABILITY_RULE): Promise<number> {
    const id = nextCustomAbilityId(project);
    if (id === undefined)
        throw new Error("All 255 ability IDs are in use.");
    await configureAbilityRuleSets(project, [{ abilityId: id, name, rules }]);
    return id;
}
export function clearAbilityRules(project: ProjectState, id: number): void {
    if (!Number.isInteger(id) || id < 1 || id > 255)
        throw new Error("Invalid ability ID.");
    const c = context(project), rules = readRules(c);
    if (!rules.delete(id))
        return;
    if (rules.size)
        stageCodeInjectionDll(project, "AbilityEffects.dll", writeRpm(moduleFor(c, rules), { ident: "DLXF" }));
    else {
        const state = ensureFileSystemState(project);
        delete state.additions![ABILITY_EFFECTS_DLL_PATH];
        const fileId = c.source.ids.get(ABILITY_EFFECTS_DLL_PATH);
        if (fileId !== undefined)
            setRomFileReplacement(project, fileId, retired.slice());
        if (project.codeInjection?.modules)
            project.codeInjection.modules = project.codeInjection.modules.filter(m => m.path !== ABILITY_EFFECTS_DLL_PATH);
    }
    verified.delete(project);
}
