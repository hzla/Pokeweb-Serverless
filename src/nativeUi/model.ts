import { strFromU8, strToU8 } from "fflate";
import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NativeFont } from "../customUi/assets";
import type { ProjectState } from "../pokeweb/projectStore";
import { getRomFileBytes, ensureFileSystemState, replaceRomFile } from "../pokeweb/fileSystemModel";
import { activeRomMatchesProject, loadActiveRomBytes } from "../pokeweb/persistence";
import { getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { decodeGen5TextBank } from "../pokeweb/text";
import manifest from "../assets/codeinjection/uiScreensManifest.json";
import { defaults, validate, DIRECTIONS, type Design, type Project } from "./document";
import { compileGraphics, type Resources } from "./graphics";

export const GRAPHICS_PATH = "a/0/7/0", SOURCE_PATH = "a/pokeweb/ui-screens";
const DLLS = { B2: new URL("../assets/codeinjection/UiScreensB2.dll", import.meta.url), W2: new URL("../assets/codeinjection/UiScreensW2.dll", import.meta.url) };
export type Library = { rom: NintendoDSRom; bytes: Uint8Array; resources: Resources; state: Project; overlay: Uint8Array; version: "B2" | "W2" };
const equal = (a?: Uint8Array, b?: Uint8Array): boolean => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
export const designKey = (d: Design): string => JSON.stringify(d, (_, v) => ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v);
function decodeDesign(value: Design): Design {
  for (const image of Object.values(value.images ?? {})) image.pixels = new Uint8ClampedArray(image.pixels as unknown as number[]);
  const problems = validate(value); if (problems.length) throw new Error(problems[0]); return value;
}
function sourceMetadata(state: Project): Uint8Array {
  const arc = new NARC(); arc.files = [strToU8(JSON.stringify({ version: 1, baseline: state.baseline, applied: state.draft }, (_, v) => ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v)), state.source]; return arc.save();
}
function metadata(bytes: Uint8Array): Pick<Project, "source" | "baseline" | "applied"> {
  if (bytes.length > 2 * 1024 * 1024) throw new Error("UI screen authoring data exceeds its size limit.");
  const arc = new NARC(bytes), value = JSON.parse(strFromU8(arc.files[0]));
  if (value.version !== 1 || !arc.files[1] || arc.files[1].length > 1024 * 1024) throw new Error("Unsupported UI screen authoring data.");
  return { source: arc.files[1], baseline: decodeDesign(value.baseline), applied: decodeDesign(value.applied) };
}
export async function openMainMenu(project: ProjectState): Promise<Library> {
  if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect this project's source ROM to edit UI screens.");
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("Reconnect the source ROM to edit UI screens.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" }), version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2") || rom.idCode !== manifest.games[version].idCode || bytes[30] !== 0) throw new Error("UI screens support US Black 2 and White 2 revision 0.");
  const get = (path: string) => {
    const id = rom.filenames.idOf(path), added = project.fileSystem?.additions?.[path];
    if (added) return added;
    if (id === undefined) throw new Error(`Missing native menu resource: ${path}.`);
    return getRomFileBytes(project, rom, id);
  };
  const overlayInfo = rom.loadArm9Overlays([36]).get(36);
  if (!overlayInfo || overlayInfo.ramAddress !== manifest.games[version].base) throw new Error("Unsupported field-menu overlay layout.");
  const overlay = project.overlays[36] ?? overlayInfo.data;
  const profile = manifest.games[version];
  const arm = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
  for (const contract of [...profile.contracts, ...profile.hooks.map(h => ({ ...h, module: "36" }))]) {
    const data = contract.module === "ARM9" ? arm : overlay, base = contract.module === "ARM9" ? rom.arm9RamAddress : profile.base;
    const expected = Uint8Array.from(contract.expectedHex.match(/../g)!.map(h => parseInt(h, 16)));
    if (!equal(data.subarray(contract.address - base, contract.address - base + expected.length), expected)) throw new Error(`The native menu contract at 0x${contract.address.toString(16)} has conflicting changes.`);
  }
  if (!project.uiScreens) {
    const id = rom.filenames.idOf(SOURCE_PATH), stored = project.fileSystem?.additions?.[SOURCE_PATH] ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id));
    const saved = stored ? metadata(stored) : { source: new Uint8Array(get(GRAPHICS_PATH)), baseline: defaults(), applied: defaults() };
    project.uiScreens = { version: 1, ...saved, draft: structuredClone(saved.applied) };
  }
  const state = project.uiScreens, files = new NARC(state.source).files;
  if (files.length < 43 || files.slice(0, 43).some(b => !b.length)) throw new Error("Native menu graphics are incomplete.");
  const fonts = new NARC(get("a/0/2/3")).files, messages = new NARC(get("a/0/0/2")).files;
  const bank = decodeGen5TextBank(messages[38]).map(e => e[1]);
  return { rom, bytes, version, overlay, state, resources: { files, game: version, font: new NativeFont(fonts[0]), hudFont: new NativeFont(fonts[1]), labels: ["", bank[2], bank[1], bank[3], "Player", bank[5], bank[6]] } };
}
export function validateMainMenu(library: Library, design: Design): string[] {
  const errors = validate(design);
  for (const b of design.buttons) if (b.label !== undefined) {
    let width = 0;
    for (const c of b.label) { const glyph = library.resources.font.glyph(c); if (!glyph) errors.push(`${b.label}: the ROM font has no glyph for ${c}.`); else width += glyph.advance; }
    if (width > 64) errors.push(`${b.label}: label exceeds the native 64-pixel text window.`);
  }
  if (!errors.length) try { compileGraphics(library.resources.files, design, library.version); } catch (e) { errors.push(String(e instanceof Error ? e.message : e)); }
  return errors;
}
function configAt(code: Uint8Array): number {
  let found = -1;
  for (let i = 0; i + 420 <= code.length; i += 4) if (readU32(code, i) === 0x49555750 && readU16(code, i + 4) === 1 && readU16(code, i + 6) === 420) {
    if (found >= 0) throw new Error("Ambiguous UI companion configuration."); found = i;
  }
  if (found < 0) throw new Error("UI companion configuration is missing."); return found;
}
export function configureCompanion(bytes: Uint8Array, design: Design): Uint8Array {
  const problems = validate(design); if (problems.length) throw new Error(problems[0]);
  const module = parseRpm(new Uint8Array(bytes), { allowedMagics: ["DLXF"] }), at = configAt(module.code);
  writeU32(module.code, at + 8, needsCompanion(design) ? 1 : 0);
  for (const b of design.buttons) {
    const start = at + 12 + (b.id - 1) * 68;
    module.code.set([b.id, b.x + 64, b.y + 20, b.iconX, b.iconY, b.labelX / 8, b.labelY / 8, Number(b.label !== undefined), b.touch.y, b.touch.y + b.touch.height, b.touch.x, b.touch.x + b.touch.width, ...DIRECTIONS.map(d => b.neighbors[d] ?? 0)], start);
    for (let i = 0; i < 25; i++) writeU16(module.code, start + 16 + i * 2, b.label !== undefined && i < b.label.length ? b.label.charCodeAt(i) : 0xffff);
  }
  return writeRpm(module, { ident: "DLXF" });
}
export function needsCompanion(design: Design): boolean {
  return JSON.stringify(design.buttons) !== JSON.stringify(defaults().buttons);
}
function assertNoHookConflicts(project: ProjectState, version: "B2" | "W2", rom: NintendoDSRom): void {
  const profile = manifest.games[version], ranges = [...profile.hooks.map(h => ({ start: h.address, length: 4 })),
    ...profile.contracts.filter(c => c.module === "36").map(c => ({ start: c.address, length: c.expectedHex.length / 2 })), { start: profile.specialMapAddress, length: 4 }];
  for (const module of listCodeInjectionDlls(project)) {
    if (module.path.toLowerCase() === `patches/uiscreens${version.toLowerCase()}.dll`) continue;
    let rpm; try { const id = rom.filenames.idOf(module.path); const bytes = project.fileSystem?.additions?.[module.path] ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id)); if (!bytes) continue; rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    for (const relocation of rpm.relocations) if (relocation.target.module === "36") {
      const start = relocation.target.address & ~1, length = relocation.target.type === "FULL_COPY" ? rpm.symbols[relocation.sourceSymbolIndex]?.size ?? 4 : 4;
      if (ranges.some(r => start < r.start + r.length && start + length > r.start)) throw new Error(`${module.fileName} already owns a main-menu hook.`);
    }
  }
}
export async function applyMainMenu(project: ProjectState, library: Library, signal?: AbortSignal): Promise<{ changed: boolean; quantized: boolean }> {
  const design = structuredClone(library.state.draft), key = designKey(design), problems = validateMainMenu(library, design);
  if (problems.length) throw new Error(problems[0]);
  if (key === designKey(library.state.applied)) return { changed: false, quantized: false };
  // Recheck the live project contracts and resource ownership before publishing any writes.
  const currentLibrary = await openMainMenu(project);
  if (currentLibrary.bytes !== library.bytes && !equal(currentLibrary.bytes, library.bytes)) throw new Error("The source ROM changed. Reopen UI screens before applying.");
  assertNoHookConflicts(project, library.version, library.rom);
  const previous = compileGraphics(library.resources.files, library.state.applied, library.version), next = compileGraphics(library.resources.files, design, library.version);
  const current = new NARC(getRomFileBytes(project, library.rom, library.rom.fileId(GRAPHICS_PATH)));
  for (let i = 0; i < Math.max(previous.files.length, next.files.length); i++) {
    if (equal(previous.files[i], next.files[i])) continue;
    if (previous.files[i] && !equal(previous.files[i], current.files[i])) throw new Error(`Menu graphics member ${i} changed outside this editor. Reopen the project before applying.`);
    if (!previous.files[i] && current.files[i]?.length && !equal(current.files[i], next.files[i])) throw new Error(`Menu graphics member ${i} is already occupied.`);
    if (next.files[i]) current.files[i] = next.files[i];
    else if (i === current.files.length - 1) current.files.pop();
    else current.files[i] = new Uint8Array();
  }
  const draft: ProjectState = structuredClone({ ...project, originalRomBytes: undefined }); draft.originalRomBytes = library.bytes;
  const modulePath = `patches/UiScreens${library.version}.dll`, existingId = library.rom.filenames.idOf(modulePath);
  const existing = draft.fileSystem?.additions?.[modulePath] ?? (existingId === undefined ? undefined : getRomFileBytes(draft, library.rom, existingId));
  if (needsCompanion(design) || existing) {
    if (!getPmcInstallStatus(draft).installed) await installBundledPmc(draft);
    const response = await fetch(DLLS[library.version]); if (!response.ok) throw new Error("The native UI companion could not be loaded.");
    const template = new Uint8Array(await response.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", template.slice().buffer))].map(n => n.toString(16).padStart(2, "0")).join("");
    if (digest !== manifest.games[library.version].sha256) throw new Error("The bundled UI companion failed its integrity check.");
    if (existing) {
      const before = parseRpm(existing, { allowedMagics: ["DLXF"] }), clean = parseRpm(template, { allowedMagics: ["DLXF"] }), at = configAt(clean.code);
      if (configAt(before.code) !== at || before.bssSize !== clean.bssSize || before.code.length !== clean.code.length ||
          JSON.stringify(before.relocations) !== JSON.stringify(clean.relocations) || before.code.some((v, i) => (i < at + 8 || i >= at + 420) && v !== clean.code[i])) throw new Error("The installed UI companion has unrecognized changes.");
    }
    stageCodeInjectionDll(draft, `UiScreens${library.version}.dll`, configureCompanion(template, design), "patches", library.bytes);
  }
  const profile = manifest.games[library.version], offset = profile.specialMapAddress - profile.base;
  const value = readU32(currentLibrary.overlay, offset), copy = library.resources.files.length;
  if (value !== 18 && value !== copy) throw new Error("The special-menu background mapping has conflicting changes.");
  if (next.files.length > copy && value !== copy || next.files.length === copy && value !== 18) {
    const overlay = new Uint8Array(currentLibrary.overlay); writeU32(overlay, offset, next.files.length > copy ? copy : 18);
    draft.overlays[36] = overlay; draft.patches ??= { dirtyOverlayIds: [], applied: {} };
    if (!draft.patches.dirtyOverlayIds.includes(36)) draft.patches.dirtyOverlayIds.push(36);
  }
  replaceRomFile(draft, library.rom, library.rom.fileId(GRAPHICS_PATH), current.save());
  draft.uiScreens!.draft = design; draft.uiScreens!.applied = structuredClone(design);
  const stored = sourceMetadata(draft.uiScreens!), id = library.rom.filenames.idOf(SOURCE_PATH);
  if (id === undefined) ensureFileSystemState(draft).additions![SOURCE_PATH] = stored; else replaceRomFile(draft, library.rom, id, stored);
  if (key !== designKey(project.uiScreens!.draft)) throw new Error("The design changed during staging. Apply again.");
  signal?.throwIfAborted();
  Object.assign(project, draft); library.state = project.uiScreens!;
  return { changed: true, quantized: next.quantized };
}
