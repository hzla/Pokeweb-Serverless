"""Package standalone source, binaries and matching evidence; no ROMs or saves."""
from pathlib import Path
import hashlib,json,shutil,zipfile
HERE=Path(__file__).resolve().parent
VERSION='0.4.9'
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    memory=json.loads((HERE/'build/memory-report.json').read_text())
    alignment=json.loads((HERE/'build/player-alignment-verification.json').read_text())
    verified={module:json.loads((HERE/'build'/name).read_text()) for module,name in
              (('TypeIcons','verification.json'),('MoveEffectiveness','move-verification.json'))}
    enemy_names=json.loads((HERE/'build/enemy-name-verification.json').read_text())
    dist=HERE/'dist';dist.mkdir(exist_ok=True);files={}
    for path in HERE.iterdir():
        if path.name!='scanner_test.py' and path.is_file() and path.suffix in ('.md','.py','.cpp','.h','.json','.java','.yml','.txt','.cjs','.ts'):
            files[path.name]=path
    for game in ('B2','W2'):
        files[f'build/addresses-{game}.h']=HERE/'build'/f'addresses-{game}.h'
        for module in ('TypeIcons','MoveEffectiveness'):
            for suffix in ('','.debug'):
                name=f'{module}{game}{suffix}.dll';path=HERE/'build'/name
                assert sha(path.read_bytes())==memory[name]['sha256']
                files['build/'+name]=path;shutil.copyfile(path,dist/name)
            assert verified[module]['release_sha256'][game]==memory[f'{module}{game}.dll']['sha256']
            if module=='TypeIcons':assert alignment['corrected'][game]['release_sha256']==verified[module]['release_sha256'][game]==enemy_names['games'][game]['release_sha256']
            name=f'hooks-{module}-{game}.h';files['build/'+name]=HERE/'build'/name
        live=HERE/'build'/f'live-{game}-split'
        for name in ('native-integration-0.json','native-integration-1.json','native-move-integration.json','session.json'):
            path=live/name;module='MoveEffectiveness' if name=='native-move-integration.json' else 'TypeIcons'
            if path.exists() and json.loads(path.read_text()).get('dll_sha256')==verified[module]['release_sha256'][game]:
                files[f'reports/{game}-{name}']=path
        if f'reports/{game}-native-move-integration.json' in files:
            for name in ('screen.png','move-colors.png'):files[f'previews/{game}-{name}']=live/name
    for name in ('memory-report.json','verification.json','move-verification.json','compatibility-tests.json','pokeweb-install-verification.json','captured-state-verification.json','layout-verification.json','player-alignment-verification.json','enemy-name-verification.json','standalone-install-verification.json'):
        files['reports/'+name]=HERE/'build'/name
    for path in (HERE/'build/icons').glob('*.png'):files['previews/icons/'+path.name]=path
    manifest={name:dict(bytes=p.stat().st_size,sha256=sha(p.read_bytes())) for name,p in sorted(files.items())}
    target=dist/f'BattleHudPatches-{VERSION}.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for name,path in sorted(files.items()):z.write(path,f'BattleHudPatches-{VERSION}/'+name)
        z.writestr(f'BattleHudPatches-{VERSION}/manifest.json',json.dumps(manifest,indent=2)+'\n')
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        assert not any(n.endswith(('.nds','.sav','.dsv','.mln','.bin')) for n in z.namelist())
    (dist/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    for name in ('README.md','VALIDATION.md','IMMUNITY_FEASIBILITY.md'):shutil.copyfile(HERE/name,dist/name)
    print(json.dumps(dict(zip=str(target),bytes=target.stat().st_size,sha256=sha(target.read_bytes())),indent=2))
if __name__=='__main__':main()
