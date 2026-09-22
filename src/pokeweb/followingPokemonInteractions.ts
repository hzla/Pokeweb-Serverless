import { parseBtx, decodeBtxImage } from "./btxModel";
import { NARC } from "../nds/narc";
import { followerCrc32 } from "./followingPokemonModel";
/** Validate the serialized ABI before any project state is staged. */
export function validateFollowerInteractions(bytes: Uint8Array, emotes: Uint8Array): void {
  const fail = () => { throw new Error("Invalid follower interaction data or emote resources."); };
  if (bytes.length < 48 || bytes.length > 16384) fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => v.getUint16(at, true), u32 = (at: number) => v.getUint32(at, true);
  const range = (at: number, count: number) => { if (at < 48 || at > bytes.length || count > bytes.length - at) fail(); };
  if (u32(0) !== 0x4b545746 || u32(4) !== 1 || u32(8) !== bytes.length || u32(12) !== followerCrc32(bytes.subarray(16))) fail();
  const counts = [u16(16), u16(18), u16(20), u16(22)], offsets = [u32(24), u32(28), u32(32), u32(36)];
  const limits = [70, 64, 128, 14], sizes = [12, 84, 8, 16];
  counts.forEach((n, i) => { if (!n || n > limits[i]) fail(); range(offsets[i], n * sizes[i]); });
  if (emotes.length !== u32(40) || emotes.length > 32768 || followerCrc32(emotes) !== u32(44)) fail();
  const resources = new NARC(emotes).files;
  if (resources.length !== counts[3] * 2) fail();
  // Emotes are single-frame 32px I4 textures, not the six/eight-frame Pokémon format.
  for (const resource of resources) {
    if (resource.length < 80 || String.fromCharCode(...resource.subarray(0,4)) !== "BTX0") fail();
    const btx=parseBtx(resource), texture=btx.textures[0];
    if(btx.textures.length!==1||btx.palettes.length!==1||btx.warnings.length||texture.width!==32||texture.height!==32||texture.format!==3||!texture.color0Transparent) fail();
    if(btx.paletteDataSizeBytes<32||btx.paletteDataOffset+32>resource.length||texture.imageOffsetBytes+512>btx.textureDataSizeBytes||btx.textureDataOffset+texture.imageOffsetBytes+512>resource.length) fail();
    decodeBtxImage(btx,0,0,"linear");
  }
  for (let i = 0; i < counts[0]; ++i) {
    const at = offsets[0] + i * 12, n = bytes[at + 7], steps = u32(at + 8);
    if (!u16(at) || bytes[at+2]>5 || bytes[at+3]>10 || bytes[at+4]>8 || bytes[at+5]>4 || bytes[at+6]>100 || !n || n>5) fail();
    range(steps,n*8);
    for(let j=0;j<n;++j){const s=steps+j*8;if(u16(s)>counts[1] || u16(s+2)>counts[2] || u16(s+4)>2 || bytes[s+6]>counts[3]) fail();}
  }
  const last=offsets[0]+(counts[0]-1)*12;
  if(bytes[last+2]||bytes[last+3]||bytes[last+4]||bytes[last+5]||bytes[last+6]!==100) fail();
  for(let i=0;i<counts[1];++i){const at=offsets[1]+i*84,n=bytes[at+2];if(!n||n>10)fail();
    for(let j=0;j<n;++j){const s=at+4+j*8;if(bytes[s]>4||!bytes[s+1]||bytes[s+1]>120||bytes[s+5]>1)fail();for(let k=2;k<5;++k)if(v.getInt8(s+k)<-16||v.getInt8(s+k)>16)fail();}}
  for(let i=0;i<counts[2];++i){const at=offsets[2]+i*8,start=u32(at),n=u16(at+4);range(start,n*2);if(!n||n>128||start%2||u16(start+n*2-2)!==65535)fail();
    for(let j=0;j<n-1;++j){const c=u16(start+j*2);if(!c||c===65535||(c>=0xf000&&![0xfff0,0xfff1,0xfffe].includes(c)))fail();}}
  for(let i=0;i<counts[3];++i){const at=offsets[3]+i*16;if(!bytes[at]||bytes[at]>14||bytes[at+1]!==4||u16(at+2)!==i*2)fail();
    for(let j=0;j<4;++j)if(!u16(at+4+j*2)||u16(at+4+j*2)>120||bytes[at+12+j]>1)fail();}
}
