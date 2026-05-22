import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { loadHgMoveAnimationRom, loadHgMoveSpaArchive } from "../src/pokeweb/hgMoveAnimationModel";

const repoRoot = resolve("..");
const state = loadHgMoveAnimationRom(new Uint8Array(readFileSync(resolve(repoRoot, "cleangold.nds"))));
const spa = loadHgMoveSpaArchive(state, 38);

const summary = spa.resources.map((resource) => ({
  emitter: resource.index,
  textureIndex: resource.textureIndex,
  drawType: resource.drawType,
  emissionType: resource.emissionType,
  emissionCount: resource.emissionCount,
  emitterBasePos: resource.emitterBasePos,
  baseScale: resource.baseScale,
  aspectRatio: resource.aspectRatio,
  color: resource.color,
  emitterLifeFrames: resource.emitterLifeFrames,
  particleLifeFrames: resource.particleLifeFrames,
  hasTexAnim: Boolean(resource.texAnim),
  texAnim: resource.texAnim,
  hasChild: Boolean(resource.childResource),
  childTextureIndex: resource.childResource?.textureIndex,
}));

const textureSummary = spa.textures.map((texture) => ({
  texture: texture.index,
  format: texture.format,
  width: texture.width,
  height: texture.height,
  transparentPixels: countTransparent(texture.rgba),
  opaquePixels: countOpaque(texture.rgba),
}));

writeFileSync("/tmp/spa38-summary.json", JSON.stringify({ summary, textureSummary, warnings: spa.warnings }, null, 2));
writeFileSync("/tmp/spa38-textures.png", makeContactSheet(spa.textures));
console.log(JSON.stringify({ summary, textureSummary, warnings: spa.warnings, textureSheet: "/tmp/spa38-textures.png" }, null, 2));

function countTransparent(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] === 0) count += 1;
  }
  return count;
}

function countOpaque(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] !== 0) count += 1;
  }
  return count;
}

function makeContactSheet(textures: typeof spa.textures): Buffer {
  const cell = 80;
  const label = 12;
  const png = new PNG({ width: cell * textures.length, height: cell + label, colorType: 6 });
  png.data.fill(0);
  for (const texture of textures) {
    const x0 = texture.index * cell + Math.floor((cell - texture.width) / 2);
    const y0 = label + Math.floor((cell - texture.height) / 2);
    for (let y = 0; y < texture.height; y += 1) {
      for (let x = 0; x < texture.width; x += 1) {
        const src = (y * texture.width + x) * 4;
        const dst = ((y0 + y) * png.width + (x0 + x)) * 4;
        png.data[dst] = texture.rgba[src];
        png.data[dst + 1] = texture.rgba[src + 1];
        png.data[dst + 2] = texture.rgba[src + 2];
        png.data[dst + 3] = texture.rgba[src + 3];
      }
    }
  }
  return PNG.sync.write(png);
}
