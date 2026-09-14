"""Read-only negative compatibility tests using in-memory ROM mutations."""
import json, os
from pathlib import Path
from unittest.mock import patch
import ndspy.narc, ndspy.lz10, ndspy.rom
from compatibility import HERE, audit
from panel_expansion import transform

def main():
    source=Path(os.environ.get('BTH_CASCADE_ROM',Path.home()/'Downloads/cascadescan-bumpers.nds'))
    rom,good=audit(source)
    assert good['scanner_present'] and not good['hook_conflicts']
    assert len(good['errors'])==1 and 'insufficient PMC capacity' in good['errors'][0]
    _,moves=audit(source,'MoveEffectiveness')
    assert moves['verified_hooks']==5 and not moves['hook_conflicts']
    checks=['independent move-preview profile checks its five hooks', 'verified Cascade scanner and all other installed modules have no hook collisions']
    _,r=audit(source)
    assert not r['compatible'] and any('insufficient PMC capacity' in e for e in r['errors'])
    checks.append('known insufficient PMC capacity is rejected without resizing the heap')
    with patch.object(ndspy.rom.NintendoDSRom,'fromFile',return_value=rom):
        fid=rom.filenames.idOf('patches/CascadeScanLabel.dll');old=rom.files[fid]
        try:
            rom.files[fid]=(HERE/'build/TypeIconsW2.dll').read_bytes()
            _,r=audit(source)
            assert not r['compatible'] and len(r['hook_conflicts'])==17
            checks.append('all 17 icon conflicting DLL hook relocations are detected')
            rom.files[fid]=b'DLXF'+b'\0'*24
            _,r=audit(source)
            assert not r['compatible'] and any('Cannot audit' in e for e in r['errors'])
            checks.append('malformed installed DLL produces a compatibility failure')
        finally:rom.files[fid]=old
        fid=rom.filenames.idOf('a/0/1/1');old=rom.files[fid]
        try:
            for member in (435,438,439,456):
                narc=ndspy.narc.NARC(old);raw=narc.files[member]
                if raw[0]==0x10:raw=ndspy.lz10.decompress(raw)
                raw=bytearray(raw);raw[-1]^=1;narc.files[member]=bytes(raw);rom.files[fid]=narc.save()
                _,r=audit(source)
                assert not r['compatible'] and any(f'resource {member}' in e for e in r['errors'])
            checks.append('unrecognized panel and HP-number graphics are rejected')
            narc=ndspy.narc.NARC(old)
            for member,change in json.loads((HERE/'panel-expansion.json').read_text()).items():
                raw=narc.files[int(member)]
                if raw[0]==0x10:raw=ndspy.lz10.decompress(raw)
                narc.files[int(member)]=transform(raw,change)
            rom.files[fid]=narc.save();_,r=audit(source)
            assert not any('resource' in e for e in r['errors'])
            checks.append('exact expanded player NCGR/NCER accepted; arbitrary changes rejected')
            previous=json.loads((HERE/'panel-expansion.json').read_text())['439']['previous'][0]
            legacy=bytearray(narc.files[439]);legacy[0x46]=0xb0;narc.files[439]=bytes(legacy)
            rom.files[fid]=narc.save();_,r=audit(source)
            assert not any('resource' in e for e in r['errors'])
            checks.append('prior player NCER position accepted for verified upgrade')
        finally:rom.files[fid]=old
        native=rom.loadArm9Overlays
        def changed(ids):
            overlays=native(ids)
            if 168 in overlays:
                h=json.loads((HERE/'profile-W2.json').read_text())['hooks'][0]
                o=overlays[168];o.data[h['address']-o.ramAddress]^=1
            return overlays
        with patch.object(rom,'loadArm9Overlays',side_effect=changed):
            _,r=audit(source)
            assert not r['compatible'] and any('hook already modified' in e for e in r['errors'])
        checks.append('native call-site modifications are rejected before installation')
    result=dict(checks=checks,source_rom_unchanged=True,mutations='in-memory only')
    (HERE/'build/compatibility-tests.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
