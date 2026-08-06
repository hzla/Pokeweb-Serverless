import { basename, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readAscii, readU16, readU32 } from "../src/nds/binary";
import { decompressCode } from "../src/nds/codeCompression";
import { NintendoDSRom } from "../src/nds/rom";
import { getBattleLogInstallStatus, installBattleLog } from "../src/pokeweb/battleLogModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { detectPmcInstallFromRom, PMC_OVERLAY_ID_PATH } from "../src/pokeweb/pmcModel";
import type { ProjectState } from "../src/pokeweb/projectStore";
import { parseRpm } from "../src/pokeweb/rpm";

const romPath = process.argv[2];
const outputPath = process.argv[3];
if (!romPath) {
  throw new Error("Usage: vite-node scripts/verify-bw1-battle-log-install.ts Black-or-White.nds [output.nds]");
}

const sourceBytes = new Uint8Array(await readFile(romPath));
const sourceRom = new NintendoDSRom(sourceBytes);
const version = sourceRom.idCode === "IRBO" ? "B" : sourceRom.idCode === "IRAO" ? "W" : undefined;
if (!version) throw new Error(`Expected US Black or White, got ${sourceRom.idCode}.`);

const project = {
  originalRomBytes: sourceBytes,
  session: {
    romName: sourceRom.name,
    baseVersion: version,
    baseRom: "BW",
    fairy: false,
    fileIds: {},
    blacklist: [],
  },
  romInfo: { title: sourceRom.name, idCode: sourceRom.idCode, fileName: basename(romPath), size: sourceBytes.length },
  arm9: decompressCode(sourceRom.arm9),
  overlays: {},
  narcs: {},
  texts: { banks: {} },
  formats: {},
  trpokInfo: [],
} as ProjectState;

const assetRoot = resolve(import.meta.dirname, "../src/assets/codeinjection");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("file:")) {
    const bytes = await readFile(new URL(url));
    return new Response(bytes);
  }
  const name = basename(new URL(url, "https://pokeweb.invalid").pathname);
  try {
    return new Response(await readFile(resolve(assetRoot, name)));
  } catch {
    return originalFetch(input);
  }
};

try {
  await installBattleLog(project);
} finally {
  globalThis.fetch = originalFetch;
}

const status = getBattleLogInstallStatus(project);
if (!status.installed) throw new Error(`Staged battle log did not report installed: ${status.message}`);

const exportedBytes = await exportModifiedRom(project);
const exportedRom = new NintendoDSRom(exportedBytes);
const detected = detectPmcInstallFromRom(exportedRom);
if (detected?.pmc?.overlayId !== 237) throw new Error("Exported BW1 PMC overlay marker is not 237.");
if (exportedRom.arm9OverlayTable.length !== 238 * 32) throw new Error("Exported BW1 overlay table does not contain 238 entries.");
const overlayEntry = 237 * 32;
if (readU32(exportedRom.arm9OverlayTable, overlayEntry) !== 237) throw new Error("Exported BW1 PMC overlay entry is malformed.");
const overlayBase = readU32(exportedRom.arm9OverlayTable, overlayEntry + 4);
if (readAscii(exportedRom.getFileByName("overlay/overlay_0237.bin"), 0x2ff0, 4) !== "OVL0") {
  throw new Error("Exported BW1 PMC overlay footer is missing.");
}
for (const path of [
  `patches/${version === "B" ? "Black1" : "White1"}BattleLog.dll`,
  `patches/${version === "B" ? "Black1" : "White1"}BattleCounters.dll`,
  `patches/${version === "B" ? "Black1" : "White1"}BattleLogSummary.dll`,
  "battlelog/ancestry.narc",
  "codeinjection/RPMSYM-PMC.rpm",
  PMC_OVERLAY_ID_PATH,
]) {
  if (!exportedRom.getFileByName(path)) throw new Error(`Exported BW1 battle log is missing ${path}.`);
}

const symbols = parseRpm(exportedRom.getFileByName("codeinjection/RPMSYM-PMC.rpm"));
if (symbols.metadata.PMCGameID !== version) throw new Error("Exported BW1 PMC symbols have the wrong game ID.");
const gflAppInit = symbols.symbols.find((symbol) => symbol.name === "GFLAppInit");
if (gflAppInit?.address !== 0x0200545d || gflAppInit.type !== "FUNCTION_THM") {
  throw new Error("Exported BW1 PMC symbols do not preserve the public GFLAppInit address.");
}
const wrapper = symbols.symbols.find((symbol) => symbol.name === "__PokewebBw1BootInitializerWrapper");
const pmcSystemInit = symbols.symbols.find((symbol) => symbol.name === "_PMCSystemInit");
if (!wrapper || wrapper.size !== 12 || !pmcSystemInit) {
  throw new Error("Exported BW1 PMC is missing the combined game/PMC boot initializer.");
}
const overlayRpm = parseRpm(exportedRom.getFileByName("overlay/overlay_0237.bin"));
if (readU16(overlayRpm.code, wrapper.address) !== 0xb500 || readU16(overlayRpm.code, wrapper.address + 10) !== 0xbd00) {
  throw new Error("Exported BW1 PMC boot initializer has malformed entry/return instructions.");
}
const decodeThumbBranchTarget = (offset: number, absoluteAddress: number) => {
  const upper = readU16(overlayRpm.code, offset);
  const lower = readU16(overlayRpm.code, offset + 2);
  if ((upper & 0xf800) !== 0xf000 || (lower & 0xf800) !== 0xf800) {
    throw new Error("Exported BW1 PMC boot initializer call is not a Thumb BL.");
  }
  let delta = ((upper & 0x7ff) << 12) | ((lower & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta -= 0x800000;
  return (absoluteAddress + 4 + delta) >>> 0;
};
const wrapperAddress = overlayBase + 0x20 + wrapper.address;
if (decodeThumbBranchTarget(wrapper.address + 2, wrapperAddress + 2) !== (gflAppInit.address & ~1)) {
  throw new Error("Exported BW1 PMC boot initializer does not call GFLAppInit.");
}
if (decodeThumbBranchTarget(wrapper.address + 6, wrapperAddress + 6) !== overlayBase + 0x20 + pmcSystemInit.address) {
  throw new Error("Exported BW1 PMC boot initializer does not call PMCSystemInit.");
}

const arm9 = decompressCode(exportedRom.arm9);
const arm9Base = exportedRom.arm9RamAddress;
const layout = version === "B"
  ? { heap: 0x02086744, maximum: 0x02078ea8, load: 0x02034b7c, unload: 0x02034a50, fallback: 0x02078d77 }
  : { heap: 0x0208675c, maximum: 0x02078ec0, load: 0x02034b94, unload: 0x02034a68, fallback: 0x02078d8f };
const arm9Word = (address: number) => readU32(arm9, address - arm9Base);
if (arm9Word(layout.heap) !== overlayBase + 0x8000) throw new Error("Exported BW1 PMC heap boundary is wrong.");
if (arm9Word(layout.maximum) !== 0x7fffffff) throw new Error("Exported BW1 overlay maximum was not raised.");
for (const address of [layout.load, layout.unload]) {
  if (((arm9Word(address) & 0xfe000000) >>> 0) !== 0xfa000000) throw new Error("Exported BW1 overlay loader hook is not an ARM BLX.");
}
if (arm9[layout.fallback - arm9Base] !== 0xea) throw new Error("Exported BW1 overlay-header fallback patch is missing.");

if (outputPath) await writeFile(outputPath, exportedBytes);
console.log(
  `Verified ${version === "B" ? "Black" : "White"}: overlay 237 at 0x${overlayBase.toString(16)}, `
    + `${exportedRom.files.length} files, ${exportedBytes.length} ROM bytes.`,
);
