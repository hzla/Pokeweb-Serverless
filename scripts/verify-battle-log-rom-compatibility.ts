import { readFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { detectBattleLogCompatibility } from "../src/pokeweb/battleLogModel";
import { parseRpm } from "../src/pokeweb/rpm";
import { readU16 } from "../src/nds/binary";
import type { ProjectState } from "../src/pokeweb/projectStore";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: npm run battlelog:verify-rom -- Black-or-White-Gen5.nds");

const bytes = new Uint8Array(await readFile(romPath));
const rom = new NintendoDSRom(bytes);
const versions = {
  IRBO: { baseVersion: "B", baseRom: "BW" },
  IRAO: { baseVersion: "W", baseRom: "BW" },
  IREO: { baseVersion: "B2", baseRom: "BW2" },
  IRDO: { baseVersion: "W2", baseRom: "BW2" },
} as const;
const version = versions[rom.idCode as keyof typeof versions];
if (!version) throw new Error(`Unsupported battle-log ROM code: ${rom.idCode}`);
const project = {
  originalRomBytes: bytes,
  session: { romName: rom.name, ...version, fairy: false, fileIds: {}, blacklist: [] },
  romInfo: { title: rom.name, idCode: rom.idCode, fileName: romPath, size: bytes.length },
  arm9: new Uint8Array(),
  overlays: {},
  narcs: {},
  texts: { banks: {} },
  formats: {},
  trpokInfo: [],
} as ProjectState;

const report = detectBattleLogCompatibility(project);
if (!report.compatible) {
  report.checks.filter((check) => !check.matched).forEach((check) => console.error(check.message));
  throw new Error(report.message);
}
console.log(report.message);

if (version.baseRom === "BW2") {
  const overlay = rom.loadArm9Overlays([167]).get(167)!;
  const delta = version.baseVersion === "W2" ? 0x40 : 0;
  const start = 0x021b7e18 + delta;
  const end = 0x021b8068 + delta; // Excludes the literal pool.
  const dllName = version.baseVersion === "W2" ? "White2UpgradeBattleCounters.dll" : "Black2UpgradeBattleCounters.dll";
  const dll = parseRpm(new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${dllName}`, import.meta.url))), { allowedMagics: ["DLXF"] });
  const hooks = dll.relocations.filter((relocation) => relocation.target.module === "167")
    .map((relocation) => ({ address: relocation.target.address & ~1, size: relocation.target.type === "THUMB_BRANCH_LINK" ? 4 : 8 }));
  let sharedTailBranches = 0;
  for (let address = start; address < end; address += 2) {
    const instruction = readU16(overlay.data, address - overlay.ramAddress);
    // Thumb-1 BL/BLX prefixes consume the following halfword.
    if ((instruction & 0xf800) === 0xf000) { address += 2; continue; }
    if (hooks.some((hook) => address >= hook.address && address < hook.address + hook.size)) continue;
    let displacement: number;
    if ((instruction & 0xf800) === 0xe000) {
      displacement = (instruction & 0x7ff) << 1;
      if (displacement & 0x800) displacement -= 0x1000;
    } else if ((instruction & 0xf000) === 0xd000 && (instruction & 0x0f00) < 0x0e00) {
      displacement = (instruction & 0xff) << 1;
      if (displacement & 0x100) displacement -= 0x200;
    } else continue;
    const target = address + 4 + displacement;
    if (target === 0x021b7ed0 + delta) sharedTailBranches += 1;
    if (hooks.some((hook) => target > hook.address && target < hook.address + hook.size)) {
      throw new Error(`EXP branch 0x${address.toString(16)} enters a hook mid-instruction at 0x${target.toString(16)}.`);
    }
  }
  if (sharedTailBranches === 0 || readU16(overlay.data, 0x021b7ed0 + delta - overlay.ramAddress) !== 0x6020) {
    throw new Error("Retail EXP shared state-assignment tail is not intact.");
  }
  console.log(`Verified EXP branch targets: ${sharedTailBranches} shared-tail callers remain intact; no branches enter the middle of a counter hook.`);
}
