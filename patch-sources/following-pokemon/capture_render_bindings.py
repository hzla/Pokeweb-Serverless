"""Extract renderer scene bindings from supplied melonDS v14 states, without running them."""
import argparse,hashlib,json,struct
from pathlib import Path

def capture(path):
 data=path.read_bytes();assert data[:4]==b'MELN' and struct.unpack_from('<H',data,4)[0]==14
 assert len(data)==struct.unpack_from('<I',data,8)[0]
 sections={};at=16
 while at<len(data):
  size=struct.unpack_from('<I',data,at+4)[0];assert size>=16 and at+size<=len(data)
  sections[data[at:at+4]]=data[at+16:at+size];at+=size
 ram=sections[b'NDSG'][4:0x1000004]
 def read(addr,fmt='I'):return struct.unpack_from('<'+fmt,ram,addr-0x02000000)
 def u(addr):return read(addr)[0]
 at=ram.find(b'FWDG');assert at>=0
 debug=struct.unpack_from('<22I',ram,at);assert debug[1]==2
 field=debug[14];actor=debug[8];player=debug[9];system=u(actor+136);bl=u(u(system+40)+4)
 camera=u(field+0xb4)
 return {'state':path.name,'sha256':hashlib.sha256(data).hexdigest(),'field':field,
  'main':u(field+0xc0),'secondary':u(field+0xc4),'effects':u(field+0xc8),'actorSystemBillboards':bl,
  'cameraProjection':u(camera),'eye':read(camera+32,'3i'),'target':read(camera+56,'3i'),
  'followerWorld':read(actor+68,'3i'),'playerWorld':read(player+68,'3i')}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('states',nargs='+',type=Path);a=p.parse_args()
 print(json.dumps([capture(path) for path in a.states],indent=2))
