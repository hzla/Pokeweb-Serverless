import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getPokenavStatus, installPokenav, disablePokenav } from "../src/pokeweb/pokenavModel";
import { getLearnsetViewerStatus, installLearnsetViewer, uninstallLearnsetViewer, learnsetViewerPaths } from "../src/pokeweb/learnsetViewerModel";
import { ensureCGearButtons } from "../src/pokeweb/cgearButtonsModel";
import { installCGearQuickActions } from "../src/pokeweb/cgearQuickActionsModel";
import { newButton } from "../src/cgearButtons/document";
import { getEncounterRecord, updateEncounterField } from "../src/pokeweb/encounterModel";
import { getTextBank } from "../src/pokeweb/textModel";
import { installMenuEvolution, getMenuEvolutionInstallStatus } from "../src/pokeweb/menuEvolutionModel";
import { applyCustomUi, disableCustomUi } from "../src/pokeweb/customUiModel";
import { nativeLearnsetPreset } from "../src/customUi/nativeCatalog";
import { readCustomUiConfig } from "../src/customUi/runtimeConfig";
import { NintendoDSRom } from "../src/nds/rom";
import { getRomFileBytes } from "../src/pokeweb/fileSystemModel";

const input = process.argv[2]; if (!input) throw new Error("Pass a clean US B2/W2 ROM; optionally --output NEW.nds.");
const original = new Uint8Array(await readFile(input));
const project = await loadProjectFromRomBytes(original, basename(input), { selectedNarcs: ["message_texts", "encounters", "personal", "evolutions"] });
let failViewer = false;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  if (failViewer && /LearnsetViewer.*\.dll$/u.test(url.pathname)) return new Response(undefined, { status: 503 });
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
async function companions() {
  await installMenuEvolution(project);
  project.customUi = nativeLearnsetPreset(); await applyCustomUi(project);
  assert(!getLearnsetViewerStatus(project).installed, "Custom UI unexpectedly enabled the party command");
}
if (process.argv.includes("--companions-first")) await companions();
const tutorText = structuredClone(getTextBank(project, "message_texts", 401));
assert(getPokenavStatus(project).compatible, getPokenavStatus(project).message);
await installPokenav(project);
assert(getPokenavStatus(project).enabled);
assert(!getLearnsetViewerStatus(project).installed, "Pokenav unexpectedly enabled the party command");
assert.deepEqual(getTextBank(project, "message_texts", 401).slice(0, tutorText.length), tutorText);
const ids = structuredClone(project.codeInjection!.learnsetViewer);
await installPokenav(project); assert.deepEqual(project.codeInjection!.learnsetViewer, ids);
await disablePokenav(project); assert(!getPokenavStatus(project).enabled);
const buttons = ensureCGearButtons(project).document; buttons.buttons.push(newButton(buttons, "pokenav"));
const before = structuredClone({ fileSystem: project.fileSystem, codeInjection: project.codeInjection, narcs: project.narcs, texts: project.texts, changelog: project.actionChangelog });
failViewer = true;
await assert.rejects(() => installCGearQuickActions(project), /503/);
assert.deepEqual(project.fileSystem, before.fileSystem); assert.deepEqual(project.codeInjection, before.codeInjection);
assert.deepEqual(project.narcs, before.narcs); assert.deepEqual(project.texts, before.texts); assert.deepEqual(project.actionChangelog, before.changelog);
failViewer = false;
await installCGearQuickActions(project); assert(getPokenavStatus(project).enabled);
assert(!getLearnsetViewerStatus(project).installed);
if (process.argv.includes("--companions-last")) await companions();
if (process.argv.some(v => /^--companions-(first|last)$/u.test(v))) {
  assert(getMenuEvolutionInstallStatus(project).upToDate);
  assert(project.customUi?.installation?.enabled);
}
assert.throws(() => uninstallLearnsetViewer(project), /Pokenav/);
await installLearnsetViewer(project); assert(getLearnsetViewerStatus(project).installed);
await installPokenav(project); assert(getLearnsetViewerStatus(project).installed, "Pokenav disabled an existing party command");
updateEncounterField(project, 0, "spring_grass_slot_0", "25");
const editedSpecies = getEncounterRecord(project, 0).raw.spring_grass_slot_0;
const output = await exportModifiedRom(project);
const reopened = await loadProjectFromRomBytes(output, "pokenav-roundtrip.nds", { selectedNarcs: ["message_texts", "encounters", "personal"] });
assert.deepEqual(getPokenavStatus(reopened), getPokenavStatus(project));
assert(getLearnsetViewerStatus(reopened).installed);
assert.deepEqual(getEncounterRecord(reopened, 0).raw.spring_grass_slot_0, editedSpecies);
assert(reopened.cgearButtons?.document.buttons.some(b => b.action === "pokenav"));
if (project.customUi?.installation?.enabled) assert.deepEqual(reopened.customUi, project.customUi);
await disablePokenav(reopened); assert(!getPokenavStatus(reopened).enabled); assert(getLearnsetViewerStatus(reopened).installed);
if (reopened.customUi?.installation?.enabled) {
  await disableCustomUi(reopened);
  const rom = new NintendoDSRom(reopened.originalRomBytes!, { fileData: "view" }), path = learnsetViewerPaths(reopened.session.baseVersion as "B2" | "W2")[0];
  const config = () => readCustomUiConfig(getRomFileBytes(reopened, rom, rom.fileId(path)));
  const disabled = config(); assert(disabled?.validMenu && !disabled.enabled);
  await installPokenav(reopened); assert.deepEqual(config(), disabled, "Pokenav changed a disabled Custom UI's configuration or private menu ID");
}
const at = process.argv.indexOf("--output"); if (at >= 0) await writeFile(process.argv[at + 1]!, output, { flag: "wx" });
console.log(project.session.baseVersion, "Pokenav atomic installation, dependency roles, disable/re-enable, private text, edited encounters, and export/reopen passed");
