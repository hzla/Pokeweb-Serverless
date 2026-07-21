import { readFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { detectBattleLogCompatibility } from "../src/pokeweb/battleLogModel";
import type { ProjectState } from "../src/pokeweb/projectStore";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: npm run battlelog:verify-rom -- Black2-or-White2.nds");

const bytes = new Uint8Array(await readFile(romPath));
const rom = new NintendoDSRom(bytes);
const baseVersion = rom.idCode === "IREO" ? "B2" : "W2";
const project = {
  originalRomBytes: bytes,
  session: { romName: rom.name, baseVersion, baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
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
