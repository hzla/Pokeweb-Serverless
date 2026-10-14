"""Read-only symbol matching for local native ABI research; results are not profiles."""
import os,sys,json
from pathlib import Path
from elftools.elf.elffile import ELFFile
import ndspy.rom,ndspy.codeCompression
HERE=Path(__file__).resolve().parent;WS=HERE.parents[2]
sys.path.insert(0,str(HERE.parent/'party-quick-actions'))
from inventory_bw1 import masked,find
root=Path(os.environ['BW1_REFERENCE_ROOT'])/'prog/bin/ARM9-TS.HYB/Release'
wanted=('mainSeqFunc_ready','mainSeqFunc_update_top','fldmapMain_UpdateMoveZone','fldmap_ZoneChange','zoneChangeScene','FIELD_EVENT_CheckNormal_Wrap','FIELD_EVENT_CheckHybrid','FIELD_EVENT_CheckNoGrid','GAMESYSTEM_EVENT_EntryCheckFunc','GAMESYSTEM_GetEvent','GAMESYSTEM_IsEventExists','GAMEDATA_SaveAsyncStart','GAMEDATA_SaveAsyncMain','FIELDMAP_IsReady','SCRIPT_CallFieldInitScript','GAMESYSTEM_EVENT_DataCreate','FIELD_PLAYER_Stop','FLDMSGBG_Open','FLDMSGBG_Close')
with (root/'main.tef').open('rb')as f:
 e=ELFFile(f);syms=list(e.get_section_by_name('.symtab').iter_symbols());bases={}; modes={}
 for s in e.iter_sections():
  if s.name in('main','fieldmap','notwifi'):bases.setdefault(s.name,s['sh_addr'])
 for s in syms:
  if s.name in('$a','$t','$d'):modes.setdefault(s['st_shndx'],[]).append((s['st_value'],s.name))
 for vals in modes.values():vals.sort()
 data={n:(root/f'{n}.TWL.FLX.sbin').read_bytes()for n in bases};sources={}
 for s in syms:
  if s['st_info']['type']!='STT_FUNC' or not(s.name in wanted or s.name.startswith(('FIELD_EVENT_Check','FLDMSGBG_','FLDPLAINMSGWIN_','FLDMSGWIN_','FIELDMENU_GetMenuType','FIELD_PLAYER_Is','FIELD_PLAYER_GetMove','GFL_FADE_'))):continue
  sec=e.get_section(s['st_shndx']).name
  if sec not in bases:continue
  a=s['st_value'];thumb=[m for v,m in modes[s['st_shndx']]if v<=a][-1]=='$t';raw=data[sec][a-bases[sec]:a-bases[sec]+s['st_size']]
  sources[s.name]=(a,thumb,raw,'ARM9'if sec=='main'else'36')
out={}
for game,romfile in [('B2','cleanblack2.nds'),('W2','cleanwhite2.nds')]:
 r=ndspy.rom.NintendoDSRom.fromFile(str(WS/romfile));ovs=r.loadArm9Overlays([12,36]);segs={'ARM9':(r.arm9RamAddress,ndspy.codeCompression.decompress(r.arm9)),**{str(i):(v.ramAddress,v.data)for i,v in ovs.items()}};out[game]={}
 for name,(a,t,raw,seg)in sources.items():
  hits=[]
  for n in sorted({min(len(raw),n)for n in[80,48,32,24,16,8]},reverse=True):
   hits=find(raw[:n],masked(raw[:n],a,t),{k:v for k,v in segs.items()if k==seg or k=='12'},t)
   if hits:break
  out[game][name]={'size':len(raw),'thumb':t,'hits':hits}
  if name in wanted:print(game,name,len(raw),hits[:5])
(HERE/'build/inventory.json').write_text(json.dumps(out,indent=2))
