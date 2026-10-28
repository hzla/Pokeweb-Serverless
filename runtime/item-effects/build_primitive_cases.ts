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
import { type ItemRuleSet, type ItemRuleCondition, type ItemRuleEffect, validateItemRule, encodeItemRulesV4, ITEM_RULE_EFFECTS } from "../../src/pokeweb/itemRules";
import { ITEM_RULE_API } from "../../src/pokeweb/itemRuleRuntime";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { decryptPk5Party, encryptPk5Party, getTestBattlePersonal, refreshTestBattlePartyChecksums } from "../../src/pokeweb/testBattleTeam";
import { itemRulePreset } from "../../src/pokeweb/itemRulePresets";

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
type Scenario = { label: string; itemId: number; rules: ItemRuleSet; species?: number; hpPercent?: number; fullHp?: boolean; active?: boolean; consumable?: boolean; move?: number; enemyAttack?: boolean; enemyMove?: number; healBlock?: boolean; ability?: number; expectedWeather?: number; fallback?: boolean; checks?: Record<string, unknown> };
const scenarios: Scenario[] = [];
let nextId = 85;
function add(label: string, effects: ItemRuleEffect[], conditions: ItemRuleCondition = all(), options: Partial<Scenario> = {}) {
  while ([116, 298].includes(nextId)) nextId++;
  scenarios.push({ label, itemId: options.itemId ?? nextId++, rules: { effects, conditions, consumable: options.consumable ?? false }, active: true, ...options });
}
const native = (id: number, value = -1): ItemRuleEffect => ({ kind: `native:${id}`, value });
const status = (value: number, extra: Partial<ItemRuleEffect> = {}): ItemRuleEffect => ({ kind: "status", value, trigger: "turnEnd", target: "holder", chance: 100, ...extra });
const stage = (stat: number, value: number, extra: Partial<ItemRuleEffect> = {}): ItemRuleEffect => ({ kind: "statStage", stat, value, trigger: "entry", target: "holder", chance: 100, ...extra });
add("burn", [status(4)], all(), { fullHp: true, checks: { status: 4 } });
add("bad-poison", [status(7)], all(), { species: 133, fullHp: true, checks: { status: 5, badPoison: true } });
add("poison-type-immune", [status(5)], all(), { fullHp: true, consumable: true, checks: { status: 0, retained: true } });
add("paralysis-consumes", [status(1)], all(), { fullHp: true, consumable: true, checks: { status: 1, consumed: true } });
add("burn-fire-immune", [status(4)], all(), { species: 4, fullHp: true, consumable: true, checks: { status: 0, retained: true } });
add("attack-stage-entry", [stage(1, 2)], all(), { fullHp: true, checks: { initialStages: { 1: 8 }, stages: { 1: 8 } } });
add("speed-stage-turn-end", [stage(5, -1, { trigger: "turnEnd" })], all(), { fullHp: true, checks: { stagesPerTurn: { 5: [6, 5, 4] } } });
add("two-stats", [stage(1, 2), stage(4, 1)], all(), { fullHp: true, checks: { initialStages: { 1: 8, 4: 7 }, stages: { 1: 8, 4: 7 } } });
add("stat-stage-consumes", [stage(1, 2, { trigger: "turnEnd" })], all(), { fullHp: true, consumable: true, checks: { stages: { 1: 8 }, consumed: true } });
add("stat-stage-cap", [stage(1, 6, { trigger: "turnEnd" })], all(), { fullHp: true, checks: { stages: { 1: 12 }, retained: true } });
add("recoil", [{ kind: "recoil", value: 10 }], all(), { move: 33, fullHp: true, checks: { recoilPercent: 10, retained: true } });
add("recoil-consumes", [{ kind: "recoil", value: 10 }], all(), { move: 33, fullHp: true, consumable: true, checks: { recoilPercent: 10, consumed: true } });
add("contact-damages-attacker", [{ kind: "recoil", value: 10, trigger: "afterContact", target: "attacker" }], all(), { enemyAttack: true, fullHp: true, checks: { enemyDamaged: true, retained: true } });
add("lock-and-multiplier", [{ kind: "attack", value: 2.5 }, { kind: "moveLock", value: 1 }], all(), { move: 33, fullHp: true, checks: { lock: true, multiplier: 10240 } });
add("lock-condition-fails", [{ kind: "moveLock", value: 1 }], all(rock), { move: 33, fullHp: true, checks: { lock: false } });
add("native-leftovers", [native(234)], all(), { checks: { healingDivisor: 16 } });
add("native-black-sludge", [native(281)], all(), { checks: { healingDivisor: 16 } });
add("native-sludge-wrong-type", [native(281)], all(), { species: 133, fullHp: true, checks: { damageDivisor: 8 } });
add("native-oran-consumes", [native(155)], all(), { consumable: true, checks: { initialHeal: 10, consumed: true } });
add("native-oran-reusable", [native(155)], all(), { checks: { initialHeal: 10, retained: true, minimumHeal: 10 } });
add("native-sitrus-custom", [native(158, 50)], all(), { consumable: true, checks: { initialHealPercent: 50, consumed: true } });
add("native-liechi", [native(201)], all(), { consumable: true, checks: { initialStages: { 1: 7 }, stages: { 1: 7 }, consumed: true } });
add("native-normal-gem", [native(564)], all(), { move: 33, consumable: true, fullHp: true, checks: { multiplier: 6144, consumed: true, firstTurnOnly: true } });
add("native-reusable-gem", [native(564)], all(), { move: 33, fullHp: true, checks: { multiplier: 6144, retained: true, bothTurns: true } });
add("native-life-orb", [native(270, 50)], all(), { move: 33, fullHp: true, checks: { multiplier: 6144, recoilPercent: 10, retained: true } });
add("native-rocky-helmet", [native(540)], all(), { enemyAttack: true, fullHp: true, checks: { enemyDamaged: true, retained: true } });
add("native-flame-orb", [native(273)], all(), { fullHp: true, checks: { status: 4 } });
add("native-scope-lens", [native(232)], all(), { move: 33, fullHp: true, checks: { critical: 1 } });
add("native-wide-lens", [native(265)], all(), { move: 33, fullHp: true, checks: { multiplier: 4505 } });
add("native-choice-band", [native(220)], all(), { move: 33, fullHp: true, checks: { lock: true, multiplier: 6144 } });
add("separate-native-state", [native(155), native(564), { kind: "moveLock", value: 1 }], all(), { move: 33, checks: { initialHeal: 10, minimumHeal: 10, multiplier: 6144, bothTurns: true, lock: true, retained: true } });
add("species-condition", [stage(1, 2)], all({ kind: "species", value: 1 }), { fullHp: true, checks: { initialStages: { 1: 8 }, stages: { 1: 8 } } });
add("species-fails", [stage(1, 2)], all({ kind: "species", value: 4 }), { fullHp: true, checks: { stages: { 1: 6 } } });
add("move-type-condition", [{ kind: "damage", value: 2.5 }], all({ kind: "moveType", value: 0 }), { move: 33, fullHp: true, checks: { multiplier: 10240 } });
add("category-condition", [{ kind: "damage", value: 2.5 }], all({ kind: "category", value: 1 }), { move: 33, fullHp: true, checks: { multiplier: 10240 } });
add("status-condition", [status(4), stage(1, 1, { trigger: "turnEnd" })], all({ kind: "status", value: 0 }), { fullHp: true, checks: { status: 4, stages: { 1: 7 } } });
add("generic-critical", [{ kind: "critical", value: 2 }], all(), { move: 33, fullHp: true, checks: { critical: 2 } });
add("generic-accuracy", [{ kind: "accuracy", value: 1.5 }], all(), { move: 33, fullHp: true, checks: { multiplier: 6144 } });
add("generic-move-type", [{ kind: "moveType", value: 9, move: 33 }], all(), { move: 33, fullHp: true, checks: { moveType: 9 } });
add("native-type-boost", [native(249, 50)], all(), { move: 52, fullHp: true, checks: { multiplier: 6144 } });
add("native-focus-sash", [native(275)], all(), { fullHp: true, enemyAttack: true, enemyMove: 63, consumable: true, checks: { survive: true, consumed: true } });
add("native-focus-band", [native(230, 100)], all(), { fullHp: true, enemyAttack: true, enemyMove: 63, checks: { survive: true, retained: true } });
add("native-float-stone", [native(539)], all(), { fullHp: true, enemyAttack: true, enemyMove: 67, checks: { multiplier: 2048, retained: true } });
add("native-eviolite", [native(538)], all(), { fullHp: true, enemyAttack: true, checks: { multiplier: 6144, retained: true } });
add("native-air-balloon", [native(541)], all(), { fullHp: true, enemyAttack: true, enemyMove: 89, checks: { noDamage: true, retained: true } });
add("native-micle-berry", [native(209)], all(), { consumable: true, checks: { initialCondition: 34, consumed: true } });
add("native-white-herb", [stage(1, -2), native(214)], all(), { fullHp: true, checks: { stages: { 1: 6 }, retained: true } });
add("native-lum-berry", [status(4, { trigger: "entry" }), native(157)], all(), { fullHp: true, checks: { status: 0, retained: true } });
add("native-cell-battery", [native(546)], all(), { fullHp: true, enemyAttack: true, enemyMove: 84, consumable: true, checks: { stages: { 1: 7 }, consumed: true } });
add("native-absorb-bulb", [native(545)], all(), { fullHp: true, enemyAttack: true, enemyMove: 55, consumable: true, checks: { stages: { 3: 7 }, consumed: true } });
add("drive-preset-on-slotless", itemRulePreset(118, false).effects, all(), { move: 546, fullHp: true, checks: { moveType: 9 } });
add("drive-identity-replaced", [{ kind: "healFlat", value: 1 }], all(), { itemId: 116, move: 546, fullHp: true, checks: { moveType: 0 } });
add("judgment-plate-preset", itemRulePreset(298, false).effects, all(), { move: 449, fullHp: true, checks: { moveType: 9, multiplier: 4915 } });
add("judgment-identity-replaced", [{ kind: "healFlat", value: 1 }], all(), { itemId: 298, move: 449, fullHp: true, checks: { moveType: 0 } });
add("consumable-move-type", [{ kind: "moveType", value: 9, move: 33 }], all(), { move: 33, fullHp: true, consumable: true, checks: { moveType: 9, consumed: true } });
add("consumable-drive", itemRulePreset(118, false).effects, all(), { move: 546, fullHp: true, consumable: true, checks: { moveType: 9, consumed: true } });
const entries = new Map(scenarios.map(s => [s.itemId, validateItemRule(s.rules)]));
// Keep every in-battle native behavior linked while testing a 100-item registry.
const library = ITEM_RULE_EFFECTS.filter(effect => effect.nativeItem);
for (let id = 400, n = 0; entries.size < 100; id++) {
 const selected = library.slice(n, n + 4); n += selected.length;
 entries.set(id, validateItemRule({ effects: selected.length ? selected.map(effect => native(effect.nativeItem!)) : [{ kind: "healDivisor", value: 16 }], conditions: all(), consumable: false }));
}
const linkedKinds = new Set([...entries.values()].flatMap(rule => rule.effects.map(effect => effect.kind)));
for (const definition of library) assert(linkedKinds.has(definition.kind), `Missing native behavior in the live registry: ${definition.kind}`);
await configureItemRuleSets(project, [...entries].map(([itemId, rules]) => ({ itemId, rules })));
for (const [id, rules] of entries) { const state = inspectItemEffect(project, id); assert.equal(state.editable, true, `${id}: ${state.message}`); assert.deepEqual(state.rules, rules); }
project = openProjectSession(createProjectDocument(project, false));
project.originalRomBytes = input; hydrateItemEffectsSource(project, new NintendoDSRom(input, { fileData: "view" }));
for (const [id, rules] of entries) assert.deepEqual(inspectItemEffect(project, id).rules, rules);
for (const [name, store] of Object.entries(project.narcs)) if (name !== "items" || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/primitives-100.nds`, exported, { flag: "wx" });
project = await load(exported);
for (const [id, rules] of entries) assert.deepEqual(inspectItemEffect(project, id).rules, rules);
const rom = new NintendoDSRom(exported, { fileData: "view" }); validateHarnessRom(rom);
const dll = parseRpm(rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
const named = (name: string) => dll.symbols.find(s => s.name === name)!.address;
const apiAt = named("ItemRuleApi"), api = Object.fromEntries(ITEM_RULE_API.map((name, index) => [name, new DataView(dll.code.buffer).getUint32(apiAt + index * 4, true) & ~1]));
api.BattleEventVar_RewriteValue = new DataView(dll.code.buffer).getUint32(apiAt + 28 * 4, true) & ~1;
const symbols = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]);
const pmcSymbols = Object.fromEntries(symbols.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea/.test(s.name)).map(s => [s.name!, symbols.baseAddress + 32 + s.address]));
const manifest = { inputSha256: sourceHash, exportSha256: sha(exported), editedItems: entries.size, codeBytes: dll.code.length, api, pmcSymbols,
  symbols: Object.fromEntries(dll.symbols.filter(s => s.name?.startsWith("Rule") || s.name?.startsWith("ItemRule")).map(s => [s.name!, s.address])),
  hook: dll.relocations.find(r => r.target.module === "167")!.target.address, configHex: Buffer.from(encodeItemRulesV4(entries).bytes).toString("hex"), nativeOffsets: encodeItemRulesV4(entries).nativeEffects.map(effect => effect.offset), projectReload: true, romExportReload: true };
const trainer = (move: number) => parseHarnessConfig({ trainerId: 2, battleType: "Singles", trainer: { team: [{ speciesId: 320, level: move === 63 ? 100 : 50, moves: [move], itemId: 0, abilityId: 70 }], ai: 0 } });
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
    rom: spec.enemyMove ? `battle-native-${spec.enemyMove}.nds` : spec.healBlock ? "battle-healblock.nds" : spec.label === "special-defense" ? "battle-special.nds" : spec.enemyAttack ? "battle-physical.nds" : "battle-rules.nds" });
}
const hashes: Record<string, string> = {};
for (const [filename, move] of [["battle-rules.nds", 150], ["battle-physical.nds", 33], ...[...new Set(scenarios.flatMap(spec => spec.enemyMove ? [spec.enemyMove] : []))].map(move => [`battle-native-${move}.nds`, move] as const)] as Array<readonly [string, number]>) {
  patchHarnessTrainer(project, trainer(move));
  const candidate = structuredClone({ narcs: project.narcs });
  for (const [name, store] of Object.entries(project.narcs)) if (!["personal", "trdata", "trpok"].includes(name) || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
  const bytes = await exportModifiedRom(project, { forDsi: false });
  await writeFile(`${out}/${filename}`, bytes, { flag: "wx" }); hashes[filename] = sha(bytes);
  project.narcs = candidate.narcs;
}
await writeFile(`${out}/cases.json`, JSON.stringify({ ...manifest, romHashes: hashes, cases }, null, 2));
assert.equal(sha(new Uint8Array(await readFile(inputPath))), sourceHash);
console.log(`100 expanded rules survived save/export/reload; prepared ${cases.length} native battle cases.`);
