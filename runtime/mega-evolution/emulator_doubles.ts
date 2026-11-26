// Mega Evolution in a double or triple battle (desmond, headless): the player's lead (Scizor @ Scizorite by default) arms Mega
// Evolution on the move screen, then picks a target. Target selection rebuilds the fight action
// (BattleAction_SetFightParam clears it), which used to drop the armed form: the turn ran without the Mega Evolution.
// The ROM's own Mega DLL is replaced by the bundled one, with the ROM's PWMG table (routes and settings) carried over;
// --keep-dll tests the ROM's DLL as it is. --trainer picks the trainer (a triple battle one with a three-Pokémon --team).
// npx vite-node runtime/mega-evolution/emulator_doubles.ts ROM [--trainer ID] [--name label] [--keep-dll]
//   [--team "Showdown text"] [--species N]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { decodeRecord } from "../../src/pokeweb/projectStore";
import { MEGA_ROUTE_CAPACITY, megaEvolutionVersion } from "../../src/pokeweb/megaEvolutionModel";
import { parseRpm } from "../../src/pokeweb/rpm";
import { NintendoDSRom } from "../../src/nds/rom";
import itemManifest from "../../src/assets/codeinjection/itemExpansionManifest.json";
import megaManifest from "../../src/assets/codeinjection/megaEvolutionManifest.json";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0]!;
const label = option("--name") ?? `${basename(romPath, ".nds")}-doubles`;
const species = Number(option("--species") ?? 212);
const team = option("--team") ?? "Scizor @ Scizorite\nLevel: 100\n- Bullet Punch\n- X-Scissor\n\nPikachu\nLevel: 100\n- Thunderbolt\n- Quick Attack";
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
if (listCodeInjectionDlls(project).some((module) => /PokewebItemsCore/iu.test(module.path))) {
  project.codeInjection ??= {};
  project.codeInjection.itemExpansion ??= { version: itemManifest.version, icons: {} };
}
const version = megaEvolutionVersion(project);
if (!version) throw new Error("Not a Mega Evolution game");
const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
const game = (megaManifest.games as Record<string, { fileName: string; tableOffset: number; targets: Array<{ segment: string; address: string; kind: string }> }>)[version]!;
const romDllId = rom.filenames.idOf(`patches/${game.fileName}`);
if (romDllId === undefined) throw new Error(`The ROM has no patches/${game.fileName}`);

// The bundled DLL with the ROM's table (header and routes) copied over.
const table = (bytes: Uint8Array) => {
  for (let at = 0; at + 8 <= bytes.length; at += 4) {
    if (new DataView(bytes.buffer, bytes.byteOffset + at).getUint32(0, true) === 0x474d5750) return at;
  }
  throw new Error("No PWMG table");
};
if (!argv.includes("--keep-dll")) {
  const old = rom.files[romDllId]!;
  const fresh = new Uint8Array(await readFile(fileURLToPath(new URL(`../../src/assets/codeinjection/${game.fileName}`, import.meta.url))));
  const from = table(old), to = table(fresh);
  const tableVersion = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset + at).getUint16(4, true);
  if (tableVersion(old, from) !== tableVersion(fresh, to)) throw new Error("The ROM's DLL has an older table layout");
  fresh.set(old.subarray(from, from + 28 + MEGA_ROUTE_CAPACITY * 8), to);
  // Another DLL patching the new hook sites would break the fix.
  const ranges = game.targets.map((target) => ({ segment: target.segment, start: Number(target.address), end: Number(target.address) + (target.kind === "THUMB_BRANCH_LINK" ? 4 : 12) }));
  for (const module of listCodeInjectionDlls(project)) {
    if (module.path.toLowerCase() === `patches/${game.fileName}`.toLowerCase()) continue;
    const id = rom.filenames.idOf(module.path);
    if (id === undefined) continue;
    try {
      const hits = parseRpm(rom.files[id]!, { allowedMagics: ["DLXF", "RPM0"] }).relocations.filter(({ target }) => target.module !== "base"
        && ranges.some((range) => range.segment === target.module && (target.address & ~1) < range.end && (target.address & ~1) + 4 > range.start));
      if (hits.length) console.log(`conflict: ${module.path}`);
    } catch { /* not an RPM */ }
  }
  stageCodeInjectionDll(project, game.fileName, fresh, "patches", project.originalRomBytes);
}

// A double battle: the first native doubles trainer with two Pokémon, unless --trainer.
loadCodeInjectionNarcs(project, rom, ["trdata", "trpok"]);
let trainer = Number(option("--trainer") ?? 0);
for (let id = 1; !trainer && id < (project.narcs.trdata?.fileCount ?? 0); id++) {
  const raw = decodeRecord(project, "trdata", id).raw!;
  if (Number(raw.battle_type_1) === 1 && Number(raw.num_pokemon) >= 2) trainer = id;
}
console.log(`${version} trainer ${trainer} (${argv.includes("--keep-dll") ? "ROM's DLL" : "bundled DLL"})`);
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainer, { playerTeamText: team });
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
// The lead's BattleMon (species at +0x0c, form at +0x141), level 100 stats.
const lead = () => {
  const m = ram();
  for (let at = 0; at + 0x1f8 < m.length; at += 4) {
    const p0 = m.readUInt32LE(at);
    if (p0 < 0x02000000 || p0 >= 0x02400000 || m.readUInt16LE(at + 0xc) !== species) continue;
    const hp = m.readUInt16LE(at + 0x10), max = m.readUInt16LE(at + 0xe);
    if (max > 200 && hp <= max && max < 999) return { form: m[at + 0x141], hp, max };
  }
  return undefined;
};
for (let i = 0; i < 160 && !lead(); i++) step(30, i % 4 === 0 ? KEY.a : 0);
step(1500); await capture("command");
// The lead: Fight, START arms Mega Evolution, the first move, then the target (A takes the highlighted foe).
touch(128, 85); step(60); step(4, KEY.start); step(24); await capture("armed");
touch(64, 44); step(40); await capture("target"); step(4, KEY.a); step(40);
// The partners (one in a double battle, two in a triple): Fight, the first move, the top-left foe as the target
// (repeated until the turn starts; the move screen may open directly).
for (let i = 0; i < 6; i++) {
  touch(128, 85); step(40); touch(64, 44); step(40); touch(40, 44); step(40); step(4, KEY.a); step(40);
  await capture(`partner-${i}`);
}
const forms: number[] = [];
for (let i = 0; i < 24; i++) {
  step(30);
  forms.push(lead()?.form ?? -1);
  await capture(`turn-${String(i).padStart(2, "0")}`);
}
const evolved = forms.some((form) => form > 0);
console.log(JSON.stringify({ label, trainer, forms: forms.join(""), evolved }));
