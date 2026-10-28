// White 2 native load smoke check, using only an isolated bundled save in memory.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PNG } from "pngjs";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import type { ProjectState } from "../src/pokeweb/projectStore";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, loadTestBattleSave, toDesmumeDsv } from "../src/pokeweb/testBattle";
import { patchOverworldTestWarpEvent, patchOverworldTestWarpSave } from "../src/pokeweb/testOverworldWarp";

export async function verifyMapImportEmulator(project: ProjectState, permissions: Uint8Array, output: string) {
  assert(project.romInfo.idCode === "IRDO", "emulator smoke check requires US White 2");
  await mkdir(output, { recursive: true });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert(url.protocol === "file:", "emulator test assets must remain local");
    return new Response(new Uint8Array(await readFile(url)));
  }) as typeof fetch;
  let downloads, fixture;
  try { [downloads, fixture] = await Promise.all([buildQuickLaunchDownloads(project), loadTestBattleSave(getTestBattleConfigForProject(project))]); }
  finally { globalThis.fetch = oldFetch; }
  const rom = new NintendoDSRom(downloads.romBytes, { fileData: "view" }), headers = new NARC(rom.getFileByName("a/0/1/2")).files[0];
  const target = { zoneId: 427, gridX: 35, gridZ: 709 }, eventsId = rom.fileId("a/1/2/6"), events = new NARC(rom.files[eventsId]);
  const eventsIndex = new DataView(headers.buffer, headers.byteOffset).getUint16(fixture.zoneId * 48 + 22, true);
  events.files[eventsIndex] = patchOverworldTestWarpEvent(events.files[eventsIndex], fixture, target);
  const romBytes = rom.save({ files: new Map([[eventsId, events.save()]]), preserveOriginalLength: false });
  const saveBytes = toDesmumeDsv(patchOverworldTestWarpSave(fixture.rawSaveBytes, target));
  const coreUrl = new URL("../public/desmond/desmond.js", import.meta.url), source = await readFile(coreUrl, "utf8");
  let ready!: () => void; const initialized = new Promise<void>(resolve => { ready = resolve; }), fatal: string[] = [];
  const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
  // The emulator RTC reads April as winter. This changes only this VM's Date.
  const dateContext = vm.createContext({});
  const winterDate = vm.runInContext(`class WinterDate extends Date { constructor(...args) { if (!args.length) super("2026-04-15T12:00:00Z"); else super(...args); } static now() { return new Date("2026-04-15T12:00:00Z").getTime(); } }; WinterDate`, dateContext);
  const ctx = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, Date: winterDate,
    require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance,
    wasmReady() {}, __dirname: fileURLToPath(new URL("../public/desmond", import.meta.url)), __filename: fileURLToPath(coreUrl), console: { log, warn: log, error: log, info: log, debug: log } });
  vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), ctx); await initialized;
  const core = ctx.Module; core._main(0, 0);
  const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]), pointer = core._prepareRomBuffer(size);
  core.HEAPU8.set(romBytes, pointer); core.HEAPU8.fill(255, pointer + romBytes.length, pointer + size);
  core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag(); assert.equal(core._loadROM(size), 1);
  let importedPayloadObserved = false;
  for (let frame = 0; frame < 1700; frame++) {
    core._runFrame(1, frame >= 900 && frame < 930 ? 4 : 0, 0, 0, 0);
    if (frame % 300 === 0 || frame === 1699) {
      const memory = Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
      importedPayloadObserved ||= memory.indexOf(permissions) >= 0;
      const png = new PNG({ width: 256, height: 384 }), framebuffer = core._getSymbol(4) >>> 0;
      png.data = Buffer.from(core.HEAPU8.subarray(framebuffer, framebuffer + 256 * 384 * 4));
      await writeFile(join(output, `frame-${frame}.png`), PNG.sync.write(png));
      console.log(JSON.stringify({ frame, importedPayloadObserved, fatal }));
    }
    assert.equal(fatal.length, 0, fatal.join("\n"));
  }
  assert(importedPayloadObserved, "the selected season did not load the imported collision/height payload into native RAM");
  console.log(JSON.stringify({ emulator: "DeSmuME", nativeImportedPayloadObserved: true, winterRtc: true, frames: 1700,
    limitation: "This load check does not establish walking, slope traversal, or every collision behavior." }));
}
