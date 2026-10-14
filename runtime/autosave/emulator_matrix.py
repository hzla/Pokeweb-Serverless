"""Run both exact MVP binaries through isolated native emulator scenarios."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];BUILD=HERE/'build'
def check(game):
 rom=REPO.parent/('cleanblack2.nds'if game=='B2'else'cleanwhite2.nds')
 for case in('door','seamless','menus','same-header','reload'):
  command=[str(REPO/'node_modules/.bin/vite-node'),str(HERE/'emulator.ts'),str(rom),str(HERE/'inputs'/f'{case}.json')]
  if case=='reload':command+=['--save',str(BUILD/f'emulator-{game}-door/saved.sav')]
  with (BUILD/f'{game}-{case}.log').open('w')as log:subprocess.run(command,cwd=REPO,stdout=log,stderr=subprocess.STDOUT,check=True)
  print(game,case,'passed',flush=True)
with ThreadPoolExecutor(max_workers=2)as pool:list(pool.map(check,['B2','W2']))
