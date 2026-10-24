import {describe,it,expect} from 'vitest';
import fixture from '../../examples/cutscenes/aspertia.time-travel.field-scene.json';
import {readFieldScene,compileFieldScene,storeFieldScene} from '../pokeweb/fieldScene';
import {encodeFieldSeasonTexture,prepareFieldTexturePack} from '../pokeweb/fieldEnvironmentAssets';
import {serializeFieldEnvironment} from '../pokeweb/fieldEnvironmentRuntime';
import {nitroBlocks,writeNitroFile,readDictionary,writeDictionary,align} from '../pokeweb/nitroResourceWriter';
import {readNitroResources,decodeTexture} from '../pokeweb/map3dModel';
import {readU16,readU32,writeU16,writeU32} from '../nds/binary';
import {makeEditProject} from './fixtures/editProject';
import {createProjectDocument} from '../pokeweb/projectDocument';
import {openProjectSession} from '../pokeweb/projectSession';
const image=(rgb:number[],alpha=255)=>({name:'terrain',width:8,height:8,rgba:Uint8Array.from(Array.from({length:64},()=>[...rgb,alpha]).flat())});
describe('live field seasonal environment',()=>{
  it('keeps the native player, returns to the saved region camera, and emits no ending fade',()=>{
    const scene=readFieldScene(fixture),ops=compileFieldScene(scene).compiled.instructions.map(i=>i.opcode);
    expect(ops.slice(-6)).toEqual([0x144,0x145,0x142,0x140,0x2f,2]);expect(ops).not.toContain(0x147);
    for(const fade of [0x154,0x14a,0x14b,0x1a3,0x1a4])expect(ops).not.toContain(fade);
    expect(compileFieldScene(scene,true).source).toContain('cmd_00c2 427, 35, 709, 0');
    const onsite=compileFieldScene(scene,'entry-trigger');expect(onsite.compiled.instructions.some(i=>i.opcode===0xc2)).toBe(false);expect(onsite.compiled.bytes.slice(onsite.compiled.entries[0].offset,onsite.compiled.entries[0].offset+64)).toEqual(compileFieldScene(scene,true).compiled.bytes.slice(compileFieldScene(scene,true).compiled.entries[0].offset,compileFieldScene(scene,true).compiled.entries[0].offset+64));
    const project=makeEditProject();storeFieldScene(project,scene);expect(openProjectSession(createProjectDocument(project,false)).fieldScenes!.scenes[scene.id]).toEqual(scene);
  });
  it('rejects unsafe entry-camera movement and incompatible environment clocks',()=>{
    const moved=readFieldScene(fixture);moved.steps.splice(1,0,{id:'walk',type:'player.walk',direction:'down',tiles:1});expect(()=>readFieldScene(moved)).toThrow('entry tile');
    const dialogue=readFieldScene(fixture);dialogue.steps.splice(1,0,{id:'talk',type:'dialogue',speakerId:'player',text:'Hello.',waitForInput:true});expect(()=>readFieldScene(dialogue)).toThrow('timed dialogue');
    expect(()=>readFieldScene({...fixture,environment:{...fixture.environment,ambientSpeed:0}})).toThrow('speed');
    expect(()=>readFieldScene({...fixture,environment:{...fixture.environment,endFrame:750}})).toThrow('before control');
  });
  it('retains distinct texel artwork and exact binary masks at both endpoints',()=>{
    const a=image([0,255,0]),b=image([255,0,0]);a.rgba[3]=0;b.rgba[7]=0;b.rgba.set([0,0,255,255],8);
    const encoded=encodeFieldSeasonTexture(a,b);expect(encoded.params>>>26&7).toBe(4);
    for(const [side,bit]of [['source',1],['target',2]] as const){const expected=side==='source'?a:b,palette=encoded[side];for(let i=0;i<64;i++){const index=encoded.masks[i]&bit?encoded.indices[i]:0;expect(Boolean(index)).toBe(Boolean(expected.rgba[i*4+3]));if(index){const color=readU16(palette,index*2);for(let c=0;c<3;c++)expect(color>>c*5&31).toBe(Math.round(expected.rgba[i*4+c]*31/255));}}}
    expect(encoded.pixels[0]).toBe(0);expect(encoded.pixels[1]).toBeGreaterThan(0);
  });
  it('preserves supported fixed translucent alpha and refuses unsupported masks',()=>{
    const a=image([0,255,0],148),b=image([255,0,0],148),encoded=encodeFieldSeasonTexture(a,b);expect(encoded.params>>>26&7).toBe(1);expect([...encoded.pixels].every(v=>v>>>5===4)).toBe(true);
    b.rgba[3]=255;expect(()=>encodeFieldSeasonTexture(a,b)).toThrow('binary');
  });
  it('converts a four-colour seasonal palette with native address units and exact RGBA',()=>{
    const texture=new Uint8Array(8),palette=new Uint8Array(4);writeU32(texture,0,2<<26|1<<29);writeU32(texture,4,8|8<<11|0x80000000);writeU16(palette,2,1);
    const td=writeDictionary([{name:'fringe',data:texture}],8),pd=writeDictionary([{name:'fringe_pl',data:palette}],4),pixels=align(60+td.length+pd.length,8),palettes=pixels+16,tex=new Uint8Array(palettes+8),header=new Uint8Array(16);
    header.set(new TextEncoder().encode('BTX0'));writeU16(header,4,0xfeff);writeU16(header,6,1);writeU16(header,12,16);
    tex.set(new TextEncoder().encode('TEX0'));writeU32(tex,4,tex.length);writeU16(tex,12,2);writeU16(tex,14,60);writeU32(tex,20,pixels);writeU32(tex,36,palettes);writeU32(tex,40,palettes);writeU16(tex,48,1);writeU32(tex,52,60+td.length);writeU32(tex,56,palettes);tex.set(td,60);tex.set(pd,60+td.length);
    const images=[[0,255,0],[0,128,0],[255,128,0],[255,255,255]].map(color=>({...image(color),name:'fringe'}));images.forEach(im=>im.rgba[3]=0);
    const prepared=prepareFieldTexturePack(writeNitroFile(header,[tex]),new Map([['fringe',{palette:'fringe_pl',images}]])),block=nitroBlocks(prepared.file)[0],binding=readDictionary(block,readU32(block,52))[0];
    expect(readU16(binding.data,2)&1).toBe(0);
    for(let season=0;season<4;season++){const copy=block.slice();copy.set(prepared.program.seasons![season],readU32(copy,56));const resources=readNitroResources(writeNitroFile(prepared.file,[copy])),rgba=decodeTexture(resources.textures[0],resources.palettes[0])!.rgba;
      expect(rgba[3]).toBe(0);for(let c=0;c<3;c++)expect(Math.round(rgba[4+c]*31/255)).toBe(Math.round(images[season].rgba[4+c]*31/255));
    }
  });
  it('writes bounded native samples, exact lookup tables and mutable transfer buffers',()=>{
    const scene=readFieldScene(fixture),p=encodeFieldSeasonTexture(image([0,255,0]),image([255,0,0])),bytes=serializeFieldEnvironment(scene,[{hash:123,source:p.source,target:p.target,pixels:[{width:8,offset:64,indices:p.indices,masks:p.masks}]}]);
    expect(readU32(bytes,0)).toBe(0x45465750);expect(readU32(bytes,8)).toBe(bytes.length);expect(readU32(bytes,40)).toBe(2);
    const samples=readU32(bytes,52);expect(readU16(bytes,samples+660*16)).toBe(31);expect(readU16(bytes,samples+660*16+2)).toBe(32767);
    const blend=readU32(bytes,56),tint=readU32(bytes,60);for(let level=0;level<32;level++)for(let x=0;x<32;x++)for(let y=0;y<32;y++)expect(bytes[blend+level*1024+x*32+y]).toBe(Math.round((x*(31-level)+y*level)/31));
    expect(bytes[tint+31*32+31]).toBe(31);const row=readU32(bytes,48),work=readU32(bytes,row+16);expect(bytes.slice(work,work+p.source.length).every(v=>v===0)).toBe(true);
  });
});
