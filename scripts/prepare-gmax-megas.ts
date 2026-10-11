// Prepare only the explicit Essentials G-Max allowlist; never refresh existing sprites.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compileGifToPwan, validatePwan, pwanFramePixels, scalePwanFrames, shiftPwanFrames} from '../src/pokeweb/pwanCompiler';

function bounds(bytes:Uint8Array){
  const h=validatePwan(bytes);let min=96,max=-1;
  for(let frame=0;frame<h.frameCount;frame++)pwanFramePixels(bytes,frame).forEach((row,y)=>{if(row.some(c=>c)){min=Math.min(min,y);max=Math.max(max,y);}});
  if(max<0)throw new Error('Empty sprite');return {min,max};
}

const args = new Map<string,string>();
for(let i=2;i<process.argv.length;i+=2) args.set(process.argv[i]!,process.argv[i+1]!);
const required=(key:string)=>{const value=args.get(key);if(!value)throw new Error(`Missing ${key}`);return path.resolve(value);};
const source=required('--sources'), manifest=JSON.parse(await readFile(required('--manifest'),'utf8')), output=required('--output');
if(manifest.format!=='w2u-gmax-megas-v1'||manifest.colorPreset!=='gen5') throw new Error('Unsupported manifest');
await mkdir(output); // New directory only: keep earlier results recoverable.
const results=[];
for(const form of manifest.forms){
  for(const side of ['front','back'] as const){
    const relative=`essentials_gifs/${side==='front'?'Front':'Back'}/${form.sourceStem}.gif`;
    const bytes=new Uint8Array(await readFile(path.join(source,relative)));
    const compiled=compileGifToPwan(bytes,{colorPreset:'gen5'});
    // The native carrier's ground is canvas row 88. Fit tall artwork before
    // shifting it, so grounding cannot clip the head or change idle motion.
    let converted=compiled.pwanBytes,box=bounds(converted),scale=1;
    if(box.max-box.min+1>88){scale=88/(box.max-box.min+1);converted=scalePwanFrames(converted,scale,{mode:'nearest'}).pwanBytes;box=bounds(converted);}
    const groundShift=87-box.max;
    converted=shiftPwanFrames(converted,0,groundShift).pwanBytes;
    const final=bounds(converted);if(final.min<0||final.max!==87)throw new Error('Invalid sprite grounding');
    validatePwan(converted);
    const filename=`${form.sourceStem}_${side}.pwan`;
    await writeFile(path.join(output,filename),converted);
    results.push({sourceStem:form.sourceStem,side,source:relative,filename,sourceSha256:createHash('sha256').update(bytes).digest('hex'),sha256:createHash('sha256').update(converted).digest('hex'),conversion:compiled.conversion,steps:compiled.timelineCount,unique:compiled.uniqueFrameCount,ticks:compiled.totalTicks,groundShift,groundFitScale:scale,warnings:compiled.warnings});
  }
  console.log(`Prepared ${form.name}`);
}
await writeFile(path.join(output,'prepared.json'),JSON.stringify({format:'w2u-gmax-prepared-v1',results},null,2)+'\n');
