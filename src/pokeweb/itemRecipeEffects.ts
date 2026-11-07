import type { NativeAbilityParameter } from "./abilityNativeParameters";
import type { ItemRuleEffect, ItemRuleEffectDefinition } from "./itemRules";

type Recipe = ItemRuleEffectDefinition & { code: number; parameters: NativeAbilityParameter[]; bypassable?:boolean };
const p = (key:string,label:string,original:number,min:number,max:number,kind:NativeAbilityParameter["kind"]="number",labels?:Record<number,string>,choices?:number[]):NativeAbilityParameter => ({key,label,original,min,max,step:1,kind,labels,choices,sites:[]});
const moveType = () => p("type","Move type",18,0,18,"type",{18:"Any type"});
const category = () => p("category","Move category",0,0,2,"category",{0:"Any damaging move"});
export const ITEM_RECIPE_MOVE_CLASSES = {0:"Any move",1:"Contact",2:"Punching",3:"Biting",4:"Pulse",5:"Sound",6:"Ball / bomb",7:"Slicing",8:"Powder",12:"Healing",13:"Wind"};
export const ITEM_RECIPE_STATS = ["attack","defense","specialAttack","specialDefense","speed","accuracy","evasion"] as const;
const statLabels = ["Attack","Defense","Sp. Atk","Sp. Def","Speed","Accuracy","Evasion"];
const recipe = (id:string,code:number,label:string,value:number,min:number,max:number,step:number,unit:string,parameters:NativeAbilityParameter[]):Recipe => ({kind:`itemRecipe:${id}`,code,label,value,min,max,step,unit,parameters});
export const ITEM_RECIPE_EFFECTS:Recipe[] = [
  recipe("hitStats",129,"Stat changes after a hit",1,1,1,1,"",[
    moveType(),category(),p("effectiveness","Minimum effectiveness",0,0,5,"number",{0:"Any effectiveness",4:"Super effective (2× or more)",5:"4× or more"},[0,4,5]),
    ...ITEM_RECIPE_STATS.map((key,i)=>p(key,`${statLabels[i]} stages`,i===3?1:0,-6,6)),
    p("berryUse","Also activate on forced berry use",0,0,1,"number",{0:"No",1:"Yes"},[0,1]),
  ]),
  recipe("power",130,"Move power multiplier",1.2,.125,8,.025,"×",[moveType(),category()]),
  recipe("resist",131,"Type-resistance berry",.5,.025,8,.025,"× damage taken",[
    moveType(),p("superEffective","Require super-effective damage",1,0,1,"number",{0:"No",1:"Yes"},[0,1]),
  ]),
  recipe("weatherGuard",132,"Weather damage immunity",1,1,1,1,"",[
    p("weather","Weather",0,0,4,"weather",{0:"All damaging weather",3:"Hail",4:"Sandstorm"},[0,3,4]),
  ]),
  recipe("moveGuard",133,"Move-class immunity",1,1,1,1,"",[
    p("moveClass","Move class",8,1,13,"number",{1:"Contact",2:"Punching",3:"Biting",4:"Pulse",5:"Sound",6:"Ball / bomb",7:"Slicing",8:"Powder",12:"Healing",13:"Wind"},[1,2,3,4,5,6,7,8,12,13]),
  ]),
  recipe("hazardGuard",134,"Entry-hazard immunity",1,1,1,1,"",[
    p("spikes","Spikes",1,0,1,"number",{0:"Allow",1:"Block"},[0,1]),
    p("toxicSpikes","Toxic Spikes",1,0,1,"number",{0:"Allow",1:"Block"},[0,1]),
    p("stealthRock","Stealth Rock",1,0,1,"number",{0:"Allow",1:"Block"},[0,1]),
  ]),
  recipe("statGuard",135,"Prevent stat drops from other Pokémon",1,1,1,1,"",[
    p("stat","Protected stat",0,0,7,"number",{0:"All stats",1:"Attack",2:"Defense",3:"Sp. Atk",4:"Sp. Def",5:"Speed",6:"Accuracy",7:"Evasion"}),
  ]),
  recipe("secondaryGuard",136,"Prevent additional move effects",1,1,1,1,"",[
    p("status","Status effects",1,0,1,"number",{0:"Allow",1:"Block"},[0,1]),
    p("statChanges","Stat changes",1,0,1,"number",{0:"Allow",1:"Block"},[0,1]),
    p("flinch","Flinching",1,0,1,"number",{0:"Allow",1:"Block"},[0,1]),
  ]),
  recipe("hitCount",137,"Multi-hit minimum",4,2,5,1,"hits (2–5-hit moves)",[]),
  recipe("mirrorBoosts",138,"Copy opponents’ stat boosts",1,.125,8,.125,"× stages",[
    p("stat","Copied stat",0,0,7,"number",{0:"All stats",1:"Attack",2:"Defense",3:"Sp. Atk",4:"Sp. Def",5:"Speed",6:"Accuracy",7:"Evasion"}),
  ]),
  recipe("moveRestriction",140,"Restrict move selection",1,1,1,1,"",[
    p("category","Restricted category",1,0,3,"number",{0:"Any category",1:"Status",2:"Physical",3:"Special"},[0,1,2,3]),p("type","Base move type",18,0,18,"type",{18:"Any type"}),
  ]),
  recipe("flagPower",139,"Move-class power multiplier",1.1,.125,8,.025,"×",[
    p("moveClass","Move class",2,0,13,"number",ITEM_RECIPE_MOVE_CLASSES,[0,1,2,3,4,5,6,7,8,12,13]),moveType(),category(),
  ]),
];
export const itemRecipeEffect = (kind:string) => ITEM_RECIPE_EFFECTS.find(e=>e.kind===kind);
export function itemRecipeParameter(effect:ItemRuleEffect,key:string):number {
  const definition=itemRecipeEffect(effect.kind)?.parameters.find(p=>p.key===key);
  if(!definition)throw Error(`Unknown item recipe parameter: ${key}`);
  return effect.parameters?.[key]??definition.original;
}
export function encodeItemRecipe(effect:ItemRuleEffect):number[] {
  const definition=itemRecipeEffect(effect.kind)!;
  const p=(key:string)=>itemRecipeParameter(effect,key), b=Array(16).fill(0);b[0]=definition.code;
  if(definition.code===129){b[1]=p("type");b[2]=p("category");b[3]=p("effectiveness");b[4]=p("berryUse");ITEM_RECIPE_STATS.forEach((key,i)=>b[5+i]=p(key)&255);}
  else if(definition.code===134){b[1]=p("spikes");b[2]=p("toxicSpikes");b[3]=p("stealthRock");}
  else if(definition.code===135){b[1]=p("stat");}
  else if(definition.code===136){b[1]=p("status");b[2]=p("statChanges");b[3]=p("flinch");}
  else if(definition.code===137){b[1]=effect.value;}
  else if(definition.code===138){b[1]=p("stat");const value=Math.round(effect.value*4096);b[2]=value&255;b[3]=value>>>8;}
  else if(definition.code===140){b[1]=p("category");b[2]=p("type");}
  else if(definition.code===139){b[1]=p("type");const value=Math.round(effect.value*4096);b[2]=value&255;b[3]=value>>>8;b[4]=p("category");b[5]=p("moveClass");}
  else {const value=Math.round(effect.value*4096);b[1]=p(definition.code===132?"weather":definition.code===133?"moveClass":"type");b[2]=value&255;b[3]=value>>>8;if(definition.code===130)b[4]=p("category");if(definition.code===131)b[4]=p("superEffective");}
  return b;
}
