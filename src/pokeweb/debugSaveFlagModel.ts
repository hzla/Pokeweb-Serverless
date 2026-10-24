import manifest from "../assets/codeinjection/debugSaveFlagManifest.json";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import { recordGenericChange } from "./actionChangelog";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import type { ProjectState } from "./projectStore";

type Version = keyof typeof manifest.games;
const urls = {
  B2: new URL("../assets/codeinjection/DebugSaveFlagB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/DebugSaveFlagW2.dll", import.meta.url),
};
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const types = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"];
const MAGIC = 0x474c4644;
export function parseDebugSaveFlag(text: string): number {
  if (!text.trim()) return 0; // Blank disables the shortcut in an installed ROM.
  const flag = /^(?:0x[\da-f]+|\d+)$/iu.test(text.trim()) ? Number(text) : NaN;
  if (!Number.isInteger(flag) || flag < 1 || flag > 0xbf3)
    throw new Error("Use a saved flag from 1 to 3059 (0x0BF3), or blank to disable.");
  return flag;
}
export function isDebugSaveFlagRuntime(rpm: RpmModule, version: Version): boolean {
  const expected = manifest.games[version], offset = expected.configOffset;
  if (rpm.baseAddress || rpm.bssSize !== expected.bss || rpm.metadata.PMCGameID !== version ||
      rpm.metadata.PMCVersion !== manifest.version || rpm.metadata.PMCModulePriority !== 4 ||
      rpm.symbols.some(s => s.attributes & 2)) return false;
  const code = rpm.code.slice();
  if (readU32(code, offset) !== MAGIC) return false;
  const flag = readU16(code, offset + 4), enabled = readU16(code, offset + 6);
  if (flag > 0xbf3 || enabled !== Number(flag !== 0) || readU32(code, offset + 8) !== (MAGIC ^ flag ^ (enabled << 16))) return false;
  writeU16(code, offset + 4, 0); writeU16(code, offset + 6, 0); writeU32(code, offset + 8, MAGIC);
  if (hex(code) !== expected.codeHex) return false;
  const relocations = rpm.relocations.map(({target:t,sourceSymbolIndex}) => {
    const s = rpm.symbols[sourceSymbolIndex];
    return s ? `${t.module}:${t.address.toString(16)}:${t.type}:${s.address.toString(16)}:${types.indexOf(s.type)}:${s.attributes}` : "invalid";
  }).sort();
  return JSON.stringify(relocations) === JSON.stringify(expected.relocations);
}
export function configureDebugSaveFlag(rpm: RpmModule, version: Version, flag: number): Uint8Array {
  if (!isDebugSaveFlagRuntime(rpm, version)) throw new Error("Unrecognized Debug Save Flag runtime.");
  if (flag !== 0) parseDebugSaveFlag(String(flag));
  const offset = manifest.games[version].configOffset, enabled = Number(flag !== 0);
  writeU16(rpm.code, offset + 4, flag); writeU16(rpm.code, offset + 6, enabled);
  writeU32(rpm.code, offset + 8, MAGIC ^ flag ^ (enabled << 16));
  return writeRpm(rpm, { ident: "DLXF" });
}
export function getDebugSaveFlagStatus(project: ProjectState) {
  const status = { supported:false, compatible:false, installed:false, flag:0,
    message:"Requires US revision-0 Black 2 or White 2." };
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2") ||
      project.romInfo.idCode !== manifest.games[version].idCode) return status;
  status.supported = true;
  if (!project.originalRomBytes) return {...status,message:"Reload the ROM to verify native flag and input code."};
  try {
    const rom = new NintendoDSRom(project.originalRomBytes,{fileData:"view"}), expected = manifest.games[version];
    if (rom.idCode !== expected.idCode || project.originalRomBytes[0x1e] !== 0) return {...status,supported:false};
    const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_,id)=>getRomFileBytes(project,rom,id),new Set([36]));
    const arm = decompressCode(project.arm9 ?? rom.arm9);
    for (const s of expected.signatures) {
      const ov = overlays.get(Number(s.module)), base = s.module === "ARM9" ? rom.arm9RamAddress : ov?.ramAddress;
      const candidates = s.module === "ARM9" ? [arm] : [ov?.data,project.overlays[Number(s.module)] ?? ov?.data];
      if (base === undefined || candidates.some(data=>!data || s.address < base || hex(data.subarray(s.address-base,s.address-base+s.hex.length/2)) !== s.hex))
        return {...status,message:`Native ${s.module} code differs at 0x${s.address.toString(16)}.`};
    }
    let copies = 0;
    for (const entry of listCodeInjectionDlls(project)) {
      const addition = Object.keys(project.fileSystem?.additions ?? {}).find(p=>p.toLowerCase()===entry.path.toLowerCase());
      const id = rom.filenames.idOf(entry.path);
      const bytes = addition ? project.fileSystem!.additions![addition] : id === undefined ? undefined : getRomFileBytes(project,rom,id);
      let rpm: RpmModule | undefined;
      try { if (bytes) rpm=parseRpm(bytes,{allowedMagics:["DLXF"]}); } catch { /* Reserved name check below. */ }
      if (rpm && isDebugSaveFlagRuntime(rpm,version)) {
        if (entry.path.toLowerCase() !== `patches/${expected.fileName}`.toLowerCase())
          return {...status,message:`Move the debug module to patches/${expected.fileName}.`};
        copies++; status.installed=true; status.flag=readU16(rpm.code,expected.configOffset+4);
      } else if (entry.fileName.toLowerCase()===expected.fileName.toLowerCase() || rpm?.relocations.some(({target:t,sourceSymbolIndex})=>{
        const n=t.type==="FULL_COPY"?rpm!.symbols[sourceSymbolIndex]?.size??0:t.type==="THUMB_BRANCH"?8:t.type==="THUMB_BRANCH_SAFESTACK"?16:4;
        return expected.signatures.some(s=>s.patchSize>0 && t.module===s.module && t.address<s.address+s.patchSize && t.address+n>s.address);
      })) return {...status,message:`Conflicting code injection module: ${entry.path}.`};
    }
    if (copies > 1) return {...status,message:"Remove duplicate debug flag modules."};
    return {...status,compatible:true,message:status.installed?"Installed. Export the ROM to apply changes.":"Compatible. PMC is installed automatically."};
  } catch { return {...status,message:"Could not verify the native flag shortcut."}; }
}
/** Called inside the common atomic installer, which also stages PMC. */
export async function installDebugSaveFlag(project: ProjectState, flag: number) {
  const status=getDebugSaveFlagStatus(project);
  if (!status.compatible) throw new Error(status.message);
  const version=project.session.baseVersion as Version;
  if (flag !== 0) parseDebugSaveFlag(String(flag));
  const response=await fetch(urls[version]);
  if (!response.ok) throw new Error(`Could not load Debug Save Flag (${response.status}).`);
  const rpm=parseRpm(new Uint8Array(await response.arrayBuffer()),{allowedMagics:["DLXF"]});
  const result=stageCodeInjectionDll(project,manifest.games[version].fileName,configureDebugSaveFlag(rpm,version,flag));
  recordGenericChange(project,"code_injection",flag?`Debug shortcut toggles saved flag 0x${flag.toString(16)}.`:"Debug flag shortcut disabled.","Debug Save Flag",{key:"code-injection:debug-save-flag"});
  return result;
}
