import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGifFrames } from '../src/pokeweb/gifAnimationFrames';
import { a3i5SourceColorCount, compileA3i5SpritePreview, shouldMakeA3i5Preview, type A3i5SpritePreview } from './lib/a3i5-sprite-preview';

// Adds comparison-only data to an existing refresh; never touches ROM/library assets.
const output = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: vite-node scripts/add-a3i5-sprite-comparisons.ts <comparison-folder>');
const report = JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));
if (report.format !== 'pokeweb-sprite-refresh-v1' || !Array.isArray(report.sprites)) throw new Error('Not a sprite refresh comparison');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(output,'a3i5-assets'),{recursive:true});
await mkdir(path.join(output,'a3i5'),{recursive:true});
const failures: {id:string;error:string}[] = [];
let eligible = 0, skipped = 0;
const packageValue = (value:A3i5SpritePreview) => ({...value,frames:Buffer.from(value.frames).toString('base64')});
for (const [index,row] of report.sprites.entries()) {
  if (!/^[0-9]+_(front|back)$/.test(row.id)) throw new Error('Unsafe sprite ID');
  if (row.status !== 'imported') {row.a3i5={eligible:false,reason:'No imported source GIF'};skipped++;continue;}
  try {
    const gif = new Uint8Array(await readFile(path.join(output,'sources',row.id+'.gif'))), frames=decodeGifFrames(gif);
    const sourceColorCount=a3i5SourceColorCount(frames);
    row.a3i5={eligible:shouldMakeA3i5Preview(sourceColorCount),sourceColorCount};
    if (!row.a3i5.eligible) {skipped++;continue;}
    const options={timingScale:row.timingScale,groundShift:row.groundShift};
    const normal=compileA3i5SpritePreview(frames,options), gen5=compileA3i5SpritePreview(frames,{...options,colorPreset:'gen5'});
    const payload={new:packageValue(normal),gen5:packageValue(gen5)};
    row.a3i5={...row.a3i5,visibleColors:{new:normal.visibleColors,gen5:gen5.visibleColors},frameCount:{new:normal.frameCount,gen5:gen5.frameCount},totalTicks:{new:normal.totalTicks,gen5:gen5.totalTicks},sha256:{new:createHash('sha256').update(normal.frames).digest('hex'),gen5:createHash('sha256').update(gen5.frames).digest('hex')}};
    await writeFile(path.join(output,'a3i5-assets',row.id+'.js'),`window.spriteA3i5[${JSON.stringify(row.id)}]=${JSON.stringify(payload)};\n`);
    for(const [kind,value] of Object.entries(payload)) await writeFile(path.join(output,'a3i5',row.id+'-'+kind+'.json'),JSON.stringify(value)+'\n');
    eligible++;
  } catch(error) {failures.push({id:row.id,error:String(error)});}
  if (index % 25 === 0) console.log(`Checked ${index+1}/${report.sprites.length} sprites (${eligible} A3I5 candidates)`);
}
if (failures.length) {await writeFile(path.join(output,'a3i5-failures.json'),JSON.stringify(failures,null,2)+'\n');throw new Error(`${failures.length} A3I5 comparisons failed; page manifest unchanged`);}
report.a3i5={comparisonOnly:true,threshold:'original GIF has more than 16 visible colors across its full animation, excluding transparency',eligibleSides:eligible,skippedSides:skipped,paletteColors:32,romModified:false,libraryModified:false};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(output,'manifest.js'),`window.spriteManifest=${JSON.stringify(report)};window.spriteVariants={};window.spriteA3i5={};\n`);
await copyFile(path.join(root,'scripts/assets/sprite-comparison.html'),path.join(output,'index.html'));
console.log(JSON.stringify(report.a3i5,null,2));
