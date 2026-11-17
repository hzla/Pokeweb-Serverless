/** Exercise the installed battle hooks in an emulator without writing ROM files. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { writeU32 } from "../../src/nds/binary";
import { NintendoDSRom } from "../../src/nds/rom";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import { buildModernStatusModule, installFrostbiteSnowPatch } from "../../src/pokeweb/frostbiteSnowModel";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { writeRpm } from "../../src/pokeweb/rpm";
import { buildTestBattleDownloads, getTestBattleConfigForProject, patchTestBattleSaveMoveAnimations, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { runLoggedBattleBytes } from "../ability-effects/battle_log_runner";
import { configureAbilityRuleSets } from "../../src/pokeweb/abilityEffectsModel";
import { abilityImport } from "../../src/pokeweb/abilityLibrary";
import { updateMoveField } from "../../src/pokeweb/moveItemModel";

const [path, mode = "burn"] = process.argv.slice(2);
assert(path);
globalThis.fetch = (async (value: URL | RequestInfo) => {
  const target = value instanceof Request ? value.url : String(value);
  const url = target.startsWith("/src/assets/") ? new URL(`../..${target}`, import.meta.url) : new URL(target);
  if (url.protocol !== "file:") throw Error("Only local fixtures are supported.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const source = new Uint8Array(await readFile(path));
const project = await loadProjectFromRomBytes(source, "modern-status.nds", {
  selectedNarcs: ["personal", "items", "message_texts", "moves", "move_animations", "move_spas", "trdata", "trpok"],
});
const template = JSON.parse(await readFile(new URL("./build/test.json", import.meta.url), "utf8")).templates.modern_status;
const cases = {
  burn: { status: 4, move: 33, roll: 1 },
  facade: { status: 4, move: 263, roll: 1 },
  guts: { status: 4, move: 33, roll: 1, ability: 62 },
  heatproof: { status: 4, move: 33, roll: 1, ability: 85 },
  guard: { status: 4, move: 33, roll: 1, ability: 98 },
  "paralysis-block": { status: 1, move: 33, roll: 1 },
  "paralysis-act": { status: 1, move: 33, roll: 2 },
  "sleep-short": { status: 2, move: 150, roll: 1 },
  "sleep-long": { status: 2, move: 150, roll: 3 },
  "early-bird": { status: 2, move: 150, roll: 1, ability: 48 },
  "sleep-move": { status: 0, move: 150, roll: 3, enemyMove: 95 },
  "sleep-switch": { status: 2, move: 150, roll: 3, enemyMove: 46 },
  rest: { status: 0, move: 156, roll: 1 },
  "freeze-short": { status: 3, move: 150, roll: 1 },
  "freeze-long": { status: 3, move: 150, roll: 4 },
  "freeze-switch": { status: 3, move: 150, roll: 4, enemyMove: 46 },
  "electric-immune": { status: 0, move: 150, roll: 1, species: 25, enemyMove: 137 },
  "paralysis-inflicted": { status: 0, move: 150, roll: 1, species: 133, enemyMove: 137 },
  scald: { status: 3, move: 150, roll: 4, enemyMove: 503 },
  "scald-substitute": { status: 0, move: 164, roll: 4, enemyMove: 503 },
  "electric-static": { status: 0, move: 33, roll: 2, species: 25 },
  "electric-transfer": { status: 1, move: 375, roll: 2 },
  "electric-item": { status: 0, move: 150, roll: 2, species: 25, enemyMove: 374 },
  "speed-low": { status: 1, move: 33, roll: 2, enemyMove: 33 },
  "speed-high": { status: 1, move: 33, roll: 2, enemyMove: 33 },
  "speed-quick-feet": { status: 1, move: 33, roll: 2, ability: 95, enemyMove: 33 },
  "confusion-hit": { status: 0, move: 150, roll: 33, enemyMove: 109 },
  "confusion-act": { status: 0, move: 150, roll: 34, enemyMove: 109 },
  corrosion: { status: 0, move: 92, roll: 1, ability: 165 },
  puppeteer: { status: 0, move: 92, roll: 1, ability: 165 },
  "selective-guard": { status: 4, move: 150, roll: 1, ability: 165 },
} satisfies Record<string, { status: number; move: number; roll: number; ability?: number; species?: number; enemyMove?: number }>;
assert(mode in cases, `Unknown fixture ${mode}`);
const selected = cases[mode as keyof typeof cases] as typeof cases[keyof typeof cases] & { ability?: number; species?: number; enemyMove?: number };
await installFrostbiteSnowPatch(project, "modern_status");
const withRecipes = ["corrosion", "puppeteer", "selective-guard"].includes(mode);
if (withRecipes) {
  await installFrostbiteSnowPatch(project, "frostbite");
  await installFrostbiteSnowPatch(project, "snow");
  const rules = mode === "selective-guard" ? {
    effects: [{ kind: "abilityRecipe:damageGuard" as const, value: 1, parameters: { sources: 3 } }],
    conditions: { kind: "group" as const, mode: "all" as const, children: [] },
  } : abilityImport(mode === "corrosion" ? 212 : 310).rule;
  await configureAbilityRuleSets(project, [{ abilityId: 165, rules, name: "Status Fixture" }]);
  if (selected.move === 92) updateMoveField(project, 92, "accuracy", "100");
}
const rom = new NintendoDSRom(source, { fileData: "view" });
const module = buildModernStatusModule(project, rom, withRecipes, template);
writeU32(module.code, module.symbols.find(symbol => symbol.name === "ModernRngOverride")!.address, selected.roll);
if (mode === "scald-substitute") {
  writeU32(module.code, module.symbols.find(symbol => symbol.name === "ModernScaldFixture")!.address, 1);
  updateMoveField(project, 503, "power", "255");
}
stageCodeInjectionDll(project, "ModernStatus.dll", writeRpm(module, { ident: "DLXF" }));
const player = { speciesId: selected.species ?? 386, level: 50, moves: [selected.move], currentHp: 100,
  status: selected.status, abilityId: selected.ability ?? 46 };
const enemy = { speciesId: mode === "electric-transfer" ? 25 : mode === "corrosion" ? 1 : mode === "speed-low" || !selected.enemyMove ? 321 : 130,
  level: mode.startsWith("scald") ? 36 : mode === "speed-low" ? 50 : selected.enemyMove ? 62 : 55,
  moves: [selected.enemyMove ?? 150], abilityId: mode === "electric-static" ? 9 : 46,
  ...(mode === "electric-item" ? { itemId: 236 } : {}) };
patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType: "Singles", trainer: { ai: 0, team: [enemy] } }));
const downloads = await buildTestBattleDownloads(project, 2);
const team = mode.endsWith("-switch") ? [player, { ...player, speciesId: 133, status: 0 }] : [player];
const noAnimations = patchTestBattleSaveMoveAnimations(rawSaveBytesFromDesmumeDsv(downloads.saveBytes), getTestBattleConfigForProject(project), false);
const save = patchHarnessSave(noAnimations, project,
  parseHarnessConfig({ trainerId: 2, player: { team } }));
const { entries, seenTexts } = await runLoggedBattleBytes(downloads.romBytes, save, { battleType: "Singles" }, {
  tag: "MODN", frames: mode.endsWith("-switch") ? 6500 : 5300, logCapacity: 80, shots: false,
  texts: ["woke up!", "thawed out!", "Deoxys is hurt", "Deoxys was burned", "fully paralyzed", "fell asleep!"],
});
const event = (id: number, ...actors: number[]) =>
  entries.filter(row => (row.event === id || (row.event === 3 && row.d === id))
    && (!actors.length || actors.includes(row.a)));
console.log(project.session.baseVersion, mode, JSON.stringify({ seenTexts, entries: entries.slice(0, 12) }));
if (["burn", "facade", "guts", "heatproof", "guard"].includes(mode)) {
  const isExempt = mode === "facade" || mode === "guts";
  assert.ok(entries.some(row => [3, 0xd1].includes(row.event) && row.a === 0 && row.x === 4 && row.value === 1 && row.move > 0
    && row.y === (isExempt ? row.move : Math.floor(row.move / 2))), "Physical burn multiplier");
  assert.ok(event(0xe6, 0).some(row => row.move === 16 && row.value === 7), "Base burn damage");
  assert.ok(event(0xe8, 0).some(row => row.x === 4 && row.move === (mode === "heatproof" ? 3 : 7) && row.value === Number(mode !== "guard")),
    "Native residual damage and prevention");
}
if (mode.startsWith("paralysis-") && mode !== "paralysis-inflicted") {
  assert.ok(event(0xe1, 0).some(row => row.move === 8 && row.y === selected.roll - 1 && row.value === Number(mode === "paralysis-block")));
}
if (mode.startsWith("sleep-") || mode === "early-bird") {
  assert.ok(event(0xe2, 0).some(row => row.move === 3 && row.value === (selected.roll === 1 ? 2 : 3)));
  const expected = mode === "early-bird" ? [1] : mode === "sleep-short" ? [0, 1] : [0, 0, 1];
  const verified = mode === "sleep-move" ? expected.slice(0, 1) : expected;
  assert.deepEqual(event(0xe7, 0).slice(0, verified.length).map(row => row.value), verified);
}
if (mode === "rest") {
  assert.deepEqual(event(0xe7, 0).slice(0, 3).map(row => row.value), [0, 0, 1]);
}
if (mode.startsWith("freeze-")) {
  const attempts = event(0xe3, 0).slice(0, 3).map(row => [row.move, row.value]);
  assert.deepEqual(attempts, mode === "freeze-short" ? [[1, 1]] : [[1, 0], [2, 0], [3, 1]]);
}
if (mode === "electric-immune" || mode === "paralysis-inflicted") {
  assert.ok(event(0xe4, 0).some(row => row.value === (mode === "electric-immune" ? 2 : 0)));
}
if (mode === "scald") {
  assert.ok(event(0xe5, 0).some(row => row.value === 0));
}
if (mode === "scald-substitute") {
  assert.ok(event(0xe5, 0).some(row => row.move === 0 && row.value === 1), "Breaking Substitute must not thaw its holder.");
}
if (["electric-static", "electric-transfer", "electric-item"].includes(mode)) {
  assert.ok(event(0xe4).some(row => (row.a === 0) === (mode !== "electric-transfer") && row.value === 2));
}
if (mode.startsWith("speed-")) {
  const first = event(0xd1)[0];
  assert.ok(first);
  assert.equal(first.a === 0, mode !== "speed-high", "Native move order after applying the Speed penalty");
}
if (mode.startsWith("confusion-")) {
  assert.ok(event(0xe9).some(row => row.move === 33 && row.y === selected.roll - 1 && row.value === Number(mode === "confusion-hit")));
}
if (mode === "corrosion" || mode === "puppeteer") {
  assert.ok(event(0xe8).some(row => row.a !== 0 && row.x === 5 && row.value === 1), "The target must take native poison damage.");
  if (mode === "puppeteer") assert.ok(event(0xe9).length, "Poison Puppeteer must also confuse the target.");
}
if (mode === "selective-guard") {
  // Selective Magic Guard reduces the condition event's amount to zero,
  // so the native residual handler never queries further damage prevention.
  assert.ok(event(0xe6, 0).some(row => row.move === 16 && row.value === 7));
  assert.ok(!event(0xe8, 0).some(row => row.x === 4 && row.value === 1));
}
