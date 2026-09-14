// Render the code-native masks as transparent PNGs and a nearest-neighbor sheet.
const fs=require('node:fs'),path=require('node:path');
let PNG;
try { ({PNG}=require('pngjs')); }
catch { ({PNG}=require('../../Pokeweb-Serverless/node_modules/pngjs')); }
const a=JSON.parse(fs.readFileSync(path.join(__dirname,'assets.json')));
const out=path.join(__dirname,'build','icons');fs.mkdirSync(out,{recursive:true});
const sheet=new PNG({width:6*14,height:3*14});
for(let t=0;t<18;t++){
  const p=new PNG({width:10,height:10}),color=a.rgb555[t];
  for(let y=0;y<10;y++)for(let x=0;x<10;x++){
    const i=(y*10+x)*4,visible=a.outline[y]&(512>>x);
    const inside=x>0&&x<9&&y>0&&y<9&&(a.circle[y-1]&(128>>(x-1)));
    const white=inside&&(a.symbols[t][y-1]&(128>>(x-1)));
    for(let c=0;c<3;c++)p.data[i+c]=!inside?16:white?247:Math.round(((color>>(c*5))&31)*255/31);
    p.data[i+3]=visible?255:0;
    const j=(((t/6|0)*14+y+2)*sheet.width+(t%6)*14+x+2)*4;
    p.data.copy(sheet.data,j,i,i+4);
  }
  fs.writeFileSync(path.join(out,a.names[t].toLowerCase()+'.png'),PNG.sync.write(p));
}
fs.writeFileSync(path.join(out,'sheet.png'),PNG.sync.write(sheet));
const big=new PNG({width:sheet.width*8,height:sheet.height*8});
for(let y=0;y<big.height;y++)for(let x=0;x<big.width;x++){
  const i=((y/8|0)*sheet.width+(x/8|0))*4,j=(y*big.width+x)*4;
  const bg=((x/32|0)+(y/32|0))%2?42:53;
  for(let c=0;c<3;c++)big.data[j+c]=sheet.data[i+3]?sheet.data[i+c]:bg;
  big.data[j+3]=255;
}
fs.writeFileSync(path.join(out,'preview-8x.png'),PNG.sync.write(big));
console.log(out);
