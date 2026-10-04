/** Prepare isolated, paired damage fixtures using the shipped battle harness. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { readAscii, readU32 } from "../src/nds/binary";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { getTestBattleConfig, isTestBattleSaveMoveAnimationsEnabled, patchTestBattleSaveMoveAnimations, rawSaveBytesFromDesmumeDsv } from "../src/pokeweb/testBattle";
import { configureHarnessRuntime, patchHarnessExpandedPartyGuard, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../src/pokeweb/battleHarness";
import { detectBw2Upgrade } from "../src/pokeweb/black2UpgradeModel";
import { decodeRecord } from "../src/pokeweb/projectStore";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!["--rom", "--save", "--out"].includes(key) || !value || args.has(key)) throw new Error("Expected --rom INPUT.nds --save INPUT.sav --out NEW_DIRECTORY");
  args.set(key, value);
}
if (args.size !== 3) throw new Error("Expected --rom INPUT.nds --save INPUT.sav --out NEW_DIRECTORY");
const directory = resolve(args.get("--out")!);
// The runner creates the parent; a fresh child prevents accidental overwrites.
await mkdir(directory);
// Also protect standalone fixture builds outside the normal ignored work/ tree.
await writeFile(resolve(directory, ".gitignore"), "*\n", { flag: "wx" });
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array(await readFile(resolve(args.get("--rom")!)));
const inputSave = new Uint8Array(await readFile(resolve(args.get("--save")!)));
const inputRom = new NintendoDSRom(bytes, { fileData: "view" });
validateHarnessRom(inputRom);
// Fail closed if a different executable layout invalidates the native probes.
const battle = inputRom.loadArm9Overlays([167]).get(167)!;
const probes = [
  [0x021A5958, "f0b587b01c1c051c20880191171c0e9e"],
  [0x021A599C, "4520311c"], [0x021A5AE0, "01210903"],
  [0x021A5B04, "041c3220"], [0x021A5B26, "08800398"],
  [0x021BD100, "38b50c4d041c2869"], [0x021BDCEC, "f8b584b01021061c"],
  [0x021CEF18, "38b50c1c051c2068"], [0x021BCF58, "f8b5021c0f1c1248"],
] as const;
for (const [address, expected] of probes) {
  const offset = address - battle.ramAddress;
  if (offset < 0 || Buffer.from(battle.data.subarray(offset, offset + expected.length / 2)).toString("hex") !== expected) throw new Error(`Unsupported battle probe signature at 0x${address.toString(16)}`);
}
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Fixtures use bundled local assets only");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(bytes, basename(args.get("--rom")!), { selectedNarcs: ["message_texts", "personal", "moves", "trdata", "trpok"] });
if (detectBw2Upgrade(project) !== "white2-upgrade") throw new Error("Fluffy suite requires a compatible White2Upgrade ROM with its battle ability modules installed");
if (project.texts.banks.abilities?.[218]?.trim().toLowerCase() !== "fluffy") throw new Error("Expected Fluffy at ability 218; this ROM's ability IDs differ");
const cases = [
  { id: "contact", moveId: 33, name: "Tackle", contact: true, fire: false, ratio: 2048 },
  { id: "noncontact", moveId: 129, name: "Swift", contact: false, fire: false, ratio: 4096 },
  { id: "fire", moveId: 53, name: "Flamethrower", contact: false, fire: true, ratio: 8192 },
  { id: "fire-contact", moveId: 7, name: "Fire Punch", contact: true, fire: true, ratio: 4096 },
];
const rawSave = rawSaveBytesFromDesmumeDsv(inputSave);
const saveConfig = getTestBattleConfig("BW2", { white2Upgrade: true });
const attacker = { speciesId: 151, abilityId: 28, level: 50, nature: 0, itemId: 0,
  moves: cases.map(test => test.moveId), status: "healthy" as const };
const save = patchTestBattleSaveMoveAnimations(patchHarnessSave(rawSave, project, { trainerId: 1, player: { team: [attacker] } }), saveConfig, false);
for (const half of [0, saveConfig.saveLayout.saveHalfOffset]) {
  if (isTestBattleSaveMoveAnimationsEnabled(save, saveConfig, half)) throw new Error("Interaction fixtures require Battle Scene Off in both save halves");
}
await writeFile(resolve(directory, "battle.sav"), save, { flag: "wx" });
for (const test of cases) {
  const move = decodeRecord(project, "moves", test.moveId).raw;
  if (!move) throw new Error(`${test.name}: move record unavailable`);
  if (Boolean(Number(move.properties) & 1) !== test.contact || (Number(move.type) === 9) !== test.fire) throw new Error(`${test.name}: unexpected ROM contact/type data`);
}
patchHarnessExpandedPartyGuard(project, inputRom.loadArm9Overlays([36]).get(36)!);
const template = new Uint8Array(await readFile(new URL("../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url)));
const receipt = JSON.parse(await readFile(new URL("../src/assets/testbattle/BattleHarnessW2.json", import.meta.url), "utf8"));
if (sha256(template) !== receipt.dllSha256) throw new Error("Bundled battle harness does not match its CPU verification receipt");
for (const [name, hash] of Object.entries(receipt.sources)) {
  if (sha256(new Uint8Array(await readFile(new URL(`../runtime/battle-harness/${name}`, import.meta.url)))) !== hash) throw new Error(`Bundled battle harness has stale source verification: ${name}`);
}
await prepareBw2TestBattleCodeInjection(project);
stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(template, 1, 0));
// Two Personal slots coexist in the single export. Native trainer generation
// selects the requested ability; there is no live BattleMon ability rewrite.
const defender = { speciesId: 143, level: 50, itemId: 0, moves: [150] };
for (const [abilitySlot, abilityId] of [[1, 50], [2, 218], [1, 50]] as const) {
  patchHarnessTrainer(project, { trainerId: 1, battleType: "Singles", trainer: {
    ai: 0, team: [{ ...defender, abilitySlot, abilityId }],
  } });
}
// Export only authored trainer and Personal edits, not validation normalization.
for (const [name, store] of Object.entries(project.narcs)) {
  if (!["trdata", "trpok", "personal"].includes(name) || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
}
const rom = await exportModifiedRom(project, { preserveOriginalLength: true });
await writeFile(resolve(directory, "battle.nds"), rom, { flag: "wx" });
const outputRom = new NintendoDSRom(rom, { fileData: "view" });
const party = outputRom.getFileByName(saveConfig.paths.trpok);
const fnt = 0x10 + readU32(party, 0x14), fimg = fnt + readU32(party, fnt + 4);
if (readAscii(party, fimg, 4) !== "GMIF") throw new Error("Exported trainer NARC has an unsupported data layout");
const selector = fimg + 8 + readU32(party, 0x1c + 1 * 8) + 1;
if (party[selector] >>> 4 !== 1) throw new Error("Shared fixture did not encode trainer ability slot 1");
const offset = party.byteOffset - rom.byteOffset + selector;
const expected = rom[offset];
const variants = [
  { name: "control", abilityId: 50, abilitySlot: 1, romPatches: [] },
  { name: "fluffy", abilityId: 218, abilitySlot: 2, romPatches: [{ offset, expected, value: (expected & 15) | 0x20 }] },
];
await writeFile(resolve(directory, "suite.json"), JSON.stringify({
  format: "pokeweb-battle-interactions-2", suite: "fluffy", battleAnimationsEnabled: false,
  trainerId: 1, playerSpeciesId: 151, trainerSpeciesId: 143, playerAbilityId: 28,
  trainerMoveId: 150, playerMoves: attacker.moves,
  inputRomSha256: sha256(bytes), inputSaveSha256: sha256(inputSave),
  harnessSha256: receipt.dllSha256, harnessCpuChecks: receipt.verification.cpuChecks,
  rom: { file: "battle.nds", sha256: sha256(rom) },
  save: { file: "battle.sav", sha256: sha256(save) },
  variants, cases: cases.map((test, moveSlot) => ({ ...test, moveSlot })),
}, null, 2) + "\n", { flag: "wx" });
console.log("Prepared one shared ROM/save: player has four attacks; trainer Personal slots are Run Away and Fluffy");
