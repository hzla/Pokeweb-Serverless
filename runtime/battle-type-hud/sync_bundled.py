"""Publish independent, verified icon and move-preview modules into Pokeweb."""
from pathlib import Path
import hashlib,json,shutil,os
from rpm_read import read_rpm
HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('BTH_WORKSPACE_ROOT',HERE.parents[2] if HERE.parent.name=='runtime' else HERE.parents[1]))
APP=ROOT/'Pokeweb-Serverless';ASSETS=APP/'src/assets/codeinjection';RUNTIME=APP/'runtime/battle-type-hud'
version='0.4.16'
manifest=json.loads((ASSETS/'battleTypeHudManifest.json').read_text())
manifest['version']=version;manifest.setdefault('moveGames',{})
memory=json.loads((HERE/'build/memory-report.json').read_text())
verified=json.loads((HERE/'build/verification.json').read_text())
alignment=json.loads((HERE/'build/player-alignment-verification.json').read_text())
enemy_names=json.loads((HERE/'build/enemy-name-verification.json').read_text())
move_verified=json.loads((HERE/'build/move-verification.json').read_text())
icon_names={'Add','AddPP','Main','Del','Release','Status','GetPfd','GetRule','GetProxy','PalAddr','PPGet','EffectiveTypes','ViewSrc','HpNumberBinding','NameDraw','SexDraw','LevelDraw','GaugePosition','EnemyPositions','EnemyTriplePositions','SpriteInit','CellInit','CellSelect'}
for game in ('B2','W2'):
 full=json.loads((HERE/f'profile-{game}.json').read_text())
 for module,key,state,hooks in (('TypeIcons','games',364,17),('MoveEffectiveness','moveGames',20,5)):
  component_version='0.3.16' if module=='TypeIcons' else '0.4.0'
  name=module+game+'.dll';data=(HERE/'build'/name).read_bytes();rpm=read_rpm(data)
  assert rpm['bss']==state and len([r for r in rpm['relocations'] if r['module']!='base'])==hooks
  assert all(r['module'] in ('base','168') for r in rpm['relocations']) and all(not s['attributes']&2 for s in rpm['symbols'])
  digest=hashlib.sha256(data).hexdigest();assert digest==memory[name]['sha256']
  if module=='TypeIcons':assert digest==verified['release_sha256'][game]==alignment['corrected'][game]['release_sha256']==enemy_names['games'][game]['release_sha256']
  else:assert digest==move_verified['release_sha256'][game]
  profile=dict(full);is_icon=module=='TypeIcons'
  profile['hooks']=[h for h in full['hooks'] if h['name'].startswith('Move')!=is_icon]
  profile['signatures']=[s for s in full['signatures'] if (s['name'] in icon_names if is_icon else s['name'] not in icon_names or s['name'] in ('PPGet','EffectiveTypes','ViewSrc'))]
  profile['resources']=full['resources'] if is_icon else {}
  profile['dllSha256']=digest;profile['version']=component_version;profile['builds']=manifest[key].get(game,{}).get('builds',{})
  types=['NULL','VALUE','FUNCTION_ARM','FUNCTION_THM','SECTION']
  build={'codeHex':rpm['code'].hex(),'relocations':rpm['relocations'],'bssSize':rpm['bss'],
   'symbols':[dict(address=s['address'],type=types[s['type']],attributes=s['attributes']) for s in rpm['symbols']]}
  if not is_icon:
   debug=read_rpm((HERE/'build'/f'{module}{game}.debug.dll').read_bytes())
   color=next(s for s in debug['symbols'] if s['name']=='gMovePreviewColors')
   at=color['address'];assert color['size']==6 and rpm['code'][at:at+6]==bytes.fromhex('5e2bb3621f21')
   assert all(r['module']!='base' or not at<=r['address']<at+6 for r in rpm['relocations'])
   build['colorOffset']=at
  profile['builds'][component_version]=build
  manifest[key][game]=profile;(ASSETS/name).write_bytes(data)
(ASSETS/'battleTypeHudManifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
shutil.copyfile(HERE/'panel-expansion.json',ASSETS/'battleTypeHudPanelExpansion.json')
RUNTIME.mkdir(parents=True,exist_ok=True)
if HERE!=RUNTIME:
 for path in HERE.iterdir():
  if path.name!='scanner_test.py' and path.is_file() and path.suffix in ('.py','.cpp','.h','.json','.java','.yml','.md','.txt','.cjs','.ts'):
   if path.name=='make_clean_test_rom.ts':
    (RUNTIME/path.name).write_text(path.read_text().replace('Pokeweb-Serverless/src/','src/'))
   else:shutil.copyfile(path,RUNTIME/path.name)
 (RUNTIME/'build').mkdir(exist_ok=True)
 for game in ('B2','W2'):
  shutil.copyfile(HERE/'build'/f'addresses-{game}.h',RUNTIME/'build'/f'addresses-{game}.h')
  for module in ('TypeIcons','MoveEffectiveness'):
   for name in (f'hooks-{module}-{game}.h',f'{module}{game}.dll',f'{module}{game}.debug.dll'):
    shutil.copyfile(HERE/'build'/name,RUNTIME/'build'/name)
 shutil.copyfile(HERE/'build/memory-report.json',RUNTIME/'build/memory-report.json')
(RUNTIME/'reports').mkdir(exist_ok=True)
for name in ('memory-report.json','verification.json','move-verification.json','compatibility-tests.json','pokeweb-install-verification.json','layout-verification.json','player-alignment-verification.json','enemy-name-verification.json'):
 if (HERE/'build'/name).exists():shutil.copyfile(HERE/'build'/name,RUNTIME/'reports'/name)
for name in ('captured-state-verification.json','standalone-install-verification.json'):
 (RUNTIME/'reports'/name).unlink(missing_ok=True)
 if (HERE/'build'/name).exists():
  shutil.copyfile(HERE/'build'/name,RUNTIME/'reports'/('historical-'+name))
for game in ('B2','W2'):
 live=HERE/'build'/f'live-{game}-split'
 for name,module in (('native-integration-0.json','TypeIcons'),('native-move-integration.json','MoveEffectiveness')):
  path=live/name
  if path.exists() and json.loads(path.read_text()).get('dll_sha256')==memory[f'{module}{game}.dll']['sha256']:
   shutil.copyfile(path,RUNTIME/'reports'/f'{game}-{name}')
  else:
   # A previous release's live report must not look like current validation.
   (RUNTIME/'reports'/f'{game}-{name}').unlink(missing_ok=True)
print('Bundled independent Type Icons and Move Effectiveness Preview '+version+'.')
