/** Isolated native smoke runner. Uses a copied bundled fixture, never user saves. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import nativeContract from "../../src/assets/data/bw2TownMapNativeContract.json";
import visitFlags from "../../src/assets/data/bw2FlyVisitFlags.json";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { loadTownMapDraft, applyTownMapDraft, appendTownMapArea, editTownMapText, writeTownMapAreas } from "../../src/pokeweb/townMapModel";
import { ensureCGearButtons } from "../../src/pokeweb/cgearButtonsModel";
import { installCGearQuickActions } from "../../src/pokeweb/cgearQuickActionsModel";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, patchTestBattleSaveBadges } from "../../src/pokeweb/testBattle";
import { patchTestBattleSavePlayerFirstMove } from "../../src/pokeweb/testBattleTeam";
const args = process.argv.slice(2), input = args[0];
const count = Number(args.find(a => a.startsWith("--areas="))?.split("=")[1] ?? 128), fly = args.includes("--fly"), locked = args.includes("--locked");
if (!input || ![85, 86, 128].includes(count)) throw new Error("Pass a clean US B2/W2 ROM and --areas=85|86|128 [--fly] [--locked].");
globalThis.fetch = (async input => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error("Only bundled local assets are expected.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), "town-map-fixture.nds", { selectedNarcs: ["headers", "town_map"] });
const draft = await loadTownMapDraft(project), first = draft.areas.findIndex(a => a.zone === 427), area = draft.areas[first];
const free = Object.values(project.headers!.rows).filter(h => !draft.areas.some(a => a.zone === h.index));
while (draft.areas.length < count) {
  const at = appendTownMapArea(draft, first, free.shift()!.index), a = draft.areas[at];
  a.position.x = 40 + (at - 85) * 4; a.position.y = 72; a.cursor = { ...a.position }; a.hit.start = { ...a.position }; a.hit.end = { ...a.position };
}
area.fly = 1; area.arrivalFlag = 2470; draft.landings[area.zone].x += 1;
editTownMapText(draft, first, 0, "A custom Town Map description.");
if (!args.includes("--baseline")) await applyTownMapDraft(project, draft);
const design = ensureCGearButtons(project).document;
Object.assign(design.buttons[0], { label: fly ? "FLY" : "MAP", action: fly ? "mapFly" : "map", flag: undefined });
await installCGearQuickActions(project);
const downloads = await buildQuickLaunchDownloads(project);
const romBytes = downloads.romBytes, saveBytes = patchTestBattleSavePlayerFirstMove(patchTestBattleSaveBadges(downloads.saveBytes, getTestBattleConfigForProject(project)), project, 19);
const fixture = Buffer.from(saveBytes.buffer, saveBytes.byteOffset, saveBytes.length);
function crc(bytes: Uint8Array) { let c = 65535; for (const v of bytes) { c ^= v << 8; for (let i = 0; i < 8; i++) c = (c & 32768 ? c << 1 ^ 0x1021 : c << 1) & 65535; } return c; }
for (const half of [0, 0x26000]) {
  const flagAt = half + 0x1ff00 + 0x35e + (2470 >> 3);
  if (locked) fixture[flagAt] &= ~(1 << (2470 & 7)); else fixture[flagAt] |= 1 << (2470 & 7);
  let empty = -1;
  for (let i = 0; i < 83; i++) { const at = half + 0x18400 + 310 * 4 + i * 4; if (fixture.readUInt16LE(at) === 442) { empty = at; break; } if (empty < 0 && !fixture.readUInt16LE(at)) empty = at; }
  if (empty < 0) throw new Error("Fixture has no key-item slot.");
  fixture.writeUInt16LE(442, empty); fixture.writeUInt16LE(1, empty + 2);
  const bag = crc(fixture.subarray(half + 0x18400, half + 0x18dec)); fixture.writeUInt16LE(bag, half + 0x18dee); fixture.writeUInt16LE(bag, half + 0x25f32);
  if (args.includes("--pokedex")) for (const flag of [...Object.values(visitFlags), ...draft.areas.map(a => a.arrivalFlag)]) {
    if (flag >= 1 && flag <= 3059 && !(locked && flag === 2470)) fixture[half + 0x1ff00 + 0x35e + (flag >> 3)] |= 1 << (flag & 7);
  }
  const events = crc(fixture.subarray(half + 0x1ff00, half + 0x203e0)); fixture.writeUInt16LE(events, half + 0x203e2); fixture.writeUInt16LE(events, half + 0x25f5a);
  fixture[half + 0x1c02e] = fixture[half + 0x1c02f] = 1;
  const gear = crc(fixture.subarray(half + 0x1c000, half + 0x1c094)); fixture.writeUInt16LE(gear, half + 0x1c096); fixture.writeUInt16LE(gear, half + 0x25f40);
  fixture.writeUInt16LE(crc(fixture.subarray(half + 0x25f00, half + 0x25f94)), half + 0x25fa2);
}
const out = new URL(`./build/emulator-${project.session.baseVersion}-${count}${args.includes("--baseline") ? "-baseline" : ""}-${fly ? locked ? "locked" : "fly" : "map"}/`, import.meta.url);
await mkdir(out, { recursive: true });
const corePath = new URL("../../public/desmond/desmond.js", import.meta.url), source = await readFile(corePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => { ready = r; }); const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const ctx = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)), __filename: fileURLToPath(corePath), console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), ctx); await initialized; const core = ctx.Module;
core._main(0, 0); const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]), pointer = core._prepareRomBuffer(size);
core.HEAPU8.set(romBytes, pointer); core.HEAPU8.fill(255, pointer + romBytes.length, pointer + size); core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("Emulator rejected ROM.");
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
let placesObserved = false, gamePointer = -1, initialPosition: number[] = [];
function findGame(m: Buffer): number {
  let at = -1;
  while ((at = m.indexOf(Buffer.from("CQAS"), at + 1)) >= 0) {
    const sub = m.readUInt32LE(at + 4) - 0x02000000;
    if (sub < 0 || sub + 40 >= m.length) continue;
    const field = m.readUInt32LE(sub + 20) - 0x02000000;
    if (field < 0 || field + 12 >= m.length) continue;
    const game = m.readUInt32LE(field + 8) - 0x02000000;
    if (game >= 0 && game + 0x160 < m.length && m.readUInt16LE(game + 0x114) === 427) return game;
  }
  throw new Error("Could not locate the isolated fixture's player state.");
}
for (let frame = 0; frame < (args.includes("--pokedex") ? 7200 : 3600); frame++) {
  const touch = args.includes("--pokedex") && frame >= 4900 && frame < 4904 ? [96, 180] : args.includes("--pokedex") && frame >= 5700 && frame < 5704 ? [244, 180] : args.includes("--pokedex") && frame >= 6200 && frame < 6204 ? [30, 160] : args.includes("--pokedex") && frame >= 3200 && frame < 3204 ? [190, 46] : frame >= 1000 && frame < 1004 ? [60, 116] : !fly && frame >= 1600 && frame < 1604 ? [180, 180] : null;
  const buttons = args.includes("--pokedex") && frame >= 4180 && frame < 4320 ? 4 : args.includes("--pokedex") && (frame >= 4100 && frame < 4104 || frame >= 4400 && frame < 4404 || frame >= 6800 && frame < 6804 || frame >= 7000 && frame < 7004) ? 128 : fly && frame >= 1600 && frame < 1604 ? 128 : frame >= 2400 && frame < 2404 ? 64 : (args.includes("--menu") || args.includes("--pokedex")) && frame >= 3000 && frame < 3004 ? 512 : 0;
  core._runFrame(1, buttons, touch ? 1 : 0, touch?.[0] ?? 0, touch?.[1] ?? 0);
  if ([999, 1400, 1800, 2200, 2800, 3599, 3900, 4400, 5000, 5599, 6000, 6600, 7199].includes(frame)) {
    const m = ram(); await writeFile(new URL(`ram-${frame}.bin`, out), m);
    if (frame === 999) {
      gamePointer = findGame(m); initialPosition = [m.readInt32LE(gamePointer + 0x118), m.readInt32LE(gamePointer + 0x120)];
      if (args.includes("--pokedex")) {
        // Register the retail 70-area checklist only in the emulator's fixture RAM.
        const ptr = (at: number) => { if (at < 0 || at + 4 > m.length) throw new Error("Fixture pointer is outside RAM."); const value = m.readUInt32LE(at) - 0x02000000; if (value < 0 || value >= m.length) throw new Error("Fixture save pointer is outside RAM."); return value; };
        const save = ptr(gamePointer), data = ptr(save + 0x10), directory = ptr(data + 0x2c), table = ptr(directory + 0x14);
        const medal = ptr(data + 0x34) + m.readUInt32LE(table + 0x44 * 12 + 8), habitat = medal + 0x400;
        if (habitat + 0x96 > m.length) throw new Error("Fixture habitat checklist is outside RAM.");
        for (let i = 0; i < 70; i++) m[habitat + 0x4a + i] |= 0x40;
      }
    }
    if (fly && frame === 2800) {
      const actual = [m.readInt32LE(gamePointer + 0x118), m.readInt32LE(gamePointer + 0x120)];
      const expected = locked ? initialPosition : [(draft.landings[area.zone].x + .5) * 65536, (draft.landings[area.zone].z + .5) * 65536];
      if (m.readUInt16LE(gamePointer + 0x114) !== 427 || actual.some((v, i) => Math.abs(v - expected[i]) > 1)) throw new Error(`Fly arrival differs: ${actual.map(v => v / 65536)} / ${expected.map(v => v / 65536)}.`);
      console.log(locked ? "Locked Fly kept the player at the starting location." : "Fly arrived at the configured map and X/Z coordinates; height followed native terrain.");
    }
    if (args.includes("--pokedex") && [5599, 7199].includes(frame)) {
      let largest = 0;
      for (let at = 0; at < m.length - 24; at += 4) {
        if (m.readUInt16LE(at + 12) !== 192) continue;
        const actors = m.readUInt32LE(at) - 0x02000000;
        if (actors < 0 || actors + 192 * 228 > m.length) continue;
        let owned = 0;
        for (let i = 0; i < 192; i++) if (m.readUInt32LE(actors + i * 228 + 8) === at + 0x02000000) owned++;
        largest = Math.max(largest, owned);
      }
      const version = project.session.baseVersion as "B2" | "W2";
      const hook = nativeContract[version].hooks.find(h => h.module === "303")!;
      const registered = frame === 7199 && m.readUInt16LE(hook.address - 0x02000000) === 0xb410;
      if (frame === 5599 ? largest < count : !registered || largest < 8) throw new Error(`Pokédex consumer has only ${largest}/${count} native actors.`);
      console.log(`${frame === 5599 ? "Species map" : "Habitat list"}: ${largest} actors in the expanded native pool.`);
    }
    if (frame === 1400) {
      const data = m.indexOf(Buffer.from(args.includes("--baseline") ? draft.baseline.areas : writeTownMapAreas(draft.areas))), expected = count - 1;
      if (data < 0) throw new Error("Native map did not load the authored records.");
      const reference = Buffer.alloc(4); reference.writeUInt32LE(data + 0x02000000);
      const indices = new Set<number>();
      for (let at = 0; at < m.length - 8; at += 4) if (m.subarray(at, at + 4).equals(reference)) { const index = m.readUInt32LE(at + 4); if (index < count) indices.add(index); }
      if (indices.size !== expected || count > 85 && !indices.has(count - 1)) throw new Error(`Native place allocation has ${indices.size}/${expected} records.`);
      const key = Buffer.alloc(8); key.writeUInt32LE(data + 0x02000000); key.writeUInt32LE(first, 4); const place = m.indexOf(key) - 4;
      if (!args.includes("--baseline") && (place < 0 || m.readUInt32LE(place + 60) !== Number(!locked))) throw new Error("Native Fly eligibility does not match the visit flag.");
      placesObserved = true; console.log(`${project.session.baseVersion}: ${count} records; ${expected} native place objects observed.`);
    }
    const png = new PNG({ width: 256, height: 384 }), fb = core._getSymbol(4) >>> 0; png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(new URL(`frame-${frame}.png`, out), PNG.sync.write(png));
  }
}
if (fatal.length || !placesObserved) throw new Error(fatal.join("\n") || "Map was not observed.");
console.log(`Native allocation smoke passed. Screenshots and RAM are in ${fileURLToPath(out)}; assess interaction and arrivals separately.`);
