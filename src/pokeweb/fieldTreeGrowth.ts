import {readU16,readU32,writeU16,writeU32,concatBytes} from '../nds/binary';
import {readNitroResources,extractGameFreakContainer,type Map3dChunk,type Map3dPrimitive,type Map3dSceneData} from './map3dModel';
import {readDictionary,writeDictionary,nitroBlocks,writeNitroFile} from './nitroResourceWriter';
import {writeStaticNitroModel,type StaticModelMesh} from './nitroModelWriter';
import {fieldCameraStartFrame,fieldPhaseFrames,type FieldScene} from './fieldScene';
import {NARC} from '../nds/narc';
import type {NintendoDSRom} from '../nds/rom';

export function fieldTreeScale(tree:NonNullable<FieldScene['trees']>[number],frame:number){const u=Math.max(0,Math.min(1,(frame-tree.startFrame)/(tree.endFrame-tree.startFrame)));return .02+.98*u*u*(3-2*u);}

/** Check the complete 32-unit tree and a two-unit grass margin, rather than
 * anchoring a trunk to whichever cliff polygon a single center ray hits. */
export function fieldTreeGround(chunk:Map3dChunk,x:number,z:number){
 const heights:number[]=[];
 for(const dx of [-18,-9,0,9,18])for(const dz of [-18,-9,0,9,18]){
  let top=-Infinity,grass=false;
  for(const p of chunk.primitives){const name=p.material.name;if(name!=='grass01ax'&&!/^(gake|yamagake|shore|ike|michi)/.test(name))continue;
   for(let i=0;i<p.indices.length;i+=3){const a=p.indices[i]*3,b=p.indices[i+1]*3,c=p.indices[i+2]*3,v=p.positions;
    const ax=v[a]+chunk.worldX,az=v[a+2]+chunk.worldZ,bx=v[b]+chunk.worldX,bz=v[b+2]+chunk.worldZ,cx=v[c]+chunk.worldX,cz=v[c+2]+chunk.worldZ;
    const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(det)<1e-8)continue;
    const u=((bz-cz)*(x+dx-cx)+(cx-bx)*(z+dz-cz))/det,w=((cz-az)*(x+dx-cx)+(ax-cx)*(z+dz-cz))/det;
    if(u<-.00001||w<-.00001||u+w>1.00001)continue;
    const y=u*v[a+1]+w*v[b+1]+(1-u-w)*v[c+1]+(chunk.worldY??0);
    if(y>top+.001){top=y;grass=name==='grass01ax';}else if(Math.abs(y-top)<.001&&name!=='grass01ax')grass=false;
   }
  }
  if(!grass)return;heights.push(top);
 }
 if(Math.max(...heights)-Math.min(...heights)>.1)return;
 return heights[12];
}

export function validateFieldTreeGround(chunk:Map3dChunk,scene:FieldScene){
 for(const tree of scene.trees??[]){const ground=fieldTreeGround(chunk,tree.position[0],tree.position[2]);
  // Native template planes start five units above their grass surface.
  if(ground===undefined||Math.abs(tree.position[1]-ground-5)>.1)throw new Error(`Tree ${tree.id} needs a level grass footprint, clear of cliffs and water, with the native five-unit render offset.`);
 }
}

/** A complete small native tree: three foliage slices and its crossed upright
 * planes. These are geometry copies sharing the existing seasonal materials. */
export function fieldTreeTemplate(chunk:Map3dChunk){
 const result:Map3dPrimitive[]=[];
 for(const p of chunk.primitives.filter(p=>['ki02c','ki03bx','ki03dx','ki03ax'].includes(p.material.name))){
  const chosen:number[]=[];for(let i=0;i<p.indices.length;i+=3){const ids=Array.from(p.indices.slice(i,i+3));if(ids.every(j=>{const x=p.positions[j*3],y=p.positions[j*3+1],z=p.positions[j*3+2];return x>=-80.01&&x<=-47.99&&y>=68.99&&y<=122.01&&z>=-52.01&&z<=-19.99;}))chosen.push(...ids);}
  if(!chosen.length)continue;const ids=[...new Set(chosen)],mapping=new Map(ids.map((v,i)=>[v,i]));const attr=(values:Float32Array|undefined,size:number)=>values?Float32Array.from(ids.flatMap(i=>Array.from(values.slice(i*size,i*size+size)))):undefined;
  result.push({...p,positions:Float32Array.from(ids.flatMap(i=>[p.positions[i*3]+64,p.positions[i*3+1]-69,p.positions[i*3+2]+36])),indices:Uint16Array.from(chosen,v=>mapping.get(v)!),uvs:attr(p.uvs,2),colors:attr(p.colors,3),normals:attr(p.normals,3)});
 }
 if(result.length!==4||result.reduce((n,p)=>n+p.indices.length,0)!==30)throw new Error('The guarded Aspertia tree template changed.');
 return result;
}

export function previewFieldTrees(data:Map3dSceneData,scene:FieldScene){
 if(!scene.trees?.length)return data;const chunk=data.chunks.find(c=>c.chunkId===281);if(!chunk)throw new Error('The tree-growth preview requires the lookout background chunk.');validateFieldTreeGround(chunk,scene);const template=fieldTreeTemplate(chunk);
 const clones=scene.trees.flatMap(tree=>template.map(p=>{const full=p.positions.slice(),position=tree.position.map((v,i)=>v-[chunk.worldX,chunk.worldY??0,chunk.worldZ][i]);const sample=(frame:number)=>{const scale=fieldTreeScale(tree,frame);return full.map((v,i)=>v*scale+position[i%3]);};return {...p,positions:sample(0),geometryAnimation:{sample}};}));
 return {...data,chunks:data.chunks.map(c=>c===chunk?{...c,primitives:[...c.primitives,...clones]}:c)};
}

type TreeVertex = {offset:number;tree:number;full:number[];anchor:number[]};

/** Shared growth curves retain the original quantized samples while leaving
 * enough field heap for the native Save menu's temporary buffers. */
export function buildFieldTreeProgram(trees:NonNullable<FieldScene['trees']>,links:TreeVertex[],modelBytes:number,prelude:number,frames:number){
 const descriptorStart=32+links.length*20,curveStart=descriptorStart+trees.length*12;
 const curves=new Map<number,number>();let size=curveStart;
 for(const tree of trees){const duration=tree.endFrame-tree.startFrame;if(!curves.has(duration)){curves.set(duration,size);size+=(duration+1)*2+3&~3;}}
 const tail=new Uint8Array(size);
 [0x52545750,0x32574f52,modelBytes,modelBytes+16,links.length,frames,32,descriptorStart].forEach((v,i)=>writeU32(tail,i*4,v));
 for(const [duration,offset]of curves)for(let f=0;f<=duration;f++)writeU16(tail,offset+f*2,Math.round(fieldTreeScale({id:'curve',position:[0,0,0],startFrame:0,endFrame:duration},f)*4096));
 trees.forEach((tree,i)=>{const at=descriptorStart+i*12;[tree.startFrame-prelude,tree.endFrame-tree.startFrame,curves.get(tree.endFrame-tree.startFrame)!].forEach((v,k)=>writeU32(tail,at+k*4,v));});
 links.forEach((v,i)=>{const at=32+i*20;writeU32(tail,at,v.offset);writeU32(tail,at+4,descriptorStart+v.tree*12);v.full.forEach((n,j)=>writeU16(tail,at+8+j*2,n&65535));v.anchor.forEach((n,j)=>writeU16(tail,at+14+j*2,n&65535));});
 return tail;
}

export function buildFieldTreeAssets(rom:NintendoDSRom,map:Map3dSceneData,scene:FieldScene){
 if(!scene.trees?.length)return;const chunk=[...map.chunks,...map.neighboringScenery?.chunks??[]].find(c=>c.chunkId===281);if(!chunk)throw new Error('The tree-growth template chunk is unavailable.');validateFieldTreeGround(chunk,scene);
 const archive=new NARC(rom.getFileByName('a/0/0/8')),container=archive.files[281],members=extractGameFreakContainer(container).files,template=fieldTreeTemplate(chunk),meshes:StaticModelMesh[]=[],owned=new Map<StaticModelMesh,number>();
 for(const [index,tree]of scene.trees.entries())for(const p of template){const mesh={...p,materialName:p.material.name,positions:p.positions.map((v,i)=>v+tree.position[i%3]-[chunk.worldX,chunk.worldY??0,chunk.worldZ][i%3])};owned.set(mesh,index);meshes.push(mesh);}
 const links:TreeVertex[]=[];
 let submittedVertices=0;const source=readNitroResources(members[0]).models[0],compiledOnly=writeStaticNitroModel(members[0],meshes,{coordinateScale:source.upScale,onVertex(mesh,index,offset,scale){submittedVertices++;const tree=owned.get(mesh);if(tree===undefined)return;links.push({offset,tree,full:[0,1,2].map(i=>Math.round(mesh.positions[index*3+i]/scale*4096)),anchor:scene.trees![tree].position.map((v,i)=>Math.round((v-[chunk.worldX,chunk.worldY??0,chunk.worldZ][i])/scale*4096))});}});
 // Append only the new commands to their original shapes. Retail chunk buffers
 // are bounded: rebuilding all existing vertices into verbose VTX_16 commands
 // can overflow them. Preserve every original command and material binding.
 const blocks=nitroBlocks(members[0]),blockIndex=blocks.findIndex(b=>String.fromCharCode(...b.slice(0,4))==='MDL0'),mdl=blocks[blockIndex],modelOffset=readU32(readDictionary(mdl,8)[0].data,0),model=mdl.subarray(modelOffset),shapeAt=readU32(model,12),inverseAt=readU32(model,16),shapes=readDictionary(model,shapeAt);
 const compiledBlocks=nitroBlocks(compiledOnly),compiledMdl=compiledBlocks.find(b=>String.fromCharCode(...b.slice(0,4))==='MDL0')!,compiledModelAt=readU32(readDictionary(compiledMdl,8)[0].data,0),compiledModel=compiledMdl.subarray(compiledModelAt),compiledShapeAt=readU32(compiledModel,12),compiledShapes=readDictionary(compiledModel,compiledShapeAt),compiledBlockAt=readU32(compiledOnly,16+compiledBlocks.indexOf(compiledMdl)*4);
 const additions=new Map<number,{bytes:Uint8Array;start:number}>();let material=0;
 for(const op of source.renderOps){if(op.kind==='bindMaterial')material=op.material;if(op.kind==='draw'&&['ki02c','ki03bx','ki03dx','ki03ax'].includes(source.materials[material].name)){if(additions.has(op.piece))throw new Error('Repeated tree shape binding needs an explicit profile.');const at=compiledShapeAt+readU32(compiledShapes[material].data,0),start=at+readU32(compiledModel,at+8),length=readU32(compiledModel,at+12);additions.set(op.piece,{bytes:compiledModel.slice(start,start+length),start:compiledBlockAt+compiledModelAt+start});}}
 if(additions.size!==4||inverseAt!==model.length)throw new Error('The static lookout shape layout changed.');
 const dict=writeDictionary(shapes.map(s=>({name:s.name,data:new Uint8Array(4)})),4),headers=new Uint8Array(shapes.length*16),lists:Uint8Array[]=[];let cursor=dict.length+headers.length;const outputLinks=new Map<number,number>();
 for(const [i,shape]of shapes.entries()){const at=shapeAt+readU32(shape.data,0),start=at+readU32(model,at+8),length=readU32(model,at+12),extra=additions.get(i),list=concatBytes([model.slice(start,start+length),extra?.bytes??new Uint8Array()]);headers.set(model.slice(at,at+16),i*16);writeU32(headers,i*16+8,cursor-(dict.length+i*16));writeU32(headers,i*16+12,list.length);writeU32(shapes[i].data,0,dict.length+i*16);if(extra)for(const link of links)if(link.offset>=extra.start&&link.offset<extra.start+extra.bytes.length)outputLinks.set(link.offset,shapeAt+cursor+length+link.offset-extra.start);lists.push(list);cursor+=list.length;}
 const newModel=concatBytes([model.slice(0,shapeAt),writeDictionary(shapes,4),headers,...lists]);writeU32(newModel,0,newModel.length);writeU32(newModel,16,newModel.length);writeU16(newModel,36,readU16(model,36)+submittedVertices);writeU16(newModel,38,readU16(model,38)+scene.trees.length*5);writeU16(newModel,42,readU16(model,42)+scene.trees.length*5);
 blocks[blockIndex]=concatBytes([mdl.slice(0,modelOffset),newModel]);writeU32(blocks[blockIndex],4,blocks[blockIndex].length);const compiled=writeNitroFile(members[0],blocks),fileModelAt=readU32(compiled,16+blockIndex*4)+modelOffset;
 for(const link of links){const offset=outputLinks.get(link.offset);if(offset===undefined)throw new Error('A growing tree vertex lost its native command binding.');link.offset=fileModelAt+offset;}
 const prelude=fieldCameraStartFrame(scene),frames=scene.steps.reduce((n,s)=>n+fieldPhaseFrames(scene,s),0)-prelude,tail=buildFieldTreeProgram(scene.trees,links,compiled.length,prelude,frames);
 for(const v of links){const scale=fieldTreeScale(scene.trees[v.tree],prelude),p=v.full.map((n,j)=>Math.round(v.anchor[j]+(n-v.anchor[j])*scale));writeU16(compiled,v.offset,p[0]&65535);writeU16(compiled,v.offset+2,p[1]&65535);writeU16(compiled,v.offset+4,p[2]&65535);}
 const grownModel=concatBytes([compiled,tail.subarray(0,16)]);writeU32(grownModel,8,grownModel.length);const start=readU32(container,4),end=readU32(container,8),out=concatBytes([container.subarray(0,start),grownModel,container.subarray(end)]),delta=grownModel.length-(end-start);for(let i=1;i<=members.length;i++)writeU32(out,4+i*4,readU32(container,4+i*4)+delta);if(out.length>65536)throw new Error('Growing trees exceed the native 64 KiB chunk buffer.');archive.files[281]=out;
 return {fileId:rom.fileId('a/0/0/8'),bytes:archive.save(),program:tail,manifest:{trees:scene.trees.length,chunkId:281,additionalPolygons:scene.trees.length*5,additionalVertices:links.length,additionalTextureBytes:0,animatedVertexData:true,originalDisplayListsPreserved:true,modelBytes:grownModel.length,chunkBytes:out.length}};
}
