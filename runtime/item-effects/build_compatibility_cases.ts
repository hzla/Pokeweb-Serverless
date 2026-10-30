/** Representative item edits, persistence and native Black 2 battle fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { readU16 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { assignItemEffect, configureItemRuleSets, hydrateItemEffectsSource, inspectItemEffect, ITEM_EFFECTS_DLL_PATH, updateItemEffectControl } from "../../src/pokeweb/itemEffectsModel";
import { encodeItemRulesV4, validateItemRule, type ItemRuleCondition, type ItemRuleEffect, type ItemRuleSet } from "../../src/pokeweb/itemRules";
import { ITEM_RULE_API } from "../../src/pokeweb/itemRuleRuntime";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import { decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { black2CompatibilityHarness } from "../ability-effects/compatibility_harness";
import { detectSpecifyTrainerNaturesPatch } from "../../src/pokeweb/romPatchModel";
import { decodeRecord, markDirty } from "../../src/pokeweb/projectStore";

const [inputPath, directory, white2Reference] = process.argv.slice(2);
if (!white2Reference) throw new Error("Usage: BLACK2.nds NEW_OUTPUT_DIRECTORY WHITE2_REFERENCE.nds");
const out = resolve(directory), input = new Uint8Array(await readFile(inputPath));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"), inputSha256 = sha(input);
await mkdir(`${out}/saves`, { recursive: true });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "item-compatibility.nds", { selectedNarcs: ["items", "personal", "moves", "trdata", "trpok", "message_texts"] });
let project = await load(input);
assert.equal(project.session.baseVersion, "B2");
const trainerNatureMigrated = detectSpecifyTrainerNaturesPatch(project) === "legacy";
const all = (...children: ItemRuleCondition[]): ItemRuleCondition => ({ kind: "group", mode: "all", children });
const any = (...children: ItemRuleCondition[]): ItemRuleCondition => ({ kind: "group", mode: "any", children });
const low: ItemRuleCondition = { kind: "hp", comparison: "lt", percent: 50 };
const grass: ItemRuleCondition = { kind: "type", value: 11 }, rock: ItemRuleCondition = { kind: "type", value: 5 };
type Scenario = { label: string; itemId: number; rules?: ItemRuleSet; species?: number; fullHp?: boolean; move?: number; enemyMove?: number; checks: Record<string, unknown> };
const scenarios: Scenario[] = [];
let nextId = 85;
function add(label: string, effects: ItemRuleEffect[], checks: Record<string, unknown>, options: Partial<Scenario> & { conditions?: ItemRuleCondition; consumable?: boolean } = {}) {
  const { conditions = all(), consumable = false, ...rest } = options;
  scenarios.push({ label, itemId: nextId++, rules: validateItemRule({ effects, conditions, consumable }), checks, ...rest });
}
const native = (id: number, value = -1): ItemRuleEffect => ({ kind: `native:${id}`, value });
add("healing-and", [{ kind: "healPercent", value: 12.5 }], { healingDivisor: 8 }, { conditions: all(low, grass) });
add("healing-and-fails", [{ kind: "healPercent", value: 12.5 }], { unchangedHp: true, retained: true }, { conditions: all(low, rock), consumable: true });
add("healing-or", [{ kind: "healFlat", value: 7 }], { healingFlat: 7 }, { conditions: any(low, rock) });
add("attack-and-move-lock", [{ kind: "attack", value: 2.5 }, { kind: "moveLock", value: 1 }], { multiplier: 10240, lock: true }, { move: 33, fullHp: true });
add("defense-multiplier", [{ kind: "defense", value: 2 }], { multiplier: 8192, retained: true }, { enemyMove: 33, fullHp: true });
add("speed-multiplier", [{ kind: "speed", value: 0.75 }], { multiplier: 3072, retained: true }, { fullHp: true });
add("outgoing-damage", [{ kind: "damage", value: 2.5 }], { multiplier: 10240, enemyDamaged: true }, { move: 33, fullHp: true });
add("burn-status", [{ kind: "status", value: 4, trigger: "turnEnd", target: "holder", chance: 100 }], { status: 4 }, { fullHp: true });
add("two-entry-stages", [{ kind: "statStage", stat: 2, value: 2 }, { kind: "statStage", stat: 5, value: -1 }], { initialStages: { 2: 8, 5: 5 }, stages: { 2: 8, 5: 5 } }, { fullHp: true });
add("consumable-recoil", [{ kind: "recoil", value: 12.5 }], { recoilPercent: 12.5, consumed: true }, { move: 33, fullHp: true, consumable: true });
add("native-berry-50-percent", [native(158, 50)], { initialHealPercent: 50, consumed: true }, { consumable: true });
add("native-life-orb", [native(270, 50)], { multiplier: 6144, recoilPercent: 10, retained: true }, { move: 33, fullHp: true });
add("native-contact-recoil", [native(540, 4)], { enemyDamageDivisor: 4, retained: true }, { enemyMove: 33, fullHp: true });
add("critical-and-accuracy", [{ kind: "critical", value: 2 }, { kind: "accuracy", value: 1.5 }], { critical: 2, multiplier: 6144 }, { move: 33, fullHp: true });
add("move-type-fire", [{ kind: "moveType", value: 9, move: 33 }], { moveType: 9 }, { move: 33, fullHp: true });
add("focus-sash-survival", [native(275)], { survive: true, consumed: true }, { enemyMove: 63, fullHp: true, consumable: true });
add("ground-immunity", [native(541)], { noDamage: true, retained: true }, { enemyMove: 89, fullHp: true });
add("white-herb", [{ kind: "statStage", stat: 1, value: -2 }, native(214)], { stages: { 1: 6 }, retained: true }, { fullHp: true });
add("lum-status-cure", [{ kind: "status", value: 4, trigger: "entry" }, native(157)], { status: 0, retained: true }, { fullHp: true });
add("berry-gem-lock-state", [native(155), native(564), { kind: "moveLock", value: 1 }], { initialHeal: 10, minimumHeal: 10, multiplier: 6144, bothTurns: true, lock: true, retained: true }, { move: 33 });
add("type-healing-rock", [{ kind: "healDivisor", value: 8 }], { healingDivisor: 8 }, { conditions: all(rock), species: 74 });
add("type-healing-wrong-type", [{ kind: "healDivisor", value: 8 }], { unchangedHp: true }, { conditions: all(rock) });
// These retain their ordinary native factories and exercise the direct controls.
assignItemEffect(project, 238, 234);
updateItemEffectControl(project, 234, "healingDivisor", 8);
updateItemEffectControl(project, 220, "multiplier", 1.75);
scenarios.push({ label: "direct-leftovers-divisor", itemId: 234, checks: { healingDivisor: 8 } },
  { label: "direct-hard-stone-reassigned", itemId: 238, checks: { healingDivisor: 8 } },
  { label: "direct-choice-band", itemId: 220, move: 33, fullHp: true, checks: { multiplier: 7168, lock: true } });
const entries = new Map(scenarios.filter(s => s.rules).map(s => [s.itemId, s.rules!]));
// Client-only switching is checked with real native AI calls below.
entries.set(107, validateItemRule({ effects: [{ kind: "escapeTrap", value: 1 }], conditions: all(), consumable: false }));
entries.set(108, validateItemRule({ effects: [{ kind: "escapeTrap", value: 1 }], conditions: all(rock), consumable: false }));
await configureItemRuleSets(project, [...entries].map(([itemId, rules]) => ({ itemId, rules })));
function check() {
  if (trainerNatureMigrated) assert.equal(detectSpecifyTrainerNaturesPatch(project), "patched");
  for (const [id, rule] of entries) { const state = inspectItemEffect(project, id); assert(state.editable, state.message); assert.deepEqual(state.rules, rule); }
  assert.equal(inspectItemEffect(project, 238).profileId, 234);
  assert.equal(inspectItemEffect(project, 234).controls[0].value, 8);
  assert.equal(inspectItemEffect(project, 220).controls[0].value, 1.75);
}
check();
project = openProjectSession(createProjectDocument(project, false)); project.originalRomBytes = input;
hydrateItemEffectsSource(project, new NintendoDSRom(input, { fileData: "view" })); check();
for (const [name, store] of Object.entries(project.narcs)) if (name !== "items" || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/items.nds`, exported, { flag: "wx" });
project = await load(exported); check();
const rom = new NintendoDSRom(exported, { fileData: "view" }), overlay = rom.loadArm9Overlays([167]).get(167)!;
const dllBytes = rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)], dll = parseRpm(dllBytes, { allowedMagics: ["DLXF"] });
const apiAt = dll.symbols.find(s => s.name === "ItemRuleApi")!.address;
const api = Object.fromEntries(ITEM_RULE_API.map((name, index) => [name, new DataView(dll.code.buffer).getUint32(apiAt + index * 4, true) & ~1]));
api.BattleEventVar_RewriteValue = new DataView(dll.code.buffer).getUint32(apiAt + 28 * 4, true) & ~1;
const pmc = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]);
const pmcSymbols = Object.fromEntries(pmc.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea/.test(s.name)).map(s => [s.name!, pmc.baseAddress + 32 + s.address]));
const encoded = encodeItemRulesV4(entries), trainerId = 87;
const trainer = (move: number, itemId = 0) => parseHarnessConfig({ trainerId, battleType: "Singles", trainer: { ai: 0, team: [{ speciesId: 320, level: move === 63 ? 100 : 50, moves: [move], itemId, abilityId: 70 }] } });
const rule = patchHarnessTrainer(project, trainer(150));
const harness = await black2CompatibilityHarness(rom, white2Reference, trainerId, rule);
await prepareBw2TestBattleCodeInjection(project); stageCodeInjectionDll(project, "BattleHarnessB2.dll", harness.bytes);
await writeFile(`${out}/harness-addresses.json`, JSON.stringify(harness.addresses, null, 2) + "\n");
const baseSave = new Uint8Array(await readFile(new URL("../../src/assets/testbattle/test.sav", import.meta.url)));
const cases = [], romHashes: Record<string, string> = {};
async function battleRom(move: number, itemId = 0) {
  const filename = `battle-${move}-${itemId}.nds`;
  if (!romHashes[filename]) {
    patchHarnessTrainer(project, trainer(move, itemId));
    const movesBefore = structuredClone(project.narcs.moves);
    // A survival check must not depend on Hyper Beam's ordinary miss chance.
    if (move === 63) { decodeRecord(project, "moves", 63).raw!.accuracy = 100; markDirty(project, "moves", 63); }
    const bytes = await exportModifiedRom(project, { forDsi: false });
    await writeFile(`${out}/${filename}`, bytes, { flag: "wx" }); romHashes[filename] = sha(bytes);
    project.narcs.moves = movesBefore;
  }
  return filename;
}
for (const [index, spec] of scenarios.entries()) {
  const fixture = patchHarnessSave(baseSave, project, parseHarnessConfig({ trainerId, player: { team: [{ speciesId: spec.species ?? 1, level: 50, moves: [spec.move ?? 150], itemId: spec.itemId, abilityId: 1, ...(spec.fullHp ? {} : { currentHp: 10 }) }] } }));
  const raw = decryptPk5Party(fixture.subarray(0x18e08, 0x18e08 + 220));
  const label = `${String(index).padStart(3, "0")}-${spec.label}`;
  await writeFile(`${out}/saves/${label}.sav`, fixture, { flag: "wx" });
  cases.push({ ...spec, label, speciesId: spec.species ?? 1, hp: readU16(raw, 0x8e), maxHp: readU16(raw, 0x90), saveSha256: sha(fixture), rom: await battleRom(spec.enemyMove ?? 150) });
}
const clientCases = [];
for (const [itemId, expected] of [[107, 4], [108, 0]]) {
  const label = `escape-trap-${expected ? "active" : "condition-fails"}`, filename = await battleRom(150, itemId);
  const fixture = patchHarnessSave(baseSave, project, parseHarnessConfig({ trainerId, player: { team: [{ speciesId: 1, level: 50, moves: [150], itemId: 0, abilityId: 23 }] } }));
  await writeFile(`${out}/${label}.sav`, fixture, { flag: "wx" });
  // The client runner expects a ROM with the same stem as its save.
  const bytes = new Uint8Array(await readFile(`${out}/${filename}`));
  await writeFile(`${out}/${label}.nds`, bytes, { flag: "wx" });
  clientCases.push({ label, itemId, expected, hook: dll.relocations.find(r => r.target.module === "167" && dll.symbols[r.sourceSymbolIndex].name === "RuleCanSwitch")!.target.address, sha256: sha(bytes), saveSha256: sha(fixture) });
}
await writeFile(`${out}/client-cases.json`, JSON.stringify({ openingHook: 0x0219f59a, commandHook: 0x021ceed8, cases: clientCases }, null, 2) + "\n");
await writeFile(`${out}/cases.json`, JSON.stringify({ version: "B2", inputSha256, exportSha256: sha(exported), projectReload: true, romExportReload: true, trainerNatureMigrated, editedItems: entries.size, directEditedItems: 3, codeBytes: dll.code.length, bssBytes: dll.bssSize, serializedBytes: dllBytes.length, api, pmcSymbols, symbols: Object.fromEntries(dll.symbols.filter(s => s.name?.startsWith("Rule") || s.name?.startsWith("ItemRule")).map(s => [s.name!, s.address])), hook: dll.relocations.find(r => r.target.module === "167" && dll.symbols[r.sourceSymbolIndex].name === "RuleDispatch")!.target.address, configHex: Buffer.from(encoded.bytes).toString("hex"), nativeOffsets: encoded.nativeEffects.map(e => e.offset), openingHook: 0x0219f59a, commandHook: 0x021ceed8, nativeObservationRange: [overlay.ramAddress, overlay.ramAddress + overlay.data.length], romHashes, cases }, null, 2) + "\n");
assert.equal(sha(new Uint8Array(await readFile(inputPath))), inputSha256);
console.log(`${cases.length} representative Black 2 battles and ${clientCases.length} native switching-query cases prepared; project/export/reload passed.`);
