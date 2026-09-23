import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { getPmcInstallStatus } from "../src/pokeweb/pmcModel";
import { detectSpecifyTrainerNaturesPatch, specifyTrainerNatures } from "../src/pokeweb/romPatchModel";
import { detectTrainerNaturePatchState, hasTrainerNaturePmcSetupSignatures } from "../src/pokeweb/trainerNaturePatch";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error("Usage: vite-node scripts/verify-trainer-nature-install.ts input.nds output.nds");
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  return url.protocol === "file:"
    ? new Response(new Uint8Array(await readFile(url)))
    : originalFetch(input, init);
}) as typeof fetch;

try {
  const inputBytes = new Uint8Array(await readFile(inputPath));
  const project = await loadProjectFromRomBytes(inputBytes, basename(inputPath), { selectedNarcs: [] });
  const before = detectSpecifyTrainerNaturesPatch(project);
  if (before !== "legacy" && before !== "unpatched") throw new Error(`Unsupported input patch state: ${before}`);
  if (!hasTrainerNaturePmcSetupSignatures(project.arm9, project.session.baseVersion)) {
    throw new Error("The native trainer Pokémon level reads or creation calls do not match this runtime.");
  }
  const result = await specifyTrainerNatures(project);
  if (result.status !== "applied" || detectSpecifyTrainerNaturesPatch(project) !== "patched") {
    throw new Error("PMC trainer nature install did not update the project status.");
  }
  if (detectTrainerNaturePatchState(project.arm9, project.session.baseVersion) !== "unpatched") {
    throw new Error("Legacy inline trainer nature call sites remain in ARM9.");
  }
  const repeated = await specifyTrainerNatures(project);
  if (repeated.status !== "already-applied") throw new Error("PMC trainer nature reinstall was not idempotent.");
  const outputBytes = await exportModifiedRom(project);
  await writeFile(outputPath, outputBytes);
  const reloaded = await loadProjectFromRomBytes(outputBytes, basename(outputPath), { selectedNarcs: [] });
  if (detectSpecifyTrainerNaturesPatch(reloaded) !== "patched") throw new Error("Exported ROM did not retain the PMC trainer nature runtime.");
  if (detectTrainerNaturePatchState(reloaded.arm9, reloaded.session.baseVersion) !== "unpatched") {
    throw new Error("Exported ROM retained the legacy inline trainer nature call sites.");
  }
  const installed = new NintendoDSRom(outputBytes).getFileByName(`patches/TrainerNature${project.session.baseVersion}.dll`);
  if (!installed?.length) throw new Error("Exported ROM is missing the trainer nature DLL.");
  const bundled = new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/TrainerNature${project.session.baseVersion}.dll`, import.meta.url)));
  if (!Buffer.from(installed).equals(Buffer.from(bundled))) throw new Error("Exported trainer nature DLL differs from the bundled runtime.");
  console.log(JSON.stringify({ version: project.session.baseVersion, before, after: "patched", pmc: getPmcInstallStatus(reloaded), dllBytes: installed.length, result: result.summary }));
} finally {
  globalThis.fetch = originalFetch;
}
