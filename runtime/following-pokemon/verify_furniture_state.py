"""Check furniture depth from supplied captured RAM, without a game frame.

The packaged actor submission runs on an isolated ARM946 CPU. GPU submission
is observed by a spy. Python independently reconstructs the native prop box
and verifies geometric and quantized depth ordering, projected-image preservation
and restoration.
"""
import argparse,hashlib,json,math,struct,zlib
from pathlib import Path
from inspect_state import desmume_ram
from verify_terrain_state import state_ram,state_follower
from verify_packaged import *
from unicorn import UC_HOOK_CODE

def captured_depth(data,eye,target):
 # Read the saved geometry matrices and depth mode; do not restore a renderer.
 payload=data[32:] if struct.unpack_from('<I',data,28)[0]==0xffffffff else zlib.decompress(data[32:])
 at=0;gpu=None
 while at+8<=len(payload):
  kind,size=struct.unpack_from('<II',payload,at);at+=8
  if kind==90:gpu=payload[at:at+size];break
  at+=size
 assert gpu is not None,'Captured geometry state missing'
 records={};at=0
 while at+12<=len(gpu):
  tag,size,count=struct.unpack_from('<4sII',gpu,at);at+=12
  records[tag]=gpu[at:at+size*count];at+=size*count
 matrices=struct.unpack('<64i',records[b'GMCU']);projection=matrices[:16];saved_view=matrices[16:32]
 # A snapshot can finish after a local model/shadow transform. These fixtures
 # retain the camera rotation with a uniform scale; discard its local origin
 # and rebuild the field view translation from the captured camera eye.
 basis=[[saved_view[j*4+i] for j in range(3)] for i in range(3)]
 scale=math.sqrt(sum(v*v for v in basis[0]));assert scale>0
 assert all(abs(math.sqrt(sum(v*v for v in row))-scale)<scale*.002 for row in basis)
 basis=[[math.trunc(v*4096/scale) for v in row] for row in basis]
 axis=[eye[i]-target[i] for i in range(3)];length=math.sqrt(sum(v*v for v in axis))
 assert sum(basis[2][i]*axis[i] for i in range(3))/(4096*length)>.999,'Saved basis is not the field camera'
 view=[0]*16;view[15]=4096
 for i in range(3):
  for j in range(3):view[j*4+i]=basis[i][j]
  view[12+i]=-sum(basis[i][j]*eye[j] for j in range(3))//4096
 wbuffer=struct.unpack('<I',records[b'gSWB'])[0]
 assert wbuffer==0,'This regression requires the captured native Z-buffer mode'
 def code(pos):
  # Fixed-point matrix products followed by the DS 15-bit viewport depth.
  v=[math.floor(sum(view[j*4+i]*pos[j] for j in range(3))/4096)+view[12+i] for i in range(4)]
  clip=[sum(projection[j*4+i]*v[j] for j in range(4))//4096 for i in range(4)]
  assert clip[3]>0
  return max(0,min(0xffffff,(math.trunc(clip[2]*0x4000/clip[3])+0x3fff)*0x200))
 return code

def verify(path,expect_failure=False,rotation=None):
 data=path.read_bytes();ram=desmume_ram(data) if data[:16]==b'DeSmuME SState\0\0' else state_ram(path)[1]
 B=0x02000000
 def read(p,fmt='I'):return struct.unpack_from('<'+fmt,ram,p-B)
 def ptr(p):return read(p)[0]
 d=ram.find(b'FWDG')+B;a,p,visible=read(d+32,'3I');assert a and p and visible
 field=ptr(d+56);system=ptr(a+136);bl=ptr(ptr(system+40)+4);scene=ptr(bl+4);entries=ptr(scene+8)
 slots=ptr(bl+24);bi=entries+ptr(slots+read(a+196,'H')[0]*40)*28;pi=entries+ptr(slots+read(p+196,'H')[0]*40)*28
 cam=ptr(field+0xb4);light=ptr(field+0xb8);mapper=ptr(field+0x50);props=ptr(mapper+0x64)
 eye,target=read(cam+32,'3i'),read(cam+56,'3i');view=[eye[i]-target[i] for i in range(3)];length=math.sqrt(sum(v*v for v in view));axis=[v/length for v in view]
 boxes=[];base=read(mapper+0x54,'3i');overrides=[]
 for i in range(288):
  holder=props+0x268+i*16;c,_,idx,vis,instance=read(holder,'IIHHI')
  if not c or not vis or not instance:continue
  resource=ptr(instance);actor=ptr(ptr(props+0x220)+resource*8);mdl=ptr(ptr(ptr(actor)+4)+4)
  box=read(mdl+44,'6h');scale=ptr(mdl+56);pos=read(instance+4,'3i');origin=read(c+4,'3i')
  angle=(read(instance+16,'H')[0] if rotation is None else rotation)/65536*2*math.pi
  corners=[]
  for j in range(8):
   x=(box[0]+(box[3] if j&1 else 0))*scale/4096;y=(box[1]+(box[4] if j&2 else 0))*scale/4096;z=(box[2]+(box[5] if j&4 else 0))*scale/4096
   corners.append((base[0]+origin[0]+pos[0]+x*math.cos(angle)+z*math.sin(angle),base[1]+origin[1]+pos[1]+y,base[2]+origin[2]+pos[2]-x*math.sin(angle)+z*math.cos(angle)))
  if min(v[0] for v in corners)<=read(p+68,'3i')[0]<=max(v[0] for v in corners) and abs(pos[2]+origin[2]+base[2]-read(p+76,'i')[0])<=2*65536:
   boxes.append(corners)
   if rotation is not None:overrides.append(instance+16)
 assert len(boxes)==1,('Expected the captured trashcan box',len(boxes))
 corners=boxes[0]
 depth_code=captured_depth(data,eye,target) if data[:16]==b'DeSmuME SState\0\0' else None
 dll=PACKAGE_BUILD/f'PokewebFollowingField{MODULE_SUFFIX}.dll';elf=PACKAGE_BUILD/f'PokewebFollowingField{MODULE_SUFFIX}.elf'
 _,_,_,_,functions,_=audit(dll,elf);newbase=0x02c00000;stack=0x02ef8000;stop=0x02efff00
 cpu=Uc(UC_ARCH_ARM,UC_MODE_THUMB);cpu.ctl_set_cpu_model(UC_CPU_ARM_946);cpu.mem_map(B,0x1000000);cpu.mem_write(B,ram)
 cpu.mem_write(newbase,bytes(relocate(dll,newbase,{symbol_hash('FollowingCoreAPI'):stop,symbol_hash('FollowingEventsAPI'):stop})))
 for address in overrides:cpu.mem_write(address,struct.pack('<H',rotation))
 native={'player':read(pi+4,'3i')+read(pi+18,'2h'),'follower':read(bi+4,'3i')+read(bi+18,'2h')}
 seen=[]
 def submit(u,pc,_size,_user):
  assert [u.reg_read(reg) for reg in (UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2)]==[bl,cam,light]
  seen.append({key:struct.unpack('<3i',u.mem_read(at+4,12))+struct.unpack('<2h',u.mem_read(at+18,4)) for key,at in (('player',pi),('follower',bi))})
  u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 cpu.hook_add(UC_HOOK_CODE,submit,begin=0x0204f684,end=0x0204f684)
 sprite_y=read(state_follower(ram)+51,'b')[0]
 cpu.reg_write(UC_ARM_REG_SP,stack);cpu.reg_write(UC_ARM_REG_LR,stop|1)
 for reg,value in zip((UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3),(bl,cam,light,a)):cpu.reg_write(reg,value)
 cpu.mem_write(stack,struct.pack('<Ii',p,sprite_y));cpu.emu_start((newbase+functions['fwr_draw'][0])|1,stop,count=3000000)
 assert cpu.reg_read(UC_ARM_REG_PC)==stop and len(seen)==1
 # Also route the saved native argument-loading block through the real
 # packaged draw hook. Rebind only the private copy's owned callback/state.
 exports=module_exports(dll,newbase);address=lambda name:exports[symbol_hash(name)]
 sidecar=state_follower(ram)
 cpu.mem_write(address('fwfield_follower'),ram[sidecar-B:sidecar-B+1856])
 cpu.mem_write(address('fwfield_owner'),struct.pack('<I',system));cpu.mem_write(address('fwfield_player'),struct.pack('<I',p))
 cpu.mem_write(a+140,struct.pack('<I',address('fwfield_moves')))
 site=0x0218119a;target=newbase+functions['THUMB_BRANCH_LINK_36_0x0218119a'][0]
 # The test DLL lives outside captured native allocations. A private Thumb
 # veneer keeps the retail BL within its signed four-MiB reach.
 veneer=0x02500000;cpu.mem_write(veneer,struct.pack('<HHI',0x4b00,0x4718,target|1));relative=veneer-(site+4)
 assert -(1<<22)<=relative<(1<<22)
 cpu.mem_write(site,struct.pack('<HH',0xf000|((relative>>12)&0x7ff),0xf800|((relative>>1)&0x7ff)))
 cpu.ctl_remove_cache(0x02181188,0x0218119e)
 cpu.reg_write(UC_ARM_REG_SP,stack);cpu.reg_write(UC_ARM_REG_R5,field)
 cpu.emu_start(0x02181189,0x0218119e,count=3000000)
 assert cpu.reg_read(UC_ARM_REG_PC)==0x0218119e and cpu.reg_read(UC_ARM_REG_SP)==stack
 assert len(seen)==2 and seen[0]==seen[1],'Retail hook differs from direct draw'
 cpu.mem_write(a+140,ram[a+140-B:a+144-B])
 results={}
 def depth(pos):return sum(pos[i]*axis[i] for i in range(3))
 minimum=min(depth(v) for v in corners)
 for key,at in (('player',pi),('follower',bi)):
  submitted=seen[0][key];original=native[key]
  results[key]={'nativeDepth':depth(original[:3]),'submittedDepth':depth(submitted[:3]),'modelRearDepth':minimum,'behindFurniture':depth(submitted[:3])<=minimum-480}
  if depth_code:
   # Strictly farther after quantization: equal depth is not a safe budget.
   native_code=depth_code(original[:3]);submitted_code=depth_code(submitted[:3]);rear_code=max(depth_code(corner) for corner in corners)
   results[key].update(nativeDepthCode=native_code,submittedDepthCode=submitted_code,modelRearDepthCode=rear_code,
                       quantizedBehindFurniture=submitted_code>rear_code)
  assert bytes(cpu.mem_read(at,28))==ram[at-B:at-B+28],key
  # Eye-ray translation plus the submitted scale keeps the image fixed.
  def projected(pose):
   ray=[pose[i]-eye[i] for i in range(3)];distance=-sum(ray[i]*axis[i] for i in range(3))
   right=(axis[2],0,-axis[0]);rl=math.sqrt(sum(v*v for v in right));right=[v/rl for v in right]
   up=(axis[1]*right[2],axis[2]*right[0]-axis[0]*right[2],-axis[1]*right[0])
   return [sum(ray[i]*v[i] for i in range(3))/distance for v in (right,up)]+[pose[3]/distance,pose[4]/distance]
  # Follower Y grounding intentionally changes its image; player must stay put.
  if key=='player':assert max(abs(x-y) for x,y in zip(projected(original),projected(submitted)))<0.00002
 failed=not all(result['behindFurniture'] and result.get('quantizedBehindFurniture',True) for result in results.values())
 assert failed==expect_failure,(path.name,results)
 assert bytes(cpu.mem_read(a,256))==ram[a-B:a-B+256] and bytes(cpu.mem_read(p,256))==ram[p-B:p-B+256]
 assert path.read_bytes()==data
 return {'state':path.name,'stateSha256':hashlib.sha256(data).hexdigest(),'moduleSha256':hashlib.sha256(dll.read_bytes()).hexdigest(),'rotationOverride':rotation,'failureReproduced':failed,'depth':results,'retailDrawHookMatches':True,'nativeStateRestored':True,'gameEmulatorRun':False}

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('states',nargs='+',type=Path);parser.add_argument('--expect-failure',action='store_true');parser.add_argument('--rotations',action='store_true');parser.add_argument('--report',type=Path);args=parser.parse_args()
 rotations=(None,0x4000,0x8000,0xc000) if args.rotations else (None,)
 result=json.dumps([verify(path,args.expect_failure,rotation) for path in args.states for rotation in rotations],indent=2)+'\n'
 if args.report:args.report.write_text(result)
 print(result)
