/** Exercise the app's actual DLL parser and staging path with isolated projects. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseRpm } from "../../../src/pokeweb/rpm";
import { stageCodeInjectionDll, listCodeInjectionDlls, validateCodeInjectionDll } from "../../../src/pokeweb/pmcModel";
import { configureLearnsetViewerDll, configureLearnsetInfoDll, LEARNSET_INFO_MESSAGES } from "../../../src/pokeweb/learnsetViewerModel";
import { configureCustomUi } from "../../../src/customUi/runtimeConfig";
import type { ProjectState } from "../../../src/pokeweb/projectStore";

type Game = "B2" | "W2";
const receipt = JSON.parse(readFileSync(new URL("./build/build-report.json", import.meta.url), "utf8"));

function project(game: Game): ProjectState {
  return {
    session: { romName: "ruby-patch-test", baseVersion: game, baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "isolated fixture", idCode: game === "B2" ? "IREO" : "IRDO", fileName: "fixture.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: { pmc: { overlayId: 344, overlayPath: "overlay/overlay_0344.bin", gameId: game } },
  };
}

const results = [];
for (const group of ["Menu", "Viewer"] as const) {
for (const game of ["B2", "W2"] as const) {
  const name = `Learnset${group}${game}.dll`;
  const bytes = new Uint8Array(readFileSync(new URL(`./build/candidates/${name}`, import.meta.url)));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, receipt.outputs[name].sha256, "rebuild required: module changed");
  validateCodeInjectionDll(bytes);
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  assert.equal(rpm.metadata.PMCGameID, game);
  const hooks = rpm.relocations.filter(r => r.target.module !== "base");
  assert.equal(hooks.length, group === "Menu" ? 3 : 25);
  assert.equal(rpm.metadata.PMCModulePriority, 4);
  assert(rpm.symbols.every(symbol => symbol.name === null && !(symbol.attributes & 2)));
  let configured = configureLearnsetViewerDll(bytes, { menu: 1, empty: 2, error: 3 });
  if (group === "Viewer") configured = configureLearnsetInfoDll(configured, LEARNSET_INFO_MESSAGES.map((_, i) => i + 100));
  configureCustomUi(configured, true, 4, true);
  const isolated = project(game);
  const result = stageCodeInjectionDll(isolated, name, bytes);
  stageCodeInjectionDll(isolated, name, bytes);
  assert.equal(result.path, `patches/${name}`);
  assert.equal(result.version, "1.5.0");
  assert.deepEqual(isolated.fileSystem?.additions?.[result.path], bytes);
  assert.equal(listCodeInjectionDlls(isolated).length, 1);
  const wrongGame = project(game === "B2" ? "W2" : "B2");
  assert.throws(() => stageCodeInjectionDll(wrongGame, name, bytes), /This DLL is for/);
  assert.equal(wrongGame.fileSystem, undefined);
  results.push({ game, group, sha256, staged: true, duplicateSuppressed: true, wrongGameRejected: true });
  console.log(`${game} ${group}: Ruby candidate accepted by Pokeweb; duplicate and wrong-game checks passed`);
}
}
writeFileSync(new URL("./build/import-verification.json", import.meta.url), JSON.stringify({ results, fixture: "isolated project state; no user ROM" }, null, 2) + "\n");
