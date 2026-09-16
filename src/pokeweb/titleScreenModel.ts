import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readAscii, readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes, replaceRomFile } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";
import { parseNitroBackground, type NitroBackgroundImage } from "./nitroBg";
import { parseNitroCellEffect, type NitroCellEffect } from "./nitroCell";
import { parsePokemonAnimation, parsePokemonCellBank } from "./pokemonSpriteModel";
import { buildBattleModelScene, type BattleModelScene } from "./battleModelScene";
import { compileNitroAnimatedModel } from "./nitroAnimatedModel";
import { compileTitleScene } from "./titleScreenScene";

export const TITLE_GRAPHICS_PATH = "a/0/2/6";
export const TITLE_DEMO_PATH = "a/1/5/8";
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export type TitleVersion = "B2" | "W2";
export type TitleAsset = {
  id: string;
  label: string;
  filename: string;
  path: string;
  member: number;
  format: "NCGR" | "NSCR" | "NCLR" | "NCER" | "NANR" | "NSBMD" | "NSBCA" | "NSBTA" | "camera";
  compressed: boolean;
  storedBytes: Uint8Array;
  bytes: Uint8Array;
  changed: boolean;
};
export type TitleCamera = {
  frameCount: number;
  hasScale: boolean;
  hasRotation: boolean;
  hasTranslation: boolean;
  stride: number;
  bytes: Uint8Array;
};
export type TitleCameraFrame = { scale?: number[]; rotation?: number[]; position?: number[] };
export type TitleScreenDocument = { version: TitleVersion; assets: TitleAsset[]; camera: TitleCamera };
export type TitleComposition = { logo: NitroBackgroundImage; background: NitroBackgroundImage; credits: NitroBackgroundImage; prompt: NitroCellEffect };
const STAMPS = { NCGR: "RGCN", NSCR: "RCSN", NCLR: "RLCN", NCER: "RECN", NANR: "RNAN", NSBMD: "BMD0", NSBCA: "BCA0", NSBTA: "BTA0" };

type Definition = Omit<TitleAsset, "bytes" | "storedBytes" | "changed">;
export function titleAssetDefinitions(version: TitleVersion): Definition[] {
  const rows: Array<[string, string, TitleAsset["format"], boolean]> = [
    ["logo-tiles", "Logo / background tiles", "NCGR", true],
    ["logo-map", "Logo tilemap", "NSCR", true],
    ["logo-palette", "Logo / background palette", "NCLR", false],
    ["background-map", "Scrolling background tilemap", "NSCR", true],
    ["prompt-palette", "Press Start palette", "NCLR", false],
    ["prompt-tiles", "Press Start tiles", "NCGR", true],
    ["prompt-cells", "Press Start cells", "NCER", false],
    ["prompt-animation", "Press Start animation", "NANR", false],
    ["credits-palette", "Credits palette", "NCLR", false],
    ["credits-tiles", "Credits tiles", "NCGR", true],
    ["credits-map", "Credits tilemap", "NSCR", true],
  ];
  const result: Definition[] = rows.map(([id, label, format, compressed], member) => ({ id, label, format, compressed, member, path: TITLE_GRAPHICS_PATH, filename: `${id}.${format.toLowerCase()}` }));
  const start = version === "B2" ? 446 : 454;
  const prefix = version === "B2" ? "title_b" : "title_w";
  const models: Array<[string, string, TitleAsset["format"], string]> = [
    ["model-01-animation", "Kyurem skeletal animation", "NSBCA", "01"],
    ["model-01", "Kyurem model", "NSBMD", "01"],
    ["model-02-animation", "Additional geometry animation", "NSBCA", "02"],
    ["model-02", "Additional geometry", "NSBMD", "02"],
    ["model-03-animation", "Environment skeletal animation", "NSBCA", "03"],
    ["model-03", "Environment model", "NSBMD", "03"],
    ["model-03-texture-animation", "Environment texture animation", "NSBTA", "03"],
    ["camera", "Camera track", "camera", "camera"],
  ];
  models.forEach(([id, label, format, suffix], index) => result.push({ id, label, format, compressed: false, member: start + index, path: TITLE_DEMO_PATH, filename: `${prefix}_${suffix}.${format === "camera" ? "bin" : format.toLowerCase()}` }));
  return result;
}

function versionOf(project: ProjectState): TitleVersion {
  if (project.session.baseRom !== "BW2" || !["B2", "W2"].includes(project.session.baseVersion)) throw new Error("The title-screen editor supports Black 2 and White 2.");
  return project.session.baseVersion as TitleVersion;
}

async function loadArchives(project: ProjectState) {
  const version = versionOf(project);
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("Reload the ROM to open its title-screen assets.");
  const rom = new NintendoDSRom(bytes);
  const archives = new Map([TITLE_GRAPHICS_PATH, TITLE_DEMO_PATH].map((path) => {
    const fileId = rom.fileId(path);
    return [path, { fileId, original: new NARC(rom.files[fileId]), current: new NARC(getRomFileBytes(project, rom, fileId)) }] as const;
  }));
  return { version, rom, archives };
}

export async function loadTitleScreenDocument(project: ProjectState): Promise<TitleScreenDocument> {
  const { version, archives } = await loadArchives(project);
  const assets = titleAssetDefinitions(version).map((definition) => {
    const archive = archives.get(definition.path)!;
    const storedBytes = archive.current.files[definition.member];
    if (!storedBytes) throw new Error(`Missing ${definition.label} at ${definition.path}/${definition.member}. This ROM's title layout is unsupported.`);
    const bytes = decodeNative(definition, storedBytes);
    validateTitleAsset(definition, bytes);
    return { ...definition, bytes, storedBytes, changed: !equalBytes(storedBytes, archive.original.files[definition.member]) };
  });
  return { version, assets, camera: parseTitleCamera(assets.find((asset) => asset.id === "camera")!.bytes) };
}

function decodeNative(definition: Definition, bytes: Uint8Array): Uint8Array {
  // Camera files have no magic; their frame count can start with 0x10.
  if (definition.format === "camera") {
    if (bytes.length > MAX_ASSET_BYTES) throw new Error("Camera exceeds 2 MiB.");
    return bytes.slice();
  }
  return decodeTitleAsset(bytes);
}

/** Bounded LZ10 decoding: malformed native imports must not become zero-filled graphics. */
export function decodeTitleAsset(data: Uint8Array): Uint8Array {
  if (!data.length || data.length > MAX_ASSET_BYTES) throw new Error("Title asset must contain between 1 byte and 2 MiB.");
  if (data[0] !== 0x10) return data.slice();
  if (data.length < 4) throw new Error("Truncated LZ10 header.");
  const size = data[1] | data[2] << 8 | data[3] << 16;
  if (!size || size > MAX_ASSET_BYTES) throw new Error("Invalid title asset decompressed size.");
  const output = new Uint8Array(size);
  let input = 4, offset = 0;
  while (offset < size) {
    if (input >= data.length) throw new Error("Truncated LZ10 data.");
    const flags = data[input++];
    for (let bit = 7; bit >= 0 && offset < size; bit--) {
      if (flags & (1 << bit)) {
        if (input + 2 > data.length) throw new Error("Truncated LZ10 back-reference.");
        const a = data[input++], b = data[input++];
        const length = (a >> 4) + 3, distance = ((a & 15) << 8 | b) + 1;
        if (distance > offset || offset + length > size) throw new Error("Invalid LZ10 back-reference.");
        for (let n = 0; n < length; n++, offset++) output[offset] = output[offset - distance];
      } else {
        if (input >= data.length) throw new Error("Truncated LZ10 literal.");
        output[offset++] = data[input++];
      }
    }
  }
  return output;
}

/** Literal-only LZ10 is accepted by the original title loaders. */
export function encodeTitleLz10(data: Uint8Array): Uint8Array {
  if (!data.length || data.length > MAX_ASSET_BYTES) throw new Error("Invalid title asset size.");
  const out = new Uint8Array(4 + data.length + Math.ceil(data.length / 8));
  out.set([0x10, data.length & 255, data.length >> 8 & 255, data.length >> 16 & 255]);
  let cursor = 4;
  for (let i = 0; i < data.length; i += 8) {
    out[cursor++] = 0;
    const chunk = data.subarray(i, i + 8);
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

export function parseTitleCamera(bytes: Uint8Array): TitleCamera {
  if (bytes.length < 8) throw new Error("Camera track is missing its 8-byte header.");
  const frameCount = readU32(bytes, 0);
  const flags = [bytes[4], bytes[5], bytes[6]];
  if (flags.some((f) => f > 1) || flags[1] !== 1 || flags[2] !== 1) throw new Error("Title cameras require rotation and translation tracks with valid presence flags.");
  const stride = flags.reduce((sum, f) => sum + f * 12, 0);
  if (!frameCount || frameCount > 65535 || bytes.length !== 8 + stride * frameCount) throw new Error("Camera frame count does not match its data size.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset < bytes.length; offset += 4) {
    const value = view.getFloat32(offset, true);
    if (!Number.isFinite(value) || Math.abs(value) >= 524288) throw new Error("Camera contains a non-finite or out-of-range fixed-point value.");
  }
  return { frameCount, hasScale: Boolean(flags[0]), hasRotation: Boolean(flags[1]), hasTranslation: Boolean(flags[2]), stride, bytes };
}

export function titleCameraFrame(camera: TitleCamera, frame: number): TitleCameraFrame {
  if (!Number.isInteger(frame) || frame < 0 || frame >= camera.frameCount) throw new Error("Camera frame is outside the track.");
  let offset = 8 + frame * camera.stride;
  const view = new DataView(camera.bytes.buffer, camera.bytes.byteOffset, camera.bytes.byteLength);
  const read = () => { const value = [0, 4, 8].map((n) => view.getFloat32(offset + n, true)); offset += 12; return value; };
  return { scale: camera.hasScale ? read() : undefined, rotation: camera.hasRotation ? read() : undefined, position: camera.hasTranslation ? read() : undefined };
}

export function titleNitroBlocks(bytes: Uint8Array): Map<string, number> {
  if (bytes.length < 16 || readU16(bytes, 4) !== 0xfeff || readU32(bytes, 8) !== bytes.length || readU16(bytes, 12) !== 16) throw new Error("Invalid Nitro resource header or size.");
  const count = readU16(bytes, 14);
  if (!count || count > 16) throw new Error("Invalid Nitro block count.");
  const is3d = ["BMD0", "BCA0", "BTA0"].includes(readAscii(bytes, 0, 4));
  const blocks = new Map<string, number>();
  let cursor = 16;
  for (let i = 0; i < count; i++) {
    if (is3d && 20 + i * 4 > bytes.length) throw new Error("Truncated Nitro block table.");
    const offset = is3d ? readU32(bytes, 16 + i * 4) : cursor;
    if (offset < (is3d ? 16 + count * 4 : 16) || offset + 8 > bytes.length) throw new Error("Invalid Nitro block offset.");
    const size = readU32(bytes, offset + 4);
    if (size < 8 || offset + size > bytes.length) throw new Error("Truncated Nitro block.");
    blocks.set(readAscii(bytes, offset, 4), offset);
    cursor = offset + size;
  }
  return blocks;
}

export function titleAnimationFrames(bytes: Uint8Array): number {
  const stamp = readAscii(bytes, 0, 4);
  const block = titleNitroBlocks(bytes).get(stamp === "BCA0" ? "JNT0" : "SRT0");
  if (block === undefined || block + 16 > bytes.length) throw new Error("Missing title animation block.");
  const dict = block + 8;
  if (bytes[dict + 1] !== 1) throw new Error("Title resources must contain one animation.");
  const entries = dict + readU16(bytes, dict + 6);
  if (entries + 8 > bytes.length || readU16(bytes, entries) !== 4) throw new Error("Invalid animation dictionary.");
  const animation = block + readU32(bytes, entries + 4);
  if (animation + 8 > bytes.length || readAscii(bytes, animation, 4) !== (stamp === "BCA0" ? "J\0AC" : "M\0AT")) throw new Error("Invalid animation data.");
  return readU16(bytes, animation + 4);
}

function validateTitleAsset(asset: Definition, bytes: Uint8Array): void {
  if (asset.format === "camera") { parseTitleCamera(bytes); return; }
  if (readAscii(bytes, 0, Math.min(bytes.length, 4)) !== STAMPS[asset.format]) throw new Error(`${asset.label} requires ${asset.format} data (exported native files may be decompressed or LZ10-compressed).`);
  const blocks = titleNitroBlocks(bytes);
  if (asset.format === "NSBCA" || asset.format === "NSBTA") {
    if (!titleAnimationFrames(bytes)) throw new Error("Animation has no frames.");
  } else if (asset.format === "NSBMD") {
    if (!blocks.has("MDL0") || !blocks.has("TEX0")) throw new Error("Title models require model data and embedded textures.");
  } else if (asset.format === "NCER") {
    const offset = blocks.get("KBEC");
    if (offset === undefined || offset + 20 > bytes.length) throw new Error("Missing title cell data.");
    const cells = parsePokemonCellBank(bytes);
    if (!cells.cells.length || cells.cells.length !== readU16(bytes, offset + 8) || cells.cells.some((cell) => cell.nAttribs !== cell.oams.length)) throw new Error("Truncated title cell bank.");
  } else if (asset.format === "NANR") {
    const offset = blocks.get("KNBA");
    if (offset === undefined || offset + 24 > bytes.length) throw new Error("Missing title sprite animation data.");
    const animation = parsePokemonAnimation(bytes);
    if (!animation.sequences.length || animation.sequences.length !== readU16(bytes, offset + 8) || animation.sequences.some((sequence) => !sequence.frames.length || sequence.frames.length !== sequence.frameCount || sequence.frames.every((frame) => !frame.duration))) throw new Error("Truncated or empty title sprite animation.");
  } else if (asset.format === "NCGR") {
    const offset = blocks.get("RAHC");
    if (offset === undefined || offset + 32 > bytes.length) throw new Error("Missing tile data.");
    const bpp = asset.id === "logo-tiles" ? 4 : 3;
    const size = readU32(bytes, offset + 24);
    const limit = asset.id === "logo-tiles" ? 0x8000 : 0x4000;
    if (readU32(bytes, offset + 12) !== bpp || size > limit || !size || offset + 32 + size > bytes.length) throw new Error("Tile bit depth or size exceeds the title layer's allocation.");
  } else if (asset.format === "NCLR") {
    const offset = blocks.get("TTLP");
    if (offset === undefined || offset + 24 > bytes.length || (readU32(bytes, offset + 16) < 32 || readU32(bytes, offset + 16) % 2 !== 0 || readU32(bytes, offset + 16) > 512) || offset + 24 + readU32(bytes, offset + 16) > bytes.length) throw new Error("Invalid title palette (maximum 256 colors).");
  } else if (asset.format === "NSCR") {
    const offset = blocks.get("NRCS");
    if (offset === undefined || offset + 20 > bytes.length || readU16(bytes, offset + 8) !== 256 || ![192, 256].includes(readU16(bytes, offset + 10)) || readU32(bytes, offset + 16) !== 256 * readU16(bytes, offset + 10) / 32 || offset + 20 + readU32(bytes, offset + 16) > bytes.length) throw new Error("Title tilemaps must contain a complete 256×192 or 256×256 map.");
  }
}

export function decodeTitleComposition(document: TitleScreenDocument): TitleComposition {
  const get = (id: string) => document.assets.find((asset) => asset.id === id)!.bytes;
  const cells = parsePokemonCellBank(get("prompt-cells"));
  const animation = parsePokemonAnimation(get("prompt-animation"));
  if (animation.sequences.some((sequence) => sequence.frames.some((frame) => frame.cellIndex >= cells.cells.length))) throw new Error("Press Start animation references a missing cell.");
  const options = { transparentIndexZero: true };
  return {
    logo: parseNitroBackground(1, get("logo-map"), get("logo-tiles"), get("logo-palette"), options),
    background: parseNitroBackground(3, get("background-map"), get("logo-tiles"), get("logo-palette"), options),
    credits: parseNitroBackground(10, get("credits-map"), get("credits-tiles"), get("credits-palette"), options),
    prompt: parseNitroCellEffect("title", 5, 4, 6, 7, get("prompt-tiles"), get("prompt-palette"), get("prompt-cells"), get("prompt-animation"), { originCentered: true }),
  };
}

export function decodeTitleModel(asset: TitleAsset, animation?: TitleAsset, textureAnimation?: TitleAsset, frame = 7300): BattleModelScene {
  const model = compileNitroAnimatedModel(asset.bytes, animation?.bytes, textureAnimation?.bytes);
  model.sample(frame);
  return buildBattleModelScene(asset.member, model.primitives, model.textures, model.textures.map((t) => t.name));
}

export function exportTitleBundle(document: TitleScreenDocument): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const assets = document.assets.map((asset) => {
    const file = `native/${asset.filename}`;
    files[file] = asset.bytes;
    return { id: asset.id, file, archive: asset.path, member: asset.member, format: asset.format, romCompression: asset.compressed ? "lz10" : "none" };
  });
  files["manifest.json"] = strToU8(JSON.stringify({ format: "pokeweb-title-screen", version: 1, game: document.version, assets }, null, 2));
  files["README.txt"] = strToU8("Native title assets are decompressed for external editing. Pokeweb restores required compression on import. Keep filenames and manifest.json when rebuilding this ZIP. PNG import is not supported. The bottom-screen preview plays the model, joint, texture and recorded camera tracks together. Preserve model/animation bindings and the title timeline (event frames 7001, 7300, 7780).\n");
  return zipSync(files);
}

export function readTitleBundle(bytes: Uint8Array, version: TitleVersion): Map<string, Uint8Array> {
  if (bytes.length > 16 * 1024 * 1024) throw new Error("Title bundle exceeds 16 MiB.");
  let total = 0;
  const files = unzipSync(bytes, { filter: (file) => {
    total += file.originalSize;
    if (file.originalSize > MAX_ASSET_BYTES || total > 16 * 1024 * 1024) throw new Error("Title bundle expands beyond its size limits.");
    return true;
  } });
  const manifest = files["manifest.json"];
  if (!manifest) throw new Error("Choose a Pokeweb title bundle containing manifest.json.");
  const parsed = JSON.parse(strFromU8(manifest));
  if (parsed.format !== "pokeweb-title-screen" || parsed.version !== 1 || parsed.game !== version || !Array.isArray(parsed.assets)) throw new Error(`This bundle must be a version 1 title bundle for ${version}.`);
  const definitions = titleAssetDefinitions(version);
  const imports = new Map<string, Uint8Array>();
  for (const entry of parsed.assets) {
    const definition = definitions.find((asset) => asset.id === entry.id);
    if (!definition || imports.has(entry.id) || entry.file !== `native/${definition.filename}` || !files[entry.file]) throw new Error("Bundle contains an unknown, duplicate, or missing native asset.");
    imports.set(entry.id, files[entry.file]);
  }
  if (!imports.size) throw new Error("The bundle has no title assets.");
  return imports;
}

/** Validate a complete candidate scene before committing either archive. */
export async function importTitleAssets(project: ProjectState, imports: Map<string, Uint8Array>): Promise<number> {
  const { version, rom, archives } = await loadArchives(project);
  const definitions = titleAssetDefinitions(version);
  const changes: Array<{ definition: Definition; stored: Uint8Array }> = [];
  for (const [id, input] of imports) {
    const definition = definitions.find((asset) => asset.id === id);
    if (!definition) throw new Error(`Unknown title asset: ${id}`);
    const current = archives.get(definition.path)!.current.files[definition.member];
    if (!current) throw new Error(`Missing title asset: ${id}`);
    const bytes = decodeNative(definition, input);
    validateTitleAsset(definition, bytes);
    if (equalBytes(bytes, decodeNative(definition, current))) continue;
    if ((definition.format === "NSBCA" || definition.format === "NSBTA") && titleAnimationFrames(bytes) <= 7780) throw new Error("Replacement title animations must include event frame 7780 (at least 7781 frames).");
    if (definition.format === "camera" && parseTitleCamera(bytes).frameCount <= 7780) throw new Error("Replacement camera must include event frame 7780 (at least 7781 frames).");
    if (definition.format === "NSBMD") compileNitroAnimatedModel(bytes);
    changes.push({ definition, stored: definition.compressed ? encodeTitleLz10(bytes) : bytes });
  }
  if (!changes.length) return 0;
  for (const { definition, stored } of changes) archives.get(definition.path)!.current.files[definition.member] = stored;
  const assets = definitions.map((definition) => { const storedBytes = archives.get(definition.path)!.current.files[definition.member]; return { ...definition, storedBytes, bytes: decodeNative(definition, storedBytes), changed: false }; });
  const candidate = { version, assets, camera: parseTitleCamera(assets.find((asset) => asset.id === "camera")!.bytes) };
  const composition = decodeTitleComposition(candidate);
  if (changes.some(({ definition }) => definition.format.startsWith("NSB"))) compileTitleScene(candidate);
  const warnings = [composition.logo, composition.background, composition.credits, composition.prompt].flatMap((image) => image.warnings);
  if (warnings.length) throw new Error(`Replacement resources do not form a valid title: ${[...new Set(warnings)].join("; ")}`);
  const paths = [...new Set(changes.map(({ definition }) => definition.path))];
  const writes = paths.map((path) => { const archive = archives.get(path)!; return { fileId: archive.fileId, bytes: archive.current.save() }; });
  for (const write of writes) replaceRomFile(project, rom, write.fileId, write.bytes);
  return changes.length;
}

function equalBytes(a: Uint8Array, b?: Uint8Array): boolean {
  return Boolean(b && a.length === b.length && a.every((value, i) => value === b[i]));
}
