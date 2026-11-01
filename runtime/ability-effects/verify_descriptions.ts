/** Check native resources, text editing and ROM round trips on an explicitly supplied ROM. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { getAbilityDescription, updateAbilityDescription } from "../../src/pokeweb/abilityTextModel";
import { createCustomAbility } from "../../src/pokeweb/abilityEffectsModel";
import { getMoveTextInfo, updateMoveDescription } from "../../src/pokeweb/moveTextModel";
import { loadDescriptionAssets, renderDescriptionPreview } from "../../src/pokeweb/descriptionPreview";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { NintendoDSRom } from "../../src/nds/rom";
import { ensureFileSystemState } from "../../src/pokeweb/fileSystemModel";

const [input, output] = process.argv.slice(2); assert(input && output, "Usage: ROM.nds NEW_OUTPUT_DIRECTORY [--no-roms]");
await mkdir(output, { recursive: true });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw Error("Only local assets permitted");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const source = new Uint8Array(await readFile(input));
const load = (data: Uint8Array) => loadProjectFromRomBytes(data, "preview.nds", { selectedNarcs: ["moves", "personal", "message_texts"] });
let project = await load(source);
const assets = await loadDescriptionAssets(project);
assert.strictEqual(await loadDescriptionAssets(project), assets, "Reuse parsed assets across opened descriptions");
for (const [kind, text, name] of [["move", getMoveTextInfo(project, 242)!.description, "Crunch"], ["ability", getAbilityDescription(project, 86), "Simple"]] as const) {
  const result = renderDescriptionPreview(assets, kind, text, name);
  assert.deepEqual(result.warnings, []);
  const png = new PNG({ width: result.width, height: result.height }); png.data.set(result.rgba);
  await writeFile(`${output}/${kind}.png`, PNG.sync.write(png));
}
const rom = new NintendoDSRom(source, { fileData: "view" }), fontId = rom.fileId("a/0/2/3"), fs = ensureFileSystemState(project);
fs.replacements[fontId] = rom.files[fontId].slice();
assert.notStrictEqual(await loadDescriptionAssets(project), assets, "Replacing a resource invalidates the cache");
delete fs.replacements[fontId];
updateAbilityDescription(project, 1, "Pokémon gain power.\nWhen it rains.");
updateMoveDescription(project, 242, "An edited description.\nSecond line.\nThird line.");
const created = await createCustomAbility(project, "Preview Test", { effects: [{ kind: "speed", value: 1.2 }], conditions: { kind: "group", mode: "all", children: [] } }, "Custom Pokémon power.\nTwo lines.");
const exported = await exportModifiedRom(project, { forDsi: false });
if (!process.argv.includes("--no-roms")) await writeFile(`${output}/descriptions.nds`, exported);
project = await load(exported);
assert.equal(getAbilityDescription(project, 1), "Pokémon gain power.\\nWhen it rains.");
assert.equal(getMoveTextInfo(project, 242)!.description, "An edited description.\\nSecond line.\\nThird line.");
if (created) { assert.equal(project.texts.banks.abilities![created], "Preview Test"); assert.equal(getAbilityDescription(project, created), "Custom Pokémon power.\\nTwo lines."); }
updateAbilityDescription(project, 1, "Edited again.");
project = await load(await exportModifiedRom(project, { forDsi: false }));
assert.equal(getAbilityDescription(project, 1), "Edited again.");
console.log(JSON.stringify({ game: project.session.baseVersion, resourceCache: true, exportReload: true, reedit: true, customAbility: created }));
