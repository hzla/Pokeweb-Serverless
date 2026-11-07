import { ITEM_RULE_EFFECTS, validateItemRule, type ItemRuleSet } from "./itemRules";
const always = () => ({ kind: "group" as const, mode: "all" as const, children: [] });
export const ITEM_RECIPE_TEMPLATE_IDS = { maranga: 10001, weaknessPolicy: 10002, fairyFeather: 10003, roseli: 10004, safetyGoggles: 10005, heavyDutyBoots:10006, clearAmulet:10007, covertCloak:10008, loadedDice:10009, mirrorHerb:10010, punchingGlove:10011, assaultVest:10012 } as const;
const recipes = new Map<number,{label:string;effects:ItemRuleSet["effects"];consumable:boolean}>([
  [10001,{label:"Maranga Berry",effects:[{kind:"itemRecipe:hitStats",value:1,parameters:{category:2,berryUse:1}}],consumable:true}],
  [10002,{label:"Weakness Policy",effects:[{kind:"itemRecipe:hitStats",value:1,parameters:{attack:2,specialAttack:2,specialDefense:0,effectiveness:4}}],consumable:true}],
  [10003,{label:"Fairy Feather",effects:[{kind:"itemRecipe:power",value:1.2,parameters:{type:17}}],consumable:false}],
  [10004,{label:"Roseli Berry",effects:[{kind:"itemRecipe:resist",value:.5,parameters:{type:17}}],consumable:true}],
  [10005,{label:"Safety Goggles",effects:[{kind:"itemRecipe:weatherGuard",value:1},{kind:"itemRecipe:moveGuard",value:1}],consumable:false}],
  [10006,{label:"Heavy-Duty Boots",effects:[{kind:"itemRecipe:hazardGuard",value:1}],consumable:false}],
  [10007,{label:"Clear Amulet",effects:[{kind:"itemRecipe:statGuard",value:1}],consumable:false}],
  [10008,{label:"Covert Cloak",effects:[{kind:"itemRecipe:secondaryGuard",value:1}],consumable:false}],
  [10009,{label:"Loaded Dice",effects:[{kind:"itemRecipe:hitCount",value:4}],consumable:false}],
  [10010,{label:"Mirror Herb",effects:[{kind:"itemRecipe:mirrorBoosts",value:1}],consumable:true}],
  [10012,{label:"Assault Vest",effects:[{kind:"specialDefense",value:1.5},{kind:"itemRecipe:moveRestriction",value:1}],consumable:false}],
  [10011,{label:"Punching Glove (power)",effects:[{kind:"itemRecipe:flagPower",value:1.1}],consumable:false}],
]);
export const ITEM_RULE_PRESETS = [
  ...ITEM_RULE_EFFECTS.filter(effect => effect.nativeItem).map(effect => ({ id: effect.nativeItem!, label: effect.label.replace(/ behavior$/u, "") })),
  { id: 295, label: "Shed Shell" }, { id: 116, label: "Douse Drive" }, { id: 117, label: "Shock Drive" }, { id: 118, label: "Burn Drive" }, { id: 119, label: "Chill Drive" },
  ...[...recipes].map(([id,recipe])=>({id,label:recipe.label})),
].sort((a, b) => a.label.localeCompare(b.label));
/** A preset remains an editable composition; native behaviors retain their own checks. */
export function itemRulePreset(id: number, consumed = false, fairy = true): ItemRuleSet {
  const recipe=recipes.get(id);
  if(recipe){const effects=structuredClone(recipe.effects);if(!fairy)for(const e of effects)if(e.parameters?.type===17){e.parameters.type=0;if(e.kind==="itemRecipe:resist")e.parameters.superEffective=0;}return validateItemRule({effects,conditions:always(),consumable:recipe.consumable});}
  let effects: ItemRuleSet["effects"] = [{ kind: `native:${id}`, value: -1 }];
  if(id>=184&&id<=200)effects=[{kind:"itemRecipe:resist",value:.5,parameters:{type:[9,10,12,11,14,1,3,4,2,13,6,5,7,15,16,8,0][id-184],superEffective:id===200?0:1}}];
  if ([220, 297, 287].includes(id)) effects = [{ kind: id === 220 ? "attack" : id === 297 ? "specialAttack" : "speed", value: 1.5 }, { kind: "moveLock", value: 1 }];
  if (id === 234) effects = [{ kind: "healDivisor", value: 16 }];
  if (id === 295) effects = [{ kind: "escapeTrap", value: 1 }];
  if (id >= 116 && id <= 119) effects = [{ kind: "moveType", value: [10, 12, 9, 14][id - 116], move: 546 }];
  if (id >= 298 && id <= 313) effects.push({ kind: "moveType", value: [9, 10, 12, 11, 14, 1, 3, 4, 2, 13, 6, 5, 7, 15, 16, 8][id - 298], move: 449 });
  return validateItemRule({ effects, conditions: always(), consumable: consumed || id === 541 || id>=184&&id<=200 });
}
