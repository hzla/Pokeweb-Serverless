/** Action recipes: project/ROM round trips and ordinary native battle fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { readU16, readU32 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, hydrateAbilityEffectsSource, ABILITY_EFFECTS_DLL_PATH, ABILITY_RULE_API } from "../../src/pokeweb/abilityEffectsModel";
import { validateAbilityRule, encodeAbilityRules, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { configureHarnessRuntime, type HarnessPokemon, parseHarnessConfig, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../../src/pokeweb/battleHarness";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { decryptPk5Party, patchTestBattleSavePlayerParty } from "../../src/pokeweb/testBattleTeam";
import { battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";

const [inputPath, directory] = process.argv.slice(2); if (!directory) throw Error("Usage: INPUT.nds NEW_OUTPUT_DIRECTORY [--only=CASE,...]");
const out = resolve(directory), input = new Uint8Array(await readFile(inputPath)), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
await mkdir(out); await mkdir(`${out}/saves`);
globalThis.fetch = (async (request: RequestInfo | URL) => { const url = new URL(request instanceof Request ? request.url : String(request)); assert.equal(url.protocol, "file:"); return new Response(new Uint8Array(await readFile(url))); }) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "ability-actions.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
let project = await load(input);
const all = { kind: "group" as const, mode: "all" as const, children: [] };
const action = (stat: number, value: number) => ({ kind: "abilityRecipe:statAction" as const, value, parameters: { activation: 5, stat, moveClass: 9, type: 10 } });
const rules = new Map<number, AbilityRuleSet>([
  [165, { effects: [action(3, 1), action(5, -1)], conditions: all }],
  [166, { effects: [{ kind: "abilityRecipe:knockoutSplash", value: 20 }, { kind: "nativeAbility:104", value: -1 }], conditions: all }],
  [167, { effects: [{ kind: "abilityRecipe:statAction", value: -1, parameters: { activation: 1, stat: 8, statSource: 1, scope: 2 } }], conditions: all }],
  [168, { effects: [{ kind: "abilityRecipe:knockoutSplash", value: 20, parameters: { hpBasis: 1 } }], conditions: all }],
  [169, { effects: [{ kind: "abilityRecipe:statAction", value: 1, parameters: { activation: 5, stat: 3 } }], conditions: all }],
  [170, { effects: [action(3, 1), action(5, -1)], conditions: { kind: "group", mode: "all", children: [{ kind: "type", value: 11 }, { kind: "group", mode: "any", children: [{ kind: "hp", comparison: "lte", percent: 50 }, { kind: "species", value: 4 }] }] } }],
  [171, { effects: [{ kind: "abilityRecipe:statAction", value: -1, parameters: { activation: 1, stat: 8, scope: 2 } }], conditions: all }],
]);
for (const [id, rule] of rules) rules.set(id, validateAbilityRule(rule));
const names = new Map([[165, "High Pressure"], [166, "Blazing Glory"], [167, "Indignation"], [168, "Splash Basis"], [169, "Move Action"], [170, "Gated Pressure"], [171, "Holder Highest"]]);
await configureAbilityRuleSets(project, [...rules].map(([abilityId, rules]) => ({ abilityId, rules, name: names.get(abilityId)! })));
function verify() { const state = inspectAbilityEffects(project); assert(state.editable, state.message); assert.deepEqual(state.rules, rules); for (const [id, name] of names) assert.equal(project.texts.banks.abilities?.[id], name); }
verify(); project = openProjectSession(createProjectDocument(project, false)); project.originalRomBytes = input; hydrateAbilityEffectsSource(project, new NintendoDSRom(input, { fileData: "view" })); verify();
const trim = () => { for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs]; };
trim(); const exported = await exportModifiedRom(project, { forDsi: false }); await writeFile(`${out}/ability-actions.nds`, exported); project = await load(exported); verify();
const reedits = [];
for (const [id, changed] of [[165, { ...rules.get(165)!, effects: rules.get(165)!.effects.map(e => ({ ...e, parameters: { ...e.parameters, type: 9 } })) }], [166, { ...rules.get(166)!, effects: [{ kind: "abilityRecipe:knockoutSplash", value: 12.34, parameters: { hpBasis: 1 } }] }], [167, { ...rules.get(167)!, effects: [{ kind: "abilityRecipe:statAction", value: -2, parameters: { activation: 1, stat: 8, statSource: 0, scope: 2 } }] }]] as Array<[number, AbilityRuleSet]>) {
  const original = rules.get(id)!;
  for (const rule of [validateAbilityRule(changed), original]) { rules.set(id, rule); await configureAbilityRuleSets(project, [{ abilityId: id, rules: rule }]); trim(); const bytes = await exportModifiedRom(project, { forDsi: false }); project = await load(bytes); verify(); reedits.push({ id, sha256: sha(bytes) }); }
}
trim(); const reexported = await exportModifiedRom(project, { forDsi: false }); await writeFile(`${out}/ability-actions-reloaded.nds`, reexported); project = await load(reexported); verify();
const rom = new NintendoDSRom(reexported, { fileData: "view" }); validateHarnessRom(rom);
const dllBytes = rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)], dll = parseRpm(dllBytes, { allowedMagics: ["DLXF"] }); assert.equal(dll.metadata.PokewebAbilityActions, 1);
const symbols = Object.fromEntries(dll.symbols.filter(s => s.name?.startsWith("Ability")).map(s => [s.name!, s.address]));
const api = Object.fromEntries(ABILITY_RULE_API.flatMap((name, i) => name ? [[name, readU32(dll.code, symbols.AbilityRuleApi + i * 4) & ~1]] : []));
const gateway = dll.relocations.find(r => r.target.module === "base" && r.target.address === symbols.AbilityRuleApi + 20 * 4)!;
const pmc = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]), pmcSymbols = Object.fromEntries(pmc.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s => [s.name!, pmc.baseAddress + 32 + s.address]));
const overlay = rom.loadArm9Overlays([167]).get(167)!, resolver = battleRuntimeResolver(overlay.data, overlay.ramAddress, project.arm9, rom.arm9RamAddress);
const encoded = encodeAbilityRules(rules), nativeOffsets: number[] = [];
for (const [id, rule] of rules) { const at = readU16(encoded, id * 2), start = at + 4 + encoded[at + 1] * 4; rule.effects.forEach((effect, i) => { if (effect.kind.startsWith("nativeAbility:")) nativeOffsets.push(start + i * 16); }); }
type Case = { label: string; abilityId: number; playerSpecies?: number; level?: number; playerMoves?: number[]; turnMove?: number[]; hp?: number; playerStatus?: HarnessPokemon["status"]; ally?: HarnessPokemon; enemies?: HarnessPokemon[]; battleType?: "Doubles" | "Triples"; menuCount?: number; checks: Record<string, unknown> };
const mon = (speciesId = 320, level = 100, move = 150, abilityId = 50): HarnessPokemon => ({ speciesId, level, moves: [move], abilityId, itemId: 0 });
const stages = (spatk: number, speed: number, defense = 6) => [6, defense, spatk, 6, speed, 6, 6], neutral = stages(6, 6);
// The native doubles target picker initially selects the opponent in slot 1.
const splashTeam = [mon(113, 100), mon(320, 1), mon(321, 100)];
const cases: Case[] = [
  { label: "pressure-water-status", abilityId: 165, playerMoves: [110], checks: { playerStagesByTurn: [neutral, stages(7, 5, 7), stages(8, 4, 8)], popupsByTurn: [0, 1, 1], traceEvents: true } },
  { label: "pressure-damage", abilityId: 165, playerMoves: [55], checks: { playerStagesByTurn: [neutral, stages(7, 5), stages(8, 4)] } },
  { label: "pressure-wrong-type", abilityId: 165, playerMoves: [150], checks: { stages: neutral } },
  { label: "pressure-absorbed", abilityId: 165, playerMoves: [55], enemies: [mon(320, 100, 150, 11)], checks: { playerStagesByTurn: [neutral, stages(7, 5), stages(8, 4)] } },
  { label: "pressure-protected", abilityId: 165, playerMoves: [55], enemies: [mon(320, 100, 182)], checks: { playerStagesByTurn: [neutral, stages(7, 5), stages(8, 4)] } },
  { label: "pressure-flinched", abilityId: 165, playerMoves: [55], enemies: [mon(320, 100, 252)], checks: { playerStagesByTurn: [neutral, neutral, stages(7, 5)] } },
  { label: "pressure-suppressed", abilityId: 165, playerMoves: [55], enemies: [mon(320, 100, 380)], checks: { stages: neutral, suppressed: true } },
  { label: "pressure-swapped", abilityId: 165, playerMoves: [55], enemies: [mon(320, 100, 285)], checks: { playerAbilities: [165, 50, 165], playerStagesByTurn: [neutral, neutral, stages(7, 5)] } },
  { label: "pressure-and-or-true", abilityId: 170, playerMoves: [110], hp: 60, checks: { playerStagesByTurn: [neutral, stages(7, 5, 7), stages(8, 4, 8)] } },
  { label: "pressure-and-or-false", abilityId: 170, playerMoves: [110], checks: { playerStagesByTurn: [neutral, stages(6, 6, 7), stages(6, 6, 8)] } },
  { label: "action-multihit-once", abilityId: 169, playerMoves: [154], checks: { playerStagesByTurn: [neutral, stages(7, 6), stages(8, 6)] } },
  { label: "pressure-spread-once", abilityId: 165, playerMoves: [57], ally: mon(1, 50, 150, 11), enemies: [mon(), mon()], battleType: "Doubles", checks: { playerStagesByTurn: [neutral, stages(7, 5), stages(8, 4)] } },
  { label: "indignation-target-highest", abilityId: 167, playerMoves: [266], ally: mon(1, 50), enemies: [mon(320, 30, 33), mon(95, 30)], battleType: "Doubles", checks: { highestTargets: true, traceEvents: true } },
  { label: "indignation-holder-highest-control", abilityId: 171, playerMoves: [266], ally: mon(1, 50), enemies: [mon(320, 30, 33), mon(95, 30)], battleType: "Doubles", checks: { highestTargets: false } },
  { label: "indignation-clear-body", abilityId: 167, enemies: [mon(320, 30, 33, 29)], checks: { enemyStages: neutral } },
  { label: "indignation-suppressed", abilityId: 167, playerMoves: [150], enemies: [mon(320, 100, 380)], checks: { enemyStages: neutral, suppressed: true } },
  { label: "splash-defeated-hp", abilityId: 166, playerMoves: [82], ally: mon(1, 50), enemies: splashTeam, battleType: "Doubles", checks: { knockoutSplash: { percent: 20, hpBasis: 0 }, traceEvents: true } },
  { label: "splash-recipient-hp", abilityId: 168, playerMoves: [82], ally: mon(1, 50), enemies: splashTeam, battleType: "Doubles", checks: { knockoutSplash: { percent: 20, hpBasis: 1 } } },
  { label: "splash-no-knockout", abilityId: 166, playerMoves: [55], ally: mon(1, 50), enemies: [mon(), mon(113, 100)], battleType: "Doubles", checks: { noSplash: true } },
  { label: "splash-single-no-active-ally", abilityId: 166, playerMoves: [82], enemies: [mon(320, 1), mon()], checks: { noSplash: true } },
  { label: "splash-ally-knockout-excluded", abilityId: 166, playerMoves: [150], ally: mon(1, 100, 82), enemies: splashTeam, battleType: "Doubles", checks: { noSplash: true } },
  { label: "splash-suppressed", abilityId: 166, playerMoves: [266, 82], turnMove: [0, 1], ally: mon(1, 50), enemies: [mon(113, 100), mon(320, 1, 380), mon(321)], battleType: "Doubles", checks: { noSplash: true, suppressed: true } },
  { label: "splash-swap-away", abilityId: 166, playerMoves: [285, 82], turnMove: [0, 1], ally: mon(1, 50), enemies: splashTeam, battleType: "Doubles", checks: { noSplash: true, playerAbilities: [166, 50, 50] } },
  { label: "splash-swap-gain", abilityId: 50, playerMoves: [285, 82], turnMove: [0, 1], ally: mon(1, 50), enemies: [mon(113, 100), mon(320, 1, 150, 166), mon(321)], battleType: "Doubles", checks: { knockoutSplash: { percent: 20, hpBasis: 0, turn: 1 }, playerAbilities: [50, 166, 166] } },
  { label: "glory-bypasses-sturdy", abilityId: 166, playerMoves: [82], ally: mon(1, 50), enemies: [mon(113, 100), mon(320, 1, 150, 5), mon(321)], battleType: "Doubles", checks: { knockoutSplash: { percent: 20, hpBasis: 0 } } },
  { label: "splash-sturdy-control", abilityId: 168, playerMoves: [82, 150], turnMove: [0, 1], ally: mon(1, 50), enemies: [mon(113, 100), mon(320, 1, 150, 5), mon(321)], battleType: "Doubles", checks: { noSplash: true } },
];
const seed = rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl))), baseSave = patchTestBattleSavePlayerParty(seed, project, "Bulbasaur\nLevel: 50\n- Splash");
await prepareBw2TestBattleCodeInjection(project);
const hashes: Record<string, string> = {}, fixtures = [], only = process.argv.find(a => a.startsWith("--only="))?.slice(7).split(",");
for (const [index, spec] of cases.entries()) {
  if (only && !only.includes(spec.label)) continue;
  const enemies = spec.enemies ?? [mon()];
  const trainer = patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType: spec.battleType ?? "Singles", trainer: { team: enemies, ai: 0 } }));
  stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url))), 2, trainer));
  const save = patchHarnessSave(baseSave, project, parseHarnessConfig({ trainerId: 2, player: { team: [{ speciesId: spec.playerSpecies ?? 1, level: spec.level ?? 50, moves: spec.playerMoves ?? [150], abilityId: spec.abilityId, itemId: 0, ...(spec.hp === undefined ? {} : { currentHp: spec.hp }), ...(spec.playerStatus ? { status: spec.playerStatus } : {}) }, ...(spec.ally ? [spec.ally] : [])] } }));
  const raw = decryptPk5Party(save.subarray(0x18e08, 0x18e08 + 220)), label = `${String(index).padStart(3, "0")}-${spec.label}`, filename = `battle-${sha(new TextEncoder().encode(JSON.stringify([spec.battleType, enemies]))).slice(0, 16)}.nds`;
  await writeFile(`${out}/saves/${label}.sav`, save);
  if (!hashes[filename]) { const keep = project.narcs; project.narcs = Object.fromEntries(Object.entries(keep).filter(([name, store]) => ["personal", "trdata", "trpok"].includes(name) && store?.dirty.size)); const bytes = await exportModifiedRom(project, { forDsi: false }); project.narcs = keep; await writeFile(`${out}/${filename}`, bytes); hashes[filename] = sha(bytes); }
  fixtures.push({ ...spec, enemyCount: enemies.length, saveSha256: sha(save), label, speciesId: spec.playerSpecies ?? 1, maxHp: readU16(raw, 0x90), hp: spec.hp ?? readU16(raw, 0x90), rom: filename });
}
await writeFile(`${out}/cases.json`, JSON.stringify({ inputSha256: sha(input), exportSha256: sha(exported), reexportSha256: sha(reexported), projectReload: true, romExportReload: true, reedits, editedAbilities: rules.size, codeBytes: dll.code.length, bssBytes: dll.bssSize, serializedBytes: dllBytes.length, nameLoader: resolver.resolve("loadAbilityNameToStrbuf").address, api, symbols, pmcSymbols, popupGateway: dll.symbols[gateway.sourceSymbolIndex].address, hook: resolver.resolve("AbilityEvent_AddItem").address, configHex: Buffer.from(encoded).toString("hex"), nativeOffsets, romHashes: hashes, cases: fixtures, priorityRuntime: true, eventConstHook: resolver.resolve("BattleEventVar_SetConstValue").address, damageReactionHook: resolver.resolve("ServerEvent_DamageReaction").address, eventList: readU32(resolver.resolve("BattleEvent_SeekItem").code, 0x30) }, null, 2) + "\n");
assert.equal(sha(new Uint8Array(await readFile(inputPath))), sha(input)); console.log(`${fixtures.length} native action fixtures; project/ROM reload and ${reedits.length} parameter round trips passed.`);
