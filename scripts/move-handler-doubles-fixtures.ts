/** Declarative, four-battler cases; all commands execute through native UI. */
import type { HarnessPokemon } from "../src/pokeweb/battleHarness";

export type BattleRole = "attacker" | "ally" | "defender" | "defenderAlly";
export type DoublesCase = {
  id: string; completeTurn?: boolean; targetRole?: BattleRole; allyMoveSlot?: number;
  hp?: Partial<Record<BattleRole, number>>;
  statuses?: Partial<Record<BattleRole, number>>;
  stages?: Partial<Record<BattleRole, number[]>>;
  expectedStages?: Partial<Record<BattleRole, number[]>>;
  expectedAbilities?: Partial<Record<BattleRole, number>>;
  expectedSetupHits?: number;
  expectedUserForm?: number;
  expectedItems?: Partial<Record<BattleRole, number>>;
  expectedConsumedItems?: Partial<Record<BattleRole, number>>;
  expectedQuarterHealing?: BattleRole[];
  expectedResolvedType?: number;
  expectedSideEffectsBefore?: [Record<string,number>,Record<string,number>];
  expectedSideEffectsAfter?: [Record<string,number>,Record<string,number>];
  expectedSideSwap?: boolean;
  expectedFinalDamageRatio?: number;
  expectedCustomSidesBefore?: [Record<string,number>,Record<string,number>];
  expectedCustomSidesAfter?: [Record<string,number>,Record<string,number>];
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
  defenderItemId?: number; defenderAllyItemId?: number;
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
  doodle: { id: 867, type: 0, power: 0, category: 0, accuracy: 100, target: 3 },
  "rage-fist": { id: 889, type: 7, power: 50, category: 1, accuracy: 100 },
  teatime: { id: 752, type: 0, power: 0, category: 0, accuracy: 101, target: 8 },
  "court-change": { id: 756, type: 0, power: 0, category: 0, accuracy: 101, target: 8 },
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
  if (name === "rage-fist") {
    const setup = (hits:number,slot=1) => Array.from({length:hits},()=>({slot,case:{id:"receive-hit",allyTargetRole:"attacker" as BattleRole,allyMoveSlot:0}}));
    const hitCase = (id:string,hits:number,turns=hits):DoublesCase => ({id,setupCommands:setup(turns),allyMoveSlot:1,
      expectedSetupHits:hits,expectedTargets:["defender"],expectedBasePower:Math.min(350,50+50*hits),expectedSpread:false});
    const target={defenderSpecies:442,defenderLevel:100};
    add("history",[0,1,2,5,6,7].map(hits=>hitCase(`earlier-hits-${hits}`,hits)),{moves:[889,150,164,144]},{level:1,moves:[33,150]},target);
    add("multi-hit",[hitCase("each-double-kick-strike-counts",2,1)],{moves:[889,150,164,144]},{level:1,moves:[24,150]},target);
    add("skill-link",[hitCase("five-native-bullet-seed-hits",5,1)],{moves:[889,150,164,144]},{abilityId:92,level:1,moves:[331,150]},target);
    add("substitute",[{id:"substitute-hit-does-not-count",setupCommands:[{slot:2,case:{id:"doll",allyMoveSlot:1}},...setup(1)],allyMoveSlot:1,
      expectedSetupHits:0,expectedTargets:["defender"],expectedBasePower:50,expectedSpread:false}],{moves:[889,150,164,144]},{level:1,moves:[33,150]},target);
    add("disguise",[{id:"disguise-counts-with-zero-direct-hp-damage",setupCommands:setup(1),allyMoveSlot:1,
      expectedSetupHits:0,expectedUserForm:1,expectedTargets:["defender"],expectedBasePower:100,expectedSpread:false}],{speciesId:778,abilityId:209,moves:[889,150,164,144]},{level:1,moves:[55,150]},target);
    add("transform",[{id:"transform-copies-partner-hit-history",setupCommands:[
      {slot:1,case:{id:"hit-partner-once",targetRole:"ally",allyMoveSlot:1}},
      {slot:1,case:{id:"hit-partner-twice",targetRole:"ally",allyMoveSlot:1}},
      {slot:2,case:{id:"copy-partner",targetRole:"ally",allyMoveSlot:1,expectedTransform:true}}],
      allyMoveSlot:1,expectedSetupHits:0,expectedTransform:true,expectedTargets:["defender"],expectedBasePower:150,expectedSpread:false,
      typeRatios:{defender:4096}}],{moves:[889,33,144,150]},{level:100,moves:[889,150]},target);
    add("mimic",[{id:"hits-before-user-rage-fist-registration",setupCommands:[
      {slot:1,case:{id:"receive-hit-before-knowing-move",allyMoveSlot:0,allyTargetRole:"attacker"}},
      {slot:0,case:{id:"learn-rage-fist-with-native-mimic",targetRole:"ally",allyMoveSlot:1}}],
      allyMoveSlot:1,expectedSetupHits:1,expectedTargets:["defender"],expectedBasePower:100,expectedSpread:false}],
      {moves:[102,150]},{level:1,moves:[889,150]},target);
  } else if (name === "court-change") {
    const empty:[Record<string,number>,Record<string,number>] = [{},{}];
    add("empty",[{id:"no-side-conditions-fails",expectedNativeSuccess:false,expectedSideEffectsBefore:empty,expectedSideEffectsAfter:empty}]);
    const screen = [{slot:1,case:{id:"put-up-reflect",allyMoveSlot:0,allyTargetRole:"ally" as BattleRole}}];
    add("reflect",[{id:"reflect-moves-to-foes-with-remaining-duration",setupCommands:screen,allyMoveSlot:1,expectedNativeSuccess:true,
      expectedSideEffectsBefore:[{"0":1},{}],expectedSideEffectsAfter:[{},{"0":1}],expectedSideSwap:true},
      {id:"two-swaps-return-reflect-without-refresh",setupCommands:[...screen,{slot:0,case:{id:"first-swap",allyMoveSlot:1}}],allyMoveSlot:1,
       expectedNativeSuccess:true,expectedSideEffectsBefore:[{},{"0":1}],expectedSideEffectsAfter:[{"0":1},{}],expectedSideSwap:true}],
      {moves:[756,150]},{moves:[115,150]});
    add("light-clay",[{id:"extended-screen-keeps-original-duration",setupCommands:screen,allyMoveSlot:1,expectedNativeSuccess:true,
      expectedSideEffectsBefore:[{"0":1},{}],expectedSideEffectsAfter:[{},{"0":1}],expectedSideSwap:true}],{moves:[756,150]},
      {moves:[115,150],itemId:269});
    add("reflect-damage",[{id:"swapped-reflect-actually-protects-new-side",setupCommands:screen,allyMoveSlot:1,expectedNativeSuccess:true,
      expectedSideEffectsBefore:[{"0":1},{}],expectedSideEffectsAfter:[{},{"0":1}],expectedSideSwap:true,
      followup:{slot:2,moveId:33,power:50,category:1,type:0,case:{id:"tackle-newly-protected-foe",completeTurn:true,allyMoveSlot:1,
        expectedTargets:["defender"],expectedBasePower:50,expectedSpread:false,expectedFinalDamageRatio:2703}}}],
      {moves:[756,150,33]},{moves:[115,150]});
    add("veil-damage",[{id:"swapped-veil-actually-protects-new-side",setupCommands:[{slot:1,case:{id:"hail",allyMoveSlot:1}},
      {slot:1,case:{id:"veil",allyMoveSlot:0,allyTargetRole:"ally"}}],allyMoveSlot:2,expectedNativeSuccess:true,
      expectedCustomSidesBefore:[{"15":1},{}],expectedCustomSidesAfter:[{},{"15":1}],
      followup:{slot:2,moveId:33,power:50,category:1,type:0,case:{id:"tackle-veil-side",completeTurn:true,allyMoveSlot:2,
        expectedTargets:["defender"],expectedBasePower:50,expectedSpread:false,expectedFinalDamageRatio:2703}}}],
      {moves:[756,150,33],speciesId:471},{moves:[694,258,150],speciesId:362,itemId:269});
    add("layers",[{id:"three-spikes-two-toxic-spikes-and-rocks-swap-without-damage",setupCommands:[
      ...[0,0,0,1,1,2].map(allyMoveSlot=>({slot:1,case:{id:"lay-hazard",allyMoveSlot}}))],allyMoveSlot:3,expectedNativeSuccess:true,
      expectedHealing:{attacker:0,ally:0,defender:0,defenderAlly:0},expectedSideEffectsBefore:[{},{"6":3,"7":2,"8":1}],
      expectedSideEffectsAfter:[{"6":3,"7":2,"8":1},{}],expectedSideSwap:true}],{moves:[756,150]}, {moves:[191,390,446,150]});
    for (const [move,id] of [[54,3],[219,2],[366,4],[381,5]]) {
      add(`side-${id}`,[{id:`native-side-${id}-ownership-and-duration`,setupCommands:[{slot:1,case:{id:"native-side",allyMoveSlot:0,allyTargetRole:"ally"}}],allyMoveSlot:1,
        expectedNativeSuccess:true,expectedSideEffectsBefore:[{[id]:1},{}],expectedSideEffectsAfter:[{},{[id]:1}],expectedSideSwap:true}],
        {moves:[756,150]},{moves:[move,150]});
    }
    add("sticky-web",[{id:"sticky-web-custom-side-moves-without-active-stat-drop",setupCommands:[{slot:1,case:{id:"web",allyMoveSlot:0}}],
      allyMoveSlot:1,expectedNativeSuccess:true,expectedSideSwap:true,expectedCustomSidesBefore:[{},{"14":1}],expectedCustomSidesAfter:[{"14":1},{}]}],{moves:[756,150]}, {moves:[564,150]});
    add("aurora-veil",[{id:"custom-veil-keeps-remaining-duration",setupCommands:[{slot:1,case:{id:"hail",allyMoveSlot:1}},
      {slot:1,case:{id:"veil",allyMoveSlot:0,allyTargetRole:"ally"}}],allyMoveSlot:2,expectedNativeSuccess:true,expectedSideSwap:true,
      expectedCustomSidesBefore:[{"15":1},{}],expectedCustomSidesAfter:[{},{"15":1}]}],
      {moves:[756,150],speciesId:471},{moves:[694,258,150],speciesId:362,itemId:269});
  } else if (name === "teatime") {
    const eaten = {expectedItems:{attacker:0,ally:0,defender:0,defenderAlly:0},
      expectedConsumedItems:{attacker:155,ally:158,defender:149,defenderAlly:201},expectedNativeSuccess:true};
    add("mixed",[{id:"four-berries-on-both-sides",hp:{attacker:100,ally:100},statuses:{defender:1},...eaten,
      expectedHealing:{attacker:10},expectedQuarterHealing:["ally"],expectedStatuses:{defender:0},expectedStages:{defenderAlly:[7,6,6,6,6,6,6]}},
      {id:"full-hp-and-no-status-still-consume",...eaten,expectedHealing:{attacker:0,ally:0},expectedStages:{defenderAlly:[7,6,6,6,6,6,6]}}],
      {itemId:155},{itemId:158},{defenderItemId:149,defenderAllyItemId:201});
    add("no-berries",[{id:"no-holder-fails",expectedNativeSuccess:false,expectedItems:{attacker:234,ally:0,defender:0,defenderAlly:0}}],{itemId:234});
    add("unnerve",[{id:"unnerve-does-not-prevent-forced-consumption",hp:{attacker:100},expectedNativeSuccess:true,
      expectedHealing:{attacker:10},expectedItems:{attacker:0},expectedConsumedItems:{attacker:155}}],{itemId:155},{},{defenderSpecies:248,abilityId:127});
    add("magic-room",[{id:"magic-room-does-not-prevent-consumption",setupCommands:[{slot:1,case:{id:"room"}}],hp:{attacker:100},
      expectedNativeSuccess:true,expectedHealing:{attacker:10},expectedItems:{attacker:0},expectedConsumedItems:{attacker:155}}],{itemId:155,moves:[752,478,150]});
    add("embargo",[{id:"embargo-does-not-prevent-consumption",hp:{attacker:100},allyTargetRole:"attacker",expectedNativeSuccess:true,
      expectedHealing:{attacker:10},expectedItems:{attacker:0},expectedConsumedItems:{attacker:155}}],{itemId:155},{level:100,moves:[373],abilityId:50});
    add("substitute",[{id:"native-substitute-does-not-block-berry",expectedNativeSuccess:true,
      expectedItems:{ally:0},expectedConsumedItems:{ally:158}}],{},{itemId:158,level:100,moves:[164]});
    add("hiding",[{id:"flying-holder-is-not-consumed",expectedNativeSuccess:false,
      expectedItems:{ally:155},expectedConsumedItems:{ally:0}}],{},{itemId:155,level:100,moves:[19]});
    add("cheek-pouch",[{id:"forced-berry-triggers-cheek-pouch-once",hp:{attacker:60},expectedNativeSuccess:true,
      expectedHealing:{attacker:68},expectedItems:{attacker:0},expectedConsumedItems:{attacker:155}}],{itemId:155,abilityId:167});
    add("symbiosis",[{id:"donor-berry-transferred-and-not-eaten-twice",hp:{attacker:100},expectedNativeSuccess:true,
      expectedHealing:{attacker:10},expectedItems:{attacker:158,ally:0},expectedConsumedItems:{attacker:155,ally:0}}],
      {itemId:155},{abilityId:180,itemId:158});
    add("volt-absorb",[{id:"electric-teatime-activates-volt-absorb-without-berry",hp:{defender:100},expectedResolvedType:12,
      expectedNativeSuccess:false,expectedQuarterHealing:["defender"],expectedItems:{defender:0}}],{moves:[752,150]},
      {level:100,moves:[569]},{defenderSpecies:134,abilityId:10});
    add("lightning-rod",[{id:"electric-teatime-boosts-lightning-rod-without-berry",expectedNativeSuccess:false,expectedResolvedType:12,
      expectedStages:{defender:[6,6,7,6,6,6,6]}}],{moves:[752,150]},{level:100,moves:[569]},{defenderSpecies:25,abilityId:31});
    add("motor-drive",[{id:"electric-teatime-boosts-motor-drive-without-berry",expectedNativeSuccess:false,expectedResolvedType:12,
      expectedStages:{defender:[6,6,6,6,7,6,6]}}],{moves:[752,150]},{level:100,moves:[569]},{defenderSpecies:466,abilityId:78});
    add("electrify",[{id:"electrified-teatime-activates-volt-absorb",allyTargetRole:"attacker",hp:{defender:100},expectedResolvedType:12,
      expectedNativeSuccess:false,expectedQuarterHealing:["defender"]}],{moves:[752,150]},
      {level:100,moves:[582]},{defenderSpecies:134,abilityId:10});
    add("absorber-berry",[{id:"absorption-retains-target-berry-but-other-holder-consumes",hp:{attacker:100,defender:100},expectedResolvedType:12,
      expectedNativeSuccess:true,expectedQuarterHealing:["defender"],expectedHealing:{attacker:10},
      expectedItems:{attacker:0,defender:155},expectedConsumedItems:{attacker:155,defender:0}}],{itemId:155,moves:[752,150]},
      {level:100,moves:[569]},{defenderSpecies:134,abilityId:10,defenderItemId:155});
    add("ground-type",[{id:"electric-teatime-still-consumes-ground-types-berry",expectedResolvedType:12,expectedNativeSuccess:true,
      expectedItems:{defender:0},expectedConsumedItems:{defender:155}}],{moves:[752,150]},
      {level:100,moves:[569]},{defenderSpecies:464,defenderItemId:155});
  } else if (name === "doodle") {
    add("normal",[{id:"copy-to-user-and-partner",expectedAbilities:{attacker:50,ally:50},expectedNativeSuccess:true},
      {id:"repeat-copy-fails-without-reregistering",setupCommands:[{slot:0,case:{id:"first-copy",expectedAbilities:{attacker:50,ally:50}}}],expectedAbilities:{attacker:50,ally:50},expectedNativeSuccess:false}]);
    add("one-matches",[{id:"matching-user-still-updates-partner",expectedAbilities:{attacker:50,ally:50},expectedNativeSuccess:true}],{abilityId:50},{abilityId:99});
    add("both-match",[{id:"no-recipient-changes-fails",expectedAbilities:{attacker:50,ally:50},expectedNativeSuccess:false}],{abilityId:50});
    add("protected-user",[{id:"protected-user-rejects-entire-transaction",expectedAbilities:{attacker:213,ally:50},expectedNativeSuccess:false}],{abilityId:213});
    add("protected-partner",[{id:"protected-partner-does-not-partially-change-user",expectedAbilities:{attacker:99,ally:213},expectedNativeSuccess:false}],{}, {abilityId:213});
    add("protected-target",[{id:"cannot-copy-multitype",expectedAbilities:{attacker:99,ally:50},expectedNativeSuccess:false}],{}, {},{defenderSpecies:493,abilityId:121});
    add("receiver-target",[{id:"receiver-cannot-be-copied",expectedAbilities:{attacker:99,ally:50},expectedNativeSuccess:false}],{}, {},{defenderSpecies:766,abilityId:222});
    add("receiver-recipient",[{id:"receiver-can-be-replaced",expectedAbilities:{attacker:50,ally:50},expectedNativeSuccess:true}],{abilityId:222},{abilityId:222});
    add("custom-ability",[{id:"custom-ability-re-registers-both-allies",expectedAbilities:{attacker:169,ally:169},expectedNativeSuccess:true}],{}, {},{defenderSpecies:137,abilityId:169});
  } else if (name === "decorate") {
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
