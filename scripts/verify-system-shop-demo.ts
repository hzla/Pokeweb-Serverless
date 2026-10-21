/** Verify the separately exported seven-button TM/Heart Scale demo and copied save. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../src/nds/rom';
import { NARC } from '../src/nds/narc';
import { recoverCGearButtons } from '../src/pokeweb/cgearButtonsModel';
import { defaults } from '../src/cgearButtons/document';
import { recover, ARCHIVE } from '../src/systemShops/compiler';
import manifest from '../src/assets/codeinjection/cgearQuickActionsManifest.json';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const inputs=process.argv.slice(2);
if(!inputs.length)throw new Error('Pass the exported B2/W2 demo ROM filenames.');
for(const input of inputs){
  const bytes=new Uint8Array(await readFile(input)),rom=new NintendoDSRom(bytes,{fileData:'view'});
  const version=rom.idCode==='IREO'?'B2':rom.idCode==='IRDO'?'W2':undefined;
  assert(version,'Only the verified US B2/W2 demo is accepted.');
  const buttons=recoverCGearButtons(rom.files[rom.fileId(manifest.archivePath)]);
  assert.equal(buttons.document.buttons.length,7);
  assert.deepEqual(buttons.document.buttons.slice(0,6),defaults().buttons);
  assert.equal(buttons.document.buttons[6].action,'systemShop');
  assert.deepEqual(buttons.applied,buttons.document);
  const shops=recover(rom.files[rom.fileId(ARCHIVE)]);
  assert.deepEqual(shops.document,shops.applied);
  assert.equal(shops.document.shops.length,1);
  assert.equal(shops.document.shops[0].currency,93);
  assert.deepEqual(shops.document.shops[0].inventory,Array.from({length:20},(_,i)=>({item:328+i,cost:i+1})));
  const dll=rom.files[rom.fileId(`patches/${manifest.games[version].fileName}`)];
  assert.equal(sha(dll),manifest.games[version].sha256);
  const save=await readFile(input.replace(/\.nds$/iu,'.sav'));
  assert.equal(save.length,524288);
  for(const half of [0,0x26000]){
    assert.equal(save.readUInt32LE(half+0x21100),10000);
    let scales=0;
    for(let at=half+0x18400;at<half+0x18400+310*4;at+=4)if(save.readUInt16LE(at)===93)scales+=save.readUInt16LE(at+2);
    assert.equal(scales,500);
    for(let at=half+0x18a24;at<half+0x18a24+109*4;at+=4)assert(![...Array(20)].some((_,i)=>save.readUInt16LE(at)===328+i));
  }
  const arc=new NARC(rom.files[rom.fileId(ARCHIVE)]);
  console.log(JSON.stringify({file:basename(input),version,runtime:manifest.version,romSha256:sha(bytes),saveSha256:sha(save),dllSha256:sha(dll),buttons:buttons.document.buttons.map(b=>b.label),shops:shops.document.shops.map(s=>s.name),currency:'Heart Scale',quantity:500,compiledShopMembers:arc.files.length}));
}
