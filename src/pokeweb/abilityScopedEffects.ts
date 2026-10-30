import type {RecipeAbilityEffect} from "./abilityRecipeEffects";
import type {NativeAbilityParameter} from "./abilityNativeParameters";
const param=(key:string,label:string,original:number,min:number,max:number,labels?:Record<number,string>,kind:NativeAbilityParameter["kind"]="number"):NativeAbilityParameter=>({key,label,original,min,max,step:1,kind,sites:[],...(labels?{labels,...(kind==="type"?{}:{choices:Object.keys(labels).map(Number)})}:{})});
const stat=param("stat","Stat",1,1,4,{1:"Attack",2:"Defense",3:"Sp. Atk",4:"Sp. Def"},"stat");
const definition=(kind:string,code:number,label:string,value:number,min:number,max:number,step:number,unit:string,scale:number,parameters:NativeAbilityParameter[],bypassable=false,fixedBypass=false):RecipeAbilityEffect=>({kind:`abilityRecipe:${kind}`,code,label,value,min,max,step,unit,scale,parameters,bypassable,fixedBypass});
export const SCOPED_ABILITY_EFFECTS:RecipeAbilityEffect[]=[
 definition("fieldPower",155,"Field-wide type power",1.333333,.125,8,.000001,"× power",4096,[param("type","Move type",16,0,17,undefined,"type"),param("invertedPercent","Power with aura inversion (%)",75,1,255)],false,true),
 definition("auraInvert",156,"Invert field-wide aura bonuses",1,1,1,1,"",1,[],false,true),
 definition("fieldStat",157,"Field-wide stat multiplier",.75,.125,8,.001,"× stat",4096,[stat],false,true),
 definition("moveUserType",158,"Change holder type before moving",1,1,1,1,"",1,[param("limit","Activation limit",1,0,1,{0:"Every move",1:"Once per entry / ability gain"}),param("type","New type",18,0,18,{18:"Move's resolved type"},"type")]),
 definition("entryTargetStat",159,"Attacking stats against a new entrant",2,.125,8,.001,"× stat",4096,[]),
 definition("fallenPower",160,"Power per fainted ally at entry",10,0,100,1,"% per ally",1,[param("cap","Maximum fainted allies",5,1,5)]),
 definition("priorityGuard",161,"Protect against priority moves",1,1,7,1,"minimum priority",1,[param("scope","Protect",1,0,1,{0:"Holder",1:"Holder and allies"})],true),
 definition("statEcho",162,"Reflect or copy stat changes",1,.125,4,.125,"× stages",4096,[param("mode","Action",0,0,1,{0:"Reflect stat drops",1:"Copy opposing stat boosts"}),param("stat","Stat filter",0,0,7,{0:"All stats",1:"Attack",2:"Defense",3:"Sp. Atk",4:"Sp. Def",5:"Speed",6:"Accuracy",7:"Evasion"})],true),
 definition("transferItem",163,"Transfer a held item",1,1,1,1,"",1,[param("mode","Trigger and transfer",0,0,1,{0:"Steal after dealing damage",1:"Give after an ally uses an item"}),param("activationChance","Chance (%)",100,0,100)]),
];
