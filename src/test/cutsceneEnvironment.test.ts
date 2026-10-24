import {describe,it,expect} from 'vitest';
import sample from '../../examples/cutscenes/route13.time-travel.scene.json';
import lookout from '../../examples/cutscenes/aspertia.lookout-time-travel.scene.json';
import {visibleCutsceneMap} from '../pokeweb/cutsceneStageVisibility';
import {readCutsceneScene,storeCutsceneScene} from '../pokeweb/cutsceneScene';
import {sampleSceneEnvironment,sceneAmbientFrame,encodeSeasonalTexture,scopeCutsceneMap,pairEnvironmentPrimitives,environmentPreviewMap} from '../pokeweb/cutsceneEnvironment';
import {convertMapCutsceneAssets} from '../pokeweb/cutsceneMapAssets';
import {compileNitroAnimatedModel} from '../pokeweb/nitroAnimatedModel';
import {readNitroResources,type Map3dSceneData,type DecodedTexture} from '../pokeweb/map3dModel';
import {writeNitroMaterialColor} from '../pokeweb/nitroMaterialAnimationWriter';
import {readNitroMaterialAnimation} from '../pokeweb/nitroSceneAnimation';
import {createProjectDocument} from '../pokeweb/projectDocument';
import {openProjectSession} from '../pokeweb/projectSession';
import {makeEditProject} from './fixtures/editProject';

const image=(color:number[],alpha=255):DecodedTexture=>({name:'grass',width:8,height:8,rgba:new Uint8Array(Array.from({length:64},()=>[...color,alpha]).flat())});
function map(texture:DecodedTexture):Map3dSceneData{return {zoneId:370,season:'spring',warnings:[],chunks:[{chunkId:86,matrixX:21,matrixY:6,worldX:11008,worldZ:3328,primitives:[{positions:new Float32Array([0,0,0,16,0,0,0,0,16]),indices:new Uint16Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1]),material:{name:'grass',diffuse:[1,1,1],alpha:1,texture}}]}],buildings:[]} as unknown as Map3dSceneData;}
const environment={targetSeason:'winter' as const,startFrame:2,endFrame:34,dayCycles:2};
describe('cutscene visual environment',()=>{
  it('has independent periodic day colour and a clamped, monotonic seasonal blend',()=>{
    expect(sampleSceneEnvironment(environment,0)).toMatchObject({level:0,tint:[1,1,1]});
    expect(sampleSceneEnvironment(environment,34)).toMatchObject({level:31,tint:[1,1,1]});
    expect(sampleSceneEnvironment(environment,100)).toMatchObject({level:31,tint:[1,1,1]});
    expect(sampleSceneEnvironment(environment,10).tint[0]).toBeLessThan(.3);
    expect(sampleSceneEnvironment(environment,10).tint).toEqual(sampleSceneEnvironment(environment,26).tint);
    const levels=Array.from({length:37},(_,f)=>sampleSceneEnvironment(environment,f).level);expect(levels).toEqual([...levels].sort((a,b)=>a-b));
  });
  it('exports real endpoint artwork and intermediate palette samples while tint runs separately',()=>{
    const spring=map(image([0,255,0])),winter=map(image([255,255,255])),before=spring.chunks[0].primitives[0].material.texture!.rgba.slice();
    // Different texel patterns/palette indices are represented by joint indices.
    winter.chunks[0].primitives[0].material.texture!.rgba.set([255,0,0,255],0);
    const output=convertMapCutsceneAssets(spring,37,{source:environment,target:winter}),group=output.groups[0],asset=(stamp:string)=>group.find(b=>String.fromCharCode(...b.slice(0,4))===stamp);
    const native=compileNitroAnimatedModel(group[0],undefined,undefined,{patternBytes:asset('BTP0'),materialBytes:asset('BMA0'),sceneFrames:37});
    expect(readNitroResources(group[0]).textures).toHaveLength(1);
    native.sample(0);expect(Array.from(native.primitives[0].material.texture!.rgba.slice(0,4))).toEqual([0,255,0,255]);
    native.sample(34);expect(Array.from(native.primitives[0].material.texture!.rgba.slice(0,8))).toEqual([255,0,0,255,255,255,255,255]);
    native.sample(18);const mid=native.primitives[0].material.texture!.rgba;expect(mid[0]).toBeGreaterThan(0);expect(mid[0]).toBeLessThan(255);
    native.sample(10);expect(native.primitives[0].colors![0]).toBeLessThan(.3);
    expect(spring.chunks[0].primitives[0].material.texture!.rgba).toEqual(before);
    expect(output.manifest.environment).toMatchObject({blendLevels:32,colorTracks:1});
    const preview=environmentPreviewMap(spring,winter,environment,37);expect(preview.chunks[0].primitives[0].textureAnimation!.sample(34).texture!.rgba).toEqual(winter.chunks[0].primitives[0].material.texture!.rgba);
  });
  it('keeps a continuous 4× ambient clock without retiming the seasonal or camera clocks',()=>{
    const fast={...environment,ambientSpeed:4};
    expect([0,2,3,33,34,35].map(f=>sceneAmbientFrame(fast,f))).toEqual([0,2,6,126,130,131]);
    expect(sceneAmbientFrame(environment,35)).toBe(35);
    expect(sampleSceneEnvironment(fast,10)).toEqual(sampleSceneEnvironment(environment,10));
    const a=map(image([0,255,0])),b=map(image([255,255,255]));
    for(const data of [a,b]){const p=data.chunks[0].primitives[0];p.textureAnimation={frameCount:8,rawUvs:p.uvs,sample:f=>({srt:{scaleS:1,scaleT:1,sin:0,cos:1,transS:(f%8)/8,transT:0}})};}
    const preview=environmentPreviewMap(a,b,fast,37),out=convertMapCutsceneAssets(a,37,{source:fast,target:b}),group=out.groups[0];
    const native=compileNitroAnimatedModel(group[0],undefined,group.find(g=>String.fromCharCode(...g.slice(0,4))==='BTA0'),{sceneFrames:37});
    for(const f of [1,2,3,4,33,34,35]){const expected=(sceneAmbientFrame(fast,f)%8)/8;expect(preview.chunks[0].primitives[0].textureAnimation!.sample(f).srt!.transS).toBe(expected);native.sample(f);expect(native.primitives[0].uvs![0]).toBeCloseTo(-expected,3);}
  });
  it('fades appearing and disappearing seasonal artwork using native alpha frames',()=>{
    const a=map(image([0,255,0])),b=map(image([255,0,0]));
    a.chunks[0].primitives[0].material.texture!.rgba[3]=0;b.chunks[0].primitives[0].material.texture!.rgba[7]=0;
    const out=convertMapCutsceneAssets(a,37,{source:environment,target:b}),group=out.groups[0],native=compileNitroAnimatedModel(group[0],undefined,undefined,{patternBytes:group.find(g=>String.fromCharCode(...g.slice(0,4))==='BTP0'),sceneFrames:37});
    expect(native.primitives).toHaveLength(2);
    native.sample(2);expect(native.primitives[1].material.texture!.rgba[3]).toBe(0);expect(native.primitives[1].material.texture!.rgba[7]).toBe(255);
    native.sample(18);expect(native.primitives[1].material.texture!.rgba[3]).toBeGreaterThan(0);expect(native.primitives[1].material.texture!.rgba[3]).toBeLessThan(255);
    native.sample(34);expect(native.primitives[1].material.texture!.rgba[3]).toBe(255);expect(native.primitives[1].material.texture!.rgba[7]).toBe(0);
    expect(out.manifest.textureBytes).toBeLessThan(32*64*2);
  });
  it('retains native translucent alpha while rejecting changing masks and colour reduction',()=>{
    const a=image([0,255,0]),b=image([255,255,255]);[0,33,148,255].forEach((n,i)=>{a.rgba[i*4+3]=b.rgba[i*4+3]=n;});
    const encoded=encodeSeasonalTexture(a,b,'leaf');expect(encoded.texture.params>>>26&7).toBe(1);expect([...encoded.texture.pixels.slice(0,4)].map(v=>v>>>5)).toEqual([0,1,4,7]);
    b.rgba[3]=255;expect(()=>encodeSeasonalTexture(a,b,'bad')).toThrow('binary');
    const manyA={...image([0,0,0]),width:32,height:16,rgba:new Uint8Array(32*16*4)},manyB={...manyA,rgba:new Uint8Array(32*16*4)};
    for(let i=0;i<512;i++){manyA.rgba.set([(i&31)*8,(i>>>5)*8,0,255],i*4);manyB.rgba.set([255,255,255,255],i*4);}
    expect(()=>encodeSeasonalTexture(manyA,manyB,'many')).toThrow('reduction');
  });
  it('includes bounded panorama scenery and conservatively retains every camera-visible surface',()=>{
    const a=map(image([0,255,0])),neighbor={...a.chunks[0],chunkId:87,matrixY:5,worldZ:2816};
    a.neighboringScenery={chunks:[neighbor],buildings:[]};
    expect(scopeCutsceneMap(a,{west:672,north:160,width:32,height:64},true).chunks.map(c=>c.chunkId)).toEqual([86,87]);
    expect(a.chunks).toHaveLength(1);expect(a.neighboringScenery.chunks).toHaveLength(1);
    const source=readCutsceneScene(lookout);source.frameCount=3;source.camera=[{id:'one',frame:0,position:[11008,100,3500],rotationDegrees:[-35,0,0],fov:40,easing:'linear'},{id:'two',frame:2,position:[11008,100,2988],rotationDegrees:[-35,0,0],fov:40,easing:'hold'}];
    const visible=visibleCutsceneMap({...a,chunks:[...a.chunks,neighbor]},source);
    expect(visible.chunks.every(c=>c.primitives.length===1)).toBe(true);
    source.camera.forEach(k=>{k.position=[11008,100,3500];k.rotationDegrees=[0,180,0];});expect(visibleCutsceneMap(a,source).chunks[0].primitives).toHaveLength(0);
    expect(readCutsceneScene(lookout).environment).toMatchObject({targetSeason:'autumn',ambientSpeed:4});
  });
  it('preserves flat surface shading while rejecting unsupported vertex gradients',()=>{
    const a=map(image([0,255,0])),b=map(image([255,255,255]));for(const data of [a,b])data.chunks[0].primitives[0].colors=new Float32Array(9).fill(19/31);
    const out=convertMapCutsceneAssets(a,37,{source:environment,target:b}),bytes=out.groups[0].find(g=>String.fromCharCode(...g.slice(0,4))==='BMA0')!;
    expect(readNitroMaterialAnimation(bytes).sample(0).get('mat0')!.diffuse).toEqual([19/31,19/31,19/31]);
    for(const data of [a,b])data.chunks[0].primitives[0].colors![0]=1;
    expect(()=>convertMapCutsceneAssets(a,37,{source:environment,target:b})).toThrow('gradients');
  });
  it('writes independent native material RGB/alpha samples with constants and deterministic sharing',()=>{
    const samples=Array.from({length:12},(_,f)=>({diffuse:[f/11,1,0] as [number,number,number],ambient:[1,1,1] as [number,number,number],specular:[0,0,0] as [number,number,number],emission:[0,0,0] as [number,number,number],alpha:f/11}));
    const tracks=[{name:'a',samples},{name:'b',samples}],bytes=writeNitroMaterialColor(12,tracks),clip=readNitroMaterialAnimation(bytes);
    for(let f=0;f<12;f++){expect(clip.sample(f).get('a')).toEqual(clip.sample(f).get('b'));expect(clip.sample(f).get('a')!.diffuse[0]).toBe(Math.round(f/11*31)/31);expect(clip.sample(f).get('a')!.alpha).toBe(Math.round(f/11*31)/31);}
    expect(writeNitroMaterialColor(12,tracks)).toEqual(bytes);expect(()=>writeNitroMaterialColor(11,tracks)).toThrow('length');
  });
  it('rejects geometry changes and validates source bounds/environment through project persistence',()=>{
    const a=map(image([0,255,0])),b=map(image([255,255,255]));b.chunks[0].primitives[0].positions[0]=1;expect(()=>pairEnvironmentPrimitives(a,b)).toThrow('layout');
    expect(scopeCutsceneMap(a,{west:672,north:192,width:32,height:32}).chunks).toHaveLength(1);expect(()=>scopeCutsceneMap(a,{west:0,north:0,width:32,height:32})).toThrow('no terrain');
    const scene=readCutsceneScene({...sample,environment:{...sample.environment,ambientSpeed:4},stage:{...sample.stage,includeNeighbors:true}}),project=makeEditProject();storeCutsceneScene(project,scene);
    expect(openProjectSession(structuredClone(createProjectDocument(project,false))).cutsceneAuthoring!.scenes[scene.id].source).toEqual(scene);
    const invalid=structuredClone(sample);invalid.environment.dayCycles=0;expect(()=>readCutsceneScene(invalid)).toThrow('cycles');
    expect(()=>readCutsceneScene({...sample,environment:{...sample.environment,ambientSpeed:0}})).toThrow('speed');
    const bad=structuredClone(sample);bad.stage.bounds.width=31;expect(()=>readCutsceneScene(bad)).toThrow('32-tile');
    const end=structuredClone(sample);end.environment.endFrame=end.frameCount;expect(()=>readCutsceneScene(end)).toThrow('timeline');
  });
});
