"""Install into a NEW PMC-enabled test ROM; preserve every original file ID.

The FNT patch directory receives contiguous FAT aliases for its old entries.
Original file IDs remain unchanged. Type Icons also expands two player-panel
resources in a/0/1/1; every other original payload is preserved. Installation is
refused if verified free space before the cartridge DS read boundary is short.
"""
import argparse, copy, json, struct
from pathlib import Path
import ndspy.fnt, ndspy.rom, ndspy.narc, ndspy.lz10
from compatibility import HERE, CompatibilityError, audit, sha
from panel_expansion import transform
def align(n,a=16):return (n+a-1)&~(a-1)
def crc16(data):
    crc=0xffff
    for byte in data:
        crc^=byte
        for _ in range(8):crc=(crc>>1)^(0xa001 if crc&1 else 0)
    return crc
def install(source,destination,debug=False,module="TypeIcons"):
    if destination.exists():raise CompatibilityError('Output already exists; choose a new filename.')
    rom,report=audit(source,module)
    if not report['compatible']:raise CompatibilityError('; '.join(report['errors']))
    game=report['game'];name=f'{module}{game}.dll'
    dll=(HERE/'build'/f'{module}{game}{".debug" if debug else ""}.dll').read_bytes()
    replacements={}
    if module=='TypeIcons':
        fid=rom.filenames.idOf('a/0/1/1');archive=ndspy.narc.NARC(rom.files[fid])
        for member,change in json.loads((HERE/'panel-expansion.json').read_text()).items():
            raw=archive.files[int(member)]
            if raw[0]==0x10:raw=ndspy.lz10.decompress(raw)
            archive.files[int(member)]=transform(raw,change)
        replacements[fid]=archive.save()
    original=source.read_bytes();u32=lambda p:struct.unpack_from('<I',original,p)[0]
    fo,fs,ao,az=struct.unpack_from('<4I',original,0x40)
    oldfat=original[ao:ao+az];fnt=ndspy.fnt.load(original[fo:fo+fs]);before=copy.deepcopy(fnt)
    patches=fnt.subfolder('patches');ids=list(range(patches.firstID,patches.firstID+len(patches.files)))
    if name in patches.files:raise CompatibilityError('A type HUD DLL is already installed.')
    patches.firstID=az//8;patches.files.append(name)
    newfnt=ndspy.fnt.save(fnt);newfat=bytearray(oldfat)
    for i in ids:newfat.extend(oldfat[i*8:i*8+8])
    tail=u32(0x80);bound=struct.unpack_from('<H',original,0x92)[0]<<19
    if not 0x8000<tail<=len(original) or len(set(original[tail:]))>1:raise CompatibilityError('Unrecognized ROM tail padding.')
    regions=[(0,u32(0x84)),(u32(0x20),u32(0x20)+u32(0x2c)),(u32(0x30),u32(0x30)+u32(0x3c)),
             (u32(0x68),u32(0x68)+0x23c0)]
    regions.extend((u32(p),u32(p)+u32(p+4)) for p in (0x40,0x48,0x50,0x58) if u32(p))
    regions.extend(struct.unpack_from('<II',oldfat,i) for i in range(0,az,8))
    regions.extend((u32(a),u32(a)+u32(z)) for a,z in [(0x1c0,0x1cc),(0x1d0,0x1dc),(0x1f0,0x1f4),(0x1f8,0x1fc)])
    if not all(0<=a<=z<=tail for a,z in regions):raise CompatibilityError('The declared tail overlaps an existing ROM payload.')
    nf=align(tail);na=align(nf+len(newfnt));payload=align(na+len(newfat)+8)
    cursor=align(payload+len(dll));extra=[]
    for fid,data in replacements.items():
        struct.pack_into('<II',newfat,fid*8,cursor,cursor+len(data))
        extra.append((cursor,data));cursor=align(cursor+len(data))
    end=align(cursor,512)
    if not end<=bound:raise CompatibilityError('Insufficient verified DS-readable tail space; use a ROM editor to rebuild.')
    newfat.extend(struct.pack('<II',payload,payload+len(dll)))
    out=bytearray(original);out.extend(b'\xff'*max(0,end-len(out)))
    out[nf:nf+len(newfnt)]=newfnt;out[na:na+len(newfat)]=newfat;out[payload:payload+len(dll)]=dll
    for at,data in extra:out[at:at+len(data)]=data
    struct.pack_into('<4I',out,0x40,nf,len(newfnt),na,len(newfat));struct.pack_into('<I',out,0x80,end)
    struct.pack_into('<H',out,0x15e,crc16(out[:0x15e]))
    # Only the verified battle archive replacement may differ.
    rebuilt=ndspy.rom.NintendoDSRom(bytes(out))
    for i,file in enumerate(rom.files):
        expected=bytearray(replacements.get(i,file))
        assert rebuilt.files[i]==expected
        path=before.filenameOf(i)
        if path is not None:
            assert rebuilt.getFileByName(path)==expected
            if i not in ids:assert rebuilt.filenames.idOf(path)==i
    assert rebuilt.getFileByName('patches/'+name)==dll
    destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(out)
    assert sha(source.read_bytes())==report['rom_sha256']
    report.update(output=str(destination.resolve()),output_sha256=sha(out),module=name,dll_sha256=sha(dll),
                  debug=debug,original_payloads_preserved=len(rom.files)-len(replacements),replaced_file_ids=list(replacements),original_file_ids_preserved=True,
                  pmc_heap_resized=False,
                  source_unchanged=True,ds_read_boundary=hex(bound),new_data_end=hex(end))
    destination.with_suffix('.install.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--debug',action='store_true');p.add_argument('--component',choices=('icons','moves'),default='icons');a=p.parse_args()
    try:r=install(a.source,a.output,a.debug,"TypeIcons" if a.component=="icons" else "MoveEffectiveness")
    except Exception as e:raise SystemExit('COMPATIBILITY FAILURE: '+str(e))
    print(json.dumps(r,indent=2))
if __name__=='__main__':main()
