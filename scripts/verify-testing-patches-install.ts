// Read-only source ROM check; optional output always uses a separate path.
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { TESTING_PATCHES, getTestingPatchStatus, installTestingPatch, type TestingPatchId } from "../src/pokeweb/testingPatchesModel";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("Usage: vite-node scripts/verify-testing-patches-install.ts input.nds [separate-output.nds]");
if (outputPath && resolve(inputPath) === resolve(outputPath)) throw new Error("Output must be a separate ROM.");
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error(`Expected local asset: ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const source = new Uint8Array(await readFile(inputPath));
const original = new NintendoDSRom(source);
const project = await loadProjectFromRomBytes(source, basename(inputPath), { selectedNarcs: [] });
const ids = Object.keys(TESTING_PATCHES) as TestingPatchId[];
for (const id of ids) {
  const status = getTestingPatchStatus(project, id);
  if (!status.compatible) throw new Error(`${id}: ${status.message}`);
  await installTestingPatch(project, id);
  await installTestingPatch(project, id);
}
const bytes = await exportModifiedRom(project);
const exported = new NintendoDSRom(bytes);
for (const ov of [36, 167, 169]) {
  const before = original.loadArm9Overlays([ov]).get(ov)!.data;
  const after = exported.loadArm9Overlays([ov]).get(ov)!.data;
  if (Buffer.compare(before, after)) throw new Error(`Native overlay ${ov} changed`);
}
const reimported = await loadProjectFromRomBytes(bytes, "White2-Debug-QoL.nds", { selectedNarcs: [] });
for (const id of ids) {
  const status = getTestingPatchStatus(reimported, id);
  if (!status.installed || !status.compatible) throw new Error(`${id}: ${status.message}`);
  console.log(`${id}: install, idempotence, export and reimport passed`);
}
if (outputPath) { await writeFile(outputPath, bytes, { flag: "wx" }); console.log(`Created ${outputPath}`); }
