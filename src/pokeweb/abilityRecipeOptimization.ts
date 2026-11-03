import type { AbilityRuleEffect, AbilityRuleSet } from "./abilityRules";
import { encodeAbilityRules, validateAbilityRule } from "./abilityRules";
import { readU16 } from "../nds/binary";
import { abilityConditionMask, ABILITY_GROUP_STAGE_KEYS, recipeAbilityEffect, recipeAbilityParameter } from "./abilityRecipeEffects";
import { libraryAbilityEffect } from "./abilityLibraryEffects";

/** Immutable execution records may be shared; mutable work remains per owner. */
export function abilityWorkSlots(rules: ReadonlyMap<number, AbilityRuleSet>): 4 | 8 | 16 {
  const count = Math.max(0, ...[...rules.values()].map(rule => rule.effects.length));
  return count <= 4 ? 4 : count <= 8 ? 8 : 16;
}

/** Compare equivalent UI representations without turning a rename into a rebuild. */
export function abilityExecutionSignature(input: AbilityRuleSet): string {
  const rule=validateAbilityRule(optimizeAbilityRule(input));
  const condition=(node:AbilityRuleSet["conditions"]):AbilityRuleSet["conditions"]=>node.kind!=="group"?node:node.children.length===1?condition(node.children[0]):{...node,children:node.children.map(condition)};
  return JSON.stringify({...rule,conditions:condition(rule.conditions),effects:rule.effects.map(effect=>{
    const definition=libraryAbilityEffect(effect.kind)??recipeAbilityEffect(effect.kind);
    if(!definition)return effect;
    const parameters:Record<string,number>=Object.fromEntries(definition.parameters.map(p=>[p.key,effect.parameters?.[p.key]??p.original]));
    for(const p of definition.parameters)if(p.when){const active=Array.isArray(p.when.value)?p.when.value.includes(parameters[p.when.key]):parameters[p.when.key]===p.when.value;if(!active)parameters[p.key]=p.original;}
    if(libraryAbilityEffect(effect.kind)&&parameters.moveClass===9){parameters.types=effect.parameters?.types??1<<(effect.parameters?.type??0);delete parameters.type;}
    return {...effect,parameters};
  })});
}

/** Layout of current execution data before native callback relocations. */
export function abilityExecutionLayout(input: ReadonlyMap<number, AbilityRuleSet>) {
  const rules=new Map([...input].map(([id,rule])=>[id,validateAbilityRule(optimizeAbilityRule(rule))]));
  const bytes=encodeAbilityRules(rules,true),nativeOffsets=new Set<number>();
  for(const[id,rule]of rules){const at=readU16(bytes,id*2),start=at+4+bytes[at+1]*4;rule.effects.forEach((effect,index)=>{if(effect.kind.startsWith("nativeAbility:"))nativeOffsets.add(start+index*16);});}
  return {rules,bytes,nativeOffsets:[...nativeOffsets]};
}

/** Merge only adjacent operations whose order, rolls and eligibility are preserved. */
export function optimizeAbilityRule(input: AbilityRuleSet): AbilityRuleSet {
  const effects = structuredClone(input.effects), output: AbilityRuleEffect[] = [];
  for (let at = 0; at < effects.length;) {
    const first = effects[at];
    if (first.kind === "abilityRecipe:statusGuard" && !recipeAbilityParameter(first,"cure")) {
      const keys = ["scope","protectedType","cure","excludeSelf"];
      const signature = (e: AbilityRuleEffect) => JSON.stringify([e.bypassable, ...keys.map(key => recipeAbilityParameter(e,key))]);
      const group = [first];
      while (at + group.length < effects.length) {
        const e = effects[at + group.length];
        if (e.kind !== first.kind || signature(e) !== signature(first)) break;
        group.push(e);
      }
      if (group.length > 1) {
        output.push({ kind:"abilityRecipe:statusGuardSet",value:1,bypassable:first.bypassable,parameters:{...Object.fromEntries(keys.map(key=>[key,recipeAbilityParameter(first,key)])),conditionMask:abilityConditionMask(group.map(e=>recipeAbilityParameter(e,"condition")))}});
        at += group.length; continue;
      }
    }
    if (first.kind === "abilityRecipe:statAction" && recipeAbilityParameter(first,"stat") <= 7) {
      const keys = recipeAbilityEffect(first.kind)!.parameters.map(p=>p.key).filter(key=>key!=="stat"&&key!=="statSource");
      const signature = (e: AbilityRuleEffect) => JSON.stringify([e.bypassable,...keys.map(key=>recipeAbilityParameter(e,key))]);
      const group = [first], stats = new Set([recipeAbilityParameter(first,"stat")]);
      while (at + group.length < effects.length) {
        const e = effects[at+group.length];
        if (e.kind!==first.kind || signature(e)!==signature(first)) break;
        const stat=recipeAbilityParameter(e,"stat");
        if(stat>7||stats.has(stat))break;
        stats.add(stat);group.push(e);
      }
      if (group.length > 1) {
        const parameters:Record<string,number>=Object.fromEntries(keys.map(key=>[key,recipeAbilityParameter(first,key)]));
        parameters.statOrder=0;
        group.forEach((e,index)=>{const stat=recipeAbilityParameter(e,"stat");parameters[ABILITY_GROUP_STAGE_KEYS[stat-1]]=e.value;parameters.statOrder|=stat<<(index*3);});
        output.push({kind:"abilityRecipe:statGroup",value:1,bypassable:first.bypassable,parameters});
        at+=group.length;continue;
      }
    }
    if (libraryAbilityEffect(first.kind) && (first.parameters?.moveClass??0)===9) {
      const signature=(e:AbilityRuleEffect)=>JSON.stringify([e.kind,e.value,e.bypassable,Object.entries(e.parameters??{}).filter(([key])=>key!=="type"&&key!=="types").sort(([a],[b])=>a.localeCompare(b))]);
      let mask=first.parameters?.types??1<<(first.parameters?.type??0),count=1;
      while(at+count<effects.length){
        const next=effects[at+count];if(signature(next)!==signature(first))break;
        const bits=next.parameters?.types??1<<(next.parameters?.type??0);
        if(mask&bits)break; // Overlapping multiplier filters must still stack.
        mask|=bits;count++;
      }
      if(count>1){const parameters:Record<string,number>={...first.parameters,types:mask};delete parameters.type;output.push({...first,parameters});at+=count;continue;}
    }
    output.push(first);at++;
  }
  return {conditions:structuredClone(input.conditions),effects:output};
}
