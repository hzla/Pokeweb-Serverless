"""Read a melonDS v14 or DeSmuME v12 snapshot without changing it."""
import argparse,hashlib,json,struct,zlib
from pathlib import Path
from verify_packaged import read_module

def desmume_ram(data):
 if data[:16]!=b'DeSmuME SState\0\0' or struct.unpack_from('<I',data,16)[0]!=12:
  raise ValueError('Expected inspected DeSmuME v12 state format')
 payload=data[32:] if struct.unpack_from('<I',data,28)[0]==0xffffffff else zlib.decompress(data[32:])
 chunks={};at=0
 while at+4<=len(payload):
  kind=struct.unpack_from('<I',payload,at)[0];at+=4
  if kind==0xffffffff:break
  if at+4>len(payload):raise ValueError('Truncated DeSmuME chunk')
  length=struct.unpack_from('<I',payload,at)[0];at+=4
  if at+length>len(payload):raise ValueError('Truncated DeSmuME chunk data')
  chunks[kind]=payload[at:at+length];at+=length
 if 4 not in chunks:raise ValueError('DeSmuME state has no memory chunk')
 records={};at=0;memory=chunks[4]
 while at+12<=len(memory):
  tag,size,count=struct.unpack_from('<4sII',memory,at);at+=12;length=size*count
  if at+length>len(memory):raise ValueError('Truncated DeSmuME memory record')
  records[tag]=memory[at:at+length];at+=length
 if b'WRAM' not in records or len(records[b'WRAM'])!=0x400000:
  raise ValueError('DeSmuME state has no 4 MiB ARM9 WRAM image')
 return records[b'WRAM']

def diagnostics(ram):
 result={}
 for signature,count in [(b'FWDG',22),(b'FWFX',8),(b'FWRD',20),(b'FWCG',6),(b'FWSH',7)]:
  pos=ram.find(signature)
  if pos>=0:
   version=struct.unpack_from('<I',ram,pos+4)[0]
   if signature==b'FWDG' and version==1:count=15
   if version in (1,2):
    result[signature.decode()]={'address':hex(pos+0x2000000),'values':struct.unpack_from('<'+str(count)+'I',ram,pos)}
 pos=ram.find(b'FWSE')
 if pos>=0 and pos+48+32*24<=len(ram):
  header=struct.unpack_from('<12I',ram,pos)
  write=header[10];entries=[]
  first=max(0,write-32)
  for serial in range(first,write):
   index=serial&31;entry=struct.unpack_from('<6I',ram,pos+48+index*24)
   entries.append({'serial':serial,'generation':entry[0],'event':hex(entry[1]),'subject':hex(entry[2]),
                   'kind':entry[3],'value':hex(entry[4]),'reason':entry[5]})
  result['FWSE']={'address':hex(pos+0x2000000),'abi':header[1],'generation':header[2],
   'disposition':header[3],'reason':header[4],'lastOpcode':hex(header[5]),'lastAction':hex(header[6]),
   'event':hex(header[7]),'vm':hex(header[8]),'origin':hex(header[9]),'write':write,
   'script':hex(header[11]),'entries':entries}
 return result

def inspect(path,module):
 data=Path(path).read_bytes()
 if data[:16]==b'DeSmuME SState\0\0':
  ram=desmume_ram(data);regs=cpsr=None
  report={'stateSha256':hashlib.sha256(data).hexdigest(),'format':'DeSmuME v12','diagnostics':diagnostics(ram)}
 else:
  if data[:4]!=b'MELN' or struct.unpack_from('<H',data,4)[0]!=14:
   raise ValueError('Expected inspected melonDS v14 or DeSmuME v12 state format')
  if struct.unpack_from('<I',data,8)[0]!=len(data):raise ValueError('Truncated state')
  sections={};at=16
  while at<len(data):
   length=struct.unpack_from('<I',data,at+4)[0]
   if length<16 or at+length>len(data):raise ValueError('Invalid section')
   sections[data[at:at+4]]=data[at+16:at+length];at+=length
  arm=sections[b'ARM9'];ram=sections[b'NDSG'][4:0x1000004]
  regs=struct.unpack_from('<16I',arm,8);cpsr=struct.unpack_from('<I',arm,72)[0]
  report={'stateSha256':hashlib.sha256(data).hexdigest(),'format':'melonDS v14',
          'arm9':{'pc':hex(regs[15]),'lr':hex(regs[14]),'cpsr':hex(cpsr),'mode':cpsr&31},
          'diagnostics':diagnostics(ram)}
 if cpsr is not None and cpsr&31==0x1b:
  start=regs[14]-4;offset=start-0x2000000
  if 0<=offset<len(ram)-4:
   high,low=struct.unpack_from('<HH',ram,offset)
   invalid=high&0xf800==0xf000 and low&0xf801==0xe801
   report['undefinedCall']={'address':hex(start),'halfwords':[hex(high),hex(low)],'reservedBlxBitSet':invalid}
   if module:
    code,*_=read_module(module);where=ram.find(code[:32])
    if where>=0:
     relative=offset-where
     report['moduleComparison']={'candidateSha256':hashlib.sha256(Path(module).read_bytes()).hexdigest(),'codeAddress':hex(where+0x2000000),'callOffset':hex(relative),'callBytesMatch':bytes(code[relative:relative+4])==ram[offset:offset+4]}
 return report

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('state',type=Path);parser.add_argument('--module',type=Path);parser.add_argument('--report',type=Path)
 args=parser.parse_args();result=json.dumps(inspect(args.state,args.module),indent=2)+'\n'
 if args.report:args.report.write_text(result)
 print(result)
