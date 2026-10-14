"""Execute both compiled BW1 adapters and retail PK5 access routines."""
import struct,subprocess
import ndspy.rom,ndspy.codeCompression,ndspy.narc
from verify import main,Harness,MON,W,REQ,BUILD,TOOLS
from elftools.elf.elffile import ELFFile
from configure_bw1 import WS,BINDINGS
from pathlib import Path

# The game uses this order for its four logical blocks, with the first eight
# entries repeated for personality values 24..31.
ORDERS=[(0,1,2,3),(0,1,3,2),(0,2,1,3),(0,3,1,2),(0,2,3,1),(0,3,2,1),
 (1,0,2,3),(1,0,3,2),(2,0,1,3),(3,0,1,2),(2,0,3,1),(3,0,2,1),
 (1,2,0,3),(1,3,0,2),(2,1,0,3),(3,1,0,2),(2,3,0,1),(3,2,0,1),
 (1,2,3,0),(1,3,2,0),(2,1,3,0),(3,1,2,0),(2,3,1,0),(3,2,1,0)]
ORDERS+=ORDERS[:8]

def crypt(data,key):
 for offset in range(0,len(data),2):
  key=(key*1103515245+24691)&0xffffffff
  value=struct.unpack_from('<H',data,offset)[0]^(key>>16);struct.pack_into('<H',data,offset,value)

def record(order,encrypted,egg=False,hp=10):
 logical=bytearray((i*37+11)&255 for i in range(128))
 struct.pack_into('<H',logical,0,25);struct.pack_into('<I',logical,8,8000)
 struct.pack_into('<4H',logical,32,1,2,3,4);struct.pack_into('<I',logical,48,(1<<30)if egg else 0)
 logical[55]=logical[56]=0;logical[59]=30;logical[86]=0
 nickname='Aster'.encode('utf-16-le')+b'\xff\xff'*6;logical[64:86]=nickname
 payload=bytearray(128)
 for block in range(4):payload[ORDERS[order][block]*32:(ORDERS[order][block]+1)*32]=logical[block*32:(block+1)*32]
 mon=bytearray(220);pid=order<<13|0x123;checksum=sum(struct.unpack('<64H',payload))&65535
 struct.pack_into('<IHH',mon,0,pid,0 if encrypted else 3,checksum)
 if encrypted:crypt(payload,checksum)
 mon[8:136]=payload;mon[140]=20;struct.pack_into('<HH',mon,142,hp,20)
 if encrypted:
  tail=mon[136:];crypt(tail,pid);mon[136:]=tail
 return bytes(mon)

def native_checks(game):
 rom=ndspy.rom.NintendoDSRom.fromFile(str(WS/'cleanblack.nds'if game=='B'else Path.home()/'Downloads/cleanroms/cleanwhite.nds'))
 arm=bytes(ndspy.codeCompression.decompress(rom.arm9));personal=ndspy.narc.NARC(rom.getFileByName('a/0/1/6'));experience=ndspy.narc.NARC(rom.getFileByName('a/0/1/7'))
 index=0 if game=='B'else 1
 for order in range(32):
  for encrypted in (False,True):
   h=Harness(game);h.instructionLimit=1000000;h.u.mem_write(rom.arm9RamAddress,arm)
   for reference in [0x201cd24,0x201cd48]:h.functions.pop(BINDINGS[reference][index]&~1)
   h.functions.pop(BINDINGS[0x201d5e0][index]&~1)
   # Only the archive boundary is instrumented: the retail threshold routine
   # and growth table execute, using this ROM's Pikachu growth classification.
   def growth(args):
    assert args[:3]==[25,0,23],args
    return personal.files[25][21]
   h.functions[0x2019c90 if game=='B'else 0x2019cac]=growth
   def load_exp(args):
    assert args[1] in (16,17),args
    archive=personal if args[1]==16 else experience
    assert args[2]<len(archive.files),args
    h.u.mem_write(args[0],bytes(archive.files[args[2]]))
   h.functions[0x2048f4c if game=='B'else 0x2048f64]=load_exp
   h.seed()
   for member in range(6):h.u.mem_write(MON+member*220,record(order,encrypted,member==2,0 if member==1 else 10))
   h.call('_Z3getPvj',MON,5);assert h.call('_Z3getPvj',MON,5)==25
   original=bytes(h.u.mem_read(MON,220));assert h.call('_Z3getPvj',MON,158)==20
   assert bytes(h.u.mem_read(MON,220))==original,'native reads altered PK5'
   h.frame((40,180));h.frame(None,0x10,0x10);assert h.call('_Z3getPvj',MON,160)==11
   for button,status in zip([84,106,128,150,172],[3,8,16,32,64]):
    h.frame();h.frame((button,180));assert h.call('_Z3getPvj',MON,157)==status
    h.frame();h.frame((button,180));assert h.call('_Z3getPvj',MON,157)==0
   h.frame();h.frame((62,180));h.frame(None,1,1)
   assert h.call('_Z3getPvj',MON,8)==9260 and h.printed[-1]=="Aster's xp was edged!"
   h.frame();h.frame(None,1,1);h.frame();h.frame((33,180));h.frame(None,1,1)
   assert h.call('_Z3getPvj',MON,160)==20
   assert h.call('_Z3getPvj',MON+220,160)==0 and h.call('_Z3getPvj',MON+440,160)==10
   # Check the encrypted stored body and counter sentinels after XP writes.
   raw=bytes(h.u.mem_read(MON,220));payload=bytearray(raw[8:136])
   if not(struct.unpack_from('<H',raw,4)[0]&2):crypt(payload,struct.unpack_from('<H',raw,6)[0])
   assert payload[ORDERS[order][1]*32+27]==30 and payload[ORDERS[order][2]*32+22]==0
   if encrypted:assert sum(struct.unpack('<64H',payload))&65535==struct.unpack_from('<H',raw,6)[0]
   h.call('PaEnd',0x2200000);assert not h.owned
 print(game,'retail PK5 access/writes, HP/status/EXP/nickname, fainted/Egg healing, encrypted checksums and companion counter bytes passed for all 32 block orders and both storage states')

def candy_checks(game):
 rom=ndspy.rom.NintendoDSRom.fromFile(str(WS/'cleanblack.nds'if game=='B'else Path.home()/'Downloads/cleanroms/cleanwhite.nds'))
 h=Harness(game);h.u.mem_write(rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(rom.arm9)))
 item_data=ndspy.narc.NARC(rom.getFileByName('a/0/2/4')).files
 reader=0x2021015 if game=='B'else 0x2021031
 pockets={}
 for item in (50,622):
  data=bytes.fromhex('00000000000000003f020100010000000005000000001c00000000000000000503020000') if item==622 else bytes(item_data[item])
  h.u.mem_write(W+0x5000,data);h.symbols['ItemParameter']=reader
  pockets[item]=h.call('ItemParameter',W+0x5000,5)
 assert pockets=={50:1,622:4},pockets
 pocket_ids=pockets.copy()
 # Instrument only the item archive lookup; the retail pocket selection,
 # subtraction and compaction run against an actual BW1 bag layout.
 def pocket(args):
  assert args[1:3]==[5,23],args
  return pocket_ids[args[0]]
 h.functions[0x2020fe4 if game=='B'else 0x2021000]=pocket
 candy_build=BUILD.parent.parent/'infinite-candy/build'
 elf=BUILD/f'{game}-candy-test.elf'
 wrapper=BUILD/'candy-native.s';wrapper.write_text('.syntax unified\n.thumb\n.global BagSave_SubItem\n.type BagSave_SubItem,%function\n.thumb_func\nBagSave_SubItem:\npush {r3}\nldr r3,1f\nmov ip,r3\npop {r3}\nbx ip\n.balign 4\n1: .word 0x02007f1d\n')
 subprocess.run([str(TOOLS/'arm-none-eabi-as'),'-mthumb','-march=armv5t',str(wrapper),'-o',str(BUILD/'candy-native.o')],check=True)
 subprocess.run([str(TOOLS/'arm-none-eabi-g++'),'-nostdlib','-Wl,-Ttext=0x02350000,-e0x02350001',str(candy_build/f'InfiniteCandy{game}.o'),str(BUILD/'candy-native.o'),'-o',str(elf)],check=True)
 with elf.open('rb')as f:
  e=ELFFile(f)
  for segment in e.iter_segments():
   if segment['p_type']=='PT_LOAD':h.u.mem_write(segment['p_vaddr'],segment.data())
  h.symbols.update({s.name:s['st_value']for s in e.get_section_by_name('.symtab').iter_symbols()})
 h.symbols['Pocket']=0x2007d01
 bag=W+0x7000;h.u.mem_write(bag,bytes(2496));h.put(W+0x28c,REQ);h.put(REQ+4,bag)
 for item,count in [(50,2),(622,1)]:
  h.call('Pocket',bag,pockets[item],W+0x6000,W+0x6004)
  at=h.val(W+0x6000);h.u.mem_write(at,struct.pack('<HH',item,count));pockets[item]=at
 symbol=f'THUMB_BRANCH_91_0x{0x21ba670 if game=="B"else 0x21ba690:x}'
 before=bytes(h.u.mem_read(bag,2496))
 for _ in range(20):h.call(symbol,W,622)
 assert bytes(h.u.mem_read(bag,2496))==before,'Infinite Candy changed bag data'
 h.call(symbol,W,50);assert struct.unpack('<HH',h.u.mem_read(pockets[50],4))==(50,1)
 h.call(symbol,W,50);assert struct.unpack('<HH',h.u.mem_read(pockets[50],4))==(0,0)
 assert struct.unpack('<HH',h.u.mem_read(pockets[622],4))==(622,1)
 print(game,'compiled Infinite Candy retains item 622; retail ordinary Rare Candy subtraction and pocket compaction passed')

if __name__=='__main__':
 main(('B','W'))
 for game in ('B','W'):native_checks(game)
 for game in ('B','W'):candy_checks(game)
