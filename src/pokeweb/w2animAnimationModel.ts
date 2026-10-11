import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { setRomFileReplacement } from "./fileSystemModel";
import { decompressNitro, resolvePokemonSpriteId } from "./pokemonSpriteModel";
import { markDirty, type ProjectState, type PwanOverrideSide } from "./projectStore";
import { parsePwanHeader, pwanPalette, pwanTimeline, pwanFramesPerSecond, pwanVisibleHeight, validatePwan, PWAN_MAX_TIMELINE } from "./pwanCompiler";
import { ensureTrainerSpriteStore } from "./trainerSpriteModel";
import { decodeW2AnimFrame, encodeW2AnimLz10, encodeW2AnimMani, materializeW2AnimArchive, parseW2Anim,
  W2ANIM_CARRIER, W2ANIM_OWN_PALETTES, W2ANIM_PATH, W2ANIM_TEX4, W2ANIM_TICKS, w2animKey,
  type W2AnimArchive, type W2AnimEntry, type W2AnimMani } from "./w2animCodec";

const parsed = new WeakMap<Uint8Array, W2AnimArchive>();
const backend = new WeakMap<Uint8Array, boolean>();
const REGIONS = [[0, 0, 0, 8, 8], [0x800, 64, 0, 4, 8], [0xc00, 0, 64, 8, 4], [0x1000, 64, 64, 4, 4]];
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, n) => value === b[n]);

export function isW2AnimProject(project: ProjectState): boolean {
  if (project.w2animAnimations || project.fileSystem?.additions?.[W2ANIM_PATH]) return true;
  const bytes = project.originalRomBytes;
  if (!bytes) return false;
  let value = backend.get(bytes);
  if (value === undefined) { value = new NintendoDSRom(bytes, { fileData: "view" }).filenames.idOf(W2ANIM_PATH) !== undefined; backend.set(bytes, value); }
  return value;
}

function archive(project: ProjectState): W2AnimArchive {
  const bytes = project.w2animAnimations?.sourceBytes;
  if (!bytes?.length) throw new Error("Reload the w2anim ROM before editing animations");
  let value = parsed.get(bytes);
  if (!value) { value = parseW2Anim(bytes); parsed.set(bytes, value); }
  return value;
}

/** Validate all manifests and compressed frames before changing project state. */
export function hydrateW2AnimFromRom(project: ProjectState, rom: NintendoDSRom): boolean {
  const fileId = rom.filenames.idOf(W2ANIM_PATH);
  if (fileId === undefined) return false;
  if (project.session.baseVersion !== "W2" || rom.idCode !== "IRDO") throw new Error("w2anim authoring supports the US White 2 integration layout only");
  const bytes = rom.files[fileId]!;
  const value = parseW2Anim(bytes);
  parsed.set(bytes, value); backend.set(project.originalRomBytes ?? bytes, true);
  if (!project.w2animAnimations) project.w2animAnimations = { fileId, sourceBytes: bytes, editorOriginals: {}, editorTargets: {} };
  else if (!project.w2animAnimations.sourceBytes.length) project.w2animAnimations.sourceBytes = bytes;
  project.pwanAnimations ??= { overrides: [], dirty: false };
  project.trainerPwanAnimations ??= { overrides: [], dirty: false };
  return true;
}

/** The existing authoring canvas uses four OBJ regions; runtime streams are linear. */
export function w2animLinearToEditor(frame: Uint8Array): Uint8Array {
  if (frame.length !== 4608) throw new Error("Only 96x96 TEX4 animations can be edited");
  const out = new Uint8Array(4608);
  for (const [base, x0, y0, tw, th] of REGIONS) for (let ty = 0; ty < th!; ty++) for (let tx = 0; tx < tw!; tx++)
    for (let y = 0; y < 8; y++) out.set(frame.subarray((y0! + ty * 8 + y) * 48 + (x0! + tx * 8) / 2,
      (y0! + ty * 8 + y) * 48 + (x0! + tx * 8) / 2 + 4), base! + (ty * tw! + tx) * 32 + y * 4);
  return out;
}

export function w2animEditorToLinear(frame: Uint8Array): Uint8Array {
  if (frame.length !== 4608) throw new Error("Only 96x96 TEX4 animations can be edited");
  const out = new Uint8Array(4608);
  for (const [base, x0, y0, tw, th] of REGIONS) for (let ty = 0; ty < th!; ty++) for (let tx = 0; tx < tw!; tx++)
    for (let y = 0; y < 8; y++) out.set(frame.subarray(base! + (ty * tw! + tx) * 32 + y * 4,
      base! + (ty * tw! + tx) * 32 + y * 4 + 4), (y0! + ty * 8 + y) * 48 + (x0! + tx * 8) / 2);
  return out;
}

function nativePalette(project: ProjectState, member: number): Uint16Array {
  const bytes = project.narcs.pokemon_sprites?.rawFiles[member];
  if (!bytes) throw new Error(`Missing native w2anim palette ${member}; load Pokémon Sprites`);
  // Converter uses the TTLP payload offset, not a guessed fixed NCLR header.
  let block = -1;
  for (let n = 16; n + 24 <= bytes.length; n += 4) if (readAscii(bytes, n, 4) === "TTLP") { block = n; break; }
  if (block < 0) throw new Error("Missing native w2anim TTLP palette");
  const start = block + 8 + readU32(bytes, block + 20);
  if (start < block + 24 || start + 32 > bytes.length) throw new Error("Truncated native w2anim palette");
  return Uint16Array.from({ length: 16 }, (_, n) => readU16(bytes, start + n * 2));
}

function editable(mani: W2AnimMani): void {
  if (!(mani.flags & W2ANIM_TEX4) || mani.width !== 96 || mani.height !== 96)
    throw new Error("This w2anim stream is preserved but cannot be edited: only 96x96 TEX4 is supported");
  if (!(mani.flags & W2ANIM_TICKS)) throw new Error("Millisecond w2anim timelines are preserved but cannot be edited in the tick-based canvas");
  if (mani.sequence.length > PWAN_MAX_TIMELINE) throw new Error("This w2anim timeline is preserved but exceeds the authoring canvas limit");
}

function editorSide(project: ProjectState, entry: W2AnimEntry, trainer: boolean): PwanOverrideSide {
  const source = archive(project), mani = source.manis.get(entry.maniOffset)!;
  editable(mani);
  const pal = mani.normalPalette ?? nativePalette(project, entry.shinyNclrFile - 1);
  const timelineAt = 72, framesAt = timelineAt + mani.sequence.length * 4;
  const bytes = new Uint8Array(framesAt + mani.frames.length * 4608);
  bytes.set(new TextEncoder().encode("PWAN"));
  [1, 96, 96, 4, mani.frames.length, mani.sequence.length].forEach((value, n) => writeU16(bytes, 4 + n * 2, value));
  [mani.sequence.reduce((total, step) => total + step.duration, 0), 4608, 16, 40, timelineAt, framesAt]
    .forEach((value, n) => writeU32(bytes, 16 + n * 4, value));
  pal.forEach((color, n) => writeU16(bytes, 40 + n * 2, color));
  mani.sequence.forEach((step, n) => { writeU16(bytes, timelineAt + n * 4, step.frame); writeU16(bytes, timelineAt + n * 4 + 2, step.duration); });
  mani.frames.forEach((_, n) => {
    let linear = decodeW2AnimFrame(source, mani, n);
    if (trainer) {
      if (linear.subarray(88 * 48).some(value => value !== 0)) throw new Error("Trainer stream cannot be losslessly shifted into the authoring canvas");
      const shifted = new Uint8Array(4608); shifted.set(linear.subarray(0, 88 * 48), 8 * 48); linear = shifted;
    }
    bytes.set(w2animLinearToEditor(linear), framesAt + n * 4608);
  });
  project.w2animAnimations!.editorOriginals[w2animKey(entry)] = bytes.slice();
  return { sourceFileName: `w2anim-${entry.arc}-${entry.sheetFile}.mani`, sourceGifBytes: new Uint8Array(), pwanBytes: bytes,
    frameCount: mani.frames.length, uniqueFrameCount: mani.frames.length, timelineCount: mani.sequence.length,
    totalTicks: readU32(bytes, 16), paletteBgr555: pal.slice(), framesPerSecond: pwanFramesPerSecond(bytes),
    visibleHeight: pwanVisibleHeight(bytes), speedScale: 1, scale: 1, offsetX: 0, offsetY: 0 };
}

export function hydrateW2AnimPokemonTarget(project: ProjectState, speciesId: number, formIndex: number): void {
  if (!project.w2animAnimations) return;
  const assetIndex = resolvePokemonSpriteId(project, speciesId, formIndex);
  const key = `pokemon:${assetIndex}`;
  if (project.w2animAnimations.editorTargets[key]) return;
  const source = archive(project);
  const sides: Partial<Record<"front" | "back", PwanOverrideSide>> = {};
  for (const [side, member] of [["front", 2], ["back", 11]] as const) {
    const entry = source.entries.find(e => e.arc === 4 && e.sheetFile === assetIndex * 20 + member);
    if (entry) sides[side] = editorSide(project, entry, false);
  }
  const state = project.pwanAnimations ??= { overrides: [] };
  if (!state.overrides.some(e => (e.assetIndex ?? e.speciesId) === assetIndex) && (sides.front || sides.back)) {
    state.overrides.push({ speciesId, formIndex, assetIndex, ...sides, nativePaletteSource: "front", carrierTemplate: "w2u-gen6-placeholder" });
  }
  project.w2animAnimations.editorTargets[key] = { assetIndex, side: "front" };
}

export function hydrateW2AnimTrainerTarget(project: ProjectState, graphicIndex: number): void {
  if (!project.w2animAnimations) return;
  const key = `trainer:${graphicIndex}`;
  if (project.w2animAnimations.editorTargets[key]) return;
  const entry = archive(project).entries.find(e => e.arc === 71 && e.sheetFile === graphicIndex * 8 + 1);
  const state = project.trainerPwanAnimations ??= { overrides: [] };
  if (entry && !state.overrides.some(e => e.graphicIndex === graphicIndex)) {
    state.overrides.push({ graphicIndex, animation: editorSide(project, entry, true) });
  }
  project.w2animAnimations.editorTargets[key] = { graphicIndex, side: "front" };
}

function nearest(color: number, palette: Uint16Array): number {
  let best = 1, distance = Infinity;
  for (let n = 1; n < 16; n++) {
    const other = palette[n]!, d = ((color & 31) - (other & 31)) ** 2 + ((color >> 5 & 31) - (other >> 5 & 31)) ** 2 + ((color >> 10 & 31) - (other >> 10 & 31)) ** 2;
    if (d < distance) { best = n; distance = d; }
  }
  return best;
}

function convertEdit(project: ProjectState, entry: W2AnimEntry, side: PwanOverrideSide, trainer: boolean): { mani: Uint8Array; first: Uint8Array } {
  const header = validatePwan(side.pwanBytes), pal = pwanPalette(side.pwanBytes);
  const frames = Array.from({ length: header.frameCount }, (_, n) => {
    let frame = w2animEditorToLinear(side.pwanBytes.subarray(header.frameOffset + n * 4608, header.frameOffset + (n + 1) * 4608));
    if (trainer) {
      if (frame.subarray(0, 8 * 48).some(value => value !== 0)) throw new Error("Trainer edit has pixels above the supported carrier canvas; move it down at least eight rows");
      const shifted = new Uint8Array(4608); shifted.set(frame.subarray(8 * 48)); frame = shifted;
    }
    return frame;
  });
  const timeline = pwanTimeline(side.pwanBytes).map(step => ({ frame: step.frameIndex, duration: step.ticks }));
  const normal = trainer ? pal : nativePalette(project, entry.shinyNclrFile - 1);
  const shiny = trainer ? pal : nativePalette(project, entry.shinyNclrFile);
  const original = archive(project).manis.get(entry.maniOffset);
  const own = trainer || Boolean(original?.flags && original.flags & W2ANIM_OWN_PALETTES) || pal.subarray(1).some((color, n) => color !== normal[n + 1]);
  const normalOwn = pal.slice(); normalOwn[0] = normal[0]!;
  const shinyOwn = Uint16Array.from({ length: 16 }, (_, n) => n === 0 ? shiny[0]! : shiny[nearest(pal[n]!, normal)]!);
  // Retain an original own-palette shiny mapping when only pixels/timing changed.
  if (own && original?.normalPalette && original.shinyPalette && original.normalPalette.every((color, n) => color === normalOwn[n]))
    shinyOwn.set(original.shinyPalette);
  return { mani: encodeW2AnimMani({ frames, sequence: timeline, normalPalette: own ? normalOwn : undefined, shinyPalette: own ? shinyOwn : undefined }),
    first: frames[timeline[0]!.frame]! };
}

function patchNativeSheet(project: ProjectState, sheet: number, first: Uint8Array, template?: Uint8Array): Uint8Array {
  const input = template ?? project.narcs.pokemon_sprites?.rawFiles[sheet];
  if (!input) throw new Error(`Missing w2anim native sheet ${sheet}`);
  const bytes = new Uint8Array(input[0] === 0x10 || input[0] === 0x11 ? decompressNitro(input) : input);
  let block = -1;
  for (let n = 16; n + 32 <= bytes.length; n += 4) if (readAscii(bytes, n, 4) === "RAHC") { block = n; break; }
  if (block < 0) throw new Error("Native w2anim sheet has no RAHC block");
  const size = readU32(bytes, block + 24), start = block + 8 + readU32(bytes, block + 28);
  if (size < 16384 || start < block + 32 || start + size > bytes.length) throw new Error("Native w2anim sheet is not a 256x128 TEX4 carrier");
  for (let y = 0; y < 96; y++) bytes.set(first.subarray(y * 48, (y + 1) * 48), start + y * 128);
  return encodeW2AnimLz10(bytes);
}

function commonCarrier(project: ProjectState, source: W2AnimArchive): number {
  const groups = new Map<string, { count: number; block: number }>();
  for (const entry of source.entries) {
    const mani = source.manis.get(entry.maniOffset)!;
    if (entry.arc !== 4 || entry.sheetFile % 20 !== 2 || mani.width !== 96 || mani.height !== 96 || !(mani.flags & W2ANIM_TEX4)) continue;
    const block = Math.floor(entry.sheetFile / 20);
    const files = [4, 5, 6, 7, 8].map(member => project.narcs.pokemon_sprites?.rawFiles[block * 20 + member]);
    if (files.some(file => !file?.length)) continue;
    const key = files.map(file => Array.from(file!).join(",")).join(";");
    const current = groups.get(key);
    if (current) { current.count++; current.block = Math.min(current.block, block); }
    else groups.set(key, { count: 1, block });
  }
  const carrier = [...groups.values()].sort((a, b) => b.count - a.count || a.block - b.block)[0];
  if (!carrier) throw new Error("This w2anim ROM has no compatible 96x96 carrier for a new animation");
  return carrier.block;
}

/** w2anim exports never call the PWAN carrier patch or install a PWAN DLL. */
export async function materializeW2AnimAnimations(project: ProjectState, rom: NintendoDSRom): Promise<void> {
  if (!project.w2animAnimations) hydrateW2AnimFromRom(project, rom);
  const state = project.w2animAnimations!;
  if (!project.pwanAnimations?.dirty && !project.trainerPwanAnimations?.dirty) return;
  const source = archive(project), updates = new Map<string, { entry: W2AnimEntry; mani: Uint8Array } | null>();
  const sheets = new Map<number, Uint8Array>();
  const apply = (arc: number, sheetFile: number, side: PwanOverrideSide | undefined, trainer: boolean): void => {
    const old = source.entries.find(e => e.arc === arc && e.sheetFile === sheetFile), key = `${arc}:${sheetFile}`;
    const original = state.editorOriginals[key];
    if (!side) {
      if (original && old) {
        updates.set(key, null);
        if (!trainer) for (const alias of source.entries) if (alias.arc === arc && alias.sheetFile === sheetFile + 1 && alias.maniOffset === old.maniOffset) updates.set(w2animKey(alias), null);
      }
      return;
    }
    if (original && equal(original, side.pwanBytes)) return;
    const entry = old ?? { arc, sheetFile, maniOffset: 0, flags: trainer ? W2ANIM_CARRIER : 0,
      shinyNclrFile: trainer ? (source.entries.find(value => value.arc === 71 && value.flags & W2ANIM_CARRIER)?.shinyNclrFile ?? commonCarrier(project, source) * 20) : Math.floor(sheetFile / 20) * 20 + 19 };
    if (old) editable(source.manis.get(old.maniOffset)!);
    const edit = convertEdit(project, entry, side, trainer);
    updates.set(key, { entry, mani: edit.mani });
    if (!trainer) {
      let template: Uint8Array | undefined;
      if (!old) {
        const carrier = commonCarrier(project, source), back = sheetFile % 20 === 11, sideOffset = back ? 9 : 0;
        const base = Math.floor(sheetFile / 20) * 20, store = project.narcs.pokemon_sprites!;
        if (base + 19 >= store.rawFiles.length) throw new Error("New w2anim target is outside the native sprite archive");
        for (const member of [4, 5, 6, 7, 8]) sheets.set(base + sideOffset + member, store.rawFiles[carrier * 20 + sideOffset + member]!.slice());
        template = store.rawFiles[carrier * 20 + sideOffset + 2];
        if (!template?.length) throw new Error("Carrier is missing the requested animation side");
      }
      sheets.set(sheetFile, patchNativeSheet(project, sheetFile, edit.first, template));
      if (!old && project.narcs.pokemon_sprites!.rawFiles[sheetFile + 1]?.length) {
        const alias = { ...entry, sheetFile: sheetFile + 1 };
        updates.set(w2animKey(alias), { entry: alias, mani: edit.mani });
        sheets.set(alias.sheetFile, patchNativeSheet(project, alias.sheetFile, edit.first, template));
      }
      for (const alias of source.entries) if (old && alias.arc === arc && alias.sheetFile === sheetFile + 1 && alias.maniOffset === old.maniOffset) {
        updates.set(w2animKey(alias), { entry: alias, mani: edit.mani }); sheets.set(alias.sheetFile, patchNativeSheet(project, alias.sheetFile, edit.first));
      }
    } else if (!old && sheetFile >= project.narcs.trainer_sprites!.rawFiles.length) throw new Error("New trainer animation is outside the native archive");
  };
  if (project.pwanAnimations?.dirty) {
    const overrides = project.pwanAnimations.overrides;
    const assets = new Set([...Object.values(state.editorTargets).flatMap(target => target.assetIndex === undefined ? [] : [target.assetIndex]),
      ...overrides.map(override => override.assetIndex ?? resolvePokemonSpriteId(project, override.speciesId, override.formIndex ?? 0))]);
    for (const asset of assets) {
      const override = overrides.find(value => (value.assetIndex ?? resolvePokemonSpriteId(project, value.speciesId, value.formIndex ?? 0)) === asset);
      apply(4, asset * 20 + 2, override?.front, false); apply(4, asset * 20 + 11, override?.back, false);
    }
  }
  if (project.trainerPwanAnimations?.dirty) {
    if (!await ensureTrainerSpriteStore(project)) throw new Error("Load Trainer Sprites before editing w2anim trainers");
    const overrides = project.trainerPwanAnimations.overrides;
    const graphics = new Set([...Object.values(state.editorTargets).flatMap(target => target.graphicIndex === undefined ? [] : [target.graphicIndex]), ...overrides.map(value => value.graphicIndex)]);
    for (const graphic of graphics) apply(71, graphic * 8 + 1, overrides.find(value => value.graphicIndex === graphic)?.animation, true);
  }
  const bytes = materializeW2AnimArchive(source, updates);
  // All conversions, native carrier checks and archive validation succeeded.
  // Commit replacements atomically; unsupported edits never partially stage.
  for (const [sheet, bytes] of sheets) { project.narcs.pokemon_sprites!.rawFiles[sheet] = bytes; markDirty(project, "pokemon_sprites", sheet); }
  if (updates.size || project.fileSystem?.replacements[state.fileId]) setRomFileReplacement(project, state.fileId, bytes);
}
