import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeU16 } from "../../src/nds/binary";
import { NintendoDSRom } from "../../src/nds/rom";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { addRomFile } from "../../src/pokeweb/fileSystemModel";
import { configureLearnsetInfoDll, configureLearnsetViewerDll, installLearnsetViewer, readLearnsetUpperLayout } from "../../src/pokeweb/learnsetViewerModel";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";

const [input, artifacts, output] = process.argv.slice(2);
assert(input && artifacts && output, "Expected input ROM, prototype build asset directory, and output ROM.");
const bytes = new Uint8Array(await readFile(input));
const rom = new NintendoDSRom(bytes, { fileData: "view" });
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["message_texts"] });
const game = project.session.baseVersion;
assert(game === "W2" || game === "B2", "The tiled prototype requires a compatible US BW2 ROM.");

globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  const name = basename(url.pathname);
  try {
    const file = await readFile(new URL(`../../src/assets/codeinjection/${name}`, import.meta.url));
    return new Response(new Uint8Array(file));
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

const ids = await installLearnsetViewer(project, { upperLayout: "three-cards" });
const dllName = `LearnsetViewer${game}.dll`;
const viewer = await readFile(join(artifacts, dllName));
const config = viewer.indexOf("LSVMSG1\0");
assert(config >= 0 && config === viewer.lastIndexOf("LSVMSG1\0"));
const configured = configureLearnsetInfoDll(
  configureLearnsetViewerDll(new Uint8Array(viewer), ids),
  project.codeInjection!.learnsetViewer!.infoMessageIds!,
);
writeU16(configured, config + 22, 1);
assert.equal(readLearnsetUpperLayout(configured), "three-cards");
stageCodeInjectionDll(project, dllName, configured);

const path = "pokeweb/learnset-three-cards.narc";
if (rom.filenames.idOf(path) === undefined) {
  addRomFile(project, path, new Uint8Array(await readFile(join(artifacts, basename(path)))));
}
const result = await exportModifiedRom(project);
const exported = new NintendoDSRom(result, { fileData: "view" });
assert(exported.getFileByName(path).length > 0);
assert(Buffer.from(exported.getFileByName("a/1/2/5")).equals(Buffer.from(rom.getFileByName("a/1/2/5"))));
await writeFile(output, result, { flag: "wx" });
console.log(`Created ${basename(output)} with native Three Cards art.`);
