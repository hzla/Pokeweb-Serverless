/** Instrument native battles in memory. Build the observation templates with build.py --test. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { writeU32 } from "../../src/nds/binary";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import { BATTLE_RUNTIME_SIGNATURES, battleBranchTarget, battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import { installFrostbiteSnowPatch, buildFrostbiteSnowModule } from "../../src/pokeweb/frostbiteSnowModel";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { parseRpm, writeRpm, type RpmModule } from "../../src/pokeweb/rpm";
import { buildTestBattleDownloads, getTestBattleConfigForProject, patchTestBattleSaveMoveAnimations, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { configureAbilityRuleSets } from "../../src/pokeweb/abilityEffectsModel";
import { configureItemRuleSets } from "../../src/pokeweb/itemEffectsModel";
import { configureMoveRuleSets } from "../../src/pokeweb/moveEffectsModel";
import { MOVE_ALWAYS, newMoveEffect } from "../../src/pokeweb/moveRules";
import { runLoggedBattleBytes } from "../ability-effects/battle_log_runner";

const [path, which = "frostbite"] = process.argv.slice(2);
const withModern = process.argv.includes("--modern");
const withRecipes = process.argv.includes("--recipes");
const modes = ["frostbite", "fire", "guard", "berry", "physical", "snow", "snowscape", "cloud", "ice-body", "count-control", "count-snow",
  "sprite", "sprite-v1"];
assert(path && modes.includes(which), `Usage: ROM.nds [${modes.join("|")}]`);
globalThis.fetch = (async (value: URL | RequestInfo) => {
  const target = value instanceof Request ? value.url : String(value);
  const url = target.startsWith("/src/assets/") ? new URL(`../..${target}`, import.meta.url) : new URL(target);
  if (url.protocol !== "file:") throw Error("Only local fixtures are supported.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const source = new Uint8Array(await readFile(path));
const project = await loadProjectFromRomBytes(source, "frostbite-snow.nds", {
  selectedNarcs: ["personal", "items", "message_texts", "moves", "move_animations", "move_spas", "trdata", "trpok"],
});
const test = JSON.parse(await readFile(new URL("./build/test.json", import.meta.url), "utf8"));
const profiling = which.startsWith("count-");
const spriteTest = which.startsWith("sprite");
const game = test.games[project.session.baseVersion];
const observation = ["snow", "snowscape", "cloud", "ice-body"].includes(which) || profiling ? "snow" : "frostbite";
await installFrostbiteSnowPatch(project, "frostbite");
if (withModern) await installFrostbiteSnowPatch(project, "modern_status");
if (which !== "count-control") await installFrostbiteSnowPatch(project, "snow");
if (withRecipes) {
  assert.equal(which, "frostbite");
  await configureAbilityRuleSets(project, [{ abilityId: 165, name: "Burn Guard", rules: {
    effects: [{ kind: "abilityRecipe:damageGuard", value: 1, parameters: { sources: 1 } }],
    conditions: { kind: "group", mode: "all", children: [] },
  } }]);
  await configureMoveRuleSets(project, [{ moveId: 94, rules: {
    effects: [newMoveEffect("power")], conditions: MOVE_ALWAYS, prerequisites: MOVE_ALWAYS,
  } }]);
  await configureItemRuleSets(project, [{ itemId: 238, rules: {
    effects: [{ kind: "specialAttack", value: 1.5 }], conditions: { kind: "group", mode: "all", children: [] }, consumable: false,
  } }]);
}
const name = observation === "snow" ? "Snow.dll" : "Frostbite.dll";
const rom = new NintendoDSRom(source, { fileData: "view" });
if (which === "sprite-v1") {
  const module = parseRpm(project.fileSystem!.additions![`patches/${name}`], { allowedMagics: ["DLXF"] });
  module.relocations = module.relocations.filter(site => site.target.module !== String(game.clientOverlay));
  module.metadata.PokewebFrostbiteSnowVersion = 1;
  stageCodeInjectionDll(project, name, writeRpm(module, { ident: "DLXF" }));
} else if (!profiling && !spriteTest) {
  const compiled = parseRpm(project.fileSystem!.additions![`patches/${name}`], { allowedMagics: ["DLXF"] });
  const module = buildFrostbiteSnowModule(project, observation, rom,
    Number(compiled.metadata.PokewebFrostbiteDamageText ?? 0), test.templates[observation], withModern && observation === "frostbite");
  stageCodeInjectionDll(project, name, writeRpm(module, { ident: "DLXF" }));
}

if (profiling) {
  assert.equal(project.session.baseRom, "BW2", "The weather profiling fixture uses BW2 flow offsets.");
  const overlay = rom.loadArm9Overlays([167]).get(167)!;
  const resolver = battleRuntimeResolver(overlay.data, overlay.ramAddress, project.arm9, rom.arm9RamAddress);
  const query = resolver.resolve("ServerEvent_GetWeather");
  const { code, ...template } = test.templates.snow;
  const copy = (code.length + 3) & ~3;
  const module: RpmModule = { ...template, code: new Uint8Array(copy + query.code.length) };
  module.code.set(code);
  module.code.set(query.code, copy);
  const named = (symbol: string) => module.symbols.findIndex(s => s.name === symbol);
  module.relocations.push({ target: { module: "167", address: query.address, type: "THUMB_BRANCH" }, sourceSymbolIndex: named("CountWeather") });
  module.relocations.push({ target: { module: "base", address: module.symbols[named("WeatherProbeOriginal")].address, type: "OFFSET" },
    sourceSymbolIndex: module.symbols.length });
  module.symbols.push({ name: null, address: copy, size: query.code.length, type: "FUNCTION_THM", attributes: 0 });
  for (const { offset, target } of BATTLE_RUNTIME_SIGNATURES.ServerEvent_GetWeather.calls) {
    const address = battleBranchTarget(query.code, offset, query.address);
    assert.ok(resolver.matches(target, address));
    module.relocations.push({ target: { module: "base", address: copy + offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: module.symbols.length });
    module.symbols.push({ name: null, address, size: 0, type: "FUNCTION_THM", attributes: 4 });
  }
  module.metadata.PMCVersion = "1.0.0";
  module.metadata.PMCModulePriority = 4;
  stageCodeInjectionDll(project, "WeatherProbe.dll", writeRpm(module, { ident: "DLXF" }));
}

const snow = observation === "snow", snowscape = which === "snowscape";
const iceBody = which === "ice-body";
const move = snowscape ? 258 : iceBody || spriteTest ? 150 : which === "fire" ? 172 : snow || which === "physical" ? 33 : 94;
const player = { speciesId: profiling ? 365 : iceBody ? 321 : 386, level: 50, moves: [move],
  ...(withRecipes ? { itemId: 238 } : which === "berry" ? { itemId: 153 } : {}), currentHp: profiling ? 170 : 100, status: snow ? 0 : 3,
  abilityId: withRecipes ? 165 : which === "guard" ? 98 : which === "cloud" ? 13 : iceBody ? 115 : 46 };
const enemy = { speciesId: profiling ? 365 : snow && !snowscape ? 91 : 321, level: iceBody ? 15 : profiling ? 43 : 55,
  moves: profiling || iceBody ? [33] : [150], abilityId: withRecipes || (snow && !snowscape) ? 117 : 46 };
const battleType = profiling ? "Doubles" : "Singles";
patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType, trainer: { ai: 0, team: profiling ? [enemy, enemy] : [enemy] } }));
const downloads = await buildTestBattleDownloads(project, 2);
const save = rawSaveBytesFromDesmumeDsv(downloads.saveBytes);
const raw = patchHarnessSave(profiling ? patchTestBattleSaveMoveAnimations(save, getTestBattleConfigForProject(project), false) : save, project,
  parseHarnessConfig({ trainerId: 2, player: { team: profiling ? [player, { ...player, level: 48 }] : [player] } }));
const texts = ["Deoxys is hurt", "started to snow!", "started to hail!", "Deoxys is buffeted"];
let queryCounts: number[] = [];
const spriteSamples: { frozen: boolean; pose: string }[] = [];
const { entries, seenTexts } = await runLoggedBattleBytes(downloads.romBytes, raw, { battleType },
  { tag: snow ? "SNOW" : "FRST", frames: 5300, shots: false, logCapacity: 80, texts,
    sampleMemory: spriteTest ? memory => {
      // View work +0x190 owns the active sprite slots. Only sample the
      // player's Deoxys while its native status tint is active.
      const word = (address: number) => {
        const offset = address - 0x02000000;
        return offset >= 0 && offset + 4 <= memory.length ? memory.readUInt32LE(offset) : 0;
      };
      const sprites = word(word(game.battleViewGlobal) + 0x190);
      for (let index = 0; index < 14; index += 1) {
        const slot = sprites + 8 + index * 0x5c;
        if (word(slot + 0x2c) !== 386 || !(word(slot + 0x4c) & 2)) continue;
        const sprite = word(slot);
        const cursor = word(sprite + 0x34);
        if (!cursor) continue;
        spriteSamples.push({ frozen: Boolean(word(sprite + 0x140) & 0x400), pose: `${cursor}:${word(sprite + 0x44)}` });
      }
    } : undefined,
    observeMemory: profiling ? memory => {
      for (let offset = memory.indexOf("WBCT"); offset !== -1; offset = memory.indexOf("WBCT", offset + 4)) {
        if (offset + 52 > memory.length) continue;
        const turns = Array.from({ length: 12 }, (_, i) => memory.readUInt32LE(offset + 4 + 4 * i));
        if (turns.every(value => value < 10000) && turns.some(value => value > 0)) queryCounts = turns;
      }
    } : undefined,
  });
if (spriteTest) {
  const expectedFrozen = which === "sprite-v1";
  const expected = spriteSamples.filter(sample => sample.frozen === expectedFrozen);
  assert.ok(expected.length >= 10 && expected.length > spriteSamples.length * 0.9,
    `Expected the persistent Freeze stop flag to be ${expectedFrozen} in live battle (${expected.length}/${spriteSamples.length} samples).`);
  const poses = new Set(expected.map(sample => sample.pose));
  if (!expectedFrozen) assert.ok(poses.size > 4, "The frostbitten sprite's native animation must advance.");
  assert.ok(seenTexts.includes("Deoxys is hurt"), "The Frostbite residual sequence still runs.");
  console.log(project.session.baseVersion, which, JSON.stringify({ samples: spriteSamples.length, expected: expected.length, poses: poses.size }));
  process.exit(0);
}
if (profiling) {
  assert.ok(queryCounts.filter(count => count > 0).length >= 3, "Capture at least two complete turns.");
  assert.ok(seenTexts.includes(which === "count-snow" ? "started to snow!" : "started to hail!"));
  console.log(JSON.stringify(queryCounts.filter(count => count > 0).slice(0, 2)));
  process.exit(0);
}
console.log(project.session.baseVersion, which, JSON.stringify({ seenTexts, entries: entries.slice(0, 16) }));
if (which === "frostbite" || which === "guard") {
  assert.ok(entries.some(row => (row.event === 3 || row.event === 0xd1) && row.a === 0 && row.x === 3 &&
    row.value === 2 && row.move > 0 && row.y === Math.floor(row.move / 2)), "Frostbitten Deoxys must execute a special move at half damage.");
  assert.ok(entries.some(row => row.event === 0xd2 && row.a === 0 && row.value === 7), "Frostbite residual must use max HP.");
  assert.equal(entries.some(row => row.event === 0xd3 && row.a === 0), which !== "guard", "Magic Guard must prevent the residual hit.");
  assert.equal(seenTexts.includes("Deoxys is hurt"), which !== "guard");
}
if (withRecipes) {
  assert.ok(seenTexts.includes("started to snow!"));
  assert.ok(entries.some(row => (row.event === 3 || row.event === 0xd1) && row.a === 0 && row.x === 3 &&
    row.value === 2 && row.move > 330 && row.y === Math.floor(row.move / 2)), "Move power and held-item Sp. Atk should boost damage before Frostbite.");
}
if (which === "fire" || which === "berry") {
  assert.ok(entries.some(row => (row.event === 3 || row.event === 0xd1) && row.a === 0 && row.x === 0),
    "The native cure must remove the status.");
}
if (which === "fire") {
  assert.ok(!entries.some(row => row.event === 0xd2 && row.a === 0));
}
if (which === "physical") {
  assert.ok(entries.some(row => (row.event === 3 || row.event === 0xd1) && row.a === 0 && row.x === 3 &&
    row.value === 1 && row.move === row.y && row.move > 0), "Frostbite must leave physical damage at full strength.");
}
if (which === "snow") {
  assert.ok(entries.some(row => row.x === 3 && (row.value & 0xffff) === 9 && row.y === Math.floor(row.move * 1.5)),
    "Cloyster must receive the Snow bonus in the native Defense calculation.");
}
if (which === "cloud") {
  assert.ok(entries.some(row => row.x === 0 && (row.value & 0xffff) === 9 && row.y === row.move),
    "Cloud Nine must suppress the Ice Defense bonus.");
  assert.ok(!entries.some(row => row.x === 3 && row.y > row.move));
}
if (iceBody) {
  const hp = entries.filter(row => row.a === 0 && row.x === 3).map(row => row.value >>> 16);
  assert.ok(hp[0] === 100 && hp.some(value => value > 100), "Ice Body must heal through the native weather event.");
}
if (snowscape) assert.ok(seenTexts.includes("started to snow!"), "Snowscape must complete and start Snow.");
assert.ok(!seenTexts.includes("Deoxys is buffeted"), "Snow must not apply chip damage.");
