/** Move-local recipes. Native move data continues to own ordinary attack properties. */
export type MoveSubject = "user" | "target";
export type MoveCondition =
  | { kind: "group"; mode: "all" | "any"; children: MoveCondition[] }
  | { kind: "hp"; subject: MoveSubject; comparison: "lt" | "lte" | "gt" | "gte"; percent: number }
  | { kind: "stage"; subject: MoveSubject; stat: number; comparison: "lt" | "lte" | "gt" | "gte"; value: number }
  | { kind: "heldItem" | "hasItem" | "berry" | "hidden"; subject: MoveSubject; value: number; negate?: boolean }
  | { kind: "ateBerry" | "moveFailed" | "hitsTaken" | "partyFaints" | "statRaised" | "statLowered" | "selectedMove" | "persistentFromMove" | "adjacent"; subject: MoveSubject; value: number; negate?: boolean }
  | { kind: "type" | "status" | "species" | "ability"; subject: MoveSubject; value: number; negate?: boolean }
  | { kind: "weather" | "field" | "effectiveness" | "targetActed" | "firstTurn" | "grounded" | "ally" | "pendingPriority" | "sameMon"; subject?: MoveSubject; value: number; negate?: boolean };
export const MOVE_ALWAYS: MoveCondition = { kind: "group", mode: "all", children: [] };
export const MOVE_PHASES = ["power", "damage", "accuracy", "check", "hit", "afterMove", "status", "knockout", "hitSide", "afterRealHits","execute","beforeDamage","sequenceStart","sequenceEnd","selection"] as const;
export type MovePhase = typeof MOVE_PHASES[number];
export type MoveTarget = "user" | "target" | "allies" | "opponents" | "all";
export type MoveEffect = {
  kind: string;
  value: number;
  phase: MovePhase;
  target: MoveTarget;
  chance: number;
  secondary: boolean;
  conditions: MoveCondition;
  parameters?: Record<string, number>;
};
export type MoveRuleSet = { conditions: MoveCondition; prerequisites: MoveCondition; effects: MoveEffect[]; nativeBase?: number };
export type MoveParameter = { key: string; label: string; min: number; max: number; original: number; labels?: Record<number, string>; flags?:Record<number,string> };
export type MovePrimitive = {
  kind: string; code: number; label: string; description: string; value: number; min: number; max: number; step: number;
  scale: number; unit: string; phases: readonly MovePhase[]; parameters: MoveParameter[];
};
const parameter = (key: string, label: string, original: number, min: number, max: number, labels?: Record<number, string>): MoveParameter => ({ key, label, original, min, max, labels });
export const MOVE_STAT_LABELS: Record<number, string> = { 1: "Attack", 2: "Defense", 3: "Sp. Atk", 4: "Sp. Def", 5: "Speed", 6: "Accuracy", 7: "Evasion" };
const primitive = (kind: string, code: number, label: string, description: string, value: number, min: number, max: number, step: number, scale: number, unit: string, phases: readonly MovePhase[], parameters: MoveParameter[] = []): MovePrimitive => ({ kind, code, label, description, value, min, max, step, scale, unit, phases, parameters });
const statFlags=Object.fromEntries(Object.entries(MOVE_STAT_LABELS).map(([n,label])=>[1<<(Number(n)-1),label]));
const statSelection:MoveParameter={...parameter("stats","Stats",31,1,127),flags:statFlags};
const immunityTypes={0:"No type check",1:"Normal",2:"Fighting",3:"Flying",4:"Poison",5:"Ground",6:"Rock",7:"Bug",8:"Ghost",9:"Steel",10:"Fire",11:"Water",12:"Grass",13:"Electric",14:"Psychic",15:"Ice",16:"Dragon",17:"Dark",18:"Fairy"};
const moveTypes={...Object.fromEntries(Object.entries(immunityTypes).filter(([id])=>Number(id)>0).map(([id,label])=>[Number(id)-1,label])),255:"Any type"};
const concreteMoveTypes=Object.fromEntries(Object.entries(moveTypes).filter(([id])=>Number(id)<18));
const weatherNames={0:"Clear",1:"Sun",2:"Rain",3:"Hail",4:"Sandstorm"};
const fraction=()=>[parameter("numerator","HP cost parts",33,1,100),parameter("denominator","Out of",100,1,100)];
export const MOVE_PRIMITIVES: readonly MovePrimitive[] = [
  primitive("power", 1, "Power multiplier", "Multiply this move’s power when its conditions match.", 2, .125, 8, .001, 4096, "×", ["power"]),
  primitive("damage", 2, "Damage multiplier", "Multiply damage at the native final modifier stage.", 1.333333, .125, 8, .000001, 4096, "×", ["damage"]),
  primitive("accuracy", 3, "Skip accuracy roll", "Skip the accuracy roll; protection and invulnerability still apply.", 1, 1, 1, 1, 1, "", ["accuracy"]),
  primitive("statStage", 4, "Change stat stages", "Apply native stat changes to the chosen recipients.", 1, -6, 6, 1, 1, "stages", ["hit", "afterMove", "status", "knockout"], [parameter("stat", "Stat", 1, 1, 7, MOVE_STAT_LABELS)]),
  primitive("heal", 5, "Heal maximum HP fraction", "Heal a fraction of maximum HP, optionally checking an ally’s type-absorption abilities.", 1, 1, 100, 1, 1, "parts", ["status", "afterMove"], [parameter("denominator", "Out of", 2, 1, 100),parameter("immunityType","Ally type interactions",0,0,18,immunityTypes)]),
  primitive("cure", 6, "Cure a condition", "Cure the selected native condition, or all major status conditions.", 0, 0, 6, 1, 1, "condition", ["status", "afterMove", "afterRealHits", "hit"]),
  primitive("stages", 7, "Reset or invert stat stages", "Reset stages to neutral, or reverse positive and negative stages.", 0, 0, 1, 1, 1, "", ["status", "afterMove", "hitSide"], [parameter("operation", "Operation", 0, 0, 1, { 0: "Reset", 1: "Invert" })]),
  primitive("native", 8, "Native move operation", "Run one reviewed native move operation at its original event boundary.", 115, 1, 559, 1, 1, "move", ["status", "afterMove", "hitSide"]),
  primitive("hpPower", 9, "Power from current HP", "Scale maximum power by the selected Pokémon’s current HP, with a minimum of one.", 100, 1, 255, 1, 1, "max power", ["power"]),
  primitive("ignoreStages", 10, "Ignore defensive stat stages", "Ignore the target’s defensive and evasion stages for this move.", 1, 1, 1, 1, 1, "", ["damage"]),
  primitive("status", 11, "Inflict a condition", "Apply a native condition with its normal prevention checks.", 4, 1, 6, 1, 1, "condition", ["hit", "status"]),
  primitive("flinch", 12, "Flinch chance", "Roll flinching once per successful hit, with native prevention checks.", 100, 0, 100, 1, 1, "%", ["hit"]),
  primitive("randomStatus",13,"Random condition","Choose one enabled condition after a successful effect-chance roll; an immune result is not rerolled.",19,1,63,1,1,"",["hit","status"]),
  primitive("hpCostBoost",14,"Pay HP to change stats","Pay HP only when the user can afford the cost and at least one selected stat can change.",1,-6,6,1,1,"stages",["status"],[statSelection,...fraction()]),
  primitive("statDrain",15,"Drain a recipient’s stat as HP","Read the recipient’s stat, optionally change its stage, then recover HP through native drain processing.",1,1,100,1,1,"parts",["status"],[parameter("stat","Stat",1,1,5,Object.fromEntries(Object.entries(MOVE_STAT_LABELS).filter(([n])=>Number(n)<=5))),parameter("denominator","Out of",1,1,100),parameter("change","Stat change",0,-6,6)]),
  primitive("cureAndHeal",16,"Cure recipient, then heal user","Recover a fraction of the user’s maximum HP only after curing the recipient’s selected condition.",1,1,100,1,1,"parts",["status"],[parameter("denominator","Out of",2,1,100),parameter("condition","Condition",0,0,6,{0:"All major status",1:"Paralysis",2:"Sleep",3:"Freeze",4:"Burn",5:"Poison",6:"Confusion"})]),
  primitive("useBerry",17,"Consume and use a Berry","Force the chosen Pokémon to consume and use its held Berry through native item processing.",1,1,1,1,1,"",["status"]),
  primitive("berryBoost",18,"Consume a Berry to change stats","Change selected stats and consume the user’s Berry only when at least one selected stat can change.",2,-6,6,1,1,"stages",["status"],[{...statSelection,original:2}]),
  primitive("hazard",19,"Place a native hazard","Place a native hazard on the chosen side; native limits determine accepted layers.",6,6,8,1,1,"",["hitSide","status"],[parameter("side","Side",1,0,2,{0:"User’s side",1:"Opposing side",2:"Both sides"})]),
  primitive("sourceCondition",20,"Source-linked condition","Apply native Leech Seed or escape prevention, linked to the user.",18,18,22,1,1,"",["hit","afterRealHits","status"]),
  primitive("changeType",21,"Change Pokémon type","Replace the recipient’s types or remove one selected type until native switching resets them.",14,0,17,1,1,"type ID",["status","execute"],[parameter("operation","Operation",0,0,1,{0:"Replace both types",1:"Remove this type"})]),
  primitive("swapRawStat",22,"Swap base battle stats","Swap a selected stored battle stat, preserving each Pokémon’s stages.",5,1,5,1,1,"",["status"]),
  primitive("stealStages",23,"Steal positive stat stages","Remove selected positive stages from the recipient and apply them to the user before damage.",127,1,127,1,1,"",["beforeDamage"]),
  primitive("suppressAbility",24,"Suppress an ability","Apply native Gastro Acid suppression to the recipient.",1,1,1,1,1,"",["hit","afterRealHits","status"]),
  primitive("copyAbility",25,"Copy a recipient’s ability","Copy the move recipient’s current ability to the user or its active allies after validating all recipients.",1,1,1,1,1,"",["status"],[parameter("allies","Recipients",1,0,1,{0:"User",1:"User and allies"})]),
  primitive("reducePP",26,"Reduce previous move PP","Remove PP from the recipient’s last-used move if it still occupies a move slot.",3,1,64,1,1,"PP",["hit"]),
  primitive("ignoreAbilities",27,"Ignore defensive abilities","Use the native Mold Breaker window for this move, with unconditional cleanup when the sequence ends.",1,1,1,1,1,"",["sequenceStart"]),
  primitive("bypassSubstitute",28,"Bypass Substitute","Use the native damaging-move Substitute bypass.",1,1,1,1,1,"",["beforeDamage"]),
  primitive("removeItem",29,"Remove held item","Remove a recipient’s item through native Knock Off validation, without consuming it.",1,1,1,1,1,"",["status","hit","afterRealHits"]),
  primitive("tidyField",30,"Clear hazards and Substitutes","Clear selected hazards from both sides and optionally remove active Substitutes.",1,1,1,1,1,"",["status"],[{...parameter("hazards","Hazards",7,0,15),flags:{1:"Spikes",2:"Toxic Spikes",4:"Stealth Rock",8:"Entry stat hazard"}},parameter("substitutes","Substitutes",1,0,1,{0:"Keep",1:"Remove"})]),
  primitive("maxHpRecoil",31,"Maximum HP recoil","Apply recoil once per sequence after an attempted attack or a damage determination, through native damage processing.",1,1,100,1,1,"parts",["sequenceEnd"],[parameter("denominator","Out of",2,1,100),parameter("trigger","Trigger",0,0,1,{0:"Attack attempted",1:"Damage determined"}),parameter("rockHead","Rock Head",0,0,1,{0:"Does not prevent recoil",1:"Prevents recoil"})]),
  primitive("requireHeldItem",32,"Require a held item","Require a recipient to hold an item when first checked; that eligibility lasts through all hits of this sequence.",1,1,1,1,1,"",["beforeDamage"]),
  primitive("damageDrain",33,"Drain damage as HP (always)","Use unconditional native damage draining, including item and ability interactions. Move-use prerequisites still apply.",50,1,100,1,1,"% of damage",["hit"]),
  primitive("allyHealInstead",34,"Heal allies instead of damage","Replace damage to an ally with a fraction of its maximum HP through the native recovery path.",1,1,100,1,1,"parts",["beforeDamage"],[parameter("denominator","Out of",2,1,100)]),
  primitive("typeMatchup",35,"Override a type matchup","Set effectiveness against one defending type before the two types are combined; existing immunities remain in effect.",10,0,17,1,1,"type ID",["damage"],[parameter("effectiveness","Effectiveness",4,2,4,{2:"½×",3:"1×",4:"2×"})]),
  primitive("damageWeather",36,"Change damage weather","Use a selected weather's native damage modifier when the actual weather and move type match.",1,0,4,1,1,"weather",["damage"],[parameter("replacement","Use modifier from",2,0,4,weatherNames),parameter("moveType","Move type",10,0,255,moveTypes)]),
  primitive("thawTargets",37,"Thaw hit targets","Thaw successfully hit targets as a Fire move would, without changing this move’s damage type.",1,1,1,1,1,"",["afterMove"]),
  primitive("ignoreRedirection",38,"Ignore redirection","Keep the chosen target when effects such as Follow Me or Lightning Rod would redirect the move.",1,1,1,1,1,"",["beforeDamage"]),
  primitive("attackStat",39,"Choose attacking stat","Use the selected battle stat for damage, including attacking-stage critical-hit rules.",2,1,5,1,1,"",["damage"]),
  primitive("moveUserType",40,"Use the user’s type","Resolve the move’s type from the user after ordinary type-changing effects.",0,0,1,1,1,"",["beforeDamage"]),
  primitive("drainEachHit",41,"Drain each recipient’s damage","Recover a percentage of each recipient’s damage after a single-hit move, applying Liquid Ooze before recovery.",50,1,100,1,1,"% of damage",["hit"]),
  primitive("historyPower",42,"Power per battle event","Add power for each hit received or party faint, up to a chosen count.",50,1,255,1,1,"power per event",["power"],[parameter("source","Count",0,0,1,{0:"Hits received",1:"Party faints"}),parameter("limit","Count limit",6,1,255)]),
  primitive("selectionGate",43,"Prevent selecting this move","Prevent the move from being chosen while its history conditions match.",1,1,1,1,1,"",["selection"],[parameter("requireSuccess","Previous selection",0,0,1,{0:"Any outcome",1:"Must have succeeded"})]),
  primitive("vulnerableUntilAction",44,"Increase incoming damage until next action","After a successful move, multiply the user’s incoming damage until its next action.",2,.125,8,.001,4096,"×",["hitSide"],[parameter("alwaysHits","Incoming accuracy",1,0,1,{0:"Normal accuracy",1:"Always hits"})]),
  primitive("residualDamage",45,"Recurring maximum-HP damage","After a hit, deal a fraction of the recipient’s maximum HP each turn until it leaves battle.",8,1,100,1,1,"HP denominator",["hit"],[parameter("specialDenominator","Type-match denominator",4,1,100),parameter("type1","First enhanced type",10,0,255,{...moveTypes,255:"None"}),parameter("type2","Second enhanced type",8,0,255,{...moveTypes,255:"None"}),parameter("turns","Turns (0 = until switch)",0,0,255)]),
  primitive("residualStat",46,"Recurring stat-stage change","After a hit, change the recipient’s chosen stat each turn while the source remains active.",-1,-6,6,1,1,"stages",["hit","status"],[parameter("stat","Stat",5,1,7,MOVE_STAT_LABELS),parameter("turns","Turns (0 = until switch)",3,0,255),parameter("linked","Source",1,0,1,{0:"Independent",1:"Must remain active"})]),
  primitive("fieldMoveType",47,"Convert a move type until turn end","Convert one move type across the field for the rest of this turn.",12,0,17,1,1,"",["status","afterRealHits"],[parameter("fromType","Convert from",0,0,17,concreteMoveTypes)]),
  primitive("targetMoveType",48,"Convert a Pokémon’s next move type","Change the recipient’s next move type this turn, if it has not acted.",12,0,17,1,1,"",["status"]),
  primitive("selfTrapBoost",49,"Boost stats and prevent switching","Change the user’s selected stats and prevent it from switching. Once self-trapped, it cannot use this effect again until leaving.",1,-6,6,1,1,"stages",["status"],[statSelection]),
  primitive("mutualTrap",50,"Prevent both Pokémon switching","Apply native source-linked escape prevention to the user and the recipient after a successful hit.",1,1,1,1,1,"",["hit"]),
  primitive("powderReaction",51,"Damage and stop a matching move","Cover the recipient until turn end; its next matching move is stopped and damages it.",9,0,17,1,1,"",["status"],[parameter("denominator","Maximum HP denominator",4,1,100)]),
  primitive("blockMoveFlag",52,"Temporarily block a move flag","Prevent the recipient from using moves with the selected native flag for a number of turns.",8,0,15,1,1,"flag index",["hit"],[parameter("turns","Turns",2,1,255)]),
  primitive("focusCritical",53,"Guarantee critical hits for a time","Guarantee the chosen Pokémon’s critical hits for the selected number of turns, subject to native critical-hit prevention.",2,1,255,1,1,"turns",["status"]),
  primitive("spotlight",54,"Redirect attacks to a Pokémon","Redirect eligible opposing single-target moves to the selected Pokémon until the turn ends.",1,1,1,1,1,"",["status"]),
  primitive("criticalStageBoost",55,"Raise critical-hit stage","Raise recipients’ critical-hit stage until they leave, with a larger boost for a selected type.",1,1,4,1,1,"stages",["status"],[parameter("type","Enhanced type",15,0,17,concreteMoveTypes),parameter("enhanced","Enhanced stages",2,1,4)]),
  primitive("fieldSwitchLock",56,"Temporarily prevent switching","Prevent eligible Pokémon from switching or fleeing for a number of turns.",2,1,255,1,1,"turns",["status"]),
  primitive("entryStatHazard",57,"Place an entry stat hazard","Change a grounded Pokémon’s chosen stat stage when it enters the selected side.",-1,-6,6,1,1,"stages",["status"],[parameter("stat","Stat",5,1,7,MOVE_STAT_LABELS),parameter("side","Side",1,0,2,{0:"User’s side",1:"Opposing side",2:"Both sides"})]),
  primitive("swapSideEffects",58,"Exchange side effects","Exchange supported native side effects and entry stat hazards between the two sides.",1,1,1,1,1,"",["status"]),
  primitive("modernKnockOff",59,"Knock Off with power bonus","Multiply power when native checks allow the recipient’s held item to be removed, then remove it after a successful hit.",1.5,1,8,.001,4096,"× power",["power"]),
];
export const MOVE_STATUS_LABELS: Record<number,string> = {1:"Paralysis",2:"Sleep",3:"Freeze",4:"Burn",5:"Poison",6:"Confusion"};
export const MOVE_EFFECT_VALUE_FLAGS:Record<string,Record<number,string>>={randomStatus:Object.fromEntries(Object.entries(MOVE_STATUS_LABELS).map(([n,label])=>[1<<(Number(n)-1),label])),stealStages:statFlags};
export const MOVE_EFFECT_VALUE_LABELS: Record<string,Record<number,string>> = {
 damageWeather:weatherNames, attackStat:Object.fromEntries(Object.entries(MOVE_STAT_LABELS).filter(([n])=>Number(n)<=5)), moveUserType:{0:"First available type",1:"Second type, falling back to first"},
 fieldMoveType:concreteMoveTypes,targetMoveType:concreteMoveTypes,powderReaction:concreteMoveTypes,blockMoveFlag:{0:"Contact",1:"Charging",2:"Recharge",3:"Blocked by Protect",8:"Sound",9:"Blocked by Gravity",11:"Triple-battle range",12:"Healing",14:"Powder"},
 status: MOVE_STATUS_LABELS, cure: {0:"All major status",...MOVE_STATUS_LABELS}, native: {113:"Light Screen",115:"Reflect",215:"Heal Bell",229:"Clear own hazards and trapping"},hazard:{6:"Spikes",7:"Toxic Spikes",8:"Stealth Rock"},sourceCondition:{18:"Leech Seed",22:"Escape prevention"},swapRawStat:Object.fromEntries(Object.entries(MOVE_STAT_LABELS).filter(([n])=>Number(n)<=5)),
};
export function moveEffectTargets(kind: string): readonly MoveTarget[] {
 if(["power","historyPower","selectionGate","vulnerableUntilAction","fieldMoveType","damage","accuracy","ignoreStages","native","damageWeather","thawTargets","ignoreRedirection","attackStat","moveUserType"].includes(kind))return ["user"];
 if(kind==="hpPower")return ["user","target"];
 if(["flinch","residualDamage","residualStat","targetMoveType","mutualTrap","powderReaction","blockMoveFlag","spotlight"].includes(kind))return ["target"];
 if(["hpCostBoost","berryBoost","selfTrapBoost"].includes(kind))return ["user"];
 if(kind==="criticalStageBoost")return ["user","target","allies"];
 if(["statDrain","cureAndHeal"].includes(kind))return ["target"];
 if(["hazard","copyAbility","ignoreAbilities","bypassSubstitute","tidyField","maxHpRecoil","damageDrain","drainEachHit","entryStatHazard","swapSideEffects"].includes(kind))return ["user"];
 if(["swapRawStat","stealStages","reducePP","requireHeldItem","allyHealInstead","typeMatchup","modernKnockOff"].includes(kind))return ["target"];
 return ["user","target","allies","opponents","all"];
}
export const MOVE_NATIVE_OPERATIONS = [113, 115, 215,229] as const;
// Further aliases need their generic-effect data and sequencing reviewed together.
export const MOVE_NATIVE_BASES = [280,364] as const;
export const movePrimitive = (kind: string) => MOVE_PRIMITIVES.find(p => p.kind === kind);
export const moveEffectAllowsChance=(kind:string)=>!["power","historyPower","selectionGate","vulnerableUntilAction","fieldMoveType","damage","accuracy","hpPower","ignoreStages","flinch","hazard","ignoreAbilities","bypassSubstitute","requireHeldItem","damageDrain","allyHealInstead","typeMatchup","damageWeather","thawTargets","ignoreRedirection","attackStat","moveUserType","drainEachHit","entryStatHazard","swapSideEffects","modernKnockOff"].includes(kind);
export function movePhaseMatchesCategory(phase: MovePhase, category: number): boolean { return phase==="selection" || (category === 0 ? phase === "status" : phase !== "status"); }
export function validateMoveRuleCategory(rule: MoveRuleSet, category: number): void {
  if (!integer(category,0,2) || category===0 && rule.nativeBase || rule.effects.some(e=>!movePhaseMatchesCategory(e.phase,category))) throw Error("Choose effect timings that match the move’s Status, Physical or Special category.");
}
export function validateMoveRuleHits(rule:MoveRuleSet,hits:number):void {
  if(rule.effects.some(e=>e.kind==="drainEachHit")&&((hits&15)>1||(hits>>4&15)>1))throw Error("Per-recipient drain currently supports single-hit moves only.");
}
export function newMoveEffect(kind = "power"): MoveEffect {
  const p = movePrimitive(kind); if (!p) throw Error("Unknown move primitive.");
  return { kind, value: p.value, phase: p.phases[0], target: ["flinch","statDrain","cureAndHeal","swapRawStat","stealStages","reducePP","requireHeldItem","allyHealInstead","typeMatchup","modernKnockOff","residualDamage","residualStat","targetMoveType","mutualTrap","powderReaction","blockMoveFlag","spotlight"].includes(kind) ? "target" : "user", chance: 100, secondary: ["flinch","randomStatus","reducePP"].includes(kind), conditions: structuredClone(MOVE_ALWAYS) };
}
export const EMPTY_MOVE_RULE: MoveRuleSet = { conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS), effects: [newMoveEffect()] };
const integer = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
export function validateMoveCondition(input: MoveCondition): MoveCondition {
  let nodes = 0;
  function visit(c: MoveCondition, depth: number): MoveCondition {
    if (!c || ++nodes > 32 || depth > 3) throw Error("Move conditions exceed their nesting or node limit.");
    if (c.kind === "group") {
      if (!["all", "any"].includes(c.mode) || !Array.isArray(c.children) || c.children.length > 8) throw Error("Invalid move condition group.");
      return { kind: c.kind, mode: c.children.length ? c.mode : "all", children: c.children.map(child => visit(child, depth + 1)) };
    }
    if (c.kind === "hp") {
      if (!["user", "target"].includes(c.subject) || !["lt", "lte", "gt", "gte"].includes(c.comparison) || !integer(c.percent, 0, 100)) throw Error("Invalid HP condition.");
      return { kind: c.kind, subject: c.subject, comparison: c.comparison, percent: c.percent };
    }
    if(c.kind==="stage"){
      if(!["user","target"].includes(c.subject)||!["lt","lte","gt","gte"].includes(c.comparison)||!integer(c.stat,1,7)||!integer(c.value,0,12))throw Error("Invalid stat-stage condition.");
      return {kind:c.kind,subject:c.subject,stat:c.stat,comparison:c.comparison,value:c.value};
    }
    const ranges: Record<string, [number, number]> = { ateBerry:[0,1],moveFailed:[0,1],hitsTaken:[1,255],partyFaints:[1,255],statRaised:[0,1],statLowered:[0,1],selectedMove:[0,65534],persistentFromMove:[0,65534],adjacent:[0,1],hidden:[0,1],heldItem:[1,65534],hasItem:[0,1],berry:[0,1],type: [0, 17], status: [0, 35], species: [1, 65534], ability: [1, 255], weather: [0, 4], field: [1, 8], effectiveness: [0, 5], targetActed: [0, 1], firstTurn: [0, 1], grounded: [0, 1], ally: [0, 1], pendingPriority: [-7, 7], sameMon: [0, 1] };
    const bounds = ranges[c.kind];
    if (!bounds || !integer(c.value, ...bounds) || c.subject !== undefined && !["user", "target"].includes(c.subject) || c.negate !== undefined && typeof c.negate !== "boolean") throw Error("Invalid move condition.");
    return { kind: c.kind, ...(c.kind === "weather" || c.kind === "field" ? {} : { subject: c.subject ?? "target" }), value: c.value, ...(c.negate ? { negate: true } : {}) } as MoveCondition;
  }
  return visit(input, 0);
}
export function validateMoveRule(input: MoveRuleSet): MoveRuleSet {
  if (!input || !Array.isArray(input.effects) || input.effects.length > 16 || !input.effects.length && !input.nativeBase && input.prerequisites?.kind === "group" && !input.prerequisites.children.length) throw Error("Choose an effect, a prerequisite or a native base behavior.");
  if (input.nativeBase !== undefined && !(MOVE_NATIVE_BASES as readonly number[]).includes(input.nativeBase)) throw Error("Unreviewed native move base.");
  const conditions=validateMoveCondition(input.conditions),prerequisites=validateMoveCondition(input.prerequisites);
  const usesEffectiveness=(c:MoveCondition):boolean=>c.kind==="group"?c.children.some(usesEffectiveness):c.kind==="effectiveness";
  if(usesEffectiveness(prerequisites))throw Error("Type effectiveness is available at the final damage stage, after use prerequisites.");
  if(!input.effects.length && !(conditions.kind==="group"&&!conditions.children.length))throw Error("Activation conditions require a recipe effect. Use prerequisites to restrict the whole move.");
  const identities = new Set<string>();
  const needsRecipient = (c: MoveCondition): boolean => c?.kind === "group" ? c.children.some(needsRecipient) : !!c && !["weather","field"].includes(c.kind) && (c.subject ?? "target") === "target";
  const effects = input.effects.map(e => {
    const p = movePrimitive(e?.kind);
    if (!p || !Number.isFinite(e.value) || e.value < p.min || e.value > p.max || Math.abs(e.value / p.step - Math.round(e.value / p.step)) > 1e-7 || ["statStage","hpCostBoost","berryBoost","residualStat","selfTrapBoost","entryStatHazard"].includes(e.kind) && !e.value) throw Error("Invalid move effect value.");
    const effectConditions=validateMoveCondition(e.conditions);
    if(["entryStatHazard","swapSideEffects"].includes(e.kind)&&(e.secondary||e.chance!==100))throw Error("Side effects cannot be secondary or use an effect-chance roll.");
    if(e.kind!=="damage" && (usesEffectiveness(conditions)||usesEffectiveness(effectConditions)))throw Error("Type effectiveness conditions require a final damage multiplier effect.");
    if (!p.phases.includes(e.phase) || !moveEffectTargets(e.kind).includes(e.target) || !integer(e.chance, 1, 100) || typeof e.secondary !== "boolean") throw Error("Invalid move effect timing, target or chance.");
    if (["power","historyPower","selectionGate","vulnerableUntilAction","fieldMoveType","damage","accuracy","hpPower","ignoreStages","hazard","ignoreAbilities","bypassSubstitute","requireHeldItem","damageDrain","allyHealInstead","typeMatchup","damageWeather","thawTargets","ignoreRedirection","attackStat","moveUserType","modernKnockOff"].includes(e.kind) && e.chance !== 100) throw Error("Calculation effects and native windows do not roll an effect chance.");
    if(e.kind==="modernKnockOff"&&(e.secondary||input.nativeBase||input.effects.filter(x=>["modernKnockOff","removeItem"].includes(x.kind)).length!==1))throw Error("Choose one primary Knock Off effect without another item-removal effect or native base.");
    if(e.kind==="residualDamage"&&[e.parameters?.type1??10,e.parameters?.type2??8].some(t=>t>17&&t!==255))throw Error("Choose a supported enhanced type or None.");
    if(e.kind==="mutualTrap"&&e.secondary)throw Error("Mutual trapping is a primary effect.");
    if(e.kind==="residualDamage"&&e.phase!=="hit")throw Error("Recurring effects require a successful hit.");
    if(e.kind==="vulnerableUntilAction"&&(e.secondary||needsRecipient(conditions)||needsRecipient(effectConditions)))throw Error("Incoming-damage conditions can inspect the user, weather or field.");
    if(e.kind==="selectionGate"){
      const allowed=(c:MoveCondition):boolean=>c.kind==="group"?c.children.every(allowed):["ateBerry","moveFailed","hitsTaken","partyFaints","statRaised","statLowered","selectedMove"].includes(c.kind)&&c.subject==="user";
      if(e.secondary||!allowed(conditions)||!allowed(effectConditions)||input.effects.filter(x=>x.kind==="selectionGate").length>1)throw Error("Selection restrictions can inspect only the user's battle history; choose one selection restriction.");
    }
    if(e.kind==="damageDrain"&&(e.secondary||conditions.kind!=="group"||conditions.children.length||effectConditions.kind!=="group"||effectConditions.children.length||input.effects.filter(x=>x.kind==="damageDrain").length>1))throw Error("Native damage drain is unconditional and may appear once per move.");
    if(e.kind==="drainEachHit"&&(e.secondary||e.chance!==100||input.nativeBase||input.effects.filter(x=>["drainEachHit","damageDrain","ignoreAbilities","requireHeldItem","maxHpRecoil","allyHealInstead","native","removeItem","modernKnockOff"].includes(x.kind)).length!==1))throw Error("Per-recipient drain needs its own sequence state and cannot share it with another drain, native operation or sequence-state effect.");
    if (e.kind === "flinch" && (e.chance !== 100 || !e.secondary || e.target !== "target")) throw Error("Flinch uses its own percentage and must target move recipients as a secondary effect.");
    if (e.secondary && !["user","target"].includes(e.target)) throw Error("Secondary effects target the user or each move recipient.");
    if (e.secondary && e.phase !== "hit" && !(e.kind==="sourceCondition"&&e.phase==="afterRealHits") && !(e.kind==="hazard"&&e.phase==="hitSide")) throw Error("Secondary effects must use a supported successful-hit boundary.");
    if (e.kind === "native" && e.target !== "user") throw Error("Native party and side operations run once for the user.");
    if (e.kind === "native" && !(MOVE_NATIVE_OPERATIONS as readonly number[]).includes(e.value)) throw Error("Unreviewed native move operation.");
    if(e.kind==="sourceCondition"&&![18,22].includes(e.value))throw Error("Unreviewed source-linked condition.");
    if(["ignoreAbilities","requireHeldItem","maxHpRecoil","allyHealInstead"].includes(e.kind)&&input.nativeBase)throw Error("Sequence state cannot share native base-handler work.");
    if(e.kind==="allyHealInstead"&&(e.secondary||e.value>(e.parameters?.denominator??2)||input.effects.filter(x=>x.kind==="allyHealInstead").length>1))throw Error("Choose one primary ally-healing effect with a fraction no greater than maximum HP.");
    if(e.kind==="typeMatchup"&&e.secondary)throw Error("A type-matchup override is a primary calculation effect.");
    if(e.kind==="damageWeather"&&(e.secondary||((e.parameters?.moveType??10)>17&&(e.parameters?.moveType??10)!==255)))throw Error("Choose a supported move type or any type for the damage-weather effect.");
    if(e.kind==="thawTargets"&&(e.secondary||needsRecipient(conditions)||needsRecipient(effectConditions)))throw Error("Thaw conditions can inspect the user, weather or field before the native hit-target operation.");
    if(e.kind==="ignoreRedirection"&&e.secondary)throw Error("Redirection checks are primary effects.");
    if(e.kind==="attackStat"&&(e.secondary||input.effects.filter(x=>x.kind==="attackStat").length>1))throw Error("Choose one primary attacking-stat selector.");
    if(e.kind==="moveUserType"&&(e.secondary||needsRecipient(conditions)||needsRecipient(effectConditions)||input.effects.filter(x=>x.kind==="moveUserType").length>1))throw Error("Move-type conditions can inspect the user, weather or field; choose one type selector.");
    if(e.kind==="requireHeldItem"&&input.effects.filter(e=>e.kind==="requireHeldItem").length>1)throw Error("Choose one held-item requirement per recipe.");
    if(e.kind==="bypassSubstitute"&&(needsRecipient(conditions)||needsRecipient(effectConditions)))throw Error("Substitute bypass conditions can inspect the user, weather or field.");
    if(e.kind==="ignoreAbilities"&&(needsRecipient(conditions)||needsRecipient(effectConditions)))throw Error("Ability-window conditions can inspect the user, weather or field before targeting.");
    if (e.kind === "accuracy" && (needsRecipient(conditions) || needsRecipient(effectConditions))) throw Error("Accuracy bypass conditions can inspect the user, weather or field; this native event has no recipient.");
    if (["heal","cureAndHeal"].includes(e.kind) && e.value > (e.parameters?.denominator ?? 2)) throw Error("A healing fraction cannot exceed maximum HP.");
    if(e.kind==="maxHpRecoil"&&e.value>(e.parameters?.denominator??2))throw Error("Recoil cannot exceed maximum HP.");
    if(e.kind==="hpCostBoost"&&(e.parameters?.numerator??33)>(e.parameters?.denominator??100))throw Error("An HP payment cannot exceed maximum HP.");
    if(["hpCostBoost","berryBoost","cureAndHeal","useBerry","statDrain","selfTrapBoost"].includes(e.kind)&&e.secondary)throw Error("Transactional operations are primary effects.");
    const parameters: Record<string, number> = {};
    for (const [key, value] of Object.entries(e.parameters ?? {})) {
      const def = p.parameters.find(p => p.key === key);
      if (!def || !integer(value, def.min, def.max)) throw Error(`Invalid move parameter: ${key}`);
      parameters[key] = value;
    }
    const result: MoveEffect = { kind: e.kind, value: e.kind === "stages" ? parameters.operation ?? 0 : e.value, phase: e.phase, target: e.target, chance: e.chance, secondary: e.secondary, conditions: effectConditions, ...(Object.keys(parameters).length ? { parameters } : {}) };
    const identity = JSON.stringify(result); if (identities.has(identity)) throw Error("Remove duplicate move effects."); identities.add(identity);
    return result;
  });
  return { conditions, prerequisites, effects, ...(input.nativeBase === undefined ? {} : { nativeBase: input.nativeBase }) };
}
export const MOVE_PHASE_EVENTS: Record<MovePhase, number> = { power: 0x37, damage: 0x47, accuracy: 0x32, check: 0x1f, hit: 0x4b, afterMove: 0x84, status: 0xa0, knockout: 0x83, hitSide: 0x4d, afterRealHits: 0x83,execute:0x25,beforeDamage:0x46,sequenceStart:3,sequenceEnd:4,selection:0 };
export function checkedMoveEventList(events:Iterable<number>):number[]{
 const list=[...new Set(events)].sort((a,b)=>a-b);
 if(list.some(e=>!Number.isInteger(e)||e<0||e>0xa5||e===0x7a))throw Error("Move recipes cannot subscribe to weather-query or unsupported native events.");
 return list;
}
/** Small per-move event tables prevent condition queries on unrelated battle events. */
export function moveRecipeEvents(input: MoveRuleSet, legacyV2=false, legacyBypass=false): number[] {
  const rule = validateMoveRule(input), events = new Set(rule.effects.flatMap(e => ["selectionGate","damageDrain","typeMatchup","damageWeather","thawTargets","ignoreRedirection","attackStat","moveUserType"].includes(e.kind)?[]:e.kind==="modernKnockOff"?[3,4,0x37,0x83]:e.kind==="drainEachHit"?[3,0x4b,0x4d]:e.kind==="allyHealInstead"?[0x30,0x31]:e.kind === "ignoreStages" ? [0x3a, 0x33] : e.kind==="requireHeldItem"?(legacyV2?[3,0x2d]:[3,0x2d,0x46]):e.kind==="ignoreAbilities"?[3,4]:e.kind==="maxHpRecoil"?[3,4,...((e.parameters?.trigger??0)===0?[0x25,0x26]:[0x45])]:e.kind==="bypassSubstitute"?(legacyBypass?[5]:[]):e.phase === "status" ? [0xa0,0xa1] : [MOVE_PHASE_EVENTS[e.phase]]));
  const check = movePrerequisiteEvent(rule.prerequisites); if (check) events.add(check);
  return checkedMoveEventList(events);
}
/** Recipient requirements run after native targeting; user-only checks can fail early. */
export function movePrerequisiteEvent(c: MoveCondition): number {
  if (c.kind === "group" && !c.children.length) return 0;
  const targeted = (n: MoveCondition): boolean => n.kind === "group" ? n.children.some(targeted) : !["weather", "field"].includes(n.kind) && (n.subject ?? "target") === "target";
  return targeted(c) ? 0x2c : 0x1f;
}
export const MOVE_CONDITION_CODES: Record<string, number> = { hp: 1, type: 2, weather: 3, species: 4, status: 5, ability: 6, field: 7, effectiveness: 8, targetActed: 9, firstTurn: 10, grounded: 11, ally: 12, pendingPriority: 13, sameMon: 14,stage:15,heldItem:16,hasItem:17,berry:18,hidden:19,ateBerry:20,moveFailed:21,hitsTaken:22,partyFaints:23,statRaised:24,statLowered:25,selectedMove:26,persistentFromMove:27,adjacent:28 };
export function encodeMoveConditions(condition: MoveCondition): number[] {
  const bytes: number[] = [];
  function emit(c: MoveCondition) {
    if (c.kind === "group") { bytes.push(c.mode === "all" ? 128 : 129, c.children.length, 0, 0, 0, 0, 0, 0); c.children.forEach(emit); }
    else {
      const v = c.kind === "hp" ? c.percent : c.value;
      bytes.push(MOVE_CONDITION_CODES[c.kind], c.subject === "user" ? 0 : 1, c.kind === "hp" || c.kind === "stage" ? ["lt", "lte", "gt", "gte"].indexOf(c.comparison) : Number(Boolean(c.negate)), c.kind==="stage"?c.stat:0, v & 255, v >> 8 & 255, 0, 0);
    }
  }
  emit(validateMoveCondition(condition)); return bytes;
}
export function encodeMoveRules(entries: ReadonlyMap<number, MoveRuleSet>, nullType=0): Uint8Array {
  if(![0,17,18].includes(nullType))throw Error("Unrecognized native type count.");
  const sorted = [...entries].sort(([a], [b]) => a - b), bytes: number[] = Array(4 + sorted.length * 16).fill(0);
  bytes[0] = sorted.length & 255; bytes[1] = sorted.length >> 8; bytes[2] = 1;bytes[3]=nullType;
  for (const [index, [id, input]] of sorted.entries()) {
    if (!integer(id, 1, 65534)) throw Error("Move IDs must fit the ROM's move range.");
    const rule = validateMoveRule(input), at = bytes.length, global = encodeMoveConditions(rule.conditions), requirements = encodeMoveConditions(rule.prerequisites);
    const entry = 4 + index * 16; bytes[entry] = id & 255; bytes[entry + 1] = id >> 8;
    for (let k = 0; k < 4; ++k) bytes[entry + 4 + k] = at >>> k * 8 & 255;
    bytes.push(rule.effects.length, global.length / 8, requirements.length / 8, movePrerequisiteEvent(rule.prerequisites), (rule.nativeBase ?? 0) & 255, (rule.nativeBase ?? 0) >> 8, 0, 0, ...global, ...requirements);
    for (const e of rule.effects) {
      const def = movePrimitive(e.kind)!, conditions = encodeMoveConditions(e.conditions), row = Array(32).fill(0), v = Math.round(e.value * def.scale);
      row[0] = def.code; row[1] = MOVE_PHASES.indexOf(e.phase); row[2] = ["user", "target", "allies", "opponents", "all"].indexOf(e.target); row[3] = Number(e.secondary); row[4] = e.chance; row[5] = conditions.length / 8; row[6] = v & 255; row[7] = v >> 8 & 255;
      def.parameters.forEach((p, i) => { const value = e.parameters?.[p.key] ?? p.original; row[8 + i * 2] = value & 255; row[9 + i * 2] = value >> 8 & 255; });
      bytes.push(...row, ...conditions);
    }
  }
  if (bytes.length > 65535) throw Error("Move recipes exceed the shared configuration budget.");
  return Uint8Array.from(bytes);
}
