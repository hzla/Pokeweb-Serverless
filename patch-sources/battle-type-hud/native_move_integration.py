"""Actual reset-booted native input/key/bitmap path. Controlled type change only;
compares complete game RAM and instruments native allocations. No gameplay damage.
"""
import json,os,struct,sys
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_ARM,UC_HOOK_CODE,UC_HOOK_MEM_WRITE
from unicorn.arm_const import *
from pathlib import Path
from analyze import HERE,ROOT
sys.path.insert(0,str(ROOT/'work/scan-button/emulator-ref/python'));from melonds import MelonDS
sys.path.insert(0,str(ROOT/'work/tagbattle-crash'));from compare_states import State
from live import report
from rpm_read import read_rpm
from verify_moves import off
GAME=sys.argv[1];folder=HERE/'build'/f'live-{GAME}{os.environ.get("BTH_LIVE_SUFFIX","")}'
e=MelonDS(ROOT/'work/scan-button/emulator-build/src/headless/libmelonds_headless.dylib');e.open(folder/'typehud.nds');e.savestate.load_file(folder/'session.mln');m=e.memory
live=report(e,GAME,module="MoveEffectiveness");assert live['failure']==0,live
p=json.loads((HERE/f'profile-{GAME}.json').read_text());state=State(folder/'session.mln')
rpm=read_rpm((HERE/'build'/f'MoveEffectiveness{GAME}.debug.dll').read_bytes());base=int(live['module_code_base'],16)
ms=base+next(s['address'] for s in rpm['symbols'] if s['name']=='gBattleMoveHud');biw=m.read_long(ms);bmp=m.read_long(biw+0x2b0);pixels=m.read_long(bmp)
assert m.read_long(biw+0x58)==2,(hex(biw),m.read_long(biw+0x58))
target=int(next(r['battler'] for r in report(e,GAME)['records'] if r['pos']&1),16)
SP=0x02fe2000;STOP=0x02fd0000;KEYS=0x023f0000
f=p['functions'];allocations=[]
def cpu():
 c=Uc(UC_ARCH_ARM,UC_MODE_ARM);c.ctl_set_cpu_model(UC_CPU_ARM_946)
 for a,n in [(0,0x10000),(0x02000000,0x1000000),(0x04000000,0x20000),(0x05000000,0x1000),(0x06000000,0xa0000),(0x06800000,0xa0000)]:c.mem_map(a,n)
 c.mem_map(0x01ff8000,0x8000);c.mem_write(0x01ff8000,state.itcm);c.mem_write(0,state.itcm);c.mem_write(0x2000000,state.ram);c.mem_write(0x2fe0000,state.dtcm)
 for a,n in [(0x5000000,0x800),(0x6200000,0x20000),(0x6400000,0x10000)]:
  # OBJ isn't addressed by this test, but BG and palette data are real.
  if a==0x6200000:c.mem_map(a,0x20000)
  if a==0x6400000:c.mem_map(a,0x10000)
  c.mem_write(a,bytes(m.unsigned[a:a+n]))
 c.mem_write(0x4000000,struct.pack('<I',m.read_long(0x4000000)));c.mem_write(0x4001000,struct.pack('<I',m.read_long(0x4001000)))
 c.mem_write(target+0xf8,bytes([7,14])) # Ghost/Ice: Rock super-effective, Normal immune
 c.mem_write(KEYS,bytes([0,255,255,255,255,255,0,0,0,0,0,4])*16)
 # Preserve native cursor state, with no pending key/touch event.
 def dma(c,address,size,user):
  _,src,dst,n=[c.reg_read(r) for r in (UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3)]
  c.mem_write(dst,bytes(c.mem_read(src,n)));c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
 # ARM9 DMA entry independently matched by a unique 64-byte exact signature.
 address=0x20780ac if GAME=='W2' else 0x2078080
 c.hook_add(UC_HOOK_CODE,dma,begin=address,end=address)
 c.hook_add(UC_HOOK_CODE,lambda *x:allocations.append(x[1]),begin=0x203a228 if GAME=='W2' else 0x203a1fc,end=0x203a228 if GAME=='W2' else 0x203a1fc)
 return c

def call(c,entry,*args):
 c.reg_write(UC_ARM_REG_CPSR,0x1f);c.reg_write(UC_ARM_REG_SP,SP);c.reg_write(UC_ARM_REG_LR,STOP|1)
 for r,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):c.reg_write(r,v)
 for i,v in enumerate(args[4:]):c.mem_write(SP+i*4,struct.pack('<I',v))
 c.emu_start(entry|1,STOP,count=3000000);assert c.reg_read(UC_ARM_REG_PC)==STOP,hex(c.reg_read(UC_ARM_REG_PC));return c.reg_read(UC_ARM_REG_R0)
a=cpu();b=cpu();args=(biw,KEYS,KEYS,0,0xffffffff,0)
hook=next(h for h in p['hooks'] if h['name']=='MoveKey');rel=next(r for r in rpm['relocations'] if r['module']=='168' and r['address']==hook['address']);entry=base+rpm['symbols'][rel['symbol']]['address']
assert call(a,f['MoveKey'],*args)==call(b,entry,*args)
assert not allocations,allocations
call(a,f['FlushBitmap'],m.read_long(biw+0x2ac)) # same existing bitmap transfer bookkeeping
assert not allocations
# Only pixels in move-name rectangles may change.
old=bytes(a.mem_read(pixels,12288));new=bytes(b.mem_read(pixels,12288));counts={}
for y in range(96):
 for x in range(256):
  j=off(x,y);s=(x&1)*4;v=(new[j]>>s)&15;o=(old[j]>>s)&15
  if o!=v:
   assert 10<=y<26 or 58<=y<74,(x,y,o,v)
   assert o==1 and v in (11,12),(x,y,o,v)
   counts[v]=counts.get(v,0)+1
assert counts.get(11,0)>10 and counts.get(12,0)>10,counts
# Bitmap flush's native queue/allocator metadata must match exactly.
source=m.read_long(m.read_long(biw+0x64)+20);transfer=m.read_long(m.read_long(biw+0x64)+24)
allowed=[(pixels,pixels+12288),(ms,ms+20)]
for z in (source,transfer):allowed.extend((z+i*2,z+i*2+2) for i in (219,220))
ra=bytearray(a.mem_read(0x2000000,0x400000));rb=bytes(b.mem_read(0x2000000,0x400000))
for lo,hi in allowed:ra[lo-0x2000000:hi-0x2000000]=rb[lo-0x2000000:hi-0x2000000]
assert ra==rb,'Unexpected game RAM change outside existing text bitmap, text palette and module state'
# Show the real runtime result using the same controlled type inputs.
m.write_short(target+0xf8,0x0e07);e.run_frames(8);e.screenshot().save(folder/'move-colors.png')
result=dict(game=GAME,dll_sha256=live['dll_sha256'],changed_letter_pixels=counts,added_heap_allocations=0,
 comparison='Native input result and all 4 MiB game RAM identical except existing move-text pixels/palette and module state; native bitmap transfer bookkeeping matched.',
 hardware='DMA copy emulated in Unicorn; all called game functions are native.',
 limitation='Controlled Ghost/Ice target typing, not damage inflicted by a move.')
(folder/'native-move-integration.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));e.destroy()
