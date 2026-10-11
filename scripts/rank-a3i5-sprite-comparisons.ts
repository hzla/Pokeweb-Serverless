import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeGifFrames } from '../src/pokeweb/gifAnimationFrames';
import { normalizePwanSourceFrames, pwanFramePixels, pwanPalette, pwanTimeline } from '../src/pokeweb/pwanCompiler';

// Compare the same selected artwork, not the previous ROM's potentially different art.
const output=path.resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('Usage: vite-node scripts/rank-a3i5-sprite-comparisons.ts <comparison-folder>');
const report=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));
const results:any[]=[];
function distance(a:number,b:number):number {
  return (2*((a&31)-(b&31))**2+4*((a>>5&31)-(b>>5&31))**2+3*((a>>10&31)-(b>>10&31))**2)/9;
}
for(const row of report.sprites.filter((r:any)=>r.a3i5?.eligible)) {
  const source=normalizePwanSourceFrames(decodeGifFrames(new Uint8Array(await readFile(path.join(output,'sources',row.id+'.gif')))));
  const pwan=new Uint8Array(await readFile(path.join(output,'new',row.id+'.pwan'))),palette=pwanPalette(pwan),timeline=pwanTimeline(pwan);
  const packed=JSON.parse(await readFile(path.join(output,'a3i5',row.id+'-new.json'),'utf8'));
  const texels=Buffer.from(packed.frames,'base64');
  const decoded=new Map<number,number[][]>(),used15=new Set<number>();
  let time=0,step15=0,start15=0,step32=0,start32=0,pixels=0,changed=0,error15=0,error32=0,difference=0;
  for(const frame of source) {
    while(time>=start15+timeline[step15]!.ticks){start15+=timeline[step15]!.ticks;step15++;}
    while(time>=start32+packed.timeline[step32].ticks){start32+=packed.timeline[step32].ticks;step32++;}
    const index=timeline[step15]!.frameIndex;
    if(!decoded.has(index))decoded.set(index,pwanFramePixels(pwan,index));
    const indices=decoded.get(index)!,base=packed.timeline[step32].frame*12288;
    const ticks=Math.max(1,Math.min(65535,Math.round(frame.delayMs*60/1000)))*row.timingScale;
    for(let y=0;y<96;y++)for(let x=0;x<96;x++) {
      const sy=y-row.groundShift,at=(sy*96+x)*4;
      if(sy<0||sy>=96||frame.pixels[at+3]!<128)continue;
      const reference=(frame.pixels[at]!>>>3)|(frame.pixels[at+1]!>>>3)<<5|(frame.pixels[at+2]!>>>3)<<10;
      const color15=palette[indices[y]![x]!]!,color32=packed.palette[texels[base+y*128+x]!&31];
      pixels+=ticks;used15.add(color15);
      if(color15!==color32)changed+=ticks;
      error15+=distance(reference,color15)*ticks;error32+=distance(reference,color32)*ticks;difference+=distance(color15,color32)*ticks;
    }
    time+=ticks;
  }
  const rms15=Math.sqrt(error15/pixels)*255/31,rms32=Math.sqrt(error32/pixels)*255/31;
  const visualReview=row.id==='1193_front'?'The prioritized 384x192 Minior Blue Core source contains a multi-sprite sheet. Correct/crop the source before using this metric as a format recommendation. Assets were not changed during this audit.':undefined;
  results.push({id:row.id,name:row.name,species:row.species,form:row.form,side:row.side,sourceColors:row.a3i5.sourceColorCount,visibleColors15:used15.size,visibleColors32:packed.visibleColors,changedPixelPercent:Math.round(changed/pixels*10000)/100,sourceError15:Math.round(rms15*100)/100,sourceError32:Math.round(rms32*100)/100,errorRemoved:Math.round((rms15-rms32)*100)/100,formatDifference:Math.round(Math.sqrt(difference/pixels)*255/31*100)/100,...(visualReview?{visualReview}:{})});
}
results.sort((a,b)=>b.errorRemoved-a.errorRemoved||b.formatDifference-a.formatDifference);
const seen=new Set<string>(),pokemon=results.filter(r=>{const key=r.species+':'+r.form;if(seen.has(key))return false;seen.add(key);return true;});
const ranking={format:'a3i5-comparison-ranking-v1',basis:'Ungraded 15-color versus ungraded 32-color, using the same priority-selected GIF, placement and timing. Ranked by reduction in duration-weighted RGB555 source color error per opaque pixel; both GIF motion and DS color rounding are accounted for.',limitations:'A color-error metric is a shortlist for visual inspection, not a perceptual guarantee. No game-heap, VRAM or hardware compatibility claim is made for the comparison-only A3I5 data.',rankedPokemon:pokemon,rankedSides:results};
await writeFile(path.join(output,'a3i5-ranking.json'),JSON.stringify(ranking,null,2)+'\n');
console.log(JSON.stringify(pokemon.slice(0,20),null,2));
