/** Validate an in-memory export using the instrumented ability runtime template. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { configureAbilityRuleSets, CURRENT_ABILITY_RUNTIME_VERSION, inspectAbilityEffects } from "../../src/pokeweb/abilityEffectsModel";
import { validateAbilityRule, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import type { AbilityConditionSubject, ItemRuleCondition } from "../../src/pokeweb/itemRules";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildTestBattleDownloads, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { NintendoDSRom } from "../../src/nds/rom";
import { addDoubleTrainerPartner, runLoggedBattleBytes } from "./battle_log_runner";

const [path, mode] = process.argv.slice(2);
if (!path || !["Singles", "Doubles"].includes(mode)) throw Error("Usage: ROM.nds Singles|Doubles");
const battleType = mode as "Singles" | "Doubles";
globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "file:") throw Error("Only local fixture assets are supported.");
    return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;

const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "effect-conditions.nds",
    { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
const group = (mode: "all" | "any", children: ItemRuleCondition[], scope?: "anyOpponent"): ItemRuleCondition => ({ kind: "group", mode, children, scope });
const type = (value: number, subject?: AbilityConditionSubject, negate = false): ItemRuleCondition => ({ kind: "type", subject, value, negate });
const move = (value: number, subject?: AbilityConditionSubject, negate = false): ItemRuleCondition => ({ kind: "knowsMove", subject, value, negate });
const power = (value: number, conditions: ItemRuleCondition): AbilityRuleSet["effects"][number] => ({ kind: "ability:power", value, conditions });
const hp = (comparison: "gt" | "lte", percent = 50): ItemRuleCondition => ({ kind: "hp", comparison, percent });

const doubles = battleType === "Doubles";
const lowHp = process.env.ABILITY_CONDITIONS_LOW_HP === "1";
const abilityId = 165, tackle = 33, splash = 150, swift = 129, fire = 9, water = 10, electric = 12;
const rules = validateAbilityRule({
    conditions: hp("gt", 0),
    effects: [
        power(1.5, group("all", [group("any", [type(electric), move(splash)]), hp("gt")])),
        power(4, hp("lte")),
        power(1.25, group("all", [move(tackle), type(fire, "holder", true)])),
        power(2, group("all", [type(fire, "opponent"), move(splash, "opponent")])),
        power(1.25, move(tackle, "anyOpponent")),
        power(1.25, group("all", [type(water, "anyOpponent"), move(tackle, "anyOpponent")], "anyOpponent")),
        // Fire and Tackle exist on separate foes in doubles. Neither foe meets both checks.
        power(4, group("all", [type(fire, "anyOpponent"), move(tackle, "anyOpponent")], "anyOpponent")),
        { kind: "abilityRecipe:statAction", value: 1, parameters: { stat: 2 }, conditions: type(fire, "anyOpponent") },
        { kind: "ability:damageTaken", value: .5, conditions: type(water, "opponent") },
    ],
});
const input = new Uint8Array(await readFile(path));
const project = await load(input);
await configureAbilityRuleSets(project, [{ abilityId, rules, name: "Split Effects" }]);
const fighter = { speciesId: 25, level: 50, moves: [swift, tackle], pp: [20, 0, 0, 0], currentHp: lowHp ? 40 : 90, abilityId };
const foe1 = { speciesId: 6, level: 65, moves: [splash], abilityId: 66 };
const foe2 = { speciesId: 9, level: 55, moves: [tackle], abilityId: 67 };
const trainerId = 2;
patchHarnessTrainer(project, parseHarnessConfig({ trainerId, battleType, trainer: { ai: 0, team: doubles ? [foe1, foe2] : [foe1] } }));
const downloads = await buildTestBattleDownloads(project, trainerId);
let reopened = await load(downloads.romBytes);
const state = inspectAbilityEffects(reopened);
assert.equal(state.editable, true, state.message);
assert.equal(state.runtimeVersion, CURRENT_ABILITY_RUNTIME_VERSION);
assert.deepEqual(state.rules.get(abilityId), rules);
const edited = validateAbilityRule({ ...rules, effects: rules.effects.map((e, i) => i === 0 ? { ...e, value: 1.75 } : e) });
await configureAbilityRuleSets(reopened, [{ abilityId, rules: edited }]);
assert.deepEqual(inspectAbilityEffects(reopened).rules.get(abilityId), edited);
const second = await buildTestBattleDownloads(reopened, trainerId);
reopened = await load(second.romBytes);
assert.deepEqual(inspectAbilityEffects(reopened).rules.get(abilityId), edited);
console.log(project.session.baseVersion, mode, "export, reopen, edit and re-export passed");

if (process.env.ABILITY_CONDITIONS_ROM_ONLY === "1") process.exit(0);
const raw = patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes), project,
    parseHarnessConfig({ trainerId, battleType, player: { team: doubles ? [fighter, { speciesId: 35, level: 25, moves: [splash], abilityId: 56 }] : [fighter] } }));
const manualDouble = doubles && project.session.baseVersion !== "W2";
const battleRom = manualDouble ? addDoubleTrainerPartner(downloads.romBytes, new NintendoDSRom(input,{fileData:"view"}), raw, project.session.baseRom, trainerId) : downloads.romBytes;
const { entries } = await runLoggedBattleBytes(battleRom, raw, { menuCount: 1, battleType },
    { tag: "CSTL", frames: 7900, shots: false, logCapacity: 128 });
const starts = entries.filter(e => e.event === 3);
const fireId = starts.find(e => e.a !== 0 && e.move === splash && e.value === 66)?.a;
const waterId = starts.find(e => e.a !== 0 && e.move === tackle && e.value === 67)?.a;
const hits = entries.filter(e => e.a === 0 && e.move === swift && e.event === 0x4b);
const ratios = entries.filter(e => e.a === 0 && e.move === swift && e.event === 0x38);
console.log(JSON.stringify({ starts: starts.slice(0, doubles ? 4 : 2), hits, ratios }));
assert.notEqual(fireId, undefined, "Fire opponent never acted.");
assert.ok(!doubles || waterId !== undefined, "Water opponent never acted.");
const holderFactor = (lowHp ? 4 : 1.5) * 1.25;
const expected = new Map([[fireId, 4096 * holderFactor * 2 * (doubles ? 1.25 * 1.25 : 1)]]);
if (doubles) expected.set(waterId, 4096 * holderFactor * 1.25 * 1.25);
for (const [id, ratio] of expected) {
    const targetRatios = ratios.filter(e => e.d === id);
    assert.ok(targetRatios.length && targetRatios[0].value === ratio, `Opponent ${id} expected power ratio ${ratio}.`);
    assert.ok(hits.some(e => e.d === id && e.value > 0), `Opponent ${id} took no damage.`);
}
console.log(project.session.baseVersion, mode, "live power ratios and damage passed");
