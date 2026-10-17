"""Cross-check bounded session text decoding against ROM banks and malformed data."""
from pathlib import Path
import ctypes,struct,subprocess,sys
import ndspy.rom,ndspy.narc
HERE=Path(__file__).resolve().parent;BUILD=HERE/'build';BUILD.mkdir(exist_ok=True)
sys.path.insert(0,str(HERE.parent/'learnset-viewer'))
from verify_info import decode_bank
source=BUILD/'cached-text.cpp';library=BUILD/'cached-text.dylib'
source.write_text('#include "'+str(HERE/'text.h')+'"\nextern "C" bool decode(const uint8_t* p,uint32_t n,uint32_t i,uint16_t* out,uint32_t cap){return pokenav::cachedText(p,n,i,out,cap);}\n')
subprocess.run(['c++','-std=c++17','-O2','-dynamiclib',str(source),'-o',str(library)],check=True)
fn=ctypes.CDLL(str(library)).decode;fn.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32];fn.restype=ctypes.c_bool
count=0
for game in ('white2','black2'):
 r=ndspy.rom.NintendoDSRom.fromFile(HERE.parents[2]/('clean'+game+'.nds'));files=ndspy.narc.NARC(r.getFileByName('a/0/0/2')).files
 for bank in (90,64,403,487,374,401):
  data=bytes(files[bank])
  for i,expected in enumerate(decode_bank(data)):
   out=(ctypes.c_uint16*1024)();assert fn(data,len(data),i,out,1024)
   values=list(out);actual=''.join(chr(v) for v in values[:values.index(65535)]);assert actual==expected,(game,bank,i,actual,expected);count+=1

def bank(values,compressed=False):
 if compressed:
  words=[0xf100];bits=acc=0
  for v in values+[511]:
   acc|=v<<bits;bits+=9
   while bits>=16:words.append(acc&65535);acc>>=16;bits-=16
  if bits:words.append(acc)
  words.append(65535)
 else:words=values+[65535]
 key=0x1234;encoded=[]
 for v in words:encoded.append(v^key);key=((key<<3)|(key>>13))&65535
 block=struct.pack('<IIHH',12+len(encoded)*2,12,len(encoded),0)+struct.pack('<'+'H'*len(encoded),*encoded)
 return struct.pack('<HHIII',1,1,len(block),0,16)+block
for compressed in (False,True):
 data=bank([65,233,66,37],compressed)
 for cap in (1,3,16):
  out=(ctypes.c_uint16*17)(*([0xbeef]*17));assert fn(data,len(data),0,out,cap)
  expected=[65,233,66,37][:cap-1]+[65535];assert list(out)[:len(expected)]==expected
  assert out[cap]==0xbeef
for data in (b'',bytes(15),bytes(32),struct.pack('<HHIII',2,1,16,0,16),bank([65])[:20]):
 out=(ctypes.c_uint16*16)();assert not fn(data,len(data),0,out,16)
print(count,'ROM text entries matched; UTF-16, compressed text, truncation, canaries, malformed bounds and multi-block fallback passed')
