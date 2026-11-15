import { writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { getTextBank, updateTextEntry } from "./textModel";

const profiles = {
  B2: { gameCode: "IREO", entryCount: 0x021e5d7c, styleCount: 0x021e64c0, regulationReturn: 0x021e601a, entryMessages: 0x021e7ba4 },
  W2: { gameCode: "IRDO", entryCount: 0x021e5dbc, styleCount: 0x021e6500, regulationReturn: 0x021e605a, entryMessages: 0x021e7be4 },
};
type Version = keyof typeof profiles;
const VERSION = "1.0.0";
const PWT_LOBBY_BANK = 668;
const FORMAT_HELP = 21;
const STOCK_COUNTS = "Single Battles need three Pokémon.\\r\\nDouble Battles need four Pokémon.\\r\\n"
  + "Triple Battles need six Pokémon.\\r\\nRotation Battles need four Pokémon.\\r\\n";
const MESSAGE_IDS = [48, 49, 50, 51, 52, 53, 54, 55, 48];

function halfwords(words: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(words.length * 2);
  words.forEach((word, i) => writeU16(bytes, i * 2, word));
  return bytes;
}

function entryMessages(messages: readonly number[]): Uint8Array {
  return halfwords(messages.flatMap((message, i) => [29 + i, message]));
}

function dllFileName(version: Version): string {
  return `PwtSixPokemon${version}.dll`;
}

function buildPwtSixPokemonDll(version: Version): Uint8Array {
  const profile = profiles[version];
  // r0 = WbtSystem*. IDs 3 and 11 still use the retail count by style.
  const count = halfwords([
    0x68c1, 0x2903, 0xd003, 0x290b, 0xd001, // ldr r1,[r0,#12]; cmp/beq for Download and story
    0x2006, 0x4770,                         // movs r0,#6; bx lr
    0x6900, 0x4b00, 0x4718, 0, 0,           // ldr r0,[r0,#16]; ldr r3,=WbtStyle_GetPokemonCount; bx r3
  ]);
  writeU32(count, 20, profile.styleCount | 1);

  // WbtSystem_GetRegulation's return site holds sys in r5. Resolve the
  // original r0 result, then adjust only minCount/maxCount of repeatable cups.
  const regulation = halfwords([
    0x1c28, 0x68c1, 0x30ce,                 // adds r0,r5,#0; ldr r1,[r0,#12]; adds r0,#0xce
    0x2903, 0xd004, 0x290b, 0xd002,         // cmp/beq for Download and story
    0x2106, 0x7081, 0x70c1,                 // movs r1,#6; strb r1,[r0,#2]; strb r1,[r0,#3]
    0x4770, 0x46c0,                         // bx lr; alignment
  ]);
  // The receptionist adds four to the chosen message for Type Expert.
  // Leave regulation 37's message 48 and the separate Download path intact.
  const messages = entryMessages([50, 50, 50, 50, 54, 54, 54, 54, 48]);
  const code = new Uint8Array(count.length + regulation.length + messages.length);
  code.set(count);
  code.set(regulation, count.length);
  code.set(messages, count.length + regulation.length);
  const rpm: RpmModule = {
    code, baseAddress: 0, bssSize: 0,
    symbols: [
      { name: null, address: 0, size: count.length, type: "FUNCTION_THM", attributes: 0 },
      { name: null, address: count.length, size: regulation.length, type: "FUNCTION_THM", attributes: 0 },
      { name: null, address: count.length + regulation.length, size: messages.length, type: "VALUE", attributes: 0 },
    ],
    relocations: [
      { target: { module: "55", address: profile.entryCount | 1, type: "THUMB_BRANCH" }, sourceSymbolIndex: 0 },
      { target: { module: "55", address: profile.regulationReturn | 1, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: 1 },
      { target: { module: "56", address: profile.entryMessages, type: "FULL_COPY" }, sourceSymbolIndex: 2 },
    ],
    metadata: { PMCGameID: version, PMCModulePriority: 4, PMCVersion: VERSION },
  };
  return writeRpm(rpm, { ident: "DLXF" });
}

function getVersion(project: ProjectState): Version | undefined {
  const version = project.session.baseVersion;
  if (project.session.baseRom === "BW2" && (version === "B2" || version === "W2")
    && project.romInfo.idCode === profiles[version].gameCode) return version;
  return undefined;
}

export function getPwtSixPokemonStatus(project: ProjectState): "unsupported" | "ready" | "installed" {
  const version = getVersion(project);
  if (!version || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return "unsupported";
  return listCodeInjectionDlls(project).some(entry => entry.path.toLowerCase() === `patches/${dllFileName(version).toLowerCase()}`
    && entry.version === VERSION && entry.gameId === version) ? "installed" : "ready";
}

export function installPwtSixPokemon(project: ProjectState) {
  return installCodeInjectionPatch(project, stagePwtSixPokemon);
}

function stagePwtSixPokemon(project: ProjectState) {
  const version = getVersion(project);
  const bytes = project.originalRomBytes;
  if (!version || !bytes || bytes[0x1e] !== 0) throw new Error("Six-Pokémon PWT requires US Black 2 or White 2 revision 0.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const profile = profiles[version];
  if (rom.idCode !== profile.gameCode) throw new Error("Reload the matching US Black 2 or White 2 ROM.");

  const getter = halfwords([0x6900, 0x4b01, 0x4718, 0x46c0, 0, 0]);
  writeU32(getter, 8, profile.styleCount | 1);
  const signatures = [
    { module: 55, address: profile.entryCount, bytes: getter },
    { module: 55, address: profile.regulationReturn, bytes: halfwords([0x35ce, 0x1c28, 0xbdf8]) },
    { module: 56, address: profile.entryMessages, bytes: entryMessages(MESSAGE_IDS) },
  ];
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_, fileId) => getRomFileBytes(project, rom, fileId), new Set([55, 56]));
  for (const signature of signatures) {
    const overlay = overlays.get(signature.module);
    const data = project.overlays[signature.module] ?? overlay?.data;
    const offset = overlay ? signature.address - overlay.ramAddress : -1;
    if (offset < 0 || !data || signature.bytes.some((byte, index) => data[offset + index] !== byte)) {
      throw new Error(`Overlay ${signature.module} differs from the supported PWT code at 0x${signature.address.toString(16)}.`);
    }
  }

  const fileName = dllFileName(version);
  const path = `patches/${fileName}`;
  const dll = buildPwtSixPokemonDll(version);
  for (const entry of listCodeInjectionDlls(project)) {
    const staged = Object.entries(project.fileSystem?.additions ?? {}).find(([name]) => name.toLowerCase() === entry.path.toLowerCase())?.[1];
    const fileId = rom.filenames.idOf(entry.path);
    const current = staged ?? (fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId));
    if (entry.path.toLowerCase() === path.toLowerCase()) {
      if (current?.length === dll.length && current.every((byte, index) => byte === dll[index])) continue;
      throw new Error(`${entry.path} already exists with different contents.`);
    }
    if (!current) continue;
    let rpm: RpmModule;
    try { rpm = parseRpm(current, { allowedMagics: ["DLXF"] }); } catch { continue; }
    const overlaps = rpm.relocations.some(({ target, sourceSymbolIndex }) => {
      const start = target.address & ~1;
      const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4;
      return signatures.some(signature => target.module === String(signature.module)
        && start < signature.address + signature.bytes.length && start + size > signature.address);
    });
    if (overlaps) throw new Error(`Six-Pokémon PWT conflicts with ${entry.fileName}.`);
  }

  loadCodeInjectionNarcs(project, rom, ["story_texts"]);
  const help = getTextBank(project, "story_texts", PWT_LOBBY_BANK)[FORMAT_HELP]?.[1];
  // Drop the stock count sentences from help shared with the first visit.
  // The regulation-specific prompts still give the required team size.
  if (help?.includes(STOCK_COUNTS)) {
    updateTextEntry(project, "story_texts", PWT_LOBBY_BANK, FORMAT_HELP, help.replace(STOCK_COUNTS, ""));
  }
  const result = stageCodeInjectionDll(project, fileName, dll, "patches", bytes);
  recordGenericChange(project, "code_injection", "Enabled six-Pokémon teams for repeatable built-in PWT cups.", "Six-Pokémon PWT", {
    key: "code-injection:pwt-six-pokemon",
  });
  return result;
}
