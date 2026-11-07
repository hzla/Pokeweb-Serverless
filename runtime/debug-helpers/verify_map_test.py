"""Execute the test-only collision adapters against all four checked US games."""
import argparse,json,struct,sys
from pathlib import Path
import ndspy.rom
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB
from unicorn.arm_const import UC_CPU_ARM_946,UC_ARM_REG_R0,UC_ARM_REG_R4,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'battle-type-hud'))
from rpm_read import thumb_bl
parser=argparse.ArgumentParser()
for version in ('W2','B2','B','W'):parser.add_argument('--'+version.lower(),required=True)
args=parser.parse_args();bindings=json.loads((HERE/'map-test-bindings.json').read_text())
CODE=bytes.fromhex('002006b0f8bd00bf002038bd');BASE=0x02370020;STACK=0x023f8000;STOP=0x023ff000
for version,p in bindings.items():
 rom=ndspy.rom.NintendoDSRom.fromFile(getattr(args,version.lower()));assert rom.idCode.decode()==p['idCode'] and rom.version==0
 overlay=rom.loadArm9Overlays([p['fieldOverlay']])[p['fieldOverlay']]
 for s in p['signatures']:assert bytes(overlay.data[s['address']-overlay.ramAddress:s['address']-overlay.ramAddress+len(s['hex'])//2]).hex()==s['hex']
 for site,local,saved,stub in [(p['collisionReturn'],24,[3,4,5,6,7,STOP|1],0),(p['railCollisionReturn'],0,[3,4,5,STOP|1],8)]:
  for patched in (False,True):
   for mask in (0,1,2,0x100,0xffff):
    uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000);uc.mem_write(overlay.ramAddress,bytes(overlay.data));uc.mem_write(BASE,CODE)
    if patched:uc.mem_write(site,thumb_bl(site,BASE+stub))
    uc.mem_write(STACK+local,struct.pack('<'+'I'*len(saved),*saved));uc.reg_write(UC_ARM_REG_R4,mask);uc.reg_write(UC_ARM_REG_SP,STACK);uc.reg_write(UC_ARM_REG_LR,STOP|1)
    uc.emu_start(site|1,STOP,count=100);assert uc.reg_read(UC_ARM_REG_PC)==STOP
    assert uc.reg_read(UC_ARM_REG_R0)==(0 if patched else mask)
    assert uc.reg_read(UC_ARM_REG_R4)==4 and uc.reg_read(UC_ARM_REG_SP)==STACK+local+4*len(saved)
 print(json.dumps({'game':version,'nativeSignatures':True,'normalAndRailCollisionBypass':True,'calleeSavedRegisters':True,'stackRestored':True}))
