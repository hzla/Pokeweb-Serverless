import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { readU16, readU32, writeU32 } from "../src/nds/binary";
import { NintendoDSRom } from "../src/nds/rom";
import { installBattleLog } from "../src/pokeweb/battleLogModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { installMenuEvolution } from "../src/pokeweb/menuEvolutionModel";
import { markDirty } from "../src/pokeweb/projectStore";
import { getTextBank, updateTextEntry } from "../src/pokeweb/textModel";

const ASPERTIA_SCRIPT_FILE_ID = 854;
const ASPERTIA_TEXT_BANK_ID = 169;
const ASPERTIA_TEXT_ENTRY_ID = 120;
const ORIGINAL_DIALOGUE = "People go on journeys and become adults.\\nMaybe I should leave this city, too...";
const COUNTER_DIALOGUE = "VAR(514, 0) KOs and VAR(514, 1) Battles.";
const PARTY_SLOT_ONE_ZERO_BASED = 0;
const WORK_KOS = 0x4000;
const WORK_BATTLES = 0x4001;

const inputPath = resolve(process.argv[2] ?? "../cleanwhite2.nds");
const outputPath = resolve(process.argv[3] ?? "../cleanwhite2-aspertia-counter-test.nds");
const sourceBytes = new Uint8Array(await readFile(inputPath));
const sourceRom = new NintendoDSRom(sourceBytes);
if (sourceRom.idCode !== "IRDO") throw new Error(`Expected US White 2 (IRDO), got ${sourceRom.idCode}.`);

const project = await loadProjectFromRomBytes(sourceBytes, basename(inputPath), {
  selectedNarcs: ["message_texts", "story_texts", "scripts"],
});

const textEntry = getTextBank(project, "story_texts", ASPERTIA_TEXT_BANK_ID)[ASPERTIA_TEXT_ENTRY_ID];
if (!textEntry || textEntry[1] !== ORIGINAL_DIALOGUE) {
  throw new Error(`Aspertia text ${ASPERTIA_TEXT_BANK_ID}:${ASPERTIA_TEXT_ENTRY_ID} did not match the clean US ROM.`);
}

const scripts = project.narcs.scripts;
const originalScript = scripts?.rawFiles[ASPERTIA_SCRIPT_FILE_ID];
if (!scripts || !originalScript) throw new Error(`Missing Aspertia script file ${ASPERTIA_SCRIPT_FILE_ID}.`);
const patchedScript = repointAspertiaNpcSequence(originalScript);
scripts.rawFiles[ASPERTIA_SCRIPT_FILE_ID] = patchedScript;
scripts.records.delete(ASPERTIA_SCRIPT_FILE_ID);
markDirty(project, "scripts", ASPERTIA_SCRIPT_FILE_ID);
updateTextEntry(project, "story_texts", ASPERTIA_TEXT_BANK_ID, ASPERTIA_TEXT_ENTRY_ID, COUNTER_DIALOGUE);

const previousFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  const fileName = url.pathname.split("/").pop() ?? "";
  try {
    const bytes = new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${fileName}`, import.meta.url)));
    return new Response(bytes);
  } catch {
    return new Response(undefined, { status: 404 });
  }
}) as typeof fetch;

try {
  await installBattleLog(project);
  await installMenuEvolution(project);
} finally {
  globalThis.fetch = previousFetch;
}

const outputBytes = await exportModifiedRom(project);
await writeFile(outputPath, outputBytes);
await verifyOutput(outputBytes);
console.log(`Wrote ${outputPath}`);
console.log(`Aspertia script ${ASPERTIA_SCRIPT_FILE_ID}, sequence 25 now reads party slot 1 counters into ${hex(WORK_KOS)}/${hex(WORK_BATTLES)}.`);
console.log(`Story text ${ASPERTIA_TEXT_BANK_ID}:${ASPERTIA_TEXT_ENTRY_ID}: ${COUNTER_DIALOGUE}`);

function repointAspertiaNpcSequence(source: Uint8Array): Uint8Array {
  const sequenceStarts = readSequenceStarts(source);
  const messageOffsets: number[] = [];
  for (let offset = 0; offset + 10 <= source.length; offset += 1) {
    if (readU16(source, offset) !== 0x003d) continue;
    const params = [0, 1, 2, 3].map((index) => readU16(source, offset + 2 + index * 2));
    if (params[0] === 0x0400 && params[1] === ASPERTIA_TEXT_ENTRY_ID && params[2] === 0 && params[3] === 0) {
      messageOffsets.push(offset);
    }
  }
  if (messageOffsets.length !== 1) throw new Error(`Expected one Aspertia message command, found ${messageOffsets.length}.`);

  const originalSequenceStart = messageOffsets[0] - 8;
  const expectedPrefix = bytesFromHex("2e00a60047057400");
  if (!bytesEqual(source.subarray(originalSequenceStart, messageOffsets[0]), expectedPrefix)) {
    throw new Error("The Aspertia NPC sequence prefix did not match the clean US ROM.");
  }
  const pointerIndexes = sequenceStarts
    .map((start, index) => ({ start, index }))
    .filter(({ start }) => start === originalSequenceStart)
    .map(({ index }) => index);
  if (pointerIndexes.length !== 1) {
    throw new Error(`Expected one sequence pointer to the Aspertia NPC, found ${pointerIndexes.length}.`);
  }

  const body = buildCounterDialogueSequence();
  const bodyOffset = (source.length + 1) & ~1;
  const output = new Uint8Array(bodyOffset + body.length);
  output.set(source);
  output.set(body, bodyOffset);
  const pointerOffset = pointerIndexes[0] * 4;
  writeU32(output, pointerOffset, (bodyOffset - pointerOffset - 4) >>> 0);
  return output;
}

function buildCounterDialogueSequence(): Uint8Array {
  const bytes: number[] = [];
  pushU16(bytes, 0x002e); // LockAll
  pushU16(bytes, 0x00a6); // PlaySound
  pushU16(bytes, 0x0547);
  pushU16(bytes, 0x0074); // FacePlayer
  pushGetPokemonParam(bytes, WORK_KOS, PARTY_SLOT_ONE_ZERO_BASED, 0x0400);
  pushGetPokemonParam(bytes, WORK_BATTLES, PARTY_SLOT_ONE_ZERO_BASED, 0x0401);
  pushSetWordNumber(bytes, 0, WORK_KOS, 3);
  pushSetWordNumber(bytes, 1, WORK_BATTLES, 3);
  pushU16(bytes, 0x003d); // Message2
  pushU16(bytes, 0x0400);
  pushU16(bytes, ASPERTIA_TEXT_ENTRY_ID);
  pushU16(bytes, 0);
  pushU16(bytes, 0);
  pushU16(bytes, 0x0032); // WaitForButton
  pushU16(bytes, 0x003e); // CloseMessageBox
  pushU16(bytes, 0x0030); // WaitMoment
  pushU16(bytes, 0x002f); // UnlockAll
  pushU16(bytes, 0x0002); // End
  return Uint8Array.from(bytes);
}

function pushGetPokemonParam(bytes: number[], destination: number, partySlot: number, parameter: number): void {
  pushU16(bytes, 0x0110);
  pushU16(bytes, destination);
  pushU16(bytes, partySlot);
  pushU16(bytes, parameter);
}

function pushSetWordNumber(bytes: number[], wordSetSlot: number, value: number, digits: number): void {
  pushU16(bytes, 0x005c);
  bytes.push(wordSetSlot & 0xff);
  pushU16(bytes, value);
  pushU16(bytes, digits);
}

function pushU16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function readSequenceStarts(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
    if (readU16(bytes, offset) === 0xfd13) return starts;
    starts.push(offset + 4 + toSigned32(readU32(bytes, offset)));
  }
  throw new Error("The Aspertia script has no sequence-table terminator.");
}

function toSigned32(value: number): number {
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

async function verifyOutput(bytes: Uint8Array): Promise<void> {
  const rom = new NintendoDSRom(bytes);
  for (const path of [
    "patches/White2UpgradeBattleLog.dll",
    "patches/White2UpgradeBattleCounters.dll",
    "patches/White2UpgradeBattleLogSummary.dll",
    "patches/MenuEvolutionW2.dll",
  ]) {
    if (rom.getFileByName(path).length === 0) throw new Error(`Exported ROM is missing ${path}.`);
  }
  const reloaded = await loadProjectFromRomBytes(bytes, basename(outputPath), {
    selectedNarcs: ["story_texts", "scripts"],
  });
  const dialogue = getTextBank(reloaded, "story_texts", ASPERTIA_TEXT_BANK_ID)[ASPERTIA_TEXT_ENTRY_ID]?.[1];
  if (dialogue !== COUNTER_DIALOGUE) throw new Error(`Exported dialogue is ${JSON.stringify(dialogue)}.`);
  const script = reloaded.narcs.scripts?.rawFiles[ASPERTIA_SCRIPT_FILE_ID];
  if (!script) throw new Error("Exported Aspertia script is missing.");
  const start = readSequenceStarts(script)[25];
  if (readU16(script, start + 8) !== 0x0110 || readU16(script, start + 14) !== 0x0400) {
    throw new Error("Exported Aspertia sequence does not contain the KO counter command.");
  }
  if (readU16(script, start + 16) !== 0x0110 || readU16(script, start + 22) !== 0x0401) {
    throw new Error("Exported Aspertia sequence does not contain the battle counter command.");
  }
}

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}
