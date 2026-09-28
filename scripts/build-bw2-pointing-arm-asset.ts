import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decodeTrainerSpritePalette, decodeTrainerSpriteRigAtlas } from "../src/pokeweb/trainerSpriteModel";

const assetDir = fileURLToPath(new URL("../../bw2-pointing-arm-assets/", import.meta.url));
const romPath = path.resolve(process.argv[2] ?? fileURLToPath(new URL("../../cleanwhite2.nds", import.meta.url)));
const rom = new NintendoDSRom(await readFile(romPath), { fileData: "view" });
if (!/^(IRD|IRE)/u.test(rom.idCode)) throw new Error(`Expected a BW2 ROM, got ${rom.idCode}`);
const archive = new NARC(rom.getFileByName("a/0/7/2"));

for (const [appearance, name] of [[0, "nate"], [1, "rosa"]] as const) {
  const source = PNG.sync.read(await readFile(path.join(assetDir, `${name}-pointing-arm-adapted-source.png`)));
  const files = archive.files.slice(appearance * 8, (appearance + 1) * 8);
  const palette = decodeTrainerSpritePalette(files);
  const atlas = decodeTrainerSpriteRigAtlas(files);

  // The right edge of each atlas contains the original arm parts. Restrict
  // the new sprite to colors actually present there, as well as transparency.
  const allowed = new Set<number>();
  for (let y = 0; y < atlas.height; y += 1) {
    for (let x = 200; x < atlas.width; x += 1) {
      const pixel = (y * atlas.width + x) * 4;
      if (atlas.pixels[pixel + 3] === 0) continue;
      const index = palette.findIndex((color) => color[0] === atlas.pixels[pixel]
        && color[1] === atlas.pixels[pixel + 1] && color[2] === atlas.pixels[pixel + 2]);
      if (index > 0) allowed.add(index);
    }
  }
  if (allowed.size === 0) throw new Error(`No opaque colors found in ${name}'s original arm graphics`);

  const alphaThreshold = 128;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.data[(y * source.width + x) * 4 + 3] < alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
    }
  }
  if (maxX <= minX || maxY <= minY) throw new Error("The pointing arm source has no visible pixels");

  const native = new PNG({ width: 64, height: 48 });
  const contentWidth = 62;
  const contentHeight = 44;
  const insetX = 1;
  const insetY = 2;
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  for (let y = 0; y < contentHeight; y += 1) {
    for (let x = 0; x < contentWidth; x += 1) {
      const sx = Math.min(maxX - 1, minX + Math.floor((x + 0.5) * sourceWidth / contentWidth));
      const sy = Math.min(maxY - 1, minY + Math.floor((y + 0.5) * sourceHeight / contentHeight));
      const sourceOffset = (sy * source.width + sx) * 4;
      if (source.data[sourceOffset + 3] < alphaThreshold) continue;
      let nearest = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const index of allowed) {
        const color = palette[index];
        const distance = (source.data[sourceOffset] - color[0]) ** 2
          + (source.data[sourceOffset + 1] - color[1]) ** 2
          + (source.data[sourceOffset + 2] - color[2]) ** 2;
        if (distance < bestDistance) { nearest = index; bestDistance = distance; }
      }
      const color = palette[nearest];
      native.data.set(color, ((y + insetY) * native.width + x + insetX) * 4);
    }
  }

  const scale = 4;
  const preview = new PNG({ width: native.width * scale, height: native.height * scale });
  for (let y = 0; y < preview.height; y += 1) {
    for (let x = 0; x < preview.width; x += 1) {
      const sourceOffset = (Math.floor(y / scale) * native.width + Math.floor(x / scale)) * 4;
      preview.data.set(native.data.subarray(sourceOffset, sourceOffset + 4), (y * preview.width + x) * 4);
    }
  }

  await writeFile(path.join(assetDir, `${name}-pointing-arm-64x48.png`), PNG.sync.write(native));
  await writeFile(path.join(assetDir, `${name}-pointing-arm-4x.png`), PNG.sync.write(preview));
  console.log(`${name}: ${native.width}x${native.height}; ${allowed.size} original arm palette colors available`);
}
