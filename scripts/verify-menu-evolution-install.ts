import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import {
  MENU_EVOLUTION_MESSAGE_BANK_ID,
  MENU_EVOLUTION_CONFIG_VERSION,
  detectMenuEvolutionCompatibility,
  getMenuEvolutionInstallStatus,
  installMenuEvolution,
  isKoMoveEditorAvailable,
} from "../src/pokeweb/menuEvolutionModel";
import { installBattleLog } from "../src/pokeweb/battleLogModel";
import { getTextBank, parseTextEntryId } from "../src/pokeweb/textModel";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: npm run menuevolution:verify-rom -- cleanblack2.nds|cleanwhite2.nds");

const romBytes = new Uint8Array(await readFile(romPath));
const rom = new NintendoDSRom(romBytes);
if (rom.idCode !== "IREO" && rom.idCode !== "IRDO") {
  throw new Error(`Expected US Black 2 or White 2, got ${rom.idCode}.`);
}
const version = rom.idCode === "IREO" ? "B2" : "W2";
const counterFilename = version === "B2" ? "Black2UpgradeBattleCounters.dll" : "White2UpgradeBattleCounters.dll";
const menuFilename = `MenuEvolution${version}.dll`;
const project = await loadProjectFromRomBytes(romBytes, basename(romPath), { selectedNarcs: ["message_texts", "evolutions"] });
const compatibility = detectMenuEvolutionCompatibility(project);
if (!compatibility.compatible) throw new Error(compatibility.message);
// The new app transition must fail closed if the underlying retail callback
// or move-reminder layout has been changed by another patch.
const tutor = rom.loadArm9Overlays([258]).get(258)!;
const stagedTutor = project.overlays[258];
const incompatibleTutor = (stagedTutor ?? tutor.data).slice();
const tutorSignature = compatibility.checks.find((check) => check.overlayId === 258)!;
incompatibleTutor[tutorSignature.address - tutor.ramAddress] ^= 1;
project.overlays[258] = incompatibleTutor;
if (detectMenuEvolutionCompatibility(project).compatible) throw new Error("Modified reminder callback was not rejected.");
if (stagedTutor) project.overlays[258] = stagedTutor;
else delete project.overlays[258];
// The candidate hook alone was insufficient in 1.3.0. Guard the distinct
// battle-return resolver as well before accepting an install/update.
const battleReturn = rom.loadArm9Overlays([166]).get(166)!;
const stagedBattleReturn = project.overlays[166];
const incompatibleBattleReturn = (stagedBattleReturn ?? battleReturn.data).slice();
const resolverSignature = compatibility.checks.find((check) => check.label === "Post-battle evolution resolver")!;
incompatibleBattleReturn[resolverSignature.address - battleReturn.ramAddress] ^= 1;
project.overlays[166] = incompatibleBattleReturn;
if (detectMenuEvolutionCompatibility(project).compatible) throw new Error("Modified post-battle evolution resolver was not rejected.");
if (stagedBattleReturn) project.overlays[166] = stagedBattleReturn;
else delete project.overlays[166];
const originalKoFile = rom.filenames.idOf("battlelog_ko/learnsets.narc");
const originalKoLearnsets = originalKoFile === undefined ? undefined : new NARC(rom.files[originalKoFile]!);

const previousFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  const fileName = url.pathname.split("/").pop() ?? "";
  try {
    return new Response(new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${fileName}`, import.meta.url))));
  } catch {
    return new Response(undefined, { status: 404 });
  }
}) as typeof fetch;

try {
  await installBattleLog(project);
  const first = await installMenuEvolution(project);
  const second = await installMenuEvolution(project);
  if (second.messageEntryId !== first.messageEntryId) throw new Error("Idempotent reinstall changed the Evolve message ID.");
  if (second.relearnMessageEntryId !== first.relearnMessageEntryId) throw new Error("Idempotent reinstall changed the RELEARN message ID.");
  if (!isKoMoveEditorAvailable(project)) throw new Error("KO Moves editor did not become available after installing its current runtimes.");

  for (const label of ["EVOLVE", "RELEARN"]) {
    const matchingText = getTextBank(project, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID)
      .filter((entry) => entry[1] === label);
    if (matchingText.length !== 1) throw new Error(`Expected one ${label} message, found ${matchingText.length}.`);
  }

  const exportedBytes = await exportModifiedRom(project);
  const exported = new NintendoDSRom(exportedBytes);
  const installed = exported.getFileByName(`patches/${menuFilename}`);
  if (installed.length === 0) throw new Error(`${menuFilename} was not exported.`);
  if (exported.getFileByName(`patches/${counterFilename}`).length === 0) throw new Error(`${counterFilename} was not exported.`);
  const koLearnsets = new NARC(exported.getFileByName(first.koLearnsetPath));
  if (koLearnsets.files.length !== first.koLearnsetMembers) {
    throw new Error(`Exported KO learnset has ${koLearnsets.files.length} members; expected ${first.koLearnsetMembers}.`);
  }
  for (let member = 0; member < (originalKoLearnsets?.files.length ?? 0); member += 1) {
    if (!Buffer.from(koLearnsets.files[member]!).equals(Buffer.from(originalKoLearnsets!.files[member]!))) {
      throw new Error(`Updating the companion changed existing KO learnset member ${member}.`);
    }
  }
  const configuredId = readConfiguredMessageId(installed);
  if (configuredId !== first.messageEntryId) {
    throw new Error(`Exported configuration uses message ${configuredId}; expected ${first.messageEntryId}.`);
  }
  const relearnId = readConfiguredMessageId(installed, true);
  if (relearnId !== first.relearnMessageEntryId) throw new Error("Exported RELEARN message ID differs from the installer result.");
  const reloaded = await loadProjectFromRomBytes(exportedBytes, `menu-evolution-${version}.nds`, { selectedNarcs: ["message_texts"] });
  const reloadedStatus = getMenuEvolutionInstallStatus(reloaded);
  if (!reloadedStatus.upToDate) {
    throw new Error(`Reloaded exported ROM did not recognize the current Menu Evolution runtime and KO learnset: ${JSON.stringify(reloadedStatus)}`);
  }
  if (!isKoMoveEditorAvailable(reloaded)) throw new Error("Reloaded exported ROM did not expose the KO Moves editor.");
  const exportedText = getTextBank(reloaded, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID)
    .find((entry) => parseTextEntryId(entry[0]).entry === configuredId)?.[1];
  if (exportedText !== "EVOLVE") {
    throw new Error(`Exported message ${configuredId} is ${JSON.stringify(exportedText)}, not EVOLVE.`);
  }
  const relearnText = getTextBank(reloaded, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID)
    .find((entry) => parseTextEntryId(entry[0]).entry === relearnId)?.[1];
  if (relearnText !== "RELEARN") throw new Error(`Exported message ${relearnId} is not RELEARN.`);
  console.log(`${version} Menu Evolution install passed: ${compatibility.passed}/${compatibility.checks.length} hook/transition checks, incompatible reminder rejection, PMC/counter dependency, EVOLVE ${first.messageEntryId} and RELEARN ${relearnId}, ${koLearnsets.files.length} preserved KO learnset members, idempotent staging, and export/reload.`);
} finally {
  globalThis.fetch = previousFetch;
}

function readConfiguredMessageId(bytes: Uint8Array, relearn = false): number {
  const marker = new TextEncoder().encode("MEVOMSG\0");
  let found = -1;
  for (let offset = 0; offset + marker.length <= bytes.length; offset += 1) {
    if (marker.every((value, index) => bytes[offset + index] === value)) {
      if (found !== -1) throw new Error("Exported Menu Evolution DLL contains duplicate configuration markers.");
      found = offset;
    }
  }
  if (found < 0) throw new Error("Exported Menu Evolution DLL has no configuration marker.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(found + 8, true) !== MENU_EVOLUTION_CONFIG_VERSION) throw new Error("Exported DLL has an old configuration layout.");
  const field = found + (relearn ? 14 : 10);
  const id = view.getUint16(field, true);
  if (view.getUint16(field + 2, true) !== (id ^ 0xffff)) throw new Error("Exported message ID has an invalid complement.");
  return id;
}
