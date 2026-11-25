import { recordFieldChange } from "./actionChangelog";
import { ensureAbilityBlockMessages, ensureAbilityPresentationMessages } from "./abilityBattleMessages";
import { buildAbilityDll, validateCustomFlagReferences } from "./abilityDllBuilder";
import {
    CURRENT_ABILITY_RUNTIME_VERSION, inspectAbilityEffects, inspectCustomMoveFlags, inspectMoveDllFlags,
    invalidateAbilityVerification, readVerifiedAbilityRules,
} from "./abilityRecipeReader";
import { recipeAbilityEffect } from "./abilityRecipeEffects";
import { abilityExecutionSignature } from "./abilityRecipeOptimization";
import { nativeAbilityProfile } from "./abilityNativeRuntime";
import { EMPTY_ABILITY_RULE, validateAbilityRule, type AbilityRuleSet } from "./abilityRules";
import {
    ABILITY_EFFECTS_DLL_PATH, RETIRED_ABILITY_DLL, getAbilityRuntimeContext, hasOriginalAbilityDll,
    readAbilityBlockMessage, readAbilityPresentationMessages, readAutomaticMoveClasses, readCustomMoveFlagRegistry,
    readMoveClassOverrides, type AbilityRuntimeContext,
} from "./abilityRuntimeContext";
import { defaultMoveDllFlags } from "./abilityMoveClasses";
import { normalizeAbilityDescription, updateAbilityDescription } from "./abilityTextModel";
import { installCodeInjectionPatch, withProjectMutationLock } from "./codeInjectionInstall";
import { customMoveFlagName, emptyCustomMoveFlags, MAX_CUSTOM_MOVE_FLAGS, validateCustomMoveFlags, type CustomMoveFlagRegistry } from "./customMoveFlags";
import { ensureFileSystemState, setRomFileReplacement } from "./fileSystemModel";
import { prepareItemMoveParamForAbility } from "./itemEffectsModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { detectSpecifyTrainerNaturesPatch, specifyTrainerNatures } from "./romPatchModel";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { addTextEntries, getTextBank, updateTextEntry } from "./textModel";

// The editor's entry points also expose the read and build operations used by
// other editors and ROM tooling.
export { ABILITY_RULE_API, buildAbilityRuleModule, isVerifiedMegaItemCheckImport } from "./abilityDllBuilder";
export {
    CURRENT_ABILITY_RUNTIME_VERSION, inspectAbilityEffects, inspectCustomMoveFlags, inspectMoveDllFlags,
    isVerifiedAbilityClientTrapImport, isVerifiedAbilityMoveParamImport, isVerifiedAbilityMoveParamOwner,
    isVerifiedAbilityWeatherImport, readCalcAbilityEffects,
} from "./abilityRecipeReader";
export { ABILITY_EFFECTS_DLL_PATH, hydrateAbilityEffectsSource, supportsAbilityEditor } from "./abilityRuntimeContext";

/** Serialize the built module and stage it for ROM export. */
function stageAbilityDll(project: ProjectState, module: RpmModule): void {
    stageCodeInjectionDll(project, "AbilityEffects.dll", writeRpm(module, { ident: "DLXF" }));
}

function retireAbilityDll(c: AbilityRuntimeContext): void {
    const { project } = c;
    const files = ensureFileSystemState(project);
    delete files.additions![ABILITY_EFFECTS_DLL_PATH];
    const fileId = c.source.ids.get(ABILITY_EFFECTS_DLL_PATH);
    if (fileId !== undefined)
        setRomFileReplacement(project, fileId, RETIRED_ABILITY_DLL.slice());
    if (project.codeInjection?.modules)
        project.codeInjection.modules = project.codeInjection.modules.filter(module => module.path !== ABILITY_EFFECTS_DLL_PATH);
}

/** Replace only the verified shared runtime; ability data and text stay intact. */
export async function upgradeAbilityRuntime(project: ProjectState, refreshMoveClasses = false): Promise<boolean> {
    const state = inspectAbilityEffects(project);
    if (!state.editable) throw new Error(state.message);
    if (state.runtimeVersion === undefined || state.runtimeVersion === CURRENT_ABILITY_RUNTIME_VERSION && !refreshMoveClasses) return false;
    await installCodeInjectionPatch(project, async staged => {
        if (detectSpecifyTrainerNaturesPatch(staged) === "legacy") await specifyTrainerNatures(staged);
        const c = getAbilityRuntimeContext(staged), rules = readVerifiedAbilityRules(c);
        const needsProvider = [...rules.values()].some(rule => rule.effects.some(effect => recipeAbilityEffect(effect.kind)));
        const item = c.files.has("patches/ItemEffects.dll") ? prepareItemMoveParamForAbility(staged, needsProvider, refreshMoveClasses ? { overrides:readMoveClassOverrides(c),customFlags:readCustomMoveFlagRegistry(c) } : undefined) : { present: false };
        const blockMessage=ensureAbilityBlockMessages(staged,rules)??readAbilityBlockMessage(c);
        const presentationMessages=ensureAbilityPresentationMessages(staged,rules)??readAbilityPresentationMessages(c);
        const chain = needsProvider && item.present;
        const module = buildAbilityDll(c, rules, {
            ownsMoveParamHook: chain,
            allowItemMoveParamHook: chain,
            blockMessage,
            presentationMessages,
        });
        if (chain && module.metadata.PokewebMoveParamAddress !== item.address) throw Error("The shared ability and item hooks resolve to different native services.");
        if (item.module) stageCodeInjectionDll(staged, "ItemEffects.dll", writeRpm(item.module, { ident: "DLXF" }));
        stageAbilityDll(staged, module);
        recordFieldChange(staged, "message_texts", "Ability runtime", "Event dispatch", "Previous routines", "Filtered events and short-circuit conditions", { key: "ability-runtime" });
    });
    invalidateAbilityVerification(project);
    return true;
}

/** Prebuild the checked ability side of a prospective item transition. */
export function prepareAbilityMoveParamForItem(project:ProjectState,providerPresent:boolean):{chain:boolean;module?:RpmModule;address?:number} {
    if(project.session.baseRom!=="BW2")return {chain:false};
    const c=getAbilityRuntimeContext(project),rules=readVerifiedAbilityRules(c);if(!rules.size)return {chain:false};
    const recipes=[...rules.values()].some(r=>r.effects.some(e=>recipeAbilityEffect(e.kind)));
    const chain=providerPresent&&recipes,bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH)!,rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});
    if((rpm.metadata.PokewebMoveParamChain==="owner")===chain)return {chain,...(chain?{address:Number(rpm.metadata.PokewebMoveParamAddress)}:{})};
    const module = buildAbilityDll(c, rules, {
        ownsMoveParamHook: chain,
        allowItemMoveParamHook: true,
    });
    return {chain,module,...(chain?{address:Number(module.metadata.PokewebMoveParamAddress)}:{})};
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
    const c = getAbilityRuntimeContext(project), rules = readVerifiedAbilityRules(c), seen = new Set<number>();
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
    const preflight = buildAbilityDll(c, rules, {
        ownsMoveParamHook: chain,
        allowItemMoveParamHook: chain,
    });
    if(chain&&preflight.metadata.PokewebMoveParamAddress!==itemPlan.address)throw Error("The shared ability and item hooks resolve to different native services.");
    await installCodeInjectionPatch(project, async staged => {
        // The legacy inline helper shares memory with the live DLL loader.
        // Preserve the installed feature through its verified PMC migration.
        if (detectSpecifyTrainerNaturesPatch(staged) === "legacy") await specifyTrainerNatures(staged);
        const stagedContext=getAbilityRuntimeContext(staged),stagedItem:{present:boolean;module?:RpmModule;address?:number}=stagedContext.files.has("patches/ItemEffects.dll")?prepareItemMoveParamForAbility(staged,needsProvider):{present:false};
        const stagedChain=needsProvider&&stagedItem.present;
        const blockMessage=ensureAbilityBlockMessages(staged,rules)??readAbilityBlockMessage(stagedContext);
        const presentationMessages=ensureAbilityPresentationMessages(staged,rules)??readAbilityPresentationMessages(stagedContext);
        const stagedAbility = buildAbilityDll(stagedContext, rules, {
            ownsMoveParamHook: stagedChain,
            allowItemMoveParamHook: stagedChain,
            blockMessage,
            presentationMessages,
        });
        if(stagedChain&&stagedAbility.metadata.PokewebMoveParamAddress!==stagedItem.address)throw Error("The shared ability and item hooks resolve to different native services.");
        if(stagedItem.module)stageCodeInjectionDll(staged,"ItemEffects.dll",writeRpm(stagedItem.module,{ident:"DLXF"}));
        stageAbilityDll(staged, stagedAbility);
        for (const edit of checked) {
            if (edit.name)
                setName(staged, edit.abilityId, edit.name);
            if (edit.description !== undefined) updateAbilityDescription(staged, edit.abilityId, edit.description);
            recordFieldChange(staged, "message_texts", edit.name ?? `Ability ${edit.abilityId}`, "Battle effects", "Previous effect", JSON.stringify(edit.rules), { key: `ability-rules:${edit.abilityId}` });
        }
    });
    invalidateAbilityVerification(project);
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
    const c = getAbilityRuntimeContext(project), rules = readVerifiedAbilityRules(c);
    if (!rules.delete(id))
        return;
    const needsProvider=[...rules.values()].some(r=>r.effects.some(e=>recipeAbilityEffect(e.kind)));
    const itemPlan:{present:boolean;module?:RpmModule;address?:number}=c.files.has("patches/ItemEffects.dll")?prepareItemMoveParamForAbility(project,needsProvider):{present:false};
    const chain=needsProvider&&itemPlan.present;
    const blockMessage=ensureAbilityBlockMessages(project,rules)??readAbilityBlockMessage(c);
    const presentationMessages=ensureAbilityPresentationMessages(project,rules)??readAbilityPresentationMessages(c);
    const hasRuntimeData = rules.size || readMoveClassOverrides(c).size || readAutomaticMoveClasses(c, true).size || readCustomMoveFlagRegistry(c).nextId > 1;
    const next = hasRuntimeData ? buildAbilityDll(c, rules, {
        ownsMoveParamHook: chain,
        allowItemMoveParamHook: chain,
        blockMessage,
        presentationMessages,
    }) : undefined;
    if(chain&&(!next||next.metadata.PokewebMoveParamAddress!==itemPlan.address))throw Error("The shared ability and item hooks resolve to different native services.");
    if(itemPlan.module)stageCodeInjectionDll(project,"ItemEffects.dll",writeRpm(itemPlan.module,{ident:"DLXF"}));
    if (next) stageAbilityDll(project, next);
    else retireAbilityDll(c);
    invalidateAbilityVerification(project);
}

/** Persist flags and their shared runtime as one checked transaction. */
async function editExpandedMoveFlags(project: ProjectState, edit: (registry: CustomMoveFlagRegistry, overrides: Map<number,number>, c: AbilityRuntimeContext) => void, log: (target: ProjectState) => void): Promise<void> {
    const prepare=(target:ProjectState,installMessages=false)=>{
        const c=getAbilityRuntimeContext(target),rules=readVerifiedAbilityRules(c),registry=readCustomMoveFlagRegistry(c),overrides=readMoveClassOverrides(c);
        edit(registry,overrides,c);
        const checked=validateCustomMoveFlags(registry);validateCustomFlagReferences(rules,checked);
        const needsProvider=[...rules.values()].some(rule=>rule.effects.some(effect=>recipeAbilityEffect(effect.kind)));
        const item=c.files.has("patches/ItemEffects.dll")?prepareItemMoveParamForAbility(target,needsProvider,{overrides,customFlags:checked}):{present:false};
        const chain=needsProvider&&item.present;
        const blockMessage=(installMessages?ensureAbilityBlockMessages(target,rules):undefined)??readAbilityBlockMessage(c);
        const presentationMessages=(installMessages?ensureAbilityPresentationMessages(target,rules):undefined)??readAbilityPresentationMessages(c);
        const hasRuntimeData = rules.size || overrides.size || readAutomaticMoveClasses(c, true).size || checked.nextId > 1;
        const module = hasRuntimeData ? buildAbilityDll(c, rules, {
            ownsMoveParamHook: chain,
            allowItemMoveParamHook: chain,
            moveClassOverrides: overrides,
            blockMessage,
            presentationMessages,
            customMoveFlagRegistry: checked,
        }) : undefined;
        if(chain&&module?.metadata.PokewebMoveParamAddress!==item.address)throw Error("The shared ability and item hooks resolve to different native services.");
        return{c,module,item};
    };
    prepare(project);
    await installCodeInjectionPatch(project,async staged=>{
        if(detectSpecifyTrainerNaturesPatch(staged)==="legacy")await specifyTrainerNatures(staged);
        const{c,module,item}=prepare(staged,true);
        if(item.module)stageCodeInjectionDll(staged,"ItemEffects.dll",writeRpm(item.module,{ident:"DLXF"}));
        if (module) stageAbilityDll(staged, module);
        else retireAbilityDll(c);
        log(staged);
    });
    invalidateAbilityVerification(project);
}
export async function configureMoveDllFlags(project: ProjectState, moveId: number, flags: number): Promise<void> {
    const state=inspectMoveDllFlags(project,moveId);if(!state.editable)throw Error(state.message);
    if(!Number.isInteger(flags)||flags<0||flags>127)throw Error("Invalid expanded move flags.");
    if(flags===state.flags)return;
    await editExpandedMoveFlags(project,(_registry,overrides,c)=>{
        if(flags===(readAutomaticMoveClasses(c,true).get(moveId)??defaultMoveDllFlags(moveId)))overrides.delete(moveId);else overrides.set(moveId,flags);
    },target=>recordFieldChange(target,"moves",target.texts.banks.moves?.[moveId]??`Move ${moveId}`,"Expanded Flags",state.flags,flags,{key:`move-dll-flags:${moveId}`}));
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
    if (!hasOriginalAbilityDll(project) && !project.fileSystem?.additions?.[ABILITY_EFFECTS_DLL_PATH]) {
        // Move Expansion can add flagged moves to a project that uses item recipes alone.
        if (!currentOnly && listCodeInjectionDlls(project).some(module => module.path === "patches/ItemEffects.dll")) {
            const item = prepareItemMoveParamForAbility(project, false, { overrides:new Map(),customFlags:emptyCustomMoveFlags() });
            if (item.module) stageCodeInjectionDll(project, "ItemEffects.dll", writeRpm(item.module, { ident:"DLXF" }));
        }
        return;
    }
    const state = inspectAbilityEffects(project);
    if (state.runtimeVersion === undefined || currentOnly && state.runtimeVersion !== CURRENT_ABILITY_RUNTIME_VERSION) return;
    if (!state.editable) throw Error(state.message);
    const c=getAbilityRuntimeContext(project), before=readAutomaticMoveClasses(c), after=readAutomaticMoveClasses(c,true);
    if (before.size!==after.size || [...after].some(([id,mask])=>before.get(id)!==mask)) await upgradeAbilityRuntime(project,true);
}
