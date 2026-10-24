"""Build the W2 resident saved-calendar policy and pinned native guards."""
import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
import ndspy.rom,ndspy.codeCompression
here=Path(__file__).resolve().parent;repo=here.parents[1];out=here/'build';out.mkdir(exist_ok=True)
sys.path.insert(0,str(here.parent/'battle-type-hud'))
from rpm_read import read_rpm
def run(*args):subprocess.run([str(a) for a in args],check=True)
tool=os.environ.get('ARM_TOOLCHAIN_BIN','')
def exe(n):return str(Path(tool)/n) if tool else shutil.which(n)
obj=out/'calendar.o';elf=out/'calendar.elf'
run(exe('arm-none-eabi-g++'),'-std=c++17','-mthumb','-mcpu=arm946e-s','-Os','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror','-c',here/'calendar.cpp','-o',obj)
run(exe('arm-none-eabi-g++'),'-nostdlib','-Wl,-r',obj,'-o',elf)
assert not subprocess.check_output([exe('arm-none-eabi-nm'),'-u',elf]).strip()
meta=out/'metadata.yml';meta.write_text('PMCGameID: W2\nPMCModulePriority: 4\nPMCVersion: 0.1.0\n')
symbols=out/'symbols.yml';symbols.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
asset=repo/'src/assets/cutscenes/FieldSeasonW2.dll'
jar=os.environ.get('RPM_TOOL_JAR')
if not jar:raise RuntimeError('Set RPM_TOOL_JAR to the installed RPM compiler.')
run('java','-cp',jar,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',asset,'--esdb',symbols,'--meta',meta,'--generate-relocations','--strip')
rom=ndspy.rom.NintendoDSRom.fromFile(str(repo.parent/'cleanwhite2.nds'));arm=ndspy.codeCompression.decompress(rom.arm9)
guards=[{'address':a,'hex':arm[a-rom.arm9RamAddress:a-rom.arm9RamAddress+n].hex()} for a,n in [(0x2034f58,62),(0x20173ac,8),(0x20173b4,8),(0x2017394,8),(0x20192c0,12),(0x20175e4,12),(0x20175f0,12),(0x2034f98,26)]]
rpm=read_rpm(asset.read_bytes());hooks=[r for r in rpm['relocations'] if r['module']=='ARM9']
assert len(hooks)==1 and hooks[0]['address']==0x2034f58 and hooks[0]['type']=='THUMB_BRANCH'
(repo/'src/assets/cutscenes/field-season-runtime.json').write_text(json.dumps({'version':1,'sha256':hashlib.sha256(asset.read_bytes()).hexdigest(),'guards':guards,'workId':0x41ae,'marker':0xa7c0},indent=2)+'\n')
print('W2 calendar hook',len(rpm['code']),'bytes; native guards and saved work 0x41ae recorded.')
