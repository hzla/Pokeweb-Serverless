/** One-ROM, singles-only fixtures for focused move-handler regression suites. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { configureHarnessRuntime, patchHarnessExpandedPartyGuard, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../src/pokeweb/battleHarness";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { detectBw2Upgrade } from "../src/pokeweb/black2UpgradeModel";
import { getTestBattleConfig, patchTestBattleSaveMoveAnimations, rawSaveBytesFromDesmumeDsv } from "../src/pokeweb/testBattle";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!["--move", "--rom", "--save", "--core", "--out"].includes(key) || !value || args.has(key)) throw new Error("Expected --move NAME --rom INPUT --save INPUT --out NEW_DIRECTORY [--core DLL]");
  args.set(key, value);
}
for (const key of ["--move", "--rom", "--save", "--out"]) if (!args.has(key)) throw new Error(`Missing ${key}`);
const moveName = args.get("--move")!;
const definitions: Record<string, { id: number; type: number; power: number; category: number; accuracy: number; target?: number }> = {
  ruination: { id: 877, type: 16, power: 1, category: 2, accuracy: 90 },
  "barb-barrage": { id: 839, type: 3, power: 60, category: 1, accuracy: 100 },
  "dire-claw": { id: 827, type: 3, power: 80, category: 1, accuracy: 100 },
  "take-heart": { id: 850, type: 13, power: 0, category: 0, accuracy: 101, target: 7 },
  "clangorous-soul": { id: 775, type: 15, power: 0, category: 0, accuracy: 101, target: 7 },
  "fillet-away": { id: 868, type: 0, power: 0, category: 0, accuracy: 101, target: 7 },
  "aura-wheel": { id: 783, type: 12, power: 110, category: 1, accuracy: 100 },
  "magic-powder": { id: 750, type: 13, power: 0, category: 0, accuracy: 100 },
  obstruct: { id: 792, type: 16, power: 0, category: 0, accuracy: 101, target: 7 },
  "silk-trap": { id: 852, type: 6, power: 0, category: 0, accuracy: 101, target: 7 },
  "burning-bulwark": { id: 908, type: 9, power: 0, category: 0, accuracy: 101, target: 7 },
  "hydro-steam": { id: 876, type: 10, power: 80, category: 2, accuracy: 100 },
  "terrain-pulse": { id: 805, type: 0, power: 50, category: 2, accuracy: 100 },
  "supercell-slam": { id: 916, type: 12, power: 100, category: 1, accuracy: 95 },
  "bolt-beak": { id: 754, type: 12, power: 85, category: 1, accuracy: 100 },
  "fishious-rend": { id: 755, type: 10, power: 85, category: 1, accuracy: 100 },
  "hard-press": { id: 912, type: 8, power: 1, category: 1, accuracy: 100 },
  "grav-apple": { id: 788, type: 11, power: 80, category: 1, accuracy: 100 },
  psyblade: { id: 875, type: 13, power: 80, category: 1, accuracy: 100 },
  "rising-voltage": { id: 804, type: 12, power: 70, category: 2, accuracy: 100 },
  "scale-shot": { id: 799, type: 15, power: 25, category: 1, accuracy: 90 },
  "triple-axel": { id: 813, type: 14, power: 20, category: 1, accuracy: 90 },
  "steel-beam": { id: 796, type: 8, power: 140, category: 2, accuracy: 95 },
  chloroblast: { id: 835, type: 11, power: 150, category: 2, accuracy: 95 },
  "steel-roller": { id: 798, type: 8, power: 130, category: 1, accuracy: 100 },
  "ice-spinner": { id: 861, type: 14, power: 80, category: 1, accuracy: 100 },
  "body-press": { id: 776, type: 1, power: 80, category: 1, accuracy: 100 },
  "tidy-up": { id: 882, type: 0, power: 0, category: 0, accuracy: 101, target: 7 },
  "lash-out": { id: 808, type: 16, power: 75, category: 1, accuracy: 100 },
  "burning-jealousy": { id: 807, type: 9, power: 70, category: 2, accuracy: 100, target: 5 },
  "alluring-voice": { id: 914, type: 17, power: 80, category: 2, accuracy: 100 },
  "ceaseless-edge": { id: 845, type: 16, power: 65, category: 1, accuracy: 90 },
  "stone-axe": { id: 830, type: 5, power: 65, category: 1, accuracy: 90 },
  "collision-course": { id: 878, type: 1, power: 100, category: 1, accuracy: 100 },
  "electro-drift": { id: 879, type: 12, power: 100, category: 2, accuracy: 100 },
  "fickle-beam": { id: 907, type: 15, power: 80, category: 2, accuracy: 100 },
  poltergeist: { id: 809, type: 7, power: 110, category: 1, accuracy: 90 },
  "grassy-glide": { id: 803, type: 11, power: 55, category: 1, accuracy: 100 },
  "bleakwind-storm": { id: 846, type: 2, power: 100, category: 2, accuracy: 80, target: 5 },
  "sandsear-storm": { id: 848, type: 4, power: 100, category: 2, accuracy: 80, target: 5 },
  "wildbolt-storm": { id: 847, type: 12, power: 100, category: 2, accuracy: 80, target: 5 },
};
const definition = definitions[moveName];
if (!definition) throw new Error("Unsupported focused move suite");
const moveId = definition.id, ruination = moveName === "ruination", barb = moveName === "barb-barrage";
const direClaw = moveName === "dire-claw";
const takeHeart = moveName === "take-heart";
const hpBoost = moveName === "clangorous-soul" || moveName === "fillet-away";
const soul = moveName === "clangorous-soul";
const boostAmount = soul ? 1 : 2;
const boostStats = soul ? [0, 1, 2, 3, 4] : [0, 2, 4];
const hpBoostStages = (initial: number[], amount = boostAmount) => initial.map((value, index) =>
  boostStats.includes(index) ? Math.min(12, Math.max(0, value + amount)) : value);
const fullBoostStages = hpBoostStages(Array(7).fill(6));
const cappedBoostStages = Array.from({ length: 7 }, (_, index) => boostStats.includes(index) ? 12 : 6);
const flooredBoostStages = Array.from({ length: 7 }, (_, index) => boostStats.includes(index) ? 0 : 6);
const boostCost175 = soul ? 57 : 87;
const auraWheel = moveName === "aura-wheel";
const magicPowder = moveName === "magic-powder";
const hydroSteam = moveName === "hydro-steam", supercellSlam = moveName === "supercell-slam";
const terrainPulse = moveName === "terrain-pulse";
const damageShield = ["obstruct", "silk-trap", "burning-bulwark"].includes(moveName);
const shieldStat = moveName === "obstruct" ? 1 : 4;
const shieldDrop = moveName === "obstruct" ? 2 : 1;
const hardPress = moveName === "hard-press", gravApple = moveName === "grav-apple", psyblade = moveName === "psyblade";
const risingVoltage = moveName === "rising-voltage";
const scaleShot = moveName === "scale-shot";
const tripleAxel = moveName === "triple-axel";
const hpCost = moveName === "steel-beam" || moveName === "chloroblast";
const steelBeam = moveName === "steel-beam";
const steelRoller = moveName === "steel-roller";
const iceSpinner = moveName === "ice-spinner";
const bodyPress = moveName === "body-press";
const tidyUp = moveName === "tidy-up";
const lashOut = moveName === "lash-out";
const riseStatus = ["burning-jealousy", "alluring-voice"].includes(moveName);
const statHistory = lashOut || riseStatus;
const jealousy = moveName === "burning-jealousy";
const hazards = moveName === "ceaseless-edge" || moveName === "stone-axe";
const spikes = moveName === "ceaseless-edge";
const collision = moveName === "collision-course", electro = moveName === "electro-drift", fickle = moveName === "fickle-beam";
const poltergeist = moveName === "poltergeist";
const grassyGlide = moveName === "grassy-glide";
const storm = ["bleakwind-storm", "sandsear-storm", "wildbolt-storm"].includes(moveName);
const directory = resolve(args.get("--out")!);
await mkdir(directory);
await writeFile(resolve(directory, ".gitignore"), "*\n", { flag: "wx" });
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const bytes = new Uint8Array(await readFile(resolve(args.get("--rom")!)));
const inputSave = new Uint8Array(await readFile(resolve(args.get("--save")!)));
const input = new NintendoDSRom(bytes, { fileData: "view" });
validateHarnessRom(input);
const battle = input.loadArm9Overlays([167]).get(167)!;
const probes = [
  { name: "command", address: 0x021cef18, signature: "38b50c1c051c2068" },
  { name: "ability", address: 0x021bdcec, signature: "f8b584b01021061c" },
  { name: "damage", address: 0x021a5958, signature: "f0b587b01c1c051c20880191171c0e9e" },
  { name: "random", address: 0x021bd100, signature: "38b50c4d041c2869" },
];
if (!ruination) probes.push(
  { name: "rewrite", address: 0x021bcf10, signature: "70b50f4e051c0c1c" },
  { name: "critical", address: 0x021a599c, signature: "4520311c" },
  { name: "pre_modifier", address: 0x021a5ae0, signature: "01210903" },
  { name: "ratio", address: 0x021a5b04, signature: "041c3220" },
  { name: "calculated", address: 0x021a5b26, signature: "08800398" },
);
if (bodyPress || lashOut) probes.push(
  { name: "attack_stat", address: 0x021aaecc, signature: "f8b51d1c071c28880e1c" },
);
if (poltergeist || steelRoller || iceSpinner) probes.push(
  { name: "message_setup", address: 0x021ac3b8, signature: "18b40904090c0906" },
  { name: "message_arg", address: 0x021ac3e0, signature: "18b444886204530e" },
);
if (direClaw || takeHeart || hpBoost || magicPowder || damageShield || tidyUp || statHistory) probes.push(
  { name: "event_dispatch", address: 0x021bc940, signature: "08b50722012300f007f808bd" },
);
if (hpBoost) probes.push(
  { name: "selection", address: 0x021b47f8, signature: "f0b585b0151c071c0e1c1c1ca52d02d1" },
);
if (storm || hydroSteam) probes.push(
  { name: "weather", address: 0x021a65a0, signature: "70b50e4e041c301c16f0cefb" },
);
if (hydroSteam) probes.push(
  { name: "damage_weather", address: 0x021a5a3a, signature: "a17917f026fd011c012000038142" },
);
if (storm || supercellSlam || scaleShot || tripleAxel || hpCost || steelRoller || iceSpinner || hazards || auraWheel || magicPowder) probes.push(
  { name: "accuracy", address: 0x021a3544, signature: "f0b583b0061c0f1c151c1c1c" },
  { name: "accuracy_roll", address: 0x021a368e, signature: "642019f036fd2106090e8842" },
);
if (risingVoltage || terrainPulse) probes.push(
  { name: "floating", address: 0x021aaa64, signature: "70b5051c02200c1c161c2bf021f8002808d1" },
);
for (const probe of probes) {
  const at = probe.address - battle.ramAddress;
  if (at < 0 || Buffer.from(battle.data.subarray(at, at + probe.signature.length / 2)).toString("hex") !== probe.signature) throw new Error(`Unsupported ${probe.name} probe signature`);
}
// Native US work-result aggregation: PopWork adds 0x1d78 to ServerFlow;
// IsUsed extracts bit 30 and GetTotalResult extracts bit 29 of that state.
// This observes whether either benefit really succeeded, including capped
// stat-only failures, without writing native work results.
if (takeHeart || hpBoost || magicPowder || damageShield || tidyUp) for (const [address, signature] of [
  [0x021ac448, "38b5051c0c1c00f023f80348211c281804f0e6fa38bdc046781d0000"],
  [0x021b0920, "00684000c00f7047"],
  [0x021b0958, "00688000c00f7047"],
  [0x021bcfb0, "0a4a1368602b0ed2590051188988884204d198001018c43000687047002902d05b1c602bf0d300207047c046f0b31d02"],
] as const) {
  const at = address - battle.ramAddress;
  if (Buffer.from(battle.data.subarray(at, at + signature.length / 2)).toString("hex") !== signature) throw new Error("Unsupported native work-result observation layout");
}
// Direct HP-payment work and delayed berry reaction, verified from the US
// native Belly Drum callback (effect 8, offsets 4/6/7/16; effect 0x21).
if (hpBoost) for (const [address, signature] of [
  [0x021c9a08, "281c0821221ce2f709fd011c012008718871cc7170420861281ce2f711fd"],
  [0x021c9a6c, "281c2121221ce2f7d7fc011c0c7101208860281ce2f7e2fc"],
] as const) {
  const at = address - battle.ramAddress;
  if (Buffer.from(battle.data.subarray(at, at + signature.length / 2)).toString("hex") !== signature) throw new Error("Unsupported native HP payment transaction");
}
if (damageShield) for (const [address, signature] of [
  [0x021c938c, "38b503200d1c141cf3f70cfe84421cd1281c211ce2f768faf2f720fe"],
  [0x021aa1c0, "70b50f4e051c0c1c301c12f0bdfd201c10f056fd011c032012f010fe5120002112f00cfe281c2e21"],
] as const) {
  const at = address - battle.ramAddress;
  if (Buffer.from(battle.data.subarray(at, at + signature.length / 2)).toString("hex") !== signature) throw new Error("Unsupported native protection start/break event contract");
}
// Native Transform copies all 0x1f8 bytes, then restores the original 0xec
// core prefix. The resident success hook fills its unused base-param species
// word at 0xec. Validate the copy boundary, success site and Transform flag.
if (auraWheel) for (const [address, signature] of [
  [0x021bc594, "c07e8006c00f7047"],
  [0x021bc4be, "1d2203cd03c3521efbd12868"],
  [0x021bc4d4, "3f22844603cb03c5521efbd1"],
  [0x021bc4e4, "1d2503cb03c26d1efbd11868"],
  [0x021bc56e, "e17e20200843e0760120f8bd"],
  // SetMovesAndPP uses 14-byte move records, truth at 0x104 and surface
  // at 0x10a; its linked-copy branch mirrors all six bytes of MoveCore.
  [0x021ba964, "0299b819415c00290bd00899425a079942520699425a059942520499425a03994252"],
] as const) {
  const at = address - battle.ramAddress;
  if (Buffer.from(battle.data.subarray(at, at + signature.length / 2)).toString("hex") !== signature) throw new Error(`Unsupported native Transform observation layout at ${address.toString(16)}`);
}
// Read-only native side state. Validate the US overlay's count/active accessors
// and table limits before observing its handler/count records at runtime.
if (hazards) {
  const side = input.loadArm9Overlays([169]).get(169)!;
  for (const [address, signature] of [
    [0x06898ce0, "e022424302480901801808587047c0466ce98906"],
    [0x06898cf4, "e02242430448090180180858002801d0012070470020704760e98906"],
    [0x06898c70, "0120e060"],
    [0x06898c90, "05b0401ce060"],
  ] as const) {
    const at = address - side.ramAddress;
    if (at < 0 || Buffer.from(side.data.subarray(at, at + signature.length / 2)).toString("hex") !== signature) throw new Error("Unsupported native side-effect observation layout");
  }
  const sideView = new DataView(side.data.buffer, side.data.byteOffset, side.data.byteLength);
  if (sideView.getUint32(0x0689d908 - side.ramAddress + 6 * 12 + 8, true) !== 3 ||
      sideView.getUint32(0x0689d908 - side.ramAddress + 8 * 12 + 8, true) !== 1) throw new Error("Unsupported native hazard layer limits");
}
// Read-only Magic Room observation: validate the US BW2 static-work address
// and enableFlag[effect] layout against both native accessor instructions.
if (poltergeist) {
  for (const [address, signature] of [[0x021d5ab4, "011c0148014b184728d91d02"], [0x021d5e50, "890041185220800008587047"]] as const) {
    const at = address - battle.ramAddress;
    if (Buffer.from(battle.data.subarray(at, at + signature.length / 2)).toString("hex") !== signature) throw new Error("Unsupported field-state observation layout");
  }
}
if (storm || supercellSlam) {
  for (const [address, signature] of [[0x021bb41c, "18b407220a404905090e0124"], [0x021bb444, "55010000"]] as const) {
    const at = address - battle.ramAddress;
    if (Buffer.from(battle.data.subarray(at, at + signature.length / 2)).toString("hex") !== signature) throw new Error("Unsupported semi-invulnerability observation layout");
  }
}
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Fixtures use bundled local assets only");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(bytes, basename(args.get("--rom")!), { selectedNarcs: ["message_texts", "personal", "moves", "trdata", "trpok"] });
if (detectBw2Upgrade(project) !== "white2-upgrade") throw new Error("Move suites require a compatible White2Upgrade ROM");
// Read the native 36-byte record directly. The alignment word at byte 30 is
// not move flags, and byte 11 is duration rather than the inflicted status.
const move = new NARC(input.getFileByName("a/0/2/1")).files[moveId];
if (!move || move.length !== 36 || move[0] !== definition.type || move[2] !== definition.category || move[3] !== definition.power || move[4] !== definition.accuracy || move[20] !== (definition.target ?? 0)) throw new Error(`Unexpected ${moveName} native metadata`);
const moveView = new DataView(move.buffer, move.byteOffset, move.byteLength);
if (tidyUp && (move[1] !== 13 || move.subarray(21,30).some(value => value !== 0) || moveView.getUint32(32,true) !== 0)) throw new Error("Tidy Up requires custom global cleanup, single native boost work, and no Snatch flag");
if (riseStatus && (move[1] !== 4 || moveView.getUint16(8,true) || move[10])) throw new Error("Conditional status requires custom status work, not an unconditional native status");
if (barb && (moveView.getUint16(8, true) !== 5 || move[10] !== 50 || move[11] !== 1 || move[12] || move[13])) throw new Error("Barb Barrage requires 50% regular poison, not toxic poison");
if (direClaw && (move[1] !== 4 || moveView.getUint16(8, true) !== 0 || move[10] !== 50 || move[14] !== 0 || !(moveView.getUint32(32, true) & 1))) throw new Error("Dire Claw requires a custom 50% status secondary, normal critical stage and contact");
if (takeHeart && (move[1] !== 13 || move.subarray(21, 30).some(value => value !== 0) || !(moveView.getUint32(32, true) & (1 << 5)))) throw new Error("Take Heart requires custom combined effects and native Snatch eligibility");
if (hpBoost && (move[1] !== 13 || move[18] !== 0 || move[19] !== 0 || move.subarray(21, 30).some(value => value !== 0) ||
    !(moveView.getUint32(32, true) & (1 << 5)) || Boolean(moveView.getUint32(32, true) & (1 << 8)) !== soul)) throw new Error("HP boost requires custom transaction, Snatch and correct sound eligibility");
if (auraWheel && (move[1] !== 7 || move[21] !== 5 || move[24] !== 1 || move[27] !== 100 || !(moveView.getUint32(32, true) & (1 << 3)))) throw new Error("Aura Wheel requires native user Speed +1 and protection eligibility");
if (magicPowder && (move[1] !== 13 || (moveView.getUint32(32, true) & ((1 << 3) | (1 << 4) | (1 << 14))) !== ((1 << 3) | (1 << 4) | (1 << 14)))) throw new Error("Magic Powder requires uncategorized type replacement, Protect, reflection and powder flags");
if (damageShield && (move[1] !== 13 || move[5] !== 10 || move[6] !== 4 || moveView.getUint32(32, true) !== 0)) throw new Error("Damage-only shields require native self protection metadata without reflection or Snatch");
if (moveName === "fishious-rend" && !(moveView.getUint32(32, true) & (1 << 21))) throw new Error("Fishious Rend must retain its biting flag");
if (psyblade && !(moveView.getUint32(32, true) & (1 << 17))) throw new Error("Psyblade must retain its slicing flag");
if (terrainPulse && (move[1] !== 0 || !(moveView.getUint32(32, true) & (1 << 22)))) throw new Error("Terrain Pulse requires ordinary special damage and its pulse flag");
if (gravApple && (move[1] !== 6 || move[21] !== 2 || move[24] !== 255 || move[27] !== 100)) throw new Error("Grav Apple requires the native guaranteed target Defense drop");
if (storm && !(moveView.getUint32(32, true) & (1 << 16))) throw new Error("Storm moves must retain their wind flag");
if (moveName === "bleakwind-storm" && (move[1] !== 6 || move[21] !== 5 || move[24] !== 255 || move[27] !== 30)) throw new Error("Bleakwind Storm requires the native 30% target Speed drop");
if (moveName === "sandsear-storm" && (moveView.getUint16(8, true) !== 4 || move[10] !== 20)) throw new Error("Sandsear Storm requires the native 20% burn chance");
if (moveName === "wildbolt-storm" && (moveView.getUint16(8, true) !== 1 || move[10] !== 20)) throw new Error("Wildbolt Storm requires the native 20% paralysis chance");
if (scaleShot && (move[1] !== 0 || move[7] !== 0x52 || move.subarray(21, 30).some(value => value !== 0))) throw new Error("Scale Shot requires native 2-5 hits without per-hit stat metadata");
if (tripleAxel && (move[1] !== 0 || move[7] !== 0x33 || !(moveView.getUint32(32, true) & 1))) throw new Error("Triple Axel requires three physical contact strikes");
if (hpCost && (move[1] !== 0 || move[18] !== 0 || move.subarray(21, 30).some(value => value !== 0))) throw new Error("Maximum-HP cost moves require ordinary damage without ordinary recoil or stat metadata");
if (hazards && (move[14] !== 0 || !(moveView.getUint32(32, true) & (1 << 17)) || !(moveView.getUint32(32, true) & 1))) throw new Error("Damaging hazards require normal critical stage, contact and slicing");
// The deliberately low-level player is slower than the target. This lets
// native Protect/Substitute finish before the tested move, without AI forcing.
const player = { speciesId: auraWheel ? 877 : 151, form: 0, abilityId: tripleAxel || hpCost ? 50 : storm || supercellSlam ? 28 : 99, level: ruination ? 5 : 50, nature: 0,
  moves: ruination ? [moveId] : damageShield ? [moveId, 150, 182, 164] : magicPowder ? [moveId, 571, 567, 373] : auraWheel ? [moveId, 144, 182, 150] : takeHeart ? [moveId, 150, 164, 182] : direClaw ? [moveId, 77, 261, 182] : barb ? [moveId, 261, 92, 77] : gravApple ? [moveId, 356, 182] : psyblade ? [moveId, 604, 432, 182] : risingVoltage ? [moveId, 604, 356, 580] : steelRoller ? [moveId, 604, 875, 432] : hazards ? [moveId, 191, 446, 182] : electro ? [moveId, 571, 182] : poltergeist ? [moveId, 282, 373, 478] : grassyGlide ? [moveId, 580, 432, 678] : storm ? [moveId, 240, 241, 182] : [moveId, 182], itemId: 0 };
const saveConfig = getTestBattleConfig("BW2", { white2Upgrade: true });
const saveDefinitions: { file: string; player: typeof player; benchPlayer?: typeof player }[] = ruination ? [
  { file: "battle.sav", player }, { file: "battle-miss.sav", player: { ...player, abilityId: 28 } },
] : damageShield ? [
  { file: "battle.sav", player },
  { file: "battle-helmet.sav", player: { ...player, itemId: 540 } },
  { file: "battle-roughskin.sav", player: { ...player, abilityId: 24 } },
  { file: "battle-ghost.sav", player: { ...player, speciesId: 94 } },
  { file: "battle-embargo.sav", player: { ...player, moves: [moveId, 373, 182, 164] } },
] : hpBoost ? [
  { file: "battle.sav", player: { ...player, moves: [moveId, 150, 164, 182] } },
  { file: "battle-level51.sav", player: { ...player, level: 51, moves: [moveId, 150, 164, 182] } },
  { file: "battle-sitrus.sav", player: { ...player, itemId: 158, moves: [moveId, 150, 164, 182] } },
  ...[86, 126, 98, 69].map(abilityId => ({ file: `battle-ability-${abilityId}.sav`, player: { ...player, abilityId, moves: [moveId, 150, 164, 182] } })),
] : hpCost ? [
  { file: "battle.sav", player },
  { file: "battle-level51.sav", player: { ...player, level: 51 } },
  ...[69, 98, 120, 185].map(abilityId => ({ file: `battle-ability-${abilityId}.sav`, player: { ...player, abilityId } })),
] : terrainPulse ? [
  { file: "battle.sav", player: { ...player, moves: [moveId, 604, 432, 356] } },
  { file: "battle-wait.sav", player: { ...player, moves: [moveId, 150, 432, 356] } },
  { file: "battle-airborne.sav", player: { ...player, itemId: 541, moves: [moveId, 150, 432, 356] } },
  { file: "battle-levitate.sav", player: { ...player, abilityId: 26, moves: [moveId, 604, 432, 356] } },
  { file: "battle-misty.sav", player: { ...player, moves: [moveId, 581, 150, 356] } },
  { file: "battle-replace.sav", player: { ...player, moves: [moveId, 604, 580, 356] } },
  ...[96, 174, 182, 184, 206, 178, 168].map(abilityId => ({ file: `battle-ability-${abilityId}.sav`, player: { ...player, abilityId, moves: [moveId, abilityId === 168 ? 150 : 604, 432, 356] } })),
] : hydroSteam ? [
  { file: "battle.sav", player: { ...player, moves: [moveId, 240, 241, 182] } },
  { file: "battle-normalize.sav", player: { ...player, abilityId: 96, moves: [moveId, 240, 241, 182] } },
  { file: "battle-protean.sav", player: { ...player, abilityId: 168, moves: [moveId, 240, 241, 182] } },
] : supercellSlam ? [
  { file: "battle.sav", player: { ...player, moves: [moveId, 182, 150, 164] } },
] : magicPowder ? [
  { file: "battle.sav", player },
  { file: "battle-moldbreaker.sav", player: { ...player, abilityId: 104 } },
  { file: "battle-miss.sav", player: { ...player, abilityId: 28 } },
  { file: "battle-ghost.sav", player: { ...player, moves: [moveId, 567, 129, 182] } },
  { file: "battle-switch.sav", player: { ...player, moves: [moveId, 571, 567, 150] } },
  { file: "battle-reflect.sav", player: { ...player, speciesId: 126 } },
  { file: "battle-suppress.sav", player: { ...player, moves: [moveId, 380, 567, 373] } },
] : auraWheel ? [
  { file: "battle.sav", player },
  { file: "battle-hangry.sav", player: { ...player, form: 1 } },
  { file: "battle-mew.sav", player: { ...player, speciesId: 151 } },
  { file: "battle-miss.sav", player: { ...player, abilityId: 28 } },
  { file: "battle-normalize.sav", player: { ...player, form: 1, abilityId: 96 } },
  { file: "battle-pixilate.sav", player: { ...player, form: 1, abilityId: 182 } },
  { file: "battle-protean.sav", player: { ...player, form: 1, abilityId: 168 } },
] : takeHeart ? [
  { file: "battle.sav", player },
  { file: "battle-simple.sav", player: { ...player, abilityId: 86 } },
  { file: "battle-contrary.sav", player: { ...player, abilityId: 126 } },
  { file: "battle-burn.sav", player: { ...player, itemId: 273 } },
  { file: "battle-poison.sav", player: { ...player, itemId: 272 } },
] : direClaw ? [
  { file: "battle.sav", player },
  { file: "battle-sheerforce.sav", player: { ...player, abilityId: 125 } },
  { file: "battle-serenegrace.sav", player: { ...player, abilityId: 32 } },
  { file: "battle-parentalbond.sav", player: { ...player, abilityId: 185 } },
] : barb ? [
  { file: "battle.sav", player }, { file: "battle-sleep.sav", player: { ...player, moves: [moveId, 147, 92, 77] } },
  { file: "battle-sheerforce.sav", player: { ...player, abilityId: 125 } },
] : gravApple ? [
  { file: "battle.sav", player }, { file: "battle-sheerforce.sav", player: { ...player, abilityId: 125 } },
] : scaleShot ? [
  { file: "battle.sav", player },
  { file: "battle-skilllink.sav", player: { ...player, abilityId: 92 } },
  { file: "battle-simple.sav", player: { ...player, abilityId: 86 } },
  { file: "battle-contrary.sav", player: { ...player, abilityId: 126 } },
  { file: "battle-sheerforce.sav", player: { ...player, abilityId: 125 } },
  { file: "battle-miss.sav", player: { ...player, abilityId: 28 } },
] : tripleAxel ? [
  { file: "battle.sav", player },
  { file: "battle-skilllink.sav", player: { ...player, abilityId: 92 } },
  { file: "battle-technician.sav", player: { ...player, abilityId: 101 } },
  { file: "battle-parentalbond.sav", player: { ...player, abilityId: 185 } },
  { file: "battle-moldbreaker.sav", player: { ...player, abilityId: 104 } },
  { file: "battle-disguise-fixed.sav", player: { ...player, moves: [moveId, 101, 150, 182] } },
  { file: "battle-disguise-single.sav", player: { ...player, moves: [moveId, 58, 150, 182] } },
] : hazards ? [
  { file: "battle.sav", player },
  { file: "battle-miss.sav", player: { ...player, abilityId: 28 } },
  { file: "battle-sheerforce.sav", player: { ...player, abilityId: 125 } },
  { file: "battle-parentalbond.sav", player: { ...player, abilityId: 185 } },
] : statHistory ? [
  { file: "battle.sav", player: { ...player, moves: [moveId,150,182,164] } },
  ...[125,126,29].map(abilityId => ({ file: `battle-ability-${abilityId}.sav`, player: { ...player, abilityId, moves: [moveId,150,182,164] } })),
] : tidyUp ? [
  { file: "battle.sav", player: { ...player, moves: [moveId,191,164,564] } },
  ...[86,126].map(abilityId => ({ file: `battle-ability-${abilityId}.sav`, player: { ...player, abilityId, moves: [moveId,191,164,564] } })),
  { file: "battle-other-hazards.sav", player: { ...player, moves: [moveId,390,446,182] } },
  { file: "battle-screens.sav", player: { ...player, moves: [moveId,115,150,182] } },
  { file: "battle-terrain.sav", player: { ...player, moves: [moveId,604,805,182] } },
] : bodyPress ? [
  { file: "battle.sav", player: { ...player, moves: [moveId, 673, 150, 182] } },
  { file: "battle-hugepower.sav", player: { ...player, abilityId: 37 } },
  { file: "battle-furcoat.sav", player: { ...player, abilityId: 169 } },
  { file: "battle-band.sav", player: { ...player, itemId: 220 } },
  { file: "battle-eviolite.sav", player: { ...player, speciesId: 25, itemId: 538 } },
  { file: "battle-burn.sav", player: { ...player, itemId: 273, moves: [moveId, 150, 182] } },
] : iceSpinner ? [
  { file: "battle.sav", player: { ...player, moves: [moveId, 604, 875, 432] } },
  { file: "battle-airborne.sav", player: { ...player, itemId: 541, moves: [moveId, 604, 875, 432] } },
  { file: "battle-miss.sav", player: { ...player, abilityId: 28, moves: [moveId, 604, 875, 432] } },
  { file: "battle-redcard.sav", player: { ...player, moves: [moveId, 604, 875, 432] }, benchPlayer: { ...player, speciesId: 149, abilityId: 28, moves: [150] } },
  { file: "battle-lifeorb.sav", player: { ...player, itemId: 270, moves: [moveId, 604, 875, 432] } },
  ...[["grassy", 580], ["misty", 581], ["psychic", 678]].map(([name, terrain]) => ({
    file: `battle-${name}.sav`, player: { ...player, moves: [moveId, Number(terrain), 875, 432] },
  })),
] : steelRoller ? [
  { file: "battle.sav", player },
  { file: "battle-airborne.sav", player: { ...player, itemId: 541 } },
  { file: "battle-miss.sav", player: { ...player, abilityId: 28 } },
  ...[["grassy", 580], ["misty", 581], ["psychic", 678]].map(([name, terrain]) => ({
    file: `battle-${name}.sav`, player: { ...player, moves: [moveId, Number(terrain), 875, 432] },
  })),
  { file: "battle-replace.sav", player: { ...player, moves: [moveId, 604, 580, 875] } },
] : risingVoltage ? [
  { file: "battle.sav", player },
  { file: "battle-airborne.sav", player: { ...player, itemId: 541 } },
  { file: "battle-defog.sav", player: { ...player, moves: [moveId, 604, 432, 580] } },
] : psyblade ? [
  { file: "battle.sav", player }, { file: "battle-airborne.sav", player: { ...player, itemId: 541 } },
] : grassyGlide ? [
  { file: "battle.sav", player },
  { file: "battle-airborne.sav", player: { ...player, itemId: 541 } },
  { file: "battle-gravity.sav", player: { ...player, itemId: 541, moves: [moveId, 580, 356, 182] } },
] : poltergeist ? [
  { file: "battle.sav", player },
  { file: "battle-miss.sav", player: { ...player, abilityId: 28 } },
  { file: "battle-parentalbond.sav", player: { ...player, abilityId: 185 } },
  { file: "battle-redcard.sav", player, benchPlayer: { ...player, speciesId: 149, abilityId: 28, moves: [150] } },
] : fickle ? [
  { file: "battle.sav", player }, { file: "battle-parentalbond.sav", player: { ...player, abilityId: 185 } },
] : moveName === "fishious-rend" ? [
  { file: "battle.sav", player }, { file: "battle-strongjaw.sav", player: { ...player, abilityId: 173 } },
] : [{ file: "battle.sav", player }];
for (const { file, player: savedPlayer, benchPlayer } of saveDefinitions) {
  const save = patchTestBattleSaveMoveAnimations(patchHarnessSave(rawSaveBytesFromDesmumeDsv(inputSave), project, { trainerId: 1, player: { team: [savedPlayer, ...(benchPlayer ? [benchPlayer] : [])] } }), saveConfig, false);
  await writeFile(resolve(directory, file), save, { flag: "wx" });
}
type MoveCase = { id: string; currentHp?: number; defenseStage?: number; blocked?: boolean;
  forceMiss?: boolean; substitute?: boolean; setupSlot?: number; setupAccuracyRoll?: number; expectedStatus?: number;
  expectedPowers?: number[]; effectivePowers?: number[]; expectedActed?: boolean[];
  completeTurn?: boolean; secondaryRoll?: number; expectPoison?: boolean;
  setupSlots?: number[]; allowFaint?: boolean; powerRule?: "target-hp";
  expectedDefenseStage?: number; expectedAirborne?: boolean; ppSpent?: number;
  damageRatios?: number[]; typeRatio?: number; powerRolls?: number[];
  expectedItemBefore?: number; expectedItemAfter?: number; announcements?: number;
  expectedBoosts?: number[]; expectedIncomingAttacker?: number;
  expectedItemBlocked?: boolean; expectedMagicRoom?: boolean; expectedUserItem?: number;
  accuracyRoll?: number; accuracyDraws?: number[]; expectedWeather?: number; expectedAccuracyRolls?: number;
  expectedAccuracy?: number; accuracyStage?: number; evasionStage?: number; expectedFly?: boolean;
  expectedFloating?: Partial<Record<"attacker" | "defender", boolean>>;
  executionItems?: Partial<Record<"attacker" | "defender", number>>;
  userStages?: number[]; expectedUserStages?: number[]; terrainEndMessages?: number;
  expectedHazards?: number; hazardsBefore?: number; userCurrentHp?: number; userFaints?: boolean;
  statusChoice?: number; statusAfter?: number; chanceRolls?: number; choiceRolls?: number; sleepDurationRolls?: number;
  defenderStages?: number[]; expectedDefenderStages?: number[];
  userStatusBefore?: number; defenderStatusBefore?: number; takeHeartSuccess?: boolean; snatched?: boolean;
  expectedMoveType?: number; expectedCurrentSpecies?: number; expectedForm?: number; transformed?: boolean;
  expectedUserTypes?: number[]; requiredOpponentMove?: number;
  typeChangeSuccess?: boolean; typeChangeSide?: "attacker" | "defender";
  typeChangeEvents?: number; expectedIncomingTypes?: number[];
  shieldBlocks?: boolean; shieldRetaliates?: boolean; shieldBypass?: number;
  shieldSuccess?: boolean; expectedUserStatus?: number; expectedOpponentStatus?: number;
  expectedBreakChecks?: number; expectedIncomingDamage?: number;
  weatherRatio?: number; expectedDamageWeather?: number; expectedMinimized?: boolean;
  contactCostDivisor?: number; expectedDisguise?: boolean; expectedDefenderForm?: number; disguiseSetupMove?: number;
  paysHpCost?: boolean; expectedMaxHpParity?: number; expectedUserAbilitySuppressed?: boolean;
  hpBoostSuccess?: boolean; hpBoostEvents?: number; berryHealing?: boolean; expectedPayment?: number;
  selectionRejected?: boolean;
  userStats?: number[]; expectedAttackValue?: number; expectedCritical?: number; burnRatio?: number;
  nativeSuccess?: boolean; initialHazards?: number[][]; screensRemain?: boolean;
  userSubstitute?: boolean; defenderSubstitute?: boolean;
  bypassSubstitute?: boolean;
  expectConditionalStatus?: boolean; expectedHistory?: number; historyVolume?: number;
  requiredOpponentMove?: number;
  followup?: { slot: number; moveId: number; power: number; category: number; type: number; case: MoveCase } };
type Variant = { name: string; trainerId: number; abilityId: number; trainerMove: number;
  playerAbilityId: number; save: string; cases: MoveCase[]; defenderSpecies?: number;
  playerSpecies?: number; playerForm?: number; defenderForm?: number;
  incomingSpecies?: number; bench?: boolean; benchMove?: number; defenderItemId?: number; defenderLevel?: number;
  incomingAttackerSpecies?: number; abilitySlot?: 1 | 2 };
const variants: Variant[] = lashOut ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-drop-no-boost", expectedPowers: [75] },
    { id: "existing-negative-stage-not-current-drop", userStages: [6,6,6,6,2,6,6], expectedPowers: [75] },
  ] },
  { name: "speed-drop", trainerId: 2, abilityId: 50, trainerMove: 184, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "actual-speed-drop-doubles", expectedPowers: [150], expectedHistory: 0, historyVolume: -2, requiredOpponentMove: 184 },
    { id: "capped-drop-does-not-qualify", userStages: [6,6,6,6,0,6,6], expectedPowers: [75], expectedHistory: 0, historyVolume: 0, requiredOpponentMove: 184 },
  ] },
  { name: "contrary", trainerId: 2, abilityId: 50, trainerMove: 184, defenderSpecies: 291, playerAbilityId: 126, save: "battle-ability-126.sav", cases: [
    { id: "contrary-rise-not-drop", expectedPowers: [75], expectedHistory: 0, historyVolume: 2, requiredOpponentMove: 184 },
  ] },
  { name: "clear-body", trainerId: 2, abilityId: 50, trainerMove: 184, defenderSpecies: 291, playerAbilityId: 29, save: "battle-ability-29.sav", cases: [
    { id: "prevented-drop-not-history", expectedPowers: [75], expectedHistory: 0, historyVolume: 0, requiredOpponentMove: 184 },
  ] },
  { name: "haze", trainerId: 3, abilityId: 50, trainerMove: 114, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "haze-overwrite-not-drop", userStages: [6,8,6,6,6,6,6], expectedPowers: [75], expectedHistory: 0, historyVolume: 0, requiredOpponentMove: 114 },
  ] },
  { name: "topsy", trainerId: 4, abilityId: 50, trainerMove: 576, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "topsy-overwrite-not-drop", userStages: [6,8,6,6,6,6,6], expectedPowers: [75], expectedHistory: 0, historyVolume: 0, requiredOpponentMove: 576 },
  ] },
  { name: "intimidate", trainerId: 5, abilityId: 22, trainerMove: 150, defenderSpecies: 291, abilitySlot: 2, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "entry-intimidate-counts", expectedPowers: [150], expectedAttackValue: 80 },
    { id: "new-turn-resets-history", setupSlot: 1, expectedPowers: [75], expectedAttackValue: 80 },
  ] },
  { name: "instruct-gooey", trainerId: 6, abilityId: 183, trainerMove: 689, defenderSpecies: 143, abilitySlot: 2, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "drop-between-actions-doubles-repeat", expectedPowers: [75,150], completeTurn: true, expectedHistory: 0, historyVolume: -1 },
  ] },
] : riseStatus ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-current-rise-no-status", expectConditionalStatus: false },
    { id: "old-stage-not-current-rise", defenderStages: [6,6,6,6,8,6,6], expectConditionalStatus: false },
  ] },
  { name: "boost", trainerId: 2, abilityId: 50, trainerMove: 97, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "earlier-agility-qualifies", expectConditionalStatus: true, expectedHistory: 12, historyVolume: 2, requiredOpponentMove: 97 },
    { id: "capped-stage-no-actual-rise", defenderStages: [6,6,6,6,12,6,6], expectConditionalStatus: false, expectedHistory: 12, historyVolume: 0, requiredOpponentMove: 97 },
    { id: "previous-turn-rise-reset", setupSlots: [1,1,1], expectConditionalStatus: false, expectedHistory: 12, historyVolume: 0, requiredOpponentMove: 97 },
  ] },
  { name: "policy", trainerId: 3, abilityId: 50, trainerMove: 150, defenderSpecies: jealousy ? 291 : 197, defenderItemId: 129, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "same-hit-weakness-policy-too-late", expectConditionalStatus: false, expectedBoosts: [8,6,8,6,6,6,6], typeRatio: 8192 },
  ] },
  { name: "sheer-force", trainerId: 2, abilityId: 50, trainerMove: 97, defenderSpecies: 291, playerAbilityId: 125, save: "battle-ability-125.sav", cases: [
    { id: "sheer-force-boosts-suppresses", expectConditionalStatus: false, effectivePowers: [jealousy ? 91 : 104] },
  ] },
  { name: "sheer-force-no-rise", trainerId: 1, abilityId: 50, trainerMove: 150, defenderSpecies: 291, playerAbilityId: 125, save: "battle-ability-125.sav", cases: [
    { id: "sheer-force-boost-unconditional", expectConditionalStatus: false, effectivePowers: [jealousy ? 91 : 104] },
  ] },
  { name: "immunity", trainerId: 4, abilityId: jealousy ? 41 : 20, trainerMove: 97, defenderSpecies: 169, abilitySlot: 2, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: jealousy ? "water-veil-veto" : "own-tempo-veto", expectConditionalStatus: false, typeRatio: jealousy ? 4096 : 2048 },
  ] },
  { name: "shield-dust", trainerId: 5, abilityId: 19, trainerMove: 97, defenderSpecies: 142, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "shield-dust-veto", expectConditionalStatus: false, typeRatio: jealousy ? 2048 : 4096 },
  ] },
  { name: "contrary", trainerId: 6, abilityId: 126, trainerMove: 97, defenderSpecies: 121, abilitySlot: 2, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "contrary-actual-drop-no-status", expectConditionalStatus: false, expectedHistory: 12, historyVolume: -2, requiredOpponentMove: 97, typeRatio: jealousy ? 2048 : 4096 },
  ] },
  { name: "download-substitute", trainerId: 7, abilityId: 88, trainerMove: 164, defenderSpecies: 291, abilitySlot: 2, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: jealousy ? "substitute-blocks-conditional-burn" : "sound-bypasses-substitute-and-confuses", expectConditionalStatus: !jealousy,
      substitute: jealousy, bypassSubstitute: !jealousy },
  ] },
] : tidyUp ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "boosts-with-nothing-to-clear", expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true },
    { id: "both-stats-capped-no-effects", userStages: [12,6,6,6,12,6,6], expectedUserStages: [12,6,6,6,12,6,6], nativeSuccess: false },
    { id: "one-stat-capped", userStages: [12,6,6,6,6,6,6], expectedUserStages: [12,6,6,6,7,6,6], nativeSuccess: true },
    { id: "own-substitute-cleared", setupSlot: 2, userSubstitute: true, expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true },
    { id: "substitute-benefit-at-capped-stats", setupSlot: 2, userStages: [12,6,6,6,12,6,6], userSubstitute: true, expectedUserStages: [12,6,6,6,12,6,6], nativeSuccess: true },
  ] },
  ...[86,126].map(abilityId => ({ name: `ability-${abilityId}`, trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: abilityId, save: `battle-ability-${abilityId}.sav`, cases: [
    { id: abilityId === 86 ? "simple-doubles-both-boosts" : "contrary-reverses-both", expectedUserStages: abilityId === 86 ? [8,6,6,6,8,6,6] : [5,6,6,6,5,6,6], nativeSuccess: true },
  ] })),
  { name: "both-substitutes", trainerId: 2, abilityId: 50, trainerMove: 164, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "both-active-substitutes-cleared", setupSlot: 2, userSubstitute: true, defenderSubstitute: true, expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true },
  ] },
  { name: "both-side-spikes", trainerId: 3, abilityId: 50, trainerMove: 191, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "spikes-on-both-sides-cleared", setupSlot: 1, initialHazards: [[1,0,0],[1,0,0]], expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true },
  ] },
  { name: "other-hazards", trainerId: 3, abilityId: 50, trainerMove: 191, playerAbilityId: 99, save: "battle-other-hazards.sav", cases: [
    { id: "toxic-spikes-rock-and-spikes-cleared", setupSlots: [1,2], initialHazards: [[2,0,0],[0,1,1]], expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true },
  ] },
  { name: "sticky-web", trainerId: 4, abilityId: 50, trainerMove: 564, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "both-sticky-webs-can-be-reapplied", setupSlot: 3, expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true,
      followup: { slot: 3, moveId: 564, power: 0, category: 0, type: 6, case: { id: "web-reapplication", nativeSuccess: true } } },
  ] },
  { name: "screens", trainerId: 5, abilityId: 50, trainerMove: 115, playerAbilityId: 99, save: "battle-screens.sav", cases: [
    { id: "reflect-on-both-sides-preserved", setupSlot: 1, expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true, screensRemain: true },
  ] },
  { name: "terrain", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-terrain.sav", cases: [
    { id: "electric-terrain-preserved", setupSlot: 1, expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true,
      followup: { slot: 2, moveId: 805, power: 50, category: 2, type: 0, case: { id: "terrain-pulse-after-tidy", expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12 } } },
  ] },
  { name: "snatch", trainerId: 6, abilityId: 50, trainerMove: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "not-snatchable", expectedUserStages: [7,6,6,6,7,6,6], nativeSuccess: true },
  ] },
] : bodyPress ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "raw-defense-not-attack", expectedAttackValue: 60 },
    { id: "defense-plus-two", userStages: [6,8,6,6,6,6,6], expectedAttackValue: 120 },
    { id: "attack-plus-six-ignored", userStages: [12,6,6,6,6,6,6], expectedAttackValue: 60 },
    { id: "defense-minus-two", userStages: [6,4,6,6,6,6,6], expectedAttackValue: 30 },
    { id: "critical-ignores-negative-defense", setupSlot: 1, userStages: [6,4,6,6,6,6,6], expectedAttackValue: 60, expectedCritical: 1 },
    { id: "critical-retains-positive-defense", setupSlot: 1, userStages: [6,8,6,6,6,6,6], expectedAttackValue: 120, expectedCritical: 1 },
  ] },
  { name: "huge-power", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 37, save: "battle-hugepower.sav", cases: [
    { id: "huge-power-still-doubles", expectedAttackValue: 120 },
  ] },
  { name: "fur-coat", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 169, save: "battle-furcoat.sav", cases: [
    { id: "fur-coat-does-not-boost-offense", expectedAttackValue: 60 },
  ] },
  { name: "choice-band", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-band.sav", cases: [
    { id: "choice-band-still-boosts", expectedAttackValue: 90 },
  ] },
  { name: "eviolite", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, playerSpecies: 25, save: "battle-eviolite.sav", cases: [
    { id: "eviolite-does-not-boost-offense", expectedAttackValue: 60 },
  ] },
  { name: "burn", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-burn.sav", cases: [
    { id: "burn-still-halves", setupSlot: 1, expectedAttackValue: 60, burnRatio: 2048 },
  ] },
  { name: "unaware", trainerId: 2, abilityId: 109, abilitySlot: 2, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "unaware-ignores-defense-boost", userStages: [6,12,6,6,6,6,6], expectedAttackValue: 60 },
  ] },
] : hpBoost ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "odd-maximum-rounding", hpBoostSuccess: true, expectedPayment: boostCost175, expectedUserStages: fullBoostStages },
    { id: "equal-payment-fails", userCurrentHp: boostCost175, hpBoostSuccess: false, expectedUserStages: Array(7).fill(6) },
    { id: "below-payment-fails", userCurrentHp: boostCost175 - 1, hpBoostSuccess: false, expectedUserStages: Array(7).fill(6) },
    { id: "one-above-payment-survives", userCurrentHp: boostCost175 + 1, hpBoostSuccess: true, expectedUserStages: fullBoostStages },
    { id: "all-affected-capped-fails", userStages: cappedBoostStages, hpBoostSuccess: false, expectedUserStages: cappedBoostStages },
    { id: "one-stat-can-still-rise", userStages: hpBoostStages(cappedBoostStages, 0).map((v, i) => i === 2 ? 11 : v),
      hpBoostSuccess: true, expectedUserStages: cappedBoostStages },
    { id: "negative-stages-can-rise", userStages: flooredBoostStages, hpBoostSuccess: true, expectedUserStages: hpBoostStages(flooredBoostStages) },
    { id: "own-substitute-preserved", setupSlot: 2, hpBoostSuccess: true, expectedUserStages: fullBoostStages },
    { id: "repeat-pays-once-per-action", hpBoostSuccess: true, expectedUserStages: fullBoostStages,
      followup: { slot: 0, moveId, power: 0, category: 0, type: definition.type, case: {
        id: "repeat", hpBoostSuccess: true, userStages: fullBoostStages, expectedUserStages: hpBoostStages(fullBoostStages) } } },
  ] },
  { name: "even-maximum", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-level51.sav", cases: [
    { id: "even-maximum-rounding", hpBoostSuccess: true, expectedPayment: soul ? 58 : 89, expectedUserStages: fullBoostStages },
  ] },
  { name: "simple", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 86, save: "battle-ability-86.sav", cases: [
    { id: "simple-doubles-not-payment", hpBoostSuccess: true, expectedUserStages: hpBoostStages(Array(7).fill(6), 2 * boostAmount) },
    { id: "simple-clamps-stages", userStages: Array(7).fill(11), hpBoostSuccess: true, expectedUserStages: hpBoostStages(Array(7).fill(11), 2 * boostAmount) },
  ] },
  { name: "contrary", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 126, save: "battle-ability-126.sav", cases: [
    { id: "contrary-reverses-boosts", hpBoostSuccess: true, expectedUserStages: hpBoostStages(Array(7).fill(6), -boostAmount) },
    { id: "contrary-upper-caps-can-drop", userStages: cappedBoostStages, hpBoostSuccess: true, expectedUserStages: hpBoostStages(cappedBoostStages, -boostAmount) },
    { id: "contrary-all-floors-fails", userStages: flooredBoostStages, hpBoostSuccess: false, expectedUserStages: flooredBoostStages },
  ] },
  ...[98, 69].map(ability => ({ name: ability === 98 ? "magic-guard" : "rock-head", trainerId: 1, abilityId: 50,
    trainerMove: 150, playerAbilityId: ability, save: `battle-ability-${ability}.sav`, cases: [
      { id: "direct-cost-not-recoil", hpBoostSuccess: true, expectedUserStages: fullBoostStages },
    ] })),
  { name: "sitrus", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-sitrus.sav", cases: [
    { id: "berry-after-payment-and-stats", userCurrentHp: 100, hpBoostSuccess: true, berryHealing: true, expectedUserStages: fullBoostStages },
  ] },
  { name: "snatch", trainerId: 2, abilityId: 50, trainerMove: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "snatcher-pays-and-boosts", snatched: true, hpBoostSuccess: true, expectedUserStages: Array(7).fill(6), expectedDefenderStages: fullBoostStages },
    { id: "snatcher-insufficient-hp-fails", currentHp: soul ? 77 : 117, snatched: true, hpBoostSuccess: false,
      expectedUserStages: Array(7).fill(6), expectedDefenderStages: Array(7).fill(6) },
  ] },
  { name: "throat-chop", trainerId: 3, abilityId: 50, trainerMove: 675, defenderLevel: 10,
    playerAbilityId: 99, save: "battle.sav", cases: [
      { id: "sound-only-blocked", setupSlot: 1, requiredOpponentMove: 675, hpBoostEvents: soul ? 0 : 1,
        selectionRejected: soul, hpBoostSuccess: !soul, expectedUserStages: soul ? Array(7).fill(6) : fullBoostStages },
    ] },
] : hpCost ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "odd-maximum-rounds-up", expectedPowers: [definition.power], paysHpCost: true, expectedMaxHpParity: 1 },
    { id: "low-current-hp-still-costs-half-maximum", userCurrentHp: 89, expectedPowers: [definition.power], paysHpCost: true },
    { id: "target-ko-still-pays", currentHp: 1, allowFaint: true, expectedPowers: [definition.power], paysHpCost: true },
  ] },
  { name: "even-maximum", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 50, save: "battle-level51.sav", cases: [
    { id: "even-maximum-halves-exactly", expectedPowers: [definition.power], paysHpCost: true, expectedMaxHpParity: 0 },
  ] },
  { name: "protect", trainerId: 2, abilityId: 50, trainerMove: 182, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "protection-cost-policy", blocked: true, paysHpCost: steelBeam, expectedAccuracyRolls: 0 },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "miss-cost-policy", blocked: true, paysHpCost: steelBeam, accuracyRoll: 95, expectedAccuracyRolls: 1 },
  ] },
  { name: "wonder-guard", trainerId: 3, abilityId: 25, trainerMove: 150, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "immunity-cost-policy", blocked: true, paysHpCost: steelBeam, expectedAccuracyRolls: 0 },
  ] },
  { name: "substitute", trainerId: 4, abilityId: 50, trainerMove: 164, defenderSpecies: 289, defenderLevel: 100, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "native-doll-hit-still-pays", substitute: true, expectedPowers: [definition.power], paysHpCost: true },
  ] },
  { name: "rock-head", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 69, save: "battle-ability-69.sav", cases: [
    { id: "rock-head-cost-policy", expectedPowers: [definition.power], paysHpCost: steelBeam },
  ] },
  { name: "magic-guard", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 98, save: "battle-ability-98.sav", cases: [
    { id: "magic-guard-prevents-cost", expectedPowers: [definition.power], paysHpCost: false, followup: {
      slot: 0, moveId, power: definition.power, category: definition.category, type: definition.type,
      case: { id: "second-use-remains-protected", expectedPowers: [definition.power], paysHpCost: false, ppSpent: 1, damageRatios: [4096] },
    } },
  ] },
  { name: "reckless", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 120, save: "battle-ability-120.sav", cases: [
    { id: "reckless-does-not-boost-damage", expectedPowers: [definition.power], paysHpCost: true },
  ] },
  ...[69, 98].map(ability => ({ name: `suppressed-${ability}`, trainerId: 5, abilityId: 50, trainerMove: 380,
    defenderSpecies: 151, defenderLevel: 75, playerAbilityId: ability, save: `battle-ability-${ability}.sav`, cases: [
      { id: "gastro-acid-restores-cost", expectedPowers: [definition.power], paysHpCost: true, expectedUserAbilitySuppressed: true },
    ] })),
  { name: "parental-bond", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 185, save: "battle-ability-185.sav", cases: [
    { id: "two-strikes-one-hp-cost", expectedPowers: [definition.power, definition.power], effectivePowers: [definition.power, Math.floor(definition.power / 2)], paysHpCost: true },
  ] },
  { name: "disguise", trainerId: 6, abilityId: 209, trainerMove: 150, defenderSpecies: 778, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "absorbed-hit-still-pays-cost", expectedPowers: [definition.power], paysHpCost: true, expectedDisguise: true, typeRatio: steelBeam ? 8192 : 4096 },
  ] },
] : ruination ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "full-hp" }, { id: "odd-hp", currentHp: 101 }, { id: "even-hp", currentHp: 100 },
    { id: "one-hp", currentHp: 1 }, { id: "boosted-defense", currentHp: 101, defenseStage: 12 },
  ] },
  { name: "protect", trainerId: 2, abilityId: 50, trainerMove: 182, playerAbilityId: 99, save: "battle.sav", cases: [{ id: "protect", blocked: true }] },
  { name: "wonder-guard", trainerId: 3, abilityId: 25, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [{ id: "type-ability-immunity", blocked: true }] },
  { name: "substitute", trainerId: 4, abilityId: 50, trainerMove: 164, playerAbilityId: 99, save: "battle.sav", cases: [{ id: "substitute", substitute: true }] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", cases: [{ id: "accuracy-miss", blocked: true, forceMiss: true }] },
] : terrainPulse ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-terrain-normal", expectedPowers: [50], expectedMoveType: 0 },
    { id: "electric-grounded", setupSlot: 1, expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12, expectedFloating: { attacker: false } },
    { id: "defog-removes-type-and-power", setupSlots: [1, 2], expectedPowers: [50], expectedMoveType: 0 },
  ] },
  ...[{ name: "electric", id: 2, move: 604, type: 12, power: 130 },
      { name: "grassy", id: 3, move: 580, type: 11, power: 130 },
      { name: "misty", id: 4, move: 581, type: 17, power: 100 },
      { name: "psychic", id: 5, move: 678, type: 13, power: 130 }].flatMap(field => [
    { name: field.name, trainerId: field.id, abilityId: 50, trainerMove: field.move, playerAbilityId: 99, save: "battle-wait.sav", cases: [
      { id: `${field.name}-grounded`, setupSlot: 1, expectedPowers: [100], effectivePowers: [field.power], expectedMoveType: field.type, expectedFloating: { attacker: false } },
    ] },
    { name: `${field.name}-airborne`, trainerId: field.id, abilityId: 50, trainerMove: field.move, playerAbilityId: 99, save: "battle-airborne.sav", cases: [
      { id: `${field.name}-air-balloon-stays-normal`, setupSlot: 1, expectedPowers: [50], expectedMoveType: 0, expectedFloating: { attacker: true }, executionItems: { attacker: 541 } },
      ...(field.name === "electric" ? [{ id: "gravity-grounds-user-balloon", setupSlots: [1, 3], expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12, expectedFloating: { attacker: false }, executionItems: { attacker: 541 } }] : []),
    ] },
  ]),
  { name: "levitate", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 26, save: "battle-levitate.sav", cases: [
    { id: "levitate-stays-normal", setupSlot: 1, expectedPowers: [50], expectedMoveType: 0, expectedFloating: { attacker: true } },
    { id: "gravity-grounds-levitate", setupSlots: [1, 3], expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12, expectedFloating: { attacker: false } },
  ] },
  { name: "replacement", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-replace.sav", cases: [
    { id: "grassy-replaces-electric", setupSlots: [1, 2], expectedPowers: [100], effectivePowers: [130], expectedMoveType: 11 },
  ] },
  ...[96, 174, 182, 184, 206].map(ability => ({ name: `type-ability-${ability}`, trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: ability, save: `battle-ability-${ability}.sav`, cases: [
    { id: `ability-${ability}-cannot-convert-normal`, expectedPowers: [50], expectedMoveType: 0 },
    { id: `ability-${ability}-cannot-convert-or-boost-terrain`, setupSlot: 1, expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12 },
  ] })),
  { name: "mega-launcher", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 178, save: "battle-ability-178.sav", cases: [
    { id: "pulse-flag-no-terrain", expectedPowers: [50], effectivePowers: [75], expectedMoveType: 0 },
    { id: "launcher-and-terrain-bonuses-combine", setupSlot: 1, expectedPowers: [100], effectivePowers: [195], expectedMoveType: 12 },
  ] },
  // Native Splash makes the Protean user Normal before the opponent sets
  // Electric Terrain. The tested attack must then change the user itself.
  { name: "protean", trainerId: 2, abilityId: 50, trainerMove: 604, playerAbilityId: 168, save: "battle-ability-168.sav", cases: [
    { id: "protean-uses-resolved-terrain-type", setupSlot: 1, expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12, expectedUserTypes: [12, 12] },
  ] },
  { name: "electrify", trainerId: 6, abilityId: 50, trainerMove: 582, defenderSpecies: 151, defenderLevel: 75, playerAbilityId: 99, save: "battle-misty.sav", cases: [
    { id: "electrify-no-terrain", expectedPowers: [50], expectedMoveType: 12, requiredOpponentMove: 582 },
    { id: "electrify-keeps-misty-power-doubling", setupSlot: 1, expectedPowers: [100], expectedMoveType: 12, requiredOpponentMove: 582 },
  ] },
  { name: "ion-deluge", trainerId: 7, abilityId: 50, trainerMove: 569, playerAbilityId: 99, save: "battle-misty.sav", cases: [
    { id: "ion-deluge-converts-normal", expectedPowers: [50], expectedMoveType: 12, requiredOpponentMove: 569 },
    { id: "ion-deluge-does-not-convert-fairy", setupSlot: 1, expectedPowers: [100], expectedMoveType: 17, requiredOpponentMove: 569 },
  ] },
  { name: "protect", trainerId: 8, abilityId: 226, trainerMove: 182, defenderSpecies: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    // Surge establishes terrain at entry, avoiding a repeated-Protect
    // success roll during a setup turn. The native first Protect is tested.
    { id: "terrain-does-not-bypass-protect", blocked: true },
  ] },
  { name: "immune", trainerId: 9, abilityId: 50, trainerMove: 150, defenderSpecies: 232, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "resolved-electric-ground-immunity", setupSlot: 1, blocked: true },
  ] },
  { name: "airborne-target", trainerId: 11, abilityId: 50, trainerMove: 150, defenderItemId: 541, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "only-user-grounding-gates-terrain-pulse", setupSlot: 1, expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12, expectedFloating: { attacker: false }, executionItems: { defender: 541 } },
  ] },
  { name: "substitute", trainerId: 10, abilityId: 226, trainerMove: 164, defenderSpecies: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "resolved-terrain-damages-substitute", expectedPowers: [100], effectivePowers: [130], expectedMoveType: 12, substitute: true },
  ] },
] : damageShield ? [
  { name: "contact", trainerId: 1, abilityId: 50, trainerMove: 33, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "contact-blocked-and-retaliated", shieldBlocks: true, shieldRetaliates: true },
    { id: "turn-end-cleans-position-event", shieldBlocks: true, shieldRetaliates: true,
      followup: { slot: 1, moveId: 150, power: 0, category: 0, type: 0, case: { id: "next-turn-no-shield", completeTurn: true } } },
  ] },
  { name: "noncontact", trainerId: 2, abilityId: 50, trainerMove: 129, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "noncontact-blocked-without-retaliation", shieldBlocks: true, shieldRetaliates: false },
  ] },
  { name: "status", trainerId: 3, abilityId: 50, trainerMove: 92, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "status-move-bypasses-without-breaking", shieldBlocks: false, shieldRetaliates: false, shieldBypass: 2, expectedUserStatus: 5 },
  ] },
  { name: "feint", trainerId: 4, abilityId: 50, trainerMove: 364, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "feint-breaks-without-retaliation", shieldBlocks: false, shieldRetaliates: false, shieldBypass: 1 },
  ] },
  { name: "bypass", trainerId: 9, abilityId: 50, trainerMove: 887, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "hyper-drill-bypasses-without-retaliation", shieldBlocks: false, shieldRetaliates: false },
  ] },
  { name: "immune-contact", trainerId: 1, abilityId: 50, trainerMove: 33, playerSpecies: 94, playerAbilityId: 99, save: "battle-ghost.sav", cases: [
    { id: "otherwise-immune-contact-still-retaliates", shieldBlocks: true, shieldRetaliates: true },
  ] },
  { name: "immune-bypass", trainerId: 9, abilityId: 50, trainerMove: 887, playerSpecies: 94, playerAbilityId: 99, save: "battle-ghost.sav", cases: [
    { id: "immune-hyper-drill-keeps-real-immunity", shieldBlocks: false, shieldRetaliates: false, expectedBreakChecks: 0, expectedIncomingDamage: 0 },
  ] },
  { name: "long-reach", trainerId: 5, abilityId: 203, trainerMove: 33, defenderSpecies: 151, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "long-reach-prevents-retaliation", shieldBlocks: true, shieldRetaliates: false },
  ] },
  { name: "protective-pads", trainerId: 8, abilityId: 50, trainerMove: 33, defenderItemId: 114, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protective-pads-prevent-retaliation", shieldBlocks: true, shieldRetaliates: false },
  ] },
  { name: "embargo-pads", trainerId: 8, abilityId: 50, trainerMove: 33, defenderItemId: 114, playerAbilityId: 99, save: "battle-embargo.sav", cases: [
    { id: "embargo-disabled-pads-allow-retaliation", setupSlot: 1, shieldBlocks: true, shieldRetaliates: true },
  ] },
  { name: "helmet", trainerId: 1, abilityId: 50, trainerMove: 33, playerAbilityId: 99, save: "battle-helmet.sav", cases: [
    { id: "no-helmet-damage-on-protection", shieldBlocks: true, shieldRetaliates: true },
  ] },
  { name: "rough-skin", trainerId: 1, abilityId: 50, trainerMove: 33, playerAbilityId: 24, save: "battle-roughskin.sav", cases: [
    { id: "no-rough-skin-damage-on-protection", shieldBlocks: true, shieldRetaliates: true },
  ] },
  ...(moveName === "burning-bulwark" ? [
    { name: "water-veil", trainerId: 6, abilityId: 41, trainerMove: 33, defenderSpecies: 105, playerAbilityId: 99, save: "battle.sav", cases: [
      { id: "native-water-veil-prevents-burn", shieldBlocks: true, shieldRetaliates: true, expectedOpponentStatus: 0 },
    ] },
    { name: "fire-type", trainerId: 10, abilityId: 50, trainerMove: 33, defenderSpecies: 126, playerAbilityId: 99, save: "battle.sav", cases: [
      { id: "native-fire-type-prevents-burn", shieldBlocks: true, shieldRetaliates: true, expectedOpponentStatus: 0 },
    ] },
  ] : [
    { name: "clear-body", trainerId: 6, abilityId: 29, trainerMove: 33, defenderSpecies: 143, playerAbilityId: 99, save: "battle.sav", cases: [
      { id: "native-clear-body-prevents-drop", shieldBlocks: true, shieldRetaliates: true, expectedDefenderStages: Array(7).fill(6) },
    ] },
    { name: "contrary", trainerId: 7, abilityId: 126, trainerMove: 33, defenderSpecies: 232, playerAbilityId: 99, save: "battle.sav", cases: [
      { id: "native-contrary-reverses-drop", shieldBlocks: true, shieldRetaliates: true, expectedDefenderStages: Array.from({length: 7}, (_, i) => i === shieldStat ? 6 + shieldDrop : 6) },
    ] },
  ]),
] : magicPowder ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "normal-becomes-pure-psychic", typeChangeSuccess: true,
      followup: { slot: 0, moveId, power: 0, category: 0, type: 13, case: { id: "repeat-pure-psychic-fails", typeChangeSuccess: false, typeChangeEvents: 1 } } },
    { id: "added-grass-blocks", setupSlot: 1, typeChangeSuccess: false, typeChangeEvents: 0 },
  ] },
  { name: "dual", trainerId: 2, abilityId: 50, trainerMove: 150, defenderSpecies: 6, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "fire-flying-replaced-not-added", typeChangeSuccess: true },
  ] },
  { name: "psychic-dual", trainerId: 3, abilityId: 50, trainerMove: 150, defenderSpecies: 80, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "water-psychic-replaced", typeChangeSuccess: true },
  ] },
  { name: "already-psychic", trainerId: 4, abilityId: 50, trainerMove: 150, defenderSpecies: 151, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "pure-psychic-fails", typeChangeSuccess: false, typeChangeEvents: 1 },
    { id: "psychic-plus-ghost-replaced", setupSlot: 2, typeChangeSuccess: true },
  ] },
  { name: "grass", trainerId: 5, abilityId: 50, trainerMove: 150, defenderSpecies: 254, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "grass-type-immune", typeChangeSuccess: false, typeChangeEvents: 0 },
  ] },
  { name: "grass-moldbreaker", trainerId: 5, abilityId: 50, trainerMove: 150, defenderSpecies: 254, playerAbilityId: 104, save: "battle-moldbreaker.sav", cases: [
    { id: "moldbreaker-cannot-ignore-grass", typeChangeSuccess: false, typeChangeEvents: 0 },
  ] },
  { name: "overcoat", trainerId: 6, abilityId: 142, trainerMove: 150, defenderSpecies: 630, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "overcoat-blocks-powder", typeChangeSuccess: false, typeChangeEvents: 0 },
  ] },
  { name: "overcoat-moldbreaker", trainerId: 6, abilityId: 142, trainerMove: 150, defenderSpecies: 630, playerAbilityId: 104, save: "battle-moldbreaker.sav", cases: [
    { id: "moldbreaker-ignores-overcoat", typeChangeSuccess: true },
  ] },
  { name: "overcoat-suppressed", trainerId: 6, abilityId: 142, trainerMove: 150, defenderSpecies: 630, playerAbilityId: 99, save: "battle-suppress.sav", cases: [
    { id: "gastro-acid-removes-overcoat-immunity", setupSlot: 1, typeChangeSuccess: true },
  ] },
  { name: "goggles", trainerId: 7, abilityId: 50, trainerMove: 150, defenderItemId: 127, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "safety-goggles-block", typeChangeSuccess: false, typeChangeEvents: 0 },
    { id: "embargo-disables-goggles", setupSlot: 3, typeChangeSuccess: true },
  ] },
  { name: "goggles-moldbreaker", trainerId: 7, abilityId: 50, trainerMove: 150, defenderItemId: 127, playerAbilityId: 104, save: "battle-moldbreaker.sav", cases: [
    { id: "moldbreaker-does-not-ignore-item", typeChangeSuccess: false, typeChangeEvents: 0 },
  ] },
  { name: "rks-system", trainerId: 8, abilityId: 225, trainerMove: 150, defenderSpecies: 773, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "rks-system-cannot-change-type", typeChangeSuccess: false, typeChangeEvents: 1 },
  ] },
  { name: "rks-moldbreaker", trainerId: 8, abilityId: 225, trainerMove: 150, defenderSpecies: 773, playerAbilityId: 104, save: "battle-moldbreaker.sav", cases: [
    { id: "rks-system-unignorable", typeChangeSuccess: false, typeChangeEvents: 1 },
  ] },
  { name: "multitype", trainerId: 9, abilityId: 121, trainerMove: 150, defenderSpecies: 493, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "arceus-preserves-type", typeChangeSuccess: false, typeChangeEvents: 1 },
  ] },
  { name: "protect", trainerId: 10, abilityId: 50, trainerMove: 182, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protect-blocks-replacement", typeChangeSuccess: false, typeChangeEvents: 0 },
  ] },
  { name: "substitute", trainerId: 11, abilityId: 50, trainerMove: 164, defenderSpecies: 291, defenderLevel: 100, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "substitute-blocks-replacement", typeChangeSuccess: false, typeChangeEvents: 0, substitute: true },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", cases: [
    { id: "accuracy-miss-preserves-types", typeChangeSuccess: false, typeChangeEvents: 0, forceMiss: true, accuracyStage: 0, evasionStage: 12, accuracyRoll: 99 },
  ] },
  { name: "ghost-removal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-ghost.sav", cases: [
    { id: "replacement-clears-third-type", setupSlots: [1, 2], typeChangeSuccess: true,
      followup: { slot: 2, moveId: 129, power: 60, category: 2, type: 0, case: { id: "swift-hits-after-ghost-removed", expectedPowers: [60], typeRatio: 4096 } } },
  ] },
  { name: "reflection", trainerId: 12, abilityId: 50, trainerMove: 277, defenderSpecies: 151, playerSpecies: 126, playerAbilityId: 99, save: "battle-reflect.sav", cases: [
    { id: "magic-coat-reflects-type-replacement", typeChangeSuccess: true, typeChangeSide: "attacker", requiredOpponentMove: 277 },
  ] },
  { name: "switch-restoration", trainerId: 13, abilityId: 50, trainerMove: 369, incomingSpecies: 232, bench: true, benchMove: 369, playerAbilityId: 99, save: "battle-switch.sav", cases: [
    { id: "native-switch-away-then-back", typeChangeSuccess: true, completeTurn: true, expectedIncomingTypes: [4, 4],
      followup: { slot: 3, moveId: 150, power: 0, category: 0, type: 0, case: { id: "returning-original-restores-normal", completeTurn: true, expectedIncomingTypes: [0, 0] } } },
  ] },
] : auraWheel ? [
  { name: "full-belly", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "full-belly-electric", expectedMoveType: 12, expectedPowers: [110] },
  ] },
  { name: "hangry", trainerId: 2, abilityId: 50, trainerMove: 150, defenderSpecies: 151, playerAbilityId: 99, playerForm: 1, save: "battle-hangry.sav", cases: [
    { id: "hangry-dark-super-effective", expectedMoveType: 16, expectedPowers: [110], typeRatio: 8192 },
  ] },
  { name: "non-morpeko", trainerId: 1, abilityId: 50, trainerMove: 150, playerSpecies: 151, playerAbilityId: 99, save: "battle-mew.sav", cases: [
    { id: "copied-move-other-species-fails", blocked: true, expectedCurrentSpecies: 151 },
  ] },
  ...[0, 1].map(form => ({ name: `transform-${form}`, trainerId: 3 + form, abilityId: 50, trainerMove: moveId,
    defenderSpecies: 877, defenderForm: form, playerSpecies: 151, playerAbilityId: 99, save: "battle-mew.sav", cases: [
      { id: `transform-into-morpeko-form-${form}`, setupSlot: 1, transformed: true,
        expectedCurrentSpecies: 877, expectedForm: form, expectedMoveType: form ? 16 : 12, expectedPowers: [110], typeRatio: 2048 },
    ] })),
  { name: "transform-away", trainerId: 5, abilityId: 50, trainerMove: moveId, defenderSpecies: 151,
    playerAbilityId: 99, save: "battle.sav", cases: [
      { id: "morpeko-transformed-away-fails", setupSlot: 1, transformed: true, expectedCurrentSpecies: 151, expectedForm: 0, blocked: true },
    ] },
  { name: "protect", trainerId: 6, abilityId: 50, trainerMove: 182, defenderSpecies: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protect-no-speed-boost", blocked: true, requiredOpponentMove: 182 },
  ] },
  { name: "immune", trainerId: 7, abilityId: 50, trainerMove: 150, defenderSpecies: 232, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "ground-immunity-no-speed-boost", blocked: true },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", cases: [
    { id: "miss-no-speed-boost", blocked: true, forceMiss: true, accuracyStage: 0, evasionStage: 12, accuracyRoll: 99 },
  ] },
  { name: "normalize", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 96, playerForm: 1, save: "battle-normalize.sav", cases: [
    { id: "normalize-preserved", expectedMoveType: 0, expectedPowers: [110] },
  ] },
  { name: "electrify", trainerId: 8, abilityId: 50, trainerMove: 582, defenderSpecies: 291, defenderLevel: 100,
    playerAbilityId: 99, playerForm: 1, save: "battle-hangry.sav", cases: [
      { id: "electrify-overrides-hangry-dark", expectedMoveType: 12, expectedPowers: [110], typeRatio: 8192, requiredOpponentMove: 582 },
    ] },
  { name: "ion-deluge", trainerId: 9, abilityId: 50, trainerMove: 569, playerAbilityId: 96, playerForm: 1, save: "battle-normalize.sav", cases: [
    { id: "ion-deluge-after-normalize", expectedMoveType: 12, expectedPowers: [110], requiredOpponentMove: 569 },
  ] },
  { name: "pixilate", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 182, playerForm: 1, save: "battle-pixilate.sav", cases: [
    { id: "pixilate-does-not-convert-dark", expectedMoveType: 16, expectedPowers: [110] },
  ] },
  { name: "protean", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 168, playerForm: 1, save: "battle-protean.sav", cases: [
    { id: "protean-uses-resolved-dark", expectedMoveType: 16, expectedPowers: [110], expectedUserTypes: [16, 16] },
  ] },
  { name: "substitute", trainerId: 10, abilityId: 50, trainerMove: 164, defenderSpecies: 291, defenderLevel: 100,
    playerAbilityId: 99, playerForm: 1, save: "battle-hangry.sav", cases: [
      { id: "hangry-damages-substitute", substitute: true, expectedMoveType: 16, expectedPowers: [110] },
    ] },
] : takeHeart ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "healthy-boosts-both", expectedUserStages: [6, 6, 7, 7, 6, 6, 6], takeHeartSuccess: true },
    { id: "special-attack-capped", userStages: [6, 6, 12, 6, 6, 6, 6], expectedUserStages: [6, 6, 12, 7, 6, 6, 6], takeHeartSuccess: true },
    { id: "special-defense-capped", userStages: [6, 6, 6, 12, 6, 6, 6], expectedUserStages: [6, 6, 7, 12, 6, 6, 6], takeHeartSuccess: true },
    { id: "healthy-both-capped-fails", userStages: [6, 6, 12, 12, 6, 6, 6], expectedUserStages: [6, 6, 12, 12, 6, 6, 6], takeHeartSuccess: false },
    { id: "negative-stages-rise-normally", userStages: [8, 4, 0, 2, 9, 5, 7], expectedUserStages: [8, 4, 1, 3, 9, 5, 7], takeHeartSuccess: true },
    { id: "own-substitute-does-not-block", setupSlot: 2, expectedUserStages: [6, 6, 7, 7, 6, 6, 6], takeHeartSuccess: true },
    { id: "repeat-boosts-again", expectedUserStages: [6, 6, 7, 7, 6, 6, 6], takeHeartSuccess: true,
      followup: { slot: 0, moveId, power: 0, category: 0, type: 13, case: { id: "second-take-heart", userStages: [6, 6, 7, 7, 6, 6, 6], expectedUserStages: [6, 6, 8, 8, 6, 6, 6], takeHeartSuccess: true } } },
  ] },
  { name: "simple", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 86, save: "battle-simple.sav", cases: [
    { id: "simple-doubles-both", expectedUserStages: [6, 6, 8, 8, 6, 6, 6], takeHeartSuccess: true },
    { id: "simple-clamps-near-cap", userStages: [6, 6, 11, 11, 6, 6, 6], expectedUserStages: [6, 6, 12, 12, 6, 6, 6], takeHeartSuccess: true },
    { id: "simple-at-cap-fails", userStages: [6, 6, 12, 12, 6, 6, 6], expectedUserStages: [6, 6, 12, 12, 6, 6, 6], takeHeartSuccess: false },
  ] },
  { name: "contrary", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 126, save: "battle-contrary.sav", cases: [
    { id: "contrary-reverses-both", expectedUserStages: [6, 6, 5, 5, 6, 6, 6], takeHeartSuccess: true },
    { id: "contrary-upper-caps-can-drop", userStages: [6, 6, 12, 12, 6, 6, 6], expectedUserStages: [6, 6, 11, 11, 6, 6, 6], takeHeartSuccess: true },
    { id: "contrary-both-floors-fails", userStages: [6, 6, 0, 0, 6, 6, 6], expectedUserStages: [6, 6, 0, 0, 6, 6, 6], takeHeartSuccess: false },
    { id: "contrary-one-floor", userStages: [6, 6, 0, 6, 6, 6, 6], expectedUserStages: [6, 6, 0, 5, 6, 6, 6], takeHeartSuccess: true },
  ] },
  ...[["burn", 4], ["poison", 5]].map(([name, status]) => ({ name: String(name), trainerId: 1, abilityId: 50, trainerMove: 150,
    playerAbilityId: 99, save: `battle-${name}.sav`, cases: [
      { id: `${name}-cured-with-boosts`, setupSlot: 1, userStatusBefore: Number(status), expectedUserStages: [6, 6, 7, 7, 6, 6, 6], takeHeartSuccess: true },
      { id: `${name}-cured-at-both-caps`, setupSlot: 1, userStatusBefore: Number(status), userStages: [6, 6, 12, 12, 6, 6, 6], expectedUserStages: [6, 6, 12, 12, 6, 6, 6], takeHeartSuccess: true },
    ] })),
  { name: "paralysis", trainerId: 2, abilityId: 50, trainerMove: 86, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "native-paralysis-cured", setupSlot: 1, userStatusBefore: 1, expectedUserStages: [6, 6, 7, 7, 6, 6, 6], takeHeartSuccess: true },
    { id: "paralysis-only-benefit", setupSlot: 1, userStatusBefore: 1, userStages: [6, 6, 12, 12, 6, 6, 6], expectedUserStages: [6, 6, 12, 12, 6, 6, 6], takeHeartSuccess: true },
  ] },
  { name: "contrary-status", trainerId: 2, abilityId: 50, trainerMove: 86, playerAbilityId: 126, save: "battle-contrary.sav", cases: [
    { id: "contrary-floor-status-only-benefit", setupSlot: 1, userStatusBefore: 1, userStages: [6, 6, 0, 0, 6, 6, 6], expectedUserStages: [6, 6, 0, 0, 6, 6, 6], takeHeartSuccess: true },
  ] },
  { name: "snatch", trainerId: 3, abilityId: 50, trainerMove: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "snatcher-gets-both-boosts", snatched: true, expectedUserStages: Array(7).fill(6), expectedDefenderStages: [6, 6, 7, 7, 6, 6, 6], takeHeartSuccess: true },
  ] },
  { name: "snatch-status", trainerId: 4, abilityId: 50, trainerMove: 289, defenderItemId: 272, playerAbilityId: 99, save: "battle-poison.sav", cases: [
    { id: "snatch-cures-only-snatcher", setupSlot: 1, snatched: true, userStatusBefore: 5, defenderStatusBefore: 5,
      expectedUserStages: Array(7).fill(6), expectedDefenderStages: [6, 6, 7, 7, 6, 6, 6], takeHeartSuccess: true },
    { id: "snatch-capped-snatcher-cure-only", setupSlot: 1, snatched: true, userStatusBefore: 5, defenderStatusBefore: 5,
      defenderStages: [6, 6, 12, 12, 6, 6, 6], expectedUserStages: Array(7).fill(6), expectedDefenderStages: [6, 6, 12, 12, 6, 6, 6], takeHeartSuccess: true },
  ] },
] : hydroSteam ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "clear", expectedWeather: 0, expectedDamageWeather: 0, weatherRatio: 4096, expectedPowers: [80], damageRatios: [4096] },
    { id: "sun-native-weather-stage", setupSlot: 2, expectedWeather: 1, expectedDamageWeather: 2, weatherRatio: 6144, expectedPowers: [80], damageRatios: [4096] },
    { id: "rain-retains-native-boost", setupSlot: 1, expectedWeather: 2, expectedDamageWeather: 2, weatherRatio: 6144, expectedPowers: [80], damageRatios: [4096] },
  ] },
  { name: "rounding", trainerId: 2, abilityId: 50, trainerMove: 150, defenderLevel: 51, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "sun-rounding-different-defense", setupSlot: 2, expectedWeather: 1, expectedDamageWeather: 2, weatherRatio: 6144, expectedPowers: [80], damageRatios: [4096] },
  ] },
  ...[{ name: "cloud-nine", ability: 13 }, { name: "air-lock", ability: 76 }].map(({ name, ability }, index) => ({
    name, trainerId: 3 + index, abilityId: ability, abilitySlot: (index ? 1 : 2) as 1 | 2,
    defenderSpecies: index ? 151 : 143, defenderLevel: index ? 75 : 50,
    trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
      { id: "suppressed-sun-no-boost", setupSlot: 2, expectedWeather: 0, expectedDamageWeather: 0, weatherRatio: 4096, expectedPowers: [80], damageRatios: [4096] },
    ],
  })),
  { name: "drought", trainerId: 5, abilityId: 70, defenderSpecies: 289, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "ability-sun-boost", expectedWeather: 1, expectedDamageWeather: 2, weatherRatio: 6144, expectedPowers: [80], damageRatios: [4096] },
  ] },
  { name: "normalize", trainerId: 6, abilityId: 50, trainerMove: 150, playerAbilityId: 96, save: "battle-normalize.sav", cases: [
    { id: "non-water-type-no-weather-exception", setupSlot: 2, expectedMoveType: 0, expectedWeather: 1, expectedDamageWeather: 1, weatherRatio: 4096, expectedPowers: [80], damageRatios: [4096] },
  ] },
  { name: "protean", trainerId: 7, abilityId: 50, trainerMove: 150, playerAbilityId: 168, save: "battle-protean.sav", cases: [
    { id: "weather-before-stab-rounding", setupSlot: 2, expectedWeather: 1, expectedDamageWeather: 2, weatherRatio: 6144, expectedPowers: [80], damageRatios: [4096] },
  ] },
] : supercellSlam ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle.sav", cases: [
    { id: "not-minimized-normal-accuracy", accuracyRoll: 94, expectedAccuracyRolls: 1, expectedAccuracy: 95, expectedPowers: [100], damageRatios: [4096], expectedMinimized: false },
  ] },
  { name: "minimize", trainerId: 2, abilityId: 50, trainerMove: 107, defenderSpecies: 151, defenderLevel: 75, playerAbilityId: 28, save: "battle.sav", cases: [
    { id: "minimized-guaranteed-hit-and-double", accuracyRoll: 99, expectedAccuracyRolls: 0, expectedPowers: [100], damageRatios: [8192], expectedMinimized: true },
    { id: "minimized-ignores-user-accuracy-stage", accuracyRoll: 99, accuracyStage: 0, expectedAccuracyRolls: 0, expectedPowers: [100], damageRatios: [8192], expectedMinimized: true },
  ] },
] : storm ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle.sav", cases: [
    { id: "clear-hit-79", accuracyRoll: 79, expectedWeather: 0, expectedAccuracyRolls: 1, expectedAccuracy: 80, expectedPowers: [100], damageRatios: [4096] },
    { id: "clear-miss-80", accuracyRoll: 80, expectedWeather: 0, expectedAccuracyRolls: 1, expectedAccuracy: 80, blocked: true },
    { id: "rain-guaranteed-99", setupSlot: 1, accuracyRoll: 99, expectedWeather: 2, expectedAccuracyRolls: 0, expectedPowers: [100], damageRatios: [4096] },
    { id: "rain-ignores-accuracy-evasion", setupSlot: 1, accuracyRoll: 99, accuracyStage: 0, evasionStage: 12, expectedWeather: 2, expectedAccuracyRolls: 0, expectedPowers: [100], damageRatios: [4096] },
    { id: "sun-still-hit-79", setupSlot: 2, accuracyRoll: 79, expectedWeather: 1, expectedAccuracyRolls: 1, expectedAccuracy: 80, expectedPowers: [100], damageRatios: [4096] },
    { id: "sun-still-miss-80", setupSlot: 2, accuracyRoll: 80, expectedWeather: 1, expectedAccuracyRolls: 1, expectedAccuracy: 80, blocked: true },
  ] },
  { name: "cloud-nine", trainerId: 2, abilityId: 13, abilitySlot: 2, trainerMove: 150, playerAbilityId: 28, save: "battle.sav", cases: [
    { id: "suppressed-rain-not-guaranteed", setupSlot: 1, accuracyRoll: 80, expectedWeather: 0, expectedAccuracyRolls: 1, expectedAccuracy: 80, blocked: true },
  ] },
  { name: "fly", trainerId: 3, abilityId: 50, trainerMove: 19, defenderSpecies: 151, defenderLevel: 75, playerAbilityId: 28, save: "battle.sav", cases: [
    { id: "rain-does-not-hit-fly", setupSlots: [1, 3], accuracyRoll: 99, expectedWeather: 2, expectedAccuracyRolls: 0, expectedFly: true, blocked: true },
  ] },
  { name: "protect", trainerId: 4, abilityId: 2, trainerMove: 182, defenderSpecies: 289, playerAbilityId: 28, save: "battle.sav", cases: [
    { id: "rain-does-not-bypass-protect", accuracyRoll: 99, expectedWeather: 2, expectedAccuracyRolls: 0, blocked: true },
  ] },
] : direClaw ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    ...Array.from({ length: 100 }, (_, draw) => ({ id: `activation-${draw}`, secondaryRoll: draw, statusChoice: draw % 3,
      expectedPowers: [80], statusAfter: draw < 50 ? [5, 1, 2][draw % 3] : 0,
      chanceRolls: 1, choiceRolls: draw < 50 ? 1 : 0, sleepDurationRolls: draw < 50 && draw % 3 === 2 ? 1 : 0 })),
    ...[0, 1, 2].map(choice => ({ id: `already-poisoned-choice-${choice}`, setupSlot: 1, expectedStatus: 5,
      secondaryRoll: 0, statusChoice: choice, expectedPowers: [80], statusAfter: 5,
      chanceRolls: 1, choiceRolls: 1, sleepDurationRolls: choice === 2 ? 1 : 0 })),
    { id: "target-ko-no-status-roll", currentHp: 1, expectedPowers: [80], allowFaint: true, statusAfter: 0, chanceRolls: 0, choiceRolls: 0 },
  ] },
  { name: "serene-grace", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 32, save: "battle-serenegrace.sav", cases:
    [0, 1, 2].map(choice => ({ id: `serene-grace-choice-${choice}`, secondaryRoll: 99, statusChoice: choice, expectedPowers: [80],
      statusAfter: [5, 1, 2][choice], chanceRolls: 0, choiceRolls: 1, sleepDurationRolls: choice === 2 ? 1 : 0 })) },
  { name: "sheer-force", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 125, save: "battle-sheerforce.sav", cases: [
    { id: "sheer-force-boost-without-status", secondaryRoll: 0, expectedPowers: [80], effectivePowers: [104], statusAfter: 0, chanceRolls: 0, choiceRolls: 0 },
  ] },
  { name: "parental-bond", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 185, save: "battle-parentalbond.sav", cases: [
    { id: "two-hits-two-chance-rolls", secondaryRoll: 0, statusChoice: 0, expectedPowers: [80, 80], effectivePowers: [80, 40], ppSpent: 1,
      statusAfter: 5, chanceRolls: 2, choiceRolls: 2 },
  ] },
  { name: "poison-immune", trainerId: 2, abilityId: 50, trainerMove: 150, defenderSpecies: 94, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "poison-type-no-reroll", secondaryRoll: 0, statusChoice: 0, expectedPowers: [80], typeRatio: 1024, statusAfter: 0, chanceRolls: 1, choiceRolls: 1 },
  ] },
  { name: "paralysis-immune", trainerId: 3, abilityId: 50, trainerMove: 150, defenderSpecies: 26, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "electric-type-no-reroll", secondaryRoll: 0, statusChoice: 1, expectedPowers: [80], statusAfter: 0, chanceRolls: 1, choiceRolls: 1 },
  ] },
  { name: "sleep-immune", trainerId: 4, abilityId: 15, abilitySlot: 2, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "insomnia-no-reroll", secondaryRoll: 0, statusChoice: 2, expectedPowers: [80], statusAfter: 0, chanceRolls: 1, choiceRolls: 1, sleepDurationRolls: 1 },
  ] },
  { name: "shield-dust", trainerId: 5, abilityId: 19, trainerMove: 150, defenderSpecies: 151, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "shield-dust-no-status-roll", secondaryRoll: 0, expectedPowers: [80], statusAfter: 0, chanceRolls: 0, choiceRolls: 0 },
  ] },
  { name: "protect", trainerId: 6, abilityId: 50, trainerMove: 182, defenderSpecies: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protect-no-status-roll", blocked: true, statusAfter: 0, chanceRolls: 0, choiceRolls: 0 },
  ] },
  { name: "substitute", trainerId: 7, abilityId: 50, trainerMove: 164, defenderSpecies: 291, defenderLevel: 100, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "substitute-no-status-roll", substitute: true, expectedPowers: [80], statusAfter: 0, chanceRolls: 0, choiceRolls: 0 },
  ] },
  { name: "safeguard", trainerId: 8, abilityId: 50, trainerMove: 219, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "native-safeguard-rejects-status", setupSlot: 3, secondaryRoll: 0, statusChoice: 0, expectedPowers: [80], statusAfter: 0, chanceRolls: 1, choiceRolls: 1 },
  ] },
] : barb ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "healthy-no-boost", expectedPowers: [60], secondaryRoll: 99, expectPoison: false },
    { id: "regular-poison-double", setupSlot: 3, expectedStatus: 5, expectedPowers: [120] },
    { id: "toxic-double", setupSlot: 2, expectedStatus: 5, expectedPowers: [120] },
    { id: "burn-no-boost", setupSlot: 1, expectedStatus: 4, expectedPowers: [60] },
    { id: "poison-roll-49", expectedPowers: [60], secondaryRoll: 49, expectPoison: true },
    { id: "no-poison-roll-50", expectedPowers: [60], secondaryRoll: 50, expectPoison: false },
  ] },
  { name: "sleep", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-sleep.sav", cases: [
    { id: "sleep-no-boost", setupSlot: 1, expectedStatus: 2, expectedPowers: [60] },
  ] },
  { name: "sheer-force", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 125, save: "battle-sheerforce.sav", cases: [
    { id: "sheer-force", expectedPowers: [60], effectivePowers: [78], secondaryRoll: 0, expectPoison: false },
  ] },
  { name: "immune", trainerId: 2, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 379, cases: [
    { id: "steel-immunity", blocked: true },
  ] },
] : hardPress ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "full-hp", expectedPowers: [100] },
    { id: "half-round-up-input", currentHp: 118, expectedPowers: [50] },
    { id: "half-round-down-input", currentHp: 117, expectedPowers: [49] },
    { id: "integer-floor", currentHp: 101, expectedPowers: [42] },
    { id: "low-hp-minimum", currentHp: 2, expectedPowers: [1] },
    { id: "one-hp-minimum", currentHp: 1, expectedPowers: [1], allowFaint: true },
  ] },
  { name: "substitute", trainerId: 2, abilityId: 50, trainerMove: 164, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 291, cases: [
    { id: "execution-hp-after-substitute", powerRule: "target-hp", substitute: true },
  ] },
] : gravApple ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-gravity", expectedPowers: [80], expectedDefenseStage: 5 },
    { id: "gravity-boost", setupSlot: 1, expectedPowers: [120], expectedDefenseStage: 5 },
  ] },
  { name: "clear-body", trainerId: 2, abilityId: 29, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "clear-body-gravity", setupSlot: 1, expectedPowers: [120], expectedDefenseStage: 6 },
  ] },
  { name: "sheer-force", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 125, save: "battle-sheerforce.sav", cases: [
    { id: "sheer-force-no-gravity", expectedPowers: [80], effectivePowers: [104], expectedDefenseStage: 6 },
    { id: "sheer-force-gravity", setupSlot: 1, expectedPowers: [120], effectivePowers: [156], expectedDefenseStage: 6 },
  ] },
] : tripleAxel ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "three-increasing-strikes", accuracyDraws: [89, 89, 89, 99], expectedPowers: [20, 40, 60] },
    { id: "first-strike-miss", accuracyDraws: [90], blocked: true },
    { id: "second-strike-miss-stops-sequence", accuracyDraws: [89, 90], expectedPowers: [20] },
    { id: "third-strike-miss-stops-sequence", accuracyDraws: [89, 89, 90], expectedPowers: [20, 40] },
    { id: "first-strike-ko-stops-sequence", accuracyDraws: [0], currentHp: 1, allowFaint: true, expectedPowers: [20] },
    { id: "next-action-resets-power", accuracyDraws: [0, 90], expectedPowers: [20], followup: {
      slot: 0, moveId: 813, power: 20, category: 1, type: 14,
      case: { id: "reset-counter", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60] },
    } },
  ] },
  { name: "skill-link", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 92, save: "battle-skilllink.sav", cases: [
    { id: "skill-link-one-accuracy-check", accuracyDraws: [89], expectedPowers: [20, 40, 60] },
    { id: "skill-link-can-miss-first-check", accuracyDraws: [90], blocked: true },
  ] },
  { name: "technician", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 101, save: "battle-technician.sav", cases: [
    { id: "technician-boosts-each-strike", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], effectivePowers: [30, 60, 90] },
  ] },
  { name: "parental-bond", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 185, save: "battle-parentalbond.sav", cases: [
    { id: "parental-bond-does-not-add-strike", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60] },
  ] },
  { name: "protect", trainerId: 2, abilityId: 50, trainerMove: 182, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "protect-stops-all-strikes", accuracyDraws: [], blocked: true },
  ] },
  { name: "wonder-guard", trainerId: 3, abilityId: 25, trainerMove: 150, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "ability-immunity-stops-all-strikes", accuracyDraws: [], blocked: true },
  ] },
  { name: "substitute", trainerId: 4, abilityId: 50, trainerMove: 164, defenderSpecies: 289, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "substitute-absorbs-no-spillover", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], substitute: true },
  ] },
  { name: "substitute-break", trainerId: 9, abilityId: 50, trainerMove: 164, defenderSpecies: 291, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "substitute-break-then-real-damage", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], substitute: true, typeRatio: 8192 },
  ] },
  { name: "helmet", trainerId: 5, abilityId: 50, trainerMove: 150, defenderItemId: 540, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "helmet-punishes-every-contact", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], contactCostDivisor: 6 },
  ] },
  { name: "rough-skin", trainerId: 6, abilityId: 24, trainerMove: 150, defenderSpecies: 531, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "rough-skin-punishes-every-contact", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], contactCostDivisor: 8 },
    { id: "contact-ko-stops-remaining-strikes", accuracyDraws: [0], userCurrentHp: 1, expectedPowers: [20], contactCostDivisor: 8 },
  ] },
  { name: "disguise", trainerId: 7, abilityId: 209, trainerMove: 150, defenderSpecies: 778, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "disguise-absorbs-only-first-strike", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], expectedDisguise: true },
    { id: "miss-does-not-bust-disguise", accuracyDraws: [90], blocked: true, expectedDefenderForm: 0 },
  ] },
  { name: "disguise-fixed", trainerId: 7, abilityId: 209, trainerMove: 150, defenderSpecies: 778, playerAbilityId: 50, save: "battle-disguise-fixed.sav", cases: [
    { id: "fixed-damage-busts-without-direct-hp-loss", setupSlot: 1, setupAccuracyRoll: 0, accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], disguiseSetupMove: 101, expectedDefenderForm: 1 },
  ] },
  { name: "disguise-single", trainerId: 7, abilityId: 209, trainerMove: 150, defenderSpecies: 778, playerAbilityId: 50, save: "battle-disguise-single.sav", cases: [
    { id: "ordinary-single-hit-busts-without-direct-hp-loss", setupSlot: 1, setupAccuracyRoll: 0, accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], disguiseSetupMove: 58, expectedDefenderForm: 1 },
  ] },
  { name: "disguise-substitute", trainerId: 10, abilityId: 209, trainerMove: 164, defenderSpecies: 778, defenderLevel: 100, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "substitute-protects-intact-disguise", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], substitute: true, expectedDefenderForm: 0 },
  ] },
  { name: "disguise-mold-breaker", trainerId: 7, abilityId: 209, trainerMove: 150, defenderSpecies: 778, playerAbilityId: 104, save: "battle-moldbreaker.sav", cases: [
    { id: "mold-breaker-ignores-without-busting", accuracyDraws: [0, 0, 0, 0], expectedPowers: [20, 40, 60], expectedDefenderForm: 0 },
  ] },
  { name: "instruct", trainerId: 8, abilityId: 50, trainerMove: 689, playerAbilityId: 50, save: "battle.sav", cases: [
    { id: "instruct-resets-per-action-counter", accuracyDraws: [0, 90, 0, 90], expectedPowers: [20, 20], ppSpent: 2, completeTurn: true },
  ] },
] : scaleShot ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    ...[0, 35, 70, 85].map((draw, index) => ({ id: `native-${index + 2}-hits`, secondaryRoll: draw, accuracyRoll: 0,
      expectedPowers: Array(index + 2).fill(25), damageRatios: Array(index + 2).fill(4096), ppSpent: 1,
      expectedUserStages: [6, 5, 6, 6, 7, 6, 6] })),
    { id: "speed-cap-still-lowers-defense", secondaryRoll: 0, accuracyRoll: 0, expectedPowers: [25, 25], ppSpent: 1, userStages: [6, 6, 6, 6, 12, 6, 6], expectedUserStages: [6, 5, 6, 6, 12, 6, 6] },
    { id: "defense-floor-still-raises-speed", secondaryRoll: 0, accuracyRoll: 0, expectedPowers: [25, 25], ppSpent: 1, userStages: [6, 0, 6, 6, 6, 6, 6], expectedUserStages: [6, 0, 6, 6, 7, 6, 6] },
    { id: "both-limits", secondaryRoll: 0, accuracyRoll: 0, expectedPowers: [25, 25], ppSpent: 1, userStages: [6, 0, 6, 6, 12, 6, 6], expectedUserStages: [6, 0, 6, 6, 12, 6, 6] },
    { id: "early-ko-on-first-strike", secondaryRoll: 85, accuracyRoll: 0, currentHp: 1, expectedPowers: [25], ppSpent: 1, allowFaint: true, expectedUserStages: [6, 5, 6, 6, 7, 6, 6] },
  ] },
  { name: "skill-link", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 92, save: "battle-skilllink.sav", cases: [
    { id: "skill-link-low-draw-five-hits", secondaryRoll: 0, accuracyRoll: 0, expectedPowers: Array(5).fill(25), ppSpent: 1, expectedUserStages: [6, 5, 6, 6, 7, 6, 6] },
  ] },
  { name: "simple", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 86, save: "battle-simple.sav", cases: [
    { id: "simple-doubles-once", secondaryRoll: 35, accuracyRoll: 0, expectedPowers: Array(3).fill(25), ppSpent: 1, expectedUserStages: [6, 4, 6, 6, 8, 6, 6] },
  ] },
  { name: "contrary", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 126, save: "battle-contrary.sav", cases: [
    { id: "contrary-reverses-once", secondaryRoll: 70, accuracyRoll: 0, expectedPowers: Array(4).fill(25), ppSpent: 1, expectedUserStages: [6, 7, 6, 6, 5, 6, 6] },
  ] },
  { name: "sheer-force", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 125, save: "battle-sheerforce.sav", cases: [
    { id: "sheer-force-keeps-power-and-stats", secondaryRoll: 85, accuracyRoll: 0, expectedPowers: Array(5).fill(25), ppSpent: 1, expectedUserStages: [6, 5, 6, 6, 7, 6, 6] },
  ] },
  { name: "protect", trainerId: 2, abilityId: 50, trainerMove: 182, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protect-no-self-changes", blocked: true, ppSpent: 1, expectedUserStages: Array(7).fill(6) },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", cases: [
    { id: "miss-no-self-changes", accuracyRoll: 99, secondaryRoll: 85, forceMiss: true, blocked: true, ppSpent: 1, expectedUserStages: Array(7).fill(6) },
  ] },
  { name: "immune", trainerId: 3, abilityId: 25, abilitySlot: 2, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "wonder-guard-no-self-changes", blocked: true, ppSpent: 1, expectedUserStages: Array(7).fill(6) },
  ] },
  { name: "fairy", trainerId: 4, abilityId: 50, trainerMove: 150, defenderSpecies: 35, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "fairy-immunity-no-self-changes", blocked: true, ppSpent: 1, expectedUserStages: Array(7).fill(6) },
  ] },
  { name: "substitute", trainerId: 5, abilityId: 50, trainerMove: 164, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "substitute-break-then-real-hits", secondaryRoll: 85, accuracyRoll: 0, expectedPowers: Array(5).fill(25), ppSpent: 1, substitute: true, expectedUserStages: [6, 5, 6, 6, 7, 6, 6] },
  ] },
] : hazards ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "hit-adds-native-hazard", expectedPowers: [65], expectedHazards: 1, hazardsBefore: 0 },
    ...(spikes ? [1, 2, 3].map(layers => ({ id: `native-${layers}-layers-before-hit`, setupSlots: Array(layers).fill(1),
      expectedPowers: [65], hazardsBefore: layers, expectedHazards: Math.min(3, layers + 1) })) : [
      { id: "existing-rocks-still-deals-damage", setupSlot: 2, expectedPowers: [65], hazardsBefore: 1, expectedHazards: 1 },
    ]),
    { id: "target-ko-still-adds", currentHp: 1, allowFaint: true, expectedPowers: [65], expectedHazards: 1, hazardsBefore: 0 },
  ] },
  { name: "substitute", trainerId: 2, abilityId: 50, trainerMove: 164, defenderSpecies: 291, defenderLevel: 100, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "substitute-hit-adds-hazard", expectedPowers: [65], substitute: true, typeRatio: spikes ? 4096 : 16384, expectedHazards: 1, hazardsBefore: 0 },
  ] },
  { name: "sheer-force", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 125, save: "battle-sheerforce.sav", cases: [
    { id: "sheer-force-boosts-without-hazard", accuracyRoll: 0, expectedPowers: [65], effectivePowers: [85], expectedHazards: 0, hazardsBefore: 0 },
  ] },
  { name: "parental-bond", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 185, save: "battle-parentalbond.sav", cases: [
    { id: "one-hazard-per-real-strike", accuracyRoll: 0, expectedPowers: [65, 65], effectivePowers: [65, 32], ppSpent: 1, expectedHazards: spikes ? 2 : 1, hazardsBefore: 0 },
  ] },
  { name: "protect", trainerId: 3, abilityId: 50, trainerMove: 182, defenderSpecies: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protect-adds-no-hazard", blocked: true, expectedHazards: 0, hazardsBefore: 0 },
  ] },
  { name: "immune", trainerId: 4, abilityId: 25, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "wonder-guard-adds-no-hazard", blocked: true, expectedHazards: 0, hazardsBefore: 0 },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", cases: [
    { id: "accuracy-miss-adds-no-hazard", accuracyRoll: 99, forceMiss: true, blocked: true, expectedHazards: 0, hazardsBefore: 0 },
  ] },
  { name: "shield-dust", trainerId: 5, abilityId: 19, trainerMove: 150, defenderSpecies: 151, defenderLevel: 100, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "shield-dust-does-not-block-side-hazard", expectedPowers: [65], typeRatio: spikes ? 8192 : 4096, expectedHazards: 1, hazardsBefore: 0 },
  ] },
  { name: "instruct", trainerId: 6, abilityId: 50, trainerMove: 689, defenderSpecies: 765, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "instruct-new-execution-adds-again", expectedPowers: [65, 65], ppSpent: 2, completeTurn: true,
      typeRatio: spikes ? 8192 : 4096, expectedHazards: spikes ? 2 : 1, hazardsBefore: 0 },
  ] },
  { name: "rough-skin", trainerId: 7, abilityId: 24, trainerMove: 150, defenderSpecies: 232, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "contact-ko-prevents-hazard", expectedPowers: [65], typeRatio: spikes ? 4096 : 2048, userCurrentHp: 1, userFaints: true, expectedHazards: 0, hazardsBefore: 0 },
  ] },
] : iceSpinner ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-terrain-still-hits", expectedPowers: [80], terrainEndMessages: 0 },
    { id: "electric-cleared", setupSlot: 1, expectedPowers: [80], terrainEndMessages: 1,
      followup: { slot: 2, moveId: 875, power: 80, category: 1, type: 13, case: { id: "psyblade-after-clear", expectedPowers: [80] } } },
    { id: "target-ko-clears", setupSlot: 1, currentHp: 1, allowFaint: true, expectedPowers: [80], terrainEndMessages: 1 },
  ] },
  ...["grassy", "misty", "psychic"].map(name => ({ name, trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99,
    save: `battle-${name}.sav`, cases: [{ id: `${name}-cleared`, setupSlot: 1, expectedPowers: [80], terrainEndMessages: 1 }] })),
  { name: "airborne", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-airborne.sav", cases: [
    { id: "airborne-still-clears", setupSlot: 1, expectedPowers: [80], terrainEndMessages: 1 },
  ] },
  { name: "protect", trainerId: 2, abilityId: 226, defenderSpecies: 289, trainerMove: 182, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protected-terrain-retained", blocked: true, terrainEndMessages: 0 },
  ] },
  { name: "immune", trainerId: 3, abilityId: 25, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "immune-terrain-retained", setupSlot: 1, blocked: true, terrainEndMessages: 0 },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", cases: [
    { id: "miss-terrain-retained", setupSlot: 1, accuracyStage: 0, evasionStage: 12, accuracyRoll: 99, forceMiss: true, blocked: true, terrainEndMessages: 0 },
  ] },
  { name: "substitute", trainerId: 4, abilityId: 226, trainerMove: 164, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "substitute-clears", expectedPowers: [80], substitute: true, typeRatio: 8192, terrainEndMessages: 1 },
  ] },
  { name: "rough-skin", trainerId: 5, abilityId: 24, defenderSpecies: 531, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "contact-ko-retains-terrain", setupSlot: 1, userCurrentHp: 1, userFaints: true, expectedPowers: [80], terrainEndMessages: 0 },
  ] },
  { name: "helmet", trainerId: 6, abilityId: 50, trainerMove: 150, defenderItemId: 540, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "helmet-ko-retains-terrain", setupSlot: 1, userCurrentHp: 1, userFaints: true, expectedPowers: [80], terrainEndMessages: 0 },
  ] },
  { name: "redcard", trainerId: 7, abilityId: 50, trainerMove: 150, defenderItemId: 542, playerAbilityId: 99, save: "battle-redcard.sav", cases: [
    { id: "redcard-retains-terrain", setupSlot: 1, expectedPowers: [80], terrainEndMessages: 0 },
  ] },
  { name: "lifeorb", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-lifeorb.sav", cases: [
    { id: "lifeorb-ko-retains-terrain", setupSlot: 1, userCurrentHp: 1, userFaints: true, expectedPowers: [80], damageRatios: [5324], terrainEndMessages: 0 },
  ] },
] : steelRoller ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-terrain-fails", blocked: true, terrainEndMessages: 0 },
    { id: "electric-terrain-cleared-before-psyblade", setupSlot: 1, expectedPowers: [130], terrainEndMessages: 1,
      followup: { slot: 2, moveId: 875, power: 80, category: 1, type: 13, case: { id: "psyblade-no-terrain-bonus", expectedPowers: [80] } } },
    { id: "second-steel-roller-fails", setupSlot: 1, expectedPowers: [130], terrainEndMessages: 1,
      followup: { slot: 0, moveId, power: 130, category: 1, type: 8, case: { id: "no-terrain-after-first-hit", blocked: true, terrainEndMessages: 0 } } },
    { id: "defog-removal-before-execution", setupSlots: [1, 3], blocked: true, terrainEndMessages: 0 },
    { id: "target-ko-still-clears", setupSlot: 1, currentHp: 1, allowFaint: true, expectedPowers: [130], terrainEndMessages: 1 },
  ] },
  ...["grassy", "misty", "psychic"].map(name => ({ name, trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99,
    save: `battle-${name}.sav`, cases: [{ id: `${name}-terrain-cleared`, setupSlot: 1, expectedPowers: [130], terrainEndMessages: 1,
      followup: { slot: 0, moveId, power: 130, category: 1, type: 8, case: { id: "cleared-terrain-fails", blocked: true, terrainEndMessages: 0 } } }] })),
  { name: "replacement", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-replace.sav", cases: [
    { id: "replacement-terrain-cleared", setupSlots: [1, 2], expectedPowers: [130], terrainEndMessages: 1,
      followup: { slot: 0, moveId, power: 130, category: 1, type: 8, case: { id: "replacement-cleared", blocked: true, terrainEndMessages: 0 } } },
  ] },
  { name: "airborne-user", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-airborne.sav", cases: [
    { id: "airborne-user-still-clears", setupSlot: 1, expectedPowers: [130], terrainEndMessages: 1, executionItems: { attacker: 541 } },
  ] },
  { name: "protect", trainerId: 2, abilityId: 226, trainerMove: 182, defenderSpecies: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protect-does-not-clear", blocked: true, terrainEndMessages: 0 },
  ] },
  { name: "immune", trainerId: 3, abilityId: 25, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "wonder-guard-does-not-clear", setupSlot: 1, blocked: true, terrainEndMessages: 0 },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", cases: [
    { id: "miss-does-not-clear", setupSlot: 1, accuracyStage: 0, evasionStage: 12, accuracyRoll: 99, forceMiss: true, blocked: true, terrainEndMessages: 0,
      followup: { slot: 0, moveId, power: 130, category: 1, type: 8, case: { id: "terrain-retained-after-miss", accuracyRoll: 0, expectedPowers: [130], terrainEndMessages: 1 } } },
  ] },
  { name: "substitute", trainerId: 4, abilityId: 226, trainerMove: 164, defenderSpecies: 291, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "substitute-hit-clears", expectedPowers: [130], substitute: true, terrainEndMessages: 1 },
  ] },
] : risingVoltage ? [
  { name: "grounded", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-terrain", expectedPowers: [70], damageRatios: [4096] },
    { id: "electric-grounded-target", setupSlot: 1, expectedPowers: [140], effectivePowers: [182], damageRatios: [4096], expectedFloating: { attacker: false, defender: false } },
    { id: "grassy-no-electric-bonus", setupSlot: 3, expectedPowers: [70], damageRatios: [4096] },
  ] },
  { name: "removed", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-defog.sav", cases: [
    { id: "native-defog-removes-bonus", setupSlots: [1, 2], expectedPowers: [70], damageRatios: [4096] },
  ] },
  { name: "airborne-user", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-airborne.sav", cases: [
    { id: "airborne-user-no-terrain", expectedPowers: [70], damageRatios: [4096], executionItems: { attacker: 541 } },
    { id: "airborne-user-grounded-target", setupSlot: 1, expectedPowers: [140], damageRatios: [4096], expectedFloating: { attacker: true, defender: false }, executionItems: { attacker: 541 } },
  ] },
  { name: "airborne-target", trainerId: 2, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderItemId: 541, cases: [
    { id: "target-air-balloon-no-double", setupSlot: 1, expectedPowers: [70], effectivePowers: [91], damageRatios: [4096], expectedFloating: { attacker: false, defender: true }, executionItems: { defender: 541 } },
    { id: "gravity-grounds-target-balloon", setupSlots: [1, 2], expectedPowers: [140], effectivePowers: [182], damageRatios: [4096], expectedFloating: { attacker: false, defender: false }, executionItems: { defender: 541 } },
  ] },
  { name: "both-airborne", trainerId: 2, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-airborne.sav", defenderItemId: 541, cases: [
    { id: "both-airborne-no-bonus", setupSlot: 1, expectedPowers: [70], damageRatios: [4096], expectedFloating: { attacker: true, defender: true }, executionItems: { attacker: 541, defender: 541 } },
  ] },
  { name: "levitate", trainerId: 3, abilityId: 26, abilitySlot: 2, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "levitate-no-double", setupSlot: 1, expectedPowers: [70], effectivePowers: [91], damageRatios: [4096], expectedFloating: { attacker: false, defender: true } },
    { id: "gravity-grounds-levitate", setupSlots: [1, 2], expectedPowers: [140], effectivePowers: [182], damageRatios: [4096], expectedFloating: { attacker: false, defender: false } },
  ] },
  { name: "protect", trainerId: 4, abilityId: 226, trainerMove: 182, defenderSpecies: 289, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "electric-terrain-protect", blocked: true },
  ] },
  { name: "immune", trainerId: 5, abilityId: 50, trainerMove: 150, defenderSpecies: 232, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "electric-terrain-ground-immunity", setupSlot: 1, blocked: true },
  ] },
  { name: "substitute", trainerId: 6, abilityId: 226, trainerMove: 164, defenderSpecies: 151, defenderLevel: 75, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "grounded-substitute-still-double", expectedPowers: [140], effectivePowers: [182], damageRatios: [4096], substitute: true, expectedFloating: { attacker: false, defender: false } },
  ] },
] : psyblade ? [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "no-terrain", expectedPowers: [80] },
    { id: "electric-terrain", setupSlot: 1, expectedPowers: [120] },
    { id: "terrain-removed", setupSlots: [1, 2], expectedPowers: [80] },
  ] },
  { name: "airborne", trainerId: 2, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-airborne.sav", defenderItemId: 541, cases: [
    { id: "both-airborne-electric-terrain", setupSlot: 1, expectedPowers: [120], expectedAirborne: true },
  ] },
] : grassyGlide ? [
  { name: "grounded", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 291, cases: [
    { id: "no-terrain-slower", expectedPowers: [55], expectedActed: [true], typeRatio: 1024, damageRatios: [4096] },
    { id: "grassy-terrain-acts-first", setupSlot: 1, expectedPowers: [55], effectivePowers: [71], expectedActed: [false], typeRatio: 1024, damageRatios: [4096] },
    { id: "terrain-removed-priority-zero", setupSlots: [1, 2], expectedPowers: [55], expectedActed: [true], typeRatio: 1024, damageRatios: [4096] },
    { id: "psychic-terrain-priority-zero", setupSlot: 3, expectedPowers: [55], expectedActed: [true], typeRatio: 1024, damageRatios: [4096] },
  ] },
  { name: "airborne", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-airborne.sav", defenderSpecies: 291, cases: [
    { id: "air-balloon-no-priority", setupSlot: 1, expectedPowers: [55], expectedActed: [true], typeRatio: 1024, damageRatios: [4096], expectedUserItem: 541 },
  ] },
  { name: "gravity", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-gravity.sav", defenderSpecies: 291, cases: [
    { id: "gravity-grounds-air-balloon", setupSlots: [1, 2], expectedPowers: [55], effectivePowers: [71], expectedActed: [false], typeRatio: 1024, damageRatios: [4096], expectedUserItem: 541 },
  ] },
  { name: "queenly-majesty", trainerId: 2, abilityId: 214, abilitySlot: 2, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 291, cases: [
    { id: "queenly-zero-priority-allowed", expectedPowers: [55], expectedActed: [true], typeRatio: 1024, damageRatios: [4096] },
    { id: "queenly-grassy-priority-blocked", setupSlot: 1, blocked: true },
  ] },
  { name: "dazzling", trainerId: 3, abilityId: 219, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 254, cases: [
    { id: "dazzling-grassy-priority-blocked", setupSlot: 1, blocked: true },
  ] },
] : collision || electro ? [
  { name: "neutral", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: collision ? 232 : 143, cases: [
    { id: "neutral-no-bonus", expectedPowers: [100], typeRatio: 4096, damageRatios: [4096] },
  ] },
  { name: "resisted", trainerId: 2, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: collision ? 151 : 181, cases: [
    { id: "resisted-no-bonus", expectedPowers: [100], typeRatio: 2048, damageRatios: [4096] },
  ] },
  { name: "super", trainerId: 3, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: collision ? 143 : 80, cases: [
    { id: "super-effective-bonus", expectedPowers: [100], typeRatio: 8192, damageRatios: [5461] },
  ] },
  { name: "quad", trainerId: 4, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: collision ? 248 : 279, defenderLevel: 100, cases: [
    { id: "dual-type-super-effective-bonus", expectedPowers: [100], typeRatio: 16384, damageRatios: [5461] },
  ] },
  { name: "immune", trainerId: 5, abilityId: collision ? 25 : 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 232, cases: [
    { id: collision ? "wonder-guard-immunity" : "ground-immunity", blocked: true },
  ] },
  ...(electro ? [{ name: "triple-resist", trainerId: 6, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 644, cases: [
    { id: "added-grass-one-eighth-no-bonus", setupSlot: 1, expectedPowers: [100], typeRatio: 512, damageRatios: [4096] },
  ] }] : []),
] : poltergeist ? [
  { name: "held", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 151, defenderItemId: 223, cases: [
    { id: "held-item-hit", expectedPowers: [110], typeRatio: 8192, damageRatios: [4096], expectedItemBefore: 223, expectedItemAfter: 223, announcements: 1 },
    { id: "earlier-knock-off-fails", setupSlot: 1, blocked: true, expectedItemBefore: 0, expectedItemAfter: 0, announcements: 0 },
    { id: "embargo-still-held", setupSlot: 2, expectedPowers: [110], typeRatio: 8192, damageRatios: [4096], expectedItemBefore: 223, expectedItemAfter: 223, announcements: 1, expectedItemBlocked: true },
    { id: "magic-room-still-held", setupSlot: 3, expectedPowers: [110], typeRatio: 8192, damageRatios: [4096], expectedItemBefore: 223, expectedItemAfter: 223, announcements: 1, expectedMagicRoom: true },
  ] },
  { name: "no-item", trainerId: 2, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 151, cases: [
    { id: "no-item-no-guard-fails", blocked: true, expectedItemBefore: 0, expectedItemAfter: 0, announcements: 0 },
  ] },
  { name: "kasib", trainerId: 3, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 151, defenderItemId: 196, cases: [
    { id: "kasib-consumed-hit-remains", expectedPowers: [110], typeRatio: 8192, damageRatios: [2048], expectedItemBefore: 196, expectedItemAfter: 0, announcements: 1 },
  ] },
  { name: "weakness-policy", trainerId: 4, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 151, defenderItemId: 129, cases: [
    { id: "weakness-policy-boosts", expectedPowers: [110], typeRatio: 8192, damageRatios: [4096], expectedItemBefore: 129, expectedItemAfter: 0, announcements: 1, expectedBoosts: [8, 6, 8, 6, 6, 6, 6] },
  ] },
  { name: "red-card", trainerId: 5, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle-redcard.sav", defenderSpecies: 151, defenderItemId: 542, incomingAttackerSpecies: 149, cases: [
    { id: "red-card-hit-then-switch", expectedPowers: [110], typeRatio: 8192, damageRatios: [4096], expectedItemBefore: 542, expectedItemAfter: 0, announcements: 1, expectedIncomingAttacker: 149, completeTurn: true },
  ] },
  { name: "protect", trainerId: 6, abilityId: 50, trainerMove: 182, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 151, defenderItemId: 223, cases: [
    { id: "protect-no-announcement", blocked: true, expectedItemBefore: 223, expectedItemAfter: 223, announcements: 0 },
  ] },
  { name: "miss", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 28, save: "battle-miss.sav", defenderSpecies: 151, defenderItemId: 223, cases: [
    { id: "miss-no-announcement", blocked: true, forceMiss: true, secondaryRoll: 99, expectedItemBefore: 223, expectedItemAfter: 223, announcements: 0 },
  ] },
  { name: "immune", trainerId: 7, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 143, defenderItemId: 223, cases: [
    { id: "normal-immunity-no-announcement", blocked: true, expectedItemBefore: 223, expectedItemAfter: 223, announcements: 0 },
  ] },
  { name: "substitute", trainerId: 8, abilityId: 50, trainerMove: 164, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 291, defenderItemId: 223, cases: [
    { id: "substitute-announced-and-damaged", expectedPowers: [110], substitute: true, damageRatios: [4096], expectedItemBefore: 223, expectedItemAfter: 223, announcements: 1 },
  ] },
  { name: "parental-bond", trainerId: 3, abilityId: 50, trainerMove: 150, playerAbilityId: 185, save: "battle-parentalbond.sav", defenderSpecies: 151, defenderItemId: 196, cases: [
    { id: "berry-first-hit-does-not-cancel-second", secondaryRoll: 0, expectedPowers: [110, 110], effectivePowers: [110, 55], ppSpent: 1, typeRatio: 8192, damageRatios: [2048, 4096], expectedItemBefore: 196, expectedItemAfter: 0, announcements: 1 },
  ] },
  { name: "instruct", trainerId: 9, abilityId: 50, trainerMove: 689, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 302, defenderItemId: 223, cases: [
    { id: "new-action-announces-again", expectedPowers: [110, 110], damageRatios: [4096, 4096], expectedItemBefore: 223, expectedItemAfter: 223, announcements: 2, completeTurn: true },
  ] },
  { name: "instruct-consumed", trainerId: 10, abilityId: 50, trainerMove: 689, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 79, defenderItemId: 196, cases: [
    { id: "new-action-rechecks-consumed-item", expectedPowers: [110], ppSpent: 2, typeRatio: 8192, damageRatios: [2048], expectedItemBefore: 196, expectedItemAfter: 0, announcements: 1, completeTurn: true },
  ] },
] : fickle ? [
  { name: "draws", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases:
    Array.from({ length: 100 }, (_, draw) => ({ id: `draw-${draw}`, secondaryRoll: draw, expectedPowers: [draw < 30 ? 160 : 80], powerRolls: [1], damageRatios: [4096] })),
  },
  { name: "parental-bond", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 185, save: "battle-parentalbond.sav", cases: [
    { id: "two-hits-one-double-roll", secondaryRoll: 29, expectedPowers: [160, 160], effectivePowers: [160, 80], powerRolls: [1, 0], damageRatios: [4096, 4096], ppSpent: 1 },
    { id: "two-hits-one-normal-roll", secondaryRoll: 30, expectedPowers: [80, 80], effectivePowers: [80, 40], powerRolls: [1, 0], damageRatios: [4096, 4096], ppSpent: 1 },
  ] },
  { name: "instruct", trainerId: 2, abilityId: 50, trainerMove: 689, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 765, cases: [
    { id: "new-action-new-roll", secondaryRoll: 29, expectedPowers: [160, 160], powerRolls: [1, 1], damageRatios: [4096, 4096], completeTurn: true },
  ] },
  { name: "protect", trainerId: 3, abilityId: 50, trainerMove: 182, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "protected-no-power-calculation", blocked: true },
  ] },
] : [
  { name: "normal", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "unacted-target", expectedPowers: [170], expectedActed: [false] },
  ] },
  { name: "acted", trainerId: 2, abilityId: 50, trainerMove: 98, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "already-acted-target", expectedPowers: [85], expectedActed: [true] },
  ] },
  { name: "failed", trainerId: 3, abilityId: 50, trainerMove: 252, playerAbilityId: 99, save: "battle.sav", cases: [
    { id: "failed-action-counts", setupSlot: 1, expectedPowers: [85], expectedActed: [true] },
  ] },
  { name: "switch", trainerId: 4, abilityId: 50, trainerMove: 369, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 291, incomingSpecies: 143, bench: true, cases: [
    { id: "native-switch-in", expectedPowers: [170], expectedActed: [false] },
  ] },
  { name: "instruct", trainerId: 5, abilityId: 50, trainerMove: 689, playerAbilityId: 99, save: "battle.sav", defenderSpecies: 765, cases: [
    { id: "instruct-rechecks-action", expectedPowers: [170, 85], expectedActed: [false, true], completeTurn: true },
  ] },
  ...(moveName === "fishious-rend" ? [{ name: "strong-jaw", trainerId: 1, abilityId: 50, trainerMove: 150, playerAbilityId: 173, save: "battle-strongjaw.sav", cases: [
    { id: "strong-jaw", expectedPowers: [170], effectivePowers: [255], expectedActed: [false] },
  ] }] : []),
];
const authoredAbilitySlots = new Map<string, number>();
if (statHistory) for (const variant of variants) for (const test of variant.cases) {
  test.expectedPowers ??= [definition.power];
  test.damageRatios = [4096];
  test.typeRatio ??= jealousy ? 8192 : 4096;
}
if (bodyPress) for (const variant of variants) for (const test of variant.cases) {
  test.userStats = [15,60,30,60,50];
  test.expectedPowers = [80];
  test.damageRatios = [4096];
  test.typeRatio = 8192;
}
if (terrainPulse) for (const variant of variants) for (const test of variant.cases) {
  if (test.expectedPowers) test.damageRatios = [4096];
}
if (damageShield) for (const variant of variants) for (const test of variant.cases) test.completeTurn = true;
if (auraWheel) for (const variant of variants) {
  variant.playerSpecies ??= 877;
  variant.playerForm ??= 0;
  for (const test of variant.cases) if (test.expectedPowers) test.damageRatios = [4096];
}
if (hazards) for (const variant of variants) for (const test of variant.cases) {
  if (test.expectedPowers) test.damageRatios = test.expectedPowers.map(() => 4096);
}
if (tripleAxel || hpCost) for (const variant of variants) for (const test of variant.cases) {
  test.ppSpent ??= 1;
  if (hpCost) test.accuracyRoll ??= 0;
  if (test.expectedPowers) test.damageRatios = test.expectedPowers.map(() => 4096);
  if (test.followup) {
    test.followup.case.ppSpent = 1;
    if (hpCost) test.followup.case.accuracyRoll ??= 0;
    test.followup.case.damageRatios = test.followup.case.expectedPowers!.map(() => 4096);
  }
}
for (const variant of variants) {
  for (const [species, form, slot] of [[variant.defenderSpecies ?? 143, variant.defenderForm ?? 0, variant.abilitySlot ?? (variant.abilityId === 25 || variant.abilityId === 29 ? 2 : 1)],
    ...(variant.bench ? [[variant.incomingSpecies!, 0, 1]] : [])]) {
    const key = `${species}:${form}:${slot}`;
    const previous = authoredAbilitySlots.get(key);
    if (previous !== undefined && previous !== variant.abilityId) throw new Error(`Conflicting fixture Personal ability slot ${key}: ${previous} / ${variant.abilityId}`);
    authoredAbilitySlots.set(key, variant.abilityId);
  }
}
for (const variant of variants) patchHarnessTrainer(project, { trainerId: variant.trainerId, battleType: "Singles", trainer: {
  ai: 0, team: [
    { speciesId: variant.defenderSpecies ?? 143, form: variant.defenderForm ?? 0, level: variant.defenderLevel ?? 50, itemId: variant.defenderItemId ?? 0, moves: [variant.trainerMove], abilityId: variant.abilityId, abilitySlot: variant.abilitySlot ?? (variant.abilityId === 25 || variant.abilityId === 29 ? 2 : 1) },
    ...(variant.bench ? [{ speciesId: variant.incomingSpecies!, level: 50, itemId: 0, moves: [variant.benchMove ?? 150], abilityId: variant.abilityId, abilitySlot: 1 as const }] : []),
  ],
} });
patchHarnessExpandedPartyGuard(project, input.loadArm9Overlays([36]).get(36)!);
const template = new Uint8Array(await readFile(new URL("../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url)));
const receipt = JSON.parse(await readFile(new URL("../src/assets/testbattle/BattleHarnessW2.json", import.meta.url), "utf8"));
if (hash(template) !== receipt.dllSha256) throw new Error("Bundled harness receipt mismatch");
for (const [name, expected] of Object.entries(receipt.sources)) if (hash(new Uint8Array(await readFile(new URL(`../runtime/battle-harness/${name}`, import.meta.url)))) !== expected) throw new Error(`Stale harness source receipt: ${name}`);
await prepareBw2TestBattleCodeInjection(project);
const configured = configureHarnessRuntime(template, 1, 0);
stageCodeInjectionDll(project, "BattleHarnessW2.dll", configured);
let coreHash: string | undefined;
if (args.has("--core")) {
  const core = new Uint8Array(await readFile(resolve(args.get("--core")!)));
  coreHash = hash(core);
  stageCodeInjectionDll(project, "White2Upgrade.dll", core);
}
for (const [name, store] of Object.entries(project.narcs)) if (!["trdata", "trpok", "personal"].includes(name) || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const rom = await exportModifiedRom(project, { preserveOriginalLength: true });
await writeFile(resolve(directory, "battle.nds"), rom, { flag: "wx" });
const exported = new NintendoDSRom(rom, { fileData: "view" });
const harness = exported.getFileByName("patches/BattleHarnessW2.dll");
if (hash(harness) !== hash(configured)) throw new Error("Exported battle trigger differs from its configured bytes");
if (coreHash && hash(exported.getFileByName("patches/White2Upgrade.dll")) !== coreHash) throw new Error("Export did not include the requested core build");
const variantsWithPatches = variants.map(variant => {
  const alternative = configureHarnessRuntime(template, variant.trainerId, 0);
  const patches = [];
  for (let i = 0; i < configured.length; i++) if (configured[i] !== alternative[i]) patches.push({ offset: harness.byteOffset - rom.byteOffset + i, expected: configured[i], value: alternative[i] });
  return { ...variant, moveId, defenderSpecies: variant.defenderSpecies ?? 143, category: definition.category,
    power: definition.power, type: definition.type, controlledRng: !ruination, romPatches: patches };
});
const saves = [];
for (const { file } of saveDefinitions) saves.push({ file, sha256: hash(new Uint8Array(await readFile(resolve(directory, file)))) });
await writeFile(resolve(directory, "suite.json"), JSON.stringify({
  format: "pokeweb-focused-move-1", move: moveName, moveId, battleType: "Singles", battleAnimationsEnabled: false,
  inputRomSha256: hash(bytes), inputSaveSha256: hash(inputSave), coreSha256: coreHash,
  sideState: hazards || tidyUp ? { base: 0x0689e960, sideStride: 0xe0, effectStride: 16, countOffset: 12, effects: tidyUp ? [0,1,6,7,8] : [6,8] } : undefined,
  harnessSha256: receipt.dllSha256, harnessCpuChecks: receipt.verification.cpuChecks,
  rom: { file: "battle.nds", sha256: hash(rom) }, saves, probes, variants: variantsWithPatches,
}, null, 2) + "\n", { flag: "wx" });
console.log(`Prepared ${moveName}: one shared ROM, native trainer variants, animation-disabled saves`);
