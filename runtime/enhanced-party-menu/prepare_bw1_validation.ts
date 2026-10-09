import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import summary from "../../src/assets/codeinjection/summaryStatViewerManifest.json";
import hud from "../../src/assets/codeinjection/battleTypeHudManifest.json";
import learnset from "../../src/assets/codeinjection/learnsetViewerManifest.json";
import party from "../../src/assets/codeinjection/menuEvolutionBw1Manifest.json";
import { NintendoDSRom } from "../../src/nds/rom";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { getBattleLogInstallStatus, installBattleLog } from "../../src/pokeweb/battleLogModel";
import { getSummaryStatViewerStatus, installSummaryStatViewer } from "../../src/pokeweb/summaryStatViewerModel";
import { getBattleTypeHudStatus, getMoveEffectivenessStatus, installBattleTypeHud, installMoveEffectiveness, type TypeIconVariant } from "../../src/pokeweb/battleTypeHudModel";
import { getLearnsetViewerStatus, installLearnsetViewer } from "../../src/pokeweb/learnsetViewerModel";
import { getMenuEvolutionInstallStatus, installMenuEvolution } from "../../src/pokeweb/menuEvolutionModel";
import { appendPokemonKoMove, updatePokemonKoMoveField } from "../../src/pokeweb/koMoveLearnsetModel";

const [input, output, style = "letters", order = "learnset-first", fixture] = process.argv.slice(2);
assert(input && output && resolve(input) !== resolve(output) && ["letters", "circular", "solid"].includes(style)
  && ["learnset-first", "menu-first"].includes(order) && (!fixture || fixture === "--fixtures"),
  "Usage: vite-node runtime/enhanced-party-menu/prepare_bw1_validation.ts INPUT.nds NEW-OUTPUT.nds [letters|circular|solid] [learnset-first|menu-first] [--fixtures]");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const source = new Uint8Array(await readFile(input)), sourceHash = hash(source);
const rom = new NintendoDSRom(source, { fileData: "view" });
const game = rom.idCode === "IRBO" ? "B" : rom.idCode === "IRAO" ? "W" : undefined;
assert(game && rom.data[0x1e] === 0, "Expected US BW1 revision 0.");
const profiles = [summary.games, hud.games, hud.moveGames, learnset.games, party.games];
const acceptance = profiles.map(p => ({ B: p.B.dsAccepted, W: p.W.dsAccepted }));
const project = await loadProjectFromRomBytes(source, basename(input), { selectedNarcs: ["message_texts", "learnsets", "evolutions"] });
const originalFetch = globalThis.fetch;
let exported: Uint8Array;
try {
  // These overrides affect only this validation process, never the saved profiles.
  for (const p of profiles) p.B.dsAccepted = p.W.dsAccepted = true;
  globalThis.fetch = async input => new Response(new Uint8Array(await readFile(new URL(`../../src/assets/codeinjection/${basename(new URL(String(input), "https://pokeweb.invalid").pathname)}`, import.meta.url))));
  await installBattleLog(project);
  assert.equal(getBattleLogInstallStatus(project).runtimeVersion, 8);
  await installSummaryStatViewer(project);
  await installBattleTypeHud(project, style as TypeIconVariant);
  await installMoveEffectiveness(project);
  const companions = order === "learnset-first" ? [installLearnsetViewer, installMenuEvolution] : [installMenuEvolution, installLearnsetViewer];
  for (const install of companions) await install(project);
  if (fixture) {
    // Isolated gameplay targets; no source ROM or save is written.
    for (const [species, method, target] of [[612, 4, 611], [381, 29, 380]] as const) {
      const record = new Uint8Array(42); record.set([method, 0, 1, 0, target & 255, target >> 8]);
      project.narcs.evolutions!.rawFiles[species!] = record; project.narcs.evolutions!.dirty.add(species!);
    }
    appendPokemonKoMove(project, 381);
    updatePokemonKoMoveField(project, 381, "move_id_0", "53");
    updatePokemonKoMoveField(project, 381, "ko_count_0", "1");
  }
  const statuses = (p: typeof project) => [getSummaryStatViewerStatus(p), getBattleTypeHudStatus(p),
    getMoveEffectivenessStatus(p), getLearnsetViewerStatus(p), getMenuEvolutionInstallStatus(p)];
  assert(statuses(project).every(s => s.installed && s.compatible));
  exported = await exportModifiedRom(project);
  const reopened = await loadProjectFromRomBytes(exported, basename(output), { selectedNarcs: ["message_texts", "learnsets", "evolutions"] });
  assert(statuses(reopened).every(s => s.installed && s.compatible && !s.canUninstall));
  assert.equal(getBattleLogInstallStatus(reopened).runtimeVersion, 8);
  assert.equal(getBattleTypeHudStatus(reopened).iconVariant, style);
  assert.deepEqual(getMoveEffectivenessStatus(reopened).colors, getMoveEffectivenessStatus(project).colors);
  assert.deepEqual(getSummaryStatViewerStatus(reopened).options, { includeEvs: true });
  assert.deepEqual(getLearnsetViewerStatus(reopened).messageIds, getLearnsetViewerStatus(project).messageIds);
  assert.equal(getMenuEvolutionInstallStatus(reopened).messageEntryId, getMenuEvolutionInstallStatus(project).messageEntryId);
  // Reinstallation must retain every original module's FAT entry.
  const result = new NintendoDSRom(exported, { fileData: "view" });
  await installBattleLog(reopened); await installSummaryStatViewer(reopened);
  await installMoveEffectiveness(reopened); await installBattleTypeHud(reopened, style as TypeIconVariant);
  for (const install of [...companions].reverse()) await install(reopened);
  for (const module of reopened.codeInjection!.modules!) {
    if (module.target === "patches") assert(reopened.fileSystem!.replacements[result.fileId(module.path)], module.path);
  }
} finally {
  profiles.forEach((p, i) => { p.B.dsAccepted = acceptance[i].B; p.W.dsAccepted = acceptance[i].W; });
  globalThis.fetch = originalFetch;
}
assert.equal(hash(new Uint8Array(await readFile(input))), sourceHash, "Source ROM changed.");
await writeFile(output, exported!, { flag: "wx" });
console.log(`${game}: all five BW1 modules plus runtime-8 Battle Log exported through normal installers (${style}, ${order}); this export does not certify new gameplay acceptance.`);
