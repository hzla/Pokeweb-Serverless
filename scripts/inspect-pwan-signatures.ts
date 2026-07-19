import { readFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { decompressCode } from "../src/nds/codeCompression";
import {
  PWAN_B2_COMPATIBILITY_SIGNATURES,
  PWAN_W2_COMPATIBILITY_SIGNATURES,
} from "../src/pokeweb/pwanCompatibilityModel";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: vite-node scripts/inspect-pwan-signatures.ts ROM.nds");

const rom = new NintendoDSRom(new Uint8Array(await readFile(romPath)));
const signatures = rom.idCode === "IREO"
  ? PWAN_B2_COMPATIBILITY_SIGNATURES
  : rom.idCode === "IRDO"
    ? PWAN_W2_COMPATIBILITY_SIGNATURES
    : undefined;
if (!signatures) throw new Error(`Unsupported ROM ${rom.idCode}; expected clean US Black 2 (IREO) or White 2 (IRDO).`);
const overlayIds = [...new Set(signatures.flatMap((signature) => signature.overlayId === undefined ? [] : [signature.overlayId]))];
const overlays = rom.loadArm9Overlays(overlayIds);
const arm9 = decompressCode(rom.arm9);

const bytesToHex = (bytes: Uint8Array): string => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
for (const signature of signatures) {
  const source = signature.module === "arm9" ? { data: arm9, ramAddress: rom.arm9RamAddress } : overlays.get(signature.overlayId!);
  if (!source) throw new Error(`Missing ${signature.module} ${signature.overlayId ?? ""}`);
  const offset = signature.windowStart - source.ramAddress;
  const expectedHex = bytesToHex(source.data.subarray(offset, offset + signature.expectedHex.length / 2));
  console.log(JSON.stringify({ ...signature, expectedHex }));
}
