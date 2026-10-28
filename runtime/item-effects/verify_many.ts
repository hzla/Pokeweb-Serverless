/** Export/reload 100 overrides and prepare real DS-mode battle fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import profiles from "../../src/assets/data/itemEffectProfiles.json";
import { readU16, readU32 } from "../../src/nds/binary";
import { NintendoDSRom } from "../../src/nds/rom";
import { configureHarnessRuntime, parseHarnessConfig, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../../src/pokeweb/battleHarness";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { configureItemTypeHealingBatch, hydrateItemEffectsSource, inspectItemEffect, ITEM_EFFECTS_DLL_PATH } from "../../src/pokeweb/itemEffectsModel";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { getItemRecord } from "../../src/pokeweb/moveItemModel";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { decryptPk5Party, getTestBattlePersonal } from "../../src/pokeweb/testBattleTeam";

const [inputPath, outputDirectory] = process.argv.slice(2);
if (!inputPath || !outputDirectory) throw new Error("Usage: vite-node runtime/item-effects/verify_many.ts ROM.nds OUTPUT_DIRECTORY");
const out = resolve(outputDirectory), input = new Uint8Array(await readFile(inputPath));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const inputHash = hash(input);
await mkdir(out, { recursive: true });
// This validation entry point only reads bundled assets. It never uses a server.
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only bundled local assets are permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "item-effects-validation.nds", { selectedNarcs: ["items", "message_texts", "personal", "moves", "trdata", "trpok"] });
let project = await load(input);
const edits = profiles.rows.slice(0, 100).map((row, i) => ({ itemId: row.id, type: i % 18, divisor: [8, 16, 32, 255, 3, 7, 100][i % 7] }));
await configureItemTypeHealingBatch(project, edits);
project = openProjectSession(createProjectDocument(project, false));
project.originalRomBytes = input;
hydrateItemEffectsSource(project, new NintendoDSRom(input, { fileData: "view" }));
for (const edit of edits) assert.equal(inspectItemEffect(project, edit.itemId).typeHealing, edit.type);
// Only item records and explicitly dirty trainer/Personal records belong in the
// output. Loading other editors for the fixture must not export normalization.
for (const [name, store] of Object.entries(project.narcs)) if (name !== "items" || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/items-100.nds`, exported, { flag: "wx" });
project = await load(exported);
const rom = new NintendoDSRom(exported, { fileData: "view" });
for (const edit of edits) {
  assert.equal(inspectItemEffect(project, edit.itemId).typeHealing, edit.type);
  assert.equal(getItemRecord(project, edit.itemId).raw.gain_values, edit.divisor);
}
const module = parseRpm(rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
assert.equal(module.relocations.filter(r => r.target.module === "167").length, 100);
assert.equal(module.code.length, 948);
const itemModules = rom.filenames.folders.find(([name]) => name === "patches")![1].files.filter(name => /^Item(?:Effects|TypeHealing\d+)\.dll$/u.test(name));
assert.deepEqual(itemModules, ["ItemEffects.dll"]);
const symbolFile = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]);
const pmcSymbols = Object.fromEntries(symbolFile.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea|HeapArea5Alloc|HeapArea4Free|ModuleStateC|LinkOverlay/.test(s.name)).map(s => [s.name!, symbolFile.baseAddress + 32 + s.address]));
await writeFile(`${out}/pmc-code.bin`, parseRpm(rom.loadArm9Overlays([344]).get(344)!.data).code);
await writeFile(`${out}/pmc-symbols.json`, JSON.stringify({ base: symbolFile.baseAddress + 32, symbols: symbolFile.symbols }, null, 2));
const nativeFactory = module.relocations.find(r => r.target.module === "167")!;
const battleOverlay = rom.loadArm9Overlays([167]).get(167)!;
const report = { inputSha256: inputHash, exportSha256: hash(exported), editedItems: 100, itemDlls: 1, codeBytes: module.code.length,
  dllBytes: rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)].length, projectReload: true, romExportReload: true, edits,
  assignments: module.relocations.filter(r => r.target.module === "167").map(r => ({ address: r.target.address, itemId: readU32(battleOverlay.data, r.target.address - battleOverlay.ramAddress - 4) })),
  pmcSymbols, factoryTarget: nativeFactory.target.address };
await writeFile(`${out}/export-report.json`, JSON.stringify(report, null, 2));
console.log(`Export/reload passed for ${edits.length} items in one ${module.code.length}-byte runtime.`);

validateHarnessRom(rom);
const trainer = { team: [{ speciesId: 129, level: 10, moves: [150], itemId: 0 }], ai: 0 };
const rule = patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType: "Singles", trainer }));
await prepareBw2TestBattleCodeInjection(project);
const template = new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url)));
stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(template, 2, rule));
const save = rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
const speciesFor = (type: number, match: boolean) => {
  for (let id = 1; id <= 649; id++) {
    const { raw } = getTestBattlePersonal(project, id);
    if ([Number(raw.type_1), Number(raw.type_2)].includes(type) === match && Number(raw.base_hp ?? raw.hp) > 1) return id;
  }
  throw new Error(`No species found for type ${type}, match=${match}`);
};
await mkdir(`${out}/saves`, { recursive: true });
const cases: Array<Record<string, unknown>> = [];
async function addCase(edit: typeof edits[number], match: boolean, fullHp = false) {
  const speciesId = speciesFor(edit.type, match), config = parseHarnessConfig({ trainerId: 2, battleType: "Singles", player: { team: [{ speciesId, level: 50, moves: [150], itemId: edit.itemId, abilityId: 1, ...(fullHp ? {} : { currentHp: 10 }) }] } });
  const fixture = patchHarnessSave(save, project, config), data = decryptPk5Party(fixture.subarray(0x18e08, 0x18e08 + 220));
  const hp = readU16(data, 0x8e), maxHp = readU16(data, 0x90), label = `${cases.length.toString().padStart(3, "0")}-${edit.itemId}-${match ? "match" : "miss"}${fullHp ? "-full" : ""}`;
  await writeFile(`${out}/saves/${label}.sav`, fixture, { flag: "wx" });
  cases.push({ label, ...edit, speciesId, hp, maxHp, expectedHp: match ? Math.min(maxHp, hp + Math.max(1, Math.floor(maxHp / edit.divisor))) : hp, match, fullHp });
}
for (const edit of edits) await addCase(edit, true);
for (const edit of edits.slice(0, 18)) await addCase(edit, false);
await addCase(edits[0], true, true);
for (const [name, store] of Object.entries(project.narcs)) if (!["trdata", "trpok", "personal"].includes(name) || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const battleRom = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/battle-100.nds`, battleRom, { flag: "wx" });
await writeFile(`${out}/cases.json`, JSON.stringify({ ...report, battleRomSha256: hash(battleRom), cases }, null, 2));
assert.equal(hash(new Uint8Array(await readFile(inputPath))), inputHash);
console.log(`Prepared ${cases.length} native-battle saves; the input ROM is unchanged.`);
