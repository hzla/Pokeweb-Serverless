/** Prepare a separate trainer-2 mechanic fixture. Existing ROMs/saves are never overwritten. */
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { getTrainerFieldConditionsStatus, updateTrainerFieldCondition, TRAINER_GLOBAL_CONDITIONS, TRAINER_SIDE_CONDITIONS } from "../../src/pokeweb/trainerFieldConditionsModel";

const [input, saveInput, fixture, output, mode] = process.argv.slice(2);
if (!input || !saveInput || !fixture || !output || !output.endsWith(".nds"))
  throw new Error("Usage: vite-node runtime/trainer-field-conditions/fixture.ts roundtrip.nds save.sav fixture.json new-output.nds [--all-conditions]");
if (mode !== undefined && mode !== "--all-conditions") throw new Error("Unknown fixture mode");
const originalFetch = globalThis.fetch;
const build = await mkdtemp(`${tmpdir()}/trainer-fields-fixture-`);
const created: string[] = [];
try {
  globalThis.fetch = (async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "file:") throw new Error("Fixture builder only reads local assets");
    return new Response(new Uint8Array(await readFile(url)));
  }) as typeof fetch;
  const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), basename(input),
    { selectedNarcs: ["message_texts", "personal", "moves", "trdata", "trpok"] });
  const status = getTrainerFieldConditionsStatus(project);
  if (!status.compatible || !status.installed) throw new Error(status.message);
  if (mode === "--all-conditions") {
    for (const { id } of TRAINER_GLOBAL_CONDITIONS) updateTrainerFieldCondition(project, 2, `fields_${id}`, 1);
    for (const side of ["player", "opponent"]) {
      for (const { id } of TRAINER_SIDE_CONDITIONS) updateTrainerFieldCondition(project, 2, `${side}_${id}`, 1);
      updateTrainerFieldCondition(project, 2, `${side}Spikes`, 3);
      updateTrainerFieldCondition(project, 2, `${side}ToxicSpikes`, 2);
    }
  }
  const game = project.session.baseVersion;
  const config = parseHarnessConfig(JSON.parse(await readFile(fixture, "utf8")));
  const rule = patchHarnessTrainer(project, config);
  if (config.trainerId !== 2 || rule !== 0) throw new Error("This fixture trigger is trainer 2, Singles only");
  const save = patchHarnessSave(rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(saveInput))), project, config);
  for (const [name, store] of Object.entries(project.narcs))
    if (!["trdata", "trpok", "personal"].includes(name) || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
  await prepareBw2TestBattleCodeInjection(project);
  execFileSync(process.env.PYTHON ?? "python3", [fileURLToPath(new URL("fixture.py", import.meta.url)), "--game", game, "--out", build]);
  stageCodeInjectionDll(project, `BattleHarness${game}.dll`, new Uint8Array(await readFile(`${build}/BattleHarness${game}.dll`)));
  const bytes = await exportModifiedRom(project, { preserveOriginalLength: true });
  await mkdir(dirname(output), { recursive: true });
  for (const [path, data] of [[output, bytes], [output.slice(0, -4) + ".sav", save]] as const) {
    await writeFile(path, data, { flag: "wx" }); created.push(path);
  }
  created.length = 0;
  console.log(`Prepared ${game} trainer-2 fixture`);
} finally {
  globalThis.fetch = originalFetch;
  await Promise.all(created.map(path => rm(path, { force: true })));
  await rm(build, { recursive: true, force: true });
}
