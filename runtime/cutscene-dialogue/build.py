"""Build the standalone Thumb dialogue adapter and its internal relocations."""
import hashlib,json,os,re,shutil,subprocess
from pathlib import Path
here=Path(__file__).resolve().parent
out=here/'build';out.mkdir(exist_ok=True)
tool=os.environ.get('ARM_TOOLCHAIN_BIN','')
def exe(name):return str(Path(tool)/name) if tool else shutil.which(name)
def run(*args):return subprocess.check_output([str(a) for a in args],text=True)
run(exe('arm-none-eabi-gcc'),'-mthumb','-mcpu=arm946e-s','-Os','-std=c11','-ffreestanding','-fno-builtin','-fno-jump-tables','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-Wall','-Wextra','-Werror','-c',here/'dialogue.c','-o',out/'dialogue.o')
run(exe('arm-none-eabi-gcc'),'-mthumb','-mcpu=arm946e-s','-c',here/'step.s','-o',out/'step.o')
run(exe('arm-none-eabi-ld'),'--emit-relocs','-T',here/'link.ld',out/'dialogue.o',out/'step.o','-o',out/'dialogue.elf')
run(exe('arm-none-eabi-objcopy'),'-O','binary',out/'dialogue.elf',out/'dialogue.bin')
b=(out/'dialogue.bin').read_bytes()
syms={n:int(a,16) for a,kind,n in (line.split() for line in run(exe('arm-none-eabi-nm'),'-n',out/'dialogue.elf').splitlines() if len(line.split())==3)}
rel=[]
for line in run(exe('arm-none-eabi-readelf'),'-r',out/'dialogue.elf').splitlines():
 if 'R_ARM_ABS32' in line:rel.append(int(line.split()[0],16))
assert not run(exe('arm-none-eabi-nm'),'-u',out/'dialogue.elf').strip()
data={'version':2,'hex':b.hex(),'sha256':hashlib.sha256(b).hexdigest(),'relocations':rel,'cueOffset':syms['dialogue_cue'],'taskOffset':syms['dialogue_text_task'],'stateOffset':syms['dialogue_state'],'stepOffset':syms['dialogue_step_bridge']}
asset=here.parents[1]/'src/assets/cutscenes/dialogue-runtime.json';asset.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({k:v for k,v in data.items() if k!='hex'}))
