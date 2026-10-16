"""Check recorded emulator PCM against distinct left/right test tones and traces."""
import json,sys,wave
from pathlib import Path
import numpy as np

def verify(directory):
 p=Path(directory);run=json.loads((p/'trace.json').read_text());trace=run['trace'];actual={e['frame']:e for e in trace}
 # Normalize the extra 200-frame native-theme interval for later checks.
 byframe={f:(actual.get(f+200,e) if run.get('controls') and f>=4800 else e) for f,e in actual.items()}
 assert not run['fatal'],run['fatal']
 assert all(not e['d'][4] and (len(e['d'])<14 or not e['d'][13])for e in trace if e['d']), 'player error or underrun'
 with wave.open(str(p/'capture.wav'))as w:
  rate=w.getframerate();audio=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').reshape(-1,2).astype(float)
 def segment(start,end):
  return audio[byframe[start]['audioSamples']:byframe[end]['audioSamples']]
 def tone(signal,hz):
  t=np.arange(len(signal))/rate
  return abs(np.sum(signal*np.exp(-2j*np.pi*hz*t)))/len(signal)*2
 def rms(x):return float(np.sqrt(np.mean(x*x)))
 result={'game':run['game'],'frames':trace[-1]['frame'],'faults':0}
 if run.get('controls'):
  paused=[byframe[f]['d']for f in range(4120,4200,10)]
  assert all(d[9] and not d[3]for d in paused)
  assert len({d[8]for d in paused})==1,'pause advanced the consumed cursor'
  assert byframe[4240]['d'][3] and byframe[4240]['d'][8]!=paused[0][8]
  assert byframe[4040]['d'][1]==0 and byframe[4040]['d'][3], 'BGM stream ID 0 did not play'
  volumes=[np.int32(np.uint32(byframe[f]['d'][12])).item()for f in range(4510,4600,10)]
  assert len(set(volumes))>=5 and volumes[-1]<volumes[0],volumes
  assert rms(segment(4560,4590))<rms(segment(4410,4440))*.3,'fade did not reach silence'
  assert rms(segment(4320,4380))<rms(segment(4420,4480))*.4,'volume change was not audible'
  assert byframe[4740]['d'][1]==65535 and not byframe[4740]['d'][3]
  assert byframe[4740]['d'][10] and not byframe[4780]['d'][10], 'native mute shortcut did not toggle'
  assert rms(segment(4730,4750))<1, 'native theme was not muted'
  native_resume=audio[actual[4780]['audioSamples']:actual[4990]['audioSamples']]
  assert rms(native_resume)>20,'unmapped native BGM is silent after unmute'
  assert byframe[4940]['d'][7]>byframe[4840]['d'][7],'same ID restart was missed'
  assert byframe[5140]['d'][3] and byframe[5140]['d'][1]==run['standalone']
  assert byframe[5240]['d'][15] and not byframe[5240]['d'][3],'non-looping PCM tail did not finish'
  assert byframe[5340]['d'][9] and byframe[5440]['d'][3],'standalone pause/resume failed'
  x=segment(7000,7100);ll=tone(x[:,0],440);lr=tone(x[:,1],440);rl=tone(x[:,0],660);rr=tone(x[:,1],660)
  assert ll>500 and rr>500 and ll>lr*100 and rr>rl*100,('stereo',ll,lr,rl,rr)
  late=segment(9600,9700);assert tone(late[:,0],880)>500,'late portion beyond 60 seconds did not play'
  assert byframe[10000]['d'][8]>32728*70 and byframe[10300]['d'][8]<32728*10,'75-second loop not reached'
  result.update({'checks':['stream 0','native pause/resume','native fades','volume','unmapped native BGM mute/unmute','same-ID restart','standalone PCM16','standalone pause/resume','stereo separation >40dB','audio beyond 60 seconds','75-second loop'], 'fadeDb10':volumes,'stereoToneAmplitudes':[ll,lr,rl,rr]})
 else:
  assert any(e['d'] and e['d'][2]==1029 and e['d'][3]for e in trace),'overworld playback missing'
  if any(e['d'] and e['d'][2]==1130 for e in trace):
   assert byframe[5800]['d'][10] and not byframe[6000]['d'][10],'mute shortcut did not toggle'
   assert tone(segment(5700,5800)[:,0],440)<tone(segment(6000,6100)[:,0],440)*.1,'mute retained the test tone'
   assert trace[-1]['d'][2]==1029 and trace[-1]['d'][3], 'overworld music was not restored after battle'
   assert rms(segment(5700,5800))>20, 'expected native sound effects missing while music was muted'
   result['checks']=['overworld','battle','battle exit restoration','mute/unmute','sound effects retained']
 print(json.dumps(result))
 (p/'audio-verification.json').write_text(json.dumps(result,indent=2)+'\n')
for directory in sys.argv[1:]:verify(directory)
