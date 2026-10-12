import { readAscii, readU16, readU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { parseNitroBackground, parseNitroPalette } from "./nitroBg";
import { parseNitroCellImage } from "./nitroCell";
import { decompressNitro, parsePokemonCellBank } from "./pokemonSpriteModel";
import { TRANSLATION_GAMES, translationSourceGame, translationDonorLocale, loadTranslationProfile, type TranslationLocaleId } from "./translationProfile";
import { readTranslationArchive, translationBytesEqual, translationMenuMapCompatible } from "./translationTransfer";

export type TranslationGraphicImage = { width: number; height: number; rgba: Uint8ClampedArray; warnings: string[] };
export type TranslationGraphic = {
  path: string; member: number; label: string; kind: "background" | "cell" | "tiles" | "texture";
  character?: number; palette?: number; cell?: number; texture?: string;
  palettes: number[]; retainedReason?: string;
};
export type TranslationGraphicsCatalog = {
  language: string; graphics: TranslationGraphic[]; issues: string[]; archivesCompared: number;
};
export type TranslationPreviewRom = { gameCode: string; revision: number; readFile(path: string): Promise<Uint8Array> };
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const TEXT_ARCHIVES = new Set(["a/0/0/2", "a/0/0/3", "a/1/1/2", "a/1/1/3", "a/1/1/4", "a/1/1/5"]);

/** Read only the header, file tables and requested archives. Never retain an entire ROM for previews. */
export async function openTranslationPreviewRom(blob: Blob): Promise<TranslationPreviewRom> {
  const read = async (at: number, size: number, limit: number): Promise<Uint8Array> => {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at < 0 || size < 0 || size > limit || at + size > blob.size) throw new Error("ROM resource lies outside the file or exceeds the preview size limit.");
    return new Uint8Array(await blob.slice(at, at + size).arrayBuffer());
  };
  const header = await read(0, 0x200, 0x200);
  const [fnt, fat] = await Promise.all([
    read(readU32(header, 0x40), readU32(header, 0x44), 1024 * 1024),
    read(readU32(header, 0x48), readU32(header, 0x4c), 1024 * 1024),
  ]);
  if (fnt.length < 8 || !fat.length || fat.length % 8) throw new Error("Invalid ROM file tables.");
  const folderCount = readU16(fnt, 6), visited = new Set<number>();
  if (!folderCount || folderCount > 4096 || folderCount * 8 > fnt.length) throw new Error("Invalid ROM directory table.");
  const folder = (id: number): Folder => {
    if (id >= folderCount || visited.has(id)) throw new Error("Invalid or cyclic ROM directory table.");
    visited.add(id);
    const result = new Folder({ firstId: readU16(fnt, id * 8 + 4) });
    let at = readU32(fnt, id * 8);
    if (at < folderCount * 8 || at >= fnt.length) throw new Error("Invalid ROM directory offset.");
    while (at < fnt.length) {
      const control = fnt[at++];
      if (!control) return result;
      const size = control & 127;
      if (!size || at + size + (control & 128 ? 2 : 0) > fnt.length) throw new Error("Truncated ROM filename table.");
      const name = readAscii(fnt, at, size); at += size;
      if (control & 128) {
        const child = readU16(fnt, at); at += 2;
        if (child < 0xf000) throw new Error("Invalid ROM folder ID.");
        result.folders.push([name, folder(child - 0xf000)]);
      } else result.files.push(name);
    }
    throw new Error("Unterminated ROM directory.");
  };
  const filenames = folder(0);
  return {
    gameCode: readAscii(header, 12, 4), revision: header[30],
    async readFile(path) {
      const id = filenames.idOf(path);
      if (id === undefined || id * 8 + 8 > fat.length) throw new Error(`Missing ROM resource: ${path}`);
      const start = readU32(fat, id * 8), end = readU32(fat, id * 8 + 4);
      return read(start, end - start, MAX_ARCHIVE_BYTES);
    },
  };
}

function unpack(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x10 && bytes[0] !== 0x11) return bytes;
  const size = readU32(bytes, 0) >>> 8 || readU32(bytes, 4);
  if (size > MAX_EXPANDED_BYTES) throw new Error("Resource exceeds the graphics preview size limit.");
  return decompressNitro(bytes);
}

type Layout = { member: number; character: number; palette: number; label: string };
function backgrounds(path: string): Layout[] {
  if (path === "a/0/1/1") return [...Array.from({ length: 16 }, (_, i) => i + 361), 571].map(member => ({ member, character: 358, palette: 359, label: `Battle screen ${member}` }));
  if (path === "a/0/7/7") return [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78].map(member => ({
    member, character: [67, 71, 77, 78].includes(member) ? 11 : [64, 65, 68, 72, 74].includes(member) ? 10 : 12,
    palette: [64, 65, 68, 72, 74].includes(member) ? 0 : 2,
    label: ({ 67: "Summary · info title", 71: "Summary · ribbons title", 77: "Summary · stats title", 78: "Summary · moves title (alternate)" } as Record<number, string>)[member] ?? `Summary screen ${member}`,
  }));
  if (path === "a/0/3/4") return [0, 2, 6, 7, 8, 9].map(member => ({ member, character: member === 2 ? 3 : 1, palette: member === 2 ? 4 : 5, label: `Main menu · layout ${member}` }));
  return [];
}
function spritePairs(path: string): Array<{ character: number; palette: number; member: number; label: string }> {
  if (path === "a/0/1/1") return [435, 438, 441, 444].map(character => ({ character, palette: 430, member: character + 1, label: `Battle HP panel ${character}` }));
  if (path === "a/0/3/4") return [10, 14, 18].map(character => ({ character, palette: character + 1, member: character + 2, label: `Main menu · sprites ${character}` }));
  return [];
}
function defaultPalette(path: string, member: number, palettes: number[]): number | undefined {
  if (path === "a/0/1/1" && [427, 434, 435, 438, 441, 444].includes(member)) return 430;
  if (path === "a/0/7/7") return member === 10 ? 0 : member === 11 || member === 12 ? 2 : undefined;
  return palettes.length === 1 ? palettes[0] : undefined;
}
function textureLabel(path: string, member: number, texture: string): string {
  if (path === "a/0/4/5" && member === 25) return "Musical · New label";
  if (path === "a/1/4/2" && member >= 32 && member <= 36) return `Poké Transfer · ${["Ready", "Start", "Time up", "Finish", "High score"][member - 32]}`;
  if (path === "a/1/7/4" && member === 6 && texture === "c4_musi01.1") return "Musical Theater · Sign";
  if (path === "a/1/1/6" && member === 244) return "Entralink · Time up";
  if (path === "a/1/1/6") return `Trainer intro · member ${member} · ${texture}`;
  if (path === "a/1/7/8" && member === 34) return "Link battle · VS";
  return `${path} · member ${member} · ${texture}`;
}
async function textures(bytes: Uint8Array) {
  const { readNitroResources, buildNitroTexturePreviews } = await import("./map3dModel");
  const resources = readNitroResources(bytes);
  if (resources.textures.reduce((sum, texture) => sum + texture.params.width() * texture.params.height(), 0) > 8 * 1024 * 1024) throw new Error("Texture pack exceeds the graphics preview dimensions limit.");
  return buildNitroTexturePreviews(resources);
}

function background(member: number, screen: Uint8Array, character: Uint8Array, palette: Uint8Array): TranslationGraphicImage {
  if (readU16(screen, 24) > 1024 || readU16(screen, 26) > 1024) throw new Error("Background exceeds the preview dimensions limit.");
  return parseNitroBackground(member, screen, character, palette, { transparentIndexZero: true });
}

/** Catalog metadata only; artwork is decoded again from the selected files when a preview is requested. */
export async function compareTranslationGraphics(source: TranslationPreviewRom, donor: TranslationPreviewRom, locale?: TranslationLocaleId, progress?: (message: string) => Promise<void>): Promise<TranslationGraphicsCatalog> {
  const game = translationSourceGame(source.gameCode);
  if (!game || source.revision !== 0) throw new Error("Choose US Black 2 or White 2 revision 0 for graphics comparison.");
  const detected = translationDonorLocale(donor.gameCode, game);
  if (!detected || donor.revision !== 0) throw new Error(`Choose an Italian, French, German, Spanish or Korean ${TRANSLATION_GAMES[game].title} revision-0 donor matching the US game.`);
  if (locale && locale !== detected.id) throw new Error(`The selected language does not match the ${detected.language} donor.`);
  const profile = await loadTranslationProfile(detected.id, game);
  const result: TranslationGraphicsCatalog = { language: detected.language, graphics: [], issues: [], archivesCompared: 0 };
  // All stock graphics archives are included, so graphics edits outside the usual regional set are visible too.
  for (const file of profile.files.filter(file => file.members !== undefined && !TEXT_ARCHIVES.has(file.path))) {
    await progress?.(`Comparing graphics · ${file.path}`);
    try {
      const [a, b] = await Promise.all([source.readFile(file.path), donor.readFile(file.donorPath)]);
      result.archivesCompared++;
      if (translationBytesEqual(a, b)) continue;
      const us = readTranslationArchive(a), incoming = readTranslationArchive(b);
      const expanded = incoming.files.map((bytes, member) => {
        if (us.files[member] && translationBytesEqual(us.files[member], bytes)) return undefined;
        try { return unpack(bytes); } catch (error) { result.issues.push(`${file.path} · member ${member}: ${String(error)}`); return undefined; }
      });
      const get = (member: number) => expanded[member] ?? unpack(incoming.files[member]);
      const changed = (members: number[]) => members.some(member => !us.files[member] || !incoming.files[member] || !translationBytesEqual(us.files[member], incoming.files[member]));
      const palettes = incoming.files.flatMap((bytes, member) => {
        try { return readAscii(get(member), 0, 4) === "RLCN" ? [member] : []; } catch { return []; }
      });
      const handled = new Set<number>(), pairedCharacters = new Set<number>();
      const visuallyDifferent = (a: TranslationGraphicImage, b: TranslationGraphicImage) => a.width !== b.width || a.height !== b.height || !translationBytesEqual(a.rgba, b.rgba);
      const add = (graphic: Omit<TranslationGraphic, "path" | "palettes">) => {
        let retainedReason: string | undefined;
        if (incoming.files.length !== file.members || us.files.length !== file.sourceMembers) retainedReason = "Archive member count changed; this archive is not transferred.";
        if (file.path === "a/0/3/4" && [6, 7].includes(graphic.member) && (!us.files[graphic.member] || !translationMenuMapCompatible(us.files[graphic.member], incoming.files[graphic.member]))) retainedReason = "US menu dimensions are retained; this donor layout is not transferred.";
        result.graphics.push({ ...graphic, path: file.path, palettes, retainedReason });
      };
      for (const layout of backgrounds(file.path)) {
        if ([layout.member, layout.character, layout.palette].every(member => incoming.files[member] && us.files[member]) && changed([layout.member, layout.character, layout.palette])) {
          const before = background(layout.member, unpack(us.files[layout.member]), unpack(us.files[layout.character]), unpack(us.files[layout.palette]));
          const after = background(layout.member, get(layout.member), get(layout.character), get(layout.palette));
          if (visuallyDifferent(before, after)) add({ ...layout, kind: "background" });
          handled.add(layout.member); pairedCharacters.add(layout.character);
        }
      }
      for (const pair of spritePairs(file.path)) {
        if (![pair.member, pair.character, pair.palette].every(member => incoming.files[member] && us.files[member]) || !changed([pair.member, pair.character, pair.palette])) continue;
        if (readU32(get(pair.character), 28) !== 3) continue; // Cell renderer supports 4bpp OBJ data.
        const count = Math.max(parsePokemonCellBank(get(pair.member)).cells.length, parsePokemonCellBank(unpack(us.files[pair.member])).cells.length);
        for (let cell = 0; cell < Math.min(count, 64); cell++) {
          const before = parseNitroCellImage(pair.label, unpack(us.files[pair.character]), unpack(us.files[pair.palette]), unpack(us.files[pair.member]), cell);
          const after = parseNitroCellImage(pair.label, get(pair.character), get(pair.palette), get(pair.member), cell);
          if (visuallyDifferent(before, after)) add({ ...pair, cell, label: `${pair.label} · cell ${cell}`, kind: "cell" });
        }
        if (count > 64) result.issues.push(`${file.path} · member ${pair.member}: first 64 sprite cells available in preview.`);
        handled.add(pair.member); pairedCharacters.add(pair.character);
      }
      for (let member = 0; member < incoming.files.length; member++) {
        const bytes = get(member), magic = readAscii(bytes, 0, 4);
        if (magic === "RGCN" && !pairedCharacters.has(member)) {
          const palette = defaultPalette(file.path, member, palettes);
          if (changed([member, ...(palette === undefined ? [] : [palette])]) && (!us.files[member] || !translationBytesEqual(unpack(us.files[member]), bytes) || palette !== undefined && changed([palette]))) add({ member, palette, kind: "tiles", label: `${file.path} · tile sheet ${member}` });
        }
        if (!expanded[member]) continue;
        if (magic === "BTX0" || magic === "BMD0") {
          const before = us.files[member] ? await textures(unpack(us.files[member])) : [];
          for (const texture of await textures(bytes)) {
            const old = before.find(item => item.name === texture.name);
            if (!texture.image) { result.issues.push(`${file.path} · member ${member} · ${texture.name}: no resolved texture palette.`); continue; }
            if (old?.image && old.width === texture.width && old.height === texture.height && translationBytesEqual(old.image.rgba, texture.image.rgba)) continue;
            add({ member, texture: texture.name, kind: "texture", label: textureLabel(file.path, member, texture.name) });
          }
        } else if (["RCSN", "RECN", "RNAN", "RCMN", "RAMN"].includes(magic) && !handled.has(member)) {
          result.issues.push(`${file.path} · member ${member}: changed layout/animation has no assembled preview.`);
        }
      }
    } catch (error) { result.issues.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return result;
}

/** A neutral tile atlas until a real palette is selected; never guess a multi-palette association. */
export function renderTranslationTileSheet(bytes: Uint8Array, paletteBytes?: Uint8Array, bank = 0): TranslationGraphicImage {
  if (readAscii(bytes, 0, 4) !== "RGCN") throw new Error("Unsupported tile sheet.");
  let block = readU16(bytes, 12);
  while (block + 8 <= bytes.length && readAscii(bytes, block, 4) !== "RAHC") {
    const size = readU32(bytes, block + 4);
    if (size < 8) throw new Error("Invalid tile block.");
    block += size;
  }
  const depth = readU32(bytes, block + 12), length = readU32(bytes, block + 24), at = block + 32;
  if (![3, 4].includes(depth) || at + length > bytes.length || length > MAX_EXPANDED_BYTES) throw new Error("Unsupported or truncated NCGR pixels.");
  const stride = depth === 4 ? 64 : 32, count = Math.floor(length / stride), width = 128, height = Math.max(8, Math.ceil(count / 16) * 8);
  if (height > 4096) throw new Error("Tile sheet exceeds the preview dimensions limit.");
  const palette = paletteBytes ? parseNitroPalette(paletteBytes) : undefined;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let tile = 0; tile < count; tile++) for (let pixel = 0; pixel < 64; pixel++) {
    const value = bytes[at + tile * stride + (depth === 4 ? pixel : pixel >> 1)];
    const index = depth === 4 ? value : pixel & 1 ? value >>> 4 : value & 15;
    const gray = Math.round(index * 255 / (depth === 4 ? 255 : 15));
    const color = palette?.[index + (depth === 4 ? 0 : bank * 16)] ?? [gray, gray, gray, 255];
    const dest = ((Math.floor(tile / 16) * 8 + Math.floor(pixel / 8)) * width + tile % 16 * 8 + pixel % 8) * 4;
    rgba.set(index === 0 ? [0, 0, 0, 0] : color, dest);
  }
  return { width, height, rgba, warnings: palette ? [] : ["Grayscale tile indices · select a palette to view colors."] };
}

export async function renderTranslationGraphic(rom: TranslationPreviewRom, graphic: TranslationGraphic, palette: number | null = graphic.palette ?? null, bank = 0): Promise<TranslationGraphicImage | undefined> {
  const archive = readTranslationArchive(await rom.readFile(graphic.path));
  if (!archive.files[graphic.member]) return undefined;
  const member = (id: number | undefined) => {
    if (id === undefined || !archive.files[id]) throw new Error("A required graphics component is missing.");
    return unpack(archive.files[id]);
  };
  if (graphic.kind === "tiles") return renderTranslationTileSheet(member(graphic.member), palette === null ? undefined : member(palette), bank);
  if (graphic.kind === "background") {
    const screen = member(graphic.member);
    return background(graphic.member, screen, member(graphic.character), member(palette ?? undefined));
  }
  if (graphic.kind === "cell") {
    if (!parsePokemonCellBank(member(graphic.member)).cells[graphic.cell ?? 0]) return undefined;
    return parseNitroCellImage(graphic.label, member(graphic.character), member(palette ?? undefined), member(graphic.member), graphic.cell);
  }
  const preview = (await textures(member(graphic.member))).find(item => item.name === graphic.texture);
  return preview?.image ? { width: preview.width, height: preview.height, rgba: new Uint8ClampedArray(preview.image.rgba), warnings: [] } : undefined;
}
