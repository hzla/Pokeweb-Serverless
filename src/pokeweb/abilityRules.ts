import {RECIPE_ABILITY_EFFECTS,recipeAbilityEffect,recipeAbilityParameter,RECIPE_PARAMETER_BYTES} from "./abilityRecipeEffects";
import { NATIVE_ABILITY_PROFILES, nativeAbilityProfile } from "./abilityNativeRuntime";
import abilityNames from "../assets/data/vanilla_abilities.txt?raw";
import { LIBRARY_ABILITY_EFFECTS, libraryAbilityEffect, libraryAbilityParameter } from "./abilityLibraryEffects";
import { ITEM_RULE_TRIGGERS, ITEM_RULE_TARGETS, ITEM_RULE_EFFECTS, validateItemRule, type ItemRuleEffect, type ItemRuleSet } from "./itemRules";
export type AbilityRuleEffect = Omit<ItemRuleEffect, "kind"> & {
    kind: ItemRuleEffect["kind"] | `nativeAbility:${number}`;
    bypassable?: boolean;
    weather?: number;
};
export type AbilityRuleSet = {
    effects: AbilityRuleEffect[];
    conditions: ItemRuleSet["conditions"];
};
const supported = new Set(["attack", "specialAttack", "defense", "specialDefense", "speed", "damage", "healPercent", "healFlat", "healDivisor", "status", "statStage", "recoil", "critical", "accuracy", "incomingAccuracy"]);
export const ABILITY_RULE_EFFECTS = [...ITEM_RULE_EFFECTS.filter(d => supported.has(d.kind)).map(d => ["attack", "specialAttack", "defense", "specialDefense", "speed"].includes(d.kind) ? {...d, step: .001} : d), ...LIBRARY_ABILITY_EFFECTS,...RECIPE_ABILITY_EFFECTS];
export const EMPTY_ABILITY_RULE: AbilityRuleSet = { effects: [{ kind: "attack", value: 1.5 }], conditions: { kind: "group", mode: "all", children: [] } };
export const ABILITY_NATIVE_EFFECTS = NATIVE_ABILITY_PROFILES.map(p => ({ kind: `nativeAbility:${p.id}` as const, label: `Native ability ${p.id}`, value: -1, min: -1, max: 8, step: .125, unit: "×", nativeItem: p.id, parameterLabel: p.multipliers ? "Multiplier" : undefined }));
export function validateAbilityRule(input: AbilityRuleSet): AbilityRuleSet {
    if (!input || !Array.isArray(input.effects) || input.effects.length < 1 || input.effects.length > 16)
        throw new Error("Choose one to sixteen ability effects.");
    const conditions = validateItemRule({ effects: [{ kind: "attack", value: 1 }], conditions: input.conditions, consumable: false }).conditions;
    const effects = input.effects.map(effect => {
        if (!effect || effect.bypassable !== undefined && typeof effect.bypassable !== "boolean")
            throw new Error("Invalid ability effect.");
        const profile = nativeAbilityProfile(effect.kind);
        const library = libraryAbilityEffect(effect.kind)??recipeAbilityEffect(effect.kind);
        if (library) {
            if(!Number.isFinite(effect.value)||effect.value<library.min||effect.value>library.max||Math.abs(effect.value/library.step-Math.round(effect.value/library.step))>1e-7||(library.code===133||"nonzero"in library&&library.nonzero)&&!effect.value||effect.weather!==undefined||effect.trigger!==undefined||effect.chance!==undefined||effect.stat!==undefined||effect.target!==undefined||effect.move!==undefined)throw new Error("Invalid library ability effect.");
            if(library.code===147&&![.25,.5,1,2,4].includes(effect.value))throw new Error("Choose a native type effectiveness multiplier.");
            const parameters:Record<string,number>={};
            if(effect.parameters!==undefined){
                if(!effect.parameters||typeof effect.parameters!=="object"||Array.isArray(effect.parameters))throw new Error("Invalid library ability parameters.");
                for(const[key,value]of Object.entries(effect.parameters).sort(([a],[b])=>a.localeCompare(b))){const p=library.parameters.find(p=>p.key===key);if(!p||!Number.isFinite(value)||value<p.min||value>p.max||Math.abs(value/p.step-Math.round(value/p.step))>1e-7||p.choices&&!p.choices.includes(value))throw new Error(`Invalid library ability parameter: ${key}`);parameters[key]=value;}
            }
            if(library.code===144&&(parameters.format??0)===1&&(!Number.isInteger(effect.value)||effect.value<1))throw new Error("Choose a positive whole healing divisor.");
            return {kind:effect.kind,value:effect.value,bypassable:effect.bypassable??library.bypassable,...(Object.keys(parameters).length?{parameters}:{})};
        }
        if (profile) {
            if (effect.value !== -1 && (!profile.multipliers || !Number.isFinite(effect.value) || effect.value < .125 || effect.value > 8 || !Number.isInteger(effect.value * 8)))
                throw new Error("Invalid native ability multiplier.");
            if (effect.weather !== undefined && (!profile.weather || !Number.isInteger(effect.weather) || effect.weather < 0 || effect.weather > 4))
                throw new Error("Invalid native weather edit.");
            if (effect.chance !== undefined && (!profile.chances || !Number.isInteger(effect.chance) || effect.chance < 1 || effect.chance > 100))
                throw new Error("Invalid native chance edit.");
            if (effect.stat !== undefined && (!profile.stats || !Number.isInteger(effect.stat) || effect.stat < 1 || effect.stat > 7))
                throw new Error("Invalid native stat edit.");
            const parameters: Record<string, number> = {};
            if (effect.parameters !== undefined) {
                if (!effect.parameters || typeof effect.parameters !== "object" || Array.isArray(effect.parameters)) throw new Error("Invalid native ability parameters.");
                for (const [key, value] of Object.entries(effect.parameters).sort(([a], [b]) => a.localeCompare(b))) {
                    const control = profile.parameters?.find(p => p.key === key);
                    if (!control || !Number.isFinite(value) || value < control.min || value > control.max || Math.abs(value / control.step - Math.round(value / control.step)) > 1e-7 || control.choices && !control.choices.includes(value) || control.nonzero && value === 0) throw new Error(`Invalid native ability parameter: ${key}`);
                    parameters[key] = value;
                }
            }
            return { kind: effect.kind, value: effect.value, bypassable: effect.bypassable ?? true, ...(effect.weather !== undefined ? { weather: effect.weather } : {}), ...(effect.chance !== undefined ? { chance: effect.chance } : {}), ...(effect.stat !== undefined ? { stat: effect.stat } : {}), ...(Object.keys(parameters).length ? {parameters} : {}) };
        }
        if (!supported.has(effect.kind) || effect.weather !== undefined || effect.parameters !== undefined)
            throw new Error("Choose a supported ability effect.");
        const canonical = validateItemRule({ effects: [effect as ItemRuleEffect], conditions, consumable: false }, ABILITY_RULE_EFFECTS).effects[0];
        return { ...canonical, bypassable: effect.bypassable ?? ["defense", "specialDefense", "incomingAccuracy"].includes(effect.kind) };
    });
    const seen = new Set<string>();
    for (const e of effects) {
        const key = JSON.stringify(e);
        if (seen.has(key))
            throw new Error("Remove duplicate ability effects.");
        seen.add(key);
    }
    return { conditions, effects };
}
/** A 256-entry offset index followed by bounded conditions and fixed effect records. */
export function encodeAbilityRules(entries: ReadonlyMap<number, AbilityRuleSet>): Uint8Array {
    const bytes: number[] = Array(512).fill(0);
    const emit = (op: number, arg: number, value: number) => bytes.push(op, arg, value & 255, value >>> 8 & 255);
    for (const [id, input] of [...entries].sort(([a], [b]) => a - b)) {
        if (!Number.isInteger(id) || id < 1 || id > 255)
            throw new Error("Ability IDs must be between 1 and 255.");
        const rule = validateAbilityRule(input), at = bytes.length;
        bytes[id * 2] = at & 255;
        bytes[id * 2 + 1] = at >>> 8;
        bytes.push(rule.effects.length, 0, 0, 1);
        function node(c: AbilityRuleSet["conditions"]): void {
            if (c.kind === "group") {
                c.children.forEach(node);
                emit(c.mode === "all" ? 128 : 129, c.children.length, 0);
            }
            else if (c.kind === "hp")
                emit(1, ["lt", "lte", "gt", "gte"].indexOf(c.comparison), c.percent);
            else
                emit(({ type: 2, weather: 3, species: 4, moveType: 5, category: 6, status: 7 })[c.kind], Number(Boolean(c.negate)), c.value);
            bytes[at + 1]++;
        }
        node(rule.conditions);
        for (const e of rule.effects) {
            const recipe=recipeAbilityEffect(e.kind);
            if(recipe){
                const row=Array(16).fill(0),value=Math.round(e.value*recipe.scale);row[0]=recipe.code;row[2]=value&255;row[3]=value>>>8&255;row[7]=Number(e.bypassable);
                recipe.parameters.forEach((p,i)=>row[RECIPE_PARAMETER_BYTES[i]]=recipeAbilityParameter(e,p.key));bytes.push(...row);continue;
            }
            const library=libraryAbilityEffect(e.kind);
            if(library){
                const value=Math.round(e.value*(library.code<=131?4096:1));
                emit(library.code,libraryAbilityParameter(e,"moveClass"),value);
                bytes.push(libraryAbilityParameter(e,"type"),libraryAbilityParameter(e,"category"),library.code===133?libraryAbilityParameter(e,"activationChance"):100,Number(e.bypassable),library.code===133?libraryAbilityParameter(e,"stat"):0,library.code===133?libraryAbilityParameter(e,"target"):0,0,0,0,0,0,0);
                continue;
            }
            const profile = nativeAbilityProfile(e.kind), index = ITEM_RULE_EFFECTS.findIndex(d => d.kind === e.kind);
            const value = profile ? 0 : Math.round(e.value * (["healPercent", "recoil"].includes(e.kind) ? 100 : ["healFlat", "healDivisor", "status", "statStage", "critical"].includes(e.kind) ? 1 : 4096));
            emit(profile ? 128 : index + 1, e.kind === "statStage" ? e.stat! : 0, value);
            bytes.push(e.trigger ? ITEM_RULE_TRIGGERS.indexOf(e.trigger) : 0, e.target ? ITEM_RULE_TARGETS.indexOf(e.target) : 0, e.chance ?? 100, Number(e.bypassable), 0, 0, 0, 0, profile?.id ?? 0, 0, 0, profile?.priority ?? 0);
        }
    }
    if (bytes.length > 65535)
        throw new Error("Ability configuration exceeds 64 KiB.");
    return Uint8Array.from(bytes);
}
export const ABILITY_RULE_PRESETS: Array<{
    id: number;
    label: string;
    rule: AbilityRuleSet;
}> = [
    { id: 37, label: "Huge Power", rule: { ...EMPTY_ABILITY_RULE, effects: [{ kind: "attack", value: 2 }] } },
    { id: 3, label: "Speed Boost", rule: { ...EMPTY_ABILITY_RULE, effects: [{ kind: "statStage", stat: 5, value: 1, trigger: "turnEnd", target: "holder", chance: 100 }] } },
    { id: 33, label: "Swift Swim", rule: { effects: [{ kind: "speed", value: 2 }], conditions: { kind: "weather", value: 2 } } },
    { id: 34, label: "Chlorophyll", rule: { effects: [{ kind: "speed", value: 2 }], conditions: { kind: "weather", value: 1 } } },
    { id: 44, label: "Rain Dish", rule: { effects: [{ kind: "healDivisor", value: 16 }], conditions: { kind: "weather", value: 2 } } },
    { id: 49, label: "Flame Body", rule: { ...EMPTY_ABILITY_RULE, effects: [{ kind: "status", value: 4, trigger: "afterContact", target: "attacker", chance: 30 }] } },
    { id: 24, label: "Rough Skin", rule: { ...EMPTY_ABILITY_RULE, effects: [{ kind: "recoil", value: 12.5, trigger: "afterContact", target: "attacker", chance: 100 }] } },
    { id: 105, label: "Super Luck", rule: { ...EMPTY_ABILITY_RULE, effects: [{ kind: "critical", value: 1 }] } },
];
const presetIds=new Set(ABILITY_RULE_PRESETS.map(p=>p.id)), nativeNames=abilityNames.split(/\r?\n/u);
ABILITY_RULE_PRESETS.push(...NATIVE_ABILITY_PROFILES.filter(p=>!presetIds.has(p.id)).map(p=>({id:p.id,label:nativeNames[p.id]??`Ability ${p.id}`,rule:{effects:[{kind:`nativeAbility:${p.id}` as const,value:-1}],conditions:EMPTY_ABILITY_RULE.conditions}})));
ABILITY_RULE_PRESETS.sort((a,b)=>a.label.localeCompare(b.label));
