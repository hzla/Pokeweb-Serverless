// Species expansion check on a clean US Black 2 / White 2 ROM (desmond, headless).
// npx vite-node runtime/species-expansion/emulator.ts /path/clean.nds [--team TEXT] [--foe TEXT] [--frames N]
//   [--name label] [--after STEPS] [--retail] [--drop core,summary,box] [--watch auto|ADDRESS] [--dex] [--save PATH] [--last SPECIES]
//
// Installs the species expansion (Fairy Type Support, Move Expansion and the animated sprite runtime with it), checks
// the staged data (moved form records, names, the regional Pokédex table), exports, reloads (the numbering is read
// back from the DLL), then runs a test battle: by default the player's Chespin, one EXP point short of level 16,
// knocks out a level 5 Chansey and evolves into Quilladin. --retail skips the install (the same battle with retail
// species, for comparison). Captures every 60 frames go to build/emulator/<label>/; --after as
// runtime/regional-forms/emulator.ts.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { buildTestBattleDownloads, toDesmumeDsv } from "../../src/pokeweb/testBattle";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { installSpeciesExpansion } from "../../src/pokeweb/speciesExpansionModel";
import { usesWhite2UpgradePokemonData } from "../../src/pokeweb/pokemonModel";
import { resolvePokemonSpriteId } from "../../src/pokeweb/pokemonSpriteModel";
import { pokemonSpeciesLabel } from "../../src/pokeweb/pokemonLabels";
import { decodeRecord } from "../../src/pokeweb/projectStore";
import { getTextBank } from "../../src/pokeweb/textModel";
import { importTrainerTeamShowdownText } from "../../src/pokeweb/trainerModel";
import { NintendoDSRom } from "../../src/nds/rom";
import { removeStagedCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { editPokedexSave, registerPokedexSpecies, setNationalPokedex } from "../../src/pokeweb/speciesExpansionSaveModel";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0]!;
const retail = argv.includes("--retail");
const label = option("--name") ?? `${basename(romPath, ".nds")}-${retail ? "retail" : "species"}`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

let project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
if (!retail) {
  const started = Date.now();
  const report = await installSpeciesExpansion(project, (stage) => installCodeInjectionPatch(project, stage));
  console.log(`installed in ${Date.now() - started} ms:`, JSON.stringify({ ...report, movesLeftOut: report.movesLeftOut.length,
    movesLeftOutSample: report.movesLeftOut.slice(0, 5) }));
  const check = (where: string, p: typeof project) => {
    const personal = p.narcs.personal!;
    assert.equal(personal.rawFiles[1087]!.length, 1063 * 2, `${where}: regional Pokédex table`);
    assert.equal(Number(decodeRecord(p, "personal", 386).raw!.form_id), 1063, `${where}: Deoxys' first form`);
    assert.equal(Number(decodeRecord(p, "personal", 687).raw!.base_hp), 56, `${where}: Chespin's HP`);
    assert.equal(p.texts.banks.pokedex?.[687], "Chespin", `${where}: Chespin's name`);
    assert.equal(getTextBank(p, "message_texts", 486).find((entry) => entry[0] === "0_1060")?.[1], "IRON CROWN", `${where}: upper-case name`);
    assert(!usesWhite2UpgradePokemonData(p), `${where}: not read as White2Upgrade`);
    assert.equal(pokemonSpeciesLabel(p, 1063), "Deoxys-Attack", `${where}: Deoxys-Attack at 1063`);
    console.log(where, "sprites", resolvePokemonSpriteId(p, 687), resolvePokemonSpriteId(p, 1060), "Deoxys-Attack", resolvePokemonSpriteId(p, 386, 1),
      "personal", personal.rawFiles.length, "config", JSON.stringify({ ...p.codeInjection!.speciesExpansion, sprites: undefined, cries: undefined }));
  };
  loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }), ["personal", "message_texts"]);
  check("staged", project);
  // Debugging: --drop a,b leaves those runtime DLLs out (core, summary, box).
  for (const part of option("--drop")?.split(",") ?? []) {
    const name = { core: "", summary: "Summary", box: "Box" }[part]!;
    removeStagedCodeInjectionDll(project, `patches/SpeciesExpansion${name}${project.session.baseVersion}.dll`);
    console.log("dropped", part);
  }
  const exported = await exportModifiedRom(project);
  project = await loadProjectFromRomBytes(exported, "species-expansion.nds", { selectedNarcs: ["personal", "message_texts", "pokemon_sprites", "moves"] });
  if (!option("--drop")) check("reloaded", project);
}
const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
const trainerId = Number(option("--trainer") ?? (project.session.baseRom === "BW" ? 1 : 156));
loadCodeInjectionNarcs(project, rom, ["trdata", "trpok"]);
importTrainerTeamShowdownText(project, trainerId, option("--foe") ?? "Chansey\nLevel: 5\n- Splash");
const built = await buildTestBattleDownloads(project, trainerId, {
  playerTeamText: option("--team") ?? (retail ? "Bulbasaur\nExp: 2534\n- Dragon Rage" : "Chespin\nExp: 2534\n- Dragon Rage"),
});
const romBytes = built.romBytes;
// --save PATH: a raw save instead of the test battle's (sample-save.ts's). --dex: the national Pokédex, with national
// 650-655 caught, Iron Crown seen and the list on Chespin.
// --last SPECIES: the Pokédex list's cursor (default with --dex: Chespin).
const setLast = (dex: Uint8Array, species: number) => {
  const view = new DataView(dex.buffer, dex.byteOffset);
  view.setUint32(4, (view.getUint32(4, true) & ~(0x7ff << 12)) | (species << 12), true);
};
let saveBytes = option("--save") ? toDesmumeDsv(new Uint8Array(await readFile(option("--save")!))) : argv.includes("--dex") ? editPokedexSave(built.saveBytes, (dex) => {
  setNationalPokedex(dex);
  for (let national = 650; national <= 655; national++) registerPokedexSpecies(dex, national, true);
  registerPokedexSpecies(dex, 1023, false);
  setLast(dex, 687);
}) : built.saveBytes;
if (option("--last")) saveBytes = editPokedexSave(saveBytes, (dex) => setLast(dex, Number(option("--last"))));
await writeFile(join(output, "rom.nds"), romBytes);

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

const frames = Number(option("--frames") ?? 4800);
// Debugging: --watch ADDRESS (or auto: the save's first party Pokémon) reports the frames where the encrypted Pokémon
// at ADDRESS (main RAM) changes, and whether its stored checksum still matches its data (a mismatch: a bad egg).
let watch = option("--watch") && option("--watch") !== "auto" ? Number(option("--watch")) - 0x2000000 : undefined;
const findParty = () => {
  // The first copy of the save's first party Pokémon to appear in main RAM (the save buffer's).
  const pid = Buffer.from(Buffer.from(saveBytes).readUInt32LE(0x18e08).toString(16).padStart(8, "0"), "hex").reverse();
  const ram = Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
  for (let at = ram.indexOf(pid); at >= 0; at = ram.indexOf(pid, at + 4)) if (at % 4 === 0) return at;
  return undefined;
};
let watched = "";
const pkmState = () => {
  const ram = Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000), at = watch!;
  const checksum = ram.readUInt16LE(at + 6);
  let seed = checksum, sum = 0;
  for (let i = 0; i < 64; i++) { seed = (Math.imul(seed, 0x41c64e6d) + 0x6073) >>> 0; sum = (sum + (ram.readUInt16LE(at + 8 + i * 2) ^ (seed >>> 16))) & 0xffff; }
  return `${ram.subarray(at, at + 8).toString("hex")} ${ram.subarray(at + 8, at + 136).toString("hex").slice(0, 16)} ${sum === checksum ? "ok" : "BAD"} raw1e=${ram.readUInt16LE(at + 0x1e).toString(16)}`;
};
for (let frame = 0; frame <= frames; frame++) {
  core._runFrame(1, frame % 40 < 2 ? 128 : 0, 0, 0, 0); // A every 40 frames
  if (option("--watch") === "auto" && watch === undefined && frame > 60) { watch = findParty(); if (watch !== undefined) console.log(`watching 0x${(watch + 0x2000000).toString(16)}`); }
  if (watch !== undefined) { const state = pkmState(); if (state !== watched) { console.log(`frame ${frame}: ${state}`); watched = state; } }
  if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`);
  if (frame % 60 === 0) {
    const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 });
    png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4));
    await writeFile(join(output, `f${String(frame).padStart(5, "0")}.png`), PNG.sync.write(png));
  }
}
const KEY = { right: 1, left: 2, down: 4, up: 8, select: 16, start: 32, b: 64, a: 128, y: 256, x: 512 } as const;
const run = (count: number, keys = 0, touch?: [number, number]) => {
  for (let i = 0; i < count; i++) {
    core._runFrame(1, keys, touch ? 1 : 0, touch?.[0] ?? 0, touch?.[1] ?? 0);
    if (fatal.length) throw new Error(`After step: ${fatal.join("; ")}`);
  }
};
const capture = async (name: string) => {
  const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 });
  png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4));
  await writeFile(join(output, `${name}.png`), PNG.sync.write(png));
};
for (const step of (option("--after") ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
  const [kind, ...args] = step.split(":");
  if (kind === "wait") run(Number(args[0]));
  else if (kind === "touch") { run(6, 0, [Number(args[0]), Number(args[1])]); run(2); }
  else if (kind === "cap") await capture(args[0]!);
  else if (kind! in KEY) { run(4, KEY[kind as keyof typeof KEY]); run(30); }
  else throw new Error(`Unknown step ${step}`);
}
console.log(JSON.stringify({ label, frames, captures: output }));
