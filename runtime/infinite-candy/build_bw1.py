"""Build the BW1 Infinite Candy dependency and verify its retail data ABI."""
import hashlib,json,struct,subprocess
from pathlib import Path
import ndspy.rom,ndspy.narc,ndspy.codeCompression
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
from build import HERE,REPO,WORKSPACE,TOOLS,JAR,BUILD,run
VERSION='0.1.0-bw1'
DATA='00000000000000003f020100010000000005000000001c00000000000000000503020000'
RETAIL='00000000000000003f0200000000000b0000000000000000000000000000000000000000'

def fp(data):
 n=0x811c9dc5
 for b in data:n=((n^b)*0x1000193)&0xffffffff
 return f'{n:08x}'

def main():
 BUILD.mkdir(exist_ok=True);manifest={'version':VERSION,'itemDataHex':DATA,'games':{}}
 for game,path,hook,reader,icons in [('B',WORKSPACE/'cleanblack.nds',0x21ba670,0x2021015,0x209eb6c),('W',Path.home()/'Downloads/cleanroms/cleanwhite.nds',0x21ba690,0x2021031,0x209eb84)]:
  r=ndspy.rom.NintendoDSRom.fromFile(str(path));assert r.idCode==(b'IRBO'if game=='B'else b'IRAO')and r.version==0
  a=bytes(ndspy.codeCompression.decompress(r.arm9));o=r.loadArm9Overlays([91])[91]
  assert bytes(o.data[hook-o.ramAddress:hook-o.ramAddress+8])==bytes.fromhex('08b5031c0a208001')
  items=ndspy.narc.NARC(r.getFileByName('a/0/2/4'));gfx=ndspy.narc.NARC(r.getFileByName('a/0/2/5'))
  assert len(items.files)==627 and bytes(items.files[622]).hex()==RETAIL
  assert struct.unpack_from('<HH',a,icons+622*4-r.arm9RamAddress)==(827,828)
  # Execute the actual retail parameter reader, including the recovery bitfield.
  u=Uc(UC_ARCH_ARM,UC_MODE_THUMB);u.ctl_set_cpu_model(UC_CPU_ARM_946);u.mem_map(0x2000000,0x400000);u.mem_write(r.arm9RamAddress,a)
  stop=0x23f0000;data=0x2200000;u.mem_write(data,bytes.fromhex(DATA))
  u.hook_add(UC_HOOK_CODE,lambda uc,at,n,d:uc.emu_stop()if at==stop else None)
  params={}
  for field in [3,4,5,6,7,14,16,28,29]:
   for reg,value in [(UC_ARM_REG_R0,data),(UC_ARM_REG_R1,field),(UC_ARM_REG_SP,0x23e0000),(UC_ARM_REG_LR,stop|1)]:u.reg_write(reg,value)
   u.emu_start(reader,stop+2,count=2000);params[field]=u.reg_read(UC_ARM_REG_R0)
  assert params=={3:1,4:0,5:4,6:1,7:0,14:1,16:0,28:1,29:0},params
  # BW1's Bag already routes the medicine handler to ordinary item use. Its
  # field Party constructor requires no BW2 Reveal Glass comparison patch.
  symbol=f'THUMB_BRANCH_91_0x{hook:x}'
  asm=f'''.syntax unified
.cpu arm946e-s
.thumb
.extern BagSave_SubItem
.balign 4
.global {symbol}
.type {symbol},%function
.thumb_func
{symbol}:
 push {{r3,lr}}
 ldr r2,=622
 cmp r1,r2
 beq 1f
 movs r3,r0
 movs r0,#10
 lsls r0,r0,#6
 ldr r0,[r3,r0]
 ldrh r3,[r3]
 ldr r0,[r0,#4]
 movs r2,#1
 bl BagSave_SubItem
 pop {{r3,pc}}
1:
 movs r0,#0
 pop {{r3,pc}}
.size {symbol},.-{symbol}
.ltorg
'''
  s=BUILD/f'InfiniteCandy{game}.s';s.write_text(asm);obj=BUILD/f'InfiniteCandy{game}.o'
  run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',s,'-o',obj)
  esdb=BUILD/f'symbols-{game}.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols:\n  - Name: BagSave_SubItem\n    Segment: 0\n    Address: 0x02007f1d\n')
  meta=BUILD/f'metadata-{game}.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
  dll=REPO/f'src/assets/codeinjection/InfiniteCandy{game}.dll'
  run('java','-cp',JAR,'rpm.cli.RPMTool','-i',obj,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
  blob=dll.read_bytes();h=struct.unpack_from('<I',blob,8)[0];info=h+struct.unpack_from('<I',blob,h+8)[0];start,size=struct.unpack_from('<II',blob,info+16)
  assert struct.unpack_from('<I',blob,h+12)[0]==0
  profile={'idCode':r.idCode.decode(),'revision':0,'dsAccepted':False,'fileName':dll.name,'sha256':hashlib.sha256(blob).hexdigest(),'codeFingerprint':fp(blob[start:start+size]),'subItem':hook,'partyOverlay':91,'iconTable':icons,'retailItemDataHex':RETAIL,'nameBank':54,'descriptionBank':53,'retailIconFingerprints':[fp(gfx.files[n])for n in [827,828]],'nativeItemParameters':params,'signatures':[{'module':'91','address':hook,'expectedHex':bytes(o.data[hook-o.ramAddress:hook-o.ramAddress+8]).hex(),'patchSize':8},{'module':'ARM9','address':reader&~1,'expectedHex':a[(reader&~1)-r.arm9RamAddress:(reader&~1)-r.arm9RamAddress+64].hex(),'patchSize':0},{'module':'ARM9','address':0x2007f1c,'expectedHex':a[0x2007f1c-r.arm9RamAddress:0x2007f1c-r.arm9RamAddress+72].hex(),'patchSize':0}]}
  acceptance=REPO/'runtime/party-quick-actions/acceptance-bw1.json'
  if acceptance.exists():
   accepted=json.loads(acceptance.read_text());proof=accepted.get('games',{}).get(game,{})
   profile['dsAccepted']=accepted.get('version')==VERSION and proof.get('passed',False) and proof.get('candySha256')==profile['sha256']
  manifest['games'][game]=profile;print(game,params,'native item data verified;', 'DS accepted' if profile['dsAccepted'] else 'gameplay acceptance pending')
 (REPO/'src/assets/codeinjection/infiniteCandyBw1Manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':main()
