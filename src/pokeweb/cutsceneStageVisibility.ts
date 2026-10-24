import {Box3,Vector3,Frustum,Matrix4,PerspectiveCamera} from 'three';
import type {Map3dSceneData,Map3dPrimitive} from './map3dModel';
import {sampleCutsceneCamera,type CutsceneScene} from './cutsceneScene';

/** Conservative static culling over every authored camera sample. A surface is
 * removed only when its world bounding box misses every view in the sequence. */
export function visibleCutsceneMap(data:Map3dSceneData,source:CutsceneScene):Map3dSceneData {
  const camera=new PerspectiveCamera(40,4/3,.25,65536),frusta:Frustum[]=[];
  for(let frame=0;frame<source.frameCount;frame++){
    const pose=sampleCutsceneCamera(source,frame);camera.position.fromArray(pose.position);camera.rotation.set(...pose.rotationDegrees.map(v=>v*Math.PI/180) as [number,number,number],'YXZ');camera.fov=pose.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    frusta.push(new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)));
  }
  const point=new Vector3(),box=new Box3();
  function visible(p:Map3dPrimitive,object:{worldX:number;worldY?:number;worldZ:number;rotationY?:number}){
    box.makeEmpty();const angle=(object.rotationY??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(const index of p.indices){const [x,y,z]=p.positions.subarray(index*3,index*3+3);box.expandByPoint(point.set(x*c+z*s+object.worldX,y+(object.worldY??0),z*c-x*s+object.worldZ));}
    return frusta.some(f=>f.intersectsBox(box));
  }
  return {...data,chunks:data.chunks.map(c=>({...c,primitives:c.primitives.filter(p=>visible(p,c))})),buildings:data.buildings.map(b=>({...b,primitives:b.primitives.filter(p=>visible(p,b))})).filter(b=>b.primitives.length)};
}
