"""Build the standalone Thumb environment adapter and its internal relocations."""
import hashlib,json,os,re,shutil,subprocess
from pathlib import Path
here=Path(__file__).resolve().parent
out=here/'build';out.mkdir(exist_ok=True)
tool=os.environ.get('ARM_TOOLCHAIN_BIN','')
def exe(name):return str(Path(tool)/name) if tool else shutil.which(name)
def run(*args):return subprocess.check_output([str(a) for a in args],text=True)
run(exe('arm-none-eabi-gcc'),'-mthumb','-mcpu=arm946e-s','-Os','-std=c11','-ffreestanding','-fno-builtin','-fno-jump-tables','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-Wall','-Wextra','-Werror','-c',here/'environment.c','-o',out/'environment.o')

run(exe('arm-none-eabi-ld'),'--emit-relocs','-T',here/'link.ld',out/'environment.o','-o',out/'environment.elf')
run(exe('arm-none-eabi-objcopy'),'-O','binary',out/'environment.elf',out/'environment.bin')
b=(out/'environment.bin').read_bytes()
syms={n:int(a,16) for a,kind,n in (line.split() for line in run(exe('arm-none-eabi-nm'),'-n',out/'environment.elf').splitlines() if len(line.split())==3)}
rel=[]
for line in run(exe('arm-none-eabi-readelf'),'-r',out/'environment.elf').splitlines():
 if 'R_ARM_ABS32' in line:rel.append(int(line.split()[0],16))
assert not run(exe('arm-none-eabi-nm'),'-u',out/'environment.elf').strip()
data={'version':2,'hex':b.hex(),'sha256':hashlib.sha256(b).hexdigest(),'relocations':rel,'initOffset':syms['field_environment_init'],'updateOffset':syms['field_environment_update'],'freeOffset':syms['field_environment_free'],'stateOffset':syms['field_environment_state'],'configOffset':syms['field_environment_file']}
import ndspy.rom,ndspy.codeCompression
rom=ndspy.rom.NintendoDSRom.fromFile(str(here.parents[2]/'cleanwhite2.nds'));arm=ndspy.codeCompression.decompress(rom.arm9)
data['guards']=[{'address':a,'hex':arm[a-rom.arm9RamAddress:a-rom.arm9RamAddress+12].hex()} for a in [0x02006fc8,0x0200700c,0x02007040,0x02007054,0x02007090,0x02005f94,0x02017394,0x020192c0,0x020056fc,0x0203a6d4,0x0205f9fc,0x0205f998,0x0205f9b0,0x0205f940,0x02076164,0x0207619c,0x020762a4,0x020762e0,0x02076300,0x02076360]]
asset=here.parents[1]/'src/assets/cutscenes/field-environment-runtime.json';asset.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({k:v for k,v in data.items() if k!='hex'}))
