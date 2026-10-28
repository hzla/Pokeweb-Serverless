import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { extractGameFreakContainer, readNitroResources } from "./map3dModel";
import { align, ensure, materialRecords, nitroBlocks, readDictionary, replaceMaterialRecords, writeDictionary, writeNitroFile } from "./nitroResourceWriter";

export const equalMapBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Validate before using permissive preview readers on user-selected binaries. */
export function validateMapNitro(bytes: Uint8Array, stamp: "BMD0" | "BTX0"): Uint8Array[] {
  ensure(bytes.length >= 20 && readAscii(bytes, 0, 4) === stamp, `Expected a native ${stamp === "BMD0" ? "NSBMD model" : "NSBTX texture file"}.`);
  const count = readU16(bytes, 14), size = readU32(bytes, 8), header = 16 + count * 4;
  ensure(readU16(bytes, 4) === 0xfeff && readU16(bytes, 12) === 16 && count > 0 && count <= 16 && size === bytes.length && header <= size, "Invalid Nitro file header or size.");
  let end = header;
  for (let i = 0; i < count; i++) {
    const start = readU32(bytes, 16 + 4 * i);
    ensure(start >= end && start + 8 <= size, "Nitro sections overlap or are truncated.");
    end = start + readU32(bytes, start + 4);
    ensure(end >= start + 8 && end <= size, "Invalid Nitro section size.");
  }
  const blocks = nitroBlocks(bytes);
  ensure(blocks.filter(b => readAscii(b, 0, 4) === (stamp === "BMD0" ? "MDL0" : "TEX0")).length === 1, "Missing or duplicate native resource section.");
  return blocks;
}

export function validateGen5Permissions(bytes: Uint8Array): void {
  const end = 4 + 32 * 32 * 8;
  ensure(bytes.length >= end && readU16(bytes, 0) === 32 && readU16(bytes, 2) === 32, "Gen 5 PER files must contain a complete 32 × 32 collision grid.");
  ensure((bytes.length - end) % 8 === 0, "Truncated collision corner-height records.");
  for (let i = 4; i < end; i += 8) if ((readU16(bytes, i) & 3) === 2) {
    const corner = end + readU16(bytes, i + 2) * 8;
    ensure(corner + 8 <= bytes.length, "Collision tile references a missing corner-height record.");
    ensure(readU16(bytes, corner) > 0 && (readU16(bytes, corner) & 3) === 1, "Invalid collision corner slope reference.");
  }
}

export function readGen5MapBin(bytes: Uint8Array): { signature: string; files: Uint8Array[]; placements: number } {
  ensure(bytes.length >= 20 && readAscii(bytes, 0, 2) === "WB", "Choose a native Gen 5 map BIN. Gen 4 map BINs cannot be imported into BW/BW2.");
  const count = readU16(bytes, 2), header = 4 + (count + 1) * 4;
  ensure(count >= 3 && count <= 64 && header <= bytes.length, "Invalid Gen 5 map member count.");
  let last = header;
  for (let i = 0; i <= count; i++) {
    const offset = readU32(bytes, 4 + 4 * i);
    ensure(offset >= last && offset <= bytes.length, "Map sections overlap their header or exceed the file."); last = offset;
  }
  ensure(last === bytes.length, "Map BIN contains data outside its declared sections.");
  const parsed = extractGameFreakContainer(bytes);
  validateMapNitro(parsed.files[0], "BMD0"); validateGen5Permissions(parsed.files[1]);
  const second = parsed.files[2];
  const hasSecond = second.length >= 4 && readU16(second, 0) === 32 && readU16(second, 2) === 32;
  if (hasSecond) validateGen5Permissions(second);
  const placements = hasSecond ? 3 : 2, table = parsed.files[placements];
  ensure(table && table.length >= 4 && readU32(table, 0) <= 32 && 4 + readU32(table, 0) * 16 <= table.length, "Invalid or oversized Gen 5 building placement table.");
  return { ...parsed, placements };
}

type TextureBank = ReturnType<typeof textureBank>;
function textureBank(file: Uint8Array) {
  const stamp = readAscii(file, 0, 4);
  ensure(stamp === "BMD0" || stamp === "BTX0", "Choose an NSBMD or NSBTX texture source.");
  const blocks = validateMapNitro(file, stamp), index = blocks.findIndex(b => readAscii(b, 0, 4) === "TEX0");
  ensure(index >= 0, "The selected file contains no embedded textures.");
  const block = blocks[index]; ensure(block.length >= 60, "Truncated TEX0 header.");
  const bank = (pointer: number, length: number) => {
    if (!length) return new Uint8Array();
    const at = readU32(block, pointer); ensure(at >= 60 && at + length <= block.length, "Truncated native texture bank.");
    return block.slice(at, at + length);
  };
  const textures = readDictionary(block, readU16(block, 14)), palettes = readDictionary(block, readU32(block, 52));
  ensure(new Set(textures.map(t => t.name)).size === textures.length && new Set(palettes.map(p => p.name)).size === palettes.length, "Duplicate native texture or palette names.");
  const pixels = bank(20, readU16(block, 12) * 8), compressed = bank(36, readU16(block, 28) * 8);
  const indices = bank(40, compressed.length / 2), colors = bank(56, readU16(block, 48) * 8);
  for (const t of textures) {
    ensure(t.data.length === 8, "Invalid texture dictionary stride.");
    const params = readU32(t.data, 0), format = (params >>> 26) & 7, width = 8 << ((params >>> 20) & 7), height = 8 << ((params >>> 23) & 7);
    const length = width * height * ([0, 8, 2, 4, 8, 2, 8, 16][format]) / 8, offset = (params & 0xffff) * 8;
    ensure(format > 0 && offset + length <= (format === 5 ? compressed : pixels).length, `Texture ${t.name} has invalid pixel bounds.`);
  }
  for (const p of palettes) ensure(p.data.length === 4 && readU16(p.data, 0) * 8 < colors.length, `Palette ${p.name} has invalid bounds.`);
  return { blocks, index, block, textures, palettes, pixels, compressed, indices, colors };
}

function textureEqual(a: TextureBank, ad: Uint8Array, b: TextureBank, bd: Uint8Array) {
  const ap = readU32(ad, 0), bp = readU32(bd, 0);
  if ((ap >>> 16) !== (bp >>> 16) || !equalMapBytes(ad.subarray(4), bd.subarray(4))) return false;
  const format = (ap >>> 26) & 7, length = (8 << ((ap >>> 20) & 7)) * (8 << ((ap >>> 23) & 7)) * [0, 8, 2, 4, 8, 2, 8, 16][format] / 8;
  const ao = (ap & 0xffff) * 8, bo = (bp & 0xffff) * 8;
  return equalMapBytes((format === 5 ? a.compressed : a.pixels).subarray(ao, ao + length), (format === 5 ? b.compressed : b.pixels).subarray(bo, bo + length))
    && (format !== 5 || equalMapBytes(a.indices.subarray(ao / 2, (ao + length) / 2), b.indices.subarray(bo / 2, (bo + length) / 2)));
}

/** Copy native banks, including 4×4 compression and palette flags, without quantization. */
export function mergeGen5MapTextures(destination: Uint8Array, source: Uint8Array, model: Uint8Array, namespace = false): { textures: Uint8Array; model: Uint8Array; added: number } {
  const dst = textureBank(destination), src = textureBank(source);
  if (!namespace && equalMapBytes(dst.block, src.block)) return { textures: destination, model, added: 0 };
  const texNames = new Map<string, string>(), palNames = new Map<string, string>();
  let hash = 2166136261; for (const byte of src.block) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  let added = 0;
  const names = (kind: "textures" | "palettes", mapping: Map<string, string>) => {
    for (const [index, entry] of src[kind].entries()) {
      let attempt = 0;
      const base = `i${hash.toString(16)}${kind === "textures" ? "t" : "p"}${index.toString(36)}`;
      let name = base;
      for (;;) {
        const existing = dst[kind].find(e => e.name === name);
        if (!existing) break;
        let same: boolean;
        if (kind === "textures") same = textureEqual(src, entry.data, dst, existing.data);
        else {
          const start = readU16(entry.data, 0) * 8, end = Math.min(...src.palettes.map(p => readU16(p.data, 0) * 8).filter(n => n > start), src.colors.length);
          const other = readU16(existing.data, 0) * 8;
          same = equalMapBytes(entry.data.subarray(2), existing.data.subarray(2)) && equalMapBytes(src.colors.subarray(start, end), dst.colors.subarray(other, other + end - start));
        }
        if (same) break;
        name = `${base.slice(0, 12)}_${++attempt}`;
        ensure(attempt < 1000, "Unable to allocate an imported texture name.");
      }
      mapping.set(entry.name, name);
    }
  };
  names("textures", texNames); names("palettes", palNames);
  const textures = dst.textures.map(e => ({ ...e, data: e.data.slice() })), palettes = dst.palettes.map(e => ({ ...e, data: e.data.slice() }));
  const paletteBase = align(dst.colors.length, 16);
  for (const entry of src.textures) {
    const name = texNames.get(entry.name)!; if (textures.some(e => e.name === name)) continue;
    const data = entry.data.slice(), params = readU32(data, 0), offset = (params & 0xffff) * 8 + (((params >>> 26) & 7) === 5 ? dst.compressed.length : dst.pixels.length);
    ensure(offset / 8 <= 65535, "Texture address exceeds the native range.");
    writeU32(data, 0, ((params & 0xffff0000) | offset / 8) >>> 0); textures.push({ name, data }); added++;
  }
  for (const entry of src.palettes) {
    const name = palNames.get(entry.name)!; if (palettes.some(e => e.name === name)) continue;
    const data = entry.data.slice(); writeU16(data, 0, readU16(data, 0) + paletteBase / 8); palettes.push({ name, data });
  }
  let result = destination;
  if (textures.length !== dst.textures.length || palettes.length !== dst.palettes.length) {
    const pixels = concatBytes([dst.pixels, src.pixels]), compressed = concatBytes([dst.compressed, src.compressed]), indices = concatBytes([dst.indices, src.indices]);
    const colors = concatBytes([dst.colors, new Uint8Array(paletteBase - dst.colors.length), src.colors]);
    ensure(pixels.length + compressed.length * 1.5 <= 256 * 1024 && colors.length <= 32 * 1024, "Imported texture resources exceed the DS texture/palette memory budget.");
    const td = writeDictionary(textures, 8), pd = writeDictionary(palettes, 4), pixelAt = align(60 + td.length + pd.length, 8);
    const compressedAt = pixelAt + pixels.length, indexAt = compressedAt + compressed.length, paletteAt = align(indexAt + indices.length, 8);
    const out = new Uint8Array(paletteAt + colors.length); out.set(dst.block.subarray(0, 60)); writeU32(out, 4, out.length);
    writeU16(out, 12, pixels.length / 8); writeU16(out, 14, 60); writeU32(out, 20, pixelAt);
    writeU16(out, 28, compressed.length / 8); writeU16(out, 30, 60); writeU32(out, 36, compressedAt); writeU32(out, 40, indexAt);
    writeU16(out, 48, colors.length / 8); writeU32(out, 52, 60 + td.length); writeU32(out, 56, paletteAt);
    out.set(td, 60); out.set(pd, 60 + td.length); out.set(pixels, pixelAt); out.set(compressed, compressedAt); out.set(indices, indexAt); out.set(colors, paletteAt);
    dst.blocks[dst.index] = out; result = writeNitroFile(destination, dst.blocks);
  }
  const records = materialRecords(model), changed = records.some(r => (r.textureName && texNames.get(r.textureName) !== undefined && texNames.get(r.textureName) !== r.textureName)
    || (r.paletteName && palNames.get(r.paletteName) !== undefined && palNames.get(r.paletteName) !== r.paletteName));
  const rewritten = changed ? replaceMaterialRecords(model, records.map(r => ({ ...r, textureName: r.textureName ? texNames.get(r.textureName) ?? r.textureName : undefined,
    paletteName: r.paletteName ? palNames.get(r.paletteName) ?? r.paletteName : undefined }))) : model;
  const resources = readNitroResources(result);
  for (const r of materialRecords(rewritten)) {
    ensure(!r.textureName || resources.textures.some(t => t.name === r.textureName), `Missing texture ${r.textureName}.`);
    ensure(!r.paletteName || resources.palettes.some(p => p.name === r.paletteName), `Missing palette ${r.paletteName}.`);
  }
  return { textures: result, model: rewritten, added };
}
