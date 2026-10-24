import { concatBytes, writeU16, writeU32 } from '../nds/binary';
import { align, ensure, writeDictionary, writeNitroFile } from './nitroResourceWriter';
import type { NitroTextureSrt } from './nitroAnimation';
import type { NitroMaterialSample } from './nitroSceneAnimation';
export type TextureSrtTrack = {
  name: string;
  samples: NitroTextureSrt[];
};
export type TexturePatternTrack = {
  name: string;
  keys: Array<{
    frame: number;
    textureName: string;
    paletteName: string;
  }>;
};
const text = (value: string) => new TextEncoder().encode(value);
export type MaterialColorTrack={name:string;samples:NitroMaterialSample[]};
function frameRange(frames: number) {
  ensure(Number.isInteger(frames) && frames > 0 && frames <= 65535, 'Native material animations require 1–65535 frames.');
}
function fx(value: number, bits: number) {
  const encoded = Math.round(value * 4096);
  ensure(Number.isFinite(value) && encoded >= -(2 ** (bits - 1)) && encoded < 2 ** (bits - 1), 'Material animation exceeds its native fixed-point range.');
  return encoded;
}
function file(stamp: string, block: string, clip: Uint8Array) {
  const entry = new Uint8Array(4), dict = writeDictionary([{ name: 'map_animation', data: entry }], 4);
  writeU32(entry, 0, 8 + dict.length);
  const payload = concatBytes([text(block), new Uint8Array(4), writeDictionary([{ name: 'map_animation', data: entry }], 4), clip]);
  writeU32(payload, 4, payload.length);
  const header = new Uint8Array(16);
  header.set(text(stamp));
  writeU16(header, 4, 0xfeff);
  writeU16(header, 6, 1);
  writeU16(header, 12, 16);
  return writeNitroFile(header, [payload]);
}
/** Dense native texture transforms; constant channels and identical sample arrays share storage. */
export function writeNitroTextureSrt(frameCount: number, tracks: TextureSrtTrack[]): Uint8Array {
  frameRange(frameCount);
  ensure(tracks.length > 0 && tracks.every(t => t.samples.length === frameCount), 'Invalid texture transform track length.');
  const entries = tracks.map(t => ({ name: t.name, data: new Uint8Array(40) }));
  const dictionarySize = writeDictionary(entries, 40).length, arrays: Uint8Array[] = [], offsets = new Map<string, number>();
  let cursor = 8 + dictionarySize;
  const store = (values: number[], width: number) => {
    const bytes = new Uint8Array(align(values.length * width));
    values.forEach((n, i) => width === 2 ? writeU16(bytes, i * width, n & 0xffff) : writeU32(bytes, i * width, n >>> 0));
    const key = `${width}:` + values.join(',');
    let offset = offsets.get(key);
    if (offset === undefined) {
      offset = cursor;
      offsets.set(key, offset);
      arrays.push(bytes);
      cursor += bytes.length;
    }
    return offset;
  };
  tracks.forEach((track, index) => {
    const record = entries[index].data;
    for (const [channel, field] of ['scaleS', 'scaleT', 'rotation', 'transS', 'transT'].entries()) {
      if (field === 'rotation') {
        const values = track.samples.flatMap(s => [fx(s.sin, 16), fx(s.cos, 16)]);
        const constant = track.samples.every(s => fx(s.sin, 16) === values[0] && fx(s.cos, 16) === values[1]);
        writeU32(record, channel * 8, (frameCount | (constant ? 0x20000000 : 0)) >>> 0);
        writeU32(record, channel * 8 + 4, constant ? ((values[0] & 0xffff) | ((values[1] & 0xffff) << 16)) >>> 0 : store(values, 2));
      }
      else {
        const values = track.samples.map(s => fx(s[field as keyof NitroTextureSrt], 32)), constant = values.every(n => n === values[0]);
        const small = values.every(n => n >= -32768 && n <= 32767);
        writeU32(record, channel * 8, (frameCount | (small ? 0x10000000 : 0) | (constant ? 0x20000000 : 0)) >>> 0);
        writeU32(record, channel * 8 + 4, constant ? values[0] >>> 0 : store(values, small ? 2 : 4));
      }
    }
  });
  const header = new Uint8Array(8);
  header.set(text('M\0AT'));
  writeU16(header, 4, frameCount);
  return file('BTA0', 'SRT0', concatBytes([header, writeDictionary(entries, 40), ...arrays]));
}
/** Texture/palette names resolve against the model's embedded TEX0 dictionaries. */
export function writeNitroTexturePattern(frameCount: number, tracks: TexturePatternTrack[]): Uint8Array {
  frameRange(frameCount);
  ensure(tracks.length > 0, 'A texture pattern requires tracks.');
  const textures = [...new Set(tracks.flatMap(t => t.keys.map(k => k.textureName)))], palettes = [...new Set(tracks.flatMap(t => t.keys.map(k => k.paletteName)))];
  ensure(textures.length > 0 && textures.length <= 255 && palettes.length <= 255, 'Native texture pattern name tables exceed 255 entries.');
  for (const track of tracks)
    ensure(track.keys.length > 0 && track.keys[0].frame === 0 && track.keys.every((k, i) => Number.isInteger(k.frame) && k.frame >= 0 && k.frame < frameCount && (!i || k.frame > track.keys[i - 1].frame)), 'Invalid texture pattern keyframes.');
  const entries = tracks.map(t => ({ name: t.name, data: new Uint8Array(8) })), dictionarySize = writeDictionary(entries, 8).length;
  let cursor = 12 + dictionarySize;
  const tables = tracks.map((track, i) => {
    ensure(track.keys.length <= 65535 && cursor <= 65535, 'Native texture pattern key table exceeds its offset range.');
    writeU16(entries[i].data, 0, track.keys.length);
    writeU16(entries[i].data, 4, Math.floor(track.keys.length * 4096 / frameCount));
    writeU16(entries[i].data, 6, cursor);
    const bytes = new Uint8Array(track.keys.length * 4);
    track.keys.forEach((key, j) => {
      writeU16(bytes, j * 4, key.frame);
      bytes[j * 4 + 2] = textures.indexOf(key.textureName);
      bytes[j * 4 + 3] = palettes.indexOf(key.paletteName);
    });
    cursor += bytes.length;
    return bytes;
  });
  const textureOffset = cursor, paletteOffset = cursor + textures.length * 16;
  ensure(paletteOffset <= 65535, 'Native texture pattern name table exceeds its offset range.');
  const names = (values: string[]) => {
    const bytes = new Uint8Array(values.length * 16);
    values.forEach((value, i) => {
      ensure(/^[\x20-\x7e]{1,16}$/.test(value), 'Invalid texture pattern resource name.');
      bytes.set(text(value), i * 16);
    });
    return bytes;
  };
  const header = new Uint8Array(12);
  header.set(text('M\0PT'));
  writeU16(header, 4, frameCount);
  header[6] = textures.length;
  header[7] = palettes.length;
  writeU16(header, 8, textureOffset);
  writeU16(header, 10, paletteOffset);
  return file('BTP0', 'PAT0', concatBytes([header, writeDictionary(entries, 8), ...tables, names(textures), names(palettes)]));
}

/** Native material colour/alpha tracks. Diffuse also sets the current vertex
 * colour; callers must not overwrite it with COLOR commands in their mesh. */
export function writeNitroMaterialColor(frameCount:number,tracks:MaterialColorTrack[]) {
  frameRange(frameCount);
  ensure(tracks.length>0&&tracks.every(t=>t.samples.length===frameCount),'Invalid material colour track length.');
  const entries=tracks.map(t=>({name:t.name,data:new Uint8Array(20)})),arrays:Uint8Array[]=[],offsets=new Map<string,number>();
  let cursor=8+writeDictionary(entries,20).length;
  tracks.forEach((track,index)=>{
    (['diffuse','ambient','specular','emission','alpha'] as const).forEach((field,channel)=>{
      const width=field==='alpha'?1:2;
      const values=track.samples.map(s=>{
        const v=s[field],components=typeof v==='number'?[v]:v;
        ensure(components.every(n=>Number.isFinite(n)&&n>=0&&n<=1),'Material colours/alpha must be in 0–1.');
        if(typeof v==='number')return Math.round(v*31);
        const c=v.map(n=>Math.round(n*31));return c[0]|c[1]<<5|c[2]<<10|(channel===0?0x8000:0);
      });
      let flags:number;
      if(values.every(v=>v===values[0]))flags=0x20000000|values[0];
      else{
        const key=`${width}:${values.join(',')}`;let at=offsets.get(key);
        if(at===undefined){at=cursor;ensure(at<=65535,'Material colour samples exceed native offsets.');const bytes=new Uint8Array(align(values.length*width));values.forEach((v,i)=>width===1?bytes[i]=v:writeU16(bytes,i*2,v));arrays.push(bytes);offsets.set(key,at);cursor+=bytes.length;}
        flags=at;
      }
      writeU32(entries[index].data,channel*4,flags);
    });
  });
  const header=new Uint8Array(8);header.set(text('M\0AM'));writeU16(header,4,frameCount);
  return file('BMA0','MAT0',concatBytes([header,writeDictionary(entries,20),...arrays]));
}
