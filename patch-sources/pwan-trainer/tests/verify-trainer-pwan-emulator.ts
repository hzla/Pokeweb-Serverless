// Opt-in integration smoke test using a locally supplied ROM and the exact
// bundled browser core. ROM/save inputs are read-only; captures go to a new
// temporary directory. No copyrighted fixtures are included in this script.
// npx vite-node scripts/verify-trainer-pwan-emulator.ts ROM.nds ANIMATED.gif [TRAINER_ID] [--native] [--with-pokemon] [--verify-fade] [--hold-first-frame]
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { decodeRecord } from "../src/pokeweb/projectStore";
import { trainerGraphicIndexForClass } from "../src/pokeweb/trainerSpriteModel";
import { buildPwanOverrideSideFromPwanBytes, installPwanRuntime } from "../src/pokeweb/pwanAnimationModel";
import { compileGifToPwan, parsePwanHeader } from "../src/pokeweb/pwanCompiler";
import { verifyTrainerIntroPalette, type TrainerPaletteSample } from "./lib/trainer-pwan-palette";
import { installTrainerPwanRuntime, upsertTrainerPwanOverride } from "../src/pokeweb/trainerPwanAnimationModel";
import { buildTestBattleDownloads } from "../src/pokeweb/testBattle";

const [romPath, gifPath, trainerArg = "1"] = process.argv.slice(2);
const native = process.argv.includes("--native");
const verifyFade = process.argv.includes("--verify-fade");
if (!romPath || !gifPath) throw new Error("Expected ROM.nds ANIMATED.gif [TRAINER_ID]");
const trainerId = Number(trainerArg);
const output = await mkdtemp(join(tmpdir(), "trainer-pwan-smoke-"));
console.log(`Captures: ${output}`);
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error(`Expected a local bundled asset: ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), {
  selectedNarcs: ["trainer_sprites", "trdata", "trpok"],
});
const trainerClass = Number(decodeRecord(project, "trdata", trainerId).raw!.class);
const graphicIndex = trainerGraphicIndexForClass(project, trainerClass);
const compiled = compileGifToPwan(new Uint8Array(await readFile(gifPath)));
if (compiled.uniqueFrameCount < 2) throw new Error("Use an animated GIF with at least two distinct frames");
if (process.argv.includes("--hold-first-frame")) {
  const header = parsePwanHeader(compiled.pwanBytes);
  if (header.timelineCount > 64) throw new Error("Use a GIF with at most 64 timeline entries for the held-frame regression");
  const view = new DataView(compiled.pwanBytes.buffer, compiled.pwanBytes.byteOffset, compiled.pwanBytes.byteLength);
  for (let i = 0; i < header.timelineCount; i += 1) view.setUint16(header.timelineOffset + i * 4 + 2, i === 0 ? 128 : 1, true);
  view.setUint32(16, 128 + header.timelineCount - 1, true);
}
if (process.argv.includes("--with-pokemon")) await installPwanRuntime(project);
await installTrainerPwanRuntime(project);
if (!native) upsertTrainerPwanOverride(project, {
  graphicIndex,
  animation: buildPwanOverrideSideFromPwanBytes(compiled.pwanBytes, basename(gifPath)),
});
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainerId);
console.log(JSON.stringify({ game: project.romInfo.idCode, trainerId, trainerClass, graphicIndex, frames: compiled.uniqueFrameCount }));

const corePath = fileURLToPath(new URL("../public/desmond/desmond.js", import.meta.url));
const generated = await readFile(corePath, "utf8");
const moduleStart = generated.indexOf("var Module=typeof Module");
if (moduleStart < 0) throw new Error("Bundled Emscripten module not found");
let ready!: () => void;
const initialized = new Promise<void>((resolve) => { ready = resolve; });
const fatal: string[] = [];
const log = (...args: unknown[]) => {
  const line = args.join(" ");
  if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line);
};
const context = vm.createContext({
  Module: { noInitialRun: true, onRuntimeInitialized: ready },
  require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder,
  setTimeout, clearTimeout, performance, wasmReady() {},
  __dirname: fileURLToPath(new URL("../public/desmond", import.meta.url)), __filename: corePath,
  console: { log, warn: log, error: log, info: log, debug: log },
});
vm.runInContext(generated.slice(moduleStart), context);
await initialized;
const core = context.Module;
core._main(0, 0);
const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]!);
const romPointer = core._prepareRomBuffer(size);
core.HEAPU8.set(romBytes, romPointer);
core.HEAPU8.fill(0xff, romPointer + romBytes.length, romPointer + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length));
core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("Emulator rejected the test ROM");
const ramPointer = core._getSymbol(7) >>> 0;
const ram = Buffer.from(core.HEAPU8.buffer, ramPointer, 0x400000);
const frames = new Set<number>();
const paletteTrace: TrainerPaletteSample[] = [];
let actor: number | undefined;
let appeared = -1;
let deleted = -1;
for (let frame = 0; frame < 2400; frame += 1) {
  // Continue through menus/dialogue, but leave the intro visible long enough
  // to verify multiple frame uploads before testing actor deletion.
  const holdingIntro = native ? frame >= 970 && frame < 1210 : appeared >= 0 && frame < appeared + 240;
  core._runFrame(1, !holdingIntro && frame % 30 < 2 ? 1 << 7 : 0, 0, 0, 0);
  if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`);
  if (actor === undefined && frame % 10 === 0) actor = findActor(ram, graphicIndex);
  if (actor !== undefined) {
    if (ram.readUInt32LE(actor) === 1) {
      const current = ram.readUInt16LE(actor + 12);
      if (current !== 0xffff) {
        frames.add(current);
        if (appeared < 0) {
          appeared = frame;
          console.log(`Actor at 0x${(actor + 0x02000000).toString(16)}, first upload at frame ${frame}`);
        }
        if (verifyFade && frame < appeared + 240) {
          const mcss = ram.readUInt32LE(actor + 4) - 0x02000000;
          const paletteAddress = ram.readUInt32LE(mcss + 0xc8);
          const lcd = stateField(saveState(0), 4, "LCDM");
          const colors = Array.from({ length: 16 }, (_,i) => lcd.readUInt16LE(0x90000 + paletteAddress + i * 2));
          paletteTrace.push({ frame, pwanFrame: current, paletteAddress, fade: ram[mcss + 0x134]!, target: ram[mcss + 0x135]!, flags: ram.readUInt32LE(mcss + 0x140), colors });
        }
      }
    } else if (appeared >= 0 && deleted < 0) {
      deleted = frame;
      console.log(`Actor deleted at frame ${frame}`);
    }
  }
  if (frame % 300 === 0 || (native && frame === 1120) || (appeared >= 0 && [30, 90, 150, 210].includes(frame - appeared)) || (deleted >= 0 && frame === deleted + 240)) {
    await capture(frame);
    console.log(`Frame ${frame}: ${frames.size} PWAN frames observed`);
  }
  if (deleted >= 0 && frame >= deleted + 240) break;
  if (native && frame === 1670) break;
}
await capture(9999);
if (verifyFade) await writeFile(join(output, "palette-trace.json"), JSON.stringify(paletteTrace, null, 2));
if (verifyFade && !native) console.log({ nativeFade: verifyTrainerIntroPalette(paletteTrace, compiled.paletteBgr555) });
if (!native && (appeared < 0 || frames.size < 2 || deleted < 0)) {
  throw new Error(`Trainer playback failed: appeared=${appeared}, frames=${frames.size}, deleted=${deleted}; inspect ${output}`);
}
if (native && actor !== undefined) throw new Error("An unconfigured trainer registered a PWAN actor");
console.log(JSON.stringify({ playbackVerified: !native, nativeFallbackCaptured: native, appeared, deleted, distinctFrames: frames.size, captures: output }));

function findActor(memory: Buffer, asset: number): number | undefined {
  for (let at = 20; at < memory.length - 476; at += 4) {
    if (memory.readUInt32LE(at) !== 0x4e415750 || memory.readUInt16LE(at + 6) !== 96 || memory.readUInt16LE(at + 8) !== 96) continue;
    const start = at - 20;
    const mcss = memory.readUInt32LE(start + 4);
    if (memory.readUInt32LE(start) === 1 && mcss >= 0x02000000 && mcss < 0x02400000 && memory.readUInt16LE(start + 8) === asset) return start;
  }
  return undefined;
}

async function capture(frame: number): Promise<void> {
  const framebuffer = core._getSymbol(4) >>> 0;
  const png = new PNG({ width: 256, height: 384 });
  png.data = Buffer.from(core.HEAPU8.subarray(framebuffer, framebuffer + 256 * 384 * 4));
  await writeFile(join(output, `frame-${frame}.png`), PNG.sync.write(png));
  await writeFile(join(output, "latest.dst"), saveState(1));
}

function saveState(compression: number): Buffer {
  const length = core._saveState(compression);
  const ptr = core._stateGetPointer(0) >>> 0;
  return Buffer.from(core.HEAPU8.buffer, ptr, length);
}

function stateField(state: Buffer, chunk: number, tag: string): Buffer {
  const data = state.readUInt32LE(28) === 0xffffffff ? state.subarray(32) : inflateSync(state.subarray(32));
  for (let at = 0; at + 8 <= data.length;) {
    const id = data.readUInt32LE(at), length = data.readUInt32LE(at + 4);
    if (id === 0xffffffff) break;
    if (id === chunk) {
      for (let field = at + 8; field < at + 8 + length;) {
        const size = data.readUInt32LE(field + 4) * data.readUInt32LE(field + 8);
        if (data.toString("ascii", field, field + 4) === tag) return data.subarray(field + 12, field + 12 + size);
        field += 12 + size;
      }
    }
    at += 8 + length;
  }
  throw new Error(`Save state field ${chunk}:${tag} is missing`);
}
