import manifest from "../assets/codeinjection/battleTypeHudManifest.json";
import { readU32, writeU16 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes, replaceNarcFile } from "./fileSystemModel";
import { battleTypeHudPanelExpansion, transformBattleTypeHudPanel } from "./battleTypeHudResources";
import { loadActiveRomBytes } from "./persistence";
import { canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import { decompressNitro } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

type Version = "B2" | "W2";
type Component = "icons" | "moves";
export type TypeIconVariant = "letters" | "circular";
const URLS = {
  moves: { B2: new URL("../assets/codeinjection/MoveEffectivenessB2.dll", import.meta.url), W2: new URL("../assets/codeinjection/MoveEffectivenessW2.dll", import.meta.url) },
};
const ICON_URLS = {
  letters: { B2: new URL("../assets/codeinjection/TypeIconsB2.dll", import.meta.url), W2: new URL("../assets/codeinjection/TypeIconsW2.dll", import.meta.url) },
  circular: { B2: new URL("../assets/codeinjection/TypeIconsCircularB2.dll", import.meta.url), W2: new URL("../assets/codeinjection/TypeIconsCircularW2.dll", import.meta.url) },
};
const title = (kind: Component) => kind === "icons" ? "Type Icons" : "Move Effectiveness Preview";
const profileFor = (v: Version, kind: Component) => kind === "icons" ? manifest.games[v] : manifest.moveGames[v];
export const BATTLE_TYPE_HUD_VERSION = manifest.version;
export type MoveHighlightColors = { superEffective: string; notVeryEffective: string; immune: string };
export const DEFAULT_MOVE_HIGHLIGHT_COLORS: MoveHighlightColors = { superEffective: "#f7d051", notVeryEffective: "#9eadc0", immune: "#ff4242" };
const COLOR_KEYS = ["superEffective", "notVeryEffective", "immune"] as const;
export function moveHighlightRgb555(color: string): number {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new Error("Choose a valid six-digit highlight color.");
  const rgb = Number.parseInt(color.slice(1), 16);
  return ((rgb >>> 19) & 31) | (((rgb >>> 11) & 31) << 5) | (((rgb >>> 3) & 31) << 10);
}
function readColors(code: Uint8Array, offset: number): MoveHighlightColors {
  return Object.fromEntries(COLOR_KEYS.map((key, i) => {
    const value = code[offset + i * 2]! | code[offset + i * 2 + 1]! << 8;
    const rgb = [0, 5, 10].map(shift => { const c = (value >>> shift) & 31; return ((c << 3) | (c >>> 2)).toString(16).padStart(2, "0"); });
    return [key, `#${rgb.join("")}`];
  })) as MoveHighlightColors;
}
type ConfigurableBuild = { colorOffset?: number; bssSize?: number };
function matchesCode(rpm: RpmModule, build: ConfigurableBuild & { codeHex: string }): boolean {
  if (build.bssSize !== undefined && rpm.bssSize !== build.bssSize) return false;
  if (build.colorOffset === undefined) return hex(rpm.code) === build.codeHex;
  const offset = build.colorOffset;
  if (offset < 0 || offset + 6 > rpm.code.length || COLOR_KEYS.some((_, i) => (rpm.code[offset + i * 2 + 1]! & 0x80) !== 0)) return false;
  // Only the six RGB555 bytes may differ. Instructions and relocation sources
  // remain subject to the same exact verification as the bundled build.
  const code = hex(rpm.code);
  return code.length === build.codeHex.length && code.slice(0, offset * 2) === build.codeHex.slice(0, offset * 2)
    && code.slice((offset + 6) * 2) === build.codeHex.slice((offset + 6) * 2);
}
export type BattleTypeHudStatus = { supported: boolean; compatible: boolean; checked: boolean; installed: boolean;
  updateAvailable: boolean; canUninstall: boolean; pmcInstalled: boolean; message: string; dllPath?: string; legacyCombined?: boolean;
  colors?: MoveHighlightColors; iconVariant?: TypeIconVariant };
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const hash = async (bytes: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
function hookSize(rpm: RpmModule, r: RpmModule["relocations"][number]) {
  return r.target.type === "FULL_COPY" ? rpm.symbols[r.sourceSymbolIndex]?.size ?? 0
    : ["OFFSET", "OFFSET_REL31", "THUMB_BRANCH_LINK", "ARM_BRANCH_LINK", "ARM_BRANCH"].includes(r.target.type) ? 4 : 32;
}
function knownBuild(rpm: RpmModule, version: Version, kind: Component): string | undefined {
  if (rpm.metadata.PMCGameID !== version || rpm.symbols.some(s => s.attributes & 2)) return;
  const builds = profileFor(version, kind).builds;
  return Object.entries(builds).find(([v, build]) => rpm.metadata.PMCVersion === v && matchesCode(rpm, build)
    && rpm.relocations.length === build.relocations.length && build.relocations.every(r => rpm.relocations.filter(actual => {
      const symbol = rpm.symbols[actual.sourceSymbolIndex]; const expected = build.symbols[r.symbol];
      return actual.target.module === r.module && actual.target.address === r.address && actual.target.type === r.type
        && symbol?.address === expected?.address && symbol?.type === expected?.type && symbol?.attributes === expected?.attributes;
    }).length === 1))?.[0];
}
function iconVariantForBuild(version: Version, build: string): TypeIconVariant | undefined {
  const variants = manifest.games[version].variants;
  const current = (Object.entries(variants) as [TypeIconVariant, { version: string }][]).find(([, value]) => value.version === build)?.[0];
  if (current) return current;
  const historical = /^0\.3\.(\d+)$/u.exec(build);
  if (historical) return Number(historical[1]) <= 11 ? "circular" : "letters";
  return build === "0.1.0" || build === "0.2.0" ? "circular" : undefined;
}
function getStatus(project: ProjectState, kind: Component, bytes = project.originalRomBytes): BattleTypeHudStatus {
  const status: BattleTypeHudStatus = { supported: false, compatible: false, checked: false, installed: false,
    updateAvailable: false, canUninstall: false, pmcInstalled: getPmcInstallStatus(project).installed,
    message: "Battle HUD supports English Black 2 (IREO) and White 2 (IRDO)." };
  const v = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (v !== "B2" && v !== "W2")) return status;
  const profile = profileFor(v, kind); let rom: NintendoDSRom | undefined;
  try { if (bytes) rom = new NintendoDSRom(bytes); } catch { return { ...status, message: "Reload the ROM to check Battle HUD compatibility." }; }
  if ((rom?.idCode ?? project.romInfo.idCode) !== profile.rom_code) return status;
  status.supported = true;
  for (const entry of listCodeInjectionDlls(project)) {
    const added = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === entry.path.toLowerCase());
    const id = rom?.filenames.idOf(entry.path);
    const data = added ? project.fileSystem!.additions![added] : rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined;
    if (!data) return { ...status, message: `Reload the ROM to inspect ${entry.path}.` };
    let rpm: RpmModule;
    try { rpm = parseRpm(data, { allowedMagics: ["DLXF"] }); }
    catch { return { ...status, message: `Cannot check Battle HUD hook compatibility with ${entry.path}.` }; }
    const iconBuild = knownBuild(rpm, v, "icons");
    const moveBuild = knownBuild(rpm, v, "moves");
    const build = kind === "icons" ? iconBuild : moveBuild ?? (iconBuild === "0.2.0" ? iconBuild : undefined);
    if (build) {
      if (status.installed) return { ...status, message: "Multiple Battle HUD DLLs are present. Remove the duplicate before installing." };
      status.installed = true; status.dllPath = entry.path; status.legacyCombined = iconBuild === "0.2.0";
      if (kind === "icons" && iconBuild) status.iconVariant = iconVariantForBuild(v, iconBuild);
      status.updateAvailable = kind === "icons"
        ? !Object.values(manifest.games[v].variants).some(variant => variant.version === build)
        : build !== profile.version;
      status.canUninstall = !status.legacyCombined && canRemoveStagedCodeInjectionDll(project, entry.path);
      if (kind === "moves" && moveBuild) {
        const installed = (manifest.moveGames[v].builds as Record<string, ConfigurableBuild>)[moveBuild];
        if (installed?.colorOffset !== undefined) status.colors = readColors(rpm.code, installed.colorOffset);
      }
      continue;
    }
    if (iconBuild || moveBuild) continue; // Independently installed companion has disjoint hooks.
    if (/^(?:BattleTypeHud|TypeIcons|MoveEffectiveness)(?:B2|W2)(?:\.debug)?\.dll$/iu.test(entry.fileName)) return { ...status, message: `Unrecognized Battle HUD build: ${entry.path}.` };
    if (rpm.relocations.some(r => r.target.module !== "base" && profile.hooks.some(h => r.target.module === "168"
      && r.target.address < h.address + 4 && r.target.address + hookSize(rpm, r) > h.address))) {
      return { ...status, message: `Battle HUD conflicts with ${entry.path}. A required battle hook is already claimed.` };
    }
  }
  if (rom) {
    status.checked = true;
    try {
      const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_id, fileId) => getRomFileBytes(project, rom!, fileId), new Set([167, 168]));
      const checks = [...profile.signatures, ...profile.hooks.map(h => ({ ...h, segment: 168 }))];
      for (const s of checks) {
        const overlay = overlays.get(s.segment);
        const base = s.segment === 0 ? rom.arm9RamAddress : overlay?.ramAddress ?? 0;
        const offset = s.address - base;
        const candidates = s.segment === 0 ? [decompressCode(rom.arm9), project.arm9]
          : [overlay?.data, project.overlays[s.segment] ?? overlay?.data];
        if (candidates.some(data => !data || offset < 0 || hex(data.subarray(offset, offset + s.bytes.length / 2)) !== s.bytes)) {
          return { ...status, message: `Battle HUD compatibility failed at ${s.name}, 0x${s.address.toString(16)}.` };
        }
      }
    } catch { return { ...status, message: "Could not read the battle code for compatibility checks." }; }
  }
  status.compatible = true;
  status.message = status.legacyCombined ? `The combined patch is installed. Replace it with ${title(kind)} only, then install the other patch separately if wanted.`
    : status.updateAvailable ? `A ${title(kind)} update is available.`
    : status.installed ? kind === "icons" && status.iconVariant
      ? `${title(kind)} (${manifest.games[v].variants[status.iconVariant].label}) is installed.`
      : `${title(kind)} is installed.`
      : `${title(kind)} installs independently. PMC is installed automatically if needed.`;
  return status;
}
async function installHud(project: ProjectState, kind: Component, colors?: MoveHighlightColors, iconVariant: TypeIconVariant = "letters") {
  const chosenColors = colors ? COLOR_KEYS.map(key => moveHighlightRgb555(colors[key])) : undefined;
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("Reload the ROM before installing Battle HUD.");
  const status = getStatus(project, kind, bytes);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const v = project.session.baseVersion as Version; const profile = profileFor(v, kind);
  const panelEdits: { fileId: number; member: number; bytes: Uint8Array }[] = [];
  // Check native assets and the new DLL before staging PMC or changing files.
  if (Object.keys(profile.resources).length) {
    const rom = new NintendoDSRom(bytes); const id = rom.filenames.idOf("a/0/1/1");
    if (id === undefined) throw new Error("Battle graphics archive is missing.");
    const archive = new NARC(getRomFileBytes(project, rom, id));
    for (const [member, expected] of Object.entries(profile.resources)) {
      const packed = archive.files[Number(member)];
      if (!packed) throw new Error(`Unsupported Battle HUD graphics/palette member ${member}.`);
      const raw = packed[0] === 0x10 || packed[0] === 0x11 ? decompressNitro(packed) : packed;
      const digest = await hash(raw);
      const key = member as keyof typeof battleTypeHudPanelExpansion;
      const expansion = battleTypeHudPanelExpansion[key];
      if (digest !== expected && digest !== expansion?.patchedSha256 && !expansion?.previous.some(v => v.patchedSha256 === digest)) throw new Error(`Unsupported Battle HUD graphics/palette member ${member}.`);
      if (expansion && digest !== expansion.patchedSha256) {
        const expanded = transformBattleTypeHudPanel(raw, key);
        if (await hash(expanded) !== expansion.patchedSha256) throw new Error(`Type Icons panel expansion failed verification for member ${member}.`);
        panelEdits.push({ fileId: id, member: Number(member), bytes: expanded });
      }
    }
  }
  if (await hash(bytes) === "8279bed45bde3d0f9e0309d29d4246fd695a5c5d6fa55346c401c0bbc7043b50") {
    throw new Error("This Cascade build has insufficient PMC space. Use a non-Cascade ROM or the creator's optimized build.");
  }
  const response = await fetch(kind === "icons" ? ICON_URLS[iconVariant][v] : URLS.moves[v]);
  if (!response.ok) throw new Error(`Could not load Battle HUD (${response.status}).`);
  const dll = new Uint8Array(await response.arrayBuffer());
  const expectedVersion = kind === "icons" ? manifest.games[v].variants[iconVariant].version : profile.version;
  const expectedHash = kind === "icons" ? manifest.games[v].variants[iconVariant].dllSha256 : profile.dllSha256;
  if (await hash(dll) !== expectedHash || knownBuild(parseRpm(dll, { allowedMagics: ["DLXF"] }), v, kind) !== expectedVersion) throw new Error("The bundled Battle HUD DLL failed verification.");
  if (kind === "moves") {
    const build = (profile.builds as Record<string, ConfigurableBuild>)[profile.version];
    if (build?.colorOffset === undefined) throw new Error("This move-preview build has no verified color table.");
    const selected = chosenColors ?? COLOR_KEYS.map(key => moveHighlightRgb555((status.colors ?? DEFAULT_MOVE_HIGHLIGHT_COLORS)[key]));
    const header = readU32(dll, 8), info = header + readU32(dll, header + 8);
    const offset = readU32(dll, info + 16) + build.colorOffset;
    selected.forEach((color, i) => writeU16(dll, offset + i * 2, color));
    if (knownBuild(parseRpm(dll, { allowedMagics: ["DLXF"] }), v, kind) !== profile.version) throw new Error("The customized move-preview DLL failed verification.");
  }
  project.originalRomBytes ??= bytes;
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const name = status.dllPath?.split("/").pop() ?? `${kind === "icons" ? "TypeIcons" : "MoveEffectiveness"}${v}.dll`;
  const result = stageCodeInjectionDll(project, name, dll, "patches", bytes);
  const rom = new NintendoDSRom(bytes);
  for (const edit of panelEdits) replaceNarcFile(project, rom, edit.fileId, edit.member, edit.bytes);
  const detail = kind === "icons" ? ` (${manifest.games[v].variants[iconVariant].label})` : "";
  recordGenericChange(project, "code_injection", `${title(kind)}${detail} installed.`, title(kind), { key: `code-injection:${kind}` });
  return result;
}
function uninstallHud(project: ProjectState, kind: Component): void {
  const status = getStatus(project, kind);
  if (!status.canUninstall || !status.dllPath) throw new Error("Only a Battle HUD DLL staged in this project can be removed.");
  // Prepare restoration first, so a modified extension cannot leave a partial
  // uninstall. Other members of the battle archive are preserved.
  const restored: { member: number; bytes: Uint8Array }[] = [];
  const rom = kind === "icons" && project.originalRomBytes ? new NintendoDSRom(project.originalRomBytes) : undefined;
  const fileId = rom?.filenames.idOf("a/0/1/1");
  if (rom && fileId !== undefined) {
    const archive = new NARC(getRomFileBytes(project, rom, fileId));
    for (const member of Object.keys(battleTypeHudPanelExpansion) as (keyof typeof battleTypeHudPanelExpansion)[]) {
      const packed = archive.files[Number(member)];
      if (!packed) continue;
      const raw = packed[0] === 0x10 || packed[0] === 0x11 ? decompressNitro(packed) : packed;
      // Original resources require no restoration (including earlier DLLs).
      const changed = battleTypeHudPanelExpansion[member].edits[0]!;
      if (hex(raw.subarray(changed.offset, changed.offset + changed.new.length / 2)) !== changed.new) continue;
      restored.push({ member: Number(member), bytes: transformBattleTypeHudPanel(raw, member, true) });
    }
  }
  removeStagedCodeInjectionDll(project, status.dllPath);
  if (rom && fileId !== undefined) for (const edit of restored) replaceNarcFile(project, rom, fileId, edit.member, edit.bytes);
  recordGenericChange(project, "code_injection", `Staged ${title(kind)} DLL removed.`, title(kind), { key: `code-injection:${kind}` });
}

export const getBattleTypeHudStatus = (project: ProjectState, bytes = project.originalRomBytes) => getStatus(project, "icons", bytes);
export const getMoveEffectivenessStatus = (project: ProjectState, bytes = project.originalRomBytes) => getStatus(project, "moves", bytes);
export const installBattleTypeHud = (project: ProjectState, variant: TypeIconVariant = "letters") => installHud(project, "icons", undefined, variant);
export const installMoveEffectiveness = (project: ProjectState, colors?: MoveHighlightColors) => installHud(project, "moves", colors);
export const uninstallBattleTypeHud = (project: ProjectState) => uninstallHud(project, "icons");
export const uninstallMoveEffectiveness = (project: ProjectState) => uninstallHud(project, "moves");
