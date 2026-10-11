import { readFileSync, writeFileSync } from "node:fs";
import { NintendoDSRom } from "../src/nds/rom";
import { buttonAssets } from "../src/pokeweb/cgearButtonsModel";
import { defaults } from "../src/cgearButtons/document";
import { compile, preview } from "../src/cgearButtons/compiler";
import { nativePreview } from "../src/cgearButtons/nativePreview";
import { encodePng } from "../src/customUi/assets";
import type { ProjectState } from "../src/pokeweb/projectStore";
const path=process.argv[2]??"../cleanwhite2.nds",rom=new NintendoDSRom(new Uint8Array(readFileSync(path)),{fileData:"view"});
const project={fileSystem:{replacements:{}},texts:{banks:{}},narcs:{}} as unknown as ProjectState;
const assets=buttonAssets(project,rom),doc=defaults(),result=compile(doc,assets);if(!result.archive)throw new Error(JSON.stringify(result.diagnostics));
writeFileSync("src/assets/codeinjection/cgearQuickActions.narc",result.archive);
const pixels=nativePreview(assets.native,0,0,0,true,undefined,!!doc.hideCommunicationButtons,result.nativeGraphics).pixels;
for(let i=0;i<doc.buttons.length;i++){const image=preview(result.archive,i,0,0,0,0,assets.native);const b=doc.buttons[i];for(let y=0;y<32;y++)for(let x=0;x<32;x++){const n=(y*32+x)*4;if(image.pixels[n+3])pixels.set(image.pixels.subarray(n,n+4),((b.y-16+y)*256+b.x-16+x)*4);}}
writeFileSync("src/assets/codeinjection/cgearQuickActionsPreview.png",encodePng({width:256,height:192,pixels}));
