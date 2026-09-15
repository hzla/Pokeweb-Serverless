import { basename, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { NintendoDSRom } from "../src/nds/rom";
import { decompressCode } from "../src/nds/codeCompression";
import { battleLogSaveGuard, type BattleLogGuardVersion } from "../src/pokeweb/battleLogSaveGuard";
import { canUninstallBattleLog, detectBattleLogCompatibility, getBattleLogInstallStatus, installBattleLog, uninstallBattleLog, hydrateBattleLogInstallMetadata } from "../src/pokeweb/battleLogModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { parseRpm } from "../src/pokeweb/rpm";
import type { ProjectState } from "../src/pokeweb/projectStore";

const path = process.argv[2];
if (!path) throw Error("Usage: vite-node scripts/verify-battle-log-save-guards.ts input.nds [output.nds]");
const input = new Uint8Array(await readFile(path));
function projectFor(bytes: Uint8Array): ProjectState {
  const rom = new NintendoDSRom(bytes);
  const version = ({ IRBO: "B", IRAO: "W", IREO: "B2", IRDO: "W2" } as const)[rom.idCode as "IRBO"];
  if (!version) throw Error(`Unsupported ROM ${rom.idCode}`);
  return {originalRomBytes: bytes, session: {baseVersion: version, baseRom: version.endsWith("2") ? "BW2" : "BW", romName: rom.name, fairy: false, fileIds: {}, blacklist: []},
    romInfo: {title: rom.name, idCode: rom.idCode, fileName: basename(path!), size: bytes.length}, arm9: decompressCode(rom.arm9), overlays: {}, narcs: {}, texts: {banks: {}}, formats: {}, trpokInfo: []} as ProjectState;
}
const project = projectFor(input);
const guard = battleLogSaveGuard(project.session.baseVersion as BattleLogGuardVersion);
const initial = detectBattleLogCompatibility(project);
assert(initial.compatible, initial.checks.filter((c) => !c.matched).map((c) => c.message).join("\n"));
const oldStatus = getBattleLogInstallStatus(project);
if (oldStatus.dllInstalled && !oldStatus.upToDate) assert(oldStatus.updateAvailable,"legacy install must offer Update even without current ancestry metadata");
const fetchBefore = globalThis.fetch;
let failAsset = true;
globalThis.fetch = async (value) => {
  const url = value instanceof Request ? value.url : String(value);
  const filename = basename(new URL(url, "https://local.invalid").pathname);
  if (failAsset && filename === guard.filename) return new Response(null,{status:404});
  return new Response(await readFile(resolve(import.meta.dirname, "../src/assets/codeinjection", filename)));
};
try {
  const beforeFailure = structuredClone(project);
  await assert.rejects(installBattleLog(project), /Could not load all/);
  assert.deepEqual(project,beforeFailure,"failed asset fetch partially changed project");
  failAsset = false;
  await installBattleLog(project);
  assert(getBattleLogInstallStatus(project).upToDate);
  const first = await exportModifiedRom(project);
  await installBattleLog(project);
  const second = await exportModifiedRom(project);
  assert.deepEqual(second, first, "reinstallation changed the exported ROM");
  project.fileSystem!.additions!["patches/ConflictingSaveGuard.dll"] = project.fileSystem!.additions![guard.path]!;
  const conflict = detectBattleLogCompatibility(project);
  assert(!conflict.compatible && conflict.checks.some(c => c.message.includes("ConflictingSaveGuard.dll")),"runtime hook conflict was not rejected");
  delete project.fileSystem!.additions!["patches/ConflictingSaveGuard.dll"];
  const exported = new NintendoDSRom(first);
  const loaded = projectFor(first);
  hydrateBattleLogInstallMetadata(loaded, exported);
  assert(getBattleLogInstallStatus(loaded).upToDate, "export/reload lost save-guard status");
  assert.equal(Buffer.from(loaded.arm9.subarray(guard.daily.address-exported.arm9RamAddress, guard.daily.address-exported.arm9RamAddress+16)).toString("hex"),guard.daily.disabledHex);
  const module = parseRpm(exported.getFileByName(guard.path),{allowedMagics:["DLXF"]});
  assert.equal(module.bssSize,4);
  assert.equal(module.relocations.filter((r)=>r.target.module==='ARM9').length,3);
  // A direct-child DLL can shift IDs of optional patch subdirectories. Retail
  // resources must not move; optional files must remain reachable by path.
  const original = new NintendoDSRom(input);
  const shiftedOptionalFiles: string[] = [];
  function walk(folder: typeof original.filenames, prefix = "") {
    folder.files.forEach((name,index)=>{
      const path = prefix+name, oldId=folder.firstId+index, newId=exported.filenames.idOf(path);
      assert.notEqual(newId,undefined,path);
      if (newId !== oldId) {
        assert(/^(patches\/|battlelog\/|battlelog_ko\/|codeinjection\/|weather\/pwth\.bin$)/.test(path),`Retail file ID shifted: ${path}`);
        shiftedOptionalFiles.push(path);
        // Updated logger artifacts are checked through their current fingerprints.
        if (!/Battle(Log|Counters)|ancestry\.narc|SaveGuard/.test(path)) assert.deepEqual(exported.files[newId!],original.files[oldId],path);
      }
    });
    folder.folders.forEach(([name,child])=>walk(child,prefix+name+'/'));
  }
  walk(original.filenames);
  if (canUninstallBattleLog(project)) {
    uninstallBattleLog(project);
    assert(!getBattleLogInstallStatus(project).installed);
    assert.equal(Buffer.from(project.arm9.subarray(guard.daily.address-original.arm9RamAddress,guard.daily.address-original.arm9RamAddress+16)).toString("hex"),guard.daily.expectedHex);
  }
  if (process.argv[3]) await writeFile(process.argv[3], first);
  assert.deepEqual(new Uint8Array(await readFile(path)),input,"input ROM changed");
  console.log(`${basename(path)}: ${initial.passed} signatures verified; install/reinstall/export/reload, guard residency, retail file IDs and staged uninstall passed. ${shiftedOptionalFiles.length} optional patch files renumbered; paths preserved. No emulator run.`);
} finally { globalThis.fetch = fetchBefore; }
