import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Map3dSceneData, Map3dPrimitive, DecodedTexture, Map3dNpcSpriteFrames } from '../pokeweb/map3dModel';
import { sampleSceneNpc, sceneNpcTexture } from '../pokeweb/cutsceneActors';
import { sampleCutsceneCamera, sceneFade, type CutsceneScene, type SceneVector } from '../pokeweb/cutsceneScene';
import { Map3dTexturePreview } from './map3dTexturePreview';
import {fieldEnvironmentClock,type FieldEnvironment} from '../pokeweb/fieldEnvironmentClock';
import { sampleSceneEnvironment } from '../pokeweb/cutsceneEnvironment';

/** Field geometry uses whole-matrix world coordinates: 16 units per tile, Y up. */
export function mapCutsceneStartPose(data: Map3dSceneData) {
  const bounds = new THREE.Box3();
  for (const chunk of data.chunks) for (const p of chunk.primitives) for (let i=0;i<p.positions.length;i+=3)
    bounds.expandByPoint(new THREE.Vector3(p.positions[i]+chunk.worldX,p.positions[i+1]+(chunk.worldY??0),p.positions[i+2]+chunk.worldZ));
  if (bounds.isEmpty()) throw new Error('This map has no terrain geometry for a cutscene stage.');
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(); camera.position.copy(center).add(new THREE.Vector3(0,Math.max(192,size.y+128),Math.max(224,Math.min(size.x,size.z)*.4)));
  camera.lookAt(center); const euler = new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  return { position: camera.position.toArray() as SceneVector, rotationDegrees: [euler.x,euler.y,euler.z].map(n=>n*180/Math.PI) as SceneVector };
}
export function mountCutsceneMapPreview(host: HTMLElement, data: Map3dSceneData, getSource: ()=>CutsceneScene, loadActor?: (id:number)=>Map3dNpcSpriteFrames, onPlace?: (position:SceneVector)=>void, playback?: { sampleActor(id:string,frame:number,sprites:Map3dNpcSpriteFrames):{position:SceneVector;texture:DecodedTexture;visible?:boolean}; discreteCamera?:boolean }) {
  const renderer = new THREE.WebGLRenderer({antialias:false}); renderer.setPixelRatio(Math.min(2,window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x151b24);
  renderer.domElement.tabIndex=0; renderer.domElement.setAttribute('aria-label',`Cutscene map preview, zone ${data.zoneId}`);
  const overlay = document.createElement('div'); overlay.className='cutscene-fade'; host.replaceChildren(renderer.domElement,overlay);
  const scene = new THREE.Scene(), native = new THREE.PerspectiveCamera(40,4/3,32,65536), free = native.clone(); free.near=.25;
  const controls = new OrbitControls(free,renderer.domElement); controls.enabled=false;
  const geometries: THREE.BufferGeometry[]=[], materials: THREE.Material[]=[], textures=new Map<DecodedTexture,Map<number,THREE.DataTexture>>(), animation=new Map3dTexturePreview(),baseColors=new Map<THREE.MeshBasicMaterial,THREE.Color>();
  const movingGeometry:Array<{geometry:THREE.BufferGeometry;sample(frame:number):Float32Array}>=[];
  function texture(source?:DecodedTexture,material?:Map3dPrimitive['material']) {
    if (!source) return null;
    const key=Number(Boolean(material?.repeatS))|Number(Boolean(material?.repeatT))<<1|Number(Boolean(material?.flipS))<<2|Number(Boolean(material?.flipT))<<3;
    let variants=textures.get(source);if(!variants){variants=new Map();textures.set(source,variants);}
    let t=variants.get(key); if (!t) { t=new THREE.DataTexture(source.rgba,source.width,source.height); t.colorSpace=THREE.SRGBColorSpace; t.magFilter=t.minFilter=THREE.NearestFilter;t.wrapS=material?.repeatS?material.flipS?THREE.MirroredRepeatWrapping:THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;t.wrapT=material?.repeatT?material.flipT?THREE.MirroredRepeatWrapping:THREE.RepeatWrapping:THREE.ClampToEdgeWrapping; t.needsUpdate=true; variants.set(key,t); } return t;
  }
  function primitives(group:THREE.Group, parts:Map3dPrimitive[]) {
    for (const p of parts) {
      const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(p.positions,3)); g.setIndex(new THREE.BufferAttribute(p.indices,1));
      if(p.uvs) g.setAttribute('uv',new THREE.BufferAttribute(p.uvs,2)); if(p.colors) g.setAttribute('color',new THREE.BufferAttribute(p.colors,3));
      const m=p.material, tex=texture(m.texture,m);
      const material=new THREE.MeshBasicMaterial({map:tex,color:tex?0xffffff:new THREE.Color(...m.diffuse),vertexColors:Boolean(p.colors),side:THREE.DoubleSide,opacity:m.alpha,transparent:m.alpha<1||Boolean(tex),alphaTest:.01});
      baseColors.set(material,material.color.clone());
      const mesh=new THREE.Mesh(g,material);group.add(mesh);animation.add(mesh,p,source=>texture(source,m)!);geometries.push(g); materials.push(material);
      if(p.geometryAnimation){movingGeometry.push({geometry:g,sample:p.geometryAnimation.sample});mesh.frustumCulled=false;}
    }
  }
  for(const chunk of data.chunks) { const g=new THREE.Group(); g.position.set(chunk.worldX,chunk.worldY??0,chunk.worldZ); primitives(g,chunk.primitives); scene.add(g); }
  for(const b of data.buildings) { const g=new THREE.Group(); g.position.set(b.worldX,b.worldY,b.worldZ); g.rotation.y=b.rotationY*Math.PI/180; primitives(g,b.primitives); scene.add(g); }
  const terrain = scene.children.slice(), actors = new Map<string,THREE.Sprite>(), actorTextures = new Map<DecodedTexture,THREE.DataTexture>();
  function actorTexture(image:DecodedTexture) { let t=actorTextures.get(image);if(!t){t=new THREE.DataTexture(image.rgba,image.width,image.height);t.colorSpace=THREE.SRGBColorSpace;t.magFilter=t.minFilter=THREE.NearestFilter;t.flipY=true;t.needsUpdate=true;actorTextures.set(image,t);}return t; }
  function terrainPoint(x:number,y:number):SceneVector|undefined { const ray=new THREE.Raycaster();scene.updateMatrixWorld(true);const camera=isFree?free:native;camera.updateMatrixWorld(true);ray.setFromCamera(new THREE.Vector2(x,y),camera);return ray.intersectObjects(terrain,true)[0]?.point.toArray() as SceneVector|undefined; }
  let down:[number,number]=[0,0]; renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('click',e=>{if(Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;const rect=renderer.domElement.getBoundingClientRect(),cw=isFree?rect.width:Math.min(rect.width,rect.height*4/3),ch=isFree?rect.height:cw*3/4,x=(e.clientX-rect.left-(rect.width-cw)/2)/cw,y=(e.clientY-rect.top-(rect.height-ch)/2)/ch;if(x<0||x>1||y<0||y>1)return;const p=terrainPoint(x*2-1,1-y*2);if(p)onPlace?.(p);});
  let isFree=false, lastFrame=0,lastMaterialFrame=0, disposed=false;
  const pathGeometry = new THREE.BufferGeometry(), pathMaterial=new THREE.LineBasicMaterial({color:0xffd96c,depthTest:false});
  const path=new THREE.Line(pathGeometry,pathMaterial); path.renderOrder=20; scene.add(path);
  const markerGeometry=new THREE.SphereGeometry(5,8,6), markerMaterial=new THREE.MeshBasicMaterial({color:0x4de3d2,depthTest:false}), marker=new THREE.Mesh(markerGeometry,markerMaterial); marker.renderOrder=21; scene.add(marker);
  function updatePath() { const source=getSource(), keys=[...source.camera].sort((a,b)=>a.frame-b.frame); pathGeometry.setAttribute('position',new THREE.Float32BufferAttribute(keys.flatMap(k=>k.position),3)); pathGeometry.computeBoundingSphere(); }
  function draw(frame:number,materialFrame=frame) {
    if(disposed) return; lastFrame=frame;lastMaterialFrame=materialFrame;animation.seek(materialFrame); const source=getSource(), pose=sampleCutsceneCamera(source,playback?.discreteCamera?Math.floor(frame):frame);
    for(const item of movingGeometry){const position=item.geometry.getAttribute('position') as THREE.BufferAttribute;position.array.set(item.sample(frame));position.needsUpdate=true;}
    const tint=source.environment?('sourceSeason' in source.environment?fieldEnvironmentClock(source.environment as FieldEnvironment,frame):sampleSceneEnvironment(source.environment,frame)).tint:[1,1,1],tintColor=new THREE.Color(...tint as SceneVector).convertSRGBToLinear();for(const [material,base]of baseColors)material.color.copy(base).multiply(tintColor);
    native.position.fromArray(pose.position); native.rotation.set(...pose.rotationDegrees.map(n=>n*Math.PI/180) as SceneVector,'YXZ'); native.fov=pose.fov; native.updateProjectionMatrix();
    const live=new Set((source.actors??[]).map(a=>a.id));for(const [id,sprite] of actors)if(!live.has(id)){scene.remove(sprite);sprite.material.dispose();actors.delete(id);}
    for(const actor of source.actors??[]) { if(!loadActor)throw new Error('NPC sprite loader is unavailable.');const frames=loadActor(actor.overworldId),p=playback?.sampleActor(actor.id,frame,frames),position=p?.position??sampleSceneNpc(actor,frame).position;let sprite=actors.get(actor.id);if(!sprite){sprite=new THREE.Sprite(new THREE.SpriteMaterial({alphaTest:.05,transparent:true}));sprite.center.set(.5,0);actors.set(actor.id,sprite);scene.add(sprite);}sprite.visible=p?.visible??true;sprite.scale.set(frames.width,frames.height,1);sprite.position.fromArray(position);const map=actorTexture(p?.texture??sceneNpcTexture(actor,frame,frames));if(sprite.material.map!==map){sprite.material.map=map;sprite.material.needsUpdate=true;} }
    marker.position.copy(native.position); path.visible=marker.visible=isFree;
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight); renderer.setSize(w,h,false); renderer.setScissorTest(false); renderer.setViewport(0,0,w,h); renderer.clear();
    if(isFree) { free.aspect=w/h; free.updateProjectionMatrix(); renderer.render(scene,free); overlay.hidden=true; }
    else {
      const cw=Math.min(w,h*4/3),ch=cw*3/4,x=(w-cw)/2,y=(h-ch)/2;
      renderer.setViewport(x,y,cw,ch); renderer.setScissor(x,y,cw,ch); renderer.setScissorTest(true); renderer.render(scene,native);
      const effect=sceneFade(source,frame); overlay.hidden=false; Object.assign(overlay.style,{left:`${x}px`,top:`${y}px`,width:`${cw}px`,height:`${ch}px`,background:effect.color,opacity:String(effect.opacity)});
    }
  }
  const resize=new ResizeObserver(()=>draw(lastFrame,lastMaterialFrame)); resize.observe(host); controls.addEventListener('change',()=>draw(lastFrame,lastMaterialFrame)); updatePath(); draw(0);
  return { draw,updatePath,placementPoint:()=>terrainPoint(0,0),
    groundHeight(x:number,z:number) { scene.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(x,32767,z),new THREE.Vector3(0,-1,0));return ray.intersectObjects(terrain.slice(0,data.chunks.length),true)[0]?.point.y; },
    setSceneCamera(enabled:boolean) { if(!enabled&&!isFree) { const distance=400; controls.target.copy(native.position); free.position.copy(native.position).add(new THREE.Vector3(distance,distance,distance)); free.lookAt(controls.target); controls.update(); } isFree=!enabled; controls.enabled=isFree; draw(lastFrame,lastMaterialFrame); },
    capture() { const e=new THREE.Euler().setFromQuaternion(free.quaternion,'YXZ'); return {position:free.position.toArray() as SceneVector,rotation:[e.x,e.y,e.z].map(n=>n*180/Math.PI) as SceneVector}; },
    dispose() { disposed=true; resize.disconnect(); controls.dispose();animation.clear(); geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); textures.forEach(variants=>variants.forEach(t=>t.dispose()));actors.forEach(s=>s.material.dispose());actorTextures.forEach(t=>t.dispose()); pathGeometry.dispose(); pathMaterial.dispose(); markerGeometry.dispose(); markerMaterial.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
  };
}
