"""Build the English BW2 Party toolbar from checked retail call sites."""
import hashlib,json,os,struct,subprocess
from pathlib import Path
import ndspy.rom,ndspy.narc,ndspy.codeCompression
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];WS=REPO.parent;BUILD=HERE/'build';ASSETS=REPO/'src/assets/codeinjection'
TOOLS=WS/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin';JAR=WS/'White2Upgrade/CTRMap.jar';VERSION='0.1.5'
APIS=[0x20056fc,0x203a6d4,0x2006254,0x2008474,0x201cd24,0x201cd48,0x201d5e0,0x201fe24,0x201ff34,0x2021c70,0x2021ca8,0x2039f8c,0x2039fbc,0x203cb14,0x203a228,0x203a278,0x203da74,0x203dab0,0x203df28,0x203df4c,0x2045840,0x2045ba8,0x2047168,0x2048270,0x2048298,0x2048520,0x204855c,0x2048590,0x2048640,0x204aac8,0x204ab38,0x204ab48,0x204bbcc,0x204bcfc,0x204bd3c,0x204be0c,0x204be90,0x204bf48,0x204bfc4,0x204b8e8,0x204b9b8,0x204ba6c,0x204c06c,0x204c134,0x204c150,0x204c54c,0x2070ca8,0x2070ecc]
APIS += [0x2017394,0x20191d8,0x2034c80]
CALLS=[('PaRequest',12,0x215b83a,0x2034c80),('PaInit',165,0x2199a7e,0x2199bc8),('PaEnd',165,0x2199ab0,0x2199de8),('PaTick',165,0x2199bb4,0x2199ed0),('PaIdle',165,0x2199f40,0x219bb48),('PaPrompt',165,0x219b24e,0x219f880),('PaSubtract',165,0x219b440,0x219e688)]
WORDS=[('PaPartyReturn',0x216cbe4,0x215ba0d),('PaEvolutionReturn',0x216ccec,0x215c3e5)]
NATIVE=[0x2199bc8,0x2199de8,0x2199ed0,0x219bb48,0x219b30c,0x219e688,0x219f880,0x219fac4,0x219f290,0x219f008,0x219f350,0x219eefc,0x219f0e0]
def run(*a):subprocess.run([str(v) for v in a],check=True)
def fingerprint(data):
 h=0x811c9dc5
 for b in data:h=((h^b)*0x1000193)&0xffffffff
 return f'{h:08x}'
def bl(b,a):
 x,y=struct.unpack('<HH',b);assert x&0xf800==0xf000 and y&0xf800==0xf800
 n=((x&2047)<<12)|((y&2047)<<1);return a+4+(n-0x800000 if n&0x400000 else n)
def nitro(m,b,p):return m.encode()+struct.pack('<HHIHH',0xfeff,0x100,24+len(p),16,1)+b.encode()+struct.pack('<I',8+len(p))+p
def untile(raw,width):
 h=len(raw)//(width//8*32)*8;out=[[0]*width for _ in range(h)]
 for y in range(h):
  for x in range(width):out[y][x]=raw[((y//8)*(width//8)+x//8)*32+(y%8)*4+x%8//2]>>(x%2*4)&15
 return out
def tile(p):
 out=bytearray()
 for ty in range(4):
  for tx in range(4):
   for y in range(8):
    for x in range(0,8,2):out.append(p[ty*8+y][tx*8+x]|p[ty*8+y][tx*8+x+1]<<4)
 return out
def art(rom):
 items=ndspy.narc.NARC(rom.files[rom.filenames.idOf('a/0/2/5')]);party=ndspy.narc.NARC(rom.files[rom.filenames.idOf('a/0/8/2')])
 candy=untile(items.files[90][48:],32);hp=untile(party.files[2][48:],72);badges=untile(party.files[12][48:1072],32)
 # Collect the exact native HP and status colors. Unused Candy colors later
 # hold HP/XP so the fixed HP underline stays separate from the selector fade.
 hpPal=struct.unpack_from('<16H',party.files[0],40);statusPal=struct.unpack_from('<16H',party.files[11],40);merged=[0]
 def color(index,palette):
  if not index:return 0
  value=palette[index]
  if value not in merged[1:]:merged.append(value)
  return merged.index(value,1)
 banks=[]
 for i in range(8):
  p=[[0]*32 for _ in range(32)]
  if i==0:
   # Nearest-neighbor sampling keeps the native palette and crisp pixel edges.
   for y in range(16):
    for x in range(16):p[y+8][x+8]=candy[y*21//16+2][x*21//16+1]
  else:
   if i in (1,2):
    for y in range(8):
     for x in range(16):p[y+12][x+8]=color(hp[y][x],hpPal)
    if i==2:
     # Preserve the native P and draw the X using the same five-row italic
     # slant, white foreground, gray shading and dark outline.
     for y in range(8):
      for x in range(8):p[y+12][x+8]=0
     glyph=["11011","01110","00100","01110","11011"]
     points={(x+1+(4-y)//2,y+13) for y,row in enumerate(glyph) for x,v in enumerate(row) if v=="1"}
     for x,y in points:
      for dx,dy in [(-1,0),(1,0),(0,-1),(0,1)]:
       if (x+dx,y+dy) not in points:p[y+dy][x+dx+8]=color(4,hpPal)
     for x,y in points:p[y][x+8]=color(1,hpPal)
   else:
    # Retail cells: Pokerus, PAR, FRZ, SLP, PSN, BRN, FNT, Pokerus.
    row=[3,4,5,2,1][i-3]
    for y in range(6):
     for x in range(19):p[y+13][x+7]=color(badges[row*8+y][x+1],statusPal)
  banks.append(bytes(tile(p)))
 assert len(merged)==15,'Native toolbar palette exceeds one bank'
 merged.append(0x7fe0)
 candyPal=list(struct.unpack_from('<16H',items.files[91],40))
 used={v for row in untile(banks[0],32) for v in row if v}
 assert not used.intersection({9,15}), 'Candy uses reserved highlight colors'
 candyPal[9]=candyPal[15]=0x7fe0
 free=[i for i in range(1,16) if i not in used and i not in (9,15)]
 remap={}
 for i in (1,2):
  p=untile(banks[i],32)
  for row in p:
   for x,v in enumerate(row):
    if not v:continue
    color=merged[v]
    if color not in remap:
     same=next((n for n in used if candyPal[n]==color),None)
     if same is None:
      assert free, 'Native HP palette exceeds Candy spare colors'
      same=free.pop(0);candyPal[same]=color;used.add(same)
     remap[color]=same
    row[x]=remap[color]
  banks[i]=bytes(tile(p))
 # Resolve Full Restore's retail item icon mapping in each game and preserve
 # every sampled native color. Fit its occupied bounds into 16x16, with aspect
 # ratio and nearest-neighbor pixels intact.
 a=ndspy.codeCompression.decompress(rom.arm9);table=0x2090d7c-(44 if rom.idCode==b'IREO' else 0)-rom.arm9RamAddress
 restoreChar,restorePalette=struct.unpack_from('<HH',a,table+23*4)
 assert (restoreChar,restorePalette)==(33,34)
 restore=untile(items.files[restoreChar][48:],32);points=[(x,y)for y,row in enumerate(restore)for x,v in enumerate(row)if v]
 xmin,xmax=min(x for x,y in points),max(x for x,y in points);ymin,ymax=min(y for x,y in points),max(y for x,y in points)
 width,height=xmax-xmin+1,ymax-ymin+1;scale=max(width,height);w,h=max(1,(width*16+scale//2)//scale),max(1,(height*16+scale//2)//scale)
 p=[[0]*32 for _ in range(32)]
 for y in range(h):
  for x in range(w):p[y+(32-h)//2][x+(32-w)//2]=restore[ymin+min(height-1,(2*y+1)*height//(2*h))][xmin+min(width-1,(2*x+1)*width//(2*w))]
 restorePal=list(struct.unpack_from('<16H',items.files[restorePalette],40));assert all(v!=15 for row in p for v in row)
 restorePal[15]=0x7fe0;banks.append(bytes(tile(p)))
 pal=struct.pack('<48H',*restorePal,*candyPal,*merged);pal=struct.pack('<IIII',3,0,len(pal),16)+pal
 # Nine 32px cells and three palette banks. One character handle per actor.
 count=len(banks);cellData=24+count*16;frameData=cellData+count*8
 cells=bytearray(cellData+count*8);struct.pack_into('<HHI',cells,0,count,1,24)
 anim=bytearray(frameData+count*4);struct.pack_into('<HHIII',anim,0,count,count,24,cellData,frameData)
 for i in range(count):
  struct.pack_into('<HHI4H',cells,24+i*16,1,0x0808,i*8,15,15,65520,65520)
  struct.pack_into('<3H',cells,cellData+i*8,240,0x81f0,(0 if i==8 else 1 if i<3 else 2)<<12)
  struct.pack_into('<HHIII',anim,24+i*16,1,0,0x10000,1,i*8)
  struct.pack_into('<IHH',anim,cellData+i*8,i*4,1,0);struct.pack_into('<H',anim,frameData+i*4,i)
 return [nitro('RLCN','TTLP',pal),nitro('RECN','KBEC',cells),nitro('RNAN','KNBA',anim),*banks]
def main():
 BUILD.mkdir(exist_ok=True);m={'version':VERSION,'archivePath':'party-tools/ui.narc','games':{}}
 (BUILD/'profiles.generated.h').write_text('#pragma once\ninline u32 nativeAddress(u32 a){\n#ifdef GAME_B2\nreturn a==0x214197c?0x214193c:a>=0x20191d8?a-44:a;\n#else\nreturn a;\n#endif\n}\ninline u32 overlayAddress(u32 a){\n#ifdef GAME_B2\nreturn a-64;\n#else\nreturn a;\n#endif\n}\n')
 for game,name,delta in [('W2','cleanwhite2.nds',0),('B2','cleanblack2.nds',64)]:
  r=ndspy.rom.NintendoDSRom.fromFile(WS/name);assert r.idCode==(b'IRDO' if game=='W2' else b'IREO') and r.version==0
  o=r.loadArm9Overlays([12,165]);a=ndspy.codeCompression.decompress(r.arm9);sig=[];asm=['.syntax unified','.thumb']
  def check(label,mod,addr,n,patch=0):
   base=r.arm9RamAddress if mod=='ARM9' else o[mod].ramAddress;data=a if mod=='ARM9' else o[mod].data;b=bytes(data[addr-base:addr-base+n]);assert len(b)==n
   sig.append({'label':label,'module':str(mod),'address':addr,'expectedHex':b.hex(),'patchSize':patch});return b
  for label,mod,addr,target in CALLS:
   addr-=delta;assert bl(check(label,mod,addr,4,4),addr)==target-(delta if target>=0x2150000 else 44 if game=='B2' and target>=0x20191d8 else 0),(game,label)
   sym=f'THUMB_BRANCH_LINK_{mod}_0x{addr:x}'
   asm+=['.balign 4',f'.global {sym}',f'.type {sym},%function','.thumb_func',sym+':','push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4',f'1: .word {label}',f'.size {sym},.-{sym}']
  for label,addr,target in WORDS:
   addr-=delta;assert struct.unpack('<I',check(label,12,addr,4,4))[0]==target-delta
   sym=f'FULL_COPY_12_0x{addr:x}';asm+=['.balign 4',f'.global {sym}',f'.type {sym},%object',sym+':',f'.word {label}',f'.size {sym},4']
  for addr in APIS:check('Native API','ARM9',addr-(44 if game=='B2' and addr>=0x20191d8 else 0),8)
  check('Native palette replacement','ARM9',0x204bd3c-(44 if game=='B2' else 0),0x8c)
  check('Native nickname accessor','ARM9',0x201cd24-(44 if game=='B2' else 0),0x24)
  check('Native nickname field dispatch','ARM9',0x201e02e-(44 if game=='B2' else 0),2)
  check('Native nickname copy','ARM9',0x201e2a6-(44 if game=='B2' else 0),0x24)
  check('Native party selector fade',165,0x219a114-delta,0x240)
  check('Native selector dim colors',165,0x21a4b8c-delta,6)
  check('Native selector bright colors',165,0x21a4b94-delta,6)
  assert struct.unpack('<I',check('Native party navigation sound',165,0x219cbb0-delta,4))[0]==1352
  assert struct.unpack('<I',check('Native potion recovery sound',165,0x219b76c-delta,4))[0]==1391
  assert struct.unpack('<HH',check('Native Full Restore icon mapping','ARM9',0x2090d7c-(44 if game=='B2' else 0)+23*4,4))==(33,34)
  check('Native palette proxy layout','ARM9',0x2060ba8-(44 if game=='B2' else 0),0x20)
  check('Native field party request GameData',12,0x215b818-delta,0x2a)
  check('Native saved flag reader','ARM9',0x20191d8-(44 if game=='B2' else 0),0x2c)
  check('Native saved flag bounds','ARM9',0x2019278-(44 if game=='B2' else 0),0x48)
  check('Native party HP/status reconstruction',165,0x219f290-delta,0xe0)
  check('Native next-level EXP','ARM9',0x201d5e0-(44 if game=='B2' else 0),20)
  check('Native confirmation printer','ARM9',0x2021ca8-(44 if game=='B2' else 0),48)
  check('Native bag ownership','ARM9',0x20082e8,0x20)
  for addr in NATIVE:check('Party ABI',165,addr-delta,12)
  for label,lo,n in [('Party request and item route',0x219b30c,0x140),('Rare Candy continuation',0x21a0484,0x88),('Party input layout',0x219c8bc,0x340),('Native bottom-bar actors',0x219a68c,0x154),('HP and status redraw',0x219eefc,0x180)]:check(label,165,lo-delta,n)
  # Resources are separately compared across games, not inferred from offsets.
  graphics=art(r)
  if game=='W2':
   arc=ndspy.narc.NARC();arc.files=[struct.pack('<6I',0x51415050,2,24,1,0,0x51415050^1),*graphics];archive=bytes(arc.save());(ASSETS/'partyQuickActions.narc').write_bytes(archive);m['archiveSha256']=hashlib.sha256(archive).hexdigest();m['graphicsFingerprints']=[fingerprint(b) for b in graphics]
  else:assert graphics==art(ndspy.rom.NintendoDSRom.fromFile(WS/'cleanwhite2.nds'))
  stem=f'PartyQuickActions{game}';s=BUILD/f'{stem}.s';s.write_text('\n'.join(asm)+'\n')
  run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror','-fno-jump-tables','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin',f'-DGAME_{game}','-I',BUILD,'-c',HERE/'party_tools.cpp','-o',BUILD/f'{stem}.o')
  run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',s,'-o',BUILD/f'{stem}Hooks.o');elf=BUILD/f'{stem}.elf'
  run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',BUILD/f'{stem}.o',BUILD/f'{stem}Hooks.o','-o',elf)
  assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
  meta=BUILD/'metadata.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n');esdb=BUILD/'symbols.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
  dll=ASSETS/f'{stem}.dll';run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
  blob=dll.read_bytes();h=struct.unpack_from('<I',blob,8)[0];info=h+struct.unpack_from('<I',blob,h+8)[0];start,size=struct.unpack_from('<II',blob,info+16);f=0x811c9dc5
  for b in blob[start:start+size]:f=((f^b)*0x1000193)&0xffffffff
  m['games'][game]={'idCode':r.idCode.decode(),'fileName':dll.name,'sha256':hashlib.sha256(blob).hexdigest(),'codeFingerprint':f'{f:08x}','bssSize':struct.unpack_from('<I',blob,h+12)[0],'signatures':sig};print(stem,len(blob))
 (ASSETS/'partyQuickActionsManifest.json').write_text(json.dumps(m,indent=2)+'\n')
if __name__=='__main__':main()
