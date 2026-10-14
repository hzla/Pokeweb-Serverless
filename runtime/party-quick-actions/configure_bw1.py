"""Pin US revision-0 BW1 toolbar adapters; acceptance is tracked separately."""
import hashlib,json,os,re,struct
from pathlib import Path
import ndspy.rom,ndspy.codeCompression,ndspy.narc
from capstone import Cs,CS_ARCH_ARM,CS_MODE_THUMB
from build import HERE,BUILD,WS

# W2 semantic references -> independently recorded Black / White retail entries.
# A clear low bit is an ARM entry, not an address that may be Thumbified.
BINDINGS={
 0x20056fc:(0x20056a1,0x20056a1),0x203a6d4:(0x2030eac,0x2030ec4),
 0x2006254:(0x20061e5,0x20061e5),0x2008474:(0x2007f69,0x2007f69),
 0x201cd24:(0x2017e1d,0x2017e39),0x201cd48:(0x2017e41,0x2017e5d),
 0x201d5e0:(0x2018585,0x20185a1),0x201fe24:(0x201aa19,0x201aa35),
 0x201ff34:(0x201ab29,0x201ab45),0x2021c70:(0x201c6ed,0x201c709),
 0x2021ca8:(0x201c725,0x201c741),0x2039f8c:(0x2030344,0x203035c),
 0x2039fbc:(0x203038c,0x20303a4),0x203cb14:(0x2034640,0x2034658),
 0x203a228:(0x2030734,0x203074c),0x203a278:(0x20307b0,0x20307c8),
 0x203dab0:(0x2035d20,0x2035d38),0x203df28:(0x20362dc,0x20362f4),
 0x203df4c:(0x203630c,0x2036324),0x2045840:(0x204162c,0x2041644),
 0x2045ba8:(0x2041b6c,0x2041b84),0x2048520:(0x2045770,0x2045788),
 0x204855c:(0x20457b0,0x20457c8),0x2048590:(0x2045808,0x2045820),
 0x2048640:(0x2045924,0x204593c),0x204aac8:(0x204919c,0x20491b4),
 0x204ab38:(0x2049238,0x2049250),0x204ab48:(0x2049250,0x2049268),
 0x204bbcc:(0x204abf0,0x204ac08),0x204bcfc:(0x204ada4,0x204adbc),
 0x204bd3c:(0x204adec,0x204ae04),0x204be0c:(0x204af28,0x204af40),
 0x204be90:(0x204afd8,0x204aff0),0x204bf48:(0x204b100,0x204b118),
 0x204bfc4:(0x204b1cc,0x204b1e4),0x204b8e8:(0x204a7a0,0x204a7b8),
 0x204b9b8:(0x204a8d4,0x204a8ec),0x204ba6c:(0x204a9d0,0x204a9e8),
 0x204c06c:(0x204b294,0x204b2ac),0x204c134:(0x204b3b4,0x204b3cc),
 0x204c150:(0x204b3dc,0x204b3f4),0x204c54c:(0x204b92c,0x204b944),
 0x2070ca8:(0x20788ac,0x20788c4),0x2070ecc:(0x2078c18,0x2078c30),
 0x2017394:(0x201296d,0x201296d),0x20191d8:(0x20142e9,0x2014305),
 0x204c16c:(0x204b404,0x204b41c),0x20120f4:(0x20120f5,0x20120f5),
}
OVERLAY_BINDINGS={
 0x2199bc8:(0x21b660d,0x21b662d),0x2199de8:(0x21b6819,0x21b6839),
 0x2199ed0:(0x21b68f1,0x21b6911),0x219bb48:(0x21b8a8d,0x21b8aad),
 0x219b30c:(0x21b7cc5,0x21b7ce5),0x219e688:(0x21ba671,0x21ba691),
 0x219f880:(0x21bb7e9,0x21bb809),0x219fac4:(0x21bba29,0x21bba49),
 0x219f290:(0x21bb201,0x21bb221),0x219f008:(0x21bafa1,0x21bafc1),
 0x219f350:(0x21bb2c1,0x21bb2e1),0x219f0e0:(0x21bb051,0x21bb071),
 0x215b818:(0x2160a95,0x2160ab5),0x215ba0c:(0x2160c89,0x2160ca9),
 0x215c3e4:(0x2161611,0x2161631),
}
LAYOUT={'Request':0x280,'Slot':0x2c,'Pokemon':0x38,'Message':0x138,
 'Prompt':0x150,'Plates':0x160,'CancelFirst':0x1e4,'CancelLast':0x1e4,
 'Mode':0x34,'Selected':0x3c,'Result':0x40,'Item':0x44,'SelectorColor':0xa8,
 'MaxSaveFlag':2911,'DecideSound':1356,'MoveSound':1352,'RecoverySound':1391,
 'CompressedPaletteHandle':0x190,'CompressedPaletteStart':192,'CompressedPaletteSize':96}
CALLS={
 'B':[('PaInit',91,0x21b6502,0x21b660d),('PaEnd',91,0x21b653e,0x21b6819),
      ('PaTick',91,0x21b65f8,0x21b68f1),('PaIdle',91,0x21b83f4,0x21b8a8d),
      ('PaPrompt',91,0x21b7c06,0x21bb7e9),('PaSubtract',91,0x21b7de8,0x21ba671)],
 'W':[('PaInit',91,0x21b6522,0x21b662d),('PaEnd',91,0x21b655e,0x21b6839),
      ('PaTick',91,0x21b6618,0x21b6911),('PaIdle',91,0x21b8414,0x21b8aad),
      ('PaPrompt',91,0x21b7c26,0x21bb809),('PaSubtract',91,0x21b7e08,0x21ba691)]}
WORDS={
 'B':[('PaRequest',10,0x21712d4,0x2160a95),('PaPartyReturn',10,0x21712d8,0x2160c89),('PaEvolutionReturn',10,0x21713c8,0x2161611)],
 'W':[('PaRequest',10,0x21712f4,0x2160ab5),('PaPartyReturn',10,0x21712f8,0x2160ca9),('PaEvolutionReturn',10,0x21713e8,0x2161631)]}
PINS={
 'B':{'ARM9':'f9cb027e4de3b4388c2ac02ae7e22aee8bf9bd25e9e7325bdf3265fec0370e92','10':'003fdef42c2584b5448ff223360bf2fecb1a2bf6d36ed63a429fd1033779fda7','91':'813d39b2dd3fb1fd972f496a686201182d823e32e6a38c2d1452752b72f82f17'},
 'W':{'ARM9':'2d36e7e501fee340e6af419492fb6e0648b8d75e872c718b450c2526dd1a681e','10':'232353df8f9865a141bd81a254526d503b1e27e27cdea13460353e279bc01b51','91':'687ee398636c612b1fbdaeb891af3810ce4e46838e56d7803ed3af63c6ef6b80'}}
SYSTEM={'B':0x2146a74,'W':0x2146a94}
ICONS={'B':0x209eb6c,'W':0x209eb84}

def configure(game):
 path=os.environ.get(f'PARTY_TOOLS_{game}_ROM',WS/'cleanblack.nds'if game=='B'else Path.home()/'Downloads/cleanroms/cleanwhite.nds')
 r=ndspy.rom.NintendoDSRom.fromFile(str(path));assert r.idCode==(b'IRBO'if game=='B'else b'IRAO')and r.version==0
 seg={'ARM9':(r.arm9RamAddress,ndspy.codeCompression.decompress(r.arm9)),**{str(n):(o.ramAddress,bytes(o.data))for n,o in r.loadArm9Overlays([10,91]).items()}}
 for name,(base,data)in seg.items():assert hashlib.sha256(data).hexdigest()==PINS[game][name],(game,name)
 index=0 if game=='B'else 1;signatures=[]
 def pin(label,module,address,length,patch=0,kind=None):
  base,data=seg[str(module)];offset=address-base;assert offset>=0 and offset+length<=len(data)
  row={'label':label,'module':str(module),'address':address,'expectedHex':data[offset:offset+length].hex(),'patchSize':patch}
  if kind:row['patchType']=kind
  signatures.append(row);return data[offset:offset+length]
 apis=[]
 for group in [BINDINGS,OVERLAY_BINDINGS]:
  for ref,pair in group.items():
   entry=pair[index];module='ARM9'if group is BINDINGS else 10 if ref<0x2190000 else 91
   raw=pin('Native API','ARM9'if group is BINDINGS else module,entry&~1,32)
   apis.append({'reference':hex(ref),'entry':entry,'mode':'Thumb'if entry&1 else 'ARM','module':str(module),'expectedHex':raw.hex()})
 # Compare all call targets rather than assuming a White offset.
 md=Cs(CS_ARCH_ARM,CS_MODE_THUMB)
 for label,module,address,target in CALLS[game]:
  raw=pin(label,module,address,4,4,'THUMB_BRANCH_LINK');ins=next(md.disasm(raw,address))
  assert ins.mnemonic=='bl'and int(ins.op_str[1:],0)==(target&~1),(game,label)
 for label,module,address,target in WORDS[game]:assert struct.unpack('<I',pin(label,module,address,4,4,'FULL_COPY'))[0]==target
 pin('Saved flag bounds','ARM9',0x2014388 if game=='B'else 0x20143a4,0x40)
 # Retail rejects flag-byte index >=364; saved flags begin at EventWork+0x27c.
 assert pin('Saved flag range','ARM9',0x2014398 if game=='B'else 0x20143b4,20)==bytes.fromhex('ca085b2189008a4201db002070479f2189004018')
 pin('Native Party request layout',91,CALLS[game][0][3]&~1,0x210)
 pin('Native field request owner',10,WORDS[game][0][3]&~1,0x1f4)
 pin('Native selector fade',91,0x21b6b24 if game=='B'else 0x21b6b44,0x240)
 pin('Native glyph and palette allocation',91,0x21b7298 if game=='B'else 0x21b72b8,0x390)
 pin('Compressed palette registration flag-only size field','ARM9',0x204dee8 if game=='B'else 0x204df00,0x128)
 pin('Native medicine continuation',91,0x21b7cc4 if game=='B'else 0x21b7ce4,0x4b8)
 pin('Native selector sound',91,0x21b8da4 if game=='B'else 0x21b8dc4,4)
 assert struct.unpack('<I',signatures[-1]and bytes.fromhex(signatures[-1]['expectedHex']))[0]==LAYOUT['MoveSound']
 assert struct.unpack('<I',pin('Sprite system pointer','ARM9',0x204afd4 if game=='B'else 0x204afec,4))[0]==SYSTEM[game]
 pin('Native item icon table','ARM9',ICONS[game]+23*4,4)
 assert struct.unpack('<HH',bytes.fromhex(signatures[-1]['expectedHex']))==(33,34)
 resources=[]
 for path,members in [('a/0/7/6',[0,6,7,10,12,13,21,24]),('a/0/8/3',[0,2,4,11,12]),('a/0/2/5',[33,34,90,91,827,828])]:
  arc=ndspy.narc.NARC(r.getFileByName(path));resources.extend({'path':path,'member':n,'sha256':hashlib.sha256(arc.files[n]).hexdigest()}for n in members)
 return r,{'idCode':r.idCode.decode(),'revision':0,'dsAccepted':False,'signatures':signatures,'apis':apis,'layout':LAYOUT,'resources':resources,'segments':PINS[game]}

def header():
 text=['#pragma once','inline u32 nativeEntry(u32 a){switch(a){']
 for ref,(black,white)in BINDINGS.items():text.extend([f'case 0x{ref:x}:','#ifdef GAME_B',f'return 0x{black:x};','#else',f'return 0x{white:x};','#endif'])
 text+=['default:return 0;}}','inline u32 overlayEntry(u32 a){switch(a){']
 for ref,(black,white)in OVERLAY_BINDINGS.items():text.extend([f'case 0x{ref:x}:','#ifdef GAME_B',f'return 0x{black:x};','#else',f'return 0x{white:x};','#endif'])
 text+=['default:return 0;}}','inline u32 nativeAddress(u32 a){if(a!=0x214197c)return nativeEntry(a)&~1;','#ifdef GAME_B',f'return 0x{SYSTEM["B"]:x};','#else',f'return 0x{SYSTEM["W"]:x};','#endif','}','namespace Profile{']
 text.extend(f'constexpr u32 {key}=0x{value:x};'for key,value in LAYOUT.items())
 text+=['constexpr u32 StatusMasks[5]={3,8,16,32,64};',
  'constexpr bool matchesStatus(u32 state,u32 index){return state&(index==0?7:index==1?136:StatusMasks[index]);}',
  'constexpr bool hideSelectionFrame(u32 state){return state<=2||state>=19;}','}']
 return '\n'.join(text)+'\n'

if __name__=='__main__':
 BUILD.mkdir(exist_ok=True);(BUILD/'adapter_bw1.generated.h').write_text(header())
 for game in ('B','W'):
  r,p=configure(game);(HERE/f'profile-{game}.json').write_text(json.dumps(p,indent=2)+'\n');print(game,len(p['apis']),'bindings pinned; acceptance pending')
