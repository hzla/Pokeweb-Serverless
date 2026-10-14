"""Locate BW1 retail candidates using a read-only symbol-bearing reference.

The ignored inventory is research output, not an accepted native profile.
Calling conventions, work layouts and caller instructions are audited separately.
"""
import json, os, re, struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_ARM, CS_MODE_ARM, CS_MODE_THUMB
import ndspy.rom, ndspy.codeCompression

HERE=Path(__file__).resolve().parent
WORKSPACE=HERE.parents[2]
reference_root=os.environ.get('BW1_REFERENCE_ROOT')
if not reference_root:
    raise SystemExit('Set BW1_REFERENCE_ROOT before running this local inventory.')
REFERENCE=Path(reference_root).expanduser()/'prog/bin/ARM9-TS.HYB/Release'

def masked(code,address,thumb):
    mask=bytearray([255]*len(code))
    md=Cs(CS_ARCH_ARM,CS_MODE_THUMB if thumb else CS_MODE_ARM);md.skipdata=True
    for ins in md.disasm(code,address):
        if ins.mnemonic in ('bl','blx'):
            n=ins.address-address;mask[n:n+ins.size]=bytes(ins.size)
    for n in range(0,len(code)-3,2):
        if 0x02000000<=struct.unpack_from('<I',code,n)[0]<0x03000000:mask[n:n+4]=bytes(4)
    return mask

def find(code,mask,segments,thumb):
    runs=list(re.finditer(b'\xff+',bytes(mask)))
    if not runs:return []
    a,b=max((m.span() for m in runs),key=lambda p:p[1]-p[0])
    if b-a<4:return []
    fixed=[n for n,v in enumerate(mask)if v];hits=[]
    for name,(base,data)in segments.items():
        cursor=0
        while (hit:=data.find(code[a:b],cursor))>=0:
            cursor=hit+1;at=hit-a
            if at<0 or at+len(code)>len(data)or(base+at)%(2 if thumb else 4):continue
            if all(data[at+n]==code[n]for n in fixed):hits.append({'segment':str(name),'entry':base+at+int(thumb),'length':len(code)})
    return hits

def main():
    wanted_prefix=('PLIST_','FMenu','GFL_CL','GFL_BG_','GFL_STR_','GFL_TCB','GFL_HEAP_','GFL_UI_','GFL_ARC','GFL_FS_','PokeParty_','NNS_G2dGetImage','NNS_G2dIsImage')
    wanted_names={'PP_Get','PP_Put','POKETOOL_GetMinExp','EVENTWORK_CheckEventFlag','GAMEDATA_GetEventWork','MYITEM_CheckItem'}
    sources={}
    with (REFERENCE/'main.tef').open('rb')as f:
        elf=ELFFile(f)
        bases={}
        for section in elf.iter_sections():
            if section.name in ('main','pokelist','fieldmap','notwifi'):bases.setdefault(section.name,section['sh_addr'])
        symbols=list(elf.get_section_by_name('.symtab').iter_symbols())
        modes={}
        for s in symbols:
            if s.name in ('$t','$a','$d'):modes.setdefault(s['st_shndx'],[]).append((s['st_value'],s.name))
        for values in modes.values():values.sort()
        for symbol in symbols:
            if symbol['st_info']['type']!='STT_FUNC' or not(symbol.name.startswith(wanted_prefix)or symbol.name in wanted_names):continue
            name=elf.get_section(symbol['st_shndx']).name
            if name not in bases:continue
            path=REFERENCE/f'{name}.TWL.FLX.sbin'
            if name not in sources:sources[name]=path.read_bytes()
            raw=sources[name]
            size=symbol['st_size'];at=symbol['st_value']-bases[name]
            if size<8 or at<0:continue
            mapping=[v for v in modes.get(symbol['st_shndx'],[])if v[0]<=symbol['st_value']]
            thumb=bool(mapping and mapping[-1][1]=='$t')
            sources[symbol.name]=(symbol['st_value'],raw[at:at+size],'fieldmap'if name=='notwifi'else name,thumb)
    output={}
    for game,path in [('B',WORKSPACE/'cleanblack.nds'),('W',Path.home()/'Downloads/cleanroms/cleanwhite.nds')]:
        rom=ndspy.rom.NintendoDSRom.fromFile(str(path));assert rom.idCode==(b'IRBO'if game=='B'else b'IRAO')and rom.version==0
        overlays=rom.loadArm9Overlays([10,91])
        segments={'main':(rom.arm9RamAddress,ndspy.codeCompression.decompress(rom.arm9)),
                  'fieldmap':(overlays[10].ramAddress,bytes(overlays[10].data)),
                  'pokelist':(overlays[91].ramAddress,bytes(overlays[91].data))}
        rows={}
        for name,source in sources.items():
            if not isinstance(source,tuple):continue
            address,raw,segment,thumb=source;hits=[]
            for length in sorted({min(len(raw),n)for n in [80,48,32,24,16,8]},reverse=True):
                hits+=find(raw[:length],masked(raw[:length],address,thumb),{segment:segments[segment]},thumb)
                if hits:break
            # Equivalent ARM/Thumb masking occasionally yields the same bytes.
            rows[name]={'reference':hex(address),'mode':'Thumb'if thumb else 'ARM','size':len(raw),'candidates':hits,'reviewed':False}
        output[game]=rows
        print(game,len(rows),'functions;',sum(len(v['candidates'])==1 for v in rows.values()),'unique candidates')
    (HERE/'build').mkdir(exist_ok=True)
    (HERE/'build/bw1-reference-inventory.json').write_text(json.dumps(output,indent=2)+'\n')

if __name__=='__main__':main()
