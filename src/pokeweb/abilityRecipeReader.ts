import { equalBytes } from "../nds/binary";
import { assertNoCompetingMoveParamProviders, buildAbilityDll } from "./abilityDllBuilder";
import { defaultMoveDllFlags, moveDllFlags } from "./abilityMoveClasses";
import { decodeAbilityRecipeBook } from "./abilityRecipeBook";
import { EMPTY_ABILITY_RULE, validateAbilityRule, type AbilityRuleSet } from "./abilityRules";
import {
    ABILITY_EFFECTS_DLL_PATH, RETIRED_ABILITY_DLL, getAbilityRuntimeContext, readAbilityBlockMessage,
    readAbilityPresentationMessages, readAutomaticMoveClasses, readCustomMoveFlagRegistry,
    readMoveClassOverrides, type AbilityRuntimeContext,
} from "./abilityRuntimeContext";
import { customMoveFlagId, emptyCustomMoveFlags, type CustomMoveFlagRegistry } from "./customMoveFlags";
import { isVerifiedItemMoveParamFollower } from "./itemEffectsModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm } from "./rpm";

export const CURRENT_ABILITY_RUNTIME_VERSION = 19;

const verified = new WeakMap<ProjectState, {
    overlay: Uint8Array;
    arm9: Uint8Array;
    bytes: Uint8Array;
    files: Map<string, Uint8Array>;
    base: number;
    rules: Map<number, AbilityRuleSet>;
    peerVerified: boolean;
}>();
/** Rebuild the DLL with its saved options before returning the editable recipes. */
export function readVerifiedAbilityRules(c: AbilityRuntimeContext, { verifyItemPeer: verifyPeer = true }: { verifyItemPeer?: boolean } = {}): Map<number, AbilityRuleSet> {
    const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
    if (!bytes || equalBytes(bytes, RETIRED_ABILITY_DLL))
        return new Map();
    const cached = verified.get(c.project);
    if (cached && (!verifyPeer||cached.peerVerified) && cached.base === c.source.base && equalBytes(cached.overlay, c.overlay) && equalBytes(cached.arm9, c.project.arm9) && equalBytes(cached.bytes, bytes) && cached.files.size === c.files.size && [...c.files].every(([p, b]) => cached.files.has(p) && equalBytes(cached.files.get(p)!, b)))
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
    if(rpm.metadata.PokewebAbilityFormConversion!==undefined&&rpm.metadata.PokewebAbilityFormConversion!==1)throw Error("Unrecognized ability form and conversion runtime.");
    const formConversion=rpm.metadata.PokewebAbilityFormConversion===1;
    if(rpm.metadata.PokewebAbilityZenModeMessages!==undefined&&rpm.metadata.PokewebAbilityZenModeMessages!==1)throw Error("Unrecognized Zen Mode message runtime.");
    const zenModeMessages=rpm.metadata.PokewebAbilityZenModeMessages===1;
    if (rpm.metadata.PokewebAbilityFieldConditions !== undefined && rpm.metadata.PokewebAbilityFieldConditions !== 1)
        throw Error("Unrecognized ability field condition runtime.");
    const fieldConditions = rpm.metadata.PokewebAbilityFieldConditions === 1;
    if (rpm.metadata.PokewebAbilityEffectConditions !== undefined && rpm.metadata.PokewebAbilityEffectConditions !== 1)
        throw Error("Unrecognized ability effect-condition runtime.");
    const effectConditions = rpm.metadata.PokewebAbilityEffectConditions === 1;
    if(rpm.metadata.PokewebAbilityEnvironment!==undefined&&rpm.metadata.PokewebAbilityEnvironment!==1)throw Error("Unrecognized ability environment runtime.");
    const environment=rpm.metadata.PokewebAbilityEnvironment===1;
    if(!compactExecution&&rpm.metadata.PokewebAbilityWorkSlots!==undefined)throw Error("Invalid ability working-memory metadata.");
    if(compact!==rpm.metadata.PokewebAbilityRules.startsWith("z1:"))throw Error("Invalid ability recipe metadata format.");
    const entries: unknown = decodeAbilityRecipeBook(rpm.metadata.PokewebAbilityRules), rules = new Map<number, AbilityRuleSet>();
    if (!Array.isArray(entries) || !entries.length && !readMoveClassOverrides(c).size && !readAutomaticMoveClasses(c).size && readCustomMoveFlagRegistry(c).nextId===1 || entries.length > 255)
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
    const installedOptions = {
        clientHooks,
        popupGroups,
        optimizedDispatch: optimized,
        ownsMoveParamHook: owner,
        powerRatio: modern,
        moveClassOverrides: readMoveClassOverrides(c),
        battleMessages,
        blockMessage: readAbilityBlockMessage(c),
        presentationMessages: readAbilityPresentationMessages(c),
        // Compare the DLL with its saved classifications. Current builds also
        // look for any newly recognized moves in the project.
        automaticMoveClassDefaults: readAutomaticMoveClasses(c),
        customMoveFlags: rpm.metadata.PokewebAbilityCustomMoveFlags === 1,
        customMoveFlagRegistry: readCustomMoveFlagRegistry(c),
        actionResults: rpm.metadata.PokewebAbilityActionResults === 1,
        statSource: rpm.metadata.PokewebAbilityStatSource === 1,
        compactPackaging: compact,
        compactExecution,
        nativeMoveFlags: nativeFlags,
        environment,
        strikes,
        protectionBypass: protect,
        weatherMoves,
        statusExtensions,
        formConversion,
        zenModeMessages,
        fieldConditions,
        effectConditions,
    };
    if (!equalBytes(bytes, writeRpm(buildAbilityDll(c, rules, installedOptions), { ident: "DLXF" })) &&
        !equalBytes(bytes, writeRpm(buildAbilityDll(c, rules, { ...installedOptions, previewHook: true }), { ident: "DLXF" })))
        throw new Error("The shared ability effects DLL has been modified.");
    if(owner&&verifyPeer){
        const peer=c.files.get("patches/ItemEffects.dll");
        if(!peer||parseRpm(peer,{allowedMagics:["DLXF"]}).metadata.PokewebMoveParamAddress!==rpm.metadata.PokewebMoveParamAddress||!isVerifiedItemMoveParamFollower(c.project))throw Error("The shared item move-parameter provider is missing or modified.");
    }
    verified.set(c.project, { overlay: c.overlay.slice(), arm9: c.project.arm9.slice(), base: c.source.base, bytes: bytes.slice(), files: new Map([...c.files].map(([p, b]) => [p, b.slice()])), rules: structuredClone(rules), peerVerified:verifyPeer||!owner });
    return rules;
}
const runtimeVersionMarkers = [
    ["PokewebAbilityEffectConditions", 1, 19],
    ["PokewebAbilityFieldConditions", 1, 18],
    ["PokewebAbilityZenModeMessages", 1, 17],
    ["PokewebAbilityFormConversion", 1, 16],
    ["PokewebAbilityStatusExtensions", 1, 15],
    ["PokewebAbilityWeatherMoves", 1, 14],
    ["PokewebAbilityProtect", 1, 13],
    ["PokewebAbilityStrikes", 1, 12],
    ["PokewebAbilityEnvironment", 1, 11],
    ["PokewebAbilityNativeMoveFlags", 1, 10],
    ["PokewebAbilityCompact", 1, 9],
    ["PokewebAbilityPackaging", 1, 8],
    ["PokewebAbilityStatSource", 1, 7],
    ["PokewebAbilityActionResults", 1, 6],
    ["PokewebAbilityCustomMoveFlags", 1, 5],
    ["PokewebAbilityBattleMessages", 1, 4],
    ["PokewebAbilityPowerRatio", 1, 3],
    ["PokewebAbilityDispatchVersion", 2, 2],
] as const;

export function inspectAbilityEffects(project: ProjectState): {
    editable: boolean;
    message: string;
    rules: Map<number, AbilityRuleSet>;
    runtimeVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19;
} {
    try {
        const c = getAbilityRuntimeContext(project), rules = readVerifiedAbilityRules(c);
        if (!rules.size)
            buildAbilityDll(c, new Map([[1, validateAbilityRule(EMPTY_ABILITY_RULE)]]));
        const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
        const metadata = bytes && !equalBytes(bytes, RETIRED_ABILITY_DLL) ? parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata : undefined;
        const runtimeVersion = metadata
            ? runtimeVersionMarkers.find(([key, value]) => metadata[key] === value)?.[2] ?? 1
            : undefined;
        return { editable: true, message: rules.size ? "Shared DLL verified" : "Native ability runtime verified", rules, runtimeVersion };
    }
    catch (error) {
        return { editable: false, message: error instanceof Error ? error.message : String(error), rules: new Map() };
    }
}

export function invalidateAbilityVerification(project: ProjectState): void {
    verified.delete(project);
}


/** Native item queries may import the canonical ability-aware client service. */
export function isVerifiedAbilityClientTrapImport(project: ProjectState, path: string, address: number, size: number): boolean {
    if (path !== ABILITY_EFFECTS_DLL_PATH) return false;
    try {
        const c = getAbilityRuntimeContext(project), bytes = c.files.get(path);
        if (!bytes || parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata.PokewebAbilityClientTraps !== 1) return false;
        const service = c.resolver.resolve("IsMonTrapped");
        return service.address === address && service.code.length === size && readVerifiedAbilityRules(c).size > 0;
    } catch { return false; }
}
/** Peer runtimes may call the weather query through the verified ability adapter. */
export function isVerifiedAbilityWeatherImport(project: ProjectState, path: string, bytes: Uint8Array, address: number): boolean {
    if (path !== ABILITY_EFFECTS_DLL_PATH) return false;
    try {
        const c=getAbilityRuntimeContext(project),actual=c.files.get(path);if(!actual||!equalBytes(actual,bytes))return false;
        // Exclude the calling peers while checking the ability owner's canonical bytes.
        c.files.delete("patches/MoveEffects.dll");c.files.delete("patches/ItemEffects.dll");if(!readVerifiedAbilityRules(c, { verifyItemPeer: false }).size)return false;
        const service=c.resolver.resolve("ServerEvent_GetWeather"),rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});
        return service.address===address&&rpm.metadata.PokewebAbilityWeatherMoves===1&&rpm.relocations.some(r=>r.target.module===c.overlayModule&&r.target.address===address&&r.target.type==="THUMB_BRANCH"&&rpm.symbols[r.sourceSymbolIndex]?.name==="AbilityWeatherQuery");
    } catch { return false; }
}
/** A caller may use the canonical ability-aware move-parameter entry point. */
export function isVerifiedAbilityMoveParamImport(project: ProjectState, path: string, bytes: Uint8Array, address: number): boolean {
    if (path !== ABILITY_EFFECTS_DLL_PATH) return false;
    try {
        const c=getAbilityRuntimeContext(project),actual=c.files.get(path);if(!actual||!equalBytes(actual,bytes))return false;
        // The move owner is being verified by the caller. Exclude that one
        // module while checking the ability owner's canonical bytes, avoiding
        // recursive verification of their shared transparent imports.
        c.files.delete("patches/MoveEffects.dll");if(!readVerifiedAbilityRules(c).size)return false;
        const service=c.resolver.resolve("ServerEvent_GetMoveParam"),rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});
        return service.address===address&&rpm.relocations.some(r=>r.target.module===c.overlayModule&&r.target.address===address&&r.target.type==="THUMB_BRANCH"&&rpm.symbols[r.sourceSymbolIndex]?.name==="AbilityRecipeMoveParam");
    } catch { return false; }
}
/** Verify an owner independently when its item follower is being checked. */
export function isVerifiedAbilityMoveParamOwner(project:ProjectState):boolean {
    try{const c=getAbilityRuntimeContext(project),bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes)return false;const rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});if(rpm.metadata.PokewebMoveParamChain!=="owner")return false;return readVerifiedAbilityRules(c, { verifyItemPeer: false }).size>0;}catch{return false;}
}

export function readCalcAbilityEffects(project: ProjectState, includeRules: boolean) {
    const c = getAbilityRuntimeContext(project), rules = includeRules ? readVerifiedAbilityRules(c) : new Map<number, AbilityRuleSet>();
    const overrides = readMoveClassOverrides(c), automatic = readAutomaticMoveClasses(c, true);
    const flags = Array.from({ length: project.narcs.moves?.fileCount ?? 0 }, (_, id) => moveDllFlags(overrides, id, automatic));
    return { rules, flags, customFlags: readCustomMoveFlagRegistry(c).flags };
}

export function inspectMoveDllFlags(project: ProjectState, moveId: number): { editable: boolean; flags: number; customized: boolean; message: string } {
    try {
        if (!Number.isInteger(moveId) || moveId < 0 || moveId > 65535 || !project.narcs.moves || moveId >= project.narcs.moves.fileCount) throw Error("Reload the ROM with Moves selected.");
        const c = getAbilityRuntimeContext(project); readVerifiedAbilityRules(c);
        const overrides = readMoveClassOverrides(c);
        return { editable: true, flags: moveDllFlags(overrides, moveId, readAutomaticMoveClasses(c,true)), customized: overrides.has(moveId), message: "" };
    } catch (error) {
        return { editable: false, flags: defaultMoveDllFlags(moveId), customized: false, message: error instanceof Error ? error.message : String(error) };
    }
}

export function inspectCustomMoveFlags(project: ProjectState): {editable:boolean;message:string;registry:CustomMoveFlagRegistry;references:Record<number,number[]>} {
    try{
        const c=getAbilityRuntimeContext(project),rules=readVerifiedAbilityRules(c),registry=readCustomMoveFlagRegistry(c),references:Record<number,number[]>={};
        for(const[id,rule]of rules)for(const effect of rule.effects){const flag=customMoveFlagId(effect.parameters?.moveClass??0);if(flag!==undefined&&!(references[flag]??=[]).includes(id))references[flag].push(id);}
        return{editable:true,message:"",registry,references};
    }catch(error){return{editable:false,message:error instanceof Error?error.message:String(error),registry:emptyCustomMoveFlags(),references:{}};}
}
