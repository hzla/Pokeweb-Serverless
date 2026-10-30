/** Editable operations added for the standalone Gen 6–9 recipe catalog. */
import type {NativeAbilityParameter} from "./abilityNativeParameters";
import type {ItemRuleEffectDefinition,ItemRuleEffect} from "./itemRules";
import {SCOPED_ABILITY_EFFECTS} from "./abilityScopedEffects";
import {ACTION_ABILITY_EFFECTS} from "./abilityActionEffects";
const p=(key:string,label:string,original:number,min:number,max:number,labels?:Record<number,string>,kind:NativeAbilityParameter["kind"]="number"):NativeAbilityParameter=>({key,label,original,min,max,step:1,kind,sites:[],...(labels?{labels,choices:Object.keys(labels).map(Number)}:{})});
const stat=(highest=false)=>p("stat","Stat",1,1,highest?8:7,highest?{1:"Attack",2:"Defense",3:"Sp. Atk",4:"Sp. Def",5:"Speed",6:"Accuracy",7:"Evasion",8:"Highest raw stat"}:undefined,"stat");
const scope=p("scope","Targets",0,0,4,{0:"Holder",1:"Allies",2:"Opponents",3:"All other Pokémon",4:"Attacker"});
const move=p("moveClass","Move filter",0,0,13,{0:"Any move",1:"Contact",2:"Punching",3:"Biting",4:"Pulse",5:"Sound",6:"Ball / bomb",7:"Slicing",8:"Powder",9:"Type",10:"Category",12:"Healing",13:"Wind"});
const type=p("type","Move type",0,0,17,undefined,"type"),category=p("category","Damage category",0,0,2,{0:"Any",1:"Physical",2:"Special"});
const guardScope=p("scope","Protect",0,0,1,{0:"Holder",1:"Holder and allies"});
const protectedType=p("protectedType","Protected Pokémon type",18,0,18,undefined,"type");
protectedType.labels={18:"Any type"};
const once=p("once","Entry limit",0,0,1,{0:"Every entry / ability gain",1:"Once per battle"});
const trigger=p("activation","Trigger",0,0,5,{0:"Entry / ability gain",1:"After taking a hit",2:"HP crosses downward",3:"Another Pokémon faints",4:"After a knockout",5:"After using a move"});
export type RecipeAbilityEffect=ItemRuleEffectDefinition&{code:number;scale:number;parameters:NativeAbilityParameter[];bypassable:boolean;nonzero?:boolean;fixedBypass?:boolean};
const effect=(kind:string,code:number,label:string,value:number,min:number,max:number,step:number,unit:string,scale:number,parameters:NativeAbilityParameter[],bypassable=false,nonzero=false):RecipeAbilityEffect=>({kind:`abilityRecipe:${kind}`,code,label,value,min,max,step,unit,scale,parameters:parameters.map(p=>({...p})),bypassable,nonzero});
export const RECIPE_ABILITY_EFFECTS:RecipeAbilityEffect[]=[
 effect("convertType",135,"Convert move type and power",1.2,.125,8,.001,"× power",4096,[{...move,choices:move.choices!.filter(v=>v!==9&&v!==10)},p("sourceType","Original move type",0,0,18,undefined,"type"),p("type","New move type",2,0,17,undefined,"type")]),
 effect("statAction",136,"Triggered stat stages",1,-6,6,1,"stages",1,[trigger,stat(true),scope,p("activationChance","Chance (%)",100,0,100),p("threshold","HP threshold (%)",50,1,100),once,move,type,category,p("adjacent","Range",0,0,1,{0:"All active targets",1:"Adjacent targets"}),p("statSource","Highest stat of",0,0,1,{0:"Holder",1:"Each target"})],false,true),
 effect("statusGuard",137,"Protect against a condition",1,1,1,1,"",1,[p("condition","Condition",1,1,35,{1:"Paralysis",2:"Sleep",3:"Freeze",4:"Burn",5:"Poison / bad poison",6:"Confusion",7:"Infatuation",11:"Taunt",12:"Torment",13:"Disable",14:"Yawn",15:"Heal Block",23:"Encore"}),guardScope,protectedType,p("cure","Automatically cure",0,0,1,{0:"No",1:"Yes"}),p("excludeSelf","Self-inflicted conditions",0,0,1,{0:"Also prevent",1:"Allow"})],true),
 effect("statGuard",138,"Prevent stat drops",1,1,1,1,"",1,[p("stat","Stat",8,1,8,undefined,"stat"),guardScope,protectedType],true),
 effect("allyPower",139,"Ally move power multiplier",1.3,.125,8,.001,"×",4096,[p("scope","Affect",0,0,1,{0:"Allies",1:"Holder and allies"}),move,type,category]),
 effect("stageOperation",140,"Copy or reset ally stat stages",1,1,1,1,"",1,[p("operation","Operation",0,0,1,{0:"Copy an ally's stages to holder",1:"Reset allies' stages"}),p("adjacent","Range",0,0,1,{0:"All active allies",1:"Adjacent allies"}),p("copyFocus","Copy critical focus",1,0,1,{0:"No",1:"Yes"})]),
 effect("clearScreens",141,"Remove screens on entry",1,1,1,1,"",1,[p("scope","Sides",0,0,2,{0:"Both sides",1:"Own side",2:"Opposing side"})]),
 effect("weatherAction",142,"Set weather",1,1,1,1,"",1,[p("activation","Trigger",0,0,1,{0:"Entry / ability gain",1:"After taking a hit"}),p("weather","Weather",4,1,4,undefined,"weather"),p("duration","Duration (turns)",5,1,255)]),
 effect("weatherStat",143,"Stat multiplier in weather",1.333333,.125,8,.000001,"×",4096,[p("stat","Stat",1,1,5,{1:"Attack",3:"Sp. Atk",5:"Speed"}),p("weather","Weather",1,1,4,undefined,"weather")]),
 effect("healAction",144,"Triggered healing",25,.01,100,.01,"",100,[p("format","Amount",0,0,1,{0:"% max HP",1:"Max HP ÷ value"}),p("activation","Trigger",0,0,1,{0:"Entry / ability gain",1:"After eating a Berry"}),p("scope","Targets",0,0,1,{0:"Holder",1:"Allies"}),p("adjacent","Range",0,0,1,{0:"All active allies",1:"Adjacent allies"})]),
 effect("criticalStatus",145,"Force critical against a condition",1,1,1,1,"",1,[p("condition","Target condition",5,1,7,{1:"Paralysis",2:"Sleep",3:"Freeze",4:"Burn",5:"Poison / bad poison",6:"Confusion",7:"Infatuation"})]),
 effect("ignoreEvasion",146,"Ignore target evasion stages",1,1,1,1,"",1,[]),
 effect("fullHpEffectiveness",147,"Type effectiveness at or above an HP threshold",.5,.25,4,.25,"× effectiveness",4096,[p("threshold","HP threshold (%)",100,1,100)],true),
 effect("hazard",148,"Set hazards after taking a hit",1,1,1,1,"",1,[p("hazard","Hazard",7,6,8,{6:"Spikes",7:"Toxic Spikes",8:"Stealth Rock"}),category]),
 effect("retaliate",149,"Retaliate with HP lost to a fatal hit",1,.125,8,.001,"× HP lost",4096,[]),
 effect("perish",150,"Apply a Perish count after contact",3,1,7,1,"turns",1,[move]),
 effect("intimidateCounter",151,"Counter an ability’s entry stat drop",1,1,6,1,"stages",1,[{...stat(),label:"Stat to raise"},p("sourceAbility","Source ability",22,1,255,undefined,"ability"),p("sourceStat","Stat drop to block",1,1,7,undefined,"stat")],true),
 effect("windAbsorb",152,"Absorb matching moves and react to Tailwind",1,-6,6,1,"stages",1,[stat(),move,p("tailwind","Boost when Tailwind starts / on entry",1,0,1,{0:"No",1:"Yes"})],true,true),
 effect("moveGuard",153,"Block selected moves from other Pokémon",1,1,1,1,"",1,[move,type,p("category","Move category",0,0,2,undefined,"category"),p("excludeSelf","Holder’s own moves",1,0,1,{0:"Also block",1:"Allow"})],true),
 effect("weatherGuard",154,"Weather damage immunity",1,1,1,1,"",1,[p("weather","Weather",3,0,4,{0:"All damaging weather",3:"Hail",4:"Sandstorm"},"weather")]),
 ...SCOPED_ABILITY_EFFECTS,
 ...ACTION_ABILITY_EFFECTS,
];
const triggered=RECIPE_ABILITY_EFFECTS.find(e=>e.code===136)!;triggered.parameters.find(p=>p.key==="threshold")!.when={key:"activation",value:2};triggered.parameters.find(p=>p.key==="once")!.when={key:"activation",value:0};for(const key of["moveClass","category"])triggered.parameters.find(p=>p.key===key)!.when={key:"activation",value:[1,2,5]};triggered.parameters.find(p=>p.key==="type")!.when={key:"moveClass",value:9};triggered.parameters.find(p=>p.key==="statSource")!.when={key:"stat",value:8};
RECIPE_ABILITY_EFFECTS.find(e=>e.code===140)!.parameters.find(p=>p.key==="copyFocus")!.when={key:"operation",value:0};
const effectiveness=RECIPE_ABILITY_EFFECTS.find(e=>e.code===147)!;effectiveness.valueChoices=[.25,.5,1,2,4];effectiveness.valueLabels={.25:"¼×",.5:"½×",1:"1×",2:"2×",4:"4×"};
const source=RECIPE_ABILITY_EFFECTS[0].parameters.find(p=>p.key==="sourceType")!;source.labels={18:"Any type"};
export const recipeAbilityEffect=(kind:string)=>RECIPE_ABILITY_EFFECTS.find(e=>e.kind===kind);
export const RECIPE_PARAMETER_BYTES=[1,4,5,6,8,9,10,11,12,13,14,15];
export function recipeAbilityParameter(effect:ItemRuleEffect,key:string){const p=recipeAbilityEffect(effect.kind)?.parameters.find(p=>p.key===key);if(!p)throw new Error(`Unknown recipe parameter: ${key}`);return effect.parameters?.[key]??p.original;}
