import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const [dynamic,stationary]=process.argv.slice(2);if(!dynamic||!stationary)throw new Error('Pass dynamic and stationary-control emulator capture directories.');
const samples=[];
for(const frame of [1080,1140,1200,1260,1320,1380]) {
  const a=PNG.sync.read(await fs.readFile(`${dynamic}/frame-${frame}.png`)),b=PNG.sync.read(await fs.readFile(`${stationary}/frame-${frame}.png`));
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);let changed=0,minX=256,minY=192,maxX=-1,maxY=-1;
  for(let y=0;y<192;y++)for(let x=0;x<256;x++){const at=(y*256+x)*4;if([0,1,2].some(c=>a.data[at+c]!==b.data[at+c])){changed++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  samples.push({frame,changed,bounds:changed?[minX,minY,maxX,maxY]:null});
}
assert.equal(samples[0].changed,0,'Before the first movement, dynamic and stationary ROMs must render identically.');
assert.ok(samples.slice(1).filter(s=>s.changed>50).length>=3,'Native NPC movement must change visible game pixels against the stationary control.');
const result={passed:true,identicalBeforeMovement:true,samples};await fs.writeFile(`${dynamic}/npc-motion.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
