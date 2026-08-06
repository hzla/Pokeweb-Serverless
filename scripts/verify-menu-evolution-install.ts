import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import {
  MENU_EVOLUTION_MESSAGE_BANK_ID,
  detectMenuEvolutionCompatibility,
  installMenuEvolution,
} from "../src/pokeweb/menuEvolutionModel";
import { installBundledPmc, stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
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
const project = await loadProjectFromRomBytes(romBytes, basename(romPath), { selectedNarcs: ["message_texts"] });
const compatibility = detectMenuEvolutionCompatibility(project);
if (!compatibility.compatible) throw new Error(compatibility.message);

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
  await installBundledPmc(project);
  const counterBytes = new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${counterFilename}`, import.meta.url)));
  stageCodeInjectionDll(project, counterFilename, counterBytes, "patches");
  const first = await installMenuEvolution(project);
  const second = await installMenuEvolution(project);
  if (second.messageEntryId !== first.messageEntryId) throw new Error("Idempotent reinstall changed the Evolve message ID.");

  const matchingText = getTextBank(project, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID)
    .filter((entry) => entry[1].trim().toLowerCase() === "evolve");
  if (matchingText.length !== 1) throw new Error(`Expected one Evolve message, found ${matchingText.length}.`);

  const exportedBytes = await exportModifiedRom(project);
  const exported = new NintendoDSRom(exportedBytes);
  const installed = exported.getFileByName(`patches/${menuFilename}`);
  if (installed.length === 0) throw new Error(`${menuFilename} was not exported.`);
  if (exported.getFileByName(`patches/${counterFilename}`).length === 0) throw new Error(`${counterFilename} was not exported.`);
  const configuredId = readConfiguredMessageId(installed);
  if (configuredId !== first.messageEntryId) {
    throw new Error(`Exported configuration uses message ${configuredId}; expected ${first.messageEntryId}.`);
  }
  const reloaded = await loadProjectFromRomBytes(exportedBytes, `menu-evolution-${version}.nds`, { selectedNarcs: ["message_texts"] });
  const exportedText = getTextBank(reloaded, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID)
    .find((entry) => parseTextEntryId(entry[0]).entry === configuredId)?.[1];
  if (exportedText?.trim().toLowerCase() !== "evolve") {
    throw new Error(`Exported message ${configuredId} is ${JSON.stringify(exportedText)}, not Evolve.`);
  }
  console.log(`${version} Menu Evolution install passed: ${compatibility.passed}/${compatibility.checks.length} hooks, PMC/counter dependency, configured Evolve text ${first.messageEntryId}, field-script counters, silent party-menu return, idempotent staging, and ROM export.`);
} finally {
  globalThis.fetch = previousFetch;
}

function readConfiguredMessageId(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode("MEVOMSG\0");
  let found = -1;
  for (let offset = 0; offset + marker.length <= bytes.length; offset += 1) {
    if (marker.every((value, index) => bytes[offset + index] === value)) {
      if (found !== -1) throw new Error("Exported Menu Evolution DLL contains duplicate configuration markers.");
      found = offset;
    }
  }
  if (found < 0) throw new Error("Exported Menu Evolution DLL has no configuration marker.");
  return (bytes[found + 10] ?? 0) | ((bytes[found + 11] ?? 0) << 8);
}
