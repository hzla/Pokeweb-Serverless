/** Declarative, four-battler cases; all commands execute through native UI. */
import type { HarnessPokemon } from "../src/pokeweb/battleHarness";

export type BattleRole = "attacker" | "ally" | "defender" | "defenderAlly";
export type DoublesCase = {
  id: string; completeTurn?: boolean; targetRole?: BattleRole; allyMoveSlot?: number;
  hp?: Partial<Record<BattleRole, number>>;
  statuses?: Partial<Record<BattleRole, number>>;
  stages?: Partial<Record<BattleRole, number[]>>;
  expectedStages?: Partial<Record<BattleRole, number[]>>;
  expectedTypes?: Partial<Record<BattleRole, number[]>>;
  expectedHealing?: Partial<Record<BattleRole, number>>;
  expectedStatuses?: Partial<Record<BattleRole, number>>;
  expectedStatusesBefore?: Partial<Record<BattleRole, number>>;
  expectedTargets?: BattleRole[]; expectedBasePower?: number; expectedSpread?: boolean;
  expectedNativeSuccess?: boolean; expectedCoins?: number;
  expectedCriticalRanks?: Partial<Record<BattleRole, number>>;
  expectedFocus?: Partial<Record<BattleRole, boolean>>;
  typeRatios?: Partial<Record<BattleRole,number>>; terrainPowerRatio?: number;
  drain?: boolean; oozeRoles?: BattleRole[]; bigRoot?: boolean;
  expectedExecutedMove?: number; moveSlot?: number;
  accuracyRoll?: number; incomingAccuracyRoll?: number; secondaryRoll?: number; setupSlots?: number[];
  setupCommands?: { slot: number; case: DoublesCase }[];
  followup?: { slot: number; moveId: number; power: number; category: number; type: number; playerAbilityId?: number; case: DoublesCase };
  expectedTransform?: boolean;
  allyTargetRole?: BattleRole;
  expectedHazardsBefore?: number[]; expectedHazardsAfter?: number[];
  expectedUserConditionsBefore?: number[]; expectedUserConditionsAfter?: number[];
  expectedAllyHealBlock?: boolean;
};
export type DoublesVariant = {
  name: string; trainerId: number; abilityId: number; trainerMove: number;
  playerAbilityId: number; playerSpecies?: number; allyAbilityId: number; allySpecies: number;
  allyMoves: number[]; allyLevel?: number; defenderSpecies?: number; defenderLevel?: number;
  defenderAllySpecies: number; defenderAllyAbilityId: number; defenderAllyMove?: number;
  defenderAllyLevel?: number; save: string; cases: DoublesCase[];
  battleType: "Doubles"; player: HarnessPokemon; allyPlayer: HarnessPokemon;
};

export const doublesDefinitions = {
  decorate: { id: 777, type: 17, power: 0, category: 0, accuracy: 101 },
  "expanding-force": { id: 797, type: 13, power: 80, category: 2, accuracy: 100 },
  "snipe-shot": { id: 745, type: 10, power: 80, category: 2, accuracy: 100 },
  "jungle-healing": { id: 816, type: 11, power: 0, category: 0, accuracy: 101, target: 7 },
  "life-dew": { id: 791, type: 10, power: 0, category: 0, accuracy: 101, target: 7 },
  "lunar-blessing": { id: 849, type: 13, power: 0, category: 0, accuracy: 101, target: 7 },
  "dragon-cheer": { id: 913, type: 15, power: 0, category: 0, accuracy: 101, target: 7 },
  "make-it-rain": { id: 874, type: 8, power: 120, category: 2, accuracy: 100, target: 5 },
  "matcha-gotcha": { id: 902, type: 11, power: 80, category: 2, accuracy: 90, target: 5 },
  "mortal-spin": { id: 866, type: 3, power: 30, category: 1, accuracy: 100, target: 5 },
};

export function doublesVariants(name: string): DoublesVariant[] {
  const definition = doublesDefinitions[name as keyof typeof doublesDefinitions];
  if (!definition) return [];
  const basePlayer: HarnessPokemon = { speciesId: 151, level: 50, abilityId: 99, moves: [definition.id,150,182,678], itemId: 0 };
  const variants: DoublesVariant[] = [];
  function add(label: string, cases: DoublesCase[], player: Partial<HarnessPokemon> = {}, ally: Partial<HarnessPokemon> = {}, npc: Partial<DoublesVariant> = {}) {
    const user = {...basePlayer,...player};
    const partner = {...basePlayer,speciesId:149,abilityId:50,moves:[150],...ally};
    const index = variants.length + 1;
    variants.push({ name: label, trainerId:index, abilityId:50, trainerMove:150,
      playerAbilityId:user.abilityId!, playerSpecies:user.speciesId, allyAbilityId:partner.abilityId!, allySpecies:partner.speciesId,
      allyMoves:partner.moves!, allyLevel:partner.level, defenderSpecies:143, defenderAllySpecies:242, defenderAllyAbilityId:50,
      save:`battle-${label}.sav`, battleType:"Doubles", player:user, allyPlayer:partner,...npc,
      cases: cases.map(test => ({completeTurn:true,accuracyRoll:0,secondaryRoll:99,...test})) });
  }
  if (name === "decorate") {
    const boosted = [8,6,8,6,6,6,6];
    add("normal", [{id:"ally-attack-and-special-attack",targetRole:"ally",expectedStages:{ally:boosted}},
      {id:"capped-ally",targetRole:"ally",stages:{ally:[12,6,12,6,6,6,6]},expectedStages:{ally:[12,6,12,6,6,6,6]}}]);
    add("contrary",[{id:"contrary-reverses",targetRole:"ally",expectedStages:{ally:[4,6,4,6,6,6,6]}}],{}, {abilityId:126});
    add("simple",[{id:"simple-doubles",targetRole:"ally",expectedStages:{ally:[10,6,10,6,6,6,6]}}],{}, {abilityId:86});
    for (const move of [182,164,19,578]) add(`ally-${move}`,[{id:`protect-substitute-hiding-crafty-${move}`,targetRole:"ally",
      expectedStages:{ally:move===182?boosted:[6,6,6,6,6,6,6]}}],{}, {level:100,moves:[move]});
    add("magic-bounce",[{id:"not-reflected",targetRole:"defender",expectedStages:{defender:boosted}}],{}, {},{defenderSpecies:196,abilityId:156});
  } else if (["life-dew","jungle-healing","lunar-blessing"].includes(name)) {
    add("normal", [{id:"heal-both-active-allies",hp:{attacker:60,ally:60},expectedHealing:{attacker:43,ally:41}},
      {id:"full-hp-no-effect",expectedHealing:{attacker:0,ally:0}},
      {id:"cap-at-missing-hp",hp:{attacker:170,ally:160},expectedHealing:{attacker:5,ally:6}}]);
    if (name !== "life-dew") {
      add("status",[{id:"cure-both-major-statuses-and-heal",expectedStatusesBefore:{attacker:4,ally:5},expectedStatuses:{attacker:0,ally:0},expectedHealing:{attacker:43,ally:41}}],{currentHp:60,status:"burn"},{currentHp:60,status:"poison"});
      add("status-full",[{id:"status-only-at-full-hp",expectedStatusesBefore:{attacker:4,ally:5},expectedStatuses:{attacker:0,ally:0},expectedHealing:{attacker:0,ally:0}}],{status:"burn"},{status:"poison"});
    }
    add("substitute",[{id:"heal-through-ally-substitute",hp:{attacker:60,ally:100},expectedHealing:{attacker:43,ally:0}}],{}, {level:100,moves:[164]});
    add("hiding",[{id:"semi-invulnerable-ally-not-healed",hp:{attacker:60,ally:100},expectedHealing:{attacker:43,ally:0}}],{}, {level:100,moves:[19]});
    // Protect the user on the setup turn while native enemy Heal Block hits
    // the partner. The slow NPC cannot re-block the user before it heals.
    add("heal-block",[{id:"blocked-ally-does-not-prevent-user-heal",hp:{attacker:60,ally:60},setupSlots:[2],
      expectedAllyHealBlock:true,expectedHealing:{attacker:43,ally:0}}],{}, {},{trainerMove:377,defenderLevel:1});
    if (name === "life-dew") {
      add("water-absorb",[{id:"absorption-not-double-healing",hp:{attacker:60,ally:60},expectedHealing:{attacker:43,ally:41}}],{}, {abilityId:11});
      add("dry-skin",[{id:"dry-skin-not-double-healing",hp:{attacker:60,ally:60},expectedHealing:{attacker:43,ally:41}}],{}, {abilityId:87});
      add("storm-drain",[{id:"storm-drain-boost-no-normal-heal",hp:{attacker:60,ally:60},expectedHealing:{attacker:43,ally:0},expectedStages:{ally:[6,6,7,6,6,6,6]}}],{}, {abilityId:114});
      add("status",[{id:"does-not-cure-status",expectedStatusesBefore:{attacker:4,ally:5},expectedStatuses:{attacker:4,ally:5},expectedHealing:{attacker:22,ally:21}}],{currentHp:60,status:"burn"},{currentHp:60,status:"poison"});
    }
  } else if (name === "expanding-force") {
    add("normal",[{id:"no-terrain-single-target",targetRole:"defender",expectedTargets:["defender"],expectedBasePower:80,expectedSpread:false}]);
    add("psychic",[{id:"grounded-psychic-spread",expectedTargets:["defender","defenderAlly"],expectedBasePower:120,expectedSpread:true,terrainPowerRatio:5325}],{}, {}, {defenderSpecies:137,abilityId:227});
    add("airborne",[{id:"airborne-no-expansion",targetRole:"defender",expectedTargets:["defender"],expectedBasePower:80,expectedSpread:false}],{itemId:541},{},{defenderSpecies:137,abilityId:227});
  } else if (name === "make-it-rain") {
    add("normal",[{id:"two-targets-one-self-drop",expectedTargets:["defender","defenderAlly"],expectedBasePower:120,expectedSpread:true,expectedStages:{attacker:[6,6,5,6,6,6,6]},expectedCoins:500}]);
    add("one-protected",[{id:"one-protected-one-self-drop",expectedTargets:["defenderAlly"],expectedBasePower:120,expectedSpread:true,expectedStages:{attacker:[6,6,5,6,6,6,6]},expectedCoins:250}],{}, {}, {trainerMove:182});
    add("both-protected",[{id:"no-hit-no-self-drop",expectedTargets:[],expectedStages:{attacker:[6,6,6,6,6,6,6]},expectedCoins:0}],{}, {}, {trainerMove:182,defenderAllyMove:182});
    add("contrary",[{id:"contrary-one-rise",expectedTargets:["defender","defenderAlly"],expectedBasePower:120,expectedSpread:true,expectedStages:{attacker:[6,6,7,6,6,6,6]},expectedCoins:500}],{abilityId:126});
    add("simple",[{id:"simple-one-double-drop",expectedTargets:["defender","defenderAlly"],expectedBasePower:120,expectedSpread:true,expectedStages:{attacker:[6,6,4,6,6,6,6]},expectedCoins:500}],{abilityId:86});
  } else if (name === "mortal-spin") {
    add("normal",[{id:"poison-both-targets",expectedTargets:["defender","defenderAlly"],expectedBasePower:30,expectedSpread:true,expectedStatuses:{defender:5,defenderAlly:5}}]);
    add("steel",[{id:"steel-immune-other-poisoned",expectedTargets:["defenderAlly"],expectedBasePower:30,expectedSpread:true,expectedStatuses:{defender:0,defenderAlly:5}}],{}, {},{defenderSpecies:208});
    for (const [move,effect] of [[191,6],[390,7],[446,8]])
      add(`hazard-${move}`,[{id:`clears-native-hazard-${move}`,setupSlots:[1],setupCommands:undefined,
        expectedTargets:["defender","defenderAlly"],expectedBasePower:30,expectedSpread:true,
        expectedHazardsBefore:[effect],expectedHazardsAfter:[]}],{}, {}, {defenderSpecies:386,defenderLevel:100,trainerMove:move});
    for (const [move,condition] of [[35,8],[73,18]])
      add(`condition-${move}`,[{id:`clears-native-condition-${move}`,allyTargetRole:"attacker",
        setupCommands:[{slot:1,case:{id:"establish-condition",allyTargetRole:"attacker",accuracyRoll:0}}],
        expectedTargets:["defender","defenderAlly"],expectedBasePower:30,expectedSpread:true,
        expectedUserConditionsBefore:[condition],expectedUserConditionsAfter:[]}],{}, {speciesId:386,level:100,moves:[move]});
  } else if (name === "snipe-shot") {
    const shot = {expectedTargets:["defender"] as BattleRole[],expectedBasePower:80,expectedCriticalRanks:{attacker:1}};
    add("follow-me",[{id:"ignores-follow-me",...shot},{id:"water-gun-control-is-redirected",moveSlot:1,expectedExecutedMove:55,expectedTargets:["defenderAlly"],expectedBasePower:40,expectedCriticalRanks:{attacker:0}}],{moves:[745,55,150]}, {}, {defenderAllyMove:266});
    add("storm-drain",[{id:"ignores-remote-storm-drain",...shot}],{moves:[745,55]}, {}, {defenderAllySpecies:423,defenderAllyAbilityId:114});
    add("selected-absorption",[{id:"selected-water-absorb-still-works",expectedTargets:[],expectedStages:{defender:[6,6,6,6,6,6,6]}}],{}, {}, {defenderSpecies:134,abilityId:11});
  } else if (name === "dragon-cheer") {
    add("dragon",[{id:"dragon-ally-two-stages",expectedFocus:{attacker:false,ally:true},expectedCriticalRanks:{ally:2},expectedNativeSuccess:true}],{level:100},{moves:[33]});
    add("non-dragon",[{id:"non-dragon-ally-one-stage",expectedFocus:{attacker:false,ally:true},expectedCriticalRanks:{ally:1},expectedNativeSuccess:true}],{level:100},{speciesId:137,moves:[33]});
    add("focus-energy",[{id:"existing-focus-energy-rejected",expectedFocus:{attacker:false,ally:true},expectedNativeSuccess:false}],{}, {level:100,moves:[116]});
    add("protect",[{id:"ally-protect-does-not-block",expectedFocus:{attacker:false,ally:true},expectedNativeSuccess:true}],{}, {level:100,moves:[182]});
    add("substitute",[{id:"ally-substitute-does-not-block",expectedFocus:{attacker:false,ally:true},expectedNativeSuccess:true}],{}, {level:100,moves:[164]});
    add("hiding",[{id:"semi-invulnerable-ally-rejected",expectedFocus:{attacker:false,ally:false},expectedNativeSuccess:false}],{}, {level:100,moves:[19]});
    add("repeat",[{id:"repeat-does-not-stack",setupSlots:[0],expectedFocus:{attacker:false,ally:true},expectedCriticalRanks:{ally:2},expectedNativeSuccess:false}],{level:100},{moves:[33]});
    add("type-change",[{id:"bonus-fixed-after-soak",setupSlots:[0],moveSlot:1,expectedExecutedMove:487,targetRole:"ally",expectedTypes:{ally:[10,10]},expectedCriticalRanks:{ally:2},expectedFocus:{attacker:false,ally:true}}],{level:100,moves:[913,487,150]},{moves:[33]});
    const setup = [{slot:0,case:{id:"apply",allyMoveSlot:1,accuracyRoll:0,secondaryRoll:99}}];
    const copied = {expectedFocus:{attacker:true,ally:true},expectedCriticalRanks:{ally:1},expectedStages:{attacker:[6,6,6,6,6,6,6],ally:[6,6,6,6,6,6,6]}};
    add("psych-up",[{id:"psych-up-copies-one-stage",setupCommands:setup,moveSlot:1,expectedExecutedMove:244,targetRole:"ally",...copied,
      followup:{slot:2,moveId:33,power:40,category:1,type:0,case:{id:"copied-critical-rank",completeTurn:true,expectedExecutedMove:33,accuracyRoll:0,secondaryRoll:99,expectedCriticalRanks:{attacker:1,ally:1},expectedFocus:{attacker:true,ally:true}}}}],
      {level:100,moves:[913,244,33,150]},{speciesId:137,moves:[33,150]});
    add("transform",[{id:"transform-copies-one-stage",setupCommands:setup,moveSlot:1,expectedExecutedMove:144,targetRole:"ally",...copied,expectedTransform:true,
      followup:{slot:0,moveId:33,power:40,category:1,type:0,case:{id:"transformed-critical-rank",completeTurn:true,expectedExecutedMove:33,expectedTransform:true,accuracyRoll:0,secondaryRoll:99,expectedCriticalRanks:{attacker:1,ally:1},expectedFocus:{attacker:true,ally:true}}}}],
      {level:100,moves:[913,144,150]},{speciesId:137,moves:[33,150]});
  } else if (name === "matcha-gotcha") {
    const normal = {hp:{attacker:60},expectedTargets:["defender","defenderAlly"] as BattleRole[],expectedBasePower:80,drain:true};
    add("normal",[{id:"half-of-both-hits",...normal},{id:"twenty-percent-burn-success",...normal,secondaryRoll:19,expectedStatuses:{defender:4,defenderAlly:4}},{id:"twenty-percent-burn-boundary",...normal,secondaryRoll:20,expectedStatuses:{defender:0,defenderAlly:0}}]);
    add("big-root",[{id:"big-root-both-drains",...normal,bigRoot:true}],{itemId:296});
    add("ooze-second",[{id:"second-target-ooze-before-first-heal",...normal,typeRatios:{defenderAlly:2048},oozeRoles:["defenderAlly"]}],{}, {}, {defenderAllySpecies:317,defenderAllyAbilityId:64});
    add("ooze-first",[{id:"first-target-ooze-before-second-heal",...normal,typeRatios:{defender:2048},oozeRoles:["defender"]}],{}, {}, {defenderSpecies:316,abilityId:64});
    add("frozen-user",[{id:"user-thaws-on-execution",...normal,expectedStatusesBefore:{attacker:3},expectedStatuses:{attacker:0}}],{status:"freeze"});
    add("frozen-targets",[{id:"both-targets-thaw-on-hit",...normal,statuses:{defender:3,defenderAlly:3},expectedStatusesBefore:{defender:3,defenderAlly:3},expectedStatuses:{defender:0,defenderAlly:0}}]);
    add("substitute",[{id:"drain-from-actual-substitute-damage",...normal}],{}, {},{defenderSpecies:386,defenderLevel:100,trainerMove:164});
  }
  return variants;
}
