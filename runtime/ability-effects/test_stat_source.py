"""Shipped ARM stat-source dispatch with native-service doubles, not gameplay.

The small ARM caller enters the real callback scopes recursively, so move/item
origins, nested abilities and repeated changes exercise the runtime call stack.
"""
import json, struct, subprocess
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP, UC_ARM_REG_LR
ROOT=Path(__file__).resolve().parents[2]
BUILD=ROOT/'runtime/ability-effects/build';BUILD.mkdir(exist_ok=True)
TOOLS=ROOT.parent/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'
DRIVER=BUILD/'stat-source-driver.c';ELF=BUILD/'stat-source-driver.elf'
DRIVER.write_text('''
typedef unsigned u32;typedef unsigned char u8;
typedef void(*Callback)(void*,void*,u8,u32*);
typedef void(*Scope)(void*,void*,u8,u32*,Callback);
u32 TestApi[2],TestOwner=12,TestRepeat=1,TestEvent,TestNoSource;
u8 TestSource[64],TestHolder[64];
static void source(void*i,void*f,u8 owner,u32*w){
 (void)i;(void)owner;
 for(u32 n=0;n<TestRepeat;++n){++TestEvent;((Scope)TestApi[0])(TestHolder,f,0,w,(Callback)TestApi[1]);}
}
void TestInvoke(void){
 if(TestNoSource){++TestEvent;((Scope)TestApi[0])(TestHolder,(void*)0x330000,0,(u32*)0x340000,(Callback)TestApi[1]);}
 else ((Scope)TestApi[0])(TestSource,(void*)0x330000,(u8)TestOwner,(u32*)0x340000,source);
}
''')
subprocess.run([str(TOOLS/'arm-none-eabi-gcc'),'-mthumb','-mcpu=arm946e-s','-Os','-ffreestanding','-nostdlib','-Wl,-Ttext=0x180000,-Tbss=0x190000,-eTestInvoke',str(DRIVER),'-o',str(ELF)],check=True)
BUNDLE=json.loads((ROOT/'src/assets/data/abilityRuleRuntimeStatSource.json').read_text())['abilityRuleRuntimeRecipesGrouped.json']
BASE,API,DATA,MON,FLOW,WORK,STACK,STOP=0x100000,0x200000,0x300000,0x320000,0x330000,0x340000,0x410000,0x20f000
u32=lambda x:struct.pack('<I',x&0xffffffff)
def exercise(factor=4,source=12,target=0,delta=-1,stat=1,selected=8,suppressed=False,preview=False,repeat=1,activations=1,no_source=False,bypass=False,skip=False):
 vm=Uc(UC_ARCH_ARM,UC_MODE_THUMB)
 for start,size in [(BASE,0x40000),(0x180000,0x20000),(API,0x10000),(DATA,0x50000),(0x400000,0x20000)]:vm.mem_map(start,size)
 vm.mem_write(BASE,bytes(BUNDLE['code']));symbols={s['name']:s['address'] for s in BUNDLE['symbols'] if s.get('name')}
 for r in BUNDLE['relocations']:
  t=r['target'];s=BUNDLE['symbols'][r['sourceSymbolIndex']];at=BASE+t['address'];dest=BASE+s['address'];assert t['module']=='base'
  if t['type']=='OFFSET':vm.mem_write(at,u32(dest|int(s['type']=='FUNCTION_THM')))
  else:
   assert t['type']=='THUMB_BRANCH_LINK';d=dest-at-4;vm.mem_write(at,struct.pack('<HH',0xf000|((d>>12)&0x7ff),0xf800|((d>>1)&0x7ff)))
 with ELF.open('rb')as f:
  elf=ELFFile(f)
  for segment in elf.iter_segments():
   if segment['p_type']=='PT_LOAD':vm.mem_write(segment['p_vaddr'],segment.data()+bytes(segment['p_memsz']-segment['p_filesz']))
  driver={s.name:s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols()}
 def put(at,value):vm.mem_write(at,u32(value))
 def read(at):return struct.unpack('<I',vm.mem_read(at,4))[0]
 put(driver['TestApi'],BASE+symbols['AbilityCallbackScope']+1);put(driver['TestApi']+4,BASE+symbols['AbilityEvent_5b']+1)
 for name,value in [('TestOwner',source),('TestRepeat',repeat),('TestNoSource',int(no_source))]:put(driver[name],value)
 put(driver['TestSource']+0x10,factor);put(driver['TestHolder']+0x10,4);put(driver['TestHolder']+0x14,2<<24)
 vm.mem_write(driver['TestHolder']+0x38,struct.pack('<H',165))
 effect=bytes([165,selected,1,0,0,0,0,int(bypass),*([0]*8)])
 record=bytes([1,1,0,0,128,0,0,0])+effect;data=bytearray(512)+record;struct.pack_into('<H',data,330,512)
 vm.mem_write(DATA,bytes(data));put(BASE+symbols['AbilityRuleData'],DATA)
 state={'lastEvent':-1,'blocked':False,'blocks':0,'popups':[],'messages':0,'weather':0}
 values={2:target,3:source,0x1f:stat,0x20:delta&0xffffffff}
 def service(cpu,address,size,_):
  n=(address-API)//16;a,b,c=[cpu.reg_read(r) for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]];result=0
  if n==0:result=values.get(a,0)
  elif n==2:result=MON+b*0x200
  elif n==3:result=100
  elif n==6:state['weather']+=1
  elif n==7:result=int(preview)
  elif n==8:pass
  elif n==9:vm.mem_write(WORK,bytes(64));result=WORK
  elif n==10:state['messages']+=1
  elif n in (11,12):pass
  elif n==13:result=165
  elif n==20:state['popups'].append((b,c))
  elif n==28:
   event=read(driver['TestEvent'])
   if event!=state['lastEvent']:state['blocked']=False;state['lastEvent']=event
   result=int(not state['blocked']);state['blocked']=True;state['blocks']+=result
  elif n==30:result=int(suppressed and b==16)
  elif n==32:result=int(skip)
  else:raise AssertionError(f'Unexpected native service {n}')
  cpu.reg_write(UC_ARM_REG_R0,result)
 for n in range(43):put(BASE+symbols['AbilityRuleApi']+n*4,API+n*16+1);vm.mem_write(API+n*16,bytes.fromhex('7047'))
 vm.hook_add(UC_HOOK_CODE,service,begin=API,end=API+43*16-1)
 for _ in range(activations):
  vm.reg_write(UC_ARM_REG_SP,STACK);vm.reg_write(UC_ARM_REG_LR,STOP|1);vm.emu_start(driver['TestInvoke']|1,STOP,count=100000)
 assert state['weather']==0,state
 expected=factor==4 and source!=0 and target==0 and delta<0 and selected in (8,stat) and not suppressed and not no_source and not(bypass and skip)
 assert state['blocks']==(repeat*activations if expected else 0),state
 shows=activations if expected and not preview else 0
 assert state['popups']==[(command,0) for _ in range(shows) for command in (2,3)],state
 assert state['messages']==shows,state
 return state
cases=[{}, {'repeat':3}, {'repeat':2,'activations':2}, {'preview':True}, {'suppressed':True}, {'source':0}, {'no_source':True}, {'target':1}, {'delta':0}, {'delta':1}, {'delta':-6}, {'selected':3}, {'selected':3,'stat':3}, {'bypass':True}, {'bypass':True,'skip':True}]
cases += [{'factor':factor} for factor in (0,1,2,3,5,6,7)]
for case in cases:exercise(**case)
print(f'{len(cases)} shipped ARM stat-source cases passed: provenance, stat filters, suppression, bypass, preview and grouped activations; zero weather queries.')
