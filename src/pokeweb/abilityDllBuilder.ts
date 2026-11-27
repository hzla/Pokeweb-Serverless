import { writeU16 } from "../nds/binary";
import { needsAbilityActionRuntime } from "./abilityActionEffects";
import {
    appendAbilitySection, assertNoCompetingMoveParamProviders, requireAbilitySymbol, linkAbilityClientTraps,
    linkAbilityRuleHandlers, linkAbilityRuntimeHooks,
} from "./abilityDllLinker";
import { libraryAbilityEffect } from "./abilityLibraryEffects";
import { encodeMoveClassOverrides, mergedMoveClassData, validateMoveClassOverrides } from "./abilityMoveClasses";
import { vanillaMoveFlagIndex } from "./abilityMoveFilters";
import { nativeAbilityProfile } from "./abilityNativeRuntime";
import { encodeAbilityExecutableRules, encodeSavedAbilityRecipes } from "./abilityRecipeEncoding";
import { recipeAbilityEffect } from "./abilityRecipeEffects";
import { abilityWorkSlots, optimizeAbilityRule } from "./abilityRecipeOptimization";
import { validateAbilityRule, type AbilityRuleSet } from "./abilityRules";
import {
    getAbilityRuntimeContext, readAbilityBlockMessage,
    readAbilityPresentationMessages, readAutomaticMoveClasses, readCustomMoveFlagRegistry,
    readMoveClassOverrides, type AbilityRuntimeContext,
} from "./abilityRuntimeContext";
import { createAbilityRuntimeModule } from "./abilityRuntimeTemplates";
import { SCOPED_ABILITY_EFFECTS } from "./abilityScopedEffects";
import { chainAbilityMoveParam } from "./battleMoveParamChain";
import { customMoveFlagId, encodeCustomMoveFlags, validateCustomMoveFlags, type CustomMoveFlagRegistry } from "./customMoveFlags";
import type { ProjectState } from "./projectStore";
import { stripRpmPrivateSymbolNames, writeRpm, type RpmModule } from "./rpm";
import { estimateRpmMemory } from "./rpmMemory";

export { ABILITY_RULE_API, assertNoCompetingMoveParamProviders, isVerifiedMegaItemCheckImport } from "./abilityDllLinker";

export function validateCustomFlagReferences(entries: ReadonlyMap<number,AbilityRuleSet>, registry: CustomMoveFlagRegistry): void {
    const ids=new Set(registry.flags.map(flag=>flag.id));
    for(const rule of entries.values())for(const effect of rule.effects){
        if(!libraryAbilityEffect(effect.kind)&&!recipeAbilityEffect(effect.kind))continue;
        const id=customMoveFlagId(effect.parameters?.moveClass??0);
        if(id!==undefined&&!ids.has(id))throw Error(`Custom move flag ${id} is missing. Choose an existing flag.`);
    }
}

type AbilityModuleOptions = {
    // The defaults build the current runtime. Verification supplies the features
    // recorded in the installed DLL so older recipes can be checked as shipped.
    previewHook?: boolean;
    clientHooks?: boolean;
    popupGroups?: boolean;
    optimizedDispatch?: boolean;
    powerRatio?: boolean;
    battleMessages?: boolean;
    customMoveFlags?: boolean;
    actionResults?: boolean;
    statSource?: boolean;
    compactPackaging?: boolean;
    compactExecution?: boolean;
    nativeMoveFlags?: boolean;
    environment?: boolean;
    strikes?: boolean;
    protectionBypass?: boolean;
    weatherMoves?: boolean;
    statusExtensions?: boolean;
    formConversion?: boolean;
    zenModeMessages?: boolean;
    fieldConditions?: boolean;
    effectConditions?: boolean;
    statStageConditions?: boolean;
    alignRuleRecords?: boolean;

    // The ability and item DLLs can share the move-parameter lookup.
    ownsMoveParamHook?: boolean;
    allowItemMoveParamHook?: boolean;

    // Use the project's saved data unless the caller is staging a change.
    moveClassOverrides?: ReadonlyMap<number, number>;
    automaticMoveClassDefaults?: ReadonlyMap<number, number>;
    customMoveFlagRegistry?: CustomMoveFlagRegistry;
    blockMessage?: number;
    presentationMessages?: number[];
};

function appendRuntimeData(rpm: RpmModule, pointerSymbol: string, bytes: Uint8Array): number {
    const dataSymbol = appendAbilitySection(rpm, bytes, "SECTION");
    rpm.relocations.push({
        target: { module: "base", address: requireAbilitySymbol(rpm, pointerSymbol).address, type: "OFFSET" },
        sourceSymbolIndex: dataSymbol,
    });
    return rpm.symbols[dataSymbol].address;
}

/** Build an ability DLL in memory. The caller handles installing it into the project. */
export function buildAbilityDll(c: AbilityRuntimeContext, entries: ReadonlyMap<number, AbilityRuleSet>, {
    previewHook = false,
    clientHooks = true,
    popupGroups = true,
    optimizedDispatch: optimized = true,
    ownsMoveParamHook: chainOwner = false,
    allowItemMoveParamHook: skipItemMoveParam = false,
    powerRatio: modern = true,
    moveClassOverrides: overrides = readMoveClassOverrides(c),
    battleMessages = modern,
    blockMessage = readAbilityBlockMessage(c),
    presentationMessages = readAbilityPresentationMessages(c),
    automaticMoveClassDefaults: automatic = battleMessages ? readAutomaticMoveClasses(c, true) : new Map(),
    customMoveFlags: customFlags = true,
    customMoveFlagRegistry: registry = readCustomMoveFlagRegistry(c),
    actionResults = true,
    statSource = true,
    compactPackaging: compact = true,
    compactExecution = true,
    nativeMoveFlags: nativeFlags = true,
    environment = true,
    strikes = true,
    protectionBypass: protect = true,
    weatherMoves = true,
    statusExtensions = true,
    formConversion = true,
    zenModeMessages = true,
    fieldConditions = true,
    effectConditions = true,
    statStageConditions = effectConditions,
    alignRuleRecords = statStageConditions,
}: AbilityModuleOptions = {}): RpmModule {
    actionResults = actionResults && battleMessages && customFlags;
    statSource = statSource && actionResults;
    if(compact && !statSource) throw Error("Compact ability packaging requires the current runtime.");
    if(compactExecution && !compact)throw Error("Compact execution requires current packaging.");
    if(nativeFlags && !compactExecution)throw Error("Native move flags require the current ability runtime.");
    if(!nativeFlags && [...entries.values()].some(rule=>rule.effects.some(e=>vanillaMoveFlagIndex(e.parameters?.moveClass??0)!==undefined)))throw Error("The saved ability runtime cannot support native move flag filters.");
    if(strikes&&!environment)throw Error("Additional strikes require the current ability runtime.");
    if(protect&&!strikes)throw Error("Hitting through protection requires the current ability runtime.");
    const conditionKinds = new Set<string>();
    let usesLocalConditions = false, usesConditionSubjects = false;
    function collectConditionKinds(node: AbilityRuleSet["conditions"]): void {
        if (node.kind === "group") {
            usesConditionSubjects ||= Boolean(node.scope);
            node.children.forEach(collectConditionKinds);
        } else {
            conditionKinds.add(node.kind);
            if (node.kind === "type" || node.kind === "knowsMove") usesConditionSubjects ||= Boolean(node.subject && node.subject !== "holder");
            if (node.kind === "knowsMove" && c.project.narcs.moves && node.value >= c.project.narcs.moves.fileCount)
                throw Error(`Move ${node.value} is outside this ROM’s move table.`);
        }
    }
    for (const rule of entries.values()) {
        collectConditionKinds(rule.conditions);
        for (const effect of rule.effects) if (effect.conditions) {
            usesLocalConditions = true;
            collectConditionKinds(effect.conditions);
        }
    }
    const usesKnownMoves = conditionKinds.has("knowsMove");
    const usesStatStageConditions = conditionKinds.has("statStage");
    if ((statStageConditions && !effectConditions) || (usesStatStageConditions && !statStageConditions))
        throw new Error("Stat stage conditions require the current ability runtime.");
    const usesEffectConditions = usesLocalConditions || usesConditionSubjects || usesKnownMoves || usesStatStageConditions;
    if (effectConditions && !fieldConditions || usesEffectConditions && !effectConditions)
        throw Error("Effect and opponent conditions require the current ability runtime.");
    const hasFieldCondition = conditionKinds.has("fieldEffect"), hasSideCondition = conditionKinds.has("sideEffect");
    const usesFieldConditions = hasFieldCondition || hasSideCondition;
    if (fieldConditions && !zenModeMessages || usesFieldConditions && !fieldConditions)
        throw Error("Battlefield activation conditions require the current ability runtime.");
    if(zenModeMessages&&!formConversion)throw Error("Named Zen Mode messages require the current ability runtime.");
    if(formConversion&&!statusExtensions)throw Error("Form and conversion effects require the current ability runtime.");
    if(!formConversion&&[...entries.values()].some(rule=>rule.effects.some(e=>e.kind==="abilityRecipe:zenMode"||e.kind==="abilityRecipe:convertType"&&e.parameters?.scope)))throw Error("The saved ability runtime cannot support HP-triggered form changes or field-wide conversion.");
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
    const effects = formConversion ? [...entries.values()].flatMap(rule => rule.effects) : [];
    const zenMode = effects.some(e => e.kind === "abilityRecipe:zenMode");
    const convertType = effects.some(e => e.kind === "abilityRecipe:convertType");
    const useFormConversion = zenMode || convertType;
    const useZenModeMessages = zenModeMessages && zenMode;
    const traps = clientHooks && [...entries.values()].some(r => r.effects.some(e => e.kind === "nativeAbility:42"));
    const weatherGuard = [...entries.values()].some(r => r.effects.some(e => e.kind === "abilityRecipe:weatherGuard"));
    const actions = [...entries.values()].some(r=>r.effects.some(needsAbilityActionRuntime));
    const scoped = actions || [...entries.values()].some(r=>r.effects.some(e=>SCOPED_ABILITY_EFFECTS.some(s=>s.kind===e.kind)));
    const rpm = createAbilityRuntimeModule({
        actions, scoped, weatherGuard, traps, recipes, library, priority,
        needsFormConversion: useFormConversion, needsZenModeMessages: useZenModeMessages,
        needsFieldConditions: usesFieldConditions, needsEffectConditions: usesEffectConditions,
        needsStatStageConditions: usesStatStageConditions,
        popupGroups, optimizedDispatch: optimized, powerRatio: modern, battleMessages,
        customMoveFlags: customFlags, actionResults, statSource, compactExecution,
        nativeMoveFlags: nativeFlags, environment, strikes, protectionBypass: protect, weatherMoves, statusExtensions,
        workSlots,
    });
    const bssBase = (rpm.code.length + 3) & ~3, bss = rpm.symbols.filter(s => !(s.attributes & 4) && s.address >= bssBase);
    // The saved DLL verifier compares serialized bytes. Keep this order so
    // appended sections and relocations retain their original indexes.
    linkAbilityRuntimeHooks(rpm, c, entries, {
        previewHook, popupGroups, library, priority, recipes, allowItemMoveParamHook: skipItemMoveParam,
        battleMessages, zenMode, convertType, statSource, hasFieldCondition, hasSideCondition,
        environment, strikes, protectionBypass: protect, weatherMoves, statusExtensions, scoped,
        usesKnownMoves, usesConditionSubjects, usesStatStageConditions,
    });

    const ruleBytes = encodeAbilityExecutableRules(entries, c.profiles, {
        compactExecution, usesLocalConditions, battleMessages, formConversion, alignRuleRecords,
    });
    const ruleDataAddress = appendRuntimeData(rpm, "AbilityRuleData", ruleBytes);
    if (modern) {
        const classBytes = encodeMoveClassOverrides(mergedMoveClassData(overrides, automatic));
        appendRuntimeData(rpm, "AbilityMoveClassData", classBytes);
    }
    if (customFlags) {
        appendRuntimeData(rpm, "AbilityCustomMoveFlagData", encodeCustomMoveFlags(registry));
    }
    if (battleMessages && blockMessage !== undefined && (library || recipes)) {
        writeU16(rpm.code, requireAbilitySymbol(rpm, "AbilityBlockMessage").address, blockMessage);
    }
    if (battleMessages && recipes && presentationMessages) {
        const start = requireAbilitySymbol(rpm, "AbilityPresentationMessages").address;
        presentationMessages.slice(0, useZenModeMessages ? 35 : 34).forEach((id, index) => {
            writeU16(rpm.code, start + index * 2, id);
        });
    }

    linkAbilityRuleHandlers(rpm, c, entries, ruleDataAddress, {
        compactExecution, optimizedDispatch: optimized, battleMessages, formConversion,
    });
    if (traps) linkAbilityClientTraps(rpm, c, entries);

    const shift = ((rpm.code.length + 3) & ~3) - bssBase;
    bss.forEach(s => s.address += shift);
    rpm.metadata = {
        PMCGameID: c.project.session.baseVersion,
        PMCVersion: "1.0.0",
        PMCModulePriority: 4,
        PokewebAbilityEffects: "rules",
        PokewebAbilityRules: encodeSavedAbilityRecipes(authoredEntries, compact),
    };
    if(compactExecution){rpm.metadata.PokewebAbilityCompact=1;rpm.metadata.PokewebAbilityWorkSlots=workSlots;}
    if(environment)rpm.metadata.PokewebAbilityEnvironment=1;
    if(strikes)rpm.metadata.PokewebAbilityStrikes=1;
    if(protect)rpm.metadata.PokewebAbilityProtect=1;
    if(weatherMoves)rpm.metadata.PokewebAbilityWeatherMoves=1;
    if(statusExtensions)rpm.metadata.PokewebAbilityStatusExtensions=1;
    if(formConversion)rpm.metadata.PokewebAbilityFormConversion=1;
    if(zenModeMessages)rpm.metadata.PokewebAbilityZenModeMessages=1;
    if(fieldConditions)rpm.metadata.PokewebAbilityFieldConditions=1;
    if(effectConditions)rpm.metadata.PokewebAbilityEffectConditions=1;
    if (statStageConditions) rpm.metadata.PokewebAbilityStatStageConditions = 1;
    if (alignRuleRecords) rpm.metadata.PokewebAbilityAlignedRules = 1;
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

export function buildAbilityRuleModule(project: ProjectState, entries: ReadonlyMap<number, AbilityRuleSet>, moveClasses?: ReadonlyMap<number, number>, customFlags?: CustomMoveFlagRegistry): RpmModule {
    const checked = new Map([...entries].map(([id, r]) => [id, validateAbilityRule(r)]));
    if (!checked.size && !moveClasses?.size && !customFlags?.flags.length)
        throw new Error("Choose an ability effect.");
    const c = getAbilityRuntimeContext(project);
    return buildAbilityDll(c, checked, {
        moveClassOverrides: moveClasses ?? undefined,
        customMoveFlagRegistry: customFlags ?? undefined,
    });
}
