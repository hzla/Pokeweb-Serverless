/** Verify native composition against an explicitly supplied ROM, locally. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureItemRuleSets, inspectItemEffect, ITEM_EFFECTS_DLL_PATH } from "../../src/pokeweb/itemEffectsModel";
import { ITEM_RULE_EFFECTS, validateItemRule } from "../../src/pokeweb/itemRules";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { NintendoDSRom } from "../../src/nds/rom";
import { parseRpm } from "../../src/pokeweb/rpm";
const [input, out] = process.argv.slice(2);
if (!out) throw new Error("Usage: INPUT.nds OUTPUT_DIRECTORY");
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets are permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
await mkdir(out, { recursive: true });
const bytes = new Uint8Array(await readFile(input));
const load = (data: Uint8Array) => loadProjectFromRomBytes(data, "native-items.nds", { selectedNarcs: ["items"] });
let project = await load(bytes);
const edits = ITEM_RULE_EFFECTS.filter(d => d.nativeItem).map((definition, index) => ({ itemId: 85 + index,
  rules: validateItemRule({ effects: [{ kind: definition.kind, value: -1 }], conditions: { kind: "group", mode: "all", children: [] }, consumable: false }) }));
await configureItemRuleSets(project, edits);
for (const edit of edits) assert.deepEqual(inspectItemEffect(project, edit.itemId).rules, edit.rules, inspectItemEffect(project, edit.itemId).message);
for (const name of Object.keys(project.narcs)) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/native-items.nds`, exported);
project = await load(exported);
for (const edit of edits) assert.deepEqual(inspectItemEffect(project, edit.itemId).rules, edit.rules, inspectItemEffect(project, edit.itemId).message);
const rom = new NintendoDSRom(exported, { fileData: "view" }), rpm = parseRpm(rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
console.log(JSON.stringify({ items: edits.length, code: rpm.code.length, bss: rpm.bssSize, dll: rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)].length, exportReload: true }));
