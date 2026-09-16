"""Fail-closed ROM/asset/hook audit. Does not modify the input ROM."""
from pathlib import Path
import argparse, hashlib, json, struct, sys, os
import ndspy.rom, ndspy.codeCompression, ndspy.narc, ndspy.lz10
HERE=Path(__file__).resolve().parent;ROOT=Path(os.environ.get("BTH_WORKSPACE_ROOT",HERE.parents[2] if HERE.parent.name=="runtime" else HERE.parents[1]))
from rpm_read import read_rpm
from panel_expansion import transform
class CompatibilityError(Exception):pass
def sha(b):return hashlib.sha256(b).hexdigest()
CASCADE_SCANNER_SHA='8279bed45bde3d0f9e0309d29d4246fd695a5c5d6fa55346c401c0bbc7043b50'
# Independently prepared English frameworks with empty patches directories.
EMPTY_PMC_SHA={'B2':'b7337d4ec23014b281f2646f70de8464c364169726b009e4ce6aa7101a54a587',
               'W2':'efdecc2335b2ff357e29cf042dedb84596b358754f7d8a4046cb36ff8cc0bb17'}
def audit(path,module="TypeIcons"):
    rom=ndspy.rom.NintendoDSRom.fromFile(path)
    game={b'IREO':'B2',b'IRDO':'W2'}.get(bytes(rom.idCode))
    if not game:raise CompatibilityError('Only English Black 2 / IREO and White 2 / IRDO are supported.')
    profile=json.loads((HERE/f'profile-{module}-{game}.json').read_text())
    overlays=rom.loadArm9Overlays([167,168])
    blobs={n:(v.ramAddress,bytes(v.data)) for n,v in overlays.items()}
    blobs[0]=(rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(rom.arm9)))
    errors=[]
    for s in profile['signatures']:
        base,data=blobs[s['segment']];p=s['address']-base;want=bytes.fromhex(s['bytes'])
        if data[p:p+len(want)]!=want:errors.append(f'Native {s["name"]} signature mismatch at {s["address"]:#010x}.')
    base,data=blobs[168]
    if base!=profile['overlay_base']:errors.append('Overlay 168 load address differs.')
    for h in profile['hooks']:
        p=h['address']-base
        if data[p:p+4]!=bytes.fromhex(h['bytes']):errors.append(f'{h["name"]} hook already modified at {h["address"]:#010x}.')
    narc=ndspy.narc.NARC(rom.getFileByName('a/0/1/1')) if profile['resources'] else None
    expansion=json.loads((HERE/'panel-expansion.json').read_text())
    for n,want in profile['resources'].items():
        raw=narc.files[int(n)]
        if raw[0]==0x10:raw=ndspy.lz10.decompress(raw)
        if sha(raw) not in (want,expansion.get(n,{}).get('patchedSha256'),*(v['patchedSha256'] for v in expansion.get(n,{}).get('previous',[]))):errors.append(f'Unsupported battle graphics/palette resource {n}.')
    patches=rom.filenames.subfolder('patches');installed=[];conflicts=[]
    if not patches: errors.append('No existing PMC patches directory. Install the matching PMC framework first.')
    else:
        for name in patches.files:
            raw=rom.getFileByName('patches/'+name)
            if raw[:4]!=b'DLXF':continue
            try:rpm=read_rpm(raw)
            except Exception as e:
                errors.append(f'Cannot audit installed module {name}: {e}');continue
            installed.append(name)
            for r in rpm['relocations']:
                if r['module']!='168':continue
                start=r['address']&~1
                # Absolute Thumb jump veneers can occupy 16 bytes; bound 32
                # conservatively. BL and pointer rewrites occupy four bytes.
                size=(rpm['symbols'][r['symbol']]['size'] if r['type']=='FULL_COPY' else
                      4 if r['type'] in ('OFFSET','OFFSET_REL31','THUMB_BRANCH_LINK','ARM_BRANCH_LINK','ARM_BRANCH') else 32)
                for h in profile['hooks']:
                    if start<h['address']+4 and h['address']<start+size:
                        conflicts.append(dict(module=name,relocation=r,hook=h))
    if conflicts:errors.append('Hook collisions: '+', '.join(f'{c["module"]} at {c["hook"]["address"]:#x}' for c in conflicts))
    if patches and not installed:
        try:known_framework=sha(bytes(rom.loadArm9Overlays([344])[344].data))==EMPTY_PMC_SHA.get(game)
        except Exception:known_framework=False
        if not known_framework:errors.append('No PMC DLLs or recognized empty PMC framework found; installation cannot be established.')
    digest=sha(Path(path).read_bytes())
    capacity=None
    if digest==CASCADE_SCANNER_SHA:
        capacity=dict(current_kib=160,insufficient=True,
            reason='Observed PMC fragmentation at overlay 168: largest free block 2328 bytes with scanner loaded.')
        errors.append('The recorded Cascade+scanner build has insufficient PMC capacity. Use a non-Cascade ROM or a future optimized build; this installer does not resize the PMC heap.')
    result=dict(component=module,game=game,rom=Path(path).name,rom_sha256=digest,
                compatible=not errors,errors=errors,hook_conflicts=conflicts,installed_modules=installed,
                scanner_present='CascadeScanLabel.dll' in installed,verified_functions=len(profile['signatures']),
                verified_hooks=len(profile['hooks']),verified_resources=len(profile['resources']),pmc_capacity=capacity)
    return rom,result
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('rom',type=Path);p.add_argument('--report',type=Path);p.add_argument('--component',choices=('icons','moves'),default='icons');args=p.parse_args()
    try:_,r=audit(args.rom,"TypeIcons" if args.component=="icons" else "MoveEffectiveness")
    except Exception as e:raise SystemExit('COMPATIBILITY FAILURE: '+str(e))
    if args.report:args.report.write_text(json.dumps(r,indent=2)+'\n')
    print(json.dumps(r,indent=2))
    if not r['compatible']:raise SystemExit('COMPATIBILITY FAILURE: no ROM was modified.')
if __name__=='__main__':main()
