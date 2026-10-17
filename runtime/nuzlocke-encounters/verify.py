"""Run real compiled filters/native selection code separately from gameplay."""
from pathlib import Path
import os,sys,struct,json,subprocess,collections
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];BUILD=HERE/'build'
sys.path.insert(0,str(HERE.parent/'learnset-viewer'))
from verify_info import Harness,TOOLS
from elftools.elf.elffile import ELFFile
import ndspy.narc
subprocess.run(['clang++','-std=c++17','-Wall','-Wextra','-Werror',HERE/'test_logic.cpp','-o',BUILD/'test-logic'],check=True)
subprocess.run([BUILD/'test-logic'],check=True)

for game in ('W2','B2'):
 h=Harness(game);h.instruction_limit=60000000;delta=64 if game=='B2' else 0
 overlay=h.rom.loadArm9Overlays([36])[36];h.c.mem_write(overlay.ramAddress,bytes(overlay.data))
 linked=BUILD/f'verify-{game}.elf'
 subprocess.run([TOOLS/'arm-none-eabi-ld','-Ttext','0x02340000','-Tdata','0x02380000','-e','NuzlockeGenerate',BUILD/f'NuzlockeStyleEncounters{game}.elf','-o',linked],check=True,capture_output=True)
 with linked.open('rb') as stream:
  elf=ELFFile(stream);h.symbols={s.name:s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols() if s.name and s['st_shndx']!='SHN_UNDEF'}
  for s in elf.iter_sections():
   if s['sh_flags']&2 and s['sh_type']!='SHT_NOBITS':h.c.mem_write(s['sh_addr'],s.data())
 def bl(at,to):
  diff=(to&~1)-(at+4);assert -0x400000<=diff<0x400000
  return struct.pack('<HH',0xf000|((diff>>12)&2047),0xf800|((diff>>1)&2047))
 for name,address in h.symbols.items():
  if name.startswith('THUMB_BRANCH_LINK_36_0x'):h.c.mem_write(int(name.rsplit('_',1)[1],16),bl(int(name.rsplit('_',1)[1],16),address))
  if name.startswith('FULL_COPY_36_0x'):h.c.mem_write(int(name.rsplit('_',1)[1],16),bytes(h.c.mem_read(address,4)))
 config_key='rom:/nuzlocke/encounters.narc';module_key=f'rom:/patches/NuzlockeStyleEncounters{game}.dll'
 h.files.update({'rom:/'+k:v for k,v in h.files.copy().items()});h.files[module_key]=(REPO/f'src/assets/codeinjection/NuzlockeStyleEncounters{game}.dll').read_bytes()
 def config(enabled=True,prevent=False,endianness='<'):
  header=struct.pack('<IHHIII',0x455a554e,1,20,int(enabled),int(prevent),int(enabled)^int(prevent)^0xffffffff)
  arc=ndspy.narc.NARC();arc.endiannessOfBeginning=endianness;arc.files=[header,b'{"version":"0.1.0"}'];h.files[config_key]=bytes(arc.save())
 config();game_data,save,dex,parameters,table,out,mask=0x2305000,0x2306000,0x2307000,0x2308000,0x2309000,0x230a000,0x230b000
 h.stubs[0x2017934]=lambda:h.ret(save);h.stubs[0x200d184]=lambda:h.ret(dex)
 h.c.mem_write(dex,bytes(0x4dc));h.c.mem_write(game_data,bytes(4));h.c.mem_write(parameters,bytes(44));h.w32(parameters,game_data)
 roll=[0];rng=[]
 def random_event():rng.append(h.r(0));h.ret(roll[0]%h.r(0) if h.r(0) else 0)
 h.stubs[0x2005784]=random_event;h.stubs[0x2005748]=random_event
 old_personal=h.personal_param
 def personal():
  if h.r(2) in (6,7):
   arc=ndspy.narc.NARC(h.files['a/0/1/6']);h.ret(arc.files[h.personal_id(h.r(0),h.r(1))][h.r(2)])
  else:old_personal()
 h.stubs[0x201ef48-(44 if game=='B2' else 0)]=personal
 def caught(*ids):
  data=bytearray(84)
  for i in ids:data[(i-1)//8]|=1<<((i-1)&7)
  h.c.mem_write(dex+8,bytes(data))
 def snapshot():
  assert h.call('_ZN8nuzlocke8snapshotEPvPh',game_data,mask),(h.reads,h.opened,[(n,bytes(h.c.mem_read(a+8192,8)).hex()) for n,a in h.symbols.items() if n.endswith('5cacheE')])
  return bytes(h.c.mem_read(mask,256))
 def has(bits,i):return bool(bits[i//8]&(1<<(i&7)))
 caught(1);bits=snapshot();assert all(has(bits,i) for i in (1,2,3)) and not has(bits,4)
 assert not h.opened and not h.allocations
 caught(134);bits=snapshot();assert all(has(bits,i) for i in (133,134,135,136,196,197,470,471))
 caught(479);bits=snapshot();assert has(bits,479) and not has(bits,1)
 personal_arc=ndspy.narc.NARC(h.files['a/0/1/6']);first=struct.unpack_from('<H',personal_arc.files[479],28)[0]
 assert first and all(has(bits,i) for i in range(first,first+5))
 cache=next(a for n,a in h.symbols.items() if n.startswith('_ZN8nuzlocke12_GLOBAL__N_15cacheE'))
 def reset():h.c.mem_write(cache,bytes(8200))
 config(endianness='>');reset();assert has(snapshot(),479)
 config();reset()
 def select(ids,count=12,kind=0,flags=0):
  h.c.mem_write(parameters+0x14,bytes([count,1]));h.w32(parameters+0x10,kind);h.w32(parameters+0x28,flags)
  h.c.mem_write(table,b''.join(struct.pack('<HBB',i,5,5) for i in ids))
 def generate():
  before=bytes(h.c.mem_read(dex,0x4dc));assert h.call('NuzlockeGenerate',parameters,table,out)==1
  assert bytes(h.c.mem_read(dex,0x4dc))==before
  return h.u16(out)
 # The example: 50% Ivysaur plus 50% Charizard becomes 100% Charizard.
 caught(1);select([2]*3+[6]*9)
 for i in range(50):roll[0]=i;assert generate()==6
 # Exhaustively retain every surviving slot's native grass weight.
 select(list(range(1,13)));observed=collections.Counter()
 for i in range(50):roll[0]=i;observed[generate()]+=1
 assert observed=={4:10,5:10,6:10,7:5,8:5,9:4,10:4,11:1,12:1},observed
 # Fishing and both water methods use their own native providers.
 for kind,weights in [(1,[60,30,5,4,1]),(2,[40,40,15,4,1])]:
  select([2,4,7,10,13],5,kind);observed=collections.Counter()
  for i in range(100-weights[0]):roll[0]=i;observed[generate()]+=1
  assert observed==dict(zip([4,7,10,13],weights[1:])),observed
 # Every native encounter-power weight variant retains conditional weights.
 variants=[[[20,20,10,10,10,10,5,5,4,4,1,1],[10,10,10,10,10,10,10,10,5,5,5,5],[5,5,5,5,10,10,10,10,10,10,10,10],[1,1,4,4,5,5,10,10,10,10,20,20]],
           [[60,30,5,4,1],[50,30,10,5,5],[40,30,10,10,10],[30,20,10,20,20]],
           [[40,40,15,4,1],[40,35,15,5,5],[30,30,20,10,10],[20,20,20,20,20]]]
 power=[0];h.stubs[0x20138e0]=lambda:h.ret(power[0])
 for kind,levels in enumerate(variants):
  ids=list(range(1,13)) if kind==0 else [2,4,7,10,13];select(ids,len(ids),kind)
  for level,weights in enumerate(levels):
   power[0]=level;expected={id:weight for id,weight in zip(ids,weights) if id not in (1,2,3)};observed=collections.Counter()
   for i in range(sum(expected.values())):roll[0]=i;observed[generate()]+=1
   assert observed==expected,(kind,level,observed,expected)
 power[0]=0
 # The uniform provider (e.g. swarm tables) also excludes caught families.
 select([2,4,7,10,13],5,3)
 for i,expected in enumerate([4,7,10,13]):roll[0]=i;assert generate()==expected
 # A preferred type may never reintroduce a dupe.
 arc=ndspy.narc.NARC(h.files['a/0/1/6'])
 for species in (2,4):
  data=bytearray(arc.files[species]);data[6:8]=bytes([8,8]);arc.files[species]=data
 h.files['a/0/1/6']=bytes(arc.save());h.files['rom:/a/0/1/6']=h.files['a/0/1/6']
 select([2,4,7,10,13],5,1,1<<12)
 for i in range(4):roll[0]=i;assert generate()==4
 # Caught state refreshes in the same area; all-dupe policy is explicit.
 caught(1,4,7,10,13);select([2,4,7,10,13],5,1)
 assert generate() in [2,4,7,10,13]
 config(prevent=True);reset();before=len(rng);assert h.call('NuzlockeGenerate',parameters,table,out)==0 and len(rng)==before
 # Disabled/missing data and allocation failure restore the native path.
 config(False);reset();assert generate() in [2,4,7,10,13]
 config();reset();h.fail_alloc=True;assert generate() in [2,4,7,10,13];h.fail_alloc=False
 # Native ROM edits, including changed family edges, are read after reload.
 evo_key='rom:/a/0/1/9';saved_evo=h.files[evo_key];arc=ndspy.narc.NARC(saved_evo)
 edge=bytearray(arc.files[1]);struct.pack_into('<H',edge,4,6);arc.files[1]=edge;h.files[evo_key]=bytes(arc.save())
 config(prevent=True);reset();caught(1);bits=snapshot();assert has(bits,6) and has(bits,4) and not has(bits,2)
 h.files[evo_key]=saved_evo
 # Missing module/config, corrupt archive, and malformed evolution records are safe native fallbacks.
 for key in (module_key,config_key):
  saved=h.files.pop(key);reset();assert generate() in [2,4,7,10,13];h.files[key]=saved
 saved=h.files[config_key];h.files[config_key]=b'bad';reset();assert generate() in [2,4,7,10,13];h.files[config_key]=saved
 arc=ndspy.narc.NARC(saved_evo);arc.files[1]=b'bad';h.files[evo_key]=bytes(arc.save());reset();assert generate() in [2,4,7,10,13];h.files[evo_key]=saved_evo
 assert not h.allocations and not h.opened
 print(game,'native family snapshots, exact reweighting, preferred types, fishing, swarms, live caught state, all-dupe policy and fallbacks passed',flush=True)
print('Compiled CPU checks are separate from live-game acceptance.')
