/** Native ability recipe parameters: export/reload and cold-boot fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { readU16 } from "../../src/nds/binary";
import { battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, hydrateAbilityEffectsSource, ABILITY_EFFECTS_DLL_PATH, ABILITY_RULE_API } from "../../src/pokeweb/abilityEffectsModel";
import { validateAbilityRule, encodeAbilityRules, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { configureHarnessRuntime, parseHarnessConfig, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../../src/pokeweb/battleHarness";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { updatePokemonField, getPokemonSummaryRecord } from "../../src/pokeweb/pokemonModel";

const [path, directory, cohort] = process.argv.slice(2);
if (!directory) throw new Error("Usage: ROM.nds OUTPUT_DIRECTORY");
const out = resolve(directory), input = new Uint8Array(await readFile(path));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), inputHash = sha(input);
await mkdir(`${out}/saves`, { recursive: true });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (b: Uint8Array) => loadProjectFromRomBytes(b, "scare-validation.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
let project = await load(input);
const entries = new Map<number, AbilityRuleSet>();
const names=new Map<number,string>();
function recipe(id:number,name:string,donor:number,parameters:Record<string,number>,extra:Record<string,number>={}){names.set(id,name);entries.set(id,validateAbilityRule({effects:[{kind:`nativeAbility:${donor}`,value:-1,parameters,...extra}],conditions:{kind:"group",mode:"all",children:[]}}));}
recipe(165,"Scare",22,{stages:-1},{stat:3});
recipe(166,"Cool Coat",47,{type1:10,type2:11},{value:.25});
recipe(167,"Burn Guard",7,{immunityStatus:4});
recipe(168,"Last Stand",65,{type:0,hpThreshold:50,power:2.5});
recipe(169,"Bad Nerves",123,{triggerStatus:1,hpPercent0:25});
recipe(170,"Mind Boost",3,{stat:3,stages:2});
recipe(171,"Mind Guard",52,{guardStat:3});
recipe(172,"Snow Dish",44,{weatherHeal:3,healPercent:25});
recipe(173,"Fire Rod",31,{type:9,stat:2,stages:2});
recipe(174,"Nervous",155,{triggerType1:0,triggerType2:10,triggerType3:9,stat:3,stages:2});
recipe(175,"Grass Absorb",11,{type:11,healPercent:25});
recipe(176,"Steam Power",18,{type:10});
recipe(177,"Burn Spore",27,{randomStatus1:4,randomStatus2:4,randomStatus3:4},{chance:100});
recipe(178,"Critical Eye",105,{bonus:3});
recipe(179,"Hasty",158,{bonus:2});
recipe(180,"Very Simple",86,{amountMultiplier:4});
recipe(181,"Armor Shift",133,{statDown:4,stagesDown:-2,statUp:3,stagesUp:2});
recipe(182,"Hot Sand",159,{type1:0,type2:9,type3:10,ratio0:2.5});
recipe(183,"Big Technician",101,{powerThreshold:100},{value:2.5});
recipe(184,"Fast Start",112,{turns:1});
if(cohort==="additional"){
 recipe(185,"Half Scale",136,{hpMinimum:50});
 recipe(186,"Half Sturdy",5,{hpMinimum:50});
 recipe(187,"Wonder Cap",147,{accuracyCap:80});
 recipe(188,"Sleep Sync",28,{reflectedStatus1:2});
}
await configureAbilityRuleSets(project, [...entries].map(([abilityId, rules]) => ({ abilityId, rules, name: names.get(abilityId)! })));
updatePokemonField(project, 1, "personal", "ability_3", "Scare");
const verify = () => {
  const state = inspectAbilityEffects(project); assert(state.editable, state.message); assert.deepEqual(state.rules, entries);
  assert.equal(project.texts.banks.abilities?.[165], "Scare"); assert.equal(getPokemonSummaryRecord(project, 1).rawPersonal.ability_3, 165);
};
verify(); project = openProjectSession(createProjectDocument(project, false)); project.originalRomBytes = input;
hydrateAbilityEffectsSource(project, new NintendoDSRom(input, { fileData: "view" })); verify();
for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/scare.nds`, exported, { flag: "wx" }); project = await load(exported); verify();
// Re-export a reloaded ROM to verify that the edited callback remains editable.
await configureAbilityRuleSets(project, [{ abilityId: 165, name: "Scare", rules: entries.get(165)! }]);
for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const reexported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/scare-reloaded.nds`, reexported, { flag: "wx" }); project = await load(reexported); verify();
const rom = new NintendoDSRom(reexported, { fileData: "view" }); validateHarnessRom(rom);
const dll = parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
const symbols = Object.fromEntries(dll.symbols.filter(s => s.name?.startsWith("Ability")).map(s => [s.name!, s.address]));
const api = Object.fromEntries(ABILITY_RULE_API.flatMap((name, i) => name ? [[name, new DataView(dll.code.buffer).getUint32(symbols.AbilityRuleApi + i * 4, true) & ~1]] : []));
const pmc = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]);
const pmcSymbols = Object.fromEntries(pmc.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s => [s.name!, pmc.baseAddress + 32 + s.address]));
const overlay = rom.loadArm9Overlays([167]).get(167)!;
const nameLoader = battleRuntimeResolver(overlay.data, overlay.ramAddress, project.arm9, rom.arm9RamAddress).resolve("loadAbilityNameToStrbuf").address;
const encoded = encodeAbilityRules(entries), nativeOffsets: number[] = [];
for (const id of entries.keys()) { const at = readU16(encoded, id * 2); nativeOffsets.push(at + 4 + encoded[at + 1] * 4); }
const neutral = [6, 6, 6, 6, 6, 6, 6];
type Case = {label:string;abilityId:number;enemyAbility?:number;enemyMove?:number;enemyLevel?:number;move?:number;hp?:number;status?:"burn"|"paralysis";doubles?:boolean;checks:Record<string,unknown>};
const cases:Case[]=[
 {label:"thick-fat-water",abilityId:166,enemyMove:55,checks:{multiplier:1024}},
 {label:"thick-fat-grass",abilityId:166,enemyMove:22,checks:{multiplier:1024}},
 {label:"thick-fat-fire-no-longer-reduced",abilityId:166,enemyMove:52,checks:{noMultiplier:1024,noMultiplier2:2048}},
 {label:"limber-cures-and-blocks-burn",abilityId:167,status:"burn",enemyMove:261,checks:{status:0}},
 {label:"limber-now-allows-paralysis",abilityId:167,enemyMove:86,checks:{status:1}},
 {label:"overgrow-normal-at-50-percent",abilityId:168,hp:60,move:33,checks:{multiplier:10240}},
 {label:"overgrow-above-50-percent",abilityId:168,hp:61,move:33,checks:{noMultiplier:10240}},
 {label:"overgrow-wrong-type",abilityId:168,hp:60,move:52,checks:{noMultiplier:10240}},
 {label:"bad-dreams-paralysis-25-percent",abilityId:50,enemyAbility:169,status:"paralysis",checks:{recoilPercent:25}},
 {label:"bad-dreams-healthy-negative",abilityId:50,enemyAbility:169,checks:{noWeatherDamage:true}},
 {label:"speed-boost-special-attack-two-stages",abilityId:170,checks:{playerStagesByTurn:[neutral,[6,6,8,6,6,6,6],[6,6,10,6,6,6,6]]}},
 {label:"hyper-cutter-blocks-special-attack",abilityId:171,enemyAbility:165,checks:{stages:neutral}},
 {label:"hyper-cutter-allows-attack-drop",abilityId:171,enemyAbility:22,checks:{stages:[5,6,6,6,6,6,6]}},
 {label:"rain-dish-in-hail-heals-quarter",abilityId:172,hp:10,enemyAbility:117,checks:{healPercent:25}},
 {label:"lightning-rod-fire-defense",abilityId:173,enemyMove:52,checks:{playerStagesByTurn:[neutral,[6,8,6,6,6,6,6],[6,10,6,6,6,6,6]],noWeatherDamage:true}},
 {label:"rattled-normal-special-attack",abilityId:174,enemyMove:33,checks:{playerStagesByTurn:[neutral,[6,6,8,6,6,6,6],[6,6,10,6,6,6,6]]}},
 {label:"rattled-water-special-attack",abilityId:174,enemyMove:55,checks:{playerStagesByTurn:[neutral,[6,6,8,6,6,6,6],[6,6,10,6,6,6,6]]}},
 {label:"rattled-old-dark-type-negative",abilityId:174,enemyMove:44,checks:{stages:neutral}},
 {label:"water-absorb-grass-healing",abilityId:175,hp:10,enemyMove:22,checks:{healPercent:25}},
 {label:"flash-fire-water-activation-and-boost",abilityId:176,enemyMove:55,move:55,checks:{multiplier:6144,noWeatherDamage:true}},
 {label:"effect-spore-all-branches-burn",abilityId:177,enemyMove:33,checks:{enemyStatus:4}},
 {label:"super-luck-three-stages",abilityId:178,move:33,checks:{rewrite:{key:44,value:3}}},
 {label:"prankster-priority-two",abilityId:179,checks:{rewrite:{key:24,value:9}}},
 {label:"simple-fourfold-stat-drop",abilityId:180,enemyAbility:22,checks:{stages:[2,6,6,6,6,6,6]}},
 {label:"weak-armor-custom-stats",abilityId:181,enemyMove:33,checks:{playerStagesByTurn:[neutral,[6,6,8,4,6,6,6],[6,6,10,2,6,6,6]]}},
 {label:"sand-force-normal-power",abilityId:182,enemyAbility:45,move:33,checks:{multiplier:10240}},
 {label:"technician-higher-power-threshold",abilityId:183,move:70,checks:{multiplier:10240}},
 {label:"slow-start-one-turn",abilityId:184,move:33,checks:{multiplier:2048,noMultiplierAfterFirstTurn:2048}},
];
if(cohort==="additional")cases.splice(0,cases.length,
 {label:"multiscale-at-50-percent",abilityId:185,hp:60,enemyMove:33,enemyLevel:30,checks:{multiplier:2048,noMultiplierAfterFirstTurn:2048}},
 {label:"multiscale-below-50-percent",abilityId:185,hp:59,enemyMove:33,enemyLevel:30,checks:{noMultiplier:2048}},
 {label:"sturdy-at-half-hp-survives",abilityId:186,hp:60,enemyMove:63,checks:{rewrite:{key:58,value:4},hpByTurn:[60,1,1]}},
 {label:"wonder-skin-accuracy-80",abilityId:187,enemyMove:86,checks:{rewrite:{key:43,value:80}}},
 {label:"synchronize-reflects-sleep",abilityId:188,enemyMove:147,checks:{enemyStatusFirstTurn:2}}
);
const baseSave = rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
await prepareBw2TestBattleCodeInjection(project);
const hashes: Record<string, string> = {}, fixtures: unknown[] = [];
for (const [i, spec] of cases.entries()) {
  const battleType = spec.doubles ? "Doubles" : "Singles", count = spec.doubles ? 2 : 1;
  const rule = patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType, trainer: { team: Array.from({ length: count }, () => ({ speciesId: 320, level: spec.enemyLevel??((spec.enemyMove??150)===150?100:50), moves: [spec.enemyMove ?? 150], itemId: 0, abilityId: spec.enemyAbility ?? 50 })), ai: 0 } }));
  stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url))), 2, rule));
  const save = patchHarnessSave(baseSave, project, parseHarnessConfig({ trainerId: 2, battleType, player: { team: Array.from({ length: count }, (_, n) => ({ speciesId: n ? 4 : 1, level: 50, moves: [spec.move??150], itemId: 0, abilityId: n ? 50 : spec.abilityId, ...(spec.hp!==undefined?{currentHp:spec.hp}:{}), ...(spec.status?{status:spec.status}:{}) })) } }));
  const raw = decryptPk5Party(save.subarray(0x18e08, 0x18e08 + 220)), maxHp = readU16(raw, 0x90);
  const label = `${String(i).padStart(3, "0")}-${spec.label}`, filename = `battle-${battleType}-${spec.enemyMove ?? 150}-${spec.enemyAbility ?? 50}-${spec.enemyLevel??0}.nds`;
  await writeFile(`${out}/saves/${label}.sav`, save, { flag: "wx" });
  if (!hashes[filename]) {
    const keep = project.narcs; project.narcs = Object.fromEntries(Object.entries(keep).filter(([name, store]) => ["personal", "trdata", "trpok"].includes(name) && store?.dirty.size));
    const bytes = await exportModifiedRom(project, { forDsi: false }); project.narcs = keep;
    await writeFile(`${out}/${filename}`, bytes, { flag: "wx" }); hashes[filename] = sha(bytes);
  }
  fixtures.push({ ...spec, label, rom: filename, speciesId: 1, hp: spec.hp??maxHp, maxHp });
}
await writeFile(`${out}/cases.json`, JSON.stringify({ inputSha256: inputHash, exportSha256: sha(exported), reexportSha256: sha(reexported), editedAbilities: entries.size, codeBytes: dll.code.length, bssBytes: dll.bssSize, serializedBytes: rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)].length, nameLoader, api, symbols, pmcSymbols, hook: dll.relocations.find(r => r.target.module === "167")!.target.address, configHex: Buffer.from(encoded).toString("hex"), nativeOffsets, romHashes: hashes, cases: fixtures, projectReload: true, romExportReload: true, reexportReload: true, assignmentByName: true }, null, 2) + "\n");
assert.equal(sha(new Uint8Array(await readFile(path))), inputHash);
console.log(`Native recipes survived project reopen, export/reload, edit/re-export/reload; ${cases.length} native fixtures prepared.`);
