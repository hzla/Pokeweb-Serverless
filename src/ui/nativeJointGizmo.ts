import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { compileNativeCutscene } from '../pokeweb/nativeCutsceneModel';
import type { NativeJointChange } from '../pokeweb/nativeObjectMovement';

type Models=ReturnType<typeof compileNativeCutscene>['models'];
export type JointSelection={model:number;node:number};
export type JointGizmoCallbacks={select?(joint:JointSelection):void;start?():void;pose?(joint:JointSelection,change:NativeJointChange):void;error?(error:unknown):void};

/** The proxy's parent is the exact native matrix before local rotation/scale.
 * Rendered vertices still come from the native joint evaluator, not Three skinning. */
export function mountNativeJointGizmo(canvas:HTMLCanvasElement,scene:THREE.Scene,camera:THREE.Camera,models:Models,callbacks:JointGizmoCallbacks,redraw:()=>void,onDragging:(dragging:boolean)=>void){
  const transform=new TransformControls(camera,canvas), helper=transform.getHelper();transform.setSpace('local');transform.setMode('rotate');transform.setSize(.85);scene.add(helper);
  const parent=new THREE.Object3D(),proxy=new THREE.Object3D();parent.matrixAutoUpdate=false;parent.add(proxy);scene.add(parent);
  const overlays=models.map(model=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(model.jointIndices.length*3),3));
    const material=new THREE.PointsMaterial({color:0x69e8d1,size:8,sizeAttenuation:false,depthTest:false,depthWrite:false});
    const points=new THREE.Points(geometry,material);points.frustumCulled=false;points.renderOrder=200;scene.add(points);
    const linesGeometry=new THREE.BufferGeometry();linesGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(model.jointIndices.length*6),3));
    const linesMaterial=new THREE.LineBasicMaterial({color:0x69e8d1,transparent:true,opacity:.6,depthTest:false,depthWrite:false});
    const lines=new THREE.LineSegments(linesGeometry,linesMaterial);lines.frustumCulled=false;lines.renderOrder=199;scene.add(lines);
    return {geometry,material,points,linesGeometry,linesMaterial,lines};
  });
  let enabled=false,selected:JointSelection|undefined,syncing=false,changed=false,canceling=false,dragFrame=-1,lastFrame=0;
  const clearOverride=()=>{if(selected)models[selected.model]?.jointOverrides.delete(selected.node);};
  function cancel(){canceling=true;transform.reset();transform.dragging=false;clearOverride();changed=false;canceling=false;onDragging(false);redraw();}
  transform.addEventListener('change',()=>{if(!syncing)redraw();});
  transform.addEventListener('dragging-changed',e=>{if(e.value){dragFrame=lastFrame;changed=false;}onDragging(Boolean(e.value));});
  transform.addEventListener('mouseDown',()=>{changed=false;dragFrame=lastFrame;callbacks.start?.();});
  transform.addEventListener('objectChange',()=>{
    if(syncing||canceling||!selected)return;
    const model=models[selected.model];
    const rotation=new THREE.Matrix4().makeRotationFromQuaternion(proxy.quaternion).transpose().toArray();
    const scale=proxy.scale.toArray();
    model.jointOverrides.set(selected.node,transform.mode==='rotate'?{rotation}:{scale,inverseScale:scale.map(n=>n?1/n:0) as [number,number,number]});
    changed=true;redraw();
  });
  transform.addEventListener('mouseUp',()=>{
    if(canceling||!selected||!changed)return;
    changed=false;
    try{const value=models[selected.model].jointOverrides.get(selected.node)!;callbacks.pose?.(selected,{...(value.rotation?{rotation:value.rotation}:{}),...(value.scale?{scale:value.scale}:{})});}
    catch(error){clearOverride();callbacks.error?.(error);redraw();}
  });
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Escape'&&transform.dragging){e.preventDefault();e.stopPropagation();cancel();}};
  const pointercancel=()=>{if(transform.dragging)cancel();};
  canvas.addEventListener('keydown',keydown);canvas.addEventListener('pointercancel',pointercancel);
  function sync(frame:number){
    lastFrame=frame;if(transform.dragging&&dragFrame!==frame&&!canceling)cancel();
    syncing=true;
    try{
      overlays.forEach((overlay,i)=>{
        const model=models[i];overlay.points.visible=overlay.lines.visible=enabled&&Boolean(model.skeletalFrames);
        if(!overlay.points.visible)return;
        const positions=overlay.geometry.getAttribute('position'),lines=overlay.linesGeometry.getAttribute('position');
        model.jointIndices.forEach((node,index)=>{
          const point=model.jointPositions.subarray(node*3,node*3+3),p=model.jointParents[node],other=p>=0?model.jointPositions.subarray(p*3,p*3+3):point;
          positions.setXYZ(index,...point as unknown as [number,number,number]);lines.setXYZ(index*2,...other as unknown as [number,number,number]);lines.setXYZ(index*2+1,...point as unknown as [number,number,number]);
        });positions.needsUpdate=lines.needsUpdate=true;
      });
      if(enabled&&selected){
        const model=models[selected.model],pose=model?.jointPoses[selected.node];
        if(pose&&!transform.dragging){
          parent.matrix.fromArray(model.jointPoseBases[selected.node]).transpose();parent.matrixWorldNeedsUpdate=true;
          proxy.position.set(0,0,0);proxy.quaternion.setFromRotationMatrix(new THREE.Matrix4().fromArray(pose.rotation).transpose()).normalize();proxy.scale.fromArray(pose.scale);
          parent.updateMatrixWorld(true);if(transform.object!==proxy)transform.attach(proxy);
        }
      }else if(transform.object)transform.detach();
      helper.visible=enabled&&Boolean(selected);
    }finally{syncing=false;}
  }
  return {
    sync,
    get dragging(){return transform.dragging;},
    setEnabled(value:boolean){if(value!==enabled&&transform.dragging)cancel();enabled=value;if(!value)clearOverride();sync(lastFrame);},
    select(value?:JointSelection){if(transform.dragging)cancel();clearOverride();selected=value;sync(lastFrame);},
    mode(mode:'rotate'|'scale'){transform.setMode(mode);},
    pick(x:number,y:number){
      if(!enabled)return false;if(transform.axis)return true;
      const rect=canvas.getBoundingClientRect();let best=11,hit:JointSelection|undefined;
      models.forEach((model,i)=>{if(!model.skeletalFrames)return;for(const node of model.jointIndices){
        const p=new THREE.Vector3().fromArray(model.jointPositions,node*3).project(camera);if(p.z<-1||p.z>1)continue;
        const distance=Math.hypot(rect.left+(p.x+1)*rect.width/2-x,rect.top+(1-p.y)*rect.height/2-y);
        if(distance<best){best=distance;hit={model:i,node};}
      }});
      if(hit)callbacks.select?.(hit);return true;
    },
    dispose(){canvas.removeEventListener('keydown',keydown);canvas.removeEventListener('pointercancel',pointercancel);transform.dispose();helper.removeFromParent();parent.removeFromParent();for(const o of overlays){o.geometry.dispose();o.material.dispose();o.linesGeometry.dispose();o.linesMaterial.dispose();o.points.removeFromParent();o.lines.removeFromParent();}}
  };
}
