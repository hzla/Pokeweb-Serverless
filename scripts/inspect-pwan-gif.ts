import { readFile } from "node:fs/promises";
import { compileGifToPwan } from "../src/pokeweb/pwanCompiler";

const gifPath = process.argv[2];
if (!gifPath) throw new Error("Usage: npm run pwan:gif:inspect -- sprite.gif");

const bytes = new Uint8Array(await readFile(gifPath));
const startedAt = performance.now();
const result = compileGifToPwan(bytes);
console.log(JSON.stringify({
  sourceBytes: bytes.length,
  compileMilliseconds: Math.round(performance.now() - startedAt),
  frameCount: result.frameCount,
  uniqueFrameCount: result.uniqueFrameCount,
  timelineCount: result.timelineCount,
  outputBytes: result.pwanBytes.length,
  warnings: result.warnings,
}, null, 2));
