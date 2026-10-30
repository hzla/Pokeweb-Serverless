import { buttonAssets, ensureCGearButtons, hydrateCGearButtons, validateButtonArchive, disableButtonArchive, stageNativeButtonGraphics, restoreNativeButtonGraphics, installedNativeButtonGraphics } from "./cgearButtonsModel";
import { compile } from "../cgearButtons/compiler";
import { originalGraphics, sameGraphics, packNativeGraphics } from "../cgearButtons/nativeGraphics";
import manifest from "../assets/codeinjection/cgearQuickActionsManifest.json";
import reduxManifest from "../assets/codeinjection/cgearQuickActionsReduxManifest.json";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { adoptExistingPmcInstall, canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installPmcBytes,
  listCodeInjectionDlls, loadBundledPmcBytes, removeStagedCodeInjectionDll, stageCodeInjectionDll,
  installBundledBgmToggleDll, assertBundledBgmRuntimeCompatibility,
  type CodeInjectionDllInstallResult } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { getBw1CGearStatus, installBw1CGear, disableBw1CGear, removeBw1CGear } from "./cgearQuickActionsBw1Model";
import { parseRpm, type RpmModule } from "./rpm";
import { ensureSystemShops, hydrateSystemShops, stageSystemShops } from "./systemShopsModel";
import { findReduxRepel, isReduxRepel } from "./cgearReduxModel";
import { sha256Hex } from "../nds/sha256";
import followingWhite2 from "../assets/following/runtime.json";
import followingBlack2 from "../assets/following/black2/runtime.json";
import followingUpgrade from "../assets/following/white2upgrade/runtime.json";

type Version = "B2" | "W2";
type Profile = typeof manifest.games.W2;
export const CGEAR_QUICK_ACTIONS_VERSION = manifest.version;
export const CGEAR_QUICK_ACTIONS_ARCHIVE = manifest.archivePath;
export const CGEAR_QUICK_ACTIONS_DEFAULT_PC_HIDE_FLAG = manifest.defaultPcHideFlag;
export type CGearQuickActionsOptions = { pcHideFlag?: number; applySystemShops?: boolean };
export type CGearQuickActionsStatus = {
  supported: boolean; compatible: boolean; installed: boolean; enabled: boolean;
  pmcInstalled: boolean; updateAvailable: boolean; canRemove: boolean; pcHideFlag: number; dllPath?: string; message: string;
  romProfile?: "retail" | "redux";
  runtimeVersion?: string;
};
const urls = { W2: new URL("../assets/codeinjection/CGearQuickActionsW2.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/CGearQuickActionsB2.dll", import.meta.url) };
const graphicsUrl = new URL("../assets/codeinjection/cgearQuickActions.narc", import.meta.url);
const reduxUrl = new URL("../assets/codeinjection/CGearQuickActionsReduxW2.dll", import.meta.url);
const hex = (b: Uint8Array) => Array.from(b, v => v.toString(16).padStart(2, "0")).join("");
const hash = async (b: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b))));
function fingerprint(b: Uint8Array): string {
  let h = 0x811c9dc5;for (const v of b) h = Math.imul(h ^ v, 0x1000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
function recognized(rpm: RpmModule, version: Version): boolean {
  const candidates=[{version:manifest.version,profile:manifest.games[version]},...manifest.previousVersions.map(p=>({version:p.version,profile:p.games[version]})),
    ...(version === "W2" ? [{ version: reduxManifest.version, profile: reduxManifest.games.W2 }] : [])];
  const found=candidates.find(c=>rpm.metadata.PMCVersion===c.version && rpm.bssSize===c.profile.bssSize && fingerprint(rpm.code)===c.profile.codeFingerprint);
  if(!found)return false;
  const p = found.profile;
  if (rpm.baseAddress || rpm.bssSize !== p.bssSize || rpm.metadata.PMCGameID !== version
    || rpm.metadata.PMCModulePriority !== 4
    || rpm.symbols.some(s => (s.attributes & 2) && s.address!==parseInt(fingerprint(new TextEncoder().encode("PokewebBgmMute")),16)) || fingerprint(rpm.code) !== p.codeFingerprint) return false;
  const expected = p.signatures.filter(s => s.patchSize).map(s => `${s.module}:${s.address}:${s.label.startsWith("QaRepel") || s.label.startsWith("QaPhenomenon") || s.label.startsWith("QaShop") && !["QaShopChoiceAdd","QaShopBuyCommand","QaShopRowPrice","QaShopTmRowPrice"].includes(s.label) || ["QaInput", "QaButtonHit", "QaGearUnit", "QaGearEnd"].includes(s.label) ? "THUMB_BRANCH_LINK" : "FULL_COPY"}`).sort();
  const actual = rpm.relocations.filter(r => r.target.module !== "base").map(r => `${r.target.module}:${r.target.address}:${r.target.type}`).sort();
  return expected.join("|") === actual.join("|");
}
function bytesAt(p: ProjectState, rom: NintendoDSRom | undefined, path: string): Uint8Array | undefined {
  const added = Object.keys(p.fileSystem?.additions ?? {}).find(n => n.toLowerCase() === path.toLowerCase());
  if (added) return p.fileSystem!.additions![added];
  const id = rom?.filenames.idOf(path);return id !== undefined ? getRomFileBytes(p, rom!, id) : undefined;
}
function archiveState(bytes: Uint8Array): boolean {
  const arc = new NARC(bytes), h = arc.files[0];
  if(h && [5,6,7].includes(readU16(h,4)))return validateButtonArchive(bytes);
  const legacy=h?.length===36 && readU16(h,4)===3;
  if (arc.files.length !== 9 || !h || (!legacy && (h.length!==40 || readU16(h,4)!==4)) || readU32(h, 0) !== 0x41475143
    || readU16(h, 6) !== h.length || readU32(h, 8) > 1
    || readU32(h, 12) !== (0x41475143 ^ readU32(h, 8))) throw new Error("Unrecognized Quick Actions archive. Restore its private graphics archive before updating.");
  if(!legacy) {validatePCFlag(readU16(h,36));if(readU16(h,38))throw new Error('Unrecognized Quick Actions button configuration.');}
  const graphicsFingerprint=fingerprint(arc.files.slice(1,8).reduce((a, b) => {
    const joined = new Uint8Array(a.length + b.length);joined.set(a);joined.set(b, a.length);return joined;
  }, new Uint8Array()));
  if(graphicsFingerprint!==manifest.graphicsFingerprint && !manifest.previousVersions.some(p=>p.graphicsFingerprint===graphicsFingerprint))
    throw new Error("Quick Actions graphics have unrecognized modifications.");
  if(arc.files[8].length!==5120 || fingerprint(arc.files[8])!==readU32(h,32).toString(16).padStart(8,'0'))
    throw new Error('Quick Actions pattern data failed its integrity check. Reinstall its private graphics archive.');
  return Boolean(readU32(h, 8));
}
function validatePCFlag(flag:number):void {
  if(!Number.isInteger(flag) || flag<1 || flag>manifest.maxSaveFlag)
    throw new Error(`PC hide flag must be a saved flag from 1 to ${manifest.maxSaveFlag} (decimal or hexadecimal).`);
}
function nativePatterns(project:ProjectState,rom:NintendoDSRom):Uint8Array {
  const id=rom.filenames.idOf('a/2/8/7');if(id===undefined)throw new Error('The native C-Gear graphics archive is missing.');
  const arc=new NARC(getRomFileBytes(project,rom,id)),out=new Uint8Array(5120);
  for(let i=0;i<10;i++) {
    const b=arc.files[19+i],body=b?.subarray(176,688);
    if(!b || String.fromCharCode(...b.subarray(0,4))!=='RGCN' || body?.length!==512
      || body.some(v=>![0,9,13].includes(v&15)||![0,9,13].includes(v>>>4)))
      throw new Error(`Unrecognized native C-Gear pattern ${i+1}. Restore a compatible 32×32 native pattern before installing.`);
    out.set(body,i*512);
  }
  return out;
}
function conflicts(rpm: RpmModule, profile: Profile, followingCore = false): boolean {
  const sharedMusic=rpm.metadata.PMCGameID===(profile.idCode==="IRDO"?"W2":"B2")
    && ["3.0.0","3.0.1"].includes(String(rpm.metadata.PMCVersion))
    && rpm.symbols.some(s=>s.nameHash===0x59ce771e&&(s.attributes&1)&&s.size===32);
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4;
    // The follower wraps two event functions within this read-only signature;
    // C-Gear uses the same native event ABI but does not write at those sites.
    return profile.signatures.some(s => !(sharedMusic&&s.label==="Shared music runtime hook")
      && !(followingCore && s.label === "Native event allocation and destruction layout" && target.module === "ARM9"
        && target.type === "FULL_COPY" && size === 8 && [0x02016cf8, 0x02016d08].includes(target.address)) && s.module === target.module
      && target.address < s.address + s.expectedHex.length / 2 && target.address + size > s.address);
  });
}
function isVerifiedFollowingCore(path: string, bytes: Uint8Array | undefined, version: Version): boolean {
  if (!bytes || path !== `patches/PokewebFollowingCore${version}.dll`) return false;
  const hashes = version === "W2" ? [followingWhite2.coreSha256, followingUpgrade.coreSha256] : [followingBlack2.coreSha256];
  return hashes.includes(sha256Hex(bytes));
}
function checkCGearPaletteSpace(project: ProjectState, rom: NintendoDSRom): void {
  const id=rom.filenames.idOf("a/2/8/7");
  if(id===undefined) throw new Error("The native C-Gear graphics archive is missing.");
  const arc=new NARC(getRomFileBytes(project,rom,id));
  const prior=bytesAt(project,rom,manifest.archivePath);
  // Only the hash-checked owned common pair may reference the dial's bank 7.
  const owned=prior&&new NARC(prior).files[14]&&sameGraphics(originalGraphics(arc),installedNativeButtonGraphics(prior));
  if(prior&&!owned){const backup=new NARC(new NARC(prior).files[14]);if(!sameGraphics(originalGraphics(arc),backup)&&!sameGraphics(originalGraphics(arc),packNativeGraphics(backup)))throw new Error("Native C-Gear graphics changed after installation. Restore the owned graphics before updating or disabling.");}
  // Native actor palette offsets may add one for a dim appearance. Banks
  // 0..6 remain native; custom actors use 7..14; the network icon keeps 15.
  for(const member of [17,29]) {
    const b=arc.files[member];
    if(!b || b.length<48 || String.fromCharCode(...b.subarray(0,4))!=="RECN") throw new Error("Unrecognized native C-Gear cell resources.");
    const count=readU16(b,24),stride=readU16(b,26)===1?16:8,first=24+readU32(b,28),oam=first+count*stride;
    if(first<48 || oam>b.length) throw new Error("Invalid native C-Gear cell layout.");
    for(let c=0;c<count;c++) {
      const n=readU16(b,first+c*stride),at=oam+readU32(b,first+c*stride+4);
      if(at+n*6>b.length) throw new Error("Invalid native C-Gear OAM layout.");
      for(let j=0;j<n;j++) if(readU16(b,at+j*6)&0x2000 || (readU16(b,at+j*6+4)>>>12>5&&!(owned&&member===17&&[31,32,33,34,36,37].includes(c)&&readU16(b,at+j*6+4)>>>12===7)))
        throw new Error("Custom C-Gear graphics already use the palette space required for Quick Actions. Restore compatible C-Gear graphics before installing.");
    }
  }
  for(const member of [14,15]) {
    const b=arc.files[member];
    if(!b || b.length<392 || b.subarray(40+7*32,40+15*32).some(v=>v!==0))
      throw new Error("C-Gear palette banks 7–14 are already in use. Restore compatible C-Gear graphics before installing.");
  }
}
export function getCGearQuickActionsStatus(project: ProjectState): CGearQuickActionsStatus {
  if(project.session.baseRom==="BW")return getBw1CGearStatus(project);
  const state: CGearQuickActionsStatus = { supported: false, compatible: false, installed: false, enabled: false,
    pmcInstalled: getPmcInstallStatus(project).installed, updateAvailable: false, canRemove: false, pcHideFlag:manifest.defaultPcHideFlag,
    message: "C-Gear Quick Actions supports English US Black 2 and White 2 revision 0." };
  const v = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (v !== "W2" && v !== "B2")) return state;
  let rom: NintendoDSRom | undefined;
  try {if (project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });}
  catch {return { ...state, message: "Reload the ROM to check C-Gear compatibility." };}
  const redux = v === "W2" && rom ? findReduxRepel(project, rom) : undefined;
  const profile: Profile = redux ? reduxManifest.games.W2 : manifest.games[v];
  const targetVersion = redux ? reduxManifest.version : manifest.version;
  if ((rom?.idCode ?? project.romInfo.idCode) !== profile.idCode || (rom && rom.data[0x1e] !== 0)) return state;
  state.supported = true;
  state.romProfile = redux ? "redux" : "retail";
  state.runtimeVersion = targetVersion;
  const owned: string[] = [];
  for (const entry of listCodeInjectionDlls(project)) {
    let rpm: RpmModule | undefined;
    let bytes: Uint8Array | undefined;
    try {bytes = bytesAt(project, rom, entry.path);if (bytes) rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });} catch { /* Names still checked below. */ }
    if (redux && entry.target === "patches" && entry.path === redux.path && rpm && isReduxRepel(rpm)) continue;
    if (entry.target === "patches" && rpm && recognized(rpm, v)) {
      if (rpm.metadata.PMCVersion === reduxManifest.version && !redux) return { ...state, installed: true,
        message: "The Redux C-Gear adapter requires its matching Redux repel runtime. Restore that runtime before updating." };
      owned.push(entry.path);state.updateAvailable=rpm.metadata.PMCVersion!==targetVersion;
    }
    else if ((rpm && conflicts(rpm, profile, isVerifiedFollowingCore(entry.path, bytes, v))) || /^CGearQuickActions[WB]2\.dll$/iu.test(entry.fileName)) {
      return { ...state, message: `Conflicting C-Gear, encounter, or field action code in ${entry.path}. Remove that conflicting module or use a compatible version.` };
    }
  }
  if (owned.length > 1) return { ...state, installed: true, message: "Multiple Quick Actions runtimes are present. Remove the duplicate before updating." };
  state.installed = owned.length === 1;state.dllPath = owned[0];
  state.canRemove = Boolean(state.dllPath && canRemoveStagedCodeInjectionDll(project, state.dllPath)
    && project.fileSystem?.additions?.[manifest.archivePath]);
  const archive = bytesAt(project, rom, manifest.archivePath);
  if (archive) {
    try {
      state.enabled = archiveState(archive);
      const h=new NARC(archive).files[0];if(h.length===40)state.pcHideFlag=readU16(h,36);
      if([5,6,7].includes(readU16(h,4))){if(rom)hydrateCGearButtons(project,rom);const pc=ensureCGearButtons(project).document.buttons.find(b=>b.action==="pc");state.pcHideFlag=pc?.flag?.id??1517;}
    } catch (e) {return { ...state, message: String(e instanceof Error ? e.message : e) };}
    if (!state.installed && (state.enabled || ![5,6,7].includes(readU16(new NARC(archive).files[0],4)))) return { ...state, message: "An orphan Quick Actions archive is present. Remove it before installing a fresh runtime." };
  } else if (state.installed) return { ...state, message: "Quick Actions runtime has no private graphics archive. Restore the archive before updating." };
  if (!rom) return { ...state, message: "Reload the ROM to verify native C-Gear hooks before installation." };
  try {
    hydrateSystemShops(project,rom);
    assertBundledBgmRuntimeCompatibility(project,project.originalRomBytes!);
    checkCGearPaletteSpace(project,rom);
    nativePatterns(project,rom);
    const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_id, fileId) => getRomFileBytes(project, rom!, fileId), new Set([12, 36, 79]));
    const arm = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
    for (const s of profile.signatures) {
      const o = overlays.get(Number(s.module));const base = s.module === "ARM9" ? rom.arm9RamAddress : o?.ramAddress;
      const data = s.module === "ARM9" ? [arm] : [o?.data, project.overlays[Number(s.module)] ?? o?.data];
      const offset = base === undefined ? -1 : s.address - base;
      if (data.some(b => !b || offset < 0 || hex(b.subarray(offset, offset + s.expectedHex.length / 2)) !== s.expectedHex)) {
        return { ...state, message: `Unrecognized ${s.label} code in ${s.module === "ARM9" ? "ARM9" : `overlay ${s.module}`} at 0x${s.address.toString(16)}. Restore the native hook or use a compatible build.` };
      }
    }
  } catch (e) {return { ...state, message: e instanceof Error ? e.message : "Could not read native C-Gear resources. Reload the ROM before installing." };}
  state.compatible = true;
  state.message = state.updateAvailable ? `Quick Actions update ${targetVersion} is available. Choose Update / Enable to install the fixes.`
    : state.installed ? state.enabled ? "Quick Actions is enabled. The wrench also rearranges custom buttons, including with wireless off."
    : redux ? "Quick Actions is disabled. Redux's own Repel toggle remains available."
    : "Quick Actions is disabled. Saved Repel and button positions remain dormant."
    : "Native hooks match. PMC is the only dependency. This is a development build awaiting the full gameplay acceptance checklist.";
  return state;
}
function cloneInstallState(project: ProjectState): ProjectState {
  return { ...project, arm9: project.arm9.slice(),
    overlays: Object.fromEntries(Object.entries(project.overlays).map(([id, b]) => [id, b?.slice()])),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog) };
}
function stageArchive(project: ProjectState, rom: NintendoDSRom, bytes: Uint8Array) {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === manifest.archivePath.toLowerCase());
  const id = rom.filenames.idOf(manifest.archivePath);
  if (added) project.fileSystem!.additions![added] = bytes;
  else if (id !== undefined) {project.fileSystem ??= { replacements: {} };project.fileSystem.replacements[id] = bytes;}
  else addRomFile(project, manifest.archivePath, bytes);
}
function validateSystemShopResources(project: ProjectState, rom: NintendoDSRom): void {
  const archive = (path: string) => {
    const id = rom.filenames.idOf(path);
    if (id === undefined) throw new Error(`System Shop requires native archive ${path}.`);
    return new NARC(getRomFileBytes(project, rom, id));
  };
  const expected = manifest.shopScript;
  const script = archive(expected.archive).files[expected.member];
  if (!script || script.length !== expected.length || fingerprint(script) !== expected.fingerprint)
    throw new Error("The native shop script has unrecognized changes. Restore a compatible script, or remove System Shop before applying.");
  // Do not fingerprint authored stock or prices: native code reads both on
  // each opening. Reject truncated/invalid inventories before staging instead.
  const stock = archive(manifest.shopInventory.archive);
  const counts = archive(manifest.shopInventory.countsArchive).files[0];
  const items = archive("a/0/2/4");
  for (const row of new Set(manifest.shopInventory.badgeRows)) {
    const data = stock.files[row], count = counts?.[row];
    // Retail stores at most 45 item/price records before its UI fields.
    if (!count || count > 45 || !data || data.length !== count * 2)
      throw new Error(`System Shop general-store stock ${row} does not match its native item count.`);
    for (let i = 0; i < count; i++) {
      const item = readU16(data, i * 2);
      if (!item || !items.files[item]?.length)
        throw new Error(`System Shop general-store stock ${row} contains an invalid item (${item}).`);
    }
  }
}
export async function installCGearQuickActions(project: ProjectState, options:CGearQuickActionsOptions={}): Promise<CodeInjectionDllInstallResult> {
  if(project.session.baseRom==="BW")return installBw1CGear(project,options);
  const romBytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!romBytes) throw new Error("Reload the ROM before installing Quick Actions.");
  const input = { ...project, originalRomBytes: romBytes }, status = getCGearQuickActionsStatus(input);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  const redux = status.romProfile === "redux";
  if (redux) {
    const source = findReduxRepel(input, rom);
    if (!source || await hash(source.bytes) !== reduxManifest.repelModule.sha256) throw new Error("The Redux repel runtime failed its integrity check.");
  }
  hydrateCGearButtons(project,rom);
  hydrateSystemShops(project,rom);
  const state=structuredClone(ensureCGearButtons(project));
  if(options.pcHideFlag!==undefined){validatePCFlag(options.pcHideFlag);const pc=state.document.buttons.find(b=>b.action==="pc");if(pc)pc.flag={id:options.pcHideFlag,when:"clear"};}
  const before=JSON.stringify(project.cgearButtons?.document);
  state.applied=structuredClone(state.document);state.enabled=true;
  const compiled=compile(state.document,buttonAssets(project,rom),true,state);
  if(!compiled.archive)throw new Error(compiled.diagnostics.filter(d=>d.severity==="error").map(d=>d.message).join("\n"));
  if(state.document.buttons.some(b=>b.action==="systemShop"))ensureSystemShops(project);
  const shopsBefore=JSON.stringify(project.systemShops);
  if(state.document.buttons.some(b=>b.action==="pc")) {
    const p=redux ? reduxManifest.pcScript : manifest.pcScript,id=rom.filenames.idOf(p.archive);
    const script=id===undefined?undefined:new NARC(getRomFileBytes(project,rom,id)).files[p.member];
    if(!script || script.length!==p.length || fingerprint(script)!==p.fingerprint || (redux && await hash(script) !== reduxManifest.pcScript.sha256))
      throw new Error("The PC storage script has unrecognized changes. Restore a compatible native PC script, or remove PC from the button design before applying.");
  }
  if (state.document.buttons.some(b => b.action === "systemShop")) validateSystemShopResources(project, rom);
  const v = input.session.baseVersion as Version, profile: Profile = redux ? reduxManifest.games.W2 : manifest.games[v];
  const [dllResponse, archiveResponse] = await Promise.all([fetch(redux ? reduxUrl : urls[v]), fetch(graphicsUrl)]);
  if (!dllResponse.ok || !archiveResponse.ok) throw new Error("Could not load the bundled Quick Actions files.");
  const [dll, graphics] = await Promise.all([dllResponse.arrayBuffer().then(b => new Uint8Array(b)), archiveResponse.arrayBuffer().then(b => new Uint8Array(b))]);
  if (await hash(dll) !== profile.sha256)
    throw new Error(`Quick Actions bundle failed its integrity check: ${profile.fileName} does not match version ${manifest.version}. Restore or rebuild the bundled C-Gear files together.`);
  if (await hash(graphics) !== manifest.archiveSha256)
    throw new Error(`Quick Actions bundle failed its integrity check: cgearQuickActions.narc does not match version ${manifest.version}. Restore or rebuild the bundled C-Gear files together.`);
  if (!recognized(parseRpm(dll, { allowedMagics: ["DLXF"] }), v) || !archiveState(graphics))
    throw new Error("Quick Actions bundle failed its integrity check.");
  const staged = cloneInstallState(input);
  let shops = project.systemShops && structuredClone(project.systemShops);
  if (state.document.buttons.some(b => b.action === "systemShop") || shops) {
    shops ??= structuredClone(ensureSystemShops(project));
    if (options.applySystemShops) shops.applied=structuredClone(shops.document);
    stageSystemShops(staged,rom,shops);
  }
  if (state.document.buttons.some(b => b.action === "pokenav")) {
    staged.narcs = structuredClone(project.narcs); staged.texts = structuredClone(project.texts);
    await (await import("./pokenavModel")).stagePokenavRuntime(staged);
  }
  adoptExistingPmcInstall(staged, romBytes);
  if (!getPmcInstallStatus(staged).installed) installPmcBytes(staged, await loadBundledPmcBytes(v), romBytes);
  await installBundledBgmToggleDll(staged,{preserveShortcut:true});
  const result = stageCodeInjectionDll(staged, status.dllPath?.split("/").pop() ?? profile.fileName, dll, "patches", romBytes);
  const backup=new NARC(new NARC(compiled.archive).files[14]);
  const prior=bytesAt(input,rom,manifest.archivePath),priorArc=prior&&new NARC(prior);
  stageNativeButtonGraphics(staged,rom,backup,compiled.nativeGraphics!,true,priorArc?.files[14]?installedNativeButtonGraphics(prior!):undefined);
  stageArchive(staged, rom, compiled.archive);
  recordGenericChange(staged, "code_injection", `C-Gear Buttons applied: ${state.document.buttons.map(b=>b.label).join(", ") || "no buttons"}.`, "C-Gear Buttons", { key: "code-injection:cgear-quick-actions" });
  if(JSON.stringify(project.cgearButtons?.document)!==before)throw new Error("The button design changed while staging. Apply again.");
  if(JSON.stringify(project.systemShops)!==shopsBefore)throw new Error("The shop design changed while staging. Apply again.");
  project.cgearButtons=state;
  if(shops)project.systemShops=shops;
  Object.assign(project, { originalRomBytes: romBytes, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty,
    overlays: staged.overlays, narcs: staged.narcs, texts: staged.texts, fileSystem: staged.fileSystem, codeInjection: staged.codeInjection,
    patches: staged.patches, actionChangelog: staged.actionChangelog });
  return result;
}
export function disableCGearQuickActions(project: ProjectState): void {
  if(project.session.baseRom==="BW"){disableBw1CGear(project);return;}
  const status = getCGearQuickActionsStatus(project);
  if (!status.installed || !status.compatible || !project.originalRomBytes) throw new Error(status.message);
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  const prior=bytesAt(project,rom,manifest.archivePath)!;
  restoreNativeButtonGraphics(project,rom,prior);
  if([5,6,7].includes(readU16(new NARC(prior).files[0],4)))stageArchive(project,rom,disableButtonArchive(prior));
  else {const arc=new NARC(prior);writeU32(arc.files[0],8,0);writeU32(arc.files[0],12,0x41475143);stageArchive(project,rom,arc.save());}
  if(project.cgearButtons)project.cgearButtons.enabled=false;
  recordGenericChange(project, "code_injection", "C-Gear Quick Actions disabled; saved preferences remain dormant.", "C-Gear Quick Actions", { key: "code-injection:cgear-quick-actions" });
}
export function removeCGearQuickActions(project: ProjectState): void {
  if(project.session.baseRom==="BW"){removeBw1CGear(project);return;}
  const status = getCGearQuickActionsStatus(project);
  if (!status.canRemove || !status.dllPath) throw new Error("Only a Quick Actions runtime staged in this project can be removed. Use Disable for an exported installation.");
  if(project.originalRomBytes){const rom=new NintendoDSRom(project.originalRomBytes,{fileData:"view"}),prior=bytesAt(project,rom,manifest.archivePath);if(prior)restoreNativeButtonGraphics(project,rom,prior);}
  removeStagedCodeInjectionDll(project, status.dllPath);
  if(project.cgearButtons){project.cgearButtons.enabled=false;project.cgearButtons.applied=undefined;}
  if (project.fileSystem?.additions?.[manifest.archivePath]) delete project.fileSystem.additions[manifest.archivePath];
  recordGenericChange(project, "code_injection", "Staged C-Gear Quick Actions removed.", "C-Gear Quick Actions", { key: "code-injection:cgear-quick-actions" });
}
