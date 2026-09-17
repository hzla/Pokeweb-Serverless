// Run the bundled browser core without a browser. Inputs are read-only; no
// battery saves or snapshots are written. This checks boot, not battle/UI play.
// Usage: node scripts/verify-desmond-boot.cjs ROM.nds [SAVE.dsv] [FRAMES]
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const [romPath, savePath, frames = "600"] = process.argv.slice(2);
if (!romPath) throw new Error("Expected ROM.nds [SAVE.dsv] [FRAMES]");
const frameLimit = Number(frames);
if (!Number.isInteger(frameLimit) || frameLimit < 1 || frameLimit > 3600) throw new Error("Invalid frame limit");
const corePath = path.resolve(__dirname, "../public/desmond/desmond.js");
const generated = fs.readFileSync(corePath, "utf8");
const moduleStart = generated.indexOf("\nvar Module=");
if (moduleStart < 0) throw new Error("Bundled Emscripten module not found");
const fatal = [];
const log = (...args) => {
  const line = args.join(" ");
  if (/Undefined instruction|Assertion failed|Aborted\(/i.test(line)) fatal.push(line);
};
const coreModule = { exports: {} };
const context = {
  require, module: coreModule, exports: coreModule.exports, process,
  console: { log, warn: log, error: log, info: log, debug: log },
  setTimeout, clearTimeout, setInterval, clearInterval,
  __dirname: path.dirname(corePath), __filename: corePath,
  Buffer, URL, TextDecoder, TextEncoder, WebAssembly, wasmReady() {},
};
context.globalThis = context;
vm.runInNewContext(generated.slice(moduleStart + 1), context);
const core = coreModule.exports;

async function main() {
  const start = Date.now();
  while (!core._prepareRomBuffer || !core.HEAPU8) {
    if (Date.now() - start > 15000) throw new Error("Core did not initialize");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const rom = fs.readFileSync(romPath);
  const capacity = 128 * 1024 * 2 ** rom[0x14];
  const size = capacity >= rom.length && capacity <= 1024 ** 3 ? capacity : rom.length;
  const pointer = core._prepareRomBuffer(size);
  core.HEAPU8.set(rom, pointer);
  core.HEAPU8.fill(0xff, pointer + rom.length, pointer + size);
  if (savePath) {
    const save = fs.readFileSync(savePath);
    core.HEAPU8.set(save, core._savGetPointer(save.length));
  }
  core._savUpdateChangeFlag();
  if (core._loadROM(size) !== 1) throw new Error("ROM load failed");
  const framebuffer = core._getSymbol(4) >>> 0;
  let visible = 0, nonBlack = 0;
  const colors = new Set();
  for (let frame = 1; frame <= frameLimit; frame++) {
    core._runFrame(1, 0, 0, 0, 0);
    if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`);
    if (frame === frameLimit) {
      for (let i = 0; i < 256 * 192 * 2; i++) {
        const at = framebuffer + i * 4;
        if (core.HEAPU8[at] < 248 || core.HEAPU8[at + 1] < 248 || core.HEAPU8[at + 2] < 248) visible++;
        if (core.HEAPU8[at] > 7 || core.HEAPU8[at + 1] > 7 || core.HEAPU8[at + 2] > 7) nonBlack++;
        colors.add(core.HEAPU8[at] | core.HEAPU8[at + 1] << 8 | core.HEAPU8[at + 2] << 16);
      }
    }
  }
  const length = core._saveState(1), statePointer = core._stateGetPointer(0) >>> 0;
  const state = Buffer.from(core.HEAPU8.subarray(statePointer, statePointer + length));
  const data = state.readUInt32LE(28) === 0xffffffff ? state.subarray(32) : zlib.inflateSync(state.subarray(32));
  let pc = 0;
  for (let offset = 8, end = 8 + data.readUInt32LE(4); offset < end;) {
    const tag = data.toString("ascii", offset, offset + 4);
    const itemSize = data.readUInt32LE(offset + 4), count = data.readUInt32LE(offset + 8);
    if (tag === "9REG") pc = data.readUInt32LE(offset + 12 + 15 * itemSize);
    offset += 12 + itemSize * count;
  }
  if (pc < 0x01000000 || visible < 1000 || nonBlack < 1000 || colors.size < 8) throw new Error(`Boot stalled: PC=0x${pc.toString(16)}, non-white=${visible}, non-black=${nonBlack}, colors=${colors.size}`);
  console.log(JSON.stringify({ boot: "passed", game: rom.toString("ascii", 12, 16), frames: frameLimit, arm9Pc: `0x${pc.toString(16)}`, nonWhitePixels: visible, nonBlackPixels: nonBlack, colors: colors.size, saveLoaded: Boolean(savePath) }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
