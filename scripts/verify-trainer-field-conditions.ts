import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { addTrainer } from "../src/pokeweb/trainerModel";
import {
  installTrainerFieldConditions, getTrainerFieldConditionsStatus, getTrainerFieldConditions, updateTrainerFieldCondition,
  TRAINER_FIELD_CONDITIONS_PATH,
} from "../src/pokeweb/trainerFieldConditionsModel";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: vite-node scripts/verify-trainer-field-conditions.ts input.nds new-output.nds");
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  return url.protocol === "file:" ? new Response(new Uint8Array(await readFile(url))) : originalFetch(input, init);
}) as typeof fetch;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
try {
  const bytes = new Uint8Array(await readFile(input));
  const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["trdata", "trpok"] });
  assert(getTrainerFieldConditionsStatus(project).compatible, getTrainerFieldConditionsStatus(project).message);
  const game = project.session.baseVersion;
  const arm9Before = project.arm9.slice();
  const wasUpdate = getTrainerFieldConditionsStatus(project).updateAvailable;
  const previous = getTrainerFieldConditions(project, 2);
  await installTrainerFieldConditions(project);
  assert(getTrainerFieldConditionsStatus(project).installed, "Runtime was not installed");
  assert(!getTrainerFieldConditionsStatus(project).updateAvailable, "Runtime was not updated");
  assert(JSON.stringify(getTrainerFieldConditions(project, 2)) === JSON.stringify(previous), "Update lost authored conditions");
  for (const [field, value] of [["weather", 3], ["fields_1", 1], ["opponent_0", 1], ["opponent_1", 1], ["opponent_2", 1], ["opponent_4", 1], ["opponent_5", 1], ["playerSpikes", 3], ["opponentToxicSpikes", 2]] as const)
    updateTrainerFieldCondition(project, 2, field, value);
  const authored = getTrainerFieldConditions(project, 2);
  assert(getTrainerFieldConditions(project, 1).weather === 0, "Another trainer changed");
  await installTrainerFieldConditions(project);
  assert(JSON.stringify(getTrainerFieldConditions(project, 2)) === JSON.stringify(authored), "Reinstall lost authored data");
  const clone = addTrainer(project, 2);
  assert(JSON.stringify(getTrainerFieldConditions(project, clone.id)) === JSON.stringify(authored), "Cloning lost conditions");
  const outputBytes = await exportModifiedRom(project);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, outputBytes, { flag: "wx" });
  const reloaded = await loadProjectFromRomBytes(outputBytes, basename(output), { selectedNarcs: ["trdata", "trpok"] });
  const status = getTrainerFieldConditionsStatus(reloaded);
  assert(status.installed && status.compatible, status.message);
  assert(JSON.stringify(getTrainerFieldConditions(reloaded, 2)) === JSON.stringify(authored), "Export/reload lost conditions");
  delete reloaded.originalRomBytes; // Autosave releases the full source ROM in the browser.
  assert(getTrainerFieldConditionsStatus(reloaded).installed && getTrainerFieldConditionsStatus(reloaded).compatible, "Autosave lost runtime recognition");
  updateTrainerFieldCondition(reloaded, 2, "opponent_0", 0);
  assert(getTrainerFieldConditions(reloaded, 2).opponent === (authored.opponent & ~1), "Imported table cannot be edited");
  assert(JSON.stringify(getTrainerFieldConditions(reloaded, clone.id)) === JSON.stringify(authored), "Editing affected another trainer");
  const outputRom = new NintendoDSRom(outputBytes, { fileData: "view" });
  assert(outputRom.getFileByName(TRAINER_FIELD_CONDITIONS_PATH)?.length, "Missing config file");
  assert(outputRom.getFileByName(`patches/TrainerFieldConditions${game}.dll`)?.length, "Missing DLL");
  // Conflicting raw overlay imports are rejected even when an original overlay is cached.
  const { loadOverlayTable } = await import("../src/nds/code");
  const native = loadOverlayTable(outputRom.arm9OverlayTable, (_, id) => outputRom.files[id], new Set([167])).get(167)!;
  const edited = native.data.slice(); edited[(game === "B2" ? 0x0219f59a : 0x0219f5da) - native.ramAddress] ^= 1;
  reloaded.overlays[167] = edited;
  assert(!getTrainerFieldConditionsStatus(reloaded).compatible, "Modified first-turn hook accepted");
  console.log(JSON.stringify({ profile: game === "B2" ? "US Black 2" : "US White 2", installed: true, updatedPreviousVersion: wasUpdate, config: authored, clonedTrainer: clone.id,
    exportReload: "passed", importedEditing: "passed", conflictRejection: "passed", originalArm9Bytes: arm9Before.length, output }, null, 2));
} finally { globalThis.fetch = originalFetch; }
