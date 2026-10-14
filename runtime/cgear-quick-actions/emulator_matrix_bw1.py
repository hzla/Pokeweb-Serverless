"""Run isolated BW1 DS checks with at most two emulator processes."""
import argparse,concurrent.futures,hashlib,json,subprocess
from pathlib import Path
from configure_bw1 import HERE,rom_path
REPO=HERE.parents[1]
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--games',default='B,W');parser.add_argument('--actions',default='repel,pc,bike,bag,party,mapFly,map,dowsing,rod,recorder,palPad,pokeradar');parser.add_argument('--reuse',action='store_true');args=parser.parse_args()
 def run(case):
  game,action=case;name=f'bw1-matrix-{game}-{action}';log=HERE/'build'/f'{name}.log'
  command=[str(REPO/'node_modules/.bin/vite-node'),str(HERE/'emulator_bw1.ts'),str(rom_path(game)),'--action',action,'--scenario','action','--frames','6400','--name',name]
  if action=='pokeradar':command+=['--zone','317','--z','728']
  existing=HERE/'build'/name/'test.nds';reuse=False
  if args.reuse and existing.exists()and(HERE/'build'/name/'trace.json').exists():
   import ndspy.rom
   r=ndspy.rom.NintendoDSRom.fromFile(str(existing));dll=r.files[r.filenames.idOf(f'patches/CGearQuickActions{game}.dll')]
   profile=json.loads((REPO/'src/assets/codeinjection/cgearQuickActionsBw1Manifest.json').read_text())['games'][game]
   reuse=hashlib.sha256(dll).hexdigest()==profile['sha256']
  if not reuse:
   with log.open('w')as stream:result=subprocess.run(command,cwd=REPO,stdout=stream,stderr=subprocess.STDOUT)
   if result.returncode:raise RuntimeError(f'{name} failed; inspect {log}')
  data=json.loads((HERE/'build'/name/'trace.json').read_text());assert not data['fatal']
  assert any(t['frame']>=3900 and t['visible']for t in data['trace'])
  print(name,'completed',flush=True);return {'game':game,'action':action,'log':log.name,'last':data['trace'][-1]}
 cases=[(g,a)for g in args.games.split(',')for a in args.actions.split(',')]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:rows=list(pool.map(run,cases))
 (HERE/'build/bw1-ds-matrix.json').write_text(json.dumps(rows,indent=2)+'\n')
if __name__=='__main__':main()
