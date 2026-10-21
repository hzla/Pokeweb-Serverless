/** Isolated ROM smoke test; a bundled save is copied only into emulator memory. */
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { loadFieldCamera, saveFieldCamera, createCameraRectangle, evaluateFieldCamera, encodeCameraRegions, decodeCameraRegions, type CameraRectangle } from "../src/pokeweb/fieldCameraModel";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { buildQuickLaunchDownloads, loadTestBattleSave, getTestBattleConfigForProject, toDesmumeDsv } from "../src/pokeweb/testBattle";
import { patchOverworldTestWarpEvent, patchOverworldTestWarpSave } from "../src/pokeweb/testOverworldWarp";

const input = process.argv[2], out = process.argv[3];
if (!input || !out) throw new Error("Pass clean US White 2 ROM and an output artifact directory.");
await fs.mkdir(out, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await fs.readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)), "camera-smoke.nds", { selectedNarcs: ["headers"] });
const baseline = process.argv.includes("--baseline");
const target = process.argv.includes("--interior") ? { zoneId: 428, gridX: 8, gridZ: 5 } : { zoneId: 437, gridX: 55, gridZ: 700 };
const doc = await loadFieldCamera(project, target.zoneId);
if (doc.memberId !== undefined) throw new Error("The smoke-test target already has native regions.");
const r = createCameraRectangle(doc.preset, 0, 0); r.width = r.height = 1024;
for (const e of [r.start, r.end]) Object.assign(e, { pitch: doc.preset.pitch + 1.25, yaw: doc.preset.yaw + 5, distance: doc.preset.distance + 8, fov: doc.preset.fov + 1 });
if (!baseline) saveFieldCamera(project, doc, [r]);
const quantized = decodeCameraRegions(encodeCameraRegions([r]))[0] as CameraRectangle;
const [downloads, fixture] = await Promise.all([buildQuickLaunchDownloads(project), loadTestBattleSave(getTestBattleConfigForProject(project))]);
const rom = new NintendoDSRom(downloads.romBytes, { fileData: "view" }), headers = new NARC(rom.getFileByName("a/0/1/2")).files[0];
const eventsId = rom.fileId("a/1/2/6"), events = new NARC(rom.files[eventsId]);
const originEvents = new DataView(headers.buffer, headers.byteOffset).getUint16(fixture.zoneId * 48 + 22, true);
events.files[originEvents] = patchOverworldTestWarpEvent(events.files[originEvents], fixture, target);
const romBytes = rom.save({ files: new Map([[eventsId, events.save()]]), preserveOriginalLength: false });
const saveBytes = toDesmumeDsv(patchOverworldTestWarpSave(fixture.rawSaveBytes, target));
console.log(JSON.stringify({ origin: { zone: fixture.zoneId, x: fixture.gridX, z: fixture.gridZ }, target, expected: quantized.start }));
const coreUrl = new URL("../public/desmond/desmond.js", import.meta.url), source = await fs.readFile(coreUrl, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => { ready = r; }); const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const ctx = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../public/desmond", import.meta.url)), __filename: fileURLToPath(coreUrl), console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), ctx); await initialized; const core = ctx.Module;
core._main(0, 0); const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]), pointer = core._prepareRomBuffer(size);
core.HEAPU8.set(romBytes, pointer); core.HEAPU8.fill(255, pointer + romBytes.length, pointer + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("Emulator rejected ROM.");
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
const pattern = Buffer.alloc(10); pattern.writeUInt16LE(Math.round(quantized.start.pitch * 65536 / 360), 0); pattern.writeUInt16LE(Math.round(quantized.start.yaw * 65536 / 360), 2); pattern.writeInt32LE(Math.round(quantized.start.distance * 4096), 4); pattern.writeUInt16LE(Math.round(quantized.start.fov * 65536 / 720), 8);
let observed = false;
let maximumPositionError = 0;
for (let frame = 0; frame < 1700; frame++) {
  core._runFrame(1, frame >= 900 && frame < 930 ? 4 : 0, 0, 0, 0);
  if (frame % 120 === 0 || frame === 1699) {
    const memory = ram(); let at = -1; const matches: number[] = [];
    while ((at = memory.indexOf(pattern, at + 1)) >= 0) {
      if (at >= 0x78 && memory.readUInt16LE(at + 8) === pattern.readUInt16LE(8)) matches.push(at - 0x78 + 0x02000000);
    }
    observed ||= matches.length > 0;
    for (const address of matches) {
      const object = address - 0x02000000;
      const vec = (offset: number) => ({ x: memory.readInt32LE(object + offset) / 4096, y: memory.readInt32LE(object + offset + 4) / 4096, z: memory.readInt32LE(object + offset + 8) / 4096 });
      const pose = evaluateFieldCamera(doc.preset, [quantized], vec(0x48), doc.boundaries), actual = vec(0x24);
      const error = Math.hypot(pose.position.x - actual.x, pose.position.y - actual.y, pose.position.z - actual.z);
      maximumPositionError = Math.max(maximumPositionError, error);
      if (error > 0.75) throw new Error(`Stationary camera position differs from native runtime by ${error} world units.`);
    }
    console.log(JSON.stringify({ frame, cameraObjects: matches.map(x => `0x${x.toString(16)}`), fatal }));
    const png = new PNG({ width: 256, height: 384 }), fb = core._getSymbol(4) >>> 0;
    png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await fs.writeFile(`${out}/frame-${frame}.png`, PNG.sync.write(png));
  }
}
await fs.writeFile(`${out}/ram.bin`, ram());
if (fatal.length) throw new Error(fatal.join("\n"));
if (!baseline && !observed) throw new Error("Did not observe the authored camera angles/distance/FOV in the native camera object.");
console.log(baseline ? "Baseline warp completed." : `Previously unbound zone camera became active in the emulator after the fixture warp. Maximum stationary camera position error: ${maximumPositionError} world units.`);
