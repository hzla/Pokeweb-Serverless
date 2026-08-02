import { readFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { detectBattleLogCompatibility } from "../src/pokeweb/battleLogModel";
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
