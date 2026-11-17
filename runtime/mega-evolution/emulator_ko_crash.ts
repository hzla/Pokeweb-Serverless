// Mega Evolution + KO moves check (desmond, headless): a level 100 Charizard holding Charizardite X Mega Evolves and
// knocks out the foe. With Menu Evolution's KO moves (battlelog_ko/learnsets.narc) and Battle Counters installed, the
// KO-move check reads the KO learnset of the Pokémon's personal record (species + form): a Mega form past the end
// of that archive used to fail an assertion (the error screen).
// --ko-move NAME gives Charizard that KO move at 1 KO: a KO while Mega Evolved counts toward Charizard's KO moves
// (the Mega form's member mirrors the base form's), so it learns it right after the KO.
// npx vite-node runtime/mega-evolution/emulator_ko_crash.ts ROM [--trainer ID] [--name label] [--ko-move NAME]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { listCodeInjectionDlls } from "../../src/pokeweb/pmcModel";
import { loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { getPokemonKoMoves, insertPokemonKoMove, updatePokemonKoMoveField } from "../../src/pokeweb/koMoveLearnsetModel";
import { NintendoDSRom } from "../../src/nds/rom";
import itemManifest from "../../src/assets/codeinjection/itemExpansionManifest.json";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0]!;
const label = option("--name") ?? basename(romPath, ".nds");
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
// The item expansion's state lives in the project, not the ROM: a ROM with its DLLs needs an expanded save.
if (listCodeInjectionDlls(project).some((module) => /PokewebItemsCore/iu.test(module.path))) {
  project.codeInjection ??= {};
  project.codeInjection.itemExpansion ??= { version: itemManifest.version, icons: {} };
}
const koMove = option("--ko-move");
if (koMove) {
  loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }), ["personal", "learnsets", "evolutions"]);
  insertPokemonKoMove(project, 6, 0);
  updatePokemonKoMoveField(project, 6, "move_id_0", koMove);
  updatePokemonKoMoveField(project, 6, "ko_count_0", "1");
  console.log("Charizard's KO moves:", JSON.stringify(getPokemonKoMoves(project, 6).map((move) => [move.moveName, move.koCount])));
}
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, Number(option("--trainer") ?? 1), {
  playerTeamText: "Charizard @ Charizardite X\nLevel: 100\n- Flare Blitz\n- Dragon Claw",
});
await writeFile(join(output, "rom.nds"), romBytes);
const corePath = fileURLToPath(new URL("../../public/desmond/desmond.js", import.meta.url));
const generated = await readFile(corePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => ready = r);
const context = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)), __filename: corePath, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} } });
vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")), context);
await initialized;
const core = context.Module; core._main(0, 0);
const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]!);
const ptr = core._prepareRomBuffer(size); core.HEAPU8.set(romBytes, ptr); core.HEAPU8.fill(255, ptr + romBytes.length, ptr + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("ROM rejected");
const KEY = { start: 32, a: 128 } as const;
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
const step = (count: number, keys = 0) => { for (let i = 0; i < count; i++) core._runFrame(1, keys, 0, 0, 0); };
const touch = (x: number, y: number, frames = 6) => { for (let i = 0; i < frames; i++) core._runFrame(1, 0, 1, x, y); step(2); };
const capture = async (name: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };
// The player's Charizard's BattleMon (species 6 at +0x0c, form at +0x141).
const charizard = () => {
  const m = ram();
  for (let at = 0; at + 0x1f8 < m.length; at += 4) {
    const p0 = m.readUInt32LE(at);
    if (p0 < 0x02000000 || p0 >= 0x02400000 || m.readUInt16LE(at + 0xc) !== 6) continue;
    const hp = m.readUInt16LE(at + 0x10), max = m.readUInt16LE(at + 0xe);
    if (max > 200 && hp <= max && max < 999) return { form: m[at + 0x141], hp, max };
  }
  return undefined;
};
for (let i = 0; i < 160 && !charizard(); i++) step(30, i % 4 === 0 ? KEY.a : 0);
step(1500); await capture("command");
touch(128, 85); step(60); step(4, KEY.start); step(24); await capture("armed");
touch(64, 44); step(30);
// The Mega Evolution, the KO and the experience: watch for the error screen ("An error has occurred").
const assertFrames: number[] = [];
for (let i = 0; i < 40; i++) { step(60, i % 2 ? KEY.a : 0); await capture(`after-${String(i).padStart(2, "0")}`); }
const mega = charizard();
console.log(JSON.stringify({ label, charizard: mega }));
