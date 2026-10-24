import type { SceneVector } from './cutsceneScene';
import type { Map3dSceneData, Map3dPrimitive, DecodedTexture } from './map3dModel';
import { writeU16 } from '../nds/binary';
import type { EncodedTexture, EncodedPalette } from './nitroTextureWriter';

export type SceneEnvironment = { targetSeason: Map3dSceneData['season']; startFrame:number; endFrame:number; dayCycles:number; ambientSpeed?:number };
export type SceneMapBounds = {west:number;north:number;width:number;height:number};
export const ENVIRONMENT_BLEND_LEVELS=32;
/** Integrate the ambient rate so entering/leaving the transition never resets a loop. */
export function sceneAmbientFrame(environment:SceneEnvironment,frame:number):number {
  return frame+((environment.ambientSpeed??1)-1)*Math.max(0,Math.min(frame,environment.endFrame)-environment.startFrame);
}
/** A visual clock; it never changes the DS RTC or the field's saved season. */
export function sampleSceneEnvironment(environment:SceneEnvironment,frame:number) {
  const progress=Math.max(0,Math.min(1,(frame-environment.startFrame)/(environment.endFrame-environment.startFrame)));
  const phase=(progress*environment.dayCycles)%1;
  const stops:SceneVector[]=[[1,1,1],[1,.64,.45],[.24,.32,.58],[.87,.64,.76],[1,1,1]];
  const at=Math.min(3,Math.floor(phase*4)),t=phase*4-at,u=t*t*(3-2*t);
  const tint=stops[at].map((v,i)=>Math.round((v+(stops[at+1][i]-v)*u)*31)/31) as SceneVector;
  const blend=progress*progress*(3-2*progress);
  return {progress,blend,level:Math.round(blend*(ENVIRONMENT_BLEND_LEVELS-1)),tint};
}

/** Restrict this independent scene to complete matrix cells, without editing maps. */
export function scopeCutsceneMap(data:Map3dSceneData,bounds?:SceneMapBounds,includeNeighbors=false):Map3dSceneData {
  if(includeNeighbors&&data.neighboringScenery)data={...data,chunks:[...data.chunks,...data.neighboringScenery.chunks],buildings:[...data.buildings,...data.neighboringScenery.buildings],neighboringScenery:undefined};
  if(!bounds)return data;
  const chunks=data.chunks.filter(c=>c.matrixX*32>=bounds.west&&c.matrixY*32>=bounds.north&&c.matrixX*32<bounds.west+bounds.width&&c.matrixY*32<bounds.north+bounds.height);
  if(!chunks.length)throw new Error('The cutscene bounds contain no terrain chunks.');
  return {...data,chunks,buildings:data.buildings.filter(b=>chunks.some(c=>b.chunkId===c.chunkId&&b.chunkOrigin?.matrixX===c.matrixX&&b.chunkOrigin?.matrixY===c.matrixY))};
}

/** Corresponding seasonal surfaces must retain geometry/UV/opacity layout. */
export function pairEnvironmentPrimitives(source:Map3dSceneData,target:Map3dSceneData) {
  const pairs=new Map<Map3dPrimitive,Map3dPrimitive>();
  if(source.warnings.length||target.warnings.length)throw new Error('Environment export requires complete assets in both seasons.');
  const same=(a:ArrayLike<number>|undefined,b:ArrayLike<number>|undefined)=>!a&&!b||Boolean(a&&b&&a.length===b.length&&Array.from(a).every((v,i)=>v===b[i]));
  const join=(a:Map3dPrimitive[],b:Map3dPrimitive[])=>{
    if(a.length!==b.length)throw new Error('Seasonal geometry changes are not supported by this environment prototype.');
    a.forEach((p,i)=>{const q=b[i];if(p.material.name!==q.material.name||p.material.alpha!==q.material.alpha||!same(p.positions,q.positions)||!same(p.indices,q.indices)||!same(p.uvs,q.uvs)||!same(p.colors,q.colors))throw new Error('Seasonal surface layout changes require a separate geometry transition.');pairs.set(p,q);});
  };
  if(source.chunks.length!==target.chunks.length||source.buildings.length!==target.buildings.length)throw new Error('Seasonal object replacements need a separate geometry transition.');
  for(const c of source.chunks){const d=target.chunks.find(t=>t.matrixX===c.matrixX&&t.matrixY===c.matrixY);if(!d||c.worldX!==d.worldX||c.worldZ!==d.worldZ||c.worldY!==d.worldY)throw new Error('Seasonal terrain placement changed.');join(c.primitives,d.primitives);}
  source.buildings.forEach((b,i)=>{const d=target.buildings[i];if(b.worldX!==d.worldX||b.worldZ!==d.worldZ||b.worldY!==d.worldY||b.rotationY!==d.rotationY)throw new Error('Seasonal prop placement changed.');join(b.primitives,d.primitives);});
  return pairs;
}

/** Keep common opaque artwork in a large palette. Only appearing/disappearing
 * texels need alpha-indexed frames and their smaller 32-colour palette. */
export function seasonalSurfaceLayers(p:Map3dPrimitive,q:Map3dPrimitive,frames:number,environment:SceneEnvironment):Array<[Map3dPrimitive,Map3dPrimitive]> {
  const sample=(part:Map3dPrimitive,f:number)=>part.textureAnimation?.sample(f).texture??part.material.texture;
  const changes=(a?:DecodedTexture,b?:DecodedTexture)=>a&&b&&a.rgba.some((v,i)=>i%4===3&&v!==b.rgba[i]);
  if(!Array.from({length:frames},(_,f)=>sceneAmbientFrame(environment,f)).some(f=>changes(sample(p,f),sample(q,f))))return [[p,q]];
  const cache=new WeakMap<DecodedTexture,WeakMap<DecodedTexture,DecodedTexture[][]>>();
  function layers(a:DecodedTexture,b:DecodedTexture){
    if(a.width!==b.width||a.height!==b.height)throw new Error('Seasonal textures need matching dimensions.');
    let byTarget=cache.get(a);if(!byTarget){byTarget=new WeakMap();cache.set(a,byTarget);}let images=byTarget.get(b);
    if(!images){images=[a,b].map(t=>[0,1].map(layer=>{const rgba=t.rgba.slice();for(let i=3;i<rgba.length;i+=4)if(Number(a.rgba[i]!==b.rgba[i])!==layer)rgba.fill(0,i-3,i+1);return {...t,rgba};}));byTarget.set(b,images);}return images;
  }
  return [0,1].map(layer=>[p,q].map((part,side)=>{
    const a=sample(p,0),b=sample(q,0),texture=a&&b?layers(a,b)[side][layer]:undefined;
    return {...part,material:{...part.material,texture},textureAnimation:{frameCount:frames,rawUvs:part.textureAnimation?.rawUvs,sample(frame:number){const original=part.textureAnimation?.sample(frame)??{},a=sample(p,frame),b=sample(q,frame);return {...original,texture:a&&b?layers(a,b)[side][layer]:undefined};}}};
  }) as [Map3dPrimitive,Map3dPrimitive]);
}

/** A joint index image preserves both endpoint artworks. Only its small palette
 * changes; source palettes need not use matching indices. No colour reduction. */
export function encodeSeasonalTexture(a:DecodedTexture,b:DecodedTexture,name:string):{texture:EncodedTexture;frames:EncodedTexture[];textureNames:string[];palettes:EncodedPalette[];names:string[]} {
  if(a.width!==b.width||a.height!==b.height||a.rgba.length!==b.rgba.length)throw new Error('Seasonal textures need matching dimensions.');
  const colors:Array<[number[],number[]]>=[],indices:number[]=[],pairs=new Map<string,number>();
  const rgb=(bytes:Uint8Array,k:number)=>Array.from(bytes.subarray(k,k+3),v=>Math.round(v*31/255));
  let transparent=false,translucent=false;const alphas:number[]=[],targetAlphas:number[]=[];
  const changingAlpha=a.rgba.some((v,i)=>i%4===3&&v!==b.rgba[i]);
  for(let i=0;i<a.rgba.length;i+=4){
    const alpha=a.rgba[i+3],otherAlpha=b.rgba[i+3];
    if(changingAlpha&&![alpha,otherAlpha].every(v=>v===0||v===255))throw new Error('Changing seasonal alpha currently requires binary endpoint masks.');
    alphas.push(alpha);targetAlphas.push(otherAlpha);translucent||=alpha>0&&alpha<255||changingAlpha;
    if(!alpha&&!otherAlpha){transparent=true;indices.push(-1);continue;}
    const x=rgb(alpha?a.rgba:b.rgba,i),y=rgb(otherAlpha?b.rgba:a.rgba,i),key=[...x,...y].join(',');
    let id=pairs.get(key);if(id===undefined){id=colors.length;pairs.set(key,id);colors.push([x,y]);}indices.push(id);
  }
  const reserve=Number(transparent&&!translucent),count=Math.max(1,colors.length+reserve),alpha3=Array.from({length:8},(_,n)=>{const v=n<<2|n>>>1;return v<<3|v>>>2;}),alpha5=Array.from({length:32},(_,n)=>n<<3|n>>>2);
  const format=translucent?(alphas.every(a=>alpha3.includes(a))?1:6):count<=16?3:4,limit=format===1?32:format===6?8:256;
  if(count>limit||translucent&&format===6&&alphas.some(a=>!alpha5.includes(a)))throw new Error(`Seasonal texture ${a.name} needs an explicit colour/alpha reduction profile.`);
  const pixelFrames:Uint8Array[]=[],frameIndices:number[]=[];
  for(let level=0;level<(changingAlpha?ENVIRONMENT_BLEND_LEVELS:1);level++){
    const pixels=new Uint8Array(format===3?indices.length/2:indices.length);
    indices.forEach((id,i)=>{const index=id<0?0:id+reserve,alpha=changingAlpha?Math.round((alphas[i]+(targetAlphas[i]-alphas[i])*level/(ENVIRONMENT_BLEND_LEVELS-1))*7/255):alpha3.indexOf(alphas[i]);if(format===3)pixels[i>>>1]|=index<<((i&1)*4);else pixels[i]=index|(format===1?alpha<<5:format===6?alpha5.indexOf(alphas[i])<<3:0);});
    let index=pixelFrames.findIndex(p=>p.every((v,i)=>v===pixels[i]));if(index<0){index=pixelFrames.length;pixelFrames.push(pixels);}frameIndices.push(index);
  }
  const palettes:EncodedPalette[]=[],names:string[]=[],unique=new Map<string,string>();
  for(let level=0;level<ENVIRONMENT_BLEND_LEVELS;level++){
    const palette=new Uint8Array(Math.ceil(count*2/16)*16),t=level/(ENVIRONMENT_BLEND_LEVELS-1);
    colors.forEach(([x,y],i)=>{const c=x.map((v,k)=>Math.round(v+(y[k]-v)*t));writeU16(palette,(i+reserve)*2,c[0]|c[1]<<5|c[2]<<10);});
    const key=Array.from(palette).join(',');let paletteName=unique.get(key);
    if(!paletteName){paletteName=palettes.length?`${name}p${palettes.length}`:name;unique.set(key,paletteName);palettes.push({name:paletteName,bytes:palette});}names.push(paletteName);
  }
  const params=(Math.log2(a.width)-3)<<20|(Math.log2(a.height)-3)<<23|format<<26|reserve<<29;
  const frames=pixelFrames.map((pixels,i)=>({name:i?`${name}f${i}`:name,width:a.width,height:a.height,params,pixels,palette:palettes[0].bytes,quantized:false}));
  return {texture:frames[0],frames,textureNames:Array.from({length:ENVIRONMENT_BLEND_LEVELS},(_,i)=>frames[frameIndices[Math.min(i,frameIndices.length-1)]].name),palettes:palettes.slice(1),names};
}

/** Used by browser playback; export uses the same quantized seasonal samples. */
export function blendSeasonalImage(a:DecodedTexture,b:DecodedTexture,level:number):DecodedTexture {
  const t=level/(ENVIRONMENT_BLEND_LEVELS-1),rgba=a.rgba.slice();
  const alpha3=Array.from({length:8},(_,n)=>{const v=n<<2|n>>>1;return v<<3|v>>>2;});
  for(let k=0;k<rgba.length;k+=4){
    for(let c=0;c<3;c++){const x=Math.round((a.rgba[k+3]?a:b).rgba[k+c]*31/255),y=Math.round((b.rgba[k+3]?b:a).rgba[k+c]*31/255);rgba[k+c]=Math.round(Math.round(x+(y-x)*t)*255/31);}
    if(a.rgba[k+3]!==b.rgba[k+3])rgba[k+3]=alpha3[Math.round((a.rgba[k+3]+(b.rgba[k+3]-a.rgba[k+3])*t)*7/255)];
  }
  return {...a,name:`${a.name}_blend_${level}`,rgba};
}

export function environmentPreviewMap(data:Map3dSceneData,target:Map3dSceneData,environment:SceneEnvironment,frames:number):Map3dSceneData {
  const pairs=pairEnvironmentPrimitives(data,target),images=new WeakMap<DecodedTexture,WeakMap<DecodedTexture,Map<number,DecodedTexture>>>();
  const parts=(parts:Map3dPrimitive[])=>parts.map(p=>{
    const q=pairs.get(p)!,original=p.textureAnimation;
    return {...p,textureAnimation:{frameCount:frames,rawUvs:original?.rawUvs,sample(frame:number){
      const ambientFrame=sceneAmbientFrame(environment,frame),a=original?.sample(ambientFrame)??{},b=q.textureAnimation?.sample(ambientFrame)??{},x=a.texture??p.material.texture,y=b.texture??q.material.texture;
      if(!x||!y)return a;
      const level=sampleSceneEnvironment(environment,frame).level;
      let byTarget=images.get(x);if(!byTarget){byTarget=new WeakMap();images.set(x,byTarget);}let byLevel=byTarget.get(y);if(!byLevel){byLevel=new Map();byTarget.set(y,byLevel);}let texture=byLevel.get(level);if(!texture){texture=blendSeasonalImage(x,y,level);byLevel.set(level,texture);}
      return {...a,texture};
    }}};
  });
  return {...data,chunks:data.chunks.map(c=>({...c,primitives:parts(c.primitives)})),buildings:data.buildings.map(b=>({...b,primitives:parts(b.primitives)}))};
}
