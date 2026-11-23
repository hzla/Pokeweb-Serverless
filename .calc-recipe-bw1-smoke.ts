import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "./src/pokeweb/loader";
import { generateCalcBridgePayload } from "./src/pokeweb/docGeneratorModel";
import { configureAbilityRuleSets } from "./src/pokeweb/abilityEffectsModel";
import { configureItemRuleSets, updateItemEffectControl } from "./src/pokeweb/itemEffectsModel";
import { configureMoveRuleSets } from "./src/pokeweb/moveEffectsModel";
import { createTrainerFieldTable, writeTrainerFieldTable, TRAINER_FIELD_CONDITIONS_PATH } from "./src/pokeweb/trainerFieldConditionsModel";
import { MOVE_ALWAYS, newMoveEffect } from "./src/pokeweb/moveRules";
globalThis.fetch = async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
};
const rom = await readFile(process.argv[2]);
const project = await loadProjectFromRomBytes(rom, "calc-smoke.nds", {selectedNarcs: ["moves", "items", "personal", "trdata", "trpok", "message_texts"]});
const always = {kind: "group" as const, mode: "all" as const, children: []};
await configureAbilityRuleSets(project, [{abilityId: 65, rules: {conditions: always,
  effects: [{kind: "nativeAbility:65", value: -1, parameters: {type: 10, hpThreshold: 50, power: 2}}]}}]);

await configureItemRuleSets(project, [{itemId: 238, rules: {conditions: always, consumable: false,
  effects: [{kind: "defense", value: 1.5}]}}]);
await configureMoveRuleSets(project, [{moveId: 33, rules: {conditions: MOVE_ALWAYS, prerequisites: MOVE_ALWAYS,
  effects: [{...newMoveEffect(), value: 1.5}]}}]);
const {scriptText} = generateCalcBridgePayload(project, "Calc v1 smoke");
const output = JSON.parse(scriptText.slice(scriptText.indexOf("{"), -1));
const {abilities, items, moves, warnings} = output.pokewebBattleRules;
assert(!warnings?.length, JSON.stringify(warnings));
assert.equal(abilities.find(([id]) => id === 65)[1].effects[0].parameters.power, 2);

assert.equal(items.find(([id]) => id === 238)[1].effects[0].value, 1.5);
assert.equal(moves.find(([id]) => id === 33)[1].effects[0].value, 1.5);
await writeFile(process.argv[3], JSON.stringify(output));
console.log(JSON.stringify({abilities: abilities.length, items: items.length, moves: moves.length}));
