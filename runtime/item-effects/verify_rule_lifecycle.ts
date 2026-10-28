/** Check removal, native restoration and corrupt-module rejection on an export. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { assignItemEffect, clearItemRules, configureItemRuleSets, inspectItemEffect, ITEM_EFFECTS_DLL_PATH } from "../../src/pokeweb/itemEffectsModel";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { parseRpm, writeRpm } from "../../src/pokeweb/rpm";
import { getTestBattlePersonal } from "../../src/pokeweb/testBattleTeam";
import { setRomFileReplacement } from "../../src/pokeweb/fileSystemModel";

const [directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: vite-node runtime/item-effects/verify_rule_lifecycle.ts EVIDENCE_DIRECTORY");
const manifest = JSON.parse(await readFile(`${directory}/cases.json`, "utf8"));
const input = new Uint8Array(await readFile(`${directory}/rules-100.nds`));
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "rules-lifecycle.nds", { selectedNarcs: ["items", "personal"] });
let project = await load(input);
const rom = new NintendoDSRom(input, { fileData: "view" }), id = rom.fileId(ITEM_EFFECTS_DLL_PATH);
const original = rom.files[id], rpm = parseRpm(original, { allowedMagics: ["DLXF"] });
const entries = new Map<number, any>(JSON.parse(String(rpm.metadata.PokewebItemRules)));
assert.equal(entries.size, 100);
for (const [itemId, rules] of entries) { const state = inspectItemEffect(project, itemId); assert.equal(state.editable, true, state.message); assert.deepEqual(state.rules, rules); }
// Store ROM-derived types for the independent, per-turn condition oracle.
for (const spec of manifest.cases) {
  const { raw } = getTestBattlePersonal(project, spec.speciesId);
  spec.holderTypes = [Number(raw.type_1), Number(raw.type_2)];
}
await writeFile(`${directory}/cases.json`, JSON.stringify(manifest, null, 2) + "\n");
assert.throws(() => assignItemEffect(project, 85, 234), /without a native/);
clearItemRules(project, 85);
assert.equal(inspectItemEffect(project, 85).rules, undefined);
assignItemEffect(project, 238, 234);
assert.equal(inspectItemEffect(project, 238).rules, undefined);
assert.equal(inspectItemEffect(project, 238).profileId, 234);
for (const [itemId, rules] of entries) if (![85, 238].includes(itemId)) assert.deepEqual(inspectItemEffect(project, itemId).rules, rules);
for (const name of Object.keys(project.narcs)) delete project.narcs[name as keyof typeof project.narcs];
const restored = await exportModifiedRom(project, { forDsi: false });
project = await load(restored);
assert.equal(inspectItemEffect(project, 85).rules, undefined);
assert.equal(inspectItemEffect(project, 238).profileId, 234);
assert.deepEqual(inspectItemEffect(project, 234).rules, entries.get(234));
for (const itemId of entries.keys()) clearItemRules(project, itemId);
const retired = project.fileSystem?.replacements[id];
assert.deepEqual(retired, Uint8Array.of(0x50, 0x57, 0x49, 0x52));
// A syntactically valid but altered native image must fail before any edit.
project = await load(input);
rpm.code[0] ^= 1;
setRomFileReplacement(project, id, writeRpm(rpm, { ident: "DLXF" }));
assert.equal(inspectItemEffect(project, 85).editable, false);
await assert.rejects(configureItemRuleSets(project, [{ itemId: 85, rules: entries.get(85) }]), /modified/);
await writeFile(`${directory}/lifecycle.json`, JSON.stringify({ editedItems: 100, slotlessRemoval: true, nativeRestoration: true, remainingRulesPreserved: 98, removalExportReload: true, lastRuleRetiresDll: true, modifiedModuleRejected: true }, null, 2) + "\n");
console.log("Rule lifecycle passed: remove, restore, export/reload, retire, reject modified DLL.");
