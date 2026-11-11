import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { BW2_NARCS } from "./constants";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import { markDirty, type ProjectState, type PwanAnimationOverride, type PwanOverrideSide, type TrainerPwanAnimationOverride } from "./projectStore";
import { pwanFramesPerSecond, pwanPalette, pwanTimeline, validatePwan } from "./pwanCompiler";
import { decodeW2AnimFrame, encodeW2AnimMani, parseW2Anim, W2ANIM_MORPH, W2ANIM_OWN_PALETTES, W2ANIM_PATH, W2ANIM_TEX4, W2ANIM_TICKS,
  W2ANIM_TRAINER_CARRIER, type W2AnimArchive, type W2AnimMani } from "./w2animCodec";
import { w2animEditorToLinear, w2animLinearToEditor } from "./w2animAnimationModel";
import manifest from "../assets/codeinjection/animStreamsManifest.json";
import { fullSizeBlockFiles, fullSizePreviewPwan } from "./animStreamsFullSize";
import { checkCompatibilitySignatures, type PwanCompatibilityCheck, type PwanCompatibilityReport, type PwanCompatibilitySignature } from "./pwanCompatibilityModel";
import { parseRpm } from "./rpm";

/**
 * Pokeweb's animated sprite runtime: frames streamed from `w2anim/streams.bin` (W2AS / MANI, the format of
 * White2Upgrade's w2anim) by PokewebAnimStreams<game>.dll, a port of that streamer to retail Black 2 and White 2.
 * It replaces the PWAN runtimes (PokewebPwan{Battle,Summary,Misc,Trainer}) and `zz_pokeweb_pwan/pwan.narc`: frames
 * are LZ-compressed and deduplicated, and the buffers are on the battle / scene heap instead of PMC's heap.
 *
 * Pokeweb keeps editing PWAN overrides; export writes them as streams. The species / form of each Pokémon override
 * is kept in `w2anim/pokeweb_index.bin` (PWNC rows, as pwan.narc's config), so a reload restores the overrides.
 */

export const ANIM_STREAMS_PATH = W2ANIM_PATH;
export const ANIM_STREAMS_INDEX_PATH = "w2anim/pokeweb_index.bin";
export const ANIM_STREAMS_FILENAMES = {
  B: "PokewebAnimStreamsB.dll", W: "PokewebAnimStreamsW.dll", W2: "PokewebAnimStreamsW2.dll", B2: "PokewebAnimStreamsB2.dll",
} as const;
export const LEGACY_PWAN_FILENAMES = {
  B: [], W: [], // Black and White never had the PWAN runtimes
  W2: ["PokewebPwanSummaryW2.dll", "PokewebPwanBattleW2.dll", "PokewebPwanMiscW2.dll", "PokewebPwanTrainerW2.dll", "PokewebPwanLegacyRetiredW2.dll", "PokewebPwanW2.dll"],
  B2: ["PokewebPwanSummaryB2.dll", "PokewebPwanBattleB2.dll", "PokewebPwanMiscB2.dll", "PokewebPwanTrainerB2.dll"],
} as const;
const LEGACY_PWAN_ARCHIVE_PATH = "zz_pokeweb_pwan/pwan.narc";
const ARC_POKEGRA = 4;
/** The trainer sprite archive (front): arc 72 in Black / White, 71 in Black 2 / White 2. */
const trainerArc = (game: Game | undefined): number => (game === "B" || game === "W" ? 72 : 71);
const FILES_PER_SPRITE = 20;
const FILES_PER_TRAINER = 8;
const FRAME_BYTES = 4608;
const PALETTE_OFFSET = 0x28;
const INDEX_MAGIC = "PWNC";
const INDEX_VERSION = 3;
const INDEX_HEADER_BYTES = 16;
const INDEX_ENTRY_BYTES = 5;

type Game = keyof typeof ANIM_STREAMS_FILENAMES;
const urls: Record<Game, URL> = {
  B: new URL("../assets/codeinjection/PokewebAnimStreamsB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/PokewebAnimStreamsW.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/PokewebAnimStreamsW2.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/PokewebAnimStreamsB2.dll", import.meta.url),
};

function gameOf(project: ProjectState): Game | undefined {
  const game = project.session.baseVersion;
  return game === "B" || game === "W" || game === "W2" || game === "B2" ? game : undefined;
}

export function animStreamsRuntimePath(project: ProjectState): string | undefined {
  const game = gameOf(project);
  return game ? `patches/${ANIM_STREAMS_FILENAMES[game]}` : undefined;
}

/** The Pokeweb stream runtime is staged or built into the ROM. */
export function hasAnimStreamsRuntime(project: ProjectState): boolean {
  const path = animStreamsRuntimePath(project)?.toLowerCase();
  return Boolean(path) && listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === path);
}

/** PWAN runtime DLLs (any of the split ones, the trainer one or the retired single White 2 DLL) still in the ROM. */
export function legacyPwanRuntimePaths(project: ProjectState): string[] {
  const game = gameOf(project);
  if (!game) return [];
  const names = new Set<string>(LEGACY_PWAN_FILENAMES[game].map((name) => `patches/${name}`.toLowerCase()));
  return listCodeInjectionDlls(project).map((module) => module.path).filter((path) => names.has(path.toLowerCase()));
}

export async function loadAnimStreamsRuntime(game: Game): Promise<Uint8Array> {
  const response = await fetch(urls[game]);
  if (!response.ok) throw new Error(`Could not load the animated sprite runtime (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = manifest.games[game].sha256;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
  if (Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("") !== expected) throw new Error("The animated sprite runtime failed its integrity check.");
  return bytes;
}

const HOOK_LABELS: Record<string, [group: string, label: string]> = {
  HOOK_LOAD_RELOAD: ["MCSS", "Sprite reload"], HOOK_LOAD_ADD: ["MCSS", "Sprite add"], HOOK_LOAD_MOSAIC: ["MCSS", "Sprite mosaic reload"],
  HOOK_REMOVE: ["MCSS", "Sprite remove"], HOOK_UPDATE_BATTLE: ["Battle", "Battle sprite update"], HOOK_UPDATE_TRADE: ["Trade", "Trade sprite update"],
  HOOK_UPDATE_SUMMARY: ["Summary", "Summary sprite update"], HOOK_UPDATE_HALL_OF_FAME: ["Hall of Fame", "Hall of Fame sprite update"],
  HOOK_UPDATE_EVOLUTION: ["Evolution", "Evolution sprite update"], HOOK_UPDATE_INTRO: ["Intro", "Intro sprite update"],
  HOOK_UPDATE_ZUKAN: ["Pokédex", "Pokédex form sprite update"], HOOK_UPDATE_EGG: ["Egg hatch", "Egg hatch sprite update"],
  HOOK_EVO_MORPH_UPDATE: ["Evolution", "Evolution morph update"], HOOK_EVO_MORPH_DRAW: ["Evolution", "Evolution morph draw"],
  HOOK_EVO_ADD_PAIR: ["Evolution", "Evolution sprites"], HOOK_EVO_ADD_AFTER: ["Evolution", "Evolution replay sprite"],
};

function hookSignatures(game: Game): PwanCompatibilitySignature[] {
  return manifest.games[game].hooks.map((hook) => {
    const address = Number(hook.address), [group, label] = HOOK_LABELS[hook.id] ?? ["Hooks", hook.id];
    return { id: hook.id, label, group, module: hook.segment === "ARM9" ? "arm9" as const : "overlay" as const,
      overlayId: hook.segment === "ARM9" ? undefined : Number(hook.segment), address, windowStart: address, expectedHex: hook.expectedHex };
  });
}

/**
 * The runtime's hook sites hold the retail calls, and no other DLL hooks them (the PWAN runtimes it replaces are
 * removed when it is installed, so they do not count).
 */
export function detectAnimStreamsCompatibility(project: ProjectState): PwanCompatibilityReport {
  const game = gameOf(project);
  if (!game) return { compatible: false, supportedBase: false, passed: 0, failed: 1, missing: 0,
    checks: [{ id: "base-rom", label: "Base ROM", group: "ROM", module: "arm9", address: 0, windowStart: 0, expectedHex: "", status: "unsupported",
      message: "Animated sprites support US Black, White, Black 2 and White 2." }] };
  const signatures = hookSignatures(game);
  const report = checkCompatibilitySignatures(project, signatures);
  const ours = new Set([animStreamsRuntimePath(project)!, ...legacyPwanRuntimePaths(project)].map((path) => path.toLowerCase()));
  const conflicts: PwanCompatibilityCheck[] = [];
  const rom = project.originalRomBytes ? new NintendoDSRom(project.originalRomBytes, { fileData: "view" }) : undefined;
  for (const module of listCodeInjectionDlls(project)) {
    if (ours.has(module.path.toLowerCase())) continue;
    const added = Object.entries(project.fileSystem?.additions ?? {}).find(([path]) => path.toLowerCase() === module.path.toLowerCase())?.[1];
    const id = rom?.filenames.idOf(module.path);
    const bytes = added ?? (rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined);
    let relocations: ReturnType<typeof parseRpm>["relocations"] = [];
    try { if (bytes?.length) relocations = parseRpm(bytes, { allowedMagics: ["DLXF"] }).relocations; } catch { continue; }
    for (const signature of signatures) {
      const segment = signature.module === "arm9" ? "ARM9" : String(signature.overlayId);
      const hit = relocations.find(({ target }) => target.module === segment
        && target.address < signature.address + 4 && target.address + (target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4) > signature.address);
      if (hit) conflicts.push({ ...signature, status: "changed", message: `${module.fileName} already hooks ${signature.label.toLowerCase()}.` });
    }
  }
  if (!conflicts.length) return report;
  return { ...report, compatible: false, failed: report.failed + conflicts.length, checks: [...report.checks, ...conflicts] };
}

/** Removes a code-injection DLL whether it was staged in this session or built into the loaded ROM. */
function removeDll(project: ProjectState, path: string): void {
  if (canRemoveStagedCodeInjectionDll(project, path)) { removeStagedCodeInjectionDll(project, path); return; }
  const rom = project.originalRomBytes ? new NintendoDSRom(project.originalRomBytes, { fileData: "view" }) : undefined;
  const id = rom?.filenames.idOf(path);
  if (id === undefined) throw new Error(`Reload the ROM before removing ${path}.`);
  tombstone(project, id, path);
  if (project.codeInjection?.modules) project.codeInjection.modules = project.codeInjection.modules.filter((module) => module.path.toLowerCase() !== path.toLowerCase());
}

function tombstone(project: ProjectState, fileId: number, path: string): void {
  setRomFileReplacement(project, fileId, new Uint8Array());
  project.fileSystem!.tombstones ??= {};
  project.fileSystem!.tombstones[fileId] = path;
}

/**
 * Stages the stream runtime and retires the PWAN runtimes (call inside a code-injection transaction). The overrides
 * already in the project (read from pwan.narc at load) are written as streams at export, and pwan.narc is removed then.
 */
export async function stageAnimStreamsRuntime(project: ProjectState): Promise<{ removed: string[] }> {
  const game = gameOf(project);
  if (!game) throw new Error("Animated sprites support US Black, White, Black 2 and White 2.");
  const bytes = await loadAnimStreamsRuntime(game);
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const removed = legacyPwanRuntimePaths(project);
  for (const path of removed) removeDll(project, path);
  stageCodeInjectionDll(project, ANIM_STREAMS_FILENAMES[game], bytes, "patches");
  project.pwanAnimations ??= { overrides: [] };
  project.pwanAnimations.runtimeInstalled = true;
  project.pwanAnimations.dirty = true;
  project.trainerPwanAnimations ??= { overrides: [] };
  project.trainerPwanAnimations.runtimeInstalled = true;
  project.trainerPwanAnimations.dirty = true;
  return { removed };
}

/** Removes the runtime and its streams (a ROM with streams.bin and no Pokeweb runtime would read as a W2U ROM). */
export function unstageAnimStreamsRuntime(project: ProjectState): void {
  const path = animStreamsRuntimePath(project);
  if (path && hasAnimStreamsRuntime(project)) removeDll(project, path);
  const rom = project.originalRomBytes ? new NintendoDSRom(project.originalRomBytes, { fileData: "view" }) : undefined;
  for (const file of [ANIM_STREAMS_PATH, ANIM_STREAMS_INDEX_PATH]) {
    if (project.fileSystem?.additions) delete project.fileSystem.additions[file];
    const id = rom?.filenames.idOf(file);
    if (id !== undefined) tombstone(project, id, file);
  }
  if (project.pwanAnimations) { project.pwanAnimations.runtimeInstalled = false; project.pwanAnimations.dirty = true; }
  if (project.trainerPwanAnimations) { project.trainerPwanAnimations.runtimeInstalled = false; project.trainerPwanAnimations.dirty = true; }
}

// ---- PWAN <-> MANI ----------------------------------------------------------------------------------------

/** PWAN (editor layout: four OBJ regions) -> TEX4 MANI frames (96 rows of 48 bytes). */
export function pwanToManiFrames(pwanBytes: Uint8Array): { frames: Uint8Array[]; sequence: Array<{ frame: number; duration: number }> } {
  const header = validatePwan(pwanBytes);
  const frames = Array.from({ length: header.frameCount }, (_, n) =>
    w2animEditorToLinear(pwanBytes.subarray(header.frameOffset + n * FRAME_BYTES, header.frameOffset + (n + 1) * FRAME_BYTES)));
  const sequence = pwanTimeline(pwanBytes).map((step) => ({ frame: step.frameIndex, duration: step.ticks }));
  return { frames, sequence };
}

export function pwanToMani(pwanBytes: Uint8Array, palettes?: { normal: Uint16Array; shiny: Uint16Array }): Uint8Array {
  const { frames, sequence } = pwanToManiFrames(pwanBytes);
  return encodeW2AnimMani({ frames, sequence, normalPalette: palettes?.normal, shinyPalette: palettes?.shiny });
}

/** A 96x96 TEX4 tick-timed MANI back to PWAN bytes (frames to the editor layout). */
export function maniToPwan(archive: W2AnimArchive, mani: W2AnimMani, palette: Uint16Array): Uint8Array {
  if (!(mani.flags & W2ANIM_TEX4) || mani.width !== 96 || mani.height !== 96 || !(mani.flags & W2ANIM_TICKS))
    throw new Error("Only 96x96 TEX4 streams with tick timing can be edited as PWAN");
  // The PWAN compiler's layout: 0x30-byte header, palette, timeline, frames.
  const paletteAt = 0x30, timelineAt = paletteAt + 32, framesAt = timelineAt + mani.sequence.length * 4;
  const bytes = new Uint8Array(framesAt + mani.frames.length * FRAME_BYTES);
  bytes.set(new TextEncoder().encode("PWAN"));
  [1, 96, 96, 4, mani.frames.length, mani.sequence.length].forEach((value, n) => writeU16(bytes, 4 + n * 2, value));
  [mani.sequence.reduce((total, step) => total + step.duration, 0), FRAME_BYTES, 16, paletteAt, timelineAt, framesAt]
    .forEach((value, n) => writeU32(bytes, 16 + n * 4, value));
  palette.forEach((color, n) => writeU16(bytes, paletteAt + n * 2, color));
  mani.sequence.forEach((step, n) => { writeU16(bytes, timelineAt + n * 4, step.frame); writeU16(bytes, timelineAt + n * 4 + 2, step.duration); });
  mani.frames.forEach((_, n) => bytes.set(w2animLinearToEditor(decodeW2AnimFrame(archive, mani, n)), framesAt + n * FRAME_BYTES));
  validatePwan(bytes);
  return bytes;
}

// ---- the streams file -------------------------------------------------------------------------------------

export type AnimStreamEntry = { arc: number; flags: number; sheetFile: number; shinyNclrFile: number; mani: Uint8Array };

/** W2AS v1: entries sorted by (arc, sheet); entries sharing a MANI (by identity) share its bytes. */
export function buildAnimStreamsFile(entries: AnimStreamEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.arc - b.arc || a.sheetFile - b.sheetFile);
  for (let n = 1; n < sorted.length; n++) {
    if (sorted[n]!.arc === sorted[n - 1]!.arc && sorted[n]!.sheetFile === sorted[n - 1]!.sheetFile)
      throw new Error(`Two animated sprites use arc ${sorted[n]!.arc} file ${sorted[n]!.sheetFile}.`);
  }
  const offsets = new Map<Uint8Array, number>(), payloads: Uint8Array[] = [];
  let cursor = 16 + sorted.length * 16;
  for (const entry of sorted) {
    if (offsets.has(entry.mani)) continue;
    offsets.set(entry.mani, cursor); payloads.push(entry.mani); cursor += Math.ceil(entry.mani.length / 4) * 4;
  }
  const out = new Uint8Array(cursor);
  out.set(new TextEncoder().encode("W2AS")); writeU16(out, 4, 1); writeU32(out, 8, sorted.length); writeU32(out, 12, 16);
  sorted.forEach((entry, n) => {
    const p = 16 + n * 16;
    writeU16(out, p, entry.arc); writeU16(out, p + 2, entry.flags); writeU32(out, p + 4, entry.sheetFile);
    writeU32(out, p + 8, offsets.get(entry.mani)!); writeU32(out, p + 12, entry.shinyNclrFile);
  });
  for (const payload of payloads) out.set(payload, offsets.get(payload)!);
  parseW2Anim(out); // every MANI and frame validated before it reaches the ROM
  return out;
}

function readPalette(file: Uint8Array | undefined): Uint16Array | undefined {
  if (!file || file.length < PALETTE_OFFSET + 32) return undefined;
  return Uint16Array.from({ length: 16 }, (_, n) => readU16(file, PALETTE_OFFSET + n * 2));
}

const samePalette = (a: Uint16Array, b: Uint16Array | undefined): boolean => Boolean(b) && a.every((color, n) => n === 0 || color === b![n]);

/**
 * Stream entries of the Pokémon overrides, from the carrier-patched sprite archive: each side streams through the
 * native palette when the carrier's normal and shiny palettes are the PWAN's (so palette features of the native
 * sprite keep working), else with its own palette for both (the PWAN runtime showed shiny Pokémon so too).
 */
export function pokemonStreamEntries(project: ProjectState, overrides: PwanAnimationOverride[]): AnimStreamEntry[] {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before exporting animated Pokémon sprites.");
  const entries: AnimStreamEntry[] = [];
  for (const override of overrides) {
    const asset = override.assetIndex ?? override.speciesId, base = asset * FILES_PER_SPRITE;
    const normal = readPalette(store.rawFiles[base + 18]), shiny = readPalette(store.rawFiles[base + 19]);
    for (const [side, member] of [["front", 2], ["back", 11]] as const) {
      const data = override[side];
      if (!data) continue;
      let mani = data.fullSizeMani;
      if (!mani) {
        const pal = pwanPalette(data.pwanBytes);
        const own = !samePalette(pal, normal) || !samePalette(pal, shiny);
        const palette = pal.slice(); palette[0] = normal?.[0] ?? pal[0]!;
        mani = pwanToMani(data.pwanBytes, own ? { normal: palette, shiny: palette } : undefined);
      }
      const entry = { arc: ARC_POKEGRA, flags: 0, sheetFile: base + member, shinyNclrFile: base + 19, mani };
      entries.push(entry);
      // The female sheet loads with the same (carrier) cells; the stream primes over its art.
      if (store.rawFiles[base + member + 1]?.length) entries.push({ ...entry, sheetFile: base + member + 1 });
    }
  }
  return entries;
}

/**
 * Full-size sides draw one quad of their box: their side files (sheet, cells, still animation, record) are written
 * over the carrier's (after the carrier patch). Returns the members written.
 */
export function applyFullSizeBlockFiles(project: ProjectState, overrides: PwanAnimationOverride[]): number[] {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before exporting animated Pokémon sprites.");
  const written: number[] = [];
  for (const override of overrides) {
    const base = (override.assetIndex ?? override.speciesId) * FILES_PER_SPRITE;
    for (const [side, sideOffset] of [["front", 0], ["back", 9]] as const) {
      const mani = override[side]?.fullSizeMani;
      if (!mani) continue;
      for (const [offset, bytes] of fullSizeBlockFiles(mani, (member) => store.rawFiles[member] ?? new Uint8Array())) {
        store.rawFiles[base + sideOffset + offset] = bytes;
        markDirty(project, "pokemon_sprites", base + sideOffset + offset);
        written.push(base + sideOffset + offset);
      }
    }
  }
  return written;
}

/** Trainers stream into Pokeweb's 96x96 trainer carrier graphic (the PWAN runtime's), always with their own palette. */
export function trainerStreamEntries(overrides: TrainerPwanAnimationOverride[], carrierGraphicIndex: number, arc = trainerArc("W2")): AnimStreamEntry[] {
  return overrides.map((override) => {
    const pal = pwanPalette(override.animation.pwanBytes);
    return { arc, flags: W2ANIM_TRAINER_CARRIER, sheetFile: override.graphicIndex * FILES_PER_TRAINER + 1,
      shinyNclrFile: carrierGraphicIndex * FILES_PER_TRAINER, mani: pwanToMani(override.animation.pwanBytes, { normal: pal, shiny: pal }) };
  });
}

/** PWNC v3 rows {u16 species, u8 form | sides << 5, u16 asset}: the Pokémon each stream belongs to. */
export function buildAnimStreamsIndex(overrides: PwanAnimationOverride[]): Uint8Array {
  const rows = overrides.filter((o) => o.front || o.back).sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
  if (rows.length > 0xffff) throw new Error("Too many animated Pokémon sprites.");
  const out = new Uint8Array(INDEX_HEADER_BYTES + rows.length * INDEX_ENTRY_BYTES);
  out.set(new TextEncoder().encode(INDEX_MAGIC)); writeU16(out, 4, INDEX_VERSION); writeU16(out, 6, rows.length); writeU32(out, 12, INDEX_HEADER_BYTES);
  rows.forEach((o, n) => {
    const at = INDEX_HEADER_BYTES + n * INDEX_ENTRY_BYTES;
    writeU16(out, at, o.speciesId);
    out[at + 2] = ((o.formIndex ?? 0) & 0x1f) | (((o.front ? 1 : 0) | (o.back ? 2 : 0)) << 5);
    writeU16(out, at + 3, o.assetIndex ?? o.speciesId);
  });
  return out;
}

function parseAnimStreamsIndex(bytes: Uint8Array): Array<{ speciesId: number; formIndex: number; assetIndex: number }> {
  if (bytes.length < INDEX_HEADER_BYTES || readAscii(bytes, 0, 4) !== INDEX_MAGIC || readU16(bytes, 4) !== INDEX_VERSION)
    throw new Error("Unsupported animated sprite index");
  const count = readU16(bytes, 6), at = readU32(bytes, 12) || INDEX_HEADER_BYTES;
  if (at + count * INDEX_ENTRY_BYTES > bytes.length) throw new Error("Truncated animated sprite index");
  return Array.from({ length: count }, (_, n) => {
    const p = at + n * INDEX_ENTRY_BYTES;
    return { speciesId: readU16(bytes, p), formIndex: bytes[p + 2]! & 0x1f, assetIndex: readU16(bytes, p + 3) };
  });
}

function sideFromPwan(pwanBytes: Uint8Array, sourceFileName: string): PwanOverrideSide {
  const header = validatePwan(pwanBytes);
  return { sourceFileName, sourceGifBytes: new Uint8Array(), pwanBytes, frameCount: header.timelineCount,
    uniqueFrameCount: header.frameCount, timelineCount: header.timelineCount, totalTicks: header.totalTicks,
    paletteBgr555: pwanPalette(pwanBytes), speedScale: 1, framesPerSecond: pwanFramesPerSecond(pwanBytes), scale: 1, offsetX: 0, offsetY: 0 };
}

/**
 * A Pokeweb stream ROM (the runtime DLL and streams.bin): the Pokémon and trainer overrides back from the streams.
 * Returns false for other ROMs (White2Upgrade's w2anim ROMs have streams.bin but not this runtime).
 */
export function hydrateAnimStreamsFromRom(project: ProjectState, rom: NintendoDSRom): boolean {
  const game = gameOf(project), streamsId = rom.filenames.idOf(ANIM_STREAMS_PATH), indexId = rom.filenames.idOf(ANIM_STREAMS_INDEX_PATH);
  if (!game || streamsId === undefined || rom.filenames.idOf(`patches/${ANIM_STREAMS_FILENAMES[game]}`) === undefined) return false;
  const state = project.pwanAnimations ??= { overrides: [] };
  const trainers = project.trainerPwanAnimations ??= { overrides: [] };
  if (state.dirty || trainers.dirty) return true; // unsaved edits are newer than the ROM's streams
  try {
    const archive = parseW2Anim(getRomFileBytes(project, rom, streamsId));
    const index = indexId === undefined ? [] : parseAnimStreamsIndex(getRomFileBytes(project, rom, indexId));
    const spritesId = rom.filenames.idOf(BW2_NARCS.find((narc) => narc.name === "pokemon_sprites")!.path);
    const sprites = spritesId === undefined ? undefined : new NARC(getRomFileBytes(project, rom, spritesId));
    const side = (sheetFile: number, arc: number): PwanOverrideSide | undefined => {
      const entry = archive.entries.find((e) => e.arc === arc && e.sheetFile === sheetFile);
      const mani = entry && archive.manis.get(entry.maniOffset);
      if (!entry || !mani) return undefined;
      if (mani.flags & W2ANIM_MORPH) { // full size: the MANI as it is, and a 96x96 preview
        const raw = archive.bytes.slice(mani.offset, mani.end);
        return { ...sideFromPwan(fullSizePreviewPwan(raw).pwanBytes, `${ANIM_STREAMS_PATH}:${arc}:${sheetFile}`), fullSizeMani: raw };
      }
      const palette = mani.normalPalette ?? readPalette(sprites?.files[Math.floor(sheetFile / FILES_PER_SPRITE) * FILES_PER_SPRITE + 18]);
      if (!palette) return undefined;
      return sideFromPwan(maniToPwan(archive, mani, palette), `${ANIM_STREAMS_PATH}:${arc}:${sheetFile}`);
    };
    state.overrides = index.flatMap(({ speciesId, formIndex, assetIndex }) => {
      const front = side(assetIndex * FILES_PER_SPRITE + 2, ARC_POKEGRA), back = side(assetIndex * FILES_PER_SPRITE + 11, ARC_POKEGRA);
      return front || back ? [{ speciesId, formIndex, assetIndex: assetIndex === speciesId ? undefined : assetIndex, front, back,
        nativePaletteSource: back ? "back" as const : "front" as const, carrierTemplate: "w2u-gen6-placeholder" as const }] : [];
    });
    const arcTrainer = trainerArc(game);
    const trainerEntries = archive.entries.filter((e) => e.arc === arcTrainer && e.flags & W2ANIM_TRAINER_CARRIER);
    trainers.overrides = trainerEntries.flatMap((entry) => {
      const mani = archive.manis.get(entry.maniOffset);
      if (!mani?.normalPalette || (entry.sheetFile - 1) % FILES_PER_TRAINER) return [];
      const graphicIndex = (entry.sheetFile - 1) / FILES_PER_TRAINER;
      return [{ graphicIndex, animation: sideFromPwan(maniToPwan(archive, mani, mani.normalPalette), `${ANIM_STREAMS_PATH}:${arcTrainer}:${entry.sheetFile}`) }];
    });
    if (trainerEntries[0]) trainers.carrierGraphicIndex = trainerEntries[0].shinyNclrFile / FILES_PER_TRAINER;
    state.detectedArchive = { path: ANIM_STREAMS_PATH, version: 1, count: state.overrides.length };
    state.loadError = undefined;
    trainers.loadError = undefined;
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error);
    state.overrides = [];
  }
  state.runtimeInstalled = true; state.dirty = false;
  trainers.runtimeInstalled = true; trainers.dirty = false;
  return true;
}

function writeFile(project: ProjectState, rom: NintendoDSRom | undefined, path: string, bytes: Uint8Array): void {
  const id = rom?.filenames.idOf(path);
  if (id === undefined) { addRomFile(project, path, bytes); return; }
  setRomFileReplacement(project, id, bytes);
  if (project.fileSystem?.tombstones?.[id]) delete project.fileSystem.tombstones[id];
}

/**
 * Export: the streams file and its index from every override (after the caller applied the carrier patches), and
 * the PWAN archive removed (its overrides are in the streams now).
 */
export function writeAnimStreams(project: ProjectState, rom: NintendoDSRom | undefined, input: {
  pokemon: PwanAnimationOverride[]; trainers: TrainerPwanAnimationOverride[]; trainerCarrierGraphicIndex?: number;
}): { bytes: number; entries: number } {
  const entries = [...pokemonStreamEntries(project, input.pokemon)];
  if (input.trainers.length) {
    if (input.trainerCarrierGraphicIndex === undefined) throw new Error("Animated trainers need the trainer carrier graphic.");
    entries.push(...trainerStreamEntries(input.trainers, input.trainerCarrierGraphicIndex, trainerArc(gameOf(project))));
  }
  const streams = buildAnimStreamsFile(entries);
  writeFile(project, rom, ANIM_STREAMS_PATH, streams);
  writeFile(project, rom, ANIM_STREAMS_INDEX_PATH, buildAnimStreamsIndex(input.pokemon));
  if (project.fileSystem?.additions) delete project.fileSystem.additions[LEGACY_PWAN_ARCHIVE_PATH];
  const pwanId = rom?.filenames.idOf(LEGACY_PWAN_ARCHIVE_PATH);
  if (pwanId !== undefined) tombstone(project, pwanId, LEGACY_PWAN_ARCHIVE_PATH);
  return { bytes: streams.length, entries: entries.length };
}

export const ANIM_STREAMS_OWN_PALETTES = W2ANIM_OWN_PALETTES;
