/** Author rule fixtures through the same model as the GUI, then export/reload. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../../src/nds/rom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureItemRuleSets, hydrateItemEffectsSource, inspectItemEffect, ITEM_EFFECTS_DLL_PATH } from "../../src/pokeweb/itemEffectsModel";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { parseRpm } from "../../src/pokeweb/rpm";
import { type ItemRuleSet } from "../../src/pokeweb/itemRules";

const [path, directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: vite-node runtime/item-effects/verify_rules.ts ROM.nds OUTPUT_DIRECTORY");
const out = resolve(directory), input = new Uint8Array(await readFile(path));
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
await mkdir(out, { recursive: true });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets are permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (data: Uint8Array) => loadProjectFromRomBytes(data, "item-rule-validation.nds", { selectedNarcs: ["items", "personal", "moves", "trdata", "trpok", "message_texts"] });
let project = await load(input);
const rules: ItemRuleSet = { effects: [{ kind: "attack", value: 2.5 }, { kind: "healDivisor", value: 16 }],
  conditions: { kind: "group", mode: "any", children: [{ kind: "hp", comparison: "lt", percent: 50 }, { kind: "type", value: 5 }] }, consumable: false };
await configureItemRuleSets(project, [{ itemId: 238, rules }, { itemId: 85, rules: { ...rules, consumable: true } }]);
assert.deepEqual(inspectItemEffect(project, 238).rules, { ...rules, conditions: { ...rules.conditions, children: [{ kind: "hp", comparison: "lt", percent: 50 }, { kind: "type", value: 5, negate: false }] } });
project = openProjectSession(createProjectDocument(project, false));
project.originalRomBytes = input; hydrateItemEffectsSource(project, new NintendoDSRom(input, { fileData: "view" }));
assert.equal(inspectItemEffect(project, 238).rules?.effects[0].value, 2.5);
for (const name of Object.keys(project.narcs)) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/rules.nds`, exported, { flag: "wx" });
project = await load(exported);
assert.equal(inspectItemEffect(project, 238).rules?.effects[0].value, 2.5);
assert.equal(inspectItemEffect(project, 85).rules?.consumable, true);
assert.equal(inspectItemEffect(project, 85).nativeSlot, false);
const rom = new NintendoDSRom(exported, { fileData: "view" }), dll = parseRpm(rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
await writeFile(`${out}/report.json`, JSON.stringify({ inputSha256: sha(input), exportSha256: sha(exported), projectReload: true, romExportReload: true,
  codeBytes: dll.code.length, nativeHook: dll.relocations.filter(r => r.target.module === "167"), rules: dll.metadata.PokewebItemRules }, null, 2));
console.log(`Rule export/reload passed; runtime ${dll.code.length} bytes, slotless item supported.`);
