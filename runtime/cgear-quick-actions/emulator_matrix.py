"""Native launch/cancel smoke matrix using isolated fixture copies."""
import concurrent.futures,json,os,subprocess,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];WORKSPACE=ROOT.parent
jobs=[];special='--special' in sys.argv;skins='--skins' in sys.argv
for game in ['white','black']:
 for power in [False,True]:
  for action in (['skins'] if skins else ['pc','bike','map-only','travel'] if special else ['map','dowsing','rod','recorder','palPad','xtransceiver','medals','gracidea','splicers','revealGlass','bag','party']):
   jobs.append((game,power,action))
def run(job):
 game,power,action=job;name=f'{game}-{action}-{"on" if power else "off"}'
 args=['npx','vite-node','runtime/cgear-quick-actions/emulator.ts',str(WORKSPACE/f'clean{game}2.nds'),'--bicycle','--eight']
 frames=2400
 if skins:
  args.remove('--eight');args+=['--scenario','skins'];frames=5300
 elif special:
  args+=['--scenario','map' if action=='map-only' else action]
  if action=='map-only':args+=['--no-fly'];frames=1800
  elif action=='pc':args+=['--repeat'];frames=6300
  elif action=='bike':frames=1650
  else:frames=2600
 else:args+=['--scenario','action','--action',action]
 if action in ['bag','party']:args.append('--companions')
 if power:args.append('--power-on')
 env={**os.environ,'QUICK_ACTIONS_FRAMES':str(frames)}
 with (HERE/'build'/f'matrix-{name}.log').open('w')as log:result=subprocess.run(args,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
 print(name,'passed'if result.returncode==0 else 'FAILED',flush=True)
 return {'game':game,'power':power,'action':action,'passed':result.returncode==0}
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:results=list(pool.map(run,jobs))
(HERE/'build'/('emulator-skin-matrix.json' if skins else 'emulator-special-matrix.json' if special else 'emulator-matrix.json')).write_text(json.dumps(results,indent=2)+'\n')
raise SystemExit(0 if all(r['passed']for r in results)else 1)
