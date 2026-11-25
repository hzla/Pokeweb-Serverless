import optimizedTemplates from "../assets/data/abilityRuleRuntimeOptimized.json";
import classTemplates from "../assets/data/abilityRuleRuntimeMoveClasses.json";
import messageTemplates from "../assets/data/abilityRuleRuntimeMessages.json";
import customFlagTemplates from "../assets/data/abilityRuleRuntimeCustomFlags.json";
import statSourceTemplates from "../assets/data/abilityRuleRuntimeStatSource.json";
import compactTemplates from "../assets/data/abilityRuleRuntimeCompact.json";
import environmentTemplates from "../assets/data/abilityRuleRuntimeEnvironment.json";
import strikeTemplates from "../assets/data/abilityRuleRuntimeStrikes.json";
import protectTemplates from "../assets/data/abilityRuleRuntimeProtect.json";
import formConversionTemplates from "../assets/data/abilityRuleRuntimeFormConversion.json";
import zenModeMessageJson from "../assets/data/abilityRuleRuntimeZenModeMessages.json?raw";
import effectConditionJson from "../assets/data/abilityRuleRuntimeEffectConditions.json?raw";
import fieldConditionJson from "../assets/data/abilityRuleRuntimeFieldConditions.json?raw";
import statusExtensionTemplates from "../assets/data/abilityRuleRuntimeStatusExtensions.json";
import weatherMoveTemplates from "../assets/data/abilityRuleRuntimeWeatherMoves.json";
import nativeFlagTemplates from "../assets/data/abilityRuleRuntimeNativeFlags.json";
import actionResultTemplates from "../assets/data/abilityRuleRuntimeActionResults.json";
import recipeTemplate from "../assets/data/abilityRuleRuntimeRecipes.json";
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
import weatherRecipeTemplate from "../assets/data/abilityRuleRuntimeRecipesWeather.json";
import weatherClientTemplate from "../assets/data/abilityRuleRuntimeClientWeather.json";
import { strFromU8, unzlibSync } from "fflate";
import type { RpmModule } from "./rpm";

// The bundle files use the original template filenames as lookup keys.
const baseTemplates = {
    "abilityRuleRuntime.json": template,
    "abilityRuleRuntimePriority.json": priorityTemplate,
    "abilityRuleRuntimeLibrary.json": libraryTemplate,
    "abilityRuleRuntimeRecipes.json": recipeTemplate,
    "abilityRuleRuntimeClient.json": clientTemplate,
    "abilityRuleRuntimeGrouped.json": groupedTemplate,
    "abilityRuleRuntimePriorityGrouped.json": groupedPriorityTemplate,
    "abilityRuleRuntimeLibraryGrouped.json": groupedLibraryTemplate,
    "abilityRuleRuntimeRecipesGrouped.json": groupedRecipeTemplate,
    "abilityRuleRuntimeClientGrouped.json": groupedClientTemplate,
    "abilityRuleRuntimeRecipesWeather.json": weatherRecipeTemplate,
    "abilityRuleRuntimeClientWeather.json": weatherClientTemplate,
    "abilityRuleRuntimeRecipesScoped.json": scopedRecipeTemplate,
    "abilityRuleRuntimeClientScoped.json": scopedClientTemplate,
    "abilityRuleRuntimeRecipesActions.json": actionRecipeTemplate,
    "abilityRuleRuntimeClientActions.json": actionClientTemplate,
};

type TemplateName = keyof typeof baseTemplates;
type TemplateJson = { code: readonly number[] };
type WorkSlots = 4 | 8 | 16;
type LegacyPack = Partial<Record<TemplateName, TemplateJson>>;
type CompactPack<T = TemplateJson> = Partial<Record<TemplateName | `${TemplateName}-form`, Partial<Record<WorkSlots, T>>>>;

const statSourcePack: LegacyPack = statSourceTemplates;
let zenModeMessagePack: CompactPack | undefined;
let fieldConditionPack: CompactPack<string> | undefined;
let effectConditionPack: CompactPack<string> | undefined;

type RuntimeTemplateOptions = {
    // Features used by the recipes in this build.
    actions: boolean;
    scoped: boolean;
    weatherGuard: boolean;
    traps: boolean;
    recipes: boolean;
    library: boolean;
    priority: boolean;
    needsFormConversion: boolean;
    needsZenModeMessages: boolean;
    needsFieldConditions: boolean;
    needsEffectConditions: boolean;

    // New builds use the builder's current defaults. The recipe reader supplies
    // these capabilities from DLL metadata when reproducing a saved build.
    popupGroups: boolean;
    optimizedDispatch: boolean;
    powerRatio: boolean; // Also marks the first Expanded Flags runtime in saved DLLs.
    battleMessages: boolean;
    customMoveFlags: boolean;
    actionResults: boolean;
    statSource: boolean;
    compactExecution: boolean;
    nativeMoveFlags: boolean;
    environment: boolean;
    strikes: boolean;
    protectionBypass: boolean;
    weatherMoves: boolean;
    statusExtensions: boolean;
    workSlots: WorkSlots;
};

function pickTemplateName(options: RuntimeTemplateOptions): TemplateName {
    const { actions, scoped, weatherGuard, traps, popupGroups, recipes, library, priority } = options;
    if (actions) return traps ? "abilityRuleRuntimeClientActions.json" : "abilityRuleRuntimeRecipesActions.json";
    if (scoped) return traps ? "abilityRuleRuntimeClientScoped.json" : "abilityRuleRuntimeRecipesScoped.json";
    if (weatherGuard) return traps ? "abilityRuleRuntimeClientWeather.json" : "abilityRuleRuntimeRecipesWeather.json";

    if (traps) return popupGroups ? "abilityRuleRuntimeClientGrouped.json" : "abilityRuleRuntimeClient.json";
    if (recipes) return popupGroups ? "abilityRuleRuntimeRecipesGrouped.json" : "abilityRuleRuntimeRecipes.json";
    if (library) return popupGroups ? "abilityRuleRuntimeLibraryGrouped.json" : "abilityRuleRuntimeLibrary.json";
    if (priority) return popupGroups ? "abilityRuleRuntimePriorityGrouped.json" : "abilityRuleRuntimePriority.json";
    return popupGroups ? "abilityRuleRuntimeGrouped.json" : "abilityRuleRuntime.json";
}

function pickLegacyTemplate(name: TemplateName, options: RuntimeTemplateOptions): TemplateJson | undefined {
    if (!options.powerRatio) return options.optimizedDispatch ? optimizedTemplates[name] : baseTemplates[name];

    // Only grouped variants shipped with Expanded Flags and its successors.
    let pack: LegacyPack;
    if (!options.battleMessages) pack = classTemplates;
    else if (!options.customMoveFlags) pack = messageTemplates;
    else if (!options.actionResults) pack = customFlagTemplates;
    else if (!options.statSource) pack = actionResultTemplates;
    else pack = statSourcePack;
    return pack[name];
}

function pickCompactPack(options: RuntimeTemplateOptions): CompactPack {
    // Form and Zen Mode variants are picked when the recipes use those features.
    // Otherwise the saved runtime's capabilities select the pack.
    if (options.needsZenModeMessages) return zenModeMessagePack ??= JSON.parse(zenModeMessageJson);
    if (options.needsFormConversion) return formConversionTemplates;
    if (options.statusExtensions) return statusExtensionTemplates;
    if (options.weatherMoves) return weatherMoveTemplates;
    if (options.protectionBypass) return protectTemplates;
    if (options.strikes) return strikeTemplates;
    if (options.environment) return environmentTemplates;
    if (options.nativeMoveFlags) return nativeFlagTemplates;
    return compactTemplates;
}

function pickCompactTemplate(name: TemplateName, options: RuntimeTemplateOptions): TemplateJson | undefined {
    // The compact builds are variants of the templates in the stat-source pack.
    if (!statSourcePack[name]) return undefined;
    const { workSlots, needsEffectConditions, needsFieldConditions, needsFormConversion } = options;
    if (needsEffectConditions || needsFieldConditions) {
        const pack = needsEffectConditions
            ? (effectConditionPack ??= JSON.parse(effectConditionJson))
            : (fieldConditionPack ??= JSON.parse(fieldConditionJson));
        const key = needsFormConversion ? `${name}-form` : name;
        const packedTemplate = pack[key]?.[workSlots];
        if (!packedTemplate) return undefined;
        const compressed = Uint8Array.from(atob(packedTemplate), byte => byte.charCodeAt(0));
        return JSON.parse(strFromU8(unzlibSync(compressed)));
    }
    return pickCompactPack(options)[name]?.[workSlots];
}

/** Pick a bundled runtime and return a fresh copy for the DLL builder to link. */
export function createAbilityRuntimeModule(options: RuntimeTemplateOptions): RpmModule {
    if (options.powerRatio && (!options.optimizedDispatch || !options.popupGroups))
        throw new Error("Expanded Flags require the current ability runtime.");

    const name = pickTemplateName(options);
    const selected = options.compactExecution ? pickCompactTemplate(name, options) : pickLegacyTemplate(name, options);
    if (!selected) throw new Error("Missing optimized ability runtime.");

    const module = structuredClone(selected) as unknown as RpmModule;
    module.code = Uint8Array.from(selected.code);
    return module;
}
