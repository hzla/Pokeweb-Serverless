/** Matched native battles: stored rules, shared wrappers and active callbacks. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { readU16 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, ABILITY_EFFECTS_DLL_PATH } from "../../src/pokeweb/abilityEffectsModel";
import { ABILITY_IMPORT_LIBRARY } from "../../src/pokeweb/abilityLibrary";
import { EMPTY_ABILITY_RULE, validateAbilityRule, type AbilityRuleSet, type AbilityRuleEffect } from "../../src/pokeweb/abilityRules";
import { NATIVE_ABILITY_PROFILES } from "../../src/pokeweb/abilityNativeRuntime";
import { battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import { parseHarnessConfig, patchHarnessTrainer, patchHarnessSave, configureHarnessRuntime } from "../../src/pokeweb/battleHarness";
import { buildTestBattleDownloads, getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { parseRpm } from "../../src/pokeweb/rpm";
import blackBindings from "../../src/assets/data/abilityBindingsB1.json";

const [inputPath, outputPath] = process.argv.slice(2);
assert(outputPath, "Usage: INPUT.nds NEW_OUTPUT_DIRECTORY");
const doubles = process.argv.includes("--doubles");
const only = process.argv.find(a => a.startsWith("--only="))?.slice(7).split(",");
const out = resolve(outputPath); await mkdir(out); await mkdir(`${out}/saves`);
const input = new Uint8Array(await readFile(inputPath));
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
globalThis.fetch = (async request => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "ability-performance.nds", {
  selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"],
});
const first = await load(input), black = first.session.baseRom === "BW";
assert(black ? first.session.baseVersion === "B" : first.session.baseVersion === "W2");
assert(!black || !doubles, "Doubles performance fixtures currently use the BW2 direct launcher");
assert.equal(inspectAbilityEffects(first).rules.size, 0, "Supply a ROM without existing ability edits");
const profiles = black ? blackBindings.profiles : NATIVE_ABILITY_PROFILES;
const always = EMPTY_ABILITY_RULE.conditions;
const single = new Map<number, AbilityRuleSet>([[37, { effects: [{ kind: "nativeAbility:37", value: 2 }], conditions: always }]]);
const passive: AbilityRuleSet = validateAbilityRule({
  effects: [{ kind: "defense", value: 1 }, { kind: "speed", value: 1 }],
  conditions: { kind: "group", mode: "all", children: [
    { kind: "hp", comparison: "gt", percent: 0 },
    { kind: "group", mode: "any", children: [{ kind: "type", value: 0 }, { kind: "type", value: 10 }, { kind: "weather", value: 3 }] },
  ] },
});
const refrigerate = ABILITY_IMPORT_LIBRARY.find(p => p.label === "Refrigerate")!.rule;
const many = new Map(single), changed: number[] = [];
// Deterministic parameter changes avoid depending on a random seed or remote data.
for (const p of profiles) {
  if (many.size === 50) break;
  if (p.id === 37 || p.id === 50) continue;
  const e: AbilityRuleEffect = { kind: `nativeAbility:${p.id}`, value: -1 };
  const typed = p as typeof NATIVE_ABILITY_PROFILES[number];
  if (typed.multipliers?.length) e.value = 1.25;
  else if (typed.chances?.length) e.chance = 70;
  else if (typed.weather?.length) e.weather = 3;
  else if (typed.stats?.length) e.stat = 3;
  else if (typed.parameters?.length) {
    const c = typed.parameters[0]; e.parameters = { [c.key]: c.choices?.find(v => v !== c.original) ?? (c.original === c.min ? c.max : c.min) };
  } else continue;
  many.set(p.id, validateAbilityRule({ effects: [e], conditions: always })); changed.push(p.id);
}
assert.equal(many.size, 50);
for (let n = 0; n < 30; n++) many.set(165 + n, ABILITY_IMPORT_LIBRARY[n].rule);
// These two custom abilities have matching one-rule controls below.
many.set(165, passive); many.set(166, refrigerate);
assert.equal(many.size, 80);
const cases = [
  { label: "baseline-neutral", rules: new Map<number, AbilityRuleSet>(), ability: 50 },
  { label: "baseline-huge-power", rules: new Map<number, AbilityRuleSet>(), ability: 37 },
  { label: "one-copied", rules: single, ability: 37 },
  { label: "80-dormant", rules: many, ability: 50 },
  { label: "80-copied", rules: many, ability: 37 },
  { label: "one-passive", rules: new Map([[165, passive]]), ability: 165 },
  { label: "80-passive", rules: many, ability: 165 },
  { label: "one-refrigerate", rules: new Map([[166, refrigerate]]), ability: 166 },
  { label: "80-refrigerate", rules: many, ability: 166 },
];
const fixtures = [];
for (const spec of cases) {
  if (only && !only.includes(spec.label)) continue;
  for (const [id, rule] of spec.rules) spec.rules.set(id, validateAbilityRule(rule));
  let project = await load(input);
  if (spec.rules.size) await configureAbilityRuleSets(project, [...spec.rules].map(([abilityId, rules]) => ({
    abilityId, rules, ...(abilityId >= 165 ? { name: `Perf ${abilityId}` } : {}),
  })));
  const trainer = parseHarnessConfig({ trainerId: 2, battleType: doubles ? "Doubles" : "Singles", trainer: { ai: 7, team:
    Array.from({ length: doubles ? 2 : 1 }, () => ({ speciesId: 320, level: 30, moves: [33, 10, 1, 129], abilityId: spec.ability, itemId: 0 })),
  } });
  const battleRule = patchHarnessTrainer(project, trainer);
  let romBytes: Uint8Array, saveBytes: Uint8Array;
  if (black) {
    const downloads = await buildTestBattleDownloads(project, 2);
    romBytes = downloads.romBytes; saveBytes = rawSaveBytesFromDesmumeDsv(downloads.saveBytes);
  } else {
    await prepareBw2TestBattleCodeInjection(project);
    stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url))), 2, battleRule));
    const stores = project.narcs;
    project.narcs = Object.fromEntries(Object.entries(stores).filter(([, store]) => store?.dirty.size));
    romBytes = await exportModifiedRom(project, { forDsi: false });
    project.narcs = stores;
    saveBytes = rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
  }
  const saved = patchHarnessSave(saveBytes, project, parseHarnessConfig({ trainerId: 2, player: { team:
    Array.from({ length: doubles ? 2 : 1 }, () => ({ speciesId: 242, level: 100, moves: [150], abilityId: spec.ability, itemId: 0 })),
  } }));
  const reloaded = await load(romBytes);
  assert.deepEqual(inspectAbilityEffects(reloaded).rules, spec.rules);
  const rom = new NintendoDSRom(romBytes, { fileData: "view" }), overlay = rom.loadArm9Overlays([black ? 93 : 167]).get(black ? 93 : 167)!;
  const resolver = battleRuntimeResolver(overlay.data, overlay.ramAddress, reloaded.arm9, rom.arm9RamAddress, black ? blackBindings.functions : undefined);
  const module = spec.rules.size ? parseRpm(rom.getFileByName(ABILITY_EFFECTS_DLL_PATH), { allowedMagics: ["DLXF"] }) : undefined;
  const symbols = module ? Object.fromEntries(module.symbols.filter(s => s.name?.startsWith("Ability")).map(s => [s.name!, s.address])) : {};
  const probes = Object.fromEntries(["BattleEvent_CallHandlersCore", "GetBattleMonStat", "PML_MoveGetParam", "ServerEvent_GetWeather"].map(n => [n, resolver.resolve(n).address]));
  const party = decryptPk5Party(saved.subarray(0x18e08, 0x18e08 + 220));
  await writeFile(`${out}/${spec.label}.nds`, romBytes, { flag: "wx" });
  await writeFile(`${out}/saves/${spec.label}.sav`, saved, { flag: "wx" });
  fixtures.push({ label: spec.label, rom: `${spec.label}.nds`, sha256: hash(romBytes), ability: spec.ability, count: spec.rules.size,
    codeBytes: module?.code.length ?? 0, bssBytes: module?.bssSize ?? 0, symbols, probes,
    hook: resolver.resolve("AbilityEvent_AddItem").address, speciesId: 242, maxHp: readU16(party, 0x90),
    opening: black ? 0x021bbb60 : 0x0219f5da, flowRegister: black ? "r0" : "r6", command: black ? 0x021bacac : 0x021cef18,
  });
}
assert.equal(hash(new Uint8Array(await readFile(inputPath))), hash(input));
await writeFile(`${out}/performance.json`, JSON.stringify({ inputSha256: hash(input), game: first.session.baseVersion, manualLaunch: black, doubles, changedExisting: [37, ...changed], added: 30, cases: fixtures }, null, 2) + "\n");
console.log(`${fixtures.length} matched performance fixtures: 50 existing plus 30 custom abilities.`);
