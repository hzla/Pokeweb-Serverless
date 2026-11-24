import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { LEADER_PANEL_WIDTH, LEADER_PANEL_X } from "./leaders";
import { quantizeFrames } from "../../src/pokeweb/gifAnimationFrames";

const [sourceDir, draydenPath, outputDir] = process.argv.slice(2);
assert(sourceDir && draydenPath && outputDir, "Pass the source directory, Drayden PNG, and output directory");

// Each crop specifies the face center and the bottom source row. Roxie's
// guitar is detached above this cutoff, so start to the right of it.
const crops = {
  cheren: [255, 296],
  roxie: [618, 485, 440],
  burgh: [112, 49],
  elesa: [411, 387],
  clay: [107, 75],
  skyla: [79, 87],
  drayden: [313, 191],
  marlon: [298, 299],
} satisfies Record<string, [number, number, number?]>;
// Representative colors sampled from each leader's native overworld sprite.
const accents: Record<keyof typeof crops, ReadonlyArray<readonly [number, string]>> = {
  cheren: [[0, "c00840"], [213, "587088"], [240, "484868"]],
  roxie: [[190, "4090b8"], [313, "b03068"]],
  burgh: [[0, "c03840"], [42, "986810"], [96, "88c828"]],
  elesa: [[57, "f8f070"], [192, "38b8e0"]],
  clay: [[42, "f0b000"], [157, "389070"]],
  skyla: [[351, "d03838"], [198, "4098c0"]],
  drayden: [[161, "307058"], [248, "504880"]],
  marlon: [[215, "1058c0"], [192, "48b0e0"]],
};

function toHsl([r, g, b]: number[]) {
  const high = Math.max(r, g, b), low = Math.min(r, g, b);
  const chroma = high - low, light = (high + low) / 2;
  if (chroma === 0) return { hue: 0, saturation: 0, light, chroma };
  const sextant = high === r ? (g - b) / chroma : high === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
  return { hue: (sextant * 60 + 360) % 360, saturation: chroma / (1 - Math.abs(2 * light - 1)), light, chroma };
}

function grade(rgb: number[], palette: ReadonlyArray<readonly [number, ReturnType<typeof toHsl>]>) {
  let { hue, saturation, light, chroma } = toHsl(rgb);
  const hueDifference = (target: number) => (target - hue + 540) % 360 - 180;
  // Preserve the white and gray details and avoid pushing skin toward fabric colors.
  const skin = hue >= 11 && hue < 36 && light > 0.44;
  const colorWeight = Math.min(1, chroma * 6) * (skin ? 0.33 : 1);
  saturation = Math.min(1, saturation * (1 + colorWeight * 0.29));
  const [sourceHue, reference] = palette.reduce((closest, accent) =>
    Math.abs(hueDifference(accent[0])) < Math.abs(hueDifference(closest[0])) ? accent : closest);
  const mix = 0.34 * colorWeight * Math.max(0, 1 - Math.abs(hueDifference(sourceHue)) / 33);
  saturation += Math.max(0, reference.saturation - saturation) * mix;
  hue = (hue + hueDifference(reference.hue) * mix + 360) % 360;
  light += 0.52 * light * (1 - light) * (2 * light - 1);
  const amplitude = saturation * Math.min(light, 1 - light);
  return [0, 8, 4].map(channel => {
    const k = (channel + hue / 30) % 12;
    return light - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
}

const linear = Array.from({ length: 256 }, (_, i) => i <= 10 ? i / 3294.6 : ((i / 255 + 0.055) / 1.055) ** 2.4);
const srgb = (v: number) => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const fiveBits = (v: number) => Math.max(0, Math.min(31, Math.round(v * 31))) << 3;

await mkdir(outputDir, { recursive: true });
for (const [name, [faceCenter, bottom, sourceLeft = 0]] of Object.entries(crops)) {
  const palette = accents[name as keyof typeof crops].map(([hue, hex]) =>
    [hue, toHsl([0, 2, 4].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255))] as const);
  const source = PNG.sync.read(await readFile(name === "drayden" ? draydenPath : join(sourceDir, name + ".png")));
  assert(faceCenter < source.width && bottom <= source.height, name);
  let left = source.width, right = 0;
  for (let y = 0; y < bottom; ++y) {
    for (let x = sourceLeft; x < source.width; ++x) {
      if (source.data[(y * source.width + x) * 4 + 3] < 128) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
    }
  }
  assert(right > left, `No visible portrait pixels for ${name}`);
  const margin = 2; // One outline pixel and one transparent pixel.
  const scale = Math.min(77 / bottom, (LEADER_PANEL_WIDTH - 2 * margin) / (right - left));
  const width = Math.round((right - left) * scale), height = Math.round(bottom * scale);
  const desiredLeft = Math.round(208 - LEADER_PANEL_X - (faceCenter - left) * scale);
  const artLeft = Math.max(margin, Math.min(desiredLeft, LEADER_PANEL_WIDTH - margin - width));
  const art = new PNG({ width: LEADER_PANEL_WIDTH, height: 80 });
  for (let y = 0; y < height; ++y) {
    const y0 = y * bottom / height, y1 = (y + 1) * bottom / height;
    for (let x = 0; x < width; ++x) {
      const x0 = left + x * (right - left) / width, x1 = left + (x + 1) * (right - left) / width;
      let alpha = 0;
      const channels = [0, 0, 0];
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); ++sy) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); ++sx) {
          const pos = (sy * source.width + sx) * 4;
          const area = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
          const coverage = area * source.data[pos + 3] / 255;
          alpha += coverage;
          channels.forEach((_, channel) => channels[channel] += coverage * linear[source.data[pos + channel]]);
        }
      }
      if (alpha < (x1 - x0) * (y1 - y0) * 0.5) continue;
      const dst = ((art.height - height + y) * art.width + artLeft + x) * 4;
      art.data.set([...grade(channels.map(value => srgb(value / alpha)), palette).map(fiveBits), 255], dst);
    }
  }
  const frame = { index: 0, width: art.width, height: art.height, delayMs: 0, pixels: new Uint8ClampedArray(art.data) };
  // One visible slot remains available for the outline supplied by the builder.
  art.data.set(quantizeFrames([frame], 254).frames[0].pixels);
  await writeFile(join(outputDir, name + ".png"), PNG.sync.write(art));
}
