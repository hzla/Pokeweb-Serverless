import assert from "node:assert/strict";
import { basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readU32 } from "../src/nds/binary";
import { decompressCode } from "../src/nds/codeCompression";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { detectBundledDoubleBattleFixDll, detectPmcInstallFromRom, getPmcInstallStatus, installBundledPmc, stageBundledDoubleBattleFixDll } from "../src/pokeweb/pmcModel";
import type { ProjectState } from "../src/pokeweb/projectStore";
import { parseRpm } from "../src/pokeweb/rpm";

const [romPath, outputPath] = process.argv.slice(2);
if (!romPath) throw new Error("Usage: vite-node scripts/verify-black1-double-battle-fix.ts Black.nds [output.nds]");
const sourceBytes = new Uint8Array(await readFile(romPath));
const source = new NintendoDSRom(sourceBytes, { fileData: "view" });
assert.equal(source.idCode, "IRBO", "Expected US Black 1");
const makeProject = (bytes: Uint8Array): ProjectState => {
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  return {
    originalRomBytes: bytes,
    session: { romName: rom.name, baseVersion: "B", baseRom: "BW", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: rom.name, idCode: rom.idCode, fileName: basename(romPath), size: bytes.length },
    arm9: decompressCode(rom.arm9), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: detectPmcInstallFromRom(rom),
  };
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => new Response(await readFile(new URL(input instanceof Request ? input.url : String(input))));
try {
  const project = makeProject(sourceBytes);
  await installBundledPmc(project);
  assert.equal(getPmcInstallStatus(project).installed, true);
  const result = await stageBundledDoubleBattleFixDll(project);
  await stageBundledDoubleBattleFixDll(project);
  assert.equal(result.path, "patches/DoubleBattleFixB.dll");
  assert.equal(detectBundledDoubleBattleFixDll(project), "patched");
  assert.equal(project.codeInjection?.modules?.filter(module => module.path === result.path).length, 1);

  const exportedBytes = await exportModifiedRom(project);
  const exported = new NintendoDSRom(exportedBytes, { fileData: "view" });
  const detected = detectPmcInstallFromRom(exported);
  assert.equal(detected?.pmc?.overlayId, 237);
  assert.equal(detected?.pmc?.gameId, "B");
  assert.equal(exported.arm9OverlayTable.length, 238 * 32);
  const overlayBase = readU32(exported.arm9OverlayTable, 237 * 32 + 4);
  const symbols = parseRpm(exported.getFileByName("codeinjection/RPMSYM-PMC.rpm"));
  assert.equal(symbols.metadata.PMCGameID, "B");
  const wrapper = symbols.symbols.find(symbol => symbol.name === "__PokewebBw1BootInitializerWrapper");
  assert.equal(wrapper?.size, 12, "BW1 combined game/PMC boot wrapper");
  const arm9 = decompressCode(exported.arm9);
  assert.equal(readU32(arm9, 0x02086744 - exported.arm9RamAddress), overlayBase + 0x8000);
  const dll = exported.getFileByName(result.path);
  assert.deepEqual(dll, project.fileSystem?.additions?.[result.path]);
  const module = parseRpm(dll, { allowedMagics: ["DLXF"] });
  assert.equal(module.metadata.PMCGameID, "B");
  assert.deepEqual(module.relocations.map(({ target }) => target).sort((a, b) => a.address - b.address), [
    { module: "21", address: 0x021ae0cc, type: "THUMB_BRANCH" },
    { module: "21", address: 0x021aebb0, type: "THUMB_BRANCH" },
  ]);
  for (const id of [10, 21]) {
    assert.deepEqual(exported.loadArm9Overlays([id]).get(id)!.data, source.loadArm9Overlays([id]).get(id)!.data,
      `Trainer overlay ${id} should be hooked by PMC at runtime`);
  }
  const reimported = makeProject(exportedBytes);
  assert.equal(detectBundledDoubleBattleFixDll(reimported), "patched");
  await stageBundledDoubleBattleFixDll(reimported);
  assert.equal(reimported.fileSystem?.additions?.[result.path], undefined, "Reuse the exported DLL file ID");
  const reexported = new NintendoDSRom(await exportModifiedRom(reimported), { fileData: "view" });
  assert.equal(reexported.files.length, exported.files.length);
  assert.deepEqual(reexported.getFileByName(result.path), dll);
  if (outputPath) await writeFile(outputPath, exportedBytes);
  console.log(`Verified Black 1 PMC overlay 237 at 0x${overlayBase.toString(16)}, two trainer hooks, DLL export/reimport, and repeat installation (${exportedBytes.length} ROM bytes).`);
} finally {
  globalThis.fetch = originalFetch;
}
