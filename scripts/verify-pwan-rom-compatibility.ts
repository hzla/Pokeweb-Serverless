import { readFile } from "node:fs/promises";
import { decompressCode } from "../src/nds/codeCompression";
import { NintendoDSRom } from "../src/nds/rom";
import { detectPwanRuntimeCompatibility } from "../src/pokeweb/pwanCompatibilityModel";
import type { ProjectState } from "../src/pokeweb/projectStore";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: npm run pwan:runtime:verify-rom -- ROM.nds");

const bytes = new Uint8Array(await readFile(romPath));
const rom = new NintendoDSRom(bytes);
const baseVersion = rom.idCode === "IREO" ? "B2" : rom.idCode === "IRDO" ? "W2" : undefined;
if (!baseVersion) throw new Error(`Expected stock US Black 2 (IREO) or White 2 (IRDO), got ${rom.idCode}.`);

const project = {
  originalRomBytes: bytes,
  session: { romName: rom.name, baseVersion, baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
  romInfo: { title: rom.name, idCode: rom.idCode, fileName: romPath, size: bytes.length },
  arm9: decompressCode(rom.arm9),
  overlays: {},
  narcs: {},
  texts: { banks: {} },
  formats: {},
  trpokInfo: [],
} as ProjectState;

const report = detectPwanRuntimeCompatibility(project);
if (!report.compatible) {
  for (const check of report.checks.filter((entry) => entry.status !== "matched")) {
    console.error(`${check.status}: ${check.group} / ${check.label}: ${check.message}`);
  }
  throw new Error(`PWAN compatibility failed (${report.passed}/${report.checks.length} checks passed).`);
}
console.log(`${baseVersion} PWAN compatibility passed (${report.passed}/${report.checks.length} checks).`);
