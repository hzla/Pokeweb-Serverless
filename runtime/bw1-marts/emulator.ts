// Expanded BW1 mart check on a clean US Black / White ROM. Inputs are read-only; screenshots go to
// runtime/bw1-marts/build/<label>/.
// npx vite-node runtime/bw1-marts/emulator.ts /path/clean.nds
// Expands inventories, gives the 0-badge Poké Mart 40 items and the BP TM shop 40 entries, boots the
// quick-launch save into the field and checks that overlay 21's shop literal pool, as loaded in RAM,
// points at the module's tables with those lists.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads } from "../../src/pokeweb/testBattle";
import { enableBw1MartExpansion, readBw1Marts, setBw1BpItems, setBw1MartItems } from "../../src/pokeweb/bw1MartModel";

const romPath = process.argv[2];
if (!romPath) throw new Error("Pass a clean US Black or White ROM.");
const output = fileURLToPath(new URL(`./build/${basename(romPath, ".nds")}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
await enableBw1MartExpansion(project);
const items = Array.from({ length: 40 }, (_unused, n) => n + 1);
const bp = Array.from({ length: 40 }, (_unused, n) => ({ itemId: 328 + n, price: n + 1 }));
setBw1MartItems(project, 0, items);
setBw1BpItems(project, 27, bp);
const { layout, shops } = readBw1Marts(project);
const download = await buildQuickLaunchDownloads(project);
const { saveBytes } = download;
const romBytes = download.romBytes;

const corePath = fileURLToPath(new URL("../../public/desmond/desmond.js", import.meta.url));
const generated = await readFile(corePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => ready = r);
const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const context = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)), __filename: corePath, console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")), context);
await initialized;
const core = context.Module; core._main(0, 0);
const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]!);
const ptr = core._prepareRomBuffer(size); core.HEAPU8.set(romBytes, ptr); core.HEAPU8.fill(255, ptr + romBytes.length, ptr + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("ROM rejected");

const A = 128;
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
const at = (address: number) => address - 0x02000000;
let frame = 0;
const step = (count: number, keys = 0) => { for (let i = 0; i < count; i++, frame++) { core._runFrame(1, keys, 0, 0, 0); if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`); } };
const capture = async (name: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };
/** The pool words once PMC has relocated them into the module (outside overlay 21). */
const pool = () => { const m = ram(); return { table: m.readUInt32LE(at(layout.pool + 4)), counts: m.readUInt32LE(at(layout.pool + 12)), bpTable: m.readUInt32LE(at(layout.bpPool)), bpCounts: m.readUInt32LE(at(layout.bpPool + 4)) }; };
const relocated = () => { const p = pool(); return p.table !== layout.table && p.table >= 0x02000000 && p.table < 0x02400000; };

let ready21 = -1;
for (let tries = 0; tries < 400 && ready21 < 0; tries++) { step(20, tries % 3 === 0 ? A : 0); if (relocated()) ready21 = frame; }
await capture("field");
const m = ram(), p = pool();
const list = (index: number, length: number) => { const address = m.readUInt32LE(at(p.table + index * 4)); return Array.from({ length }, (_u, n) => m.readUInt16LE(at(address + n * 2))); };
const bpList = (index: number, length: number) => { const address = m.readUInt32LE(at(p.bpTable + index * 4)); return Array.from({ length }, (_u, n) => ({ itemId: m.readUInt16LE(at(address + n * 8)), price: m.readUInt32LE(at(address + n * 8 + 4)) })); };
const errors: string[] = [];
if (m[at(p.counts)] !== 40 || JSON.stringify(list(0, 40)) !== JSON.stringify(items)) errors.push("0-badge list");
for (const [index, expected] of shops.entries()) if (m[at(p.counts) + index] !== expected.length || JSON.stringify(list(index, expected.length)) !== JSON.stringify(expected)) errors.push(`list ${index}`);
if (m[at(p.bpCounts) + 1] !== 40 || JSON.stringify(bpList(1, 40)) !== JSON.stringify(bp)) errors.push("BP TM list");
const summary = { rom: basename(romPath), relocatedAt: ready21, pool: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, `0x${v.toString(16)}`])), errors };
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (errors.length) process.exitCode = 1;
