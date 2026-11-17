/** In-memory native battle fixtures. Build with ABILITY_FORM_CONVERSION_TEST=1 for observation. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, CURRENT_ABILITY_RUNTIME_VERSION } from "../../src/pokeweb/abilityEffectsModel";
import { ABILITY_RULE_PRESETS, validateAbilityRule } from "../../src/pokeweb/abilityRules";
import { abilityImport } from "../../src/pokeweb/abilityLibrary";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import { buildTestBattleDownloads, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { runLoggedBattleBytes } from "./battle_log_runner";
import { ABILITY_ZEN_MODE_MESSAGES } from "../../src/pokeweb/abilityBattleMessages";
import { getTextBank, parseTextEntryId } from "../../src/pokeweb/textModel";

const [path, which = "field"] = process.argv.slice(2);
const cases = ["field", "holder", "duplicate", "heal", "suppression", "swap", "invalid", "same-type", "pixilate", "roundtrip"];
if (!path || !cases.includes(which)) throw Error(`Usage: ROM.nds [${cases.join("|")}]`);
globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "file:") throw Error("Only local fixture assets are supported.");
    return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "form-conversion.nds",
    { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
const project = await load(new Uint8Array(await readFile(path)));
const game = project.session.baseVersion;
const zenId = 165, auraId = 166, zenName = "Astral Shift";
const zen = structuredClone(ABILITY_RULE_PRESETS.find(p => p.id === 161)!.rule);
zen.effects[0].value = 70;
zen.effects[0].parameters = { species: 386, sourceForm: 0, targetForm: which === "invalid" ? 31 : 3 };
const aura = structuredClone(abilityImport(which === "pixilate" ? 182 : 184).rule);
if (which === "pixilate") {
    assert.ok(project.session.fairy, "Pixilate requires a Fairy-enabled ROM.");
    aura.effects[0].value = 2.5;
}
aura.effects[0].parameters = { ...aura.effects[0].parameters, scope: which === "holder" ? 0 : 1 };
const rules = new Map([[zenId, validateAbilityRule(zen)], [auraId, validateAbilityRule(aura)]]);
await configureAbilityRuleSets(project, [...rules].map(([abilityId, rules]) => ({ abilityId, rules, name: abilityId === zenId ? "Mystic Shift" : "Aerilate" })));
await configureAbilityRuleSets(project, [{ abilityId: zenId, rules: rules.get(zenId)!, name: zenName }]);
assert.deepEqual(inspectAbilityEffects(project).rules, rules);
const scriptedMoves: Record<string, number[]> = { heal: [33, 105], "same-type": [16, 33], swap: [33, 285] };
const moves = scriptedMoves[which] ?? [33];
const turns = which === "heal" || which === "swap" ? 3 : 2;
const player = { speciesId: 386, level: 50, moves, currentHp: 75,
    abilityId: which === "duplicate" ? auraId : zenId };
const enemy = { speciesId: 320, level: which === "pixilate" ? 65 : 40,
    moves: [which === "suppression" ? 380 : 33], abilityId: auraId };
patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType: "Singles", trainer: { ai: 0, team: [enemy] } }));
const downloads = await buildTestBattleDownloads(project, 2);
const reopened = await load(downloads.romBytes);
assert.deepEqual(inspectAbilityEffects(reopened).rules, rules);
assert.equal(inspectAbilityEffects(reopened).runtimeVersion, CURRENT_ABILITY_RUNTIME_VERSION);
const standardBanks = project.session.baseRom === "BW" ? [15] : [19, 17];
const textIds = standardBanks.map(bank => ABILITY_ZEN_MODE_MESSAGES.map(message => {
    const matches = getTextBank(reopened, "message_texts", bank).filter(([, text]) => text === message);
    assert.equal(matches.length, 1, "Named battle text must survive export without duplicate entries.");
    return parseTextEntryId(matches[0][0]).entry;
}));
for (const ids of textIds) assert.deepEqual(ids, textIds[0], "Standard battle message banks must use the same IDs.");
if (which === "roundtrip") {
    console.log(game, "production ROM export and reload passed");
    process.exit(0);
}
const raw = patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes), project,
    parseHarnessConfig({ trainerId: 2, player: { team: [player] } }));
const expectedTexts = which === "heal" || which === "swap" ? [`${zenName} triggered!`, `${zenName} ended!`]
    : ["field", "holder", "same-type"].includes(which) ? [`${zenName} triggered!`] : [];
const { entries, seenTexts } = await runLoggedBattleBytes(downloads.romBytes, raw,
    { menuCount: turns, ...(moves.length > 1 ? { turnMove: [0, 1, 0] } : {}) },
    { tag: "FMCT", frames: 7700, shots: false, logCapacity: 48, texts: expectedTexts });
console.log(game, which, JSON.stringify({ seenTexts, entries }));
const power = (id: number, move = 33) => entries.filter(e => e.event === 0x38 && e.a === id && e.move === move);
const type = which === "pixilate" ? 17 : 2;
const ratio = Math.round(aura.effects[0].value * 4096);
assert.ok(power(0).length, "Player must complete a damage calculation.");
assert.ok(power(0).every(e => e.x === (which === "holder" ? 0 : type) && e.value === (which === "holder" ? 4096 : ratio)), "Wrong type or power for player.");
if (which !== "suppression") {
    const opponent = entries.find(e => e.event === 3 && e.a !== 0)?.a ?? -1;
    assert.ok(power(opponent).length, "Opponent must complete a damage calculation.");
    assert.ok(power(opponent).every(e => e.x === type && e.value === ratio), "Wrong type or power for opponent.");
}
if (which === "same-type") {
    const gust = power(0, 16);
    assert.ok(gust.length && gust.every(e => e.x === 2 && e.value === 4096), "Gust should stay Flying at its original power.");
}
const forms = entries.filter(e => e.event === 3 && e.a === 0).map(e => e.y);
assert.deepEqual(seenTexts.sort(), expectedTexts.sort(), "The battle client must render the renamed ability in its text.");
if (which === "field" || which === "holder") assert.ok(forms.slice(1).includes(3), "Zen form never reached.");
if (which === "invalid" || which === "suppression") assert.ok(forms.every(form => form === 0), "Form changed unexpectedly.");
if (which === "heal" || which === "swap") {
    assert.deepEqual(forms.slice(0, 2), [0, 3]);
    const shifts = entries.filter(e => e.event === 0xfa && e.a === 0);
    assert.deepEqual(shifts.slice(0, 2).map(e => e.y), [3, 0]);
    assert.ok(shifts.every(e => e.value === zenId));
}
