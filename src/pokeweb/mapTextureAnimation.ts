import { NitroReader, type NitroTextureSrt } from "./nitroAnimation";
import type { DecodedTexture } from "./map3dModel";

export type MapTextureAnimation = {
  frameCount: number;
  /** Original normalized TEXCOORDs, before the model's static texture matrix. */
  rawUvs?: Float32Array;
  sample(frame: number): { srt?: NitroTextureSrt; texture?: DecodedTexture };
};

export type MapTexturePatternGroup = {
  frameCount: number;
  textureBytes: Uint8Array;
  keys: Array<{ frame: number; textureIndex: number; paletteIndex: number }>;
};

const align4 = (n: number) => (n + 3) & ~3;
export function textureAnimationFrame(frame: number, frameCount: number): number {
  return ((Math.floor(frame) % frameCount) + frameCount) % frameCount;
}

/** Gen 5's area PAT archive contains paired timing tables and BTX resources,
 * rather than NSBTP. Each timing table can drive several texture groups. */
export function readMapTexturePatterns(bytes: Uint8Array): MapTexturePatternGroup[] {
  const r = new NitroReader(bytes), count = r.u32(0), result: MapTexturePatternGroup[] = [];
  r.check(4, (count * 2 + 1) * 4);
  const headerEnd = 4 + (count * 2 + 1) * 4;
  for (let i = 0; i < count; i++) {
    const start = r.u32(4 + i * 8), texStart = r.u32(8 + i * 8), end = r.u32(12 + i * 8);
    if (start < headerEnd || texStart < start || end < texStart) throw new Error("Invalid map pattern offsets.");
    r.check(start, end - start);
    const table = new NitroReader(bytes.subarray(start, texStart)), keys = table.u32(0);
    if (!keys) throw new Error("Empty map pattern timing table.");
    const texIndices = align4(4 + keys * 2), palIndices = align4(texIndices + keys), groupsOffset = align4(palIndices + keys);
    table.check(4, keys * 2); table.check(texIndices, keys); table.check(palIndices, keys);
    const groups = table.u32(groupsOffset), startsOffset = groupsOffset + 4;
    table.check(startsOffset, groups);
    const frameCount = table.u32(align4(startsOffset + groups));
    if (!groups || !frameCount || groups > keys) throw new Error("Invalid map pattern group count or duration.");
    if (r.text(texStart, 4) !== "BTX0") throw new Error("Map pattern is missing its texture resource.");
    const textureBytes = bytes.subarray(texStart, end);
    for (let j = 0; j < groups; j++) {
      const first = table.u8(startsOffset + j), last = j + 1 < groups ? table.u8(startsOffset + j + 1) : keys;
      if (last <= first || last > keys || (j === 0 && first !== 0)) throw new Error("Invalid map pattern group boundaries.");
      const frames = Array.from({ length: last - first }, (_, k) => ({
        frame: table.u16(4 + (first + k) * 2), textureIndex: table.u8(texIndices + first + k), paletteIndex: table.u8(palIndices + first + k),
      }));
      if (frames[0].frame !== 0 || frames.some((f, k) => f.frame >= frameCount || (k > 0 && f.frame <= frames[k - 1].frame))) throw new Error("Invalid map pattern keyframes.");
      result.push({ frameCount, textureBytes, keys: frames });
    }
  }
  return result;
}

export type NitroTexturePattern = {
  name: string; frameCount: number;
  tracks: Array<{ name: string; keys: Array<{ frame: number; textureName?: string; paletteName?: string }> }>;
};

/** Standard NSBTP, used by animated props. Texture and palette indices are
 * independent; missing name tables retain the model's original binding. */
export function readNitroTexturePatterns(bytes: Uint8Array): NitroTexturePattern[] {
  const r = new NitroReader(bytes), section = r.block("BTP0", "PAT0");
  return r.dictionary(section + 8, 4).map(entry => {
    const base = section + r.u32(entry.offset), frameCount = r.u16(base + 4);
    if (r.text(base, 4) !== "M\0PT" || !frameCount) throw new Error("Invalid texture pattern header.");
    const names = (count: number, offset: number) => Array.from({ length: count }, (_, i) => r.text(base + offset + i * 16, 16).split("\0")[0]);
    const textures = names(r.u8(base + 6), r.u16(base + 8)), palettes = names(r.u8(base + 7), r.u16(base + 10));
    const tracks = r.dictionary(base + 12, 8).map(track => {
      const count = r.u16(track.offset), start = base + r.u16(track.offset + 6);
      if (!count) throw new Error("Empty texture pattern track.");
      r.check(start, count * 4);
      const keys = Array.from({ length: count }, (_, i) => {
        const off = start + i * 4, tex = r.u8(off + 2), pal = r.u8(off + 3);
        if ((textures.length && !textures[tex]) || (palettes.length && !palettes[pal])) throw new Error("Invalid texture pattern binding.");
        return { frame: r.u16(off), textureName: textures[tex], paletteName: palettes[pal] };
      });
      if (keys[0].frame !== 0 || keys.some((k, i) => k.frame >= frameCount || (i > 0 && k.frame <= keys[i - 1].frame))) throw new Error("Invalid texture pattern keyframes.");
      return { name: track.name, keys };
    });
    return { name: entry.name, frameCount, tracks };
  });
}

export function sampleTexturePattern<T extends { frame: number }>(keys: T[], frame: number, frameCount: number): T {
  const f = textureAnimationFrame(frame, frameCount);
  let lo = 0, hi = keys.length;
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (keys[mid].frame <= f) lo = mid; else hi = mid; }
  return keys[lo];
}
