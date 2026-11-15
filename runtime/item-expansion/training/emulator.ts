// Boot and exercise the installed ROM in memory. Optional screenshots contain only this test save.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { readU16, readU32, writeU16 } from "../../../src/nds/binary";
import { NintendoDSRom } from "../../../src/nds/rom";
import { getRomFileBytes } from "../../../src/pokeweb/fileSystemModel";
import { removeStagedCodeInjectionDll, stageCodeInjectionDll } from "../../../src/pokeweb/pmcModel";
import { loadProjectFromRomBytes } from "../../../src/pokeweb/loader";
import { buildQuickLaunchDownloads } from "../../../src/pokeweb/testBattle";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../../src/pokeweb/codeInjectionInstall";
import { stageItemExpansion, isItemExpansionInstalled, itemFamily, ITEM_CAPACITY } from "../../../src/pokeweb/itemExpansionModel";
import { commitTextBank, getTextBank } from "../../../src/pokeweb/textModel";
import { getTrainingItemsStatus, stageTrainingItems, TRAINING_ITEMS } from "../../../src/pokeweb/trainingItemsModel";
import { exportModifiedRom } from "../../../src/pokeweb/exportRom";
import { markDirty } from "../../../src/pokeweb/projectStore";
import { decryptPk5Party, getTestBattlePersonal } from "../../../src/pokeweb/testBattleTeam";
import { saveLayout, recoverSave, encodeSave } from "../../../src/pokeweb/itemSaveFormat";

const argv = process.argv.slice(2);
const romPath = argv[0];
const variants = (argv[1] ?? "3").split(",").map(Number);
assert.ok(romPath && variants.every(i => TRAINING_ITEMS[i]), "Supply a US revision-0 ROM and comma-separated item indices 0–28.");
const output = argv.includes("--captures") ? fileURLToPath(new URL(`../build/training/captures/${basename(romPath, ".nds")}/`, import.meta.url)) : undefined;
if (output) await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const open = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, basename(romPath), { selectedNarcs: [] });
let project = await open(new Uint8Array(await readFile(romPath)));
const fromExisting = argv.includes("--existing");
const occupiedId = ITEM_CAPACITY - 1;
const itemNames = itemFamily(project).textBanks.names;
if (fromExisting) {
  await installCodeInjectionPatch(project, stageItemExpansion);
  getTextBank(project, "message_texts", itemNames)[occupiedId][1] = "Training Fixture";
  commitTextBank(project, "message_texts", itemNames);
  project = await open(await exportModifiedRom(project));
  assert.equal(isItemExpansionInstalled(project), true);
  assert.equal(getTrainingItemsStatus(project), "available");
}
const ids = await installCodeInjectionPatch(project, stageTrainingItems);
assert.equal(ids.length, 29);
assert.deepEqual(await installCodeInjectionPatch(project, stageTrainingItems), ids);
const legacyArgument = argv.indexOf("--upgrade");
if (legacyArgument !== -1) {
  const fileName = `PokewebTrainingItems${project.session.baseVersion}.dll`;
  const legacy = new Uint8Array(await readFile(argv[legacyArgument + 1]));
  const tag = Uint8Array.of(0x50, 0x57, 0x54, 0x52);
  const offset = (bytes: Uint8Array) => Buffer.from(bytes).indexOf(tag);
  const current = project.fileSystem!.additions![`patches/${fileName}`];
  legacy.set(current.subarray(offset(current) + 6, offset(current) + 8 + ids.length * 2), offset(legacy) + 6);
  stageCodeInjectionDll(project, fileName, legacy);
  project = await open(await exportModifiedRom(project));
  assert.equal(getTrainingItemsStatus(project), "update");
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  const textId = rom.filenames.idOf("a/0/0/2")!;
  const textBefore = getRomFileBytes(project, rom, textId).slice();
  assert.deepEqual(await installCodeInjectionPatch(project, stageTrainingItems), ids);
  assert.deepEqual(getRomFileBytes(project, rom, textId), textBefore);
  assert.equal(getTrainingItemsStatus(project), "installed");
  console.log("Verified v1 Training Items upgrade");
}

const formChange = argv.includes("--form");
const evolve = argv.includes("--evolve");
const stock = argv.includes("--stock");
if (stock) {
  assert.ok(evolve, "The stock control uses Rare Candy.");
  removeStagedCodeInjectionDll(project, `patches/PokewebTrainingItems${project.session.baseVersion}.dll`);
}
const missingSlot = argv.includes("--missing-slot");
const species = formChange ? 487 : 509;
const level = evolve ? 19 : 30;
if (formChange || evolve) {
  loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }), ["personal"]);
  if (formChange) {
    const base = getTestBattlePersonal(project, species);
    Object.assign(base.raw, { ability_1: 7, ability_2: 84, ability_3: 158 });
    markDirty(project, "personal", base.personalId);
  }
  const target = getTestBattlePersonal(project, formChange ? species : 510, formChange ? 1 : 0);
  Object.assign(target.raw, { ability_1: 46, ability_2: missingSlot ? 0 : 50, ability_3: missingSlot ? 0 : 26 });
  markDirty(project, "personal", target.personalId);
}
const { romBytes, saveBytes } = await buildQuickLaunchDownloads(project, {
  playerTeamText: `${formChange ? "Giratina" : "Purrloin"}\nAbility: Limber\nLevel: ${level}\nHardy Nature\nIVs: 2 HP / 3 Atk / 4 Def / 5 SpA / 6 SpD / 7 Spe\n- Tackle`,
});
const reopened = await open(romBytes);
assert.equal(getTrainingItemsStatus(reopened), stock ? "available" : "installed");
assert.ok(isItemExpansionInstalled(reopened));
loadCodeInjectionNarcs(reopened, new NintendoDSRom(romBytes, { fileData: "view" }), ["items", "message_texts"]);
const exportedNames = getTextBank(reopened, "message_texts", itemNames);
assert.deepEqual(ids.map(id => exportedNames[id][1]), TRAINING_ITEMS.map(item => item.name));
assert.ok(ids.every(id => reopened.codeInjection!.itemExpansion!.icons[id]));
if (fromExisting) {
  assert.ok(!ids.includes(occupiedId));
  assert.equal(exportedNames[occupiedId][1], "Training Fixture");
}

const raw = saveBytes.subarray(0, 0x80000);
const layout = saveLayout(itemFamily(project).save, "expanded");
const recovered = recoverSave(raw, layout);
const bag = recovered.payloads[25];
const seedItem = stock ? 50 : ids[variants[0]];
// Isolate the test item in Medicine, preserving every other retail pocket.
const otherItems: [number, number][] = [];
let at = 0;
for (let off = 4; off < 4 + 4 * 1023 && readU16(bag, off); off += 4) {
  const id = readU16(bag, off);
  const record = project.narcs.items!.rawFiles[id];
  const pocket = readU16(record, 8) >> 7 & 15;
  if (pocket === 1 || (formChange && pocket === 0)) continue;
  if (pocket === 0) at++;
  otherItems.push([id, readU16(bag, off + 2)]);
}
if (formChange) {
  otherItems.unshift([112, 2]); // Griseous Orb
  at++;
}
otherItems.splice(at, 0, [seedItem, stock ? 1 : 2]);
if (evolve && !stock) otherItems.splice(at + 1, 0, [50, 1]);
bag.fill(0, 4);
otherItems.forEach(([id, quantity], index) => {
  writeU16(bag, 4 + index * 4, id);
  writeU16(bag, 6 + index * 4, quantity);
});
saveBytes.set(encodeSave(raw, layout, recovered.payloads, recovered.counts, recovered.generation), 0);
const corePath = fileURLToPath(new URL("../../../public/desmond/desmond.js", import.meta.url));
const generated = await readFile(corePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => ready = r);
const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (argv.includes("--debug")) console.log(line); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const context = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../../public/desmond", import.meta.url)), __filename: corePath, console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")), context);
await initialized;
const core = context.Module; core._main(0, 0);
const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]!);
const ptr = core._prepareRomBuffer(size); core.HEAPU8.set(romBytes, ptr); core.HEAPU8.fill(255, ptr + romBytes.length, ptr + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("ROM rejected");

const KEY = { right: 1, left: 2, down: 4, up: 8, select: 16, start: 32, b: 64, a: 128, y: 256, x: 512 } as const;
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
let frame = 0;
const step = (count: number, keys = 0) => { for (let i = 0; i < count; i++, frame++) { core._runFrame(1, keys, 0, 0, 0); if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`); } };
const touch = (x: number, y: number, frames = 6) => { for (let i = 0; i < frames; i++, frame++) core._runFrame(1, 0, 1, x, y); step(2); };
const capture = async (name: string) => { if (!output) return; const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };


const card = () => new Uint8Array(core.HEAPU8.subarray(core._savGetPointer(0), core._savGetPointer(0) + 0x80000));
const snapshot = (save: Uint8Array, item: number) => {
  const recovered = recoverSave(save, layout);
  const mon = decryptPk5Party(recovered.payloads[26].subarray(8, 228));
  const ivWord = readU32(mon, 0x38);
  const pool = recovered.payloads[25];
  let quantity = 0;
  for (let off = 4; off + 4 <= pool.length && readU16(pool, off); off += 4) if (readU16(pool, off) === item) quantity = readU16(pool, off + 2);
  return {
    generation: recovered.generation, pid: readU32(mon, 0), species: readU16(mon, 8), nature: mon[0x41],
    ability: mon[0x15], hidden: mon[0x42] & 1, form: mon[0x40] >> 3, slot: mon[0x43], ivs: Array.from({ length: 6 }, (_, i) => ivWord >>> (i * 5) & 31),
    stats: Array.from({ length: 6 }, (_, i) => readU16(mon, 0x90 + i * 2)), hp: readU16(mon, 0x8e), quantity,
  };
};

let before = snapshot(raw, seedItem);
assert.equal(before.species, species);
assert.equal(before.ability, 7);
assert.equal(before.nature, 0);
assert.deepEqual(before.ivs, [2, 3, 4, 7, 5, 6]);
for (let i = 0; i < 80; i++) step(20, i % 3 === 0 ? KEY.a : 0);

async function saveInGame(snap: (name: string) => Promise<void>) {
  step(4, KEY.x); step(60); await snap("10-field-menu");
  touch(64, 153); step(90); await snap("10-save-prompt");
  for (let i = 0; i < 6; i++) { step(4, KEY.a); step(60); }
  step(600); await snap("11-saved");
}
const liveBag = ram().indexOf(bag);
assert.ok(liveBag >= 0, "The input bag should be loaded in DS RAM.");
const chooseStat = argv.includes("--speed") ? 5 : 0;
for (const [testIndex, variant] of (stock ? [] : variants).entries()) {
  const item = ids[variant];
  // Set up the next item while the Bag is closed. All Pokémon changes and
  // consumption below come from the actual in-game menus and native save.
  const slot = liveBag + 4 + at * 4;
  const oldItem = ids[variants[Math.max(0, testIndex - 1)]];
  assert.equal(readU16(ram(), slot), oldItem, "The fixture item should still be in the Medicine pocket.");
  writeU16(ram(), slot, item);
  writeU16(ram(), slot + 2, 2);
  const snap = (name: string) => capture(`${variant}-${name}`);
  step(30); step(4, KEY.x); step(40); await snap("01-menu");
  touch(64, 105); step(120); await snap("02-bag");
  if (testIndex === 0) { touch(131, 180); step(45); }
  await snap("03-medicine");
  step(4, KEY.a); step(40); await snap("04-item-menu");
  step(4, KEY.a); step(90); await snap("05-party");
  step(4, KEY.a); step(80); await snap("06-prompt");
  step(4, KEY.a); step(100); await snap("07-choice");
  if (variant === 25) for (let i = 0; i < chooseStat; i++) { step(4, KEY.down); step(12); }
  step(4, argv.includes("--cancel") ? KEY.b : KEY.a); step(100); await snap("08-result");
  for (let i = 0; i < 7; i++) { step(4, KEY.b); step(40); }
  step(90); await snap("09-field");
  await saveInGame(snap);
  const after = snapshot(card(), item);
  assert.ok(after.generation > before.generation, "The game should write a new save.");
  const expected = { ...before, generation: after.generation, quantity: 2, ivs: [...before.ivs] };
  if (!argv.includes("--cancel")) {
    if (variant < 25) expected.nature = variant;
    if (variant === 25) expected.ivs[chooseStat === 5 ? 3 : 0] = 31;
    if (variant === 26) expected.ivs.fill(31);
    if (variant === 27 && !expected.hidden) {
      expected.ability = before.ability === 7 ? 84 : 7;
      expected.slot = expected.ability === 84 ? 0xd6 : 0xd5;
    }
    if (variant === 28) {
      expected.hidden = before.hidden ? 0 : 1;
      expected.ability = expected.hidden ? 158 : 7;
      expected.slot = expected.hidden ? 0xd7 : 0xd5;
    }
    if (expected.nature !== before.nature || expected.ability !== before.ability
      || expected.ivs.some((value, index) => value !== before.ivs[index])) expected.quantity = 1;
  }
  const bases = formChange ? [150, 100, 120, 90, 100, 120] : [41, 50, 37, 66, 50, 37];
  expected.stats = bases.map((base, i) => {
    const value = Math.floor((2 * base + expected.ivs[i]) * level / 100);
    if (i === 0) return value + level + 10;
    const raised = Math.floor(expected.nature / 5), lowered = expected.nature % 5;
    const scale = raised === lowered ? 10 : i - 1 === raised ? 11 : i - 1 === lowered ? 9 : 10;
    return Math.floor((value + 5) * scale / 10);
  });
  expected.hp = expected.stats[0];
  assert.deepEqual(after, expected, TRAINING_ITEMS[variant].name);
  console.log(`${project.session.baseVersion} ${TRAINING_ITEMS[variant].name}`, after);
  before = after;
  step(4, KEY.a); step(120); // Dismiss the save confirmation before reopening the field menu.
}

if (formChange || evolve) {
  const item = formChange ? 112 : 50;
  step(4, KEY.x); step(45); touch(64, 105); step(120);
  if (formChange || stock) { touch(stock ? 131 : 11, 180); step(60); }
  const snap = (name: string) => capture(`transition-${name}`);
  const pressA = (wait: number) => { step(4, KEY.a); step(wait); };
  await snap("01-bag");
  pressA(40);
  if (evolve && !stock) { step(4, KEY.down); step(30); }
  pressA(90); pressA(80); await snap("02-party");
  pressA(100); await snap("03-applied");
  for (let i = 0; i < (evolve ? 30 : 13); i++) pressA(65);
  await snap("04-transition");
  for (let i = 0; i < 7; i++) { step(4, KEY.b); step(40); }
  step(evolve ? 400 : 110);
  // Watch the transformed Pokémon in working memory before saving it.
  const pid = Buffer.alloc(4);
  pid.writeUInt32LE(before.pid);
  const memory = ram();
  const expectedAbility = missingSlot || before.slot === 0 ? 46 : [46, 50, 26][before.slot - 0xd5];
  const candidates = [];
  for (let offset = memory.indexOf(pid); offset >= 0; offset = memory.indexOf(pid, offset + 4)) {
    if (offset + 220 > memory.length) break;
    const mon = decryptPk5Party(memory.subarray(offset, offset + 220));
    const checksum = Array.from({ length: 64 }, (_, i) => readU16(mon, 8 + i * 2)).reduce((a, b) => a + b, 0) & 0xffff;
    if (checksum === readU16(mon, 6) && readU16(mon, 8) === (evolve ? 510 : species)) {
      candidates.push({ form: mon[0x40] >> 3, ability: mon[0x15], slot: mon[0x43] });
    }
  }
  assert.ok(candidates.some(mon => mon.form === (formChange ? 1 : 0)
    && mon.ability === expectedAbility && mon.slot === before.slot), JSON.stringify(candidates));
  console.log(`${project.session.baseVersion} ${formChange ? "form change" : "evolution"} verified in DS RAM`, {
    ability: expectedAbility, slot: before.slot,
  });
  if (!argv.includes("--live-only")) {
    await saveInGame(snap);
    const after = snapshot(card(), item);
    console.log(`${project.session.baseVersion} ${formChange ? "form change" : "evolution"}`, after);
    assert.ok(after.generation > before.generation);
    assert.equal(after.species, formChange ? species : 510);
    assert.equal(after.form, formChange ? 1 : 0);
    assert.equal(after.pid, before.pid);
    assert.equal(after.slot, before.slot);
    assert.equal(after.hidden, missingSlot ? 0 : before.hidden);
    assert.equal(after.ability, expectedAbility);
  }
}
