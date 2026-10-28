/** Reproducible GUI-model, export/reload and real-battle rule fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readU16 } from "../../src/nds/binary";
import { NintendoDSRom } from "../../src/nds/rom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureHarnessRuntime, parseHarnessConfig, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../../src/pokeweb/battleHarness";
import { configureItemRuleSets, configureItemTypeHealingBatch, hydrateItemEffectsSource, inspectItemEffect, ITEM_EFFECTS_DLL_PATH } from "../../src/pokeweb/itemEffectsModel";
import { type ItemRuleSet, type ItemRuleCondition, type ItemRuleEffect, validateItemRule, encodeItemRulesV4 } from "../../src/pokeweb/itemRules";
import { ITEM_RULE_API } from "../../src/pokeweb/itemRuleRuntime";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { decryptPk5Party, encryptPk5Party, getTestBattlePersonal, refreshTestBattlePartyChecksums } from "../../src/pokeweb/testBattleTeam";

const [inputPath, directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: vite-node runtime/item-effects/build_rule_cases.ts INPUT.nds OUTPUT_DIRECTORY");
const out = resolve(directory), input = new Uint8Array(await readFile(inputPath));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceHash = sha(input);
await mkdir(`${out}/saves`, { recursive: true });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets are permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "rule-validation.nds", { selectedNarcs: ["items", "personal", "moves", "trdata", "trpok", "message_texts"] });
let project = await load(input);
const all = (...children: ItemRuleCondition[]): ItemRuleCondition => ({ kind: "group", mode: "all", children });
const any = (...children: ItemRuleCondition[]): ItemRuleCondition => ({ kind: "group", mode: "any", children });
const low: ItemRuleCondition = { kind: "hp", comparison: "lt", percent: 50 }, grass: ItemRuleCondition = { kind: "type", value: 11 }, rock: ItemRuleCondition = { kind: "type", value: 5 };
const sun: ItemRuleCondition = { kind: "weather", value: 1 }, rain: ItemRuleCondition = { kind: "weather", value: 2 };
type Scenario = { label: string; itemId: number; rules: ItemRuleSet; species?: number; hpPercent?: number; fullHp?: boolean; active?: boolean; consumable?: boolean; move?: number; enemyAttack?: boolean; healBlock?: boolean; ability?: number; expectedWeather?: number; fallback?: boolean };
const scenarios: Scenario[] = [];
let nextId = 85;
function add(label: string, effects: ItemRuleEffect[], conditions: ItemRuleCondition = all(), options: Partial<Scenario> = {}) {
  scenarios.push({ label, itemId: options.itemId ?? nextId++, rules: { effects, conditions, consumable: options.consumable ?? false }, active: true, ...options });
}
const heal: ItemRuleEffect[] = [{ kind: "healDivisor", value: 16 }];
add("and-both", heal, all(low, grass));
add("and-hp-fails", heal, all(low, grass), { fullHp: true, active: false });
add("and-type-fails", heal, all(low, rock), { active: false });
add("or-hp-only", heal, any(low, rock));
add("or-type-only", heal, any(low, grass), { hpPercent: 75 });
add("or-neither", heal, any(low, rock), { hpPercent: 75, active: false });
add("nested-and-or", heal, all(low, any(rock, sun)));
add("nested-fails", heal, all(low, any(rock, rain)), { active: false });
add("nested-or-and", heal, any(rock, all(low, sun)));
add("below-half-boundary", heal, all(low), { hpPercent: 50, active: false });
add("at-most-half-boundary", heal, all({ kind: "hp", comparison: "lte", percent: 50 }), { hpPercent: 50 });
add("above-half-boundary", heal, all({ kind: "hp", comparison: "gt", percent: 50 }), { hpPercent: 50, active: false });
add("at-least-half-boundary", heal, all({ kind: "hp", comparison: "gte", percent: 50 }), { hpPercent: 50 });
add("type-negated", heal, all({ kind: "type", value: 5, negate: true }));
add("fairy", heal, all({ kind: "type", value: 17 }), { species: 35 });
add("sun", heal, all(sun), { expectedWeather: 1 });
add("rain-absent", heal, all(rain), { active: false, expectedWeather: 1 });
add("weather-negated", heal, all({ kind: "weather", value: 2, negate: true }));
add("rain-transition", heal, all(rain), { move: 240, expectedWeather: 2 });
add("cloud-nine", heal, all({ kind: "weather", value: 0 }), { ability: 13, expectedWeather: 0 });
add("air-lock", heal, all(sun), { ability: 76, active: false, expectedWeather: 0 });
add("heal-percent", [{ kind: "healPercent", value: 12.5 }]);
add("heal-flat", [{ kind: "healFlat", value: 13 }]);
add("heal-divisor-3", [{ kind: "healDivisor", value: 3 }]);
add("heal-minimum", [{ kind: "healDivisor", value: 255 }]);
add("combined-healing", [...heal, { kind: "healFlat", value: 5 }]);
add("consumable-heal", heal, all(low), { consumable: true });
add("consumable-false", heal, all(rock), { consumable: true, active: false });
add("consumable-full", heal, all(), { consumable: true, fullHp: true });
add("heal-block-keeps-item", heal, all(), { consumable: true, healBlock: true });
add("attack-2-5", [{ kind: "attack", value: 2.5 }], any(low, rock), { move: 33, itemId: 238 });
add("attack-condition-fails", [{ kind: "attack", value: 2.5 }], all(rock), { move: 33, active: false });
add("attack-category-fails", [{ kind: "attack", value: 2.5 }], all(), { move: 93, active: false, consumable: true });
add("special-attack", [{ kind: "specialAttack", value: 2.5 }], all(low), { move: 93 });
add("damage-2-5", [{ kind: "damage", value: 2.5 }], all(low), { move: 33 });
add("defense", [{ kind: "defense", value: 2 }], all(), { enemyAttack: true, fullHp: true });
add("special-defense", [{ kind: "specialDefense", value: 2 }], all(), { enemyAttack: true, move: 150, fullHp: true, expectedWeather: 1 });
add("speed", [{ kind: "speed", value: 2 }]);
add("consumable-attack", [{ kind: "attack", value: 2.5 }], all(low), { consumable: true, move: 33 });
add("consumable-damage", [{ kind: "damage", value: 1.3 }], all(low), { consumable: true, move: 33 });
add("consumable-defense", [{ kind: "defense", value: 2 }], all(), { consumable: true, enemyAttack: true, fullHp: true });
add("consumable-speed-status", [{ kind: "speed", value: 2 }], all(), { consumable: true });
add("mixed-effects", [{ kind: "attack", value: 2.5 }, { kind: "speed", value: 2 }, { kind: "healPercent", value: 6.25 }], all(low, any(rock, sun)), { move: 33 });
// Migrate an already authored native healing override, preserving exact 1/3.
await configureItemTypeHealingBatch(project, [{ itemId: 234, type: 11, divisor: 3 }]);
scenarios.push({ label: "migrated-divisor", itemId: 234, rules: { effects: [{ kind: "healDivisor", value: 3 }], conditions: all(grass), consumable: false }, active: true });
const entries = new Map(scenarios.map(s => [s.itemId, validateItemRule(s.rules)]));
for (let id = 400; entries.size < 100; id++) entries.set(id, validateItemRule({ effects: [{ kind: "healDivisor", value: 16 }], conditions: all({ kind: "type", value: id % 18 }), consumable: false }));
await configureItemRuleSets(project, [...entries].filter(([id]) => id !== 234).map(([itemId, rules]) => ({ itemId, rules })));
for (const [id, rules] of entries) { const state = inspectItemEffect(project, id); assert.equal(state.editable, true, `${id}: ${state.message}`); assert.deepEqual(state.rules, rules); }
project = openProjectSession(createProjectDocument(project, false));
project.originalRomBytes = input; hydrateItemEffectsSource(project, new NintendoDSRom(input, { fileData: "view" }));
for (const [id, rules] of entries) assert.deepEqual(inspectItemEffect(project, id).rules, rules);
for (const [name, store] of Object.entries(project.narcs)) if (name !== "items" || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/rules-100.nds`, exported, { flag: "wx" });
project = await load(exported);
for (const [id, rules] of entries) assert.deepEqual(inspectItemEffect(project, id).rules, rules);
const rom = new NintendoDSRom(exported, { fileData: "view" }); validateHarnessRom(rom);
const dll = parseRpm(rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
const named = (name: string) => dll.symbols.find(s => s.name === name)!.address;
const apiAt = named("ItemRuleApi"), api = Object.fromEntries(ITEM_RULE_API.map((name, index) => [name, new DataView(dll.code.buffer).getUint32(apiAt + index * 4, true) & ~1]));
const symbols = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]);
const pmcSymbols = Object.fromEntries(symbols.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea/.test(s.name)).map(s => [s.name!, symbols.baseAddress + 32 + s.address]));
const manifest = { inputSha256: sourceHash, exportSha256: sha(exported), editedItems: entries.size, codeBytes: dll.code.length, api, pmcSymbols,
  symbols: Object.fromEntries(dll.symbols.filter(s => s.name?.startsWith("Rule") || s.name?.startsWith("ItemRule")).map(s => [s.name!, s.address])),
  hook: dll.relocations.find(r => r.target.module === "167")!.target.address, configHex: Buffer.from(encodeItemRulesV4(entries).bytes).toString("hex"), projectReload: true, romExportReload: true };
const trainer = (move: number) => parseHarnessConfig({ trainerId: 2, battleType: "Singles", trainer: { team: [{ speciesId: 320, level: 50, moves: [move], itemId: 0, abilityId: 70 }], ai: 0 } });
const rule = patchHarnessTrainer(project, trainer(150));
await prepareBw2TestBattleCodeInjection(project);
stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url))), 2, rule));
const save = rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
const cases: Array<Record<string, unknown>> = [];
for (const [index, spec] of scenarios.entries()) {
  const fixture = patchHarnessSave(save, project, parseHarnessConfig({ trainerId: 2, player: { team: [{ speciesId: spec.species ?? 1, level: 50, moves: [spec.move ?? 150], itemId: spec.itemId, abilityId: spec.ability ?? 1, ...(spec.fullHp || spec.hpPercent !== undefined ? {} : { currentHp: 10 }) }] } }));
  const raw = decryptPk5Party(fixture.subarray(0x18e08, 0x18e08 + 220)), maxHp = readU16(raw, 0x90);
  if (spec.hpPercent !== undefined) for (const half of [0, 0x40000]) {
    const at = half + 0x18e08, data = decryptPk5Party(fixture.subarray(at, at + 220));
    new DataView(data.buffer).setUint16(0x8e, Math.floor(maxHp * spec.hpPercent / 100), true);
    fixture.set(encryptPk5Party(data), at); refreshTestBattlePartyChecksums(fixture, half);
  }
  const label = `${String(index).padStart(3, "0")}-${spec.label}`;
  await writeFile(`${out}/saves/${label}.sav`, fixture, { flag: "wx" });
  const { raw: personal } = getTestBattlePersonal(project, spec.species ?? 1);
  cases.push({ ...spec, label, holderTypes: [Number(personal.type_1), Number(personal.type_2)], rules: validateItemRule(spec.rules), hp: spec.hpPercent !== undefined ? Math.floor(maxHp * spec.hpPercent / 100) : spec.fullHp ? maxHp : 10, maxHp, speciesId: spec.species ?? 1,
    rom: spec.healBlock ? "battle-healblock.nds" : spec.label === "special-defense" ? "battle-special.nds" : spec.enemyAttack ? "battle-physical.nds" : "battle-rules.nds" });
}
const hashes: Record<string, string> = {};
for (const [filename, move] of [["battle-rules.nds", 150], ["battle-physical.nds", 33], ["battle-special.nds", 93], ["battle-healblock.nds", 377]] as const) {
  patchHarnessTrainer(project, trainer(move));
  const candidate = structuredClone({ narcs: project.narcs });
  for (const [name, store] of Object.entries(project.narcs)) if (!["personal", "trdata", "trpok"].includes(name) || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
  const bytes = await exportModifiedRom(project, { forDsi: false });
  await writeFile(`${out}/${filename}`, bytes, { flag: "wx" }); hashes[filename] = sha(bytes);
  project.narcs = candidate.narcs;
}
await writeFile(`${out}/cases.json`, JSON.stringify({ ...manifest, romHashes: hashes, cases }, null, 2));
assert.equal(sha(new Uint8Array(await readFile(inputPath))), sourceHash);
console.log(`100 rules survived save/export/reload; prepared ${cases.length} native battle cases.`);
