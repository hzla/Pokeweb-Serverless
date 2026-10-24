import { describe,expect,it } from 'vitest';
import { createMapCutscene,readCutsceneScene,sampleCutsceneCamera,sceneFade,simplifyCutsceneCamera,storeCutsceneScene,validateCutsceneScene } from '../pokeweb/cutsceneScene';
import { applyNativeTimeline,compileCutsceneTimeline,importNativeTimeline,lowerSceneEvents } from '../pokeweb/cutsceneNativeCompiler';
import { nativeCameraPose } from '../pokeweb/nativeCameraTrack';
import { encodeNativeSceneCues,nativeCutsceneName,type NativeCutsceneDocument,type NativeCutsceneLibrary } from '../pokeweb/nativeCutsceneModel';
import { makeEditProject } from './fixtures/editProject';
import { createProjectDocument } from '../pokeweb/projectDocument';
import { openProjectSession } from '../pokeweb/projectSession';

const scene=()=>createMapCutscene(370,'Route 13 camera',{position:[32,100,64],rotationDegrees:[-30,170,0]},'route13.introduction');
describe('JSON cutscene timelines',()=>{
  it('imports exported custom native sequences losslessly while retaining compiler ownership restrictions',()=>{
    const compiled=compileCutsceneTimeline(scene());
    for(const id of [28,63]) {
      const doc={camera:compiled.camera,definition:{id,fov:40,cues:compiled.cues,startFade:{white:false,duration:0},endFade:{white:false,duration:0}}} as NativeCutsceneDocument;
      const imported=importNativeTimeline(doc,`${nativeCutsceneName(id)} timeline`);
      expect(imported.stage).toEqual({kind:'native-template',sequenceId:id});expect(imported.name).toBe(`Custom map sequence ${id} timeline`);
      expect(compileCutsceneTimeline(imported).camera.bytes).toEqual(compiled.camera.bytes);
      expect(()=>applyNativeTimeline(makeEditProject(),{} as NativeCutsceneLibrary,imported,'')).toThrow('private native-template sequence 27');
    }
    for(const id of [0,64,1.5])expect(()=>readCutsceneScene({...scene(),stage:{kind:'native-template',sequenceId:id}})).toThrow('$.stage.sequenceId');
  });
  it('samples shuffled keyframes, outgoing easing, holds and shortest Euler turns deterministically',()=>{
    const s=scene();s.camera[0].easing='linear';s.camera[1].position=[132,120,264];s.camera[1].rotationDegrees=[-50,-170,0];s.camera[1].frame=100;
    s.camera.reverse();const checked=readCutsceneScene(s),mid=sampleCutsceneCamera(checked,50);
    expect(mid.position).toEqual([82,110,164]);expect(mid.rotationDegrees).toEqual([-40,180,0]);expect(sampleCutsceneCamera(checked,299).position).toEqual([132,120,264]);
    s.camera[1].easing='hold';expect(sampleCutsceneCamera(readCutsceneScene(s),99).position).toEqual([32,100,64]);
    s.camera[1].easing='smoothstep';expect(sampleCutsceneCamera(readCutsceneScene(s),25).position[0]).toBeCloseTo(47.625);
  });
  it('rejects duplicate IDs/frames, unknown behavior, truncation and non-finite poses without altering the input',()=>{
    const s=scene();s.camera[1].frame=0;s.camera[1].id=s.camera[0].id;
    const issues=validateCutsceneScene(s);expect(issues.map(i=>i.code)).toContain('CAMERA_CONFLICT');expect(issues.map(i=>i.code)).toContain('DUPLICATE_ID');
    const bad={...scene(),actors:[{action:'wave'}]};expect(()=>readCutsceneScene(bad)).toThrow('Unknown property');
    const short=scene();short.frameCount=10;expect(()=>readCutsceneScene(short)).toThrow('outside the timeline');
    const finite=scene();finite.camera[0].position[0]=NaN;expect(()=>readCutsceneScene(finite)).toThrow('finite');expect(Number.isNaN(finite.camera[0].position[0])).toBe(true);
  });
  it('uses document order for simultaneous fades and produces the same result when seeking backwards',()=>{
    const s=scene();s.events=[{id:'fade1',type:'screen.fade',frame:20,durationFrames:20,screens:'both',from:'clear',to:'black'},{id:'fade2',type:'screen.fade',frame:20,durationFrames:10,screens:'top',from:'clear',to:'white'}];
    expect(sceneFade(s,25)).toEqual({color:'white',opacity:.5});expect(sceneFade(s,25,'bottom')).toEqual({color:'black',opacity:.25});sceneFade(s,299);expect(sceneFade(s,10).opacity).toBe(0);
  });
  it('retains independent sources and revisions through project documents and blocks stale writes',()=>{
    const p=makeEditProject(),s=scene(),record=storeCutsceneScene(p,s,0);record.nativeFingerprint='abc';s.camera[0].position[0]=999;
    expect(record.source.camera[0].position[0]).toBe(32);expect(()=>storeCutsceneScene(p,record.source,0)).toThrow('changed elsewhere');
    const doc=structuredClone(createProjectDocument(p,true)),reopened=openProjectSession(doc);
    expect(reopened.cutsceneAuthoring).toEqual(p.cutsceneAuthoring);expect(reopened.cutsceneAuthoring?.selectedId).toBe(s.id);expect(reopened.cutsceneAuthoring?.scenes[s.id].nativeFingerprint).toBe('abc');
    const bad=scene();bad.camera=[];expect(()=>storeCutsceneScene(p,bad,1)).toThrow();expect(p.cutsceneAuthoring?.scenes[s.id].revision).toBe(1);
  });
  it('compiles dense native camera samples and arbitrary typed events with a valid END record',()=>{
    const s=scene();s.camera[0].easing='linear';s.camera[1].position[0]=331;
    s.events.push({id:'music',type:'music.play',frame:10,assetId:1102},{id:'sound',type:'sound.play',frame:40,assetId:1200,volume:90},{id:'stop',type:'music.stop',frame:100,fadeFrames:30});
    const result=compileCutsceneTimeline(s);expect(nativeCameraPose(result.camera,60).position[0]).toBe(92);expect(result.cues.map(c=>c.opcode)).toEqual([10,6,1,8,7]);
    expect(result.cues.find(c=>c.opcode===7)?.frame).toBe(130);
    const v=new DataView(result.commands.buffer);expect(v.getInt32(result.commands.length-40,true)).toBe(19);expect(result.camera.frameCount).toBe(300);
  });
  it('preserves preload and same-frame native cue order; rejects raw native behavior on map stages',()=>{
    const s=scene();s.stage={kind:'native-template',sequenceId:27};s.events=[{id:'preload',type:'native.cue',frame:-1,opcode:6,args:[9,0,0,0,0,0,0,0]},{id:'b',type:'music.play',frame:0,assetId:4},{id:'a',type:'music.play',frame:0,assetId:5}];
    expect(lowerSceneEvents(readCutsceneScene(s)).map(c=>c.args[0])).toEqual([9,4,5]);s.stage={kind:'map',zoneId:370,season:'spring'};expect(()=>readCutsceneScene(s)).toThrow('native template');
  });
  it('does not emit opcode zero, whose native dispatch slot is null',()=>{
    const s=scene();s.stage={kind:'native-template',sequenceId:27};s.events=[{id:'disabled',type:'native.cue',frame:0,opcode:0,args:Array(8).fill(0)}];
    expect(compileCutsceneTimeline(s).cues).toEqual([]);expect(new DataView(compileCutsceneTimeline(s).commands.buffer).getInt32(0,true)).toBe(19);
    expect(()=>encodeNativeSceneCues([{opcode:0,frame:0,args:Array(8).fill(0)}],new Uint8Array(80))).toThrow('no callback');
  });
  it('retains native commands after camera completion without extending the camera or moving them into playback',()=>{
    const s=scene();s.stage={kind:'native-template',sequenceId:27};s.events=[{id:'late',type:'native.cue',frame:1200,opcode:6,args:[1102,0,0,0,0,0,0,0]}];
    const compiled=compileCutsceneTimeline(s);expect(compiled.camera.frameCount).toBe(300);expect(compiled.cues[0].frame).toBe(1200);
    s.events=[{id:'late-typed',type:'music.play',frame:1200,assetId:1102}];expect(()=>readCutsceneScene(s)).toThrow('outside the timeline');
  });
  it('reduces a curved dense camera within its sampled error bound without changing the source',()=>{
    const s=scene();s.camera=Array.from({length:300},(_,frame)=>({id:`dense-${frame}`,frame,position:[Math.sin(frame/60)*10,100,64],rotationDegrees:[-30,170+frame*.1,0],easing:'linear',fov:40}));
    const original=JSON.stringify(s),keys=simplifyCutsceneCamera(s,.01),reduced=readCutsceneScene({...s,camera:keys});expect(keys.length).toBeLessThan(100);
    for(let f=0;f<300;f++)expect(Math.abs(sampleCutsceneCamera(s,f).position[0]-sampleCutsceneCamera(reduced,f).position[0])).toBeLessThanOrEqual(.010001);
    expect(JSON.stringify(s)).toBe(original);expect(keys[0].id).toBe('dense-0');
  });
  it('samples FOV in map previews but blocks uncalibrated native projection conversion',()=>{
    const s=scene();s.camera[1].fov=60;expect(sampleCutsceneCamera(s,149.5).fov).toBeCloseTo(50);
    expect(()=>compileCutsceneTimeline(s)).toThrow('Animated field of view');
  });
});
