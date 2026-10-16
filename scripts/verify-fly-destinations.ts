// Source ROMs and saves remain untouched. An optional exported ROM uses a new path.
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { applyFlyDestinationEdit, getFlyDestinations, getFlyDestinationStatus } from "../src/pokeweb/flyDestinationModel";
import { createProjectDocument } from "../src/pokeweb/projectDocument";
import { openProjectSession } from "../src/pokeweb/projectSession";
import { stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { parseRpm } from "../src/pokeweb/rpm";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || (outputPath && resolve(sourcePath) === resolve(outputPath))) throw new Error("Use a source ROM and an optional separate output path.");
globalThis.fetch = (async input => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error(`Expected bundled local asset: ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const source = new Uint8Array(await readFile(sourcePath)), original = new NintendoDSRom(source, { fileData: "view" });
const project = await loadProjectFromRomBytes(source, basename(sourcePath), { selectedNarcs: ["headers", "town_map"] });
const status = getFlyDestinationStatus(project);
if (!status.compatible) throw new Error(status.message);
const entries = getFlyDestinations(project), route = entries.find(e => e.zone === 326)!, join = entries.find(e => e.zone === 490)!;
const originalHeaders = project.narcs.headers!.rawFiles[0].slice();
const originalTownMap = project.narcs.town_map!.rawFiles[0].slice();
const routeEdit = { enabled: true, visitFlag: 2501, x: 432, y: 0, z: 491 };
await applyFlyDestinationEdit(project, route.index, routeEdit);
await applyFlyDestinationEdit(project, join.index, { ...join.landing, enabled: false, visitFlag: join.visitFlag });
await applyFlyDestinationEdit(project, join.index, { x: 430, y: 0, z: 491, enabled: true, visitFlag: join.visitFlag });
const saved = openProjectSession(structuredClone(createProjectDocument(project, false)));
saved.originalRomBytes = source;
if (JSON.stringify(getFlyDestinations(saved)[route.index].landing) !== JSON.stringify({ x: 432, y: 0, z: 491 })) throw new Error("Saved project lost Route 4 coordinates.");
const output = await exportModifiedRom(saved), rom = new NintendoDSRom(output, { fileData: "view" });
const exportedHeaders = new NARC(rom.files[rom.filenames.idOf("a/0/1/2")!]).files[0];
if (Buffer.compare(originalHeaders, exportedHeaders)) throw new Error("Fly edits changed shared map-header defaults.");
for (const id of [33, 144]) {
  const before = original.loadArm9Overlays([id]).get(id)!.data, after = rom.loadArm9Overlays([id]).get(id)!.data;
  if (Buffer.compare(before, after)) throw new Error(`Raw overlay ${id} changed instead of using the runtime patch.`);
}
const reopened = await loadProjectFromRomBytes(output, "fly-destinations.nds", { selectedNarcs: ["headers", "town_map"] });
const after = getFlyDestinations(reopened);
if (!after[route.index].enabled || after[route.index].visitFlag !== 2501 || after[route.index].landing.x !== 432)
  throw new Error("Export/reimport lost Route 4 changes.");
if (!after[join.index].enabled || after[join.index].visitFlag !== join.visitFlag || after[join.index].landing.x !== 430)
  throw new Error("Export/reimport coupled Join Avenue to Route 4.");
if (!getFlyDestinationStatus(reopened).compatible || !getFlyDestinationStatus(reopened).installed)
  throw new Error("Reimport did not recognize its Fly runtime.");
const bytes = new NARC(rom.files[rom.filenames.idOf("a/0/8/5")!]).files[0];
if (bytes.length !== 85 * 54) throw new Error("Town Map count changed.");
for (let offset = 0; offset < bytes.length; offset++) {
  const row = Math.floor(offset / 54), fieldByte = offset % 54;
  if ((row === route.index || row === join.index) && [24, 25, 30, 31].includes(fieldByte)) continue;
  if (bytes[offset] !== originalTownMap[offset]) throw new Error("Town Map visuals or selection regions changed.");
}
const layout = original.idCode === "IRDO" ? { base: 0x0219cec0, hook: 0x0219d4ee, version: "W2" } : { base: 0x0219ce80, hook: 0x0219d4ae, version: "B2" };
const runtime = parseRpm(rom.files[rom.filenames.idOf(`patches/FlyDestinations${layout.version}.dll`)!], { allowedMagics: ["DLXF"] });
const hooks = runtime.relocations.filter(({ target }) => target.module !== "base");
if (runtime.metadata.PMCVersion !== "1.0.1" || hooks.length !== 2 || hooks.some(({ target }) => target.module === "144" && target.type !== "FULL_COPY"))
  throw new Error("Fly runtime changes Town Map visual code.");
const originalOverlay = rom.loadArm9Overlays([144]).get(144)!.data;
reopened.overlays[144] = originalOverlay.slice();
reopened.overlays[144]![layout.hook - layout.base] ^= 1;
if (getFlyDestinationStatus(reopened).compatible) throw new Error("Changed native code was accepted.");
delete reopened.overlays[144];
const conflicting = new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/FlyDestinations${layout.version}.dll`, import.meta.url)));
stageCodeInjectionDll(reopened, "ConflictingFly.dll", conflicting);
if (getFlyDestinationStatus(reopened).compatible) throw new Error("An overlapping DLL was accepted.");
console.log(`${original.idCode}: install, repeated edits, project save, ROM export/reimport, independent arrivals and unchanged headers/overlays/Town Map visuals/hit regions passed.`);
console.log(`${original.idCode}: changed native code and overlapping DLL were rejected.`);
if (outputPath) { await writeFile(outputPath, output, { flag: "wx" }); console.log(`Created ${outputPath}`); }
