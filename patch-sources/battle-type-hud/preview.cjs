// Render the code-native masks as transparent PNGs and a nearest-neighbor sheet.
const fs=require('node:fs'),path=require('node:path');
let PNG;
try { ({PNG}=require('pngjs')); }
catch { ({PNG}=require('../../Pokeweb-Serverless/node_modules/pngjs')); }
function render(assetName,outputName){
const a=JSON.parse(fs.readFileSync(path.join(__dirname,assetName)));
const out=path.join(__dirname,'build',outputName);fs.mkdirSync(out,{recursive:true});
const stacked=a.previewMode==='mono-stack';
const wedge=a.previewMode==='split-wedge';
const iw=stacked?a.iconWidth+a.stackDx:a.iconWidth;
const ih=stacked?a.iconHeight+a.stackDy:a.iconHeight;
const cellW=iw+4,cellH=ih+4;
const sheet=new PNG({width:6*cellW,height:3*cellH});
for(let t=0;t<18;t++){
  const p=new PNG({width:iw,height:ih}),color=a.rgb555[t];
  for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){
    const at=(rows,ox,oy)=>x>=ox&&x<ox+a.iconWidth&&y>=oy&&y<oy+a.iconHeight
      &&(rows[y-oy]&(2048>>(x-ox)));
    const i=(y*iw+x)*4;
    const visible=stacked?(at(a.outline,0,0)||at(a.outline,a.stackDx,a.stackDy))
      :at(a.outline,0,0);
    const primary=wedge?at(a.primary,0,0):false;
    const secondary=wedge?at(a.secondary,0,0):false;
    const primaryShade=wedge?at(a.primaryShade,0,0):false;
    const secondaryShade=wedge?at(a.secondaryShade,0,0):false;
    let inside=wedge?(primary||secondary||primaryShade||secondaryShade):stacked?(at(a.fill,0,0)||at(a.fill,a.stackDx,a.stackDy))
      :at(a.fill,0,0);
    const white=!stacked&&!wedge&&inside&&at(a.symbols[t],0,0);
    const dither=primaryShade||secondaryShade;
    const pixelColor=secondary||secondaryShade?a.rgb555[(t+1)%18]:color;
    if(wedge&&dither&&!((x+y)&1)) inside=false;
    for(let c=0;c<3;c++)p.data[i+c]=!inside?16:white?247:Math.round(((pixelColor>>(c*5))&31)*255/31);
    p.data[i+3]=visible?255:0;
    const j=(((t/6|0)*cellH+y+2)*sheet.width+(t%6)*cellW+x+2)*4;
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
}
render('assets.json','icons');
render('assets-circular.json','icons-circular');
render('assets-solid.json','icons-solid');
