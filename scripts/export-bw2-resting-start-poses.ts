import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decodeTrainerSpriteAnimation } from "../src/pokeweb/trainerSpriteModel";

const defaultRom = fileURLToPath(new URL("../../cleanwhite2.nds", import.meta.url));
const defaultOutput = fileURLToPath(new URL("../../bw2-resting-start-poses/", import.meta.url));
const romPath = path.resolve(process.argv[2] ?? defaultRom);
const outputDir = path.resolve(process.argv[3] ?? defaultOutput);

const rom = new NintendoDSRom(await readFile(romPath), { fileData: "view" });
if (!/^(IRD|IRE)/u.test(rom.idCode)) throw new Error(`Expected a Black 2 or White 2 ROM, got ${rom.idCode}`);
const archive = new NARC(rom.getFileByName("a/0/7/2"));
if (archive.files.length < 16) throw new Error("The BW2 trainer back-sprite archive is missing a playable appearance");
await mkdir(outputDir, { recursive: true });

for (const [appearance, name] of [[0, "nate"], [1, "rosa"]] as const) {
  const files = archive.files.slice(appearance * 8, (appearance + 1) * 8);
  // NMAR sequence 0 is the starting/idle pose. Its multi-cell uses the
  // downward arm from the NCBR atlas; sequence 1 starts with the ball raised.
  const frame = decodeTrainerSpriteAnimation(files, 0).frames[0];
  if (!frame || frame.width < 2 || frame.height < 2) throw new Error(`${name} has no renderable starting pose`);

  const native = new PNG({ width: frame.width, height: frame.height });
  native.data = Buffer.from(frame.rgba);
  await writeFile(path.join(outputDir, `${name}-resting-start.png`), PNG.sync.write(native));

  const scale = 4;
  const enlarged = new PNG({ width: frame.width * scale, height: frame.height * scale });
  for (let y = 0; y < enlarged.height; y += 1) {
    for (let x = 0; x < enlarged.width; x += 1) {
      const source = (Math.floor(y / scale) * frame.width + Math.floor(x / scale)) * 4;
      const target = (y * enlarged.width + x) * 4;
      enlarged.data.set(frame.rgba.subarray(source, source + 4), target);
    }
  }
  await writeFile(path.join(outputDir, `${name}-resting-start-4x.png`), PNG.sync.write(enlarged));
  console.log(`${name}: ${frame.width}x${frame.height} at ${frame.x},${frame.y}`);
}
