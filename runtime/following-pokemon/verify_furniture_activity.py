"""Read a captured furniture event and run only its native activity recorder.

This is isolated CPU execution against private RAM copies, not a game frame.
The supplied interaction snapshot already contains the old recall, so retained
follower/event lifecycle acceptance is checked separately by verify_scenes.py.
"""
import argparse,hashlib,json,struct
from pathlib import Path
from inspect_state import desmume_ram
from verify_packaged import *

def verify(path):
 raw=path.read_bytes();ram=desmume_ram(raw);base=0x02000000;stop=0x02efff00;stack=0x02ef8000
 pos=ram.find(b'FWSE');assert pos>=0
 # The ring records the unsupported opcode before the later End command.
 write=struct.unpack_from('<I',ram,pos+40)[0];entries=[struct.unpack_from('<6I',ram,pos+48+(i&31)*24) for i in range(max(0,write-32),write)]
 assert any(entry[3:6]==(3,0x2c5,1) for entry in entries),entries
 policy=json.loads((HERE/'event-policy.json').read_text());entry=next(e for e in policy['commands'] if e['opcode']==0x2c5)
 assert ram[0x021c7874-base:0x021c7882-base]==bytes.fromhex(entry['expectedHex'])
 command_case=[]
 global_pointer=struct.unpack_from('<I',ram,0x02038e7c-base)[0]
 occupants=struct.unpack_from('<I',ram,global_pointer+4-base)[0]
 # Captured native person data: six byte-sized recent IDs and six u16 dates.
 # All other captured RAM, including actors and the event chain, is protected.
 recent_start=occupants+0x7f0
 for activity in (1,11,31):
  cpu=Uc(UC_ARCH_ARM,UC_MODE_THUMB);cpu.ctl_set_cpu_model(UC_CPU_ARM_946);cpu.mem_map(base,0x1000000);cpu.mem_write(base,ram)
  vm=0x02ef0000;program=vm+0x100
  cpu.mem_write(vm+32,struct.pack('<I',program));cpu.mem_write(program,struct.pack('<H',activity))
  cpu.reg_write(UC_ARM_REG_SP,stack);cpu.reg_write(UC_ARM_REG_LR,stop|1);cpu.reg_write(UC_ARM_REG_R0,vm)
  cpu.emu_start(0x021c7875,stop,count=500000)
  assert cpu.reg_read(UC_ARM_REG_PC)==stop and cpu.reg_read(UC_ARM_REG_R0)==0
  assert struct.unpack('<I',cpu.mem_read(vm+32,4))[0]==program+2
  after=bytes(cpu.mem_read(base,len(ram)))
  changed=[i+base for i,(old,new) in enumerate(zip(ram,after)) if old!=new]
  assert all(recent_start<=address<recent_start+18 for address in changed),changed
  assert after[recent_start-base]==activity
  command_case.append({'activity':activity,'changedRecentBytes':len(changed)})
 assert path.read_bytes()==raw
 return {'state':path.name,'stateSha256':hashlib.sha256(raw).hexdigest(),'oldRecallOpcode':'0x2c5','nativeCommandOperandsChecked':command_case,'writesOnlyRecentActivityBytes':True,'nativeHandlerAndRecorderExecuted':True,'gameEmulatorRun':False}

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('state',type=Path);p.add_argument('--report',type=Path);a=p.parse_args()
 output=json.dumps(verify(a.state),indent=2)+'\n'
 if a.report:a.report.write_text(output)
 print(output)
