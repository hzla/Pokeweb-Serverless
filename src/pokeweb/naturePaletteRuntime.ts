import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { BW2_NARCS } from "./constants";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { listCodeInjectionDlls, stageCodeInjectionDll, removeStagedCodeInjectionDll, canRemoveStagedCodeInjectionDll } from "./pmcModel";
import { naturePalettesSupported, getNaturePaletteRecords } from "./naturePaletteModel";
import { parseRpm, type RpmModule } from "./rpm";
import type { ProjectState } from "./projectStore";
import { recordGenericChange } from "./actionChangelog";
import white2 from "../assets/codeinjection/naturePalettesW2Manifest.json";
import black2 from "../assets/codeinjection/naturePalettesB2Manifest.json";
import pwanManifest from "../assets/codeinjection/pwan-runtime-manifest.json";

type Game = "W2" | "B2";
type Scene = "battle" | "summary";
type Mode = "native" | "pwan";
const profiles = { W2: white2, B2: black2 };
type Artifact = Pick<typeof white2.artifacts["battle-native"], "codeHex" | "bss" | "relocations">;
const urls = {
  W2: {
    "battle-native": new URL("../assets/codeinjection/NaturePalettesBattleW2.dll", import.meta.url),
    "summary-native": new URL("../assets/codeinjection/NaturePalettesSummaryW2.dll", import.meta.url),
    "battle-pwan": new URL("../assets/codeinjection/NaturePwanBattleW2.dll", import.meta.url),
    "summary-pwan": new URL("../assets/codeinjection/NaturePwanSummaryW2.dll", import.meta.url),
  },
  B2: {
    "battle-native": new URL("../assets/codeinjection/NaturePalettesBattleB2.dll", import.meta.url),
    "summary-native": new URL("../assets/codeinjection/NaturePalettesSummaryB2.dll", import.meta.url),
    "battle-pwan": new URL("../assets/codeinjection/NaturePwanBattleB2.dll", import.meta.url),
    "summary-pwan": new URL("../assets/codeinjection/NaturePwanSummaryB2.dll", import.meta.url),
  },
};
const normalPwanUrls = {
  W2: { battle: new URL("../assets/codeinjection/PokewebPwanBattleW2.dll", import.meta.url), summary: new URL("../assets/codeinjection/PokewebPwanSummaryW2.dll", import.meta.url) },
  B2: { battle: new URL("../assets/codeinjection/PokewebPwanBattleB2.dll", import.meta.url), summary: new URL("../assets/codeinjection/PokewebPwanSummaryB2.dll", import.meta.url) },
};
const gameOf = (p: ProjectState): Game => {
  const game = p.session.baseVersion;
  if (game !== "B2" && game !== "W2") throw new Error("Nature palettes support US retail Black 2 and White 2.");
  return game;
};
const filename = (game: Game, scene: Scene, mode: Mode) => mode === "native" ? `NaturePalettes${scene === "battle" ? "Battle" : "Summary"}${game}.dll` : `PokewebPwan${scene === "battle" ? "Battle" : "Summary"}${game}.dll`;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const sourceCache = new WeakMap<ProjectState, { files: Map<string, { id: number; bytes: Uint8Array }>; valid: boolean; error?: string }>();
const roms = new WeakMap<Uint8Array, NintendoDSRom>();
function romFor(project: ProjectState): NintendoDSRom | undefined {
  if (!project.originalRomBytes) return undefined;
  let rom = roms.get(project.originalRomBytes);
  if (!rom) { rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); roms.set(project.originalRomBytes, rom); }
  return rom;
}
function bytesFor(project: ProjectState, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const rom = romFor(project), id = rom?.filenames.idOf(path);
  if (rom && id !== undefined) return project.fileSystem?.tombstones?.[id] ? undefined : getRomFileBytes(project, rom, id);
  const cached = sourceCache.get(project)?.files.get(path.toLowerCase());
  return cached && !project.fileSystem?.tombstones?.[cached.id] ? project.fileSystem?.replacements?.[cached.id] ?? cached.bytes : undefined;
}
function verifyBindings(project: ProjectState, rom: NintendoDSRom): void {
  const profile = profiles[gameOf(project)];
  if (rom.idCode !== profile.idCode || rom.data[0x1e] !== 0) throw new Error("Unrecognized nature palette ROM profile.");
  const personalPath = BW2_NARCS.find(n => n.name === "personal")!.path;
  const personalId = rom.filenames.idOf(personalPath);
  if (personalId === undefined || new NARC(getRomFileBytes(project, rom, personalId)).files.length > 1024) throw new Error("Expanded upgrade ROMs need separate nature palette bindings.");
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable, (_, id) => getRomFileBytes(project, rom, id), new Set([167,168,207]));
  for (const s of profile.signatures) {
    const overlay = overlays.get(Number(s.module));
    const base = s.module === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress;
    const candidates = s.module === "ARM9" ? [project.arm9] : [overlay?.data, project.overlays[Number(s.module)] ?? overlay?.data];
    const at = base === undefined ? -1 : s.address - base;
    if (candidates.some(data => !data || at < 0 || hex(data.subarray(at, at + s.expectedHex.length / 2)) !== s.expectedHex)) throw new Error(`Nature palettes: unrecognized ${s.module} interface at 0x${s.address.toString(16)}.`);
  }
}
export function hydrateNaturePaletteRuntime(project: ProjectState, rom: NintendoDSRom): void {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return;
  const files = new Map<string, { id: number; bytes: Uint8Array }>();
  for (const m of listCodeInjectionDlls(project)) {
    if (!/^(NaturePalettes|PokewebPwan)/iu.test(m.fileName)) continue;
    const id = rom.filenames.idOf(m.path);
    if (id !== undefined) files.set(m.path.toLowerCase(), { id, bytes: rom.files[id].slice() });
  }
  try { verifyBindings(project, rom); sourceCache.set(project, { files, valid: true }); }
  catch (error) { sourceCache.set(project, { files, valid: false, error: String(error) }); }
}
function matches(rpm: RpmModule, artifact: Artifact): boolean {
  if (rpm.baseAddress !== 0 || rpm.bssSize !== artifact.bss || hex(rpm.code) !== artifact.codeHex || rpm.symbols.some(s => s.attributes & 2)) return false;
  const rel = rpm.relocations.map(({ target: t, sourceSymbolIndex: i }) => {
    const s = rpm.symbols[i]; return `${t.module}:${t.address}:${t.type}:${s.address}:${s.type}:${s.attributes}:${s.size}`;
  }).sort();
  return JSON.stringify(rel) === JSON.stringify(artifact.relocations);
}
function knownNature(rpm: RpmModule, game: Game): boolean {
  const scene = rpm.metadata.PWNatureScene, mode = rpm.metadata.PWNatureMode;
  if ((scene !== "battle" && scene !== "summary") || (mode !== "native" && mode !== "pwan")) return false;
  return rpm.metadata.PMCGameID === game && rpm.metadata.PMCVersion === profiles[game].version && Number(rpm.metadata.PWNaturePalettes) === 1
    && matches(rpm, profiles[game].artifacts[`${scene}-${mode}`]);
}
function natureModules(project: ProjectState) {
  return listCodeInjectionDlls(project).flatMap(m => {
    const data = bytesFor(project, m.path);
    try { const rpm = data && parseRpm(data, { allowedMagics: ["DLXF"] }); return rpm && Number(rpm.metadata.PWNaturePalettes) === 1 ? [{ ...m, rpm }] : []; }
    catch { return []; }
  });
}
export function isNaturePaletteRuntimeInstalled(project: ProjectState): boolean {
  const modules = natureModules(project);
  return ["battle", "summary"].every(scene => modules.some(m => m.rpm.metadata.PWNatureScene === scene));
}
export function naturePalettePwanInstalled(project: ProjectState): boolean {
  const game = gameOf(project), paths = new Set(listCodeInjectionDlls(project).map(m => m.path.toLowerCase()));
  return ["Battle", "Summary", "Misc"].every(scene => paths.has(`patches/pokewebpwan${scene}${game}.dll`.toLowerCase()));
}
export function getNaturePaletteRuntimeStatus(project: ProjectState) {
  const result = { supported: naturePalettesSupported(project), compatible: false, installed: false, message: "US revision-0 retail Black 2 / White 2 required." };
  if (!result.supported) return result;
  try {
    const game = gameOf(project), profile = profiles[game];
    getNaturePaletteRecords(project);
    const installedPaths = new Set(listCodeInjectionDlls(project).map(m => m.path.toLowerCase()));
    const pwanParts = ["Battle", "Summary", "Misc"].filter(scene => installedPaths.has(`patches/pokewebpwan${scene}${game}.dll`.toLowerCase())).length;
    if (pwanParts && pwanParts !== 3) throw new Error("Incomplete PWAN runtime. Reinstall PWAN before installing nature palettes.");
    const modules = natureModules(project);
    for (const m of modules) if (!knownNature(m.rpm, game)) throw new Error(`Unrecognized nature palette module: ${m.path}.`);
    result.installed = isNaturePaletteRuntimeInstalled(project);
    if (modules.length && (!result.installed || modules.length !== 2)) throw new Error("Incomplete or duplicate nature palette modules.");
    const rom = romFor(project);
    if (rom) verifyBindings(project, rom);
    else if (!sourceCache.get(project)?.valid) throw new Error(sourceCache.get(project)?.error ?? "Reload the ROM to verify palette interfaces.");
    const mode = naturePalettePwanInstalled(project) ? "pwan" : "native";
    const hooks = (["battle", "summary"] as const).flatMap(scene => profile.artifacts[`${scene}-${mode}`].hooks);
    for (const m of listCodeInjectionDlls(project)) {
      const data = bytesFor(project, m.path);
      let rpm: RpmModule | undefined;
      try { if (data) rpm = parseRpm(data, { allowedMagics: ["DLXF"] }); } catch { /* Reserved filenames still conflict below. */ }
      if (rpm && knownNature(rpm, game)) {
        const scene = rpm.metadata.PWNatureScene as Scene, candidateMode = rpm.metadata.PWNatureMode as Mode;
        if (m.target !== "patches" || m.fileName !== filename(game, scene, candidateMode)) throw new Error("Restore standard nature palette module filenames.");
        continue;
      }
      if (/^Nature(Palettes|Pwan)/iu.test(m.fileName)) throw new Error(`Conflicting nature palette module: ${m.path}.`);
      // Exact bundled PWAN bytes are checked before any replacement is staged.
      if ((["battle","summary"] as const).some(scene => m.fileName === filename(game,scene,"pwan"))) continue;
      if (!rpm) continue;
      if (rpm.relocations.some(({ target: t, sourceSymbolIndex: i }) => {
        const size = t.type === "FULL_COPY" ? rpm!.symbols[i]?.size ?? 0 : t.type === "THUMB_BRANCH_SAFESTACK" ? 16 : t.type === "THUMB_BRANCH" ? 12 : 4;
        return hooks.some(h => h.module === t.module && t.address < h.address + 4 && t.address + size > h.address);
      })) throw new Error(`Conflicting palette hook: ${m.path}.`);
    }
    result.compatible = true;
    result.message = result.installed ? "Installed" : "Ready";
  } catch (error) { result.message = error instanceof Error ? error.message : String(error); }
  return result;
}
async function sha256(bytes: Uint8Array): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))); }
async function load(url: URL, expected: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load nature palette runtime (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== expected) throw new Error("Runtime integrity check failed.");
  return bytes;
}
/** Remove a verified module without renumbering other NitroFS file IDs. */
export function removeNatureManagedModule(project: ProjectState, path: string): void {
  if (canRemoveStagedCodeInjectionDll(project, path)) { removeStagedCodeInjectionDll(project, path); return; }
  const rom = romFor(project), id = rom?.filenames.idOf(path);
  if (id === undefined) throw new Error("Reload the ROM before removing this module.");
  setRomFileReplacement(project, id, new Uint8Array());
  project.fileSystem!.tombstones ??= {};
  project.fileSystem!.tombstones[id] = path;
  if (project.codeInjection?.modules) project.codeInjection.modules = project.codeInjection.modules.filter(m => m.path.toLowerCase() !== path.toLowerCase());
}
async function verifyOrdinaryPwan(project: ProjectState, game: Game): Promise<void> {
  for (const scene of ["battle","summary"] as const) {
    const name = filename(game, scene, "pwan"), data = bytesFor(project, `patches/${name}`);
    if (!data) continue;
    const rpm = parseRpm(data, { allowedMagics: ["DLXF"] });
    if (knownNature(rpm, game)) continue;
    const normal = pwanManifest.artifacts[name as keyof typeof pwanManifest.artifacts];
    if (!normal || await sha256(data) !== normal.sha256) throw new Error(`Unrecognized PWAN runtime: ${name}.`);
  }
}
/** Called inside the caller's existing code-injection transaction. */
export async function stageNaturePaletteRuntime(project: ProjectState, withPwan: boolean): Promise<void> {
  const status = getNaturePaletteRuntimeStatus(project);
  if (!status.compatible) throw new Error(status.message);
  if (withPwan !== naturePalettePwanInstalled(project)) throw new Error("The requested palette renderer does not match the installed PWAN modules.");
  const game = gameOf(project), mode: Mode = withPwan ? "pwan" : "native";
  await verifyOrdinaryPwan(project, game);
  const candidates = await Promise.all((["battle","summary"] as const).map(async scene => {
    const key = `${scene}-${mode}` as const, artifact = profiles[game].artifacts[key];
    const bytes = await load(urls[game][key], artifact.sha256);
    if (!matches(parseRpm(bytes, { allowedMagics: ["DLXF"] }), artifact)) throw new Error("Invalid nature palette module.");
    return { scene, bytes };
  }));
  if (withPwan) for (const m of natureModules(project).filter(m => m.rpm.metadata.PWNatureMode === "native")) removeNatureManagedModule(project, m.path);
  for (const { scene, bytes } of candidates) stageCodeInjectionDll(project, filename(game,scene,mode), bytes, "patches");
}
export async function installNaturePaletteRuntime(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, async staged => {
    await stageNaturePaletteRuntime(staged, naturePalettePwanInstalled(staged));
    recordGenericChange(staged, "code_injection", "Installed nature palettes for battles and summary.", "Nature Palettes", { key: "nature-palettes-runtime" });
  });
}
export async function uninstallNaturePaletteRuntime(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, async staged => {
    const status = getNaturePaletteRuntimeStatus(staged);
    if (!status.compatible || !status.installed) throw new Error(status.message);
    const game = gameOf(staged), modules = natureModules(staged);
    const ordinary = await Promise.all(modules.filter(m => m.rpm.metadata.PWNatureMode === "pwan").map(async m => {
      const scene = m.rpm.metadata.PWNatureScene as Scene;
      const expected = pwanManifest.artifacts[m.fileName as keyof typeof pwanManifest.artifacts].sha256;
      return { name: m.fileName, bytes: await load(normalPwanUrls[game][scene], expected) };
    }));
    for (const m of modules.filter(m => m.rpm.metadata.PWNatureMode === "native")) removeNatureManagedModule(staged, m.path);
    for (const m of ordinary) stageCodeInjectionDll(staged, m.name, m.bytes, "patches");
    recordGenericChange(staged, "code_injection", "Removed nature palette runtime; authored palettes retained.", "Nature Palettes", { key: "nature-palettes-runtime" });
  });
}
export async function removePwanPreservingNature(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, async staged => {
    const status = getNaturePaletteRuntimeStatus(staged);
    if (!status.compatible || !status.installed) throw new Error(status.message);
    const game = gameOf(staged);
    await verifyOrdinaryPwan(staged, game);
    const misc = `PokewebPwanMisc${game}.dll`;
    const data = bytesFor(staged, `patches/${misc}`), expected = pwanManifest.artifacts[misc as keyof typeof pwanManifest.artifacts];
    if (!data || await sha256(data) !== expected.sha256) throw new Error("Unrecognized PWAN miscellaneous runtime.");
    for (const scene of ["Battle","Summary","Misc"]) removeNatureManagedModule(staged, `patches/PokewebPwan${scene}${game}.dll`);
    await stageNaturePaletteRuntime(staged, false);
    if (staged.pwanAnimations) staged.pwanAnimations.runtimeInstalled = false;
    recordGenericChange(staged, "code_injection", "Removed PWAN runtimes; native nature palettes and imported assets retained.", "PWAN Runtime", { key: "pwan-runtime" });
  });
}
