import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildVirtualSpriteAssetFromGif, encodeVirtualSpriteAsset } from "../src/pokeweb/virtualSpriteAsset";

const input = resolve(process.argv[2] ?? "../testgif.gif");
const output = resolve(process.argv[3] ?? "../desmume/pokeweb_assets/tepig_front.pwgf");

const asset = buildVirtualSpriteAssetFromGif(readFileSync(input));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, encodeVirtualSpriteAsset(asset));

console.log(
  JSON.stringify(
    {
      input,
      output,
      width: asset.width,
      height: asset.height,
      sourceFrames: asset.report.sourceFrameCount,
      uniqueFrames: asset.report.uniqueFrameCount,
      timelineEntries: asset.report.timelineEntryCount,
      totalTicks: asset.totalTicks,
      crop: asset.report.crop,
    },
    null,
    2,
  ),
);
