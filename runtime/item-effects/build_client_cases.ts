/** Exercise native trapping queries with edited items on the opposing battler. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureItemRuleSets, ITEM_EFFECTS_DLL_PATH } from "../../src/pokeweb/itemEffectsModel";
import { configureHarnessRuntime, parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { NintendoDSRom } from "../../src/nds/rom";
import { parseRpm } from "../../src/pokeweb/rpm";
import type { ItemRuleEffect } from "../../src/pokeweb/itemRules";
const [input, out] = process.argv.slice(2);
if (!out) throw new Error("Usage: PRODUCTION_V4.nds OUTPUT_DIRECTORY");
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets are permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
await mkdir(out, { recursive: true });
const bytes = new Uint8Array(await readFile(input)), save = rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
const native = (id: number): ItemRuleEffect => ({ kind: `native:${id}`, value: -1 });
const noEffect: ItemRuleEffect = { kind: "healFlat", value: 1 };
const specs = [
  { label: "shed-shell-shadow-tag", effect: { kind: "escapeTrap", value: 1 }, trap: 23, expected: 4 },
  { label: "shadow-tag-control", effect: noEffect, trap: 23, expected: 0 },
  { label: "shed-shell-condition-fails", effect: { kind: "escapeTrap", value: 1 }, trap: 23, expected: 0, falseCondition: true },
  { label: "balloon-arena-trap", effect: native(541), trap: 71, expected: 4 },
  { label: "arena-trap-control", effect: noEffect, trap: 71, expected: 0 },
  { label: "iron-ball-grounds-flying", effect: native(278), trap: 71, expected: 0, species: 16 },
  { label: "balloon-identity-replaced", effect: noEffect, trap: 71, expected: 0, item: 541 },
  { label: "shell-identity-replaced", effect: noEffect, trap: 23, expected: 0, item: 295 },
] as const;
const cases = [];
for (const spec of specs) {
  const project = await loadProjectFromRomBytes(bytes, "client-items.nds", { selectedNarcs: ["items", "personal", "moves", "trdata", "trpok"] });
  const itemId = "item" in spec ? spec.item : 85;
  await configureItemRuleSets(project, [{ itemId, rules: { effects: [spec.effect as ItemRuleEffect], conditions: "falseCondition" in spec ? { kind: "type", value: 5 } : { kind: "group", mode: "all", children: [] }, consumable: false } }]);
  const rule = patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType: "Singles", trainer: { ai: 0, team: [{ speciesId: "species" in spec ? spec.species : 320, level: 50, moves: [150], itemId, abilityId: 70 }] } }));
  await prepareBw2TestBattleCodeInjection(project);
  stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url))), 2, rule));
  const fixture = patchHarnessSave(save, project, parseHarnessConfig({ trainerId: 2, player: { team: [{ speciesId: 1, level: 50, moves: [150], itemId: 0, abilityId: spec.trap }] } }));
  for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
  const exported = await exportModifiedRom(project, { forDsi: false }), rom = new NintendoDSRom(exported, { fileData: "view" });
  const rpm = parseRpm(rom.files[rom.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
  const hook = rpm.relocations.find(relocation => relocation.target.module === "167" && rpm.symbols[relocation.sourceSymbolIndex].name === "RuleCanSwitch")!.target.address;
  await writeFile(`${out}/${spec.label}.nds`, exported, { flag: "wx" }); await writeFile(`${out}/${spec.label}.sav`, fixture, { flag: "wx" });
  assert.equal(JSON.parse(String(rpm.metadata.PokewebItemRules)).length, "item" in spec ? 101 : 100);
  cases.push({ ...spec, itemId, hook, rule, sha256: createHash("sha256").update(exported).digest("hex") });
}
await writeFile(`${out}/client-cases.json`, JSON.stringify({ cases }, null, 2) + "\n");
console.log(`${cases.length} native trapping-query fixtures prepared.`);
