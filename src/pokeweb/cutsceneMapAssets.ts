import { writeU16, writeU32 } from '../nds/binary';
import { loadMap3dZone, invalidateMap3dAssets, type Map3dSceneData, type Map3dPrimitive } from './map3dModel';
import { encodeNitroTexture, type EncodedTexture, type EncodedPalette } from './nitroTextureWriter';
import { createCutsceneStaticModel } from './cutsceneStaticModel';
import type { StaticModelMesh } from './nitroModelWriter';
import type { NativeMaterialRecord } from './nitroResourceWriter';
import type { NitroTextureSrt } from './nitroAnimation';
import { writeNitroTextureSrt, writeNitroTexturePattern, writeNitroMaterialColor, type MaterialColorTrack, type TextureSrtTrack, type TexturePatternTrack } from './nitroMaterialAnimationWriter';
import { encodeSeasonalTexture, pairEnvironmentPrimitives, sampleSceneEnvironment, sceneAmbientFrame, seasonalSurfaceLayers, scopeCutsceneMap, ENVIRONMENT_BLEND_LEVELS, type SceneEnvironment, type SceneMapBounds } from './cutsceneEnvironment';
import type { SceneVector,CutsceneScene } from './cutsceneScene';
import {visibleCutsceneMap} from './cutsceneStageVisibility';
import type { ProjectState } from './projectStore';
export type MapStageManifest = {
  zoneId: number;
  season: string;
  origin: SceneVector;
  unitsPerWorldUnit: number;
  chunks: number[];
  buildings: number;
  triangles: number;
  models: number;
  textures: number;
  textureBytes: number;
  paletteBytes: number;
  modelBytes: number;
  animatedMaterials: number;
  srtTracks: number;
  patternTracks: number;
  animationFrames: number;
  animationBytes: number;
  actors?: Array<{ id: string; overworldId: number; modelIndex: number }>;
  environment?:SceneEnvironment & {blendLevels:number;colorTracks:number};
};
export function stagePoint(position: readonly number[], manifest: Pick<MapStageManifest, 'origin' | 'unitsPerWorldUnit'>): SceneVector {
  return position.map((v, i) => (v - manifest.origin[i]) * manifest.unitsPerWorldUnit) as SceneVector;
}
const textureKey = (t: NonNullable<Map3dPrimitive['material']['texture']>) => `${t.width},${t.height}:` + Array.from(t.rgba).join(',');
/** Flat shaded faces become separate materials so native diffuse animation can tint them. */
function tintSurfaceParts(p:Map3dPrimitive):Map3dPrimitive[] {
  if(!p.colors)return [p];
  const groups=new Map<string,{color:number[];indices:number[]}>();
  for(let i=0;i<p.indices.length;i+=3){
    const face=Array.from(p.indices.subarray(i,i+3)),color=Array.from(p.colors.subarray(face[0]*3,face[0]*3+3),v=>Math.round(v*31)/31);
    if(face.some(v=>color.some((c,k)=>Math.abs(p.colors![v*3+k]-c)>1/62)))throw new Error('Environment tint cannot yet preserve vertex colour gradients within a triangle.');
    const key=color.join(',');let group=groups.get(key);if(!group){group={color,indices:[]};groups.set(key,group);}group.indices.push(...face);
  }
  return [...groups.values()].map(g=>({...p,indices:new Uint16Array(g.indices),colors:Float32Array.from({length:p.positions.length},(_,i)=>g.color[i%3])}));
}
/** Package static field geometry with native material tracks sampled on the scene clock. */
export function convertMapCutsceneAssets(data: Map3dSceneData, frameCount = 300,environment?:{source:SceneEnvironment;target:Map3dSceneData}) {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 65535)
    throw new Error("Invalid map-stage animation duration.");
  if (!data.chunks.length)
    throw new Error('The selected map has no terrain.');
  if (data.warnings.length)
    throw new Error(`Map conversion requires complete assets: ${data.warnings.join('; ')}`);
  const xs = data.chunks.map(c => c.worldX), zs = data.chunks.map(c => c.worldZ);
  const manifest: MapStageManifest = { zoneId: data.zoneId, season: data.season, origin: [(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2], unitsPerWorldUnit: 1 / 16, chunks: data.chunks.map(c => c.chunkId), buildings: data.buildings.length, triangles: 0, models: 0, textures: 0, textureBytes: 0, paletteBytes: 0, modelBytes: 0, animatedMaterials: 0, srtTracks: 0, patternTracks: 0, animationFrames: frameCount, animationBytes: 0 };
  const seasonalPairs=environment?pairEnvironmentPrimitives(data,environment.target):undefined;
  const environmentSamples=environment?Array.from({length:frameCount},(_,f)=>sampleSceneEnvironment(environment.source,f)):undefined;
  if(environment)manifest.environment={...environment.source,blendLevels:ENVIRONMENT_BLEND_LEVELS,colorTracks:0};
  const allTextures = new Set<string>(), models: Uint8Array[] = [], groups: Uint8Array[][] = [];
  let polygonId=0;
  const imageKeys = new WeakMap<NonNullable<Map3dPrimitive['material']['texture']>, string>();
  const keyForImage = (image: NonNullable<Map3dPrimitive['material']['texture']>) => {
    let key = imageKeys.get(image);
    if (key === undefined) {
      key = textureKey(image);
      imageKeys.set(image, key);
    }
    return key;
  };
  // Small environment groups keep the native 8-bit palette-name dictionaries
  // bounded while sharing the same camera/geometry transform.
  const work=data.chunks.flatMap(chunk=>{
    const props=data.buildings.filter(b=>b.chunkId===chunk.chunkId&&b.chunkOrigin?.matrixX===chunk.matrixX&&b.chunkOrigin?.matrixY===chunk.matrixY);
    if(!environment)return [{chunk,objects:[{...chunk,rotationY:0},...props]}];
    return [...Array.from({length:Math.ceil(chunk.primitives.length/3)},(_,i)=>({chunk,objects:[{...chunk,rotationY:0,primitives:chunk.primitives.slice(i*3,i*3+3)}]})),...props.map(b=>({chunk,objects:[b]}))];
  });
  for (const {objects} of work) {
    const textures = new Map<string, EncodedTexture>(), records: NativeMaterialRecord[] = [], meshes: StaticModelMesh[] = [];
    const materialIds = new Map<string, string>(), srtTracks: TextureSrtTrack[] = [], patternTracks: TexturePatternTrack[] = [],colorTracks:MaterialColorTrack[]=[],extraPalettes:EncodedPalette[]=[];
    const seasonalTextures=new Map<string,{texture:EncodedTexture;frames:EncodedTexture[];textureNames:string[];names:string[]}>();
    const registerTexture = (image: NonNullable<Map3dPrimitive['material']['texture']>) => {
      const key = keyForImage(image);
      allTextures.add(key);
      let texture = textures.get(key);
      if (!texture) {
        texture = encodeNitroTexture({ ...image, name: `tex${textures.size}` });
        if (texture.quantized)
          throw new Error(`Texture ${image.name} needs color reduction; lossless map conversion is required.`);
        textures.set(key, texture);
      }
      return texture;
    };
    const registerSeasonal=(image:NonNullable<Map3dPrimitive['material']['texture']>,other:typeof image|undefined,frame:number)=>{
      if(!environment){const texture=registerTexture(image);return {texture,paletteName:texture.name};}
      if(!other)throw new Error('Missing corresponding seasonal texture.');
      const key=keyForImage(image)+'|'+keyForImage(other);let pair=seasonalTextures.get(key);
      if(!pair){
        if(image.width===other.width&&image.height===other.height&&image.rgba.every((v,i)=>v===other.rgba[i])){const texture=registerTexture(image);pair={texture,frames:[texture],textureNames:[texture.name],names:[texture.name]};}
        else{const encoded=encodeSeasonalTexture(image,other,`tex${textures.size}`);encoded.frames.forEach((texture,i)=>{textures.set(`${key}|${i}`,texture);allTextures.add(`${key}|${i}`);});extraPalettes.push(...encoded.palettes);pair=encoded;}
        seasonalTextures.set(key,pair);
      }
      const level=environmentSamples![frame].level,textureName=pair.textureNames[Math.min(pair.textureNames.length-1,level)];
      return {texture:pair.frames.find(t=>t.name===textureName)!,paletteName:pair.names[Math.min(pair.names.length-1,level)]};
    };
    for (const object of objects)
      for (const original of object.primitives) for(const [layer,target] of environment?seasonalSurfaceLayers(original,seasonalPairs!.get(original)!,frameCount,environment.source):[[original,undefined]] as const) for(const p of environment?tintSurfaceParts(layer):[layer]) {
        const m = p.material, animation = p.textureAnimation;
        const samples = animation ? Array.from({ length: frameCount }, (_, frame) => animation.sample(environment?sceneAmbientFrame(environment.source,frame):frame)) : [];
        const targetSamples=target?.textureAnimation?Array.from({length:frameCount},(_,f)=>target.textureAnimation!.sample(sceneAmbientFrame(environment!.source,f))):[];
        if (animation)
          manifest.animatedMaterials++;
        const image = samples[0]?.texture ?? m.texture, initial=image?registerSeasonal(image,targetSamples[0]?.texture??target?.material.texture,0):undefined,texture=initial?.texture;
        const srts = samples.some(sample => sample.srt) ? samples.map(sample => sample.srt) : undefined;
        if (srts && (!p.uvs || !animation?.rawUvs || srts.some(s => !s)))
          throw new Error(`Material ${m.name} has incomplete animated texture coordinates.`);
        const pattern = Array.from({length:environment?frameCount:samples.length},(_,frame) => {
          const sample=samples[frame]??{};
          const image = sample.texture ?? m.texture;
          if (!image)
            return undefined;
          if (image.width !== texture?.width || image.height !== texture?.height)
            throw new Error(`Material ${m.name} changes texture dimensions; native map export requires consistent frame sizes.`);
          const registered=registerSeasonal(image,targetSamples[frame]?.texture??target?.material.texture,frame);
          return {textureName:registered.texture.name,paletteName:registered.paletteName};
        });
        const hasPattern = pattern.some(binding => binding?.textureName !== texture?.name||binding?.paletteName!==initial?.paletteName);
        if (hasPattern && pattern.some(name => !name))
          throw new Error(`Material ${m.name} has an incomplete texture pattern.`);
        const baseColor=environment&&p.colors?Array.from(p.colors.subarray(0,3)):image?[1,1,1]:m.diffuse;
        const key = JSON.stringify([texture?.name, m.alpha, m.repeatS, m.repeatT, m.flipS, m.flipT, srts, hasPattern ? pattern : undefined,environment?baseColor:undefined]);
        let name = materialIds.get(key);
        if (!name) {
          name = `mat${records.length}`;
          materialIds.set(key, name);
          const bytes = new Uint8Array(44);
          writeU16(bytes, 2, 44);
          writeU32(bytes, 4, 0x7fffffff);
          // Alpha-indexed layers need distinct IDs to blend over opaque scenery.
          // Keep opaque ID zero to avoid introducing native edge-marking seams.
          const format=texture?(texture.params>>>26)&7:0,alphaLayer=format===1||format===6||m.alpha<1;
          writeU32(bytes, 12, ((alphaLayer?polygonId++%62+1:0)<<24) | (Math.round(m.alpha * 31) << 16) | 0xc0);
          writeU32(bytes, 16, 0x3f1ff8ff);
          writeU32(bytes, 20, ((srts ? 1 << 30 : 0) | (Number(m.repeatS) << 16) | (Number(m.repeatT) << 17) | (Number(m.flipS) << 18) | (Number(m.flipT) << 19)) >>> 0);
          writeU32(bytes, 24, 0xffffffff);
          writeU16(bytes, 30, 0x1fce);
          writeU16(bytes, 32, texture?.width ?? 8);
          writeU16(bytes, 34, texture?.height ?? 8);
          writeU32(bytes, 36, 4096);
          writeU32(bytes, 40, 4096);
          records.push({ name, bytes, textureName: texture?.name, paletteName: initial?.paletteName });
          if(environment)colorTracks.push({name,samples:environmentSamples!.map(sample=>({diffuse:sample.tint.map((v,i)=>v*baseColor[i]) as SceneVector,ambient:[1,1,1],specular:[0,0,0],emission:[0,0,0],alpha:m.alpha}))});
          if (srts)
            srtTracks.push({ name, samples: srts as NitroTextureSrt[] });
          if (hasPattern)
            patternTracks.push({ name, keys: pattern.flatMap((binding, frame) => frame === 0 || binding?.textureName!==pattern[frame-1]?.textureName||binding?.paletteName!==pattern[frame-1]?.paletteName ? [{ frame, ...binding! }] : []) });
        }
        const positions = new Float32Array(p.positions.length), colors = p.colors?.slice() ?? new Float32Array(p.positions.length), uvs = p.uvs?.slice();
        const angle = object.rotationY * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
        for (let i = 0; i < p.positions.length; i += 3) {
          const [x, y, z] = p.positions.subarray(i, i + 3);
          positions.set(stagePoint([x * c + z * s + object.worldX, y + (object.worldY ?? 0), z * c - x * s + object.worldZ], manifest), i);
          if (!p.colors)
            colors.set(image ? [1, 1, 1] : m.diffuse, i);
        }
        if (uvs && srts && animation?.rawUvs) {
          for (let i = 0; i < uvs.length; i++)
            uvs[i] = animation.rawUvs[i] / ((i % 2 ? m.flipT : m.flipS) ? 2 : 1);
        }
        meshes.push({ materialName: name, positions, indices: p.indices, colors:environment?undefined:colors, uvs });
        manifest.triangles += p.indices.length / 3;
      }
    const model = createCutsceneStaticModel(meshes, records, [...textures.values()],extraPalettes);
    models.push(model);
    const animations = [srtTracks.length ? writeNitroTextureSrt(frameCount, srtTracks) : undefined, patternTracks.length ? writeNitroTexturePattern(frameCount, patternTracks) : undefined,colorTracks.length?writeNitroMaterialColor(frameCount,colorTracks):undefined].filter((b): b is Uint8Array => Boolean(b));
    groups.push([model, ...animations]);
    manifest.srtTracks += srtTracks.length;
    manifest.patternTracks += patternTracks.length;
    manifest.animationBytes += animations.reduce((n, b) => n + b.length, 0);
    if(manifest.environment)manifest.environment.colorTracks+=colorTracks.length;
    manifest.paletteBytes+=extraPalettes.reduce((n,p)=>n+Math.ceil(p.bytes.length/16)*16,0);
    for (const texture of textures.values()) {
      manifest.textureBytes += texture.pixels.length;
      manifest.paletteBytes += Math.ceil(texture.palette.length / 16) * 16;
    }
    manifest.modelBytes += model.length;
  }
  manifest.models = models.length;
  manifest.textures = allTextures.size;
  if (models.length > 64 || manifest.textureBytes > 256 * 1024 || manifest.paletteBytes > 32 * 1024)
    throw new Error(`The converted stage exceeds native model or DS texture/palette memory limits (${models.length}/64 models, ${manifest.textureBytes}/262144 texture bytes, ${manifest.paletteBytes}/32768 palette bytes).`);
  return { models, groups, manifest };
}
export async function loadMapCutsceneAssets(project: ProjectState, zoneId: number, season: Map3dSceneData['season'], frameCount: number,environment?:SceneEnvironment,bounds?:SceneMapBounds,includeNeighbors=false,view?:CutsceneScene) {
  invalidateMap3dAssets();
  let data=scopeCutsceneMap(await loadMap3dZone(project, zoneId, { season, cache: false,includeNeighbors }),bounds,includeNeighbors);
  let target=environment?scopeCutsceneMap(await loadMap3dZone(project,zoneId,{season:environment.targetSeason,cache:false,includeNeighbors}),bounds,includeNeighbors):undefined;
  if(environment&&view){data=visibleCutsceneMap(data,view);target=visibleCutsceneMap(target!,view);}
  return convertMapCutsceneAssets(data, frameCount,environment?{source:environment,target:target!}:undefined);
}
