import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../../src/pokeweb/loader";
import { exportModifiedRom } from "../../../src/pokeweb/exportRom";
import { NintendoDSRom } from "../../../src/nds/rom";
import { installPmcBytes, loadBundledPmcBytes } from "../../../src/pokeweb/pmcModel";
import { installCodeInjectionPatch } from "../../../src/pokeweb/codeInjectionInstall";
import { adaptSaveForProject, stageItemExpansion } from "../../../src/pokeweb/itemExpansionModel";
import { detectSaveFormat } from "../../../src/pokeweb/itemSaveFormat";

const [input, output, mode, fixture] = process.argv.slice(2);
assert(input && output && (!mode || mode === "--item-expansion"),
  "Expected CLEAN_US_W2.nds BASELINE.nds [--item-expansion [RETAIL_TEST.sav]]");
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
};
const source = new Uint8Array(await readFile(input));
const rom = new NintendoDSRom(source, { fileData: "view" });
assert.equal(rom.idCode, "IRDO");
assert.equal(rom.data[30], 0);
assert.equal(rom.arm9OverlayTable.length / 32, 344);
const project = await loadProjectFromRomBytes(source, "five-box-control.nds", {
  selectedNarcs: ["moves", "personal", "items", "message_texts"],
});
const loader = await loadBundledPmcBytes(project.session.baseVersion, rom.idCode, 220);
const installed = installPmcBytes(project, loader, source);
if (mode === "--item-expansion") await installCodeInjectionPatch(project, stageItemExpansion);
const saved = fixture ? adaptSaveForProject(project, new Uint8Array(await readFile(fixture))) : undefined;
if (saved) {
  assert(mode && output.endsWith(".nds") && detectSaveFormat(saved) === "expanded",
    "Expected a retail test save or a matching expanded test save");
}
await writeFile(output, await exportModifiedRom(project, { forDsi: false }), { flag: "wx" });
if (saved) await writeFile(output.replace(/\.nds$/u, ".sav"), saved, { flag: "wx" });
console.log(JSON.stringify(installed));
