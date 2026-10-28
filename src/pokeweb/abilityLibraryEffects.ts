import type { NativeAbilityParameter } from "./abilityNativeParameters";
import type { ItemRuleEffectDefinition, ItemRuleEffect } from "./itemRules";

const moveClasses = {0:"Any move",1:"Contact",2:"Punching",3:"Biting",4:"Pulse",5:"Sound",6:"Ball / bomb",7:"Slicing",8:"Powder",9:"Type",10:"Category",11:"Super effective",12:"Healing",13:"Wind"};
const filter: NativeAbilityParameter = {key:"moveClass",label:"Move filter",kind:"number",original:0,min:0,max:13,step:1,choices:Array.from({length:14},(_,i)=>i),labels:moveClasses,sites:[]};
const earlyFilter = {...filter,choices:filter.choices!.filter(value=>value!==11)};
const type: NativeAbilityParameter = {key:"type",label:"Move type",kind:"type",original:0,min:0,max:17,step:1,sites:[],when:{key:"moveClass",value:9}};
const category: NativeAbilityParameter = {key:"category",label:"Move category",kind:"category",original:1,min:0,max:2,step:1,sites:[],when:{key:"moveClass",value:10}};
export type LibraryAbilityEffect = ItemRuleEffectDefinition & {code:number;parameters:NativeAbilityParameter[];bypassable:boolean};
export const LIBRARY_ABILITY_EFFECTS: LibraryAbilityEffect[] = [
 {kind:"ability:power",code:129,label:"Move power multiplier",value:1.5,min:.125,max:8,step:.001,unit:"×",bypassable:false,parameters:[earlyFilter,type,category]},
 {kind:"ability:damage",code:130,label:"Outgoing damage multiplier (filtered)",value:1.5,min:.125,max:8,step:.001,unit:"×",bypassable:false,parameters:[filter,type,category]},
 {kind:"ability:damageTaken",code:131,label:"Incoming damage multiplier",value:.5,min:.125,max:8,step:.001,unit:"×",bypassable:true,parameters:[filter,type,category]},
 {kind:"ability:immunity",code:132,label:"Block matching moves",value:1,min:1,max:1,step:1,unit:"",bypassable:true,parameters:[earlyFilter,type,category]},
 {kind:"ability:hitStat",code:133,label:"Stat reaction to a hit",value:1,min:-6,max:6,step:1,unit:"stages",bypassable:false,parameters:[
  {key:"stat",label:"Stat",kind:"stat",original:2,min:1,max:7,step:1,sites:[]},
  {key:"target",label:"Target",kind:"number",original:0,min:0,max:1,step:1,choices:[0,1],labels:{0:"Holder",1:"Attacker"},sites:[]},
  {key:"activationChance",label:"Activation chance (%)",kind:"number",original:100,min:0,max:100,step:1,sites:[]},earlyFilter,type,category]},
 {kind:"ability:priority",code:134,label:"Move priority bonus",value:1,min:1,max:7,step:1,unit:"priority",bypassable:false,parameters:[earlyFilter,type,category]},
];
export const libraryAbilityEffect=(kind:string):LibraryAbilityEffect|undefined=>LIBRARY_ABILITY_EFFECTS.find(e=>e.kind===kind);
export function libraryAbilityParameter(effect: ItemRuleEffect,key:string):number {
 const p=libraryAbilityEffect(effect.kind)?.parameters.find(p=>p.key===key);
 if(!p)throw new Error(`Unknown library parameter: ${key}`);
 return effect.parameters?.[key]??p.original;
}
