// Isolated native smoke test; bundled save data exists only in emulator memory.
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { studioFixture } from "../src/test/fixtures/mapStudio";
import { openStudioWorkspace } from "../src/pokeweb/mapStudioFormats";
import { readStudioBuildingSource } from "../src/pokeweb/mapStudioBuildings";
import { compileStudioChunk } from "../src/pokeweb/mapStudioCompiler";
import { prepareGen5MapImport, applyGen5MapImport } from "../src/pokeweb/gen5MapImport";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { loadMap3dZone } from "../src/pokeweb/map3dModel";
import { buildQuickLaunchDownloads, loadTestBattleSave, getTestBattleConfigForProject, toDesmumeDsv } from "../src/pokeweb/testBattle";
import { patchOverworldTestWarpEvent, patchOverworldTestWarpSave } from "../src/pokeweb/testOverworldWarp";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
const sourcePath = process.argv[2], output = process.argv[3];
if (!sourcePath || !output) throw new Error("Pass a local US White 2 ROM and a temporary output directory.");
await fs.mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await fs.readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(sourcePath)), "map-studio-smoke.nds", { selectedNarcs: ["headers", "maps"] });
let ws = studioFixture(), chunk = 0, layer = 0;
if (process.argv[4]) {
  const directory = process.argv[4], names = (await fs.readdir(directory)).filter(n => !n.startsWith(".")), files: Record<string, Uint8Array> = {};
  for (const name of names) files[name] = new Uint8Array(await fs.readFile(`${directory}/${name}`));
  ws = openStudioWorkspace(files); Object.assign(ws.files, readStudioBuildingSource(ws, new Uint8Array(await fs.readFile(process.argv[5]))));
  chunk = ws.map.chunks.findIndex(c => c.x === Number(process.argv[6] ?? 40) && c.y === Number(process.argv[7] ?? 7)); layer = -1;
} else {
  const c = ws.map.chunks[0]; c.tiles[0].fill(0);
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) c.heights[0][y * 32 + x] = 2;
}
const scene = await loadMap3dZone(project, 427), selected = scene.chunks[0];
const input = compileStudioChunk(ws, chunk, layer, "BW2");
const imported = await prepareGen5MapImport(project, input, { matrixId: scene.sourceMatrixId, x: selected.matrixX, y: selected.matrixY, headerId: 427, season: "spring" });
await applyGen5MapImport(project, imported);
const view = new DataView(input.permissions.buffer, input.permissions.byteOffset), spawn = layer === -1 ? Array.from({ length: 1024 }, (_, i) => i)
  .filter(i => !(view.getUint16(10 + i * 8, true) & 3)).sort((a, b) => Math.hypot(a % 32 - 16, Math.floor(a / 32) - 16) - Math.hypot(b % 32 - 16, Math.floor(b / 32) - 16))[0] : 8 * 32 + 8;
if (spawn === undefined) throw new Error("The source chunk has no walkable spawn tile.");
const target = { zoneId: 427, gridX: selected.matrixX * 32 + spawn % 32, gridZ: selected.matrixY * 32 + Math.floor(spawn / 32) };
const [downloads, fixture] = await Promise.all([buildQuickLaunchDownloads(project), loadTestBattleSave(getTestBattleConfigForProject(project))]);
const rom = new NintendoDSRom(downloads.romBytes, { fileData: "view" }), headers = new NARC(rom.getFileByName("a/0/1/2")).files[0];
const eventsId = rom.fileId("a/1/2/6"), events = new NARC(rom.files[eventsId]);
const origin = new DataView(headers.buffer, headers.byteOffset).getUint16(fixture.zoneId * 48 + 22, true);
events.files[origin] = patchOverworldTestWarpEvent(events.files[origin], fixture, target);
const romBytes = rom.save({ files: new Map([[eventsId, events.save()]]), preserveOriginalLength: false }), save = toDesmumeDsv(patchOverworldTestWarpSave(fixture.rawSaveBytes, target));
console.log(JSON.stringify({ target, mapId: imported.mapId, stage: "native emulator" }));
const url = new URL("../public/desmond/desmond.js", import.meta.url), source = await fs.readFile(url, "utf8");
let ready!: () => void; const initialized = new Promise<void>(resolve => ready = resolve), fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const context = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../public/desmond", import.meta.url)), __filename: fileURLToPath(url), console: { log, info: log, warn: log, error: log, debug: log } });
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), context); await initialized; const core = context.Module;
core._main(0, 0); const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]), pointer = core._prepareRomBuffer(size);
core.HEAPU8.set(romBytes, pointer); core.HEAPU8.fill(255, pointer + romBytes.length, pointer + size); core.HEAPU8.set(save, core._savGetPointer(save.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("Emulator rejected ROM.");
for (let frame = 0; frame < 1800; frame++) {
  core._runFrame(1, frame >= 900 && frame < 930 ? 4 : 0, 0, 0, 0);
  if (frame === 1200 || frame === 1799) { const png = new PNG({ width: 256, height: 384 }), at = core._getSymbol(4) >>> 0; png.data = Buffer.from(core.HEAPU8.subarray(at, at + 256 * 384 * 4)); await fs.writeFile(`${output}/frame-${frame}.png`, PNG.sync.write(png)); console.log(JSON.stringify({ frame, fatal })); }
}
if (fatal.length) throw new Error(fatal.join("\n"));
console.log("Emulator completed; inspect the captured terrain and player before claiming visual verification.");
