import { equalBytes, writeU16, writeU32 } from "../nds/binary";
import { abilityRuleEvents } from "./abilityEvents";
import { linkNativeAbilities } from "./abilityNativeRuntime";
import type { AbilityRuleSet } from "./abilityRules";
import { ABILITY_EFFECTS_DLL_PATH, RETIRED_ABILITY_DLL, type AbilityRuntimeContext } from "./abilityRuntimeContext";
import { resolveBattleConditionReaders } from "./battleFieldConditionBindings";
import { isVerifiedBattleCounterImport } from "./battleLogModel";
import { battleBranchTarget } from "./battleRuntimeBindings";
import { isVerifiedModernStatusImport } from "./frostbiteSnowModel";
import { isVerifiedMoveFieldSwitchImport, isVerifiedMoveServiceImport } from "./moveEffectsModel";
import { parseRpm, type RpmModule, type RpmRelocationType } from "./rpm";

/**
 * Mega Evolution replaces GiratinaArceusGenesectItemCheck whole (a Mega Stone can't be removed, swapped or knocked off
 * its species), keeping its arguments and result: calls into it, and service pointers to it, reach the replacement,
 * which is the check the rules should see. A copied body would bypass it, so copies still count as a conflict.
 */
export function isVerifiedMegaItemCheckImport(version: string, path: string, name: string, address: number, start: number, type: string): boolean {
    return name === "GiratinaArceusGenesectItemCheck" && start === address && type === "THUMB_BRANCH"
        && ["W2", "B2", "W", "B"].includes(version) && path.toLowerCase() === `patches/pokewebmega${version.toLowerCase()}.dll`;
}
function assertUnhooked(
    context: AbilityRuntimeContext,
    name: string,
    address: number,
    size: number,
    copied = false,
    allowItemMoveParamHook = false,
): void {
    const module = context.signatures[name].module;
    const relocationModule = module === "ARM9" ? "0" : module;
    for (const [path, bytes] of context.files) {
        if (path === ABILITY_EFFECTS_DLL_PATH) continue;
        if (allowItemMoveParamHook && name === "ServerEvent_GetMoveParam" && path === "patches/ItemEffects.dll") continue;

        let installed: RpmModule;
        try {
            installed = parseRpm(bytes, { allowedMagics: ["DLXF"] });
        } catch {
            continue;
        }
        for (const relocation of installed.relocations) {
            const target = relocation.target;
            if (target.module !== relocationModule) continue;
            const start = target.address & ~1;
            const count = target.type === "FULL_COPY"
                ? installed.symbols[relocation.sourceSymbolIndex]?.size ?? 0
                : target.type === "OFFSET" ? 4 : 16;
            if (!(start < address + size && start + count > address)) continue;

            if (name === "IsMonTrapped" && isVerifiedMoveFieldSwitchImport(context.project, path, bytes, address, size)) continue;
            // Direct calls can use these verified replacements. Copying a
            // native routine would bypass the installed replacement.
            if (!copied && isVerifiedMoveServiceImport(context.project, path, bytes, name, address)) continue;
            if (!copied && isVerifiedModernStatusImport(path, installed, name, address, relocation)) continue;
            const version = context.project.session.baseVersion;
            if (!copied && isVerifiedMegaItemCheckImport(version, path, name, address, start, target.type)) continue;
            if (!copied && name === "IsFainted" && module === "167" && start === address
                && target.type === "THUMB_BRANCH" && isVerifiedBattleCounterImport(version, path, bytes, address)) continue;
            throw new Error(`Conflicting ability service hook: ${path} (${name}).`);
        }
    }
}

// Each index is a fixed slot in AbilityRuleApi. Copied adapters fill reserved slots separately.
export const ABILITY_RULE_API = [
    "BattleEventVar_GetValue",
    "BattleEventVar_MulValue",
    "GetBattleMon",
    "GetBattleMonStat",
    "GetPokeType",
    "PokeTypePair_IsMatch",
    "ServerEvent_GetWeather",
    "BtlServerFlow_IsSimulating",
    "BtlServerFlow_CheckMatchup",
    "BattleHandler_PushWork",
    "BattleHandler_PopWork",
    "BattleHandler_StrSetup",
    "BattleHandler_AddArg",
    "BattleEventItem_GetSubID",
    "BattleEvent_AddItem",
    "GetMonID",
    "RawBattleMonStat",
    "PML_MoveGetCategory",
    null,
    null,
    "BattleHandler_PushRun",
    null,
    null,
    "IsStatChangeValid",
    "BtlCalc_MakeStatusCondition",
    "MakeConditionBadlyPoisoned",
    "BattleEventVar_GetValueIfExist",
    "RollEffectChance",
    "BattleEventVar_RewriteValue",
    "GetBattleMonSpecies",
    "CheckCondition",
    "getMoveFlag",
    "BattleEvent_CheckSkip",
] as const;

export function assertNoCompetingMoveParamProviders(context: AbilityRuntimeContext): void {
    for (const [path, bytes] of context.files) {
        if (path === ABILITY_EFFECTS_DLL_PATH || path === "patches/ItemEffects.dll" || equalBytes(bytes, RETIRED_ABILITY_DLL)) continue;
        let installed: RpmModule;
        try {
            installed = parseRpm(bytes, { allowedMagics: ["DLXF"] });
        } catch {
            continue;
        }
        if (installed.symbols.some(symbol => (symbol.attributes & 1) && (symbol.name === "RuleGetMoveParam" || symbol.nameHash === 0x387d450d)))
            throw new Error(`Conflicting move-parameter provider: ${path}.`);
    }
}

export function requireAbilitySymbol(rpm: RpmModule, name: string) {
    const symbol = rpm.symbols.find(symbol => symbol.name === name);
    if (!symbol)
        throw new Error(`Missing ability runtime symbol: ${name}`);
    return symbol;
}

export function appendAbilitySection(rpm: RpmModule, bytes: Uint8Array, type: "FUNCTION_THM" | "SECTION"): number {
    const address = (rpm.code.length + 3) & ~3;
    const expanded = new Uint8Array(address + bytes.length);
    expanded.set(rpm.code);
    expanded.set(bytes, address);
    rpm.code = expanded;
    rpm.symbols.push({ name: null, address, size: bytes.length, type, attributes: 0 });
    return rpm.symbols.length - 1;
}

type AbilityHookOptions = {
    previewHook: boolean;
    popupGroups: boolean;
    library: boolean;
    priority: boolean;
    recipes: boolean;
    allowItemMoveParamHook: boolean;
    battleMessages: boolean;
    zenMode: boolean;
    convertType: boolean;
    statSource: boolean;
    hasFieldCondition: boolean;
    hasSideCondition: boolean;
    environment: boolean;
    strikes: boolean;
    protectionBypass: boolean;
    weatherMoves: boolean;
    statusExtensions: boolean;
    scoped: boolean;
    usesKnownMoves: boolean;
    usesConditionSubjects: boolean;
};

type CopiedHookOptions = {
    service: string;
    originalPointer: number | string;
    wrapper: string;
    branchType?: RpmRelocationType;
    dependencyLabel: string;
    forceThumbDependencies?: boolean;
    allowItemMoveParamHook?: boolean;
    dependencyOverride?: { service: string; wrapper: string };
};

/** Keep a copy of the original routine for the wrapper to call and reconnect its native dependencies. */
function linkCopiedHook(rpm: RpmModule, context: AbilityRuntimeContext, {
    service, originalPointer, wrapper, branchType = "THUMB_BRANCH", dependencyLabel,
    forceThumbDependencies = false, allowItemMoveParamHook = false, dependencyOverride,
}: CopiedHookOptions): void {
    const { address, code } = context.resolver.resolve(service);
    assertUnhooked(context, service, address, code.length, true, allowItemMoveParamHook);
    const original = appendAbilitySection(rpm, code, "FUNCTION_THM");
    const originalAddress = rpm.symbols[original].address;
    const pointerAddress = typeof originalPointer === "string" ? requireAbilitySymbol(rpm, originalPointer).address : originalPointer;
    rpm.relocations.push(
        { target: { module: "base", address: pointerAddress, type: "OFFSET" }, sourceSymbolIndex: original },
        { target: { module: context.overlayModule, address, type: branchType }, sourceSymbolIndex: rpm.symbols.indexOf(requireAbilitySymbol(rpm, wrapper)) },
    );

    for (const call of context.signatures[service].calls) {
        const target = battleBranchTarget(code, call.offset, address);
        if (!context.resolver.matches(call.target, target))
            throw new Error(`Unrecognized ${dependencyLabel} dependency: ${call.target}`);
        const signature = context.signatures[call.target];
        assertUnhooked(context, call.target, target, signature.hex.length / 2);
        let targetSymbolIndex: number;
        if (dependencyOverride?.service === call.target) {
            targetSymbolIndex = rpm.symbols.indexOf(requireAbilitySymbol(rpm, dependencyOverride.wrapper));
        } else {
            const type = !forceThumbDependencies && signature.thumb === false ? "FUNCTION_ARM" : "FUNCTION_THM";
            rpm.symbols.push({ name: null, address: target, size: 0, type, attributes: 4 });
            targetSymbolIndex = rpm.symbols.length - 1;
        }
        rpm.relocations.push({
            target: { module: "base", address: originalAddress + call.offset, type: "THUMB_BRANCH_LINK" },
            sourceSymbolIndex: targetSymbolIndex,
        });
    }
}

/** Fill service pointers and attach the hooks required by this runtime. */
export function linkAbilityRuntimeHooks(rpm: RpmModule, context: AbilityRuntimeContext, entries: ReadonlyMap<number, AbilityRuleSet>, {
    previewHook, popupGroups, library, priority, recipes, allowItemMoveParamHook, battleMessages, zenMode,
    convertType, statSource, hasFieldCondition, hasSideCondition, environment, strikes, protectionBypass,
    weatherMoves, statusExtensions, scoped, usesKnownMoves, usesConditionSubjects,
}: AbilityHookOptions): void {
    const named = (name: string) => requireAbilitySymbol(rpm, name);
    const writeNativeService = (name: string, pointerAddress: number) => {
        const service = context.resolver.resolve(name);
        assertUnhooked(context, name, service.address, service.code.length);
        writeU32(rpm.code, pointerAddress, service.address | 1);
        return service;
    };
    const api = named("AbilityRuleApi").address;
    ABILITY_RULE_API.forEach((name, index) => {
        if (name) writeNativeService(name, api + index * 4);
    });
    if (library || recipes) {
        writeNativeService("BtlCalc_GetEffectivenessCategory", api + 34 * 4);
        writeNativeService("PML_MoveGetParam", api + 35 * 4);
    }

    if (entries.size) {
        const adapters: Array<[service: string, apiIndex: number, wrapper: string]> = [
            ["AbilityEvent_AddItem", 18, "AbilityDispatch"],
            ["HandlerMoldBreakerSkipCheck", 19, "AbilityMoldSkip"],
        ];
        if (popupGroups) adapters.push(["BattleHandler_PushRun", 20, "AbilityPopupRun"]);
        for (const [service, apiIndex, wrapper] of adapters) {
            linkCopiedHook(rpm, context, {
                service, originalPointer: api + apiIndex * 4, wrapper, dependencyLabel: "ability", forceThumbDependencies: true,
                branchType: service === "HandlerMoldBreakerSkipCheck" && !previewHook ? "THUMB_BRANCH_SAFESTACK" : "THUMB_BRANCH",
            });
        }
    }

    if (priority) {
        const remove = context.resolver.resolve("AbilityEvent_RemoveItem");
        const swap = context.resolver.resolve("AbilityEvent_Swap");
        assertUnhooked(context, "AbilityEvent_RemoveItem", remove.address, remove.code.length);
        assertUnhooked(context, "AbilityEvent_Swap", swap.address, swap.code.length, true);
        writeU32(rpm.code, api + 33 * 4, remove.address | 1);
        rpm.relocations.push({
            target: { module: context.overlayModule, address: swap.address, type: "THUMB_BRANCH" },
            sourceSymbolIndex: rpm.symbols.indexOf(named("AbilitySwap")),
        });
    }

    if (recipes) {
        const recipeApi = named("AbilityRecipeApi").address;
        const services = [
            "BattleEvent_CallHandlers", "BattleEventVar_Push", "BattleEventVar_Pop", "BattleEventVar_SetConstValue",
            "IsAllyMonID", "BtlServerFlow_IsMonInBattle", "BtlServerFlow_IsSideEffectSet", "GetSideFromMonID",
            "PML_ItemIsBerry", "CommonAbilityCureStatusCore", "GetFieldWeather", "MakeConditionPermanentTurnsParam",
            "GetBattleMonHeldItem", "BtlServerFlow_IsTargetOutOfRange", "IsSubstituteActive", "GetAdditionalConditionFlag",
        ];
        services.forEach((name, index) => writeNativeService(name, recipeApi + (6 + index) * 4));
        if (battleMessages) writeNativeService("BtlServerFlow_GetSideEffectLayers", recipeApi + 23 * 4);

        // The dispatcher core is linked first to preserve the saved DLL's relocation order.
        const adapters = [
            ["BattleEvent_CallHandlersCore", 22, "AbilityRecipeHandlers"],
            ["BattleEvent_Init", 0, "AbilityRecipeInit"],
            ["ServerEvent_GetMoveParam", 1, "AbilityRecipeMoveParam"],
            ["ServerEvent_CheckCritical", 2, "AbilityRecipeCritical"],
            ["ServerControl_CheckMoveEffectiveness", 3, "AbilityRecipeEffectiveness"],
            ["ServerControl_ChangeHeldItem", 4, "AbilityRecipeChangeItem"],
            ["BattleHandler_ForceUseItem", 5, "AbilityRecipeForceItem"],
        ] as const;
        for (const [service, apiIndex, wrapper] of adapters) {
            linkCopiedHook(rpm, context, {
                service, originalPointer: recipeApi + apiIndex * 4, wrapper, dependencyLabel: "recipe", allowItemMoveParamHook,
                branchType: service === "ServerControl_CheckMoveEffectiveness" ? "THUMB_BRANCH_SAFESTACK" : "THUMB_BRANCH",
                dependencyOverride: service === "ServerEvent_CheckCritical"
                    ? { service: "BattleEvent_CallHandlers", wrapper: "AbilityRecipeCriticalHandlers" }
                    : undefined,
            });
        }
    }
    if (zenMode || convertType) {
        const formApi = named("AbilityFormConversionApi").address;
        const isBw1 = context.project.session.baseRom === "BW";
        if (zenMode) {
            const names = isBw1
                ? ["BW1_POKE_TOOL_GetPersonalParam", "BW1_POKE_TOOL_GetPartyValue", "BW1_POKE_TOOL_SetPartyValue"]
                : ["PML_PersonalGetParamSingle", "PokeParty_GetParam", "PokeParty_SetParam"];
            names.forEach((name, index) => writeNativeService(name, formApi + (index + 1) * 4));
        }
        if (convertType) {
            linkCopiedHook(rpm, context, {
                service: isBw1 ? "BW1_BTL_SERVER_FLOW_CalcMovePower" : "ServerEvent_GetMovePower",
                originalPointer: formApi,
                wrapper: "AbilityRecipePower",
                dependencyLabel: "move power",
            });
        }
    }
    const effects = [...entries.values()].flatMap(rule => rule.effects);
    const effectKinds = new Set(effects.map(effect => effect.kind));
    if (statSource && (effectKinds.has("abilityRecipe:abilityStatGuard") || statusExtensions && effectKinds.has("abilityRecipe:statusFollowup"))) {
        const name = "BattleEvent_CallHandlersSub";
        const service = context.resolver.resolve(name);
        assertUnhooked(context, name, service.address, service.code.length, true);

        const sites: number[] = [];
        const callbackCall = [0x1c, 0x33, 0xb0, 0x47];
        for (let offset = 0; offset + callbackCall.length <= service.code.length; offset += 2) {
            if (callbackCall.every((byte, index) => service.code[offset + index] === byte)) sites.push(offset);
        }
        if (sites.length !== 1) throw new Error("Unrecognized native callback dispatch site.");
        rpm.relocations.push({
            target: { module: context.overlayModule, address: service.address + sites[0], type: "THUMB_BRANCH_LINK" },
            sourceSymbolIndex: rpm.symbols.indexOf(named("AbilityNativeCallback")),
        });
    }
    if (hasFieldCondition || hasSideCondition) {
        const fieldApi = named("AbilityFieldConditionApi").address;
        const readers = resolveBattleConditionReaders(context.resolver, hasFieldCondition, hasSideCondition, (name, address, size) => {
            assertUnhooked(context, name, address, size);
        });
        readers.forEach((address, index) => writeU32(rpm.code, fieldApi + index * 4, address));
    }
    if (environment && recipes) {
        const setsField = effectKinds.has("abilityRecipe:fieldEntry");
        const setsSide = effectKinds.has("abilityRecipe:sideEntry");
        const guardsQueuedDamage = effects.some(effect => effect.kind === "abilityRecipe:damageGuard" && ((effect.parameters?.sources ?? 3) & 0x3f80));
        const envApi = named("AbilityEnvironmentApi").address;
        if (setsField) writeNativeService("IsFieldEffectActive", envApi);
        if (setsField || setsSide) {
            writeNativeService("SetConditionTurns", envApi + 4);
            writeNativeService("BattleHandler_StrSetup", envApi + 8);
            writeNativeService("BattleHandler_AddArg", envApi + 12);
        }
        if (guardsQueuedDamage) {
            const checkDamage = writeNativeService("AbilityCheckIndirectDamage", envApi + 16);
            const event = context.resolver.resolve("AbilityIndirectDamageEvent");
            assertUnhooked(context, "AbilityIndirectDamageEvent", event.address, event.code.length);
            if (battleBranchTarget(checkDamage.code, 2, checkDamage.address) !== event.address)
                throw new Error("Changed native indirect-damage query.");
            for (const call of context.signatures.AbilityIndirectDamageEvent.calls) {
                if (!context.resolver.matches(call.target, battleBranchTarget(event.code, call.offset, event.address)))
                    throw new Error(`Changed native damage-event dependency: ${call.target}`);
            }

            const site = context.resolver.resolve("AbilityIndirectDamageBoundary");
            assertUnhooked(context, "AbilityIndirectDamageBoundary", site.address, site.code.length);
            if (battleBranchTarget(site.code, 6, site.address) !== context.resolver.resolve("AbilityCheckIndirectDamage").address)
                throw new Error("Changed native indirect-damage dependency.");
            rpm.relocations.push({
                target: { module: context.overlayModule, address: site.address + 6, type: "THUMB_BRANCH_LINK" },
                sourceSymbolIndex: rpm.symbols.indexOf(named("AbilityIndirectDamageSite")),
            });
        }
    }
    if (strikes && effectKinds.has("abilityRecipe:additionalStrike")) {
        const boundary = context.resolver.resolve("AbilityStrikeBoundary");
        const strikeApi = named("AbilityStrikeApi").address;
        const services = [
            [0, "AbilityStrikeNativeCount", 54, "AbilityStrikeCountSite"],
            [1, "AbilityStrikeNativeEnd", 184, "AbilityStrikeEndSite"],
            [2, "AbilityStrikeTargetCount", 94, ""],
        ] as const;
        for (const [index, name, offset, wrapper] of services) {
            const service = context.resolver.resolve(name);
            assertUnhooked(context, name, service.address, service.code.length);
            if (battleBranchTarget(boundary.code, offset, boundary.address) !== service.address)
                throw new Error(`Changed native strike dependency: ${name}`);
            writeU32(rpm.code, strikeApi + index * 4, service.address | 1);
            if (wrapper) {
                assertUnhooked(context, "AbilityStrikeBoundary", boundary.address + offset, 4);
                rpm.relocations.push({
                    target: { module: context.overlayModule, address: boundary.address + offset, type: "THUMB_BRANCH_LINK" },
                    sourceSymbolIndex: rpm.symbols.indexOf(named(wrapper)),
                });
            }
        }
    }
    if (protectionBypass && effectKinds.has("abilityRecipe:protectBypass")) {
        // Protect and Detect use the native protect-break event. The dispatcher
        // wrapper pauses the side items for Wide Guard and Quick Guard.
        const protectApi = named("AbilityProtectApi").address;
        writeNativeService("GetTurnFlag", protectApi);
        writeNativeService("BattleEvent_SeekItem", protectApi + 4);
    }
    if (weatherMoves && effectKinds.has("abilityRecipe:moveWeather")) {
        // Outside the holder's move sequence the adapter calls the relocated native weather query.
        linkCopiedHook(rpm, context, {
            service: "ServerEvent_GetWeather",
            originalPointer: "AbilityWeatherApi",
            wrapper: "AbilityWeatherQuery",
            dependencyLabel: "weather",
        });
    }
    if (statusExtensions && recipes) {
        const statusApi = named("AbilityStatusApi").address;
        const followsStatus = effectKinds.has("abilityRecipe:statusFollowup");
        if (effectKinds.has("abilityRecipe:windCharge")) {
            writeNativeService("PML_MoveGetType", statusApi + 4);
            writeNativeService("BattleEvent_SeekItem", statusApi + 8);
        }
        if (followsStatus) {
            writeNativeService("BattleRandom", statusApi + 12);
            writeNativeService("SetConditionTurns", statusApi + 16);
        }
        if (effectKinds.has("abilityRecipe:statusTypeBypass") || followsStatus) {
            const site = context.resolver.resolve("AbilityStatusBoundary");
            const original = context.resolver.resolve("AbilityStatusNativeCheck");
            assertUnhooked(context, "AbilityStatusBoundary", site.address, site.code.length);
            assertUnhooked(context, "AbilityStatusNativeCheck", original.address, original.code.length);
            if (battleBranchTarget(site.code, 24, site.address) !== original.address)
                throw new Error("Changed native status-immunity boundary.");
            for (const call of context.signatures.AbilityStatusNativeCheck.calls) {
                const target = battleBranchTarget(original.code, call.offset, original.address);
                if (!context.resolver.matches(call.target, target)) throw new Error(`Changed native status dependency: ${call.target}`);
                assertUnhooked(context, call.target, target, context.signatures[call.target].hex.length / 2);
            }
            writeU32(rpm.code, statusApi, original.address | 1);
            rpm.relocations.push({
                target: { module: context.overlayModule, address: site.address + 24, type: "THUMB_BRANCH_LINK" },
                sourceSymbolIndex: rpm.symbols.indexOf(named("AbilityStatusCheckSite")),
            });
        }
    }
    if (scoped) {
        const scopedApi = named("AbilityScopedApi").address;
        const services = [
            "GetTurnCounter", "PokeTypePair_MakeMonotype", "IsItemSwapBlocked",
            "IsItemUnremovable", "GiratinaArceusGenesectItemCheck", "BattleMon_SetType",
        ];
        services.forEach((name, index) => writeNativeService(name, scopedApi + index * 4));
    }
    if (usesKnownMoves || usesConditionSubjects) {
        const conditionsApi = named("AbilityPokemonConditionApi").address;
        if (usesKnownMoves) writeNativeService("MoveGetID", conditionsApi);
        if (usesConditionSubjects) {
            writeNativeService("IsAllyMonID", conditionsApi + 4);
            writeNativeService("BtlServerFlow_IsMonInBattle", conditionsApi + 8);
        }
    }
}

/** Link copied ability handlers and build the tables that map battle events to callbacks. */
export function linkAbilityRuleHandlers(
    rpm: RpmModule,
    context: AbilityRuntimeContext,
    entries: ReadonlyMap<number, AbilityRuleSet>,
    ruleDataAddress: number,
    { compactExecution, optimizedDispatch, battleMessages, formConversion }: {
        compactExecution: boolean;
        optimizedDispatch: boolean;
        battleMessages: boolean;
        formConversion: boolean;
    },
): void {
    linkNativeAbilities(rpm, entries, ruleDataAddress, context.resolver.resolve,
        (name, address, size, copied) => assertUnhooked(context, name, address, size, copied),
        context.profiles, context.signatures, compactExecution);
    if (!optimizedDispatch) return;

    const tablePointers = requireAbilitySymbol(rpm, "AbilityRuleEventTables").address;
    const eventCounts = requireAbilitySymbol(rpm, "AbilityRuleEventCounts").address;
    const sharedTables = new Map<string, number>();
    for (const [id, rule] of [...entries].sort(([a], [b]) => a - b)) {
        const events = abilityRuleEvents(rule, context.profiles, battleMessages, formConversion);
        const key = events.join(",");
        rpm.code[eventCounts + id] = events.length;
        if (!events.length) continue;

        let tableSymbol = sharedTables.get(key);
        if (tableSymbol === undefined) {
            // Each record stores an event ID and a pointer to its callback.
            const table = new Uint8Array(events.length * 8);
            events.forEach((event, index) => writeU32(table, index * 8, event));
            tableSymbol = appendAbilitySection(rpm, table, "SECTION");
            sharedTables.set(key, tableSymbol);
            const tableAddress = rpm.symbols[tableSymbol].address;
            events.forEach((event, index) => {
                const callback = requireAbilitySymbol(rpm, `AbilityEvent_${event.toString(16).padStart(2, "0")}`);
                rpm.relocations.push({
                    target: { module: "base", address: tableAddress + index * 8 + 4, type: "OFFSET" },
                    sourceSymbolIndex: rpm.symbols.indexOf(callback),
                });
            });
        }
        rpm.relocations.push({
            target: { module: "base", address: tablePointers + id * 4, type: "OFFSET" },
            sourceSymbolIndex: tableSymbol,
        });
    }
}

export function linkAbilityClientTraps(rpm: RpmModule, context: AbilityRuntimeContext, entries: ReadonlyMap<number, AbilityRuleSet>): void {
    const named = (name: string) => requireAbilitySymbol(rpm, name);
    const original = context.resolver.resolve("IsMonTrapped");
    assertUnhooked(context, "IsMonTrapped", original.address, original.code.length, true);
    const prefix = [0xf0, 0xb5, 0x85, 0xb0, 0x0e, 0x1c, 0x05, 0x1c];
    if (!prefix.every((v, i) => original.code[i] === v)) throw new Error("Unrecognized client trapping prologue.");
    // Run the untouched native remainder at its original address. Its first
    // eight bytes have no PC-relative instructions; r4 is assigned locally.
    const gateway = new Uint8Array(16);
    gateway.set(original.code.subarray(0, 8));
    writeU16(gateway, 8, 0x4c00);
    writeU16(gateway, 10, 0x4720);
    writeU32(gateway, 12, (original.address + 8) | 1);
    const gatewaySymbol = appendAbilitySection(rpm, gateway, "FUNCTION_THM");
    const clientApi = named("AbilityClientApi").address;
    rpm.relocations.push(
        { target: { module: "base", address: clientApi, type: "OFFSET" }, sourceSymbolIndex: gatewaySymbol },
        {
            target: { module: context.overlayModule, address: original.address, type: "THUMB_BRANCH" },
            sourceSymbolIndex: rpm.symbols.indexOf(named("AbilityClientTrapped")),
        },
    );
    const services = ["MonIDToBattlePos", "ExpandPosFlagsToMonIDs", "GetPokeParam", "DoesMonHaveType"];
    for (const [index, name] of services.entries()) {
        const service = context.resolver.resolve(name);
        assertUnhooked(context, name, service.address, service.code.length);
        writeU32(rpm.code, clientApi + (index + 1) * 4, service.address | 1);
    }
    const table = named("AbilityClientTrapTypes").address;
    for (const [id, rule] of entries) {
        const effect = rule.effects.find(e => e.kind === "nativeAbility:42");
        if (effect) rpm.code[table + id] = (effect.parameters?.trapType ?? 8) + 1;
    }
}
