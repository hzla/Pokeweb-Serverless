"""Read-only native-code exploration; generated disassemblies stay in build/."""
from pathlib import Path
import argparse, os, struct
import ndspy.rom, ndspy.codeCompression
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB

HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get("BTH_WORKSPACE_ROOT",HERE.parents[2] if HERE.parent.name=="runtime" else HERE.parents[1]))
ROMS={'W2':Path(os.environ.get('BTH_W2_ROM',ROOT/'White2Upgrade/IRDO.nds')),
      'B2':Path(os.environ.get('BTH_B2_ROM',Path.home()/'Downloads/cleanroms/cleanblack2.nds'))}
def load(game):
    rom=ndspy.rom.NintendoDSRom.fromFile(ROMS[game])
    overlays=rom.loadArm9Overlays([167,168])
    blobs={n:(v.ramAddress,bytes(v.data)) for n,v in overlays.items()}
    blobs[0]=(rom.arm9RamAddress,ndspy.codeCompression.decompress(rom.arm9))
    return rom,blobs
def instructions(data,base):
    md=Cs(CS_ARCH_ARM,CS_MODE_THUMB);md.skipdata=True
    return list(md.disasm(data,base))
def listing(blob,a,z):
    base,data=blob
    for i in instructions(data[a-base:z-base],a):
        suffix=''
        if i.mnemonic=='ldr' and '[pc,' in i.op_str:
            offset=int(i.op_str.split('#')[1].split(']')[0],0)
            ptr=((i.address+4)&~3)+offset
            if base<=ptr<base+len(data)-3:
                value=struct.unpack_from('<I',data,ptr-base)[0]
                suffix=f' ; [{ptr:08x}] = {value:08x}'
        print(f'{i.address:08x} {i.bytes.hex():8} {i.mnemonic:8} {i.op_str}{suffix}')
def main():
    p=argparse.ArgumentParser();p.add_argument('game',choices=ROMS);p.add_argument('start',nargs='?',type=lambda x:int(x,0));p.add_argument('end',nargs='?',type=lambda x:int(x,0));p.add_argument('--segment',type=int,default=168);p.add_argument('--calls',type=lambda x:int(x,0));a=p.parse_args()
    _,blobs=load(a.game);base,data=blobs[a.segment]
    if a.start is not None:listing(blobs[a.segment],a.start,a.end or a.start+160);return
    ins=instructions(data,base)
    if a.calls:
        for i in ins:
            if i.mnemonic in ('bl','blx','b') and i.op_str.startswith('#') and int(i.op_str[1:],0)==a.calls:print(hex(i.address),i.mnemonic)
        return
    literals={base+i:struct.unpack_from('<I',data,i)[0] for i in range(0,len(data)-4,4) if struct.unpack_from('<I',data,i)[0] in (435,436,437,441,442,443,434)}
    for i in ins:
        if i.mnemonic=='ldr' and '[pc,' in i.op_str:
            ptr=((i.address+4)&~3)+int(i.op_str.split('#')[1].split(']')[0],0)
            if ptr in literals:print(hex(i.address),'resource',literals[ptr])
    (HERE/'build').mkdir(exist_ok=True)
    for seg,blob in blobs.items():
        b,d=blob
        (HERE/'build'/f'{a.game}-{seg}.bin').write_bytes(d)
    print('base',hex(base),'size',len(data))
if __name__=='__main__':main()
