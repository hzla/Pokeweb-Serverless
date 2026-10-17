"""Host logic and compiled B2/W2 application checks; not gameplay evidence."""
from pathlib import Path
import struct,subprocess,json
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946,UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];BUILD=HERE/'build';BUILD.mkdir(exist_ok=True)
TOOLS=ROOT.parent/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'
subprocess.run(['clang++','-std=c++17','-Wall','-Wextra','-Werror',HERE/'test_logic.cpp','-o',BUILD/'test-logic'],check=True)
subprocess.run([BUILD/'test-logic'],check=True)
REG=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]
for game in ['W2','B2']:
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB);u.ctl_set_cpu_model(UC_CPU_ARM_946);u.mem_map(0x2000000,0x400000);u.mem_map(0x5000000,0x10000)
 symbols={};stubs={};native_ranges=[];delta=44 if game=='B2' else 0;od=64 if game=='B2' else 0
 for group,base,data in [('Viewer',0x2300000,0x2340000),('Menu',0x2350000,0x2360000)]:
  source=ROOT/f'runtime/learnset-viewer/build/Learnset{group}{game}.elf';linked=BUILD/f'{group}{game}.elf'
  subprocess.run([TOOLS/'arm-none-eabi-ld','-Ttext',hex(base),'-Tdata',hex(data),'-e','LearnsetViewerInit' if group=='Viewer' else 'LearnsetMenuCreate',source,'-o',linked],check=True,capture_output=True)
  with linked.open('rb') as f:
   elf=ELFFile(f)
   for s in elf.iter_sections():
    if s['sh_flags']&2 and s['sh_type']!='SHT_NOBITS':u.mem_write(s['sh_addr'],s.data())
   for s in elf.get_section_by_name('.symtab').iter_symbols():
    if s.name and s['st_shndx']!='SHN_UNDEF':symbols[group+':'+s.name]=s['st_value']
 def sym(prefix,group='Viewer'):
  names=[a for n,a in symbols.items() if n.startswith(group+':'+prefix)];assert len(names)==1,(prefix,names);return names[0]
 def word(p):return struct.unpack('<I',u.mem_read(p,4))[0]
 def put(p,n):u.mem_write(p,struct.pack('<I',n))
 def ret(n=0):u.reg_write(REG[0],n);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def hook(_u,a,size,_):
  if a==0x2008000:u.emu_stop();return
  if a in stubs:stubs[a]();return
  assert 0x2300000<=a<0x2370000 or any(start<=a<end for start,end in native_ranges),hex(a)
 u.hook_add(UC_HOOK_CODE,hook)
 def call(address,*args):
  if isinstance(address,str):address=sym(address)
  for i in range(8):u.reg_write(REG[i],args[i] if i<min(len(args),4) else 0x11110000+i)
  for i,x in enumerate(args[4:]):put(0x23f0000+i*4,x)
  u.reg_write(UC_ARM_REG_SP,0x23f0000);u.reg_write(UC_ARM_REG_LR,0x2008001);u.emu_start(address|1,0x2008000,count=20000000)
  assert u.reg_read(UC_ARM_REG_PC)==0x2008000 and u.reg_read(UC_ARM_REG_SP)==0x23f0000,(hex(address),hex(u.reg_read(UC_ARM_REG_PC)),hex(u.reg_read(UC_ARM_REG_SP)))
  assert [u.reg_read(REG[i]) for i in range(4,8)]==[0x11110000+i for i in range(4,8)]
  return u.reg_read(REG[0])
 def stub(a,fn):stubs[a-(delta if a>=0x20191d8 else 0)]=fn
 work=0x2200000;launch=0x2201000;out=0x2202000;pixels=0x2210000;keys=[0];touch=[False,0,0];allocations=set();fail=[False];info=[];sounds=[];queue=[]
 def alloc():
  if fail[0]:ret();return
  allocations.add(0x2220000);ret(0x2220000)
 def release():allocations.discard(u.reg_read(REG[0]));ret()
 def context():
  p=u.reg_read(REG[2]);info.append(struct.unpack('<HHB',u.mem_read(p,5)));ret()
 def touched():put(u.reg_read(REG[0]),touch[1]);put(u.reg_read(REG[1]),touch[2]);ret(int(touch[0]))
 stub(0x2039dc8,alloc);stub(0x203a278,release);stub(0x2048520,lambda:ret(0x2203000));stub(0x2046f20,lambda:ret(pixels))
 for a in [0x2048640,0x2021d54,0x2048270,0x2048298,0x2045ba8,0x2044cc4,0x204c150,0x2070ca8]:stub(a,lambda:ret())
 stub(0x2045840,lambda:ret(0x2204000));stub(0x20228b4,lambda:ret(64));stub(0x203df28,lambda:ret(keys[0]));stub(0x203dab0,touched);stub(0x2070ecc,lambda:ret())
 stub(0x203e808,lambda:ret())
 # Raster/palette/lifetime behavior executes separately in verify_style.py.
 # This dispatcher harness exercises the allocation-failure fallback.
 stubs[sym('_ZN7pokenav2ui6create')&~1]=lambda:ret()
 stub(0x2006254,lambda:(sounds.append(u.reg_read(REG[0])),ret()))
 stubs[sym('_Z10infoReloadPvP7RequestPK')&~1]=context
 stubs[sym('_Z9infoEmpty')&~1]=lambda:(info.append(None),ret())
 stubs[sym('_Z8infoIcon')&~1]=lambda:ret()
 stubs[sym('_Z9infoIcons')&~1]=lambda:ret()
 stubs[sym('_Z16infoIconPalettes')&~1]=lambda:(u.mem_write(u.reg_read(REG[0]),struct.pack('<48H',*range(256,304))),ret(1))
 stubs[sym('_Z9infoInput')&~1]=lambda:ret()
 stubs[sym('_Z8infoName')&~1]=lambda:(u.mem_write(u.reg_read(REG[2]),b'\xff\xff'),ret())
 def fixture(populated=True):
  data=bytearray(248);struct.pack_into('<IHHHH',data,0,0x56414e50,1,248,427,117);data[14]=1
  if populated:
   for method in [0,2,3,6]:
    data[16+method]=10;count=12 if method<3 else 5;offset=8+method*48 if method<3 else 152+(method-3)*20
    for i in range(count):struct.pack_into('<HBB',data,16+offset+i*4,25 if method==0 else 129,5,9)
  u.mem_write(launch,bytes(data))
 for broken in [0,1,2]:
  fixture();data=bytearray(u.mem_read(launch,248));data[[0,4,6][broken]]^=2;u.mem_write(launch,bytes(data));assert not call('_Z12pokenavBegin',launch,out)
 for offset in [4,6]:
  fixture();u.mem_write(launch+offset,b'\x02');assert call(sym('LearnsetViewerInit'),0,0,launch,work)==1 and u.mem_read(launch+12,2)==b'\x00\x01'
 for exhausted in [False,True]:
  fixture();fail[0]=exhausted;assert call('_Z12pokenavBegin',launch,out);assert call('_Z13pokenavActive')
  windows=[];tiles={}
  def window_create():
   a=[u.reg_read(REG[i]) for i in range(4)]+[word(u.reg_read(UC_ARM_REG_SP)+i*4) for i in range(3)]
   windows.append(a);tiles[a[0]]=tiles.get(a[0],0)+a[3]*a[4]
   assert tiles[a[0]]<=1024, 'Native BG character allocator exhausted by unused tutor windows'
   ret(0x2203000)
  stub(0x20480ec,window_create)
  tutor=__import__('ndspy.rom',fromlist=['NintendoDSRom']).NintendoDSRom.fromFile(ROOT.parent/('cleanwhite2.nds' if game=='W2' else 'cleanblack2.nds')).loadArm9Overlays([258])[258]
  for i in range(16):
   args=struct.unpack_from('<7I',tutor.data,0x219bc38-od-tutor.ramAddress+i*28)
   # The constructor call passes the first six table fields plus allocation direction 1.
   call('_Z13pokenavWindow',*args[:6],1)
  assert tiles[6]==777 and windows[1][1:6]==[0,0,32,24,14]
  assert all(w[3:5]==[1,1] for i,w in enumerate(windows) if w[0]==6 and i!=1)
  private=word(word(out));shell=bytes(u.mem_read(private,220));assert struct.unpack_from('<3H',shell,4)==(3,1,1)
  profile=json.loads((ROOT/'src/assets/codeinjection/cgearQuickActionsManifest.json').read_text())['games'][game]
  crypto=next(s for s in profile['signatures'] if s['label']=='Pokenav PK5 shell decrypt flags');entry=crypto['address'];code=bytes.fromhex(crypto['expectedHex'])
  u.mem_write(entry,code);native_ranges.append((entry,entry+len(code)));assert call(entry,private)==0 and bytes(u.mem_read(private,220))==shell
  call('_Z11pokenavInit',work);assert info[-1]==(25,0,100);assert bool(allocations)!=exhausted
  call('_Z12pokenavFrame',work)
  keys[0]=0x100;call('_Z12pokenavInput',work);keys[0]=0;call('_Z12pokenavInput',work)
  assert info[-1]==(129,0,100),'R switches a populated method while an icon is focused'
  heard=len(sounds);keys[0]=0x100;call('_Z12pokenavInput',work);assert len(sounds)==heard
  keys[0]=0x200;call('_Z12pokenavInput',work);keys[0]=0;call('_Z12pokenavInput',work)
  assert info[-1]==(25,0,100),'L restores the preceding populated method'
  call('_Z12pokenavInput',work);keys[0]=0x40;call('_Z12pokenavInput',work);keys[0]=0x10;call('_Z12pokenavInput',work)
  keys[0]=0;call('_Z12pokenavInput',work);assert info[-1]==(129,0,100)
  keys[0]=0x10
  heard=len(sounds);call('_Z12pokenavInput',work);assert len(sounds)==heard,'Method endpoints must remain silent'
  keys[0]=2;assert call('_Z12pokenavInput',work);keys[0]=0;call('_Z10pokenavEnd');assert not allocations and u.mem_read(launch+13,1)==b'\x01';assert not call('_Z13pokenavActive')
 fixture(False);assert call('_Z12pokenavBegin',launch,out);call('_Z11pokenavInit',work);assert info[-1] is None
 call('_Z12pokenavInput',work);touch[:]=[True,220,184];assert call('_Z12pokenavInput',work);touch[:]=[False,0,0];call('_Z10pokenavEnd');assert not allocations
 # Real compiled shared dispatcher uses native field preparation and waits for
 # application completion, without allocating or freeing the parent's request.
 fixture();map=0x2206000;fieldwork=0x2207000;sequence=0x2208000;put(map,0x2209000);put(map+20,launch);put(fieldwork+24,map)
 stub(0x2016a98,lambda:(queue.append([u.reg_read(REG[i]) for i in range(4)]),ret()))
 stubs[0x215b758-od]=lambda:(put(u.reg_read(REG[1]),u.reg_read(REG[0])),ret())
 stubs[0x215b794-od]=lambda:ret()
 put(sequence,11);call(sym('LearnsetDispatch','Menu'),0,sequence,fieldwork);assert word(sequence)==12 and queue[-1][1]==258 and queue[-1][3]==launch
 bridge=queue[-1][2];put(0x219b9e8-od,0x2199901-od);assert call(word(bridge),0,sequence,launch,work)==1 and u.mem_read(launch+13,1)==b'\x01'
 put(sequence,13);call(sym('LearnsetDispatch','Menu'),0,sequence,fieldwork);assert word(sequence)==8 and word(map+40)==1 and word(fieldwork+28)==0
 put(sequence,11);u.mem_write(launch+4,b'\x02');count=len(queue);call(sym('LearnsetDispatch','Menu'),0,sequence,fieldwork);assert word(sequence)==8 and len(queue)==count
 print(game,'compiled Pokenav ABI, native lifecycle, missing companion, combined chances, method input, empty maps, Back and allocation failure cleanup passed')
