import { unzlibSync } from "fflate";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { modelAssetHash, type readStaticGlb } from "./buildingGlb";
import { type Map3dPrimitive } from "./map3dModel";
import { sameStaticGeometry } from "./staticMeshCompare";
import type { StaticModelMesh } from "./nitroModelWriter";
import { ensure, materialRecords, replaceMaterialRecords, type NativeMaterialRecord } from "./nitroResourceWriter";
import { encodeNitroTexture, type EncodedTexture, type ImportTexture } from "./nitroTextureWriter";

type Imported = ReturnType<typeof readStaticGlb>;
type Appearance = { image?: Omit<ImportTexture, "name">; color: number[]; alpha: number; repeatS: boolean; repeatT: boolean; flipS: boolean; flipT: boolean; emissive: boolean; key: string };
const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const srgb = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const color555 = (values: number[]) => values.reduce((n, v, i) => n | Math.round(Math.max(0, Math.min(1, v)) * 31) << (5 * i), 0);

/** Embedded PNG reader shared by browser and CLI import validation; no external image requests. */
export function decodeGlbPng(bytes: Uint8Array): Omit<ImportTexture, "name"> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  ensure(bytes.length >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a, "Import textures as embedded PNG images.");
  const width = view.getUint32(16), height = view.getUint32(20), depth = bytes[24], type = bytes[25];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  ensure(width >= 8 && height >= 8 && width <= 1024 && height <= 1024 && !(width & (width - 1)) && !(height & (height - 1)), "Texture dimensions must be powers of two from 8 to 1024.");
  ensure(channels && (depth === 8 || (type === 3 && [1, 2, 4].includes(depth))) && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0, "Use non-interlaced 8-bit RGB/RGBA or indexed PNG textures.");
  let palette = new Uint8Array(), transparency = new Uint8Array(); const parts: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset); ensure(offset + 12 + length <= bytes.length, "Truncated PNG chunk.");
    const name = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)), data = bytes.subarray(offset + 8, offset + 8 + length);
    if (name === "IDAT") parts.push(data); if (name === "PLTE") palette = data.slice(); if (name === "tRNS") transparency = data.slice(); offset += length + 12;
  }
  ensure(type !== 3 || palette.length > 0, "Indexed PNG is missing its palette.");
  const packed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { packed.set(p, at); at += p.length; }
  const rowBytes = Math.ceil(width * channels * depth / 8), stride = Math.max(1, channels * depth / 8), expected = (rowBytes + 1) * height;
  const raw = unzlibSync(packed, { out: new Uint8Array(expected) }); ensure(raw.length === expected, "Invalid PNG pixel length.");
  const rows = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)]; ensure(filter <= 4, "Invalid PNG filter.");
    for (let x = 0; x < rowBytes; x++) {
      const i = y * rowBytes + x, a = x >= stride ? rows[i - stride] : 0, b = y ? rows[i - rowBytes] : 0, c = y && x >= stride ? rows[i - rowBytes - stride] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      rows[i] = raw[y * (rowBytes + 1) + 1 + x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >>> 1 : filter === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0);
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    if (type === 3) { const index = (rows[Math.floor(i * depth / 8)] >>> (8 - depth - (i * depth % 8))) & ((1 << depth) - 1); ensure(index * 3 + 2 < palette.length, "PNG palette index out of range."); rgba.set([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], transparency[index] ?? 255], i * 4); }
    else if (type === 0 || type === 4) rgba.set([rows[p], rows[p], rows[p], type === 4 ? rows[p + 1] : transparency.length >= 2 && rows[p] === transparency[1] ? 0 : 255], i * 4);
    else { const transparent = type === 2 && transparency.length >= 6 && [0, 1, 2].every(a => rows[p + a] === transparency[a * 2 + 1]); rgba.set([rows[p], rows[p + 1], rows[p + 2], type === 6 ? rows[p + 3] : transparent ? 0 : 255], i * 4); }
  }
  return { width, height, rgba };
}

export class GlbMaterialCompiler {
  readonly textures = new Map<string, EncodedTexture>();
  readonly notes = new Set<string>();
  private appearances = new Map<number, Promise<Appearance>>();
  constructor(private imported: Imported) {}
  private appearance(id: number): Promise<Appearance> {
    let value = this.appearances.get(id); if (!value) { value = this.readAppearance(id); this.appearances.set(id, value); } return value;
  }
  private async readAppearance(id: number): Promise<Appearance> {
    const { document: doc, binary } = this.imported, m = doc.materials?.[id]; ensure(m, "Missing GLB material.");
    ensure(!m.normalTexture && !m.occlusionTexture && !m.pbrMetallicRoughness?.metallicRoughnessTexture, `Material ${m.name} uses unsupported surface maps. Bake its appearance into a color texture.`);
    ensure(Object.keys(m.extensions ?? {}).every(k => ["KHR_materials_unlit", "KHR_materials_emissive_strength"].includes(k)), `Material ${m.name} uses an unsupported shader extension.`);
    const base = m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1], emission = m.emissiveFactor ?? [0, 0, 0];
    ensure(base.length === 4 && emission.length === 3 && [...base, ...emission].every((v: number) => Number.isFinite(v) && v >= 0 && v <= 1), "Invalid material color.");
    const emissive = emission.some((v: number) => v > 0), pureEmission = emissive && base.slice(0, 3).every((v: number) => v === 0);
    const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    ensure(strength === 1, `Material ${m.name}: bake emission strength into the texture (DS colors cannot exceed white).`);
    ensure(!m.emissiveTexture || pureEmission || !m.pbrMetallicRoughness?.baseColorTexture, `Material ${m.name}: bake separate color and emission textures into one image.`);
    const textureInfo = pureEmission ? m.emissiveTexture : m.pbrMetallicRoughness?.baseColorTexture ?? m.emissiveTexture;
    let image: Appearance["image"], sampler: any = {};
    if (textureInfo) {
      ensure((textureInfo.texCoord ?? 0) === 0 && !textureInfo.extensions, "Texture transforms and extra UV sets must be baked into UV0 before import.");
      const t = doc.textures?.[textureInfo.index], source = doc.images?.[t?.source], b = doc.bufferViews?.[source?.bufferView];
      ensure(source && b && !source.uri && (b.buffer ?? 0) === 0 && Number.isSafeInteger(b.byteLength) && b.byteLength > 0 && Number.isSafeInteger(b.byteOffset ?? 0) && (b.byteOffset ?? 0) >= 0 && (b.byteOffset ?? 0) + b.byteLength <= doc.buffers[0].byteLength, "Use embedded PNG textures with valid buffer bounds.");
      image = decodeGlbPng(binary.subarray(b.byteOffset ?? 0, (b.byteOffset ?? 0) + b.byteLength)); sampler = doc.samplers?.[t.sampler] ?? {};
      const factor = pureEmission ? emission : base;
      for (let i = 0; i < image.rgba.length; i += 4) {
        for (let a = 0; a < 3; a++) image.rgba[i + a] = Math.round(Math.min(1, srgb(linear(image.rgba[i + a] / 255) * factor[a] + (!pureEmission ? emission[a] : 0))) * 255);
        if ((m.alphaMode ?? "OPAQUE") === "OPAQUE") image.rgba[i + 3] = 255;
        else if (m.alphaMode === "MASK") image.rgba[i + 3] = image.rgba[i + 3] / 255 * base[3] >= (m.alphaCutoff ?? 0.5) ? 255 : 0;
      }
    }
    const wrap = (value: number | undefined) => { ensure(value === undefined || [10497, 33071, 33648].includes(value), "Unsupported texture wrapping."); return { repeat: value !== 33071, flip: value === 33648 }; };
    const s = wrap(sampler.wrapS), t = wrap(sampler.wrapT);
    const color = pureEmission ? emission : base.slice(0, 3).map((v: number, i: number) => Math.min(1, v + emission[i]));
    const alpha = m.alphaMode === "BLEND" ? base[3] : 1;
    const hash = image ? await modelAssetHash(image.rgba) : "";
    return { image, color, alpha, repeatS: s.repeat, repeatT: t.repeat, flipS: s.flip, flipT: t.flip, emissive,
      key: JSON.stringify([image?.width, image?.height, hash, image ? null : color, alpha, s, t, emissive]) };
  }
  async compile(template: Uint8Array, meshes: StaticModelMesh[], original: Map3dPrimitive[]) {
    const records = materialRecords(template), output: StaticModelMesh[] = [], changedNames = new Map<string, string>();
    let changed = false;
    for (const mesh of meshes) {
      ensure(mesh.materialIndex !== undefined, "GLB mesh has no material.");
      const a = await this.appearance(mesh.materialIndex), source = original.find(p => p.material.name === mesh.materialName)?.material;
      const originalRecord = records.find(r => r.name === mesh.materialName);
      const pixelsEqual = source?.texture && a.image && source.texture.width === a.image.width && source.texture.height === a.image.height && source.texture.rgba.length === a.image.rgba.length && source.texture.rgba.every((v, i) => Math.abs(v - a.image!.rgba[i]) <= 1);
      // Blender can normalize sampler metadata while retaining identical pixels. Preserve native wrap in that no-edit case.
      const same = source && originalRecord && Math.abs(source.alpha - a.alpha) < 0.002 && !a.emissive && (source.texture ? pixelsEqual : !a.image && source.diffuse.every((v, i) => Math.abs(v - a.color[i]) < 0.002));
      if (same) { output.push(mesh); continue; }
      if (a.image && mesh.uvs && source) {
        const clamped = [source.repeatS && !a.repeatS, source.repeatT && !a.repeatT];
        if (mesh.uvs.some((v, i) => clamped[i % 2] && (v < -0.001 || v > 1.001))) {
          this.notes.add(`Material ${mesh.materialName}: the GLB changes a repeating texture to Clamp to Edge while its UVs extend outside the image. This can turn walls into a solid edge color. Check the texture wrapping in Blender and the exported GLB before applying.`);
        }
      }
      changed = true;
      const key = `${mesh.materialName}:${a.key}`, previous = changedNames.get(key);
      let name = previous ?? mesh.materialName;
      if (!previous) {
        const occupied = [...changedNames].some(([key, name]) => name === mesh.materialName && key !== `${mesh.materialName}:${a.key}`);
        ensure(!occupied, `Material ${mesh.materialName} has multiple appearances in one model. Give its variants separate native material assignments.`);
        if (!originalRecord) name = `pw_m${(await modelAssetHash(new TextEncoder().encode(key))).slice(0, 12)}`;
        let texture: EncodedTexture | undefined;
        if (a.image) {
          const identity = new Uint8Array(4 + a.image.rgba.length); writeU16(identity, 0, a.image.width); writeU16(identity, 2, a.image.height); identity.set(a.image.rgba, 4);
          const hash = await modelAssetHash(identity), textureName = `pw_t${hash.slice(0, 12)}`;
          texture = this.textures.get(textureName);
          if (!texture) { texture = encodeNitroTexture({ ...a.image, name: textureName }); this.textures.set(textureName, texture); }
          if (texture.quantized) this.notes.add("Imported images were quantized to DS palette colors; review the converted preview.");
        }
        const bytes = originalRecord ? originalRecord.bytes.slice() : new Uint8Array(44);
        if (!originalRecord) { writeU16(bytes, 2, 44); writeU32(bytes, 16, 0x3f1ff8ff); writeU32(bytes, 24, 0xffffffff); writeU16(bytes, 30, 0x1fcf); writeU32(bytes, 36, 4096); writeU32(bytes, 40, 4096); }
        writeU32(bytes, 4, (color555(a.image ? [1, 1, 1] : a.color) | 0x8000 | 0x7fff0000) >>> 0);
        writeU32(bytes, 8, 0);
        let polygon = readU32(bytes, 12); polygon = (polygon & ~0x001f00cf) | (Math.max(1, Math.round(a.alpha * 31)) << 16) | 0xc0;
        writeU32(bytes, 12, polygon >>> 0);
        const params = (texture?.params ?? 0) | (a.repeatS ? 1 << 16 : 0) | (a.repeatT ? 1 << 17 : 0) | (a.flipS ? 1 << 18 : 0) | (a.flipT ? 1 << 19 : 0) | (readU32(bytes, 20) & 0xc0000000);
        writeU32(bytes, 20, params >>> 0); writeU16(bytes, 32, a.image?.width ?? 0); writeU16(bytes, 34, a.image?.height ?? 0);
        const record: NativeMaterialRecord = { name, bytes, textureName: texture?.name, paletteName: texture?.name };
        const index = records.findIndex(r => r.name === name); if (index < 0) records.push(record); else records[index] = record;
        changedNames.set(key, name);
      }
      const colors = new Float32Array(mesh.positions.length);
      for (let i = 0; i < colors.length; i++) colors[i] = (mesh.colors?.[i] ?? 1) * (a.image ? 1 : a.color[i % 3]);
      output.push({ ...mesh, materialName: name, colors });
    }
    // GLB UVs are already in the visible bind pose. Animation objects keep their material names and can animate them at runtime.
    for (const record of records) if ((changed || !sameStaticGeometry(original.map(p => ({ ...p, materialName: p.material.name })), meshes)) && output.some(m => m.materialName === record.name) && ((readU32(record.bytes, 20) >>> 30) === 1) && (readU16(record.bytes, 30) & 14) !== 14) {
      record.bytes = record.bytes.slice(0, 44); writeU16(record.bytes, 2, 44); writeU16(record.bytes, 30, readU16(record.bytes, 30) | 14); changed = true;
    }
    return { template: changed ? replaceMaterialRecords(template, records) : template, meshes: output, changed, signature: [...changedNames.keys()].sort().join("|") };
  }
}
