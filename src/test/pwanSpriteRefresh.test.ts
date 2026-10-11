import { describe, it, expect } from 'vitest';
import { parseSpriteConfig, selectSpriteSource, nativeSpriteBlock, extractRomPwan, readNclrPalette, type SpriteSource } from '../../scripts/lib/pwan-sprite-refresh';
import { encodeW2AnimMani, materializeW2AnimArchive, parseW2Anim } from '../pokeweb/w2animCodec';
import { w2animEditorToLinear } from '../pokeweb/w2animAnimationModel';
import { parsePwanHeader, pwanPalette, pwanTimeline } from '../pokeweb/pwanCompiler';
import { writeU16, writeU32 } from '../nds/binary';

describe('priority-based sprite refresh', () => {
  it('selects each side independently without allowing later sources to overwrite earlier ones', () => {
    const sources: SpriteSource[] = [
      {path:'later',relative:'essentials_gifs/Front/EXAMPLE.gif',group:'essentials_gifs',priority:11,side:'front',key:'example'},
      {path:'early',relative:'gen7-sprite-work/downloads/example-front.gif',group:'gen7-sprite-work/downloads',priority:1,side:'front',key:'example'},
      {path:'back',relative:'diego-gifs/example-back.gif',group:'diego-gifs',priority:6,side:'back',key:'example'},
    ];
    expect(selectSpriteSource(sources,['Example'],'front')?.path).toBe('early');
    expect(selectSpriteSource(sources,['Example'],'back')?.path).toBe('back');
    expect(selectSpriteSource(sources,['Example Mega'],'front')).toBeUndefined();
  });
  it('rejects truncated and duplicate config rows', () => {
    const bytes = new Uint8Array(26);bytes.set(new TextEncoder().encode('PWNC'));writeU16(bytes,4,3);writeU16(bytes,6,2);writeU32(bytes,12,16);
    for(const at of [16,21]){writeU16(bytes,at,650);bytes[at+2]=96;writeU16(bytes,at+3,650);}
    expect(()=>parseSpriteConfig(bytes)).toThrow('Duplicate');
    expect(()=>parseSpriteConfig(bytes.subarray(0,25))).toThrow('Truncated');
    writeU16(bytes,21,651);expect(parseSpriteConfig(bytes)).toHaveLength(2);
  });
  it('resolves relocated Gen 7/8 and native form sprite blocks', () => {
    const personal=new Uint8Array(76);personal[32]=4;writeU16(personal,30,778);
    const row={speciesId:722,formIndex:0,assetIndex:1200,flags:3};
    expect(nativeSpriteBlock(row,personal)).toBe(950);
    expect(nativeSpriteBlock({...row,speciesId:810},personal)).toBe(1200);
    expect(nativeSpriteBlock({...row,speciesId:718,formIndex:2},personal)).toBe(1503);
  });
  it('recovers previous ROM frames, palette and timeline losslessly, with shared streams', () => {
    const palette=Uint16Array.from({length:16},(_,n)=>n*17), frame=new Uint8Array(4608);
    frame[0]=0x21;frame[4000]=0xef;
    const entry={arc:4,flags:0,sheetFile:13002,maniOffset:0,shinyNclrFile:13019};
    const mani=encodeW2AnimMani({frames:[frame],sequence:[{frame:0,duration:7},{frame:0,duration:13}],normalPalette:palette,shinyPalette:palette});
    const archive=parseW2Anim(materializeW2AnimArchive({bytes:new Uint8Array(),entries:[],manis:new Map()},new Map([['4:13002',{entry,mani}]])));
    const pwan=extractRomPwan(archive,archive.entries[0]!,new Uint16Array(16));
    const header=parsePwanHeader(pwan);
    expect(pwanPalette(pwan)).toEqual(palette);
    expect(pwanTimeline(pwan)).toEqual([{frameIndex:0,ticks:7},{frameIndex:0,ticks:13}]);
    expect(w2animEditorToLinear(pwan.subarray(header.frameOffset))).toEqual(frame);
    expect(header.totalTicks).toBe(20);
  });
  it('bounds-checks native NCLR palette payloads', () => {
    const bytes=new Uint8Array(72);bytes.set(new TextEncoder().encode('TTLP'),16);writeU32(bytes,36,16);writeU16(bytes,40,123);
    expect(readNclrPalette(bytes)[0]).toBe(123);
    expect(()=>readNclrPalette(bytes.subarray(0,71))).toThrow('Truncated');
  });
});
