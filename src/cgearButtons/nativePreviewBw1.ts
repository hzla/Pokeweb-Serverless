import type { NARC } from "../nds/narc";
import { writeU32 } from "../nds/binary";
import { parseNitroBackground } from "../pokeweb/nitroBg";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { parsePokemonAnimation } from "../pokeweb/pokemonSpriteModel";
import { blank, blit } from "../customUi/raster";
import type { Image } from "../customUi/assets";
/** Functional BW1 preview: native background and retained clock/edit/help controls. */
export function nativePreviewBw1(native:NARC,gender=0,design=0,_compiled?:Uint8Array):Image{
 const f=native.files,image=blank(256,192),palette=f[gender?6:13];
 const controlPalette=f[gender?12:19];
 const bg=parseNitroBackground(2,f[2],f[(gender?7:14)+design%5],palette);
 if(bg.warnings.length)throw new Error(bg.warnings.join("; "));
 blit(image,{width:bg.width,height:bg.height,pixels:bg.rgba},{x:0,y:0,width:bg.width,height:bg.height});
 const animation=parsePokemonAnimation(f[20]).sequences;
 // The native character resource specifies 1D/32-byte mapping; its NCER leaves
 // that hint zero, so supply the character mapping to the standalone decoder.
 const cellBank=f[21].slice();writeU32(cellBank,32,16);
 function sprite(sequence:number,x:number,y:number,index=0){
  const frame=animation[sequence]?.frames[index];if(!frame)return;
  const cell=parseNitroCellImage("bw1-cgear",f[22],controlPalette,cellBank,frame.cellIndex,256);
  if(cell.warnings.length)throw new Error(cell.warnings.join("; "));
  blit(image,{width:256,height:256,pixels:cell.rgba},{x:x+frame.x-128,y:y+frame.y-128,width:256,height:256});
 }
 sprite(0,63,22);for(const [seq,x]of [[1,32],[2,38],[3,42],[4,47],[5,53]])sprite(seq,x,22);
 sprite(6,178,22);sprite(17,128,22);sprite(37,198,170);sprite(14,174,170,1);sprite(38,222,170);
 return image;
}
