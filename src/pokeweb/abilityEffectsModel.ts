import { estimateRpmMemory } from "./rpmMemory";
import { isVerifiedMoveFieldSwitchImport, isVerifiedMoveServiceImport } from "./moveEffectsModel";
import { chainAbilityMoveParam } from "./battleMoveParamChain";
import { normalizeAbilityDescription, updateAbilityDescription } from "./abilityTextModel";
import { isVerifiedItemMoveParamFollower, prepareItemMoveParamForAbility } from "./itemEffectsModel";
import { linkNativeAbilities, nativeAbilityProfile } from "./abilityNativeRuntime";
import blackBindings from "../assets/data/abilityBindingsB1.json";
import whiteBindings from "../assets/data/abilityBindingsW1.json";
import optimizedTemplates from "../assets/data/abilityRuleRuntimeOptimized.json";
import classTemplates from "../assets/data/abilityRuleRuntimeMoveClasses.json";
import messageTemplates from "../assets/data/abilityRuleRuntimeMessages.json";
import customFlagTemplates from "../assets/data/abilityRuleRuntimeCustomFlags.json";
import statSourceTemplates from "../assets/data/abilityRuleRuntimeStatSource.json";
import compactTemplates from "../assets/data/abilityRuleRuntimeCompact.json";
import environmentTemplates from "../assets/data/abilityRuleRuntimeEnvironment.json";
import environmentBindings from "../assets/data/abilityEnvironmentBindings.json";
import strikeTemplates from "../assets/data/abilityRuleRuntimeStrikes.json";
import protectTemplates from "../assets/data/abilityRuleRuntimeProtect.json";
import statusExtensionTemplates from "../assets/data/abilityRuleRuntimeStatusExtensions.json";
import statusBindings from "../assets/data/abilityStatusBindings.json";
import weatherMoveTemplates from "../assets/data/abilityRuleRuntimeWeatherMoves.json";
import strikeBindings from "../assets/data/abilityStrikeBindings.json";
import nativeFlagTemplates from "../assets/data/abilityRuleRuntimeNativeFlags.json";
import { vanillaMoveFlagIndex } from "./abilityMoveFilters";
import { abilityWorkSlots, optimizeAbilityRule, abilityExecutionSignature } from "./abilityRecipeOptimization";
import actionResultTemplates from "../assets/data/abilityRuleRuntimeActionResults.json";
import { customMoveFlagId, customMoveFlagName, emptyCustomMoveFlags, encodeCustomMoveFlags, MAX_CUSTOM_MOVE_FLAGS, validateCustomMoveFlags, type CustomMoveFlagRegistry } from "./customMoveFlags";
import { defaultMoveDllFlags, moveDllFlags, validateMoveClassOverrides, encodeMoveClassOverrides, expandedMoveDllDefaults, mergedMoveClassData } from "./abilityMoveClasses";
import { ensureAbilityBlockMessages, ensureAbilityPresentationMessages } from "./abilityBattleMessages";
import { abilityRuleEvents } from "./abilityEvents";
import type { NativeAbilityProfile } from "./abilityNativeRuntime";
import type { BattleRuntimeSignature } from "./battleRuntimeBindings";
import bindings from "../assets/data/abilityBindings.json";
import recipeTemplate from "../assets/data/abilityRuleRuntimeRecipes.json";
import {recipeAbilityEffect} from "./abilityRecipeEffects";
import template from "../assets/data/abilityRuleRuntime.json";
import priorityTemplate from "../assets/data/abilityRuleRuntimePriority.json";
import libraryTemplate from "../assets/data/abilityRuleRuntimeLibrary.json";
import clientTemplate from "../assets/data/abilityRuleRuntimeClient.json";
import groupedTemplate from "../assets/data/abilityRuleRuntimeGrouped.json";
import groupedPriorityTemplate from "../assets/data/abilityRuleRuntimePriorityGrouped.json";
import groupedLibraryTemplate from "../assets/data/abilityRuleRuntimeLibraryGrouped.json";
import groupedRecipeTemplate from "../assets/data/abilityRuleRuntimeRecipesGrouped.json";
import groupedClientTemplate from "../assets/data/abilityRuleRuntimeClientGrouped.json";
import scopedRecipeTemplate from "../assets/data/abilityRuleRuntimeRecipesScoped.json";
import scopedClientTemplate from "../assets/data/abilityRuleRuntimeClientScoped.json";
import actionRecipeTemplate from "../assets/data/abilityRuleRuntimeRecipesActions.json";
import actionClientTemplate from "../assets/data/abilityRuleRuntimeClientActions.json";
import {needsAbilityActionRuntime} from "./abilityActionEffects";
import {SCOPED_ABILITY_EFFECTS} from "./abilityScopedEffects";
import weatherRecipeTemplate from "../assets/data/abilityRuleRuntimeRecipesWeather.json";
import weatherClientTemplate from "../assets/data/abilityRuleRuntimeClientWeather.json";
import { libraryAbilityEffect } from "./abilityLibraryEffects";
import { NintendoDSRom } from "../nds/rom";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { battleRuntimeResolver, battleBranchTarget, BATTLE_RUNTIME_SIGNATURES } from "./battleRuntimeBindings";
import { validateAbilityRule, encodeAbilityRules, EMPTY_ABILITY_RULE, type AbilityRuleSet } from "./abilityRules";
import { installCodeInjectionPatch, withProjectMutationLock } from "./codeInjectionInstall";
import { stageCodeInjectionDll } from "./pmcModel";
import { parseRpm, writeRpm, stripRpmPrivateSymbolNames, type RpmModule } from "./rpm";
import { encodeAbilityRecipeBook, decodeAbilityRecipeBook } from "./abilityRecipeBook";
import { ensureFileSystemState, setRomFileReplacement } from "./fileSystemModel";
import { addTextEntries, getTextBank, updateTextEntry } from "./textModel";
import { recordFieldChange } from "./actionChangelog";
import { isVerifiedBattleCounterImport } from "./battleLogModel";
import { detectSpecifyTrainerNaturesPatch, specifyTrainerNatures } from "./romPatchModel";
import type { ProjectState } from "./projectStore";
export const ABILITY_EFFECTS_DLL_PATH = "patches/AbilityEffects.dll";
export const CURRENT_ABILITY_RUNTIME_VERSION = 15;
const retired = Uint8Array.of(80, 87, 65, 82);
const optimizedRuntime = new Map<unknown, unknown>([
    [template, optimizedTemplates["abilityRuleRuntime.json"]],
    [priorityTemplate, optimizedTemplates["abilityRuleRuntimePriority.json"]],
    [libraryTemplate, optimizedTemplates["abilityRuleRuntimeLibrary.json"]],
    [recipeTemplate, optimizedTemplates["abilityRuleRuntimeRecipes.json"]],
    [clientTemplate, optimizedTemplates["abilityRuleRuntimeClient.json"]],
    [groupedTemplate, optimizedTemplates["abilityRuleRuntimeGrouped.json"]],
    [groupedPriorityTemplate, optimizedTemplates["abilityRuleRuntimePriorityGrouped.json"]],
    [groupedLibraryTemplate, optimizedTemplates["abilityRuleRuntimeLibraryGrouped.json"]],
    [groupedRecipeTemplate, optimizedTemplates["abilityRuleRuntimeRecipesGrouped.json"]],
    [groupedClientTemplate, optimizedTemplates["abilityRuleRuntimeClientGrouped.json"]],
    [weatherRecipeTemplate, optimizedTemplates["abilityRuleRuntimeRecipesWeather.json"]],
    [weatherClientTemplate, optimizedTemplates["abilityRuleRuntimeClientWeather.json"]],
    [scopedRecipeTemplate, optimizedTemplates["abilityRuleRuntimeRecipesScoped.json"]],
    [scopedClientTemplate, optimizedTemplates["abilityRuleRuntimeClientScoped.json"]],
    [actionRecipeTemplate, optimizedTemplates["abilityRuleRuntimeRecipesActions.json"]],
    [actionClientTemplate, optimizedTemplates["abilityRuleRuntimeClientActions.json"]],
]);
const classRuntime = new Map<unknown, unknown>([
    [groupedTemplate, classTemplates["abilityRuleRuntimeGrouped.json"]],
    [groupedPriorityTemplate, classTemplates["abilityRuleRuntimePriorityGrouped.json"]],
    [groupedLibraryTemplate, classTemplates["abilityRuleRuntimeLibraryGrouped.json"]],
    [groupedRecipeTemplate, classTemplates["abilityRuleRuntimeRecipesGrouped.json"]],
    [groupedClientTemplate, classTemplates["abilityRuleRuntimeClientGrouped.json"]],
    [weatherRecipeTemplate, classTemplates["abilityRuleRuntimeRecipesWeather.json"]],
    [weatherClientTemplate, classTemplates["abilityRuleRuntimeClientWeather.json"]],
    [scopedRecipeTemplate, classTemplates["abilityRuleRuntimeRecipesScoped.json"]],
    [scopedClientTemplate, classTemplates["abilityRuleRuntimeClientScoped.json"]],
    [actionRecipeTemplate, classTemplates["abilityRuleRuntimeRecipesActions.json"]],
    [actionClientTemplate, classTemplates["abilityRuleRuntimeClientActions.json"]],
]);
const messageRuntime = new Map<unknown, unknown>([
    [groupedTemplate, messageTemplates["abilityRuleRuntimeGrouped.json"]],
    [groupedPriorityTemplate, messageTemplates["abilityRuleRuntimePriorityGrouped.json"]],
    [groupedLibraryTemplate, messageTemplates["abilityRuleRuntimeLibraryGrouped.json"]],
    [groupedRecipeTemplate, messageTemplates["abilityRuleRuntimeRecipesGrouped.json"]],
    [groupedClientTemplate, messageTemplates["abilityRuleRuntimeClientGrouped.json"]],
    [weatherRecipeTemplate, messageTemplates["abilityRuleRuntimeRecipesWeather.json"]],
    [weatherClientTemplate, messageTemplates["abilityRuleRuntimeClientWeather.json"]],
    [scopedRecipeTemplate, messageTemplates["abilityRuleRuntimeRecipesScoped.json"]],
    [scopedClientTemplate, messageTemplates["abilityRuleRuntimeClientScoped.json"]],
    [actionRecipeTemplate, messageTemplates["abilityRuleRuntimeRecipesActions.json"]],
    [actionClientTemplate, messageTemplates["abilityRuleRuntimeClientActions.json"]],
]);
const customFlagRuntime = new Map<unknown, unknown>([
    [groupedTemplate, customFlagTemplates["abilityRuleRuntimeGrouped.json"]],
    [groupedPriorityTemplate, customFlagTemplates["abilityRuleRuntimePriorityGrouped.json"]],
    [groupedLibraryTemplate, customFlagTemplates["abilityRuleRuntimeLibraryGrouped.json"]],
    [groupedRecipeTemplate, customFlagTemplates["abilityRuleRuntimeRecipesGrouped.json"]],
    [groupedClientTemplate, customFlagTemplates["abilityRuleRuntimeClientGrouped.json"]],
    [weatherRecipeTemplate, customFlagTemplates["abilityRuleRuntimeRecipesWeather.json"]],
    [weatherClientTemplate, customFlagTemplates["abilityRuleRuntimeClientWeather.json"]],
    [scopedRecipeTemplate, customFlagTemplates["abilityRuleRuntimeRecipesScoped.json"]],
    [scopedClientTemplate, customFlagTemplates["abilityRuleRuntimeClientScoped.json"]],
    [actionRecipeTemplate, customFlagTemplates["abilityRuleRuntimeRecipesActions.json"]],
    [actionClientTemplate, customFlagTemplates["abilityRuleRuntimeClientActions.json"]],
]);
const actionResultRuntime = new Map<unknown, unknown>([
    [groupedTemplate, actionResultTemplates["abilityRuleRuntimeGrouped.json"]],
    [groupedPriorityTemplate, actionResultTemplates["abilityRuleRuntimePriorityGrouped.json"]],
    [groupedLibraryTemplate, actionResultTemplates["abilityRuleRuntimeLibraryGrouped.json"]],
    [groupedRecipeTemplate, actionResultTemplates["abilityRuleRuntimeRecipesGrouped.json"]],
    [groupedClientTemplate, actionResultTemplates["abilityRuleRuntimeClientGrouped.json"]],
    [weatherRecipeTemplate, actionResultTemplates["abilityRuleRuntimeRecipesWeather.json"]],
    [weatherClientTemplate, actionResultTemplates["abilityRuleRuntimeClientWeather.json"]],
    [scopedRecipeTemplate, actionResultTemplates["abilityRuleRuntimeRecipesScoped.json"]],
    [scopedClientTemplate, actionResultTemplates["abilityRuleRuntimeClientScoped.json"]],
    [actionRecipeTemplate, actionResultTemplates["abilityRuleRuntimeRecipesActions.json"]],
    [actionClientTemplate, actionResultTemplates["abilityRuleRuntimeClientActions.json"]],
]);
const statSourceRuntime = new Map<unknown, unknown>([
    [groupedTemplate, statSourceTemplates["abilityRuleRuntimeGrouped.json"]],
    [groupedPriorityTemplate, statSourceTemplates["abilityRuleRuntimePriorityGrouped.json"]],
    [groupedLibraryTemplate, statSourceTemplates["abilityRuleRuntimeLibraryGrouped.json"]],
    [groupedRecipeTemplate, statSourceTemplates["abilityRuleRuntimeRecipesGrouped.json"]],
    [groupedClientTemplate, statSourceTemplates["abilityRuleRuntimeClientGrouped.json"]],
    [weatherRecipeTemplate, statSourceTemplates["abilityRuleRuntimeRecipesWeather.json"]],
    [weatherClientTemplate, statSourceTemplates["abilityRuleRuntimeClientWeather.json"]],
    [scopedRecipeTemplate, statSourceTemplates["abilityRuleRuntimeRecipesScoped.json"]],
    [scopedClientTemplate, statSourceTemplates["abilityRuleRuntimeClientScoped.json"]],
    [actionRecipeTemplate, statSourceTemplates["abilityRuleRuntimeRecipesActions.json"]],
    [actionClientTemplate, statSourceTemplates["abilityRuleRuntimeClientActions.json"]],
]);
type Source = {
    base: number;
    armBase: number;
    game: string;
    revision: number;
    files: Map<string, Uint8Array>;
    ids: Map<string, number>;
};
const sources = new WeakMap<ProjectState, Source>();
export function supportsAbilityEditor(project: ProjectState): boolean {
    return project.session.baseRom === "BW2" || project.session.baseRom === "BW" && ["B", "W"].includes(project.session.baseVersion);
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export function hydrateAbilityEffectsSource(project: ProjectState, rom: NintendoDSRom): void {
    if (!supportsAbilityEditor(project))
        return;
    const overlayId = project.session.baseRom === "BW" ? 93 : 167;
    const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
    for (let at = 0; at + 32 <= table.length; at += 32)
        if (readU32(table, at) === overlayId) {
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
    if (!supportsAbilityEditor(project))
        throw new Error("Ability effects require US Black, White, Black 2 or White 2.");
    const isBw1 = project.session.baseRom === "BW";
    const overlayId = isBw1 ? 93 : 167;
    const catalog = isBw1 ? project.session.baseVersion === "W" ? whiteBindings : blackBindings : bindings;
    const profiles = catalog.profiles as NativeAbilityProfile[];
    const signatures: Record<string, BattleRuntimeSignature> = {...(isBw1 ? catalog.functions : BATTLE_RUNTIME_SIGNATURES), ...statusBindings.profiles[isBw1 ? project.session.baseVersion as "B"|"W" : "BW2"], ...environmentBindings.profiles[isBw1 ? project.session.baseVersion as "B"|"W" : "BW2"], ...strikeBindings.profiles[isBw1 ? project.session.baseVersion as "B"|"W" : "BW2"]};
    if (!sources.has(project) && project.originalRomBytes)
        hydrateAbilityEffectsSource(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }));
    const original = sources.get(project);
    if (!original)
        throw new Error("Reload the ROM with Pokémon selected.");
    const source = { ...original }, table = project.patches?.arm9OverlayTable;
    if (table)
        for (let at = 0; at + 32 <= table.length; at += 32)
            if (readU32(table, at) === overlayId)
                source.base = readU32(table, at + 4);
    if (!(isBw1 ? [project.session.baseVersion === "W" ? "IRAO" : "IRBO"] : ["IRDO", "IREO"]).includes(source.game) || source.revision !== 0)
        throw new Error("Ability effects currently require a recognized US revision-0 Black, White, Black 2 or White 2 ROM.");
    const overlay = project.overlays[overlayId];
    if (!overlay?.length)
        throw new Error("Reload the ROM with Pokémon selected to load the battle overlay.");
    const resolver = battleRuntimeResolver(overlay, source.base, project.arm9, source.armBase, signatures);
    const dispatcher = resolver.resolve("AbilityEvent_AddItem");
    const pointers = catalog.tableRefs.map(ref => readU32(dispatcher.code, ref.offset) - ref.column);
    if (pointers[0] !== pointers[1])
        throw new Error("Unrecognized native ability assignment table.");
    const at = pointers[0] - source.base;
    if (at < 0 || at + catalog.rows.length * 8 > overlay.length || !catalog.rows.every((id, i) => readU32(overlay, at + i * 8) === id))
        throw new Error("Unrecognized native ability assignment table.");
    const availableNative = new Set<number>();
    const fromHex = (s: string) => Uint8Array.from(s.match(/../gu) ?? [], v => Number.parseInt(v, 16));
    for (const profile of profiles) {
        const index = catalog.rows.indexOf(profile.id), factory = (readU32(overlay, at + index * 8 + 4) & ~1) - source.base;
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
    return { project, source, overlay, resolver, dispatcher, files, availableNative, signatures, profiles, overlayModule: String(overlayId) };
}
type Context = ReturnType<typeof context>;
/**
 * Mega Evolution replaces GiratinaArceusGenesectItemCheck whole (a Mega Stone can't be removed, swapped or knocked off
 * its species), keeping its arguments and result: calls into it, and service pointers to it, reach the replacement,
 * which is the check the rules should see. A copied body would bypass it, so copies still count as a conflict.
 */
export function isVerifiedMegaItemCheckImport(version: string, path: string, name: string, address: number, start: number, type: string): boolean {
    return name === "GiratinaArceusGenesectItemCheck" && start === address && type === "THUMB_BRANCH"
        && ["W2", "B2", "W", "B"].includes(version) && path.toLowerCase() === `patches/pokewebmega${version.toLowerCase()}.dll`;
}
function assertUnhooked(c: Context, name: string, address: number, size: number, copied = false, skipItemMoveParam = false): void {
    const module = c.signatures[name].module;
    for (const [path, bytes] of c.files) {
        if (path === ABILITY_EFFECTS_DLL_PATH)
            continue;
        if(skipItemMoveParam&&name==="ServerEvent_GetMoveParam"&&path==="patches/ItemEffects.dll")continue;
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
                if(name==="IsMonTrapped"&&isVerifiedMoveFieldSwitchImport(c.project,path,bytes,address,size))continue;
                if (!copied && isVerifiedMoveServiceImport(c.project, path, bytes, name, address)) continue;
                // Import the installed RPC's transparent ordinary-call path. A
                // copied body would bypass it; another hook would overwrite it.
                if (!copied && isVerifiedMegaItemCheckImport(c.project.session.baseVersion, path, name, address, start, r.target.type)) continue;
                if (!copied && name === "IsFainted" && module === "167" && start === address
                    && r.target.type === "THUMB_BRANCH"
                    && isVerifiedBattleCounterImport(c.project.session.baseVersion, path, bytes, address)) continue;
                throw new Error(`Conflicting ability service hook: ${path} (${name}).`);
            }
        }
    }
}
export const ABILITY_RULE_API = ["BattleEventVar_GetValue", "BattleEventVar_MulValue", "GetBattleMon", "GetBattleMonStat", "GetPokeType", "PokeTypePair_IsMatch", "ServerEvent_GetWeather", "BtlServerFlow_IsSimulating", "BtlServerFlow_CheckMatchup", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleHandler_StrSetup", "BattleHandler_AddArg", "BattleEventItem_GetSubID", "BattleEvent_AddItem", "GetMonID", "RawBattleMonStat", "PML_MoveGetCategory", null, null, "BattleHandler_PushRun", null, null, "IsStatChangeValid", "BtlCalc_MakeStatusCondition", "MakeConditionBadlyPoisoned", "BattleEventVar_GetValueIfExist", "RollEffectChance", "BattleEventVar_RewriteValue", "GetBattleMonSpecies", "CheckCondition", "getMoveFlag", "BattleEvent_CheckSkip"] as const;
function assertNoCompetingMoveParamProviders(c:Context):void {
    for(const [path,bytes] of c.files){
        if(path===ABILITY_EFFECTS_DLL_PATH||path==="patches/ItemEffects.dll"||same(bytes,retired))continue;
        let other:RpmModule;try{other=parseRpm(bytes,{allowedMagics:["DLXF"]});}catch{continue;}
        if(other.symbols.some(s=>(s.attributes&1)&&(s.name==="RuleGetMoveParam"||s.nameHash===0x387d450d)))throw Error(`Conflicting move-parameter provider: ${path}.`);
    }
}
function storedMoveClasses(c: Context): Map<number, number> {
    const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
    if (!bytes || same(bytes, retired)) return new Map();
    const metadata = parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata;
    if (metadata.PokewebAbilityMoveClasses === undefined && metadata.PokewebMoveClassOverrides === undefined && metadata.PokewebAbilityPowerRatio === undefined) return new Map();
    if (metadata.PokewebAbilityMoveClasses !== 1 || metadata.PokewebAbilityPowerRatio !== 1 || typeof metadata.PokewebMoveClassOverrides !== "string") throw Error("Unrecognized expanded move flag data.");
    return validateMoveClassOverrides(JSON.parse(metadata.PokewebMoveClassOverrides), new Map(), metadata.PokewebMoveClassDefaults !== undefined);
}
/** Snapshot defaults separately from user overrides. Verification must not depend
 * on mutable move names; refreshing keeps classifications after a user renames a move. */
function automaticMoveClasses(c: Context, refresh = false): Map<number, number> {
    const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
    const value = bytes && !same(bytes, retired) ? parseRpm(bytes, {allowedMagics:["DLXF"]}).metadata.PokewebMoveClassDefaults : undefined;
    if (value !== undefined && typeof value !== "string") throw Error("Invalid expanded move flag defaults.");
    const result = value === undefined ? new Map<number,number>() : validateMoveClassOverrides(JSON.parse(value as string));
    if (refresh) for (const [id,mask] of expandedMoveDllDefaults(c.project)) result.set(id,mask);
    return result;
}
function storedCustomMoveFlags(c: Context): CustomMoveFlagRegistry {
    const bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes||same(bytes,retired))return emptyCustomMoveFlags();
    const metadata=parseRpm(bytes,{allowedMagics:["DLXF"]}).metadata;
    if(metadata.PokewebAbilityCustomMoveFlags===undefined&&metadata.PokewebCustomMoveFlags===undefined)return emptyCustomMoveFlags();
    if(metadata.PokewebAbilityCustomMoveFlags!==1||typeof metadata.PokewebCustomMoveFlags!=="string")throw Error("Unrecognized custom move flag data.");
    return validateCustomMoveFlags(JSON.parse(metadata.PokewebCustomMoveFlags));
}
function validateCustomFlagReferences(entries: ReadonlyMap<number,AbilityRuleSet>, registry: CustomMoveFlagRegistry): void {
    const ids=new Set(registry.flags.map(flag=>flag.id));
    for(const rule of entries.values())for(const effect of rule.effects){
        if(!libraryAbilityEffect(effect.kind)&&!recipeAbilityEffect(effect.kind))continue;
        const id=customMoveFlagId(effect.parameters?.moveClass??0);
        if(id!==undefined&&!ids.has(id))throw Error(`Custom move flag ${id} is missing. Choose an existing flag.`);
    }
}
function storedBlockMessage(c: Context): number | undefined {
    const bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes||same(bytes,retired))return;
    const value=parseRpm(bytes,{allowedMagics:["DLXF"]}).metadata.PokewebAbilityBlockMessage;
    if(value===undefined)return;
    if(typeof value!=="number"||!Number.isInteger(value)||value<0||value>65532)throw Error("Invalid ability block message.");
    return value;
}
function storedPresentationMessages(c:Context): number[] | undefined {
    const bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes||same(bytes,retired))return;
    const value=parseRpm(bytes,{allowedMagics:["DLXF"]}).metadata.PokewebAbilityPresentationMessages;
    if(value===undefined)return;
    if(typeof value!=="string")throw Error("Invalid ability presentation messages.");
    const ids:unknown=JSON.parse(value);
    const version6 = parseRpm(bytes,{allowedMagics:["DLXF"]}).metadata.PokewebAbilityActionResults===1;
    if(!Array.isArray(ids)||!(version6?[15,33,34]:[15]).includes(ids.length)||ids.some(id=>!Number.isInteger(id)||id<0||id>65532))throw Error("Invalid ability presentation messages.");
    return ids;
}
function moduleFor(c: Context, entries: ReadonlyMap<number, AbilityRuleSet>, previewHook = false, clientHooks = true, popupGroups = true, optimized = true, chainOwner = false, skipItemMoveParam = false, modern = true, overrides: ReadonlyMap<number, number> = storedMoveClasses(c), battleMessages = modern, blockMessage = storedBlockMessage(c), presentationMessages = storedPresentationMessages(c), automatic: ReadonlyMap<number,number> = battleMessages ? automaticMoveClasses(c,true) : new Map(), customFlags = true, registry: CustomMoveFlagRegistry = storedCustomMoveFlags(c), actionResults = true, statSource = true, compact = true, compactExecution = true, nativeFlags = true, environment = true, strikes = true, protect = true, weatherMoves = true, statusExtensions = true): RpmModule {
    actionResults = actionResults && battleMessages && customFlags;
    statSource = statSource && actionResults;
    if(compact && !statSource) throw Error("Compact ability packaging requires the current runtime.");
    if(compactExecution && !compact)throw Error("Compact execution requires current packaging.");
    if(nativeFlags && !compactExecution)throw Error("Native move flags require the current ability runtime.");
    if(!nativeFlags && [...entries.values()].some(rule=>rule.effects.some(e=>vanillaMoveFlagIndex(e.parameters?.moveClass??0)!==undefined)))throw Error("The saved ability runtime cannot support native move flag filters.");
    if(strikes&&!environment)throw Error("Additional strikes require the current ability runtime.");
    if(protect&&!strikes)throw Error("Hitting through protection requires the current ability runtime.");
    if(statusExtensions&&!weatherMoves)throw Error("Status extensions require the current ability runtime.");
    if(!statusExtensions&&[...entries.values()].some(r=>r.effects.some(e=>(recipeAbilityEffect(e.kind)?.code??0)>=174)))throw Error("The saved ability runtime cannot support source-aware status or charge effects.");
    if(weatherMoves&&!protect)throw Error("Simulated move weather requires the current ability runtime.");
    if(!weatherMoves&&[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:moveWeather")))throw Error("The saved ability runtime cannot support simulated move weather.");
    if(!protect&&[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:protectBypass")))throw Error("The saved ability runtime cannot support hitting through protection.");
    if(!strikes&&[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:additionalStrike")))throw Error("The saved ability runtime cannot support additional strikes.");
    if(environment&&!nativeFlags)throw Error("Entry conditions and selective damage guards require the current ability runtime.");
    if(!environment&&[...entries.values()].some(r=>r.effects.some(e=>(recipeAbilityEffect(e.kind)?.code??0)>=168)))throw Error("The saved ability runtime cannot support entry conditions or selective damage guards.");
    const authoredEntries=entries;
    if(compactExecution)entries=new Map([...entries].map(([id,rule])=>[id,validateAbilityRule(optimizeAbilityRule(rule))]));
    else if([...entries.values()].some(rule=>rule.effects.some(e=>(recipeAbilityEffect(e.kind)?.code??0)>=166||e.parameters?.types!==undefined)))throw Error("The saved ability runtime cannot support consolidated effects.");
    const workSlots=abilityWorkSlots(entries);
    if(!statSource&&[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:abilityStatGuard")))throw Error("The saved ability runtime cannot support ability-source stat prevention.");
    registry=validateCustomMoveFlags(registry);
    validateCustomFlagReferences(entries,registry);
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
    const weatherGuard = [...entries.values()].some(r => r.effects.some(e => e.kind === "abilityRecipe:weatherGuard"));
    const actions = [...entries.values()].some(r=>r.effects.some(needsAbilityActionRuntime));
    const scoped = actions || [...entries.values()].some(r=>r.effects.some(e=>SCOPED_ABILITY_EFFECTS.some(s=>s.kind===e.kind)));
    const legacyTemplate = actions ? traps ? actionClientTemplate : actionRecipeTemplate : scoped ? traps ? scopedClientTemplate : scopedRecipeTemplate : weatherGuard ? traps ? weatherClientTemplate : weatherRecipeTemplate : popupGroups
        ? traps ? groupedClientTemplate : recipes ? groupedRecipeTemplate : library ? groupedLibraryTemplate : priority ? groupedPriorityTemplate : groupedTemplate
        : traps ? clientTemplate : recipes ? recipeTemplate : library ? libraryTemplate : priority ? priorityTemplate : template;
    if (modern && (!optimized || !popupGroups)) throw Error("Expanded Flags require the current ability runtime.");
    const compactName=Object.entries(statSourceTemplates).find(([,value])=>value===statSourceRuntime.get(legacyTemplate))?.[0];
    const compactBundle=compactName?((statusExtensions?statusExtensionTemplates:weatherMoves?weatherMoveTemplates:protect?protectTemplates:strikes?strikeTemplates:environment?environmentTemplates:nativeFlags?nativeFlagTemplates:compactTemplates) as Record<string,Record<string,unknown>>)[compactName]?.[workSlots]:undefined;
    const selectedTemplate = (compactExecution?compactBundle:modern ? (battleMessages ? customFlags ? actionResults ? statSource ? statSourceRuntime : actionResultRuntime : customFlagRuntime : messageRuntime : classRuntime).get(legacyTemplate) : optimized ? optimizedRuntime.get(legacyTemplate) : legacyTemplate) as typeof template;
    if (!selectedTemplate) throw new Error("Missing optimized ability runtime.");
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
    const adapters = (entries.size ? [["AbilityEvent_AddItem", 18, "AbilityDispatch"], ["HandlerMoldBreakerSkipCheck", 19, "AbilityMoldSkip"], ...(popupGroups ? [["BattleHandler_PushRun", 20, "AbilityPopupRun"]] : [])] : []) as Array<[string, number, string]>;
    for (const [name, index, wrapper] of adapters) {
        const { address, code } = c.resolver.resolve(name);
        assertUnhooked(c, name, address, code.length, true);
        const symbol = append(code, "FUNCTION_THM"), at = rpm.symbols[symbol].address;
        rpm.relocations.push({ target: { module: "base", address: api + index * 4, type: "OFFSET" }, sourceSymbolIndex: symbol }, { target: { module: c.overlayModule, address, type: name === "HandlerMoldBreakerSkipCheck" && !previewHook ? "THUMB_BRANCH_SAFESTACK" : "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named(wrapper)) });
        for (const call of c.signatures[name].calls) {
            const target = battleBranchTarget(code, call.offset, address);
            if (!c.resolver.matches(call.target, target))
                throw new Error(`Unrecognized ability dependency: ${call.target}`);
            assertUnhooked(c, call.target, target, c.signatures[call.target].hex.length / 2);
            rpm.symbols.push({ name: null, address: target, size: 0, type: "FUNCTION_THM", attributes: 4 });
            rpm.relocations.push({ target: { module: "base", address: at + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.length - 1 });
        }
    }
    if(priority){
        const remove=c.resolver.resolve("AbilityEvent_RemoveItem"),swap=c.resolver.resolve("AbilityEvent_Swap");
        assertUnhooked(c,"AbilityEvent_RemoveItem",remove.address,remove.code.length);assertUnhooked(c,"AbilityEvent_Swap",swap.address,swap.code.length,true);
        writeU32(rpm.code,api+33*4,remove.address|1);
        rpm.relocations.push({target:{module:c.overlayModule,address:swap.address,type:"THUMB_BRANCH"},sourceSymbolIndex:rpm.symbols.indexOf(named("AbilitySwap"))});
    }
    if(recipes){
        const recipeApi=named("AbilityRecipeApi").address;
        const services=[null,null,null,null,null,null,"BattleEvent_CallHandlers","BattleEventVar_Push","BattleEventVar_Pop","BattleEventVar_SetConstValue","IsAllyMonID","BtlServerFlow_IsMonInBattle","BtlServerFlow_IsSideEffectSet","GetSideFromMonID","PML_ItemIsBerry","CommonAbilityCureStatusCore","GetFieldWeather","MakeConditionPermanentTurnsParam","GetBattleMonHeldItem","BtlServerFlow_IsTargetOutOfRange","IsSubstituteActive","GetAdditionalConditionFlag",null];
        services.forEach((name,i)=>{if(!name)return;const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,recipeApi+i*4,service.address|1);});
        if(battleMessages){const service=c.resolver.resolve("BtlServerFlow_GetSideEffectLayers");assertUnhooked(c,"BtlServerFlow_GetSideEffectLayers",service.address,service.code.length);writeU32(rpm.code,recipeApi+23*4,service.address|1);}
        for(const[name,index,wrapper]of [["BattleEvent_CallHandlersCore",22,"AbilityRecipeHandlers"],["BattleEvent_Init",0,"AbilityRecipeInit"],["ServerEvent_GetMoveParam",1,"AbilityRecipeMoveParam"],["ServerEvent_CheckCritical",2,"AbilityRecipeCritical"],["ServerControl_CheckMoveEffectiveness",3,"AbilityRecipeEffectiveness"],["ServerControl_ChangeHeldItem",4,"AbilityRecipeChangeItem"],["BattleHandler_ForceUseItem",5,"AbilityRecipeForceItem"]]as const){
            const{address,code}=c.resolver.resolve(name);assertUnhooked(c,name,address,code.length,true,skipItemMoveParam);const symbol=append(code,"FUNCTION_THM"),at=rpm.symbols[symbol].address;
            rpm.relocations.push({target:{module:"base",address:recipeApi+index*4,type:"OFFSET"},sourceSymbolIndex:symbol},{target:{module:c.overlayModule,address,type:name==="ServerControl_CheckMoveEffectiveness"?"THUMB_BRANCH_SAFESTACK":"THUMB_BRANCH"},sourceSymbolIndex:rpm.symbols.indexOf(named(wrapper))});
            for(const call of c.signatures[name].calls){
                const target=battleBranchTarget(code,call.offset,address);if(!c.resolver.matches(call.target,target))throw new Error(`Unrecognized recipe dependency: ${call.target}`);
                assertUnhooked(c,call.target,target,c.signatures[call.target].hex.length/2);
                let targetSymbol:number;
                if(name==="ServerEvent_CheckCritical"&&call.target==="BattleEvent_CallHandlers")targetSymbol=rpm.symbols.indexOf(named("AbilityRecipeCriticalHandlers"));
                else{rpm.symbols.push({name:null,address:target,size:0,type:c.signatures[call.target].thumb===false?"FUNCTION_ARM":"FUNCTION_THM",attributes:4});targetSymbol=rpm.symbols.length-1;}
                rpm.relocations.push({target:{module:"base",address:at+call.offset,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:targetSymbol});
            }
        }
    }
    if(statSource && [...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:abilityStatGuard"||statusExtensions&&e.kind==="abilityRecipe:statusFollowup"))){
        const name="BattleEvent_CallHandlersSub", service=c.resolver.resolve(name);
        assertUnhooked(c,name,service.address,service.code.length,true);
        const sites:number[]=[];
        for(let at=0;at+4<=service.code.length;at+=2)
            if(service.code[at]===0x1c&&service.code[at+1]===0x33&&service.code[at+2]===0xb0&&service.code[at+3]===0x47)sites.push(at);
        if(sites.length!==1)throw Error("Unrecognized native callback dispatch site.");
        rpm.relocations.push({target:{module:c.overlayModule,address:service.address+sites[0],type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("AbilityNativeCallback"))});
    }
    if(environment&&recipes){
        const kinds=new Set([...entries.values()].flatMap(r=>r.effects.map(e=>e.kind)));
        const entryField=kinds.has("abilityRecipe:fieldEntry"),entrySide=kinds.has("abilityRecipe:sideEntry");
        const queued=[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:damageGuard"&&((e.parameters?.sources??3)&0x3f80)));
        const envApi=named("AbilityEnvironmentApi").address;
        for(const[index,name,needed]of [[0,"IsFieldEffectActive",entryField],[1,"SetConditionTurns",entryField||entrySide],[2,"BattleHandler_StrSetup",entryField||entrySide],[3,"BattleHandler_AddArg",entryField||entrySide],[4,"AbilityCheckIndirectDamage",queued]] as const){
            if(!needed)continue;
            const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,envApi+index*4,service.address|1);
            if(index===4){
                const event=c.resolver.resolve("AbilityIndirectDamageEvent");assertUnhooked(c,"AbilityIndirectDamageEvent",event.address,event.code.length);
                if(battleBranchTarget(service.code,2,service.address)!==event.address)throw Error("Changed native indirect-damage query.");
                for(const call of c.signatures.AbilityIndirectDamageEvent.calls)if(!c.resolver.matches(call.target,battleBranchTarget(event.code,call.offset,event.address)))throw Error(`Changed native damage-event dependency: ${call.target}`);
            }
        }
        if(queued){
            const site=c.resolver.resolve("AbilityIndirectDamageBoundary");assertUnhooked(c,"AbilityIndirectDamageBoundary",site.address,site.code.length);
            if(battleBranchTarget(site.code,6,site.address)!==c.resolver.resolve("AbilityCheckIndirectDamage").address)throw Error("Changed native indirect-damage dependency.");
            rpm.relocations.push({target:{module:c.overlayModule,address:site.address+6,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("AbilityIndirectDamageSite"))});
        }
    }
    if(strikes&&[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:additionalStrike"))){
        const boundary=c.resolver.resolve("AbilityStrikeBoundary"),api=named("AbilityStrikeApi").address;
        for(const[index,name,offset,wrapper]of [[0,"AbilityStrikeNativeCount",54,"AbilityStrikeCountSite"],[1,"AbilityStrikeNativeEnd",184,"AbilityStrikeEndSite"],[2,"AbilityStrikeTargetCount",94,""]] as const){
            const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);
            if(battleBranchTarget(boundary.code,offset,boundary.address)!==service.address)throw Error(`Changed native strike dependency: ${name}`);
            writeU32(rpm.code,api+index*4,service.address|1);
            if(wrapper){assertUnhooked(c,"AbilityStrikeBoundary",boundary.address+offset,4);rpm.relocations.push({target:{module:c.overlayModule,address:boundary.address+offset,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named(wrapper))});}
        }
    }
    if(protect&&[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:protectBypass"))){
        // Protect/Detect use the native protect-break event; Wide/Quick Guard
        // side items are paused by the recipe dispatcher wrapper. Both services
        // are read-only lookups with checked signatures.
        const api=named("AbilityProtectApi").address;
        ["GetTurnFlag","BattleEvent_SeekItem"].forEach((name,i)=>{const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,api+i*4,service.address|1);});
    }
    if(weatherMoves&&[...entries.values()].some(r=>r.effects.some(e=>e.kind==="abilityRecipe:moveWeather"))){
        // The native weather query is replaced by a checked adapter that runs a
        // relocated copy of the original outside the holder's move sequence.
        const name="ServerEvent_GetWeather",{address,code}=c.resolver.resolve(name);
        assertUnhooked(c,name,address,code.length,true);
        const symbol=append(code,"FUNCTION_THM"),at=rpm.symbols[symbol].address;
        rpm.relocations.push({target:{module:"base",address:named("AbilityWeatherApi").address,type:"OFFSET"},sourceSymbolIndex:symbol},{target:{module:c.overlayModule,address,type:"THUMB_BRANCH"},sourceSymbolIndex:rpm.symbols.indexOf(named("AbilityWeatherQuery"))});
        for(const call of c.signatures[name].calls){
            const target=battleBranchTarget(code,call.offset,address);if(!c.resolver.matches(call.target,target))throw new Error(`Unrecognized weather dependency: ${call.target}`);
            assertUnhooked(c,call.target,target,c.signatures[call.target].hex.length/2);
            rpm.symbols.push({name:null,address:target,size:0,type:c.signatures[call.target].thumb===false?"FUNCTION_ARM":"FUNCTION_THM",attributes:4});
            rpm.relocations.push({target:{module:"base",address:at+call.offset,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.length-1});
        }
    }
    if(statusExtensions&&recipes){
        const kinds=new Set([...entries.values()].flatMap(r=>r.effects.map(e=>e.kind))),api=named("AbilityStatusApi").address;
        if(kinds.has("abilityRecipe:windCharge"))for(const[i,name]of [[1,"PML_MoveGetType"],[2,"BattleEvent_SeekItem"]] as const){const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,api+i*4,service.address|1);}
        if(kinds.has("abilityRecipe:statusFollowup"))for(const[i,name]of [[3,"BattleRandom"],[4,"SetConditionTurns"]] as const){const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,api+i*4,service.address|1);}
        if(kinds.has("abilityRecipe:statusTypeBypass")||kinds.has("abilityRecipe:statusFollowup")){
            const site=c.resolver.resolve("AbilityStatusBoundary"),original=c.resolver.resolve("AbilityStatusNativeCheck");
            assertUnhooked(c,"AbilityStatusBoundary",site.address,site.code.length);assertUnhooked(c,"AbilityStatusNativeCheck",original.address,original.code.length);
            if(battleBranchTarget(site.code,24,site.address)!==original.address)throw Error("Changed native status-immunity boundary.");
            for(const call of c.signatures.AbilityStatusNativeCheck.calls){const target=battleBranchTarget(original.code,call.offset,original.address);if(!c.resolver.matches(call.target,target))throw Error(`Changed native status dependency: ${call.target}`);assertUnhooked(c,call.target,target,c.signatures[call.target].hex.length/2);}
            writeU32(rpm.code,api,original.address|1);
            rpm.relocations.push({target:{module:c.overlayModule,address:site.address+24,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("AbilityStatusCheckSite"))});
        }
    }
    if(scoped){
        const scopedApi=named("AbilityScopedApi").address;
        ["GetTurnCounter","PokeTypePair_MakeMonotype","IsItemSwapBlocked","IsItemUnremovable","GiratinaArceusGenesectItemCheck","BattleMon_SetType"].forEach((name,i)=>{const service=c.resolver.resolve(name);assertUnhooked(c,name,service.address,service.code.length);writeU32(rpm.code,scopedApi+i*4,service.address|1);});
    }
    const data = append(encodeAbilityRules(entries,compactExecution), "SECTION");
    rpm.relocations.push({ target: { module: "base", address: named("AbilityRuleData").address, type: "OFFSET" }, sourceSymbolIndex: data });
    if (modern) {
        const classes = append(encodeMoveClassOverrides(mergedMoveClassData(overrides,automatic)), "SECTION");
        rpm.relocations.push({ target: { module: "base", address: named("AbilityMoveClassData").address, type: "OFFSET" }, sourceSymbolIndex: classes });
    }
    if(customFlags){
        const flags=append(encodeCustomMoveFlags(registry),"SECTION");
        rpm.relocations.push({target:{module:"base",address:named("AbilityCustomMoveFlagData").address,type:"OFFSET"},sourceSymbolIndex:flags});
    }
    if (battleMessages && blockMessage !== undefined && (library || recipes)) writeU16(rpm.code,named("AbilityBlockMessage").address,blockMessage);
    if (battleMessages && recipes && presentationMessages) presentationMessages.forEach((id,n)=>writeU16(rpm.code,named("AbilityPresentationMessages").address+n*2,id));
    linkNativeAbilities(rpm, entries, rpm.symbols[data].address, c.resolver.resolve, (name, address, size, copied) => assertUnhooked(c, name, address, size, copied), c.profiles, c.signatures,compactExecution);
    if (optimized) {
        const tables = named("AbilityRuleEventTables").address, counts = named("AbilityRuleEventCounts").address;
        const shared = new Map<string, number>();
        for (const [id, rule] of [...entries].sort(([a], [b]) => a - b)) {
            const events = abilityRuleEvents(rule, c.profiles, battleMessages), key = events.join(",");
            rpm.code[counts + id] = events.length;
            if (!events.length) continue;
            let symbol = shared.get(key);
            if (symbol === undefined) {
                const table = new Uint8Array(events.length * 8);
                events.forEach((event, i) => writeU32(table, i * 8, event));
                symbol = append(table, "SECTION"); shared.set(key, symbol);
                events.forEach((event, i) => rpm.relocations.push({
                    target: { module: "base", address: rpm.symbols[symbol!].address + i * 8 + 4, type: "OFFSET" },
                    sourceSymbolIndex: rpm.symbols.indexOf(named(`AbilityEvent_${event.toString(16).padStart(2, "0")}`)),
                }));
            }
            rpm.relocations.push({ target: { module: "base", address: tables + id * 4, type: "OFFSET" }, sourceSymbolIndex: symbol });
        }
    }
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
            { target: { module: c.overlayModule, address: original.address, type: "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named("AbilityClientTrapped")) });
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
    rpm.metadata = { PMCGameID: c.project.session.baseVersion, PMCVersion: "1.0.0", PMCModulePriority: 4, PokewebAbilityEffects: "rules", PokewebAbilityRules: compact ? encodeAbilityRecipeBook([...authoredEntries].sort(([a], [b]) => a - b)) : JSON.stringify([...authoredEntries].sort(([a], [b]) => a - b)) };
    if(compactExecution){rpm.metadata.PokewebAbilityCompact=1;rpm.metadata.PokewebAbilityWorkSlots=workSlots;}
    if(environment)rpm.metadata.PokewebAbilityEnvironment=1;
    if(strikes)rpm.metadata.PokewebAbilityStrikes=1;
    if(protect)rpm.metadata.PokewebAbilityProtect=1;
    if(weatherMoves)rpm.metadata.PokewebAbilityWeatherMoves=1;
    if(statusExtensions)rpm.metadata.PokewebAbilityStatusExtensions=1;
    if(nativeFlags)rpm.metadata.PokewebAbilityNativeMoveFlags=1;
    if (modern) {
        rpm.metadata.PokewebAbilityMoveClasses = 1;
        rpm.metadata.PokewebAbilityPowerRatio = 1;
        rpm.metadata.PokewebAbilityStatPopupGuards = 1;
        rpm.metadata.PokewebMoveClassOverrides = JSON.stringify([...validateMoveClassOverrides([...overrides], new Map(),battleMessages)]);
        if (battleMessages) rpm.metadata.PokewebMoveClassDefaults = JSON.stringify([...validateMoveClassOverrides([...automatic])]);
    }
    if(customFlags){rpm.metadata.PokewebAbilityCustomMoveFlags=1;rpm.metadata.PokewebCustomMoveFlags=JSON.stringify(registry);}
    if(actionResults)rpm.metadata.PokewebAbilityActionResults=1;
    if(statSource)rpm.metadata.PokewebAbilityStatSource=1;
    if (battleMessages) rpm.metadata.PokewebAbilityBattleMessages = 1;
    if (battleMessages && blockMessage !== undefined) rpm.metadata.PokewebAbilityBlockMessage = blockMessage;
    if (battleMessages && presentationMessages) rpm.metadata.PokewebAbilityPresentationMessages = JSON.stringify(presentationMessages);
    if (optimized) rpm.metadata.PokewebAbilityDispatchVersion = 2;
    if (traps) rpm.metadata.PokewebAbilityClientTraps = 1;
    if (popupGroups) rpm.metadata.PokewebAbilityPopupGroups = 1;
    if (weatherGuard) rpm.metadata.PokewebAbilityWeatherGuard = 1;
    if (scoped) rpm.metadata.PokewebAbilityScoped = 1;
    if (actions) rpm.metadata.PokewebAbilityActions = 1;
    if(chainOwner&&!recipes)throw Error("The ability runtime has no move-parameter adapter to share.");
    if(chainOwner)assertNoCompetingMoveParamProviders(c);
    const result=chainOwner?chainAbilityMoveParam(rpm,c.overlayModule).module:rpm;
    if(compact){result.metadata.PokewebAbilityPackaging=1;stripRpmPrivateSymbolNames(result);}
    const serialized = writeRpm(result, { ident: "DLXF" });
    if (result.code.length + result.bssSize > 65536 || estimateRpmMemory(serialized).loadAllocationBytes > 160 * 1024)
        throw new Error("Ability effects exceed the shared DLL memory budget. Reduce rule complexity.");
    return result;
}
const verified = new WeakMap<ProjectState, {
    overlay: Uint8Array;
    arm9: Uint8Array;
    bytes: Uint8Array;
    files: Map<string, Uint8Array>;
    base: number;
    rules: Map<number, AbilityRuleSet>;
    peerVerified: boolean;
}>();
function readRules(c: Context, verifyPeer = true): Map<number, AbilityRuleSet> {
    const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
    if (!bytes || same(bytes, retired))
        return new Map();
    const cached = verified.get(c.project);
    if (cached && (!verifyPeer||cached.peerVerified) && cached.base === c.source.base && same(cached.overlay, c.overlay) && same(cached.arm9, c.project.arm9) && same(cached.bytes, bytes) && cached.files.size === c.files.size && [...c.files].every(([p, b]) => cached.files.has(p) && same(cached.files.get(p)!, b)))
        return structuredClone(cached.rules);
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    if (rpm.metadata.PokewebAbilityEffects !== "rules" || rpm.metadata.PMCVersion !== "1.0.0" || typeof rpm.metadata.PokewebAbilityRules !== "string")
        throw new Error("Unrecognized shared ability effects DLL.");
    if(rpm.metadata.PokewebAbilityPackaging!==undefined && rpm.metadata.PokewebAbilityPackaging!==1) throw Error("Unrecognized ability packaging version.");
    const compact=rpm.metadata.PokewebAbilityPackaging===1;
    if(rpm.metadata.PokewebAbilityCompact!==undefined&&rpm.metadata.PokewebAbilityCompact!==1)throw Error("Unrecognized ability execution format.");
    const compactExecution=rpm.metadata.PokewebAbilityCompact===1;
    if(rpm.metadata.PokewebAbilityNativeMoveFlags!==undefined&&rpm.metadata.PokewebAbilityNativeMoveFlags!==1)throw Error("Unrecognized native move flag runtime.");
    const nativeFlags=rpm.metadata.PokewebAbilityNativeMoveFlags===1;
    if(rpm.metadata.PokewebAbilityStrikes!==undefined&&rpm.metadata.PokewebAbilityStrikes!==1)throw Error("Unrecognized ability strike runtime.");
    const strikes=rpm.metadata.PokewebAbilityStrikes===1;
    if(rpm.metadata.PokewebAbilityProtect!==undefined&&rpm.metadata.PokewebAbilityProtect!==1)throw Error("Unrecognized ability protection runtime.");
    const protect=rpm.metadata.PokewebAbilityProtect===1;
    if(rpm.metadata.PokewebAbilityWeatherMoves!==undefined&&rpm.metadata.PokewebAbilityWeatherMoves!==1)throw Error("Unrecognized ability move-weather runtime.");
    const weatherMoves=rpm.metadata.PokewebAbilityWeatherMoves===1;
    if(rpm.metadata.PokewebAbilityStatusExtensions!==undefined&&rpm.metadata.PokewebAbilityStatusExtensions!==1)throw Error("Unrecognized ability status-extension runtime.");
    const statusExtensions=rpm.metadata.PokewebAbilityStatusExtensions===1;
    if(rpm.metadata.PokewebAbilityEnvironment!==undefined&&rpm.metadata.PokewebAbilityEnvironment!==1)throw Error("Unrecognized ability environment runtime.");
    const environment=rpm.metadata.PokewebAbilityEnvironment===1;
    if(!compactExecution&&rpm.metadata.PokewebAbilityWorkSlots!==undefined)throw Error("Invalid ability working-memory metadata.");
    if(compact!==rpm.metadata.PokewebAbilityRules.startsWith("z1:"))throw Error("Invalid ability recipe metadata format.");
    const entries: unknown = decodeAbilityRecipeBook(rpm.metadata.PokewebAbilityRules), rules = new Map<number, AbilityRuleSet>();
    if (!Array.isArray(entries) || !entries.length && !storedMoveClasses(c).size && !automaticMoveClasses(c).size && storedCustomMoveFlags(c).nextId===1 || entries.length > 255)
        throw new Error("Invalid ability registry.");
    for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 1 || entry[0] > 255 || rules.has(entry[0]))
            throw new Error("Invalid ability registry entry.");
        rules.set(entry[0], validateAbilityRule(entry[1]));
    }
    const clientHooks = rpm.metadata.PokewebAbilityClientTraps === 1;
    const popupGroups = rpm.metadata.PokewebAbilityPopupGroups === 1;
    const optimized = rpm.metadata.PokewebAbilityDispatchVersion === 2;
    const modern = rpm.metadata.PokewebAbilityPowerRatio === 1;
    const battleMessages = rpm.metadata.PokewebAbilityBattleMessages === 1;
    const owner=rpm.metadata.PokewebMoveParamChain==="owner";
    if(rpm.metadata.PokewebMoveParamChain!==undefined&&!owner)throw Error("Unrecognized shared move-parameter owner.");
    if(owner)assertNoCompetingMoveParamProviders(c);
    if (!same(bytes, writeRpm(moduleFor(c, rules, false, clientHooks, popupGroups, optimized,owner,false,modern,storedMoveClasses(c),battleMessages,storedBlockMessage(c),storedPresentationMessages(c),automaticMoveClasses(c),rpm.metadata.PokewebAbilityCustomMoveFlags===1,storedCustomMoveFlags(c),rpm.metadata.PokewebAbilityActionResults===1,rpm.metadata.PokewebAbilityStatSource===1,compact,compactExecution,nativeFlags,environment,strikes,protect,weatherMoves,statusExtensions), { ident: "DLXF" })) && !same(bytes, writeRpm(moduleFor(c, rules, true, clientHooks, popupGroups, optimized,owner,false,modern,storedMoveClasses(c),battleMessages,storedBlockMessage(c),storedPresentationMessages(c),automaticMoveClasses(c),rpm.metadata.PokewebAbilityCustomMoveFlags===1,storedCustomMoveFlags(c),rpm.metadata.PokewebAbilityActionResults===1,rpm.metadata.PokewebAbilityStatSource===1,compact,compactExecution,nativeFlags,environment,strikes,protect,weatherMoves,statusExtensions), { ident: "DLXF" })))
        throw new Error("The shared ability effects DLL has been modified.");
    if(owner&&verifyPeer){
        const peer=c.files.get("patches/ItemEffects.dll");
        if(!peer||parseRpm(peer,{allowedMagics:["DLXF"]}).metadata.PokewebMoveParamAddress!==rpm.metadata.PokewebMoveParamAddress||!isVerifiedItemMoveParamFollower(c.project))throw Error("The shared item move-parameter provider is missing or modified.");
    }
    verified.set(c.project, { overlay: c.overlay.slice(), arm9: c.project.arm9.slice(), base: c.source.base, bytes: bytes.slice(), files: new Map([...c.files].map(([p, b]) => [p, b.slice()])), rules: structuredClone(rules), peerVerified:verifyPeer||!owner });
    return rules;
}
export function inspectAbilityEffects(project: ProjectState): {
    editable: boolean;
    message: string;
    rules: Map<number, AbilityRuleSet>;
    runtimeVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
} {
    try {
        const c = context(project), rules = readRules(c);
        if (!rules.size)
            moduleFor(c, new Map([[1, validateAbilityRule(EMPTY_ABILITY_RULE)]]));
        const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
        const metadata = bytes && !same(bytes, retired) ? parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata : undefined;
        const runtimeVersion = metadata ? metadata.PokewebAbilityStatusExtensions === 1 ? 15 : metadata.PokewebAbilityWeatherMoves === 1 ? 14 : metadata.PokewebAbilityProtect === 1 ? 13 : metadata.PokewebAbilityStrikes === 1 ? 12 : metadata.PokewebAbilityEnvironment === 1 ? 11 : metadata.PokewebAbilityNativeMoveFlags === 1 ? 10 : metadata.PokewebAbilityCompact === 1 ? 9 : metadata.PokewebAbilityPackaging === 1 ? 8 : metadata.PokewebAbilityStatSource === 1 ? 7 : metadata.PokewebAbilityActionResults === 1 ? 6 : metadata.PokewebAbilityCustomMoveFlags === 1 ? 5 : metadata.PokewebAbilityBattleMessages === 1 ? 4 : metadata.PokewebAbilityPowerRatio === 1 ? 3 : metadata.PokewebAbilityDispatchVersion === 2 ? 2 : 1 : undefined;
        return { editable: true, message: rules.size ? "Shared DLL verified" : "Native ability runtime verified", rules, runtimeVersion };
    }
    catch (error) {
        return { editable: false, message: error instanceof Error ? error.message : String(error), rules: new Map() };
    }
}
/** Replace only the verified shared runtime; ability data and text stay intact. */
export async function upgradeAbilityRuntime(project: ProjectState, refreshMoveClasses = false): Promise<boolean> {
    const state = inspectAbilityEffects(project);
    if (!state.editable) throw new Error(state.message);
    if (state.runtimeVersion === undefined || state.runtimeVersion === CURRENT_ABILITY_RUNTIME_VERSION && !refreshMoveClasses) return false;
    await installCodeInjectionPatch(project, async staged => {
        if (detectSpecifyTrainerNaturesPatch(staged) === "legacy") await specifyTrainerNatures(staged);
        const c = context(staged), rules = readRules(c);
        const needsProvider = [...rules.values()].some(rule => rule.effects.some(effect => recipeAbilityEffect(effect.kind)));
        const item = c.files.has("patches/ItemEffects.dll") ? prepareItemMoveParamForAbility(staged, needsProvider) : { present: false };
        const blockMessage=ensureAbilityBlockMessages(staged,rules)??storedBlockMessage(c);
        const presentationMessages=ensureAbilityPresentationMessages(staged,rules)??storedPresentationMessages(c);
        const chain = needsProvider && item.present, module = moduleFor(c, rules, false, true, true, true, chain, chain,true,storedMoveClasses(c),true,blockMessage,presentationMessages);
        if (chain && module.metadata.PokewebMoveParamAddress !== item.address) throw Error("The shared ability and item hooks resolve to different native services.");
        if (item.module) stageCodeInjectionDll(staged, "ItemEffects.dll", writeRpm(item.module, { ident: "DLXF" }));
        stageCodeInjectionDll(staged, "AbilityEffects.dll", writeRpm(module, { ident: "DLXF" }));
        recordFieldChange(staged, "message_texts", "Ability runtime", "Event dispatch", "Previous routines", "Filtered events and short-circuit conditions", { key: "ability-runtime" });
    });
    verified.delete(project);
    return true;
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
/** Peer runtimes may call the weather query through the verified ability adapter. */
export function isVerifiedAbilityWeatherImport(project: ProjectState, path: string, bytes: Uint8Array, address: number): boolean {
    if (path !== ABILITY_EFFECTS_DLL_PATH) return false;
    try {
        const c=context(project),actual=c.files.get(path);if(!actual||!same(actual,bytes))return false;
        // Exclude the calling peers while checking the ability owner's canonical bytes.
        c.files.delete("patches/MoveEffects.dll");c.files.delete("patches/ItemEffects.dll");if(!readRules(c,false).size)return false;
        const service=c.resolver.resolve("ServerEvent_GetWeather"),rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});
        return service.address===address&&rpm.metadata.PokewebAbilityWeatherMoves===1&&rpm.relocations.some(r=>r.target.module===c.overlayModule&&r.target.address===address&&r.target.type==="THUMB_BRANCH"&&rpm.symbols[r.sourceSymbolIndex]?.name==="AbilityWeatherQuery");
    } catch { return false; }
}
/** A caller may use the canonical ability-aware move-parameter entry point. */
export function isVerifiedAbilityMoveParamImport(project: ProjectState, path: string, bytes: Uint8Array, address: number): boolean {
    if (path !== ABILITY_EFFECTS_DLL_PATH) return false;
    try {
        const c=context(project),actual=c.files.get(path);if(!actual||!same(actual,bytes))return false;
        // The move owner is being verified by the caller. Exclude that one
        // module while checking the ability owner's canonical bytes, avoiding
        // recursive verification of their shared transparent imports.
        c.files.delete("patches/MoveEffects.dll");if(!readRules(c).size)return false;
        const service=c.resolver.resolve("ServerEvent_GetMoveParam"),rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});
        return service.address===address&&rpm.relocations.some(r=>r.target.module===c.overlayModule&&r.target.address===address&&r.target.type==="THUMB_BRANCH"&&rpm.symbols[r.sourceSymbolIndex]?.name==="AbilityRecipeMoveParam");
    } catch { return false; }
}
/** Verify an owner independently when its item follower is being checked. */
export function isVerifiedAbilityMoveParamOwner(project:ProjectState):boolean {
    try{const c=context(project),bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes)return false;const rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});if(rpm.metadata.PokewebMoveParamChain!=="owner")return false;return readRules(c,false).size>0;}catch{return false;}
}
/** Prebuild the checked ability side of a prospective item transition. */
export function prepareAbilityMoveParamForItem(project:ProjectState,providerPresent:boolean):{chain:boolean;module?:RpmModule;address?:number} {
    if(project.session.baseRom!=="BW2")return {chain:false};
    const c=context(project),rules=readRules(c);if(!rules.size)return {chain:false};
    const recipes=[...rules.values()].some(r=>r.effects.some(e=>recipeAbilityEffect(e.kind)));
    const chain=providerPresent&&recipes,bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH)!,rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});
    if((rpm.metadata.PokewebMoveParamChain==="owner")===chain)return {chain,...(chain?{address:Number(rpm.metadata.PokewebMoveParamAddress)}:{})};
    const module=moduleFor(c,rules,false,true,true,true,chain,true);
    return {chain,module,...(chain?{address:Number(module.metadata.PokewebMoveParamAddress)}:{})};
}
export function buildAbilityRuleModule(project: ProjectState, entries: ReadonlyMap<number, AbilityRuleSet>, moveClasses?: ReadonlyMap<number, number>, customFlags?: CustomMoveFlagRegistry): RpmModule {
    const checked = new Map([...entries].map(([id, r]) => [id, validateAbilityRule(r)]));
    if (!checked.size && !moveClasses?.size && !customFlags?.flags.length)
        throw new Error("Choose an ability effect.");
    const c = context(project);
    return moduleFor(c, checked, false, true, true, true, false, false, true, moveClasses ?? storedMoveClasses(c),true,storedBlockMessage(c),storedPresentationMessages(c),automaticMoveClasses(c,true),true,customFlags??storedCustomMoveFlags(c));
}
function setName(project: ProjectState, id: number, name: string): void {
    const descriptionBank = project.session.baseRom === "BW" ? 183 : 375;
    for (const bankId of project.session.baseRom === "BW" ? [285, 182, 183] : [487, 374, 375]) {
        const bank = getTextBank(project, "message_texts", bankId);
        if (!bank.length)
            throw new Error("Ability name text banks are unavailable.");
        if (bank.length <= id)
            addTextEntries(project, "message_texts", bankId, id + 1 - bank.length);
        if (bankId !== descriptionBank || !bank[id]?.[1])
            updateTextEntry(project, "message_texts", bankId, id, bankId === descriptionBank ? "Custom battle ability." : name);
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
    description?: string;
};
export async function configureAbilityRuleSets(project: ProjectState, edits: readonly AbilityEdit[]): Promise<void> {
    if (!edits.length)
        return;
    const c = context(project), rules = readRules(c), seen = new Set<number>();
    let effectsChanged = false;
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
        const description = edit.description === undefined ? undefined : normalizeAbilityDescription(edit.description);
        const canonical = validateAbilityRule(edit.rules);
        const previous = rules.get(id) ?? (nativeAbilityProfile(`nativeAbility:${id}`)
            ? validateAbilityRule({ effects: [{ kind: `nativeAbility:${id}`, value: -1 }], conditions: EMPTY_ABILITY_RULE.conditions })
            : undefined);
        effectsChanged ||= previous === undefined || abilityExecutionSignature(previous) !== abilityExecutionSignature(canonical);
        rules.set(id, canonical);
        return { ...edit, name, description, rules: canonical };
    });
    // Text-only edits neither replace a native assignment nor update an installed
    // runtime. Stage text and its readable personal labels atomically without PMC.
    if (!effectsChanged) {
        await withProjectMutationLock(project, () => {
            const staged = { ...project, texts: structuredClone(project.texts), narcs: { ...project.narcs }, actionChangelog: structuredClone(project.actionChangelog) };
            for (const name of ["message_texts", "personal"] as const)
                if (project.narcs[name]) staged.narcs[name] = structuredClone(project.narcs[name]);
            for (const edit of checked) {
                if (edit.name) setName(staged, edit.abilityId, edit.name);
                if (edit.description !== undefined) updateAbilityDescription(staged, edit.abilityId, edit.description);
            }
            project.texts = staged.texts;
            project.narcs = staged.narcs;
            project.actionChangelog = staged.actionChangelog;
        });
        return;
    }
    const needsProvider=[...rules.values()].some(r=>r.effects.some(e=>recipeAbilityEffect(e.kind)));
    const itemPlan:{present:boolean;module?:RpmModule;address?:number}=c.files.has("patches/ItemEffects.dll")?prepareItemMoveParamForAbility(project,needsProvider):{present:false};
    const chain=needsProvider&&itemPlan.present;
    const preflight=moduleFor(c,rules,false,true,true,true,chain,chain);
    if(chain&&preflight.metadata.PokewebMoveParamAddress!==itemPlan.address)throw Error("The shared ability and item hooks resolve to different native services.");
    await installCodeInjectionPatch(project, async staged => {
        // The legacy inline helper shares memory with the live DLL loader.
        // Preserve the installed feature through its verified PMC migration.
        if (detectSpecifyTrainerNaturesPatch(staged) === "legacy") await specifyTrainerNatures(staged);
        const stagedContext=context(staged),stagedItem:{present:boolean;module?:RpmModule;address?:number}=stagedContext.files.has("patches/ItemEffects.dll")?prepareItemMoveParamForAbility(staged,needsProvider):{present:false};
        const stagedChain=needsProvider&&stagedItem.present;
        const blockMessage=ensureAbilityBlockMessages(staged,rules)??storedBlockMessage(stagedContext);
        const presentationMessages=ensureAbilityPresentationMessages(staged,rules)??storedPresentationMessages(stagedContext);
        const stagedAbility=moduleFor(stagedContext,rules,false,true,true,true,stagedChain,stagedChain,true,storedMoveClasses(stagedContext),true,blockMessage,presentationMessages);
        if(stagedChain&&stagedAbility.metadata.PokewebMoveParamAddress!==stagedItem.address)throw Error("The shared ability and item hooks resolve to different native services.");
        if(stagedItem.module)stageCodeInjectionDll(staged,"ItemEffects.dll",writeRpm(stagedItem.module,{ident:"DLXF"}));
        stageCodeInjectionDll(staged, "AbilityEffects.dll", writeRpm(stagedAbility, { ident: "DLXF" }));
        for (const edit of checked) {
            if (edit.name)
                setName(staged, edit.abilityId, edit.name);
            if (edit.description !== undefined) updateAbilityDescription(staged, edit.abilityId, edit.description);
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
/**
 * Creates several abilities at consecutive free IDs with one runtime build (each `createCustomAbility` rebuilds and
 * re-stages the ability DLL). Returns their IDs in order.
 */
export async function createCustomAbilities(project: ProjectState, abilities: ReadonlyArray<{ name: string; rules?: AbilityRuleSet; description?: string }>): Promise<number[]> {
    if (!abilities.length)
        return [];
    const first = nextCustomAbilityId(project);
    if (first === undefined || first + abilities.length - 1 > 255)
        throw new Error("All 255 ability IDs are in use.");
    const ids = abilities.map((_, index) => first + index);
    await configureAbilityRuleSets(project, abilities.map((ability, index) => ({ abilityId: ids[index], name: ability.name, rules: ability.rules ?? EMPTY_ABILITY_RULE, description: ability.description })));
    return ids;
}
export async function createCustomAbility(project: ProjectState, name: string, rules: AbilityRuleSet = EMPTY_ABILITY_RULE, description?: string): Promise<number> {
    const id = nextCustomAbilityId(project);
    if (id === undefined)
        throw new Error("All 255 ability IDs are in use.");
    await configureAbilityRuleSets(project, [{ abilityId: id, name, rules, description }]);
    return id;
}
export function clearAbilityRules(project: ProjectState, id: number): void {
    if (!Number.isInteger(id) || id < 1 || id > 255)
        throw new Error("Invalid ability ID.");
    const c = context(project), rules = readRules(c);
    if (!rules.delete(id))
        return;
    const needsProvider=[...rules.values()].some(r=>r.effects.some(e=>recipeAbilityEffect(e.kind)));
    const itemPlan:{present:boolean;module?:RpmModule;address?:number}=c.files.has("patches/ItemEffects.dll")?prepareItemMoveParamForAbility(project,needsProvider):{present:false};
    const chain=needsProvider&&itemPlan.present;
    const blockMessage=ensureAbilityBlockMessages(project,rules)??storedBlockMessage(c);
    const presentationMessages=ensureAbilityPresentationMessages(project,rules)??storedPresentationMessages(c);
    const next=rules.size||storedMoveClasses(c).size||automaticMoveClasses(c,true).size||storedCustomMoveFlags(c).nextId>1?moduleFor(c,rules,false,true,true,true,chain,chain,true,storedMoveClasses(c),true,blockMessage,presentationMessages):undefined;
    if(chain&&(!next||next.metadata.PokewebMoveParamAddress!==itemPlan.address))throw Error("The shared ability and item hooks resolve to different native services.");
    if(itemPlan.module)stageCodeInjectionDll(project,"ItemEffects.dll",writeRpm(itemPlan.module,{ident:"DLXF"}));
    if (next)
        stageCodeInjectionDll(project, "AbilityEffects.dll", writeRpm(next, { ident: "DLXF" }));
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

export function inspectMoveDllFlags(project: ProjectState, moveId: number): { editable: boolean; flags: number; customized: boolean; message: string } {
    try {
        if (!Number.isInteger(moveId) || moveId < 0 || moveId > 65535 || !project.narcs.moves || moveId >= project.narcs.moves.fileCount) throw Error("Reload the ROM with Moves selected.");
        const c = context(project); readRules(c);
        const overrides = storedMoveClasses(c);
        return { editable: true, flags: moveDllFlags(overrides, moveId, automaticMoveClasses(c,true)), customized: overrides.has(moveId), message: "" };
    } catch (error) {
        return { editable: false, flags: defaultMoveDllFlags(moveId), customized: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/** Persist flags and their shared runtime as one checked transaction. */
async function editExpandedMoveFlags(project: ProjectState, edit: (registry: CustomMoveFlagRegistry, overrides: Map<number,number>, c: Context) => void, log: (target: ProjectState) => void): Promise<void> {
    const prepare=(target:ProjectState,installMessages=false)=>{
        const c=context(target),rules=readRules(c),registry=storedCustomMoveFlags(c),overrides=storedMoveClasses(c);
        edit(registry,overrides,c);
        const checked=validateCustomMoveFlags(registry);validateCustomFlagReferences(rules,checked);
        const needsProvider=[...rules.values()].some(rule=>rule.effects.some(effect=>recipeAbilityEffect(effect.kind)));
        const item=c.files.has("patches/ItemEffects.dll")?prepareItemMoveParamForAbility(target,needsProvider):{present:false};
        const chain=needsProvider&&item.present;
        const blockMessage=(installMessages?ensureAbilityBlockMessages(target,rules):undefined)??storedBlockMessage(c);
        const presentationMessages=(installMessages?ensureAbilityPresentationMessages(target,rules):undefined)??storedPresentationMessages(c);
        const module=rules.size||overrides.size||automaticMoveClasses(c,true).size||checked.nextId>1?moduleFor(c,rules,false,true,true,true,chain,chain,true,overrides,true,blockMessage,presentationMessages,automaticMoveClasses(c,true),true,checked):undefined;
        if(chain&&module?.metadata.PokewebMoveParamAddress!==item.address)throw Error("The shared ability and item hooks resolve to different native services.");
        return{c,module,item};
    };
    prepare(project);
    await installCodeInjectionPatch(project,async staged=>{
        if(detectSpecifyTrainerNaturesPatch(staged)==="legacy")await specifyTrainerNatures(staged);
        const{c,module,item}=prepare(staged,true);
        if(item.module)stageCodeInjectionDll(staged,"ItemEffects.dll",writeRpm(item.module,{ident:"DLXF"}));
        if(module)stageCodeInjectionDll(staged,"AbilityEffects.dll",writeRpm(module,{ident:"DLXF"}));
        else{
            const files=ensureFileSystemState(staged);delete files.additions![ABILITY_EFFECTS_DLL_PATH];
            const id=c.source.ids.get(ABILITY_EFFECTS_DLL_PATH);if(id!==undefined)setRomFileReplacement(staged,id,retired.slice());
            if(staged.codeInjection?.modules)staged.codeInjection.modules=staged.codeInjection.modules.filter(entry=>entry.path!==ABILITY_EFFECTS_DLL_PATH);
        }
        log(staged);
    });
    verified.delete(project);
}
export async function configureMoveDllFlags(project: ProjectState, moveId: number, flags: number): Promise<void> {
    const state=inspectMoveDllFlags(project,moveId);if(!state.editable)throw Error(state.message);
    if(!Number.isInteger(flags)||flags<0||flags>127)throw Error("Invalid expanded move flags.");
    if(flags===state.flags)return;
    await editExpandedMoveFlags(project,(_registry,overrides,c)=>{
        if(flags===(automaticMoveClasses(c,true).get(moveId)??defaultMoveDllFlags(moveId)))overrides.delete(moveId);else overrides.set(moveId,flags);
    },target=>recordFieldChange(target,"moves",target.texts.banks.moves?.[moveId]??`Move ${moveId}`,"Expanded Flags",state.flags,flags,{key:`move-dll-flags:${moveId}`}));
}
export function inspectCustomMoveFlags(project: ProjectState): {editable:boolean;message:string;registry:CustomMoveFlagRegistry;references:Record<number,number[]>} {
    try{
        const c=context(project),rules=readRules(c),registry=storedCustomMoveFlags(c),references:Record<number,number[]>={};
        for(const[id,rule]of rules)for(const effect of rule.effects){const flag=customMoveFlagId(effect.parameters?.moveClass??0);if(flag!==undefined&&!(references[flag]??=[]).includes(id))references[flag].push(id);}
        return{editable:true,message:"",registry,references};
    }catch(error){return{editable:false,message:error instanceof Error?error.message:String(error),registry:emptyCustomMoveFlags(),references:{}};}
}
export async function createCustomMoveFlag(project:ProjectState,input:string):Promise<number>{
    const name=customMoveFlagName(input);let id=0;
    await editExpandedMoveFlags(project,registry=>{
        if(registry.nextId>MAX_CUSTOM_MOVE_FLAGS)throw Error(`The ${MAX_CUSTOM_MOVE_FLAGS} custom flag IDs are in use or retired.`);
        id=registry.nextId++;registry.flags.push({id,name,moves:[]});
    },target=>recordFieldChange(target,"moves","Expanded Flags","Custom flag","",name,{key:`move-custom-flag:${id}`}));
    return id;
}
export async function renameCustomMoveFlag(project:ProjectState,id:number,input:string):Promise<void>{
    const name=customMoveFlagName(input);let previous="";
    await editExpandedMoveFlags(project,registry=>{const flag=registry.flags.find(flag=>flag.id===id);if(!flag)throw Error("Custom flag no longer exists.");previous=flag.name;flag.name=name;},target=>recordFieldChange(target,"moves","Expanded Flags","Custom flag",previous,name,{key:`move-custom-flag:${id}`}));
}
export async function deleteCustomMoveFlag(project:ProjectState,id:number):Promise<void>{
    const state=inspectCustomMoveFlags(project);if(!state.editable)throw Error(state.message);
    const used=state.references[id]??[];
    if(used.length)throw Error(`This flag is used by ${used.map(id=>project.texts.banks.abilities?.[id]??`Ability ${id}`).join(", ")}. Change those recipes before removing it.`);
    let previous="";
    await editExpandedMoveFlags(project,registry=>{const flag=registry.flags.find(flag=>flag.id===id);if(!flag)throw Error("Custom flag no longer exists.");previous=flag.name;registry.flags=registry.flags.filter(flag=>flag.id!==id);},target=>recordFieldChange(target,"moves","Expanded Flags","Custom flag",previous,"Removed",{key:`move-custom-flag:${id}`}));
}
export async function configureCustomMoveFlag(project:ProjectState,moveId:number,flagId:number,enabled:boolean):Promise<void>{
    const state=inspectMoveDllFlags(project,moveId);if(!state.editable)throw Error(state.message);
    if(typeof enabled!=="boolean")throw Error("Invalid custom flag assignment.");
    await editExpandedMoveFlags(project,registry=>{
        const flag=registry.flags.find(flag=>flag.id===flagId);if(!flag)throw Error("Custom flag no longer exists.");
        flag.moves=flag.moves.filter(id=>id!==moveId);if(enabled)flag.moves.push(moveId);
    },target=>recordFieldChange(target,"moves",target.texts.banks.moves?.[moveId]??`Move ${moveId}`,`Custom flag ${flagId}`,!enabled,enabled,{key:`move-custom-flag:${flagId}:${moveId}`}));
}

/** Our expansion can be installed after ability recipes. Refresh the same DLL
 * only when new, verified source-to-ROM mappings add classifications. */
export async function refreshExpandedAbilityMoveFlags(project: ProjectState, currentOnly = false): Promise<void> {
    if (!sources.get(project)?.files.has(ABILITY_EFFECTS_DLL_PATH) && !project.fileSystem?.additions?.[ABILITY_EFFECTS_DLL_PATH]) return;
    const state = inspectAbilityEffects(project);
    if (state.runtimeVersion === undefined || currentOnly && state.runtimeVersion !== CURRENT_ABILITY_RUNTIME_VERSION) return;
    if (!state.editable) throw Error(state.message);
    const c=context(project), before=automaticMoveClasses(c), after=automaticMoveClasses(c,true);
    if (before.size!==after.size || [...after].some(([id,mask])=>before.get(id)!==mask)) await upgradeAbilityRuntime(project,true);
}
