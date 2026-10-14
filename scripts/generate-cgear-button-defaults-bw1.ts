import { readFileSync, writeFileSync } from "node:fs";
import { NintendoDSRom } from "../src/nds/rom";
import { buttonAssets, validateButtonArchive } from "../src/pokeweb/cgearButtonsModel";
import { defaults } from "../src/cgearButtons/document";
import { compile, preview } from "../src/cgearButtons/compiler";
import { nativePreviewBw1 } from "../src/cgearButtons/nativePreviewBw1";
import { encodePng } from "../src/customUi/assets";
import type { ProjectState } from "../src/pokeweb/projectStore";
const bytes=new Uint8Array(readFileSync(process.argv[2]??"../cleanblack.nds"));
const rom=new NintendoDSRom(bytes,{fileData:"view"});
const project={session:{baseRom:"BW"},fileSystem:{replacements:{}},texts:{banks:{}},narcs:{}} as unknown as ProjectState;
const assets=buttonAssets(project,rom),doc=defaults("BW"),result=compile(doc,assets);
if(!result.archive)throw new Error(JSON.stringify(result.diagnostics));
validateButtonArchive(result.archive);
writeFileSync("src/assets/codeinjection/cgearQuickActionsBw1.narc",result.archive);
const image=nativePreviewBw1(assets.native,0,0,result.archive);
for(const [index,x,y]of [...doc.buttons.map((b,i)=>[i,b.x,b.y]),[9,218,14]]){
 const art=preview(result.archive,index);for(let y1=0;y1<art.height;y1++)for(let x1=0;x1<art.width;x1++){
  const at=(y1*art.width+x1)*4,dy=y-(index<8?32:16)+y1,dx=x-16+x1;if(dx>=0&&dx<256&&dy>=0&&dy<192&&art.pixels[at+3])image.pixels.set(art.pixels.subarray(at,at+4),(dy*256+dx)*4);
 }
}
writeFileSync("src/assets/codeinjection/cgearQuickActionsBw1Preview.png",encodePng(image));
