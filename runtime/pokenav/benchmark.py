"""Native melonDS latency benchmark; source ROM/save are copied before boot.

Requires the 56-distinct-slot Route 19 test fixture and its NAV button layout.
Frame counts measure emulated response, not host wall-clock throughput.
"""
from pathlib import Path
import sys,json,struct
import argparse,tempfile,shutil
parser=argparse.ArgumentParser(description='Measure Pokenav input/preview latency using copied full-grid Route 19 fixtures.')
parser.add_argument('rom',type=Path);parser.add_argument('--save',type=Path,required=True)
parser.add_argument('--library',required=True);parser.add_argument('--bindings',required=True)
parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
assert not args.out.exists(),'Refusing to overwrite benchmark output'
sys.path.insert(0,args.bindings)
from melonds.core import MelonDS
with args.rom.open('rb') as f:f.seek(12);code=f.read(4)
assert code in (b'IRDO',b'IREO'),'US Black 2 or White 2 required'
game='White2' if code==b'IRDO' else 'Black2';name=game;delta=0 if code==b'IRDO' else 0x2c
private=tempfile.TemporaryDirectory(prefix='pokenav-benchmark-');q=Path(private.name)
shutil.copyfile(args.rom,q/(game+'.nds'));shutil.copyfile(args.save,q/(game+'.sav'))
emu=MelonDS(args.library);emu.open(q/(game+'.nds'));reads=[0]
hook=emu.memory.register_exec(0x2070e6c-delta,lambda *_:reads.__setitem__(0,reads[0]+1))
def run(n=1):
 emu.run_frames(n);assert emu.memory.register_arm9.cpsr&31!=0x17,'Data abort'
def pixel(x,y):return emu.memory.read_byte(0x6200000+((y>>3)*32+(x>>3))*64+(y&7)*8+(x&7))
def tap(x,y):emu.input.touch_set_pos(x,y);run(4);emu.input.touch_release();run(100)
run(960);tap(60,116);assert emu.memory.read_short(0x400100c)==0x1f82
results=[]
def title():
 return bytes(emu.memory.read_byte(0x6000000+((y>>3)*32+(x>>3))*64+(y&7)*8+(x&7)) for y in range(7,22) for x in range(11,133))
def select(label,x,y,px,py):
 assert pixel(px,py)!=31,('already selected',label)
 start=emu.frame_count;before=reads[0];old_title=title();cursor=preview=None;emu.input.touch_set_pos(x,y)
 while cursor is None or preview is None:
  run();elapsed=emu.frame_count-start
  if cursor is None and pixel(px,py)==31:cursor=elapsed;emu.input.touch_release()
  if preview is None and title()!=old_title:preview=elapsed
  assert elapsed<180,(label,'timed out',cursor,preview)
 emu.input.touch_release();run(4)
 result={'operation':label,'frames':cursor,'previewFrames':preview,'filesystemReads':reads[0]-before}
 results.append(result);print(name,result,flush=True)
for row in (0,1):
 for col in range(6):
  if row==0 and col==0:continue
  x,y=12+col*40,104+row*35
  select(f'grass-{row*6+col+1}',x+16,y+16,x-1,y-1)
for label,x,y,px,py in [('doubles',95,90,59,96),('special',190,90,155,96),('grass',25,90,6,96),('surf',25,28,6,35),('surf-special',80,28,50,35),('rod',148,28,133,35),('rod-special',210,28,172,35),('surf-return',25,28,6,35),('rod-special-return',210,28,172,35)]:select(label,x,y,px,py)
emu.screenshot().save(q/(name+'-benchmark.png'))
emu.input.keypad_update(2);run(4);emu.input.keypad_update(0);run(150)
assert emu.memory.read_short(0x400100c)!=0x1f82
hook.remove();emu.destroy();args.out.parent.mkdir(parents=True,exist_ok=True)
with args.out.open('x') as f:json.dump({'game':game,'unit':'emulated frames','operations':results},f,indent=2);f.write('\n')
private.cleanup()
print(name,'PASSED',flush=True)
