import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

const [root] = process.argv.slice(2);
if (!root) throw new Error('Usage: vite-node scripts/verify-map-cutscene-material-motion.ts CONTROLLED_CAPTURE_DIRECTORY');
async function motion(folder: string, flowersOnly = false) {
  const frames = await Promise.all([1200, 1230].map(async frame => PNG.sync.read(await fs.readFile(`${root}/${folder}/frame-${frame}.png`))));
  assert.ok(frames.every(png => png.width === 256 && png.height === 384));
  let changedPixels = 0;
  for (let i = 0; i < 256 * 192 * 4; i += 4) {
    const x = i / 4 % 256, y = Math.floor(i / (256 * 4));
    if (flowersOnly && (x < 85 || x >= 175 || y < 65 || y >= 138)) continue;
    if ([0, 1, 2].some(channel => frames[0].data[i + channel] !== frames[1].data[i + channel])) changedPixels++;
  }
  return changedPixels;
}
// The paired ROMs use identical stationary camera samples and geometry. Controls
// retain just BMD0; pattern-only controls retain BMD0 + BTP0, omitting BTA0.
const report = {
  waterScrolling: await motion('water-v4-Validation'),
  frozenWater: await motion('water-v4-static'),
  textureSwapsOnly: await motion('flower-pattern-only'),
  frozenFlowers: await motion('flower-static'),
  combinedAnimations: await motion('flower-Validation'),
  combinedFlowerRegion: await motion('flower-Validation', true),
};
assert.ok(report.waterScrolling > 500); assert.equal(report.frozenWater, 0);
assert.ok(report.textureSwapsOnly > 100); assert.equal(report.frozenFlowers, 0);
assert.ok(report.combinedAnimations > 100); assert.ok(report.combinedFlowerRegion > 100);
await fs.writeFile(`${root}/material-motion.json`, JSON.stringify({ passed: true, frames: [1200, 1230], changedPixels: report }, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, changedPixels: report }));
