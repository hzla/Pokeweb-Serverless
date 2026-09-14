"""Render native OAM pieces in memory; check placement without a game boot."""
import hashlib, json, struct, sys
from pathlib import Path
from verify import HERE, Harness, G, ASSETS, normalized, setpixel, player_header
from panel_expansion import transform

def compose(cell, image):
    count=struct.unpack_from('<H',cell,0x30)[0];result={}
    for i in range(count):
        a,b,c=struct.unpack_from('<3H',cell,0x38+6*i)
        assert a>>14==1 and not a&0x3f00 and not b&0x3e00
        w,h=((16,8),(32,8),(32,16),(64,32))[b>>14]
        x=b&511;y=a&255;x=x-512 if x>=256 else x;y=y-256 if y>=128 else y
        for yy in range(h):
            for xx in range(w):
                at=c*64+((yy//8)*(w//8)+xx//8)*32+(yy%8)*4+(xx%8)//2
                assert at<len(image), 'OAM fetch exceeds its allocated NCGR image'
                color=image[at]>>((xx&1)*4)&15
                if color:result.setdefault((x+xx,y+yy),color)
    return result

def main():
    expansion=json.loads((HERE/'panel-expansion.json').read_text());reports={}
    for game in ('B2','W2'):
        h=Harness(game);h.addReset=False
        original=(HERE/'build'/f'{game}-resource-439.bin').read_bytes()
        cell=transform(original,expansion['439'])
        clean=h.raw[(0,0)]
        checks=[]
        for first in (10,16,18):
            base=bytearray(clean)
            # Foreground/shadow name fixture at native long/short name indents.
            for y in range(7,16):
                for x in range(first,first+24):setpixel(base,x,y,1 if (x+y)%3 else 4)
            native=compose(original,normalized(base[:2048]))
            assert compose(cell,normalized(base))==native
            shifted_image=bytearray(normalized(base));player_header(shifted_image)
            shifted=compose(cell,shifted_image)
            for pair in ((13,13),(9,2),(7,3),(17,17)):
                h.raw[(0,0)]=bytes(base);h.c.mem_write(0x06400000,bytes(base));mon=h.add(0,pair)
                h.check(0,pair)
                actual=compose(cell,h.image(0));extra={p:c for p,c in actual.items() if shifted.get(p)!=c}
                left=first-64-23+12+(11 if pair[0]==pair[1] else 0)
                width=10 if pair[0]==pair[1] else 21
                expected={(left+11*k+x,-10+y) for k in range(1 if pair[0]==pair[1] else 2)
                          for y in range(10) for x in range(10) if ASSETS['outline'][y]&(512>>x)}
                assert set(extra)==expected, (game,first,pair)
                assert all(actual.get(p)==c for p,c in shifted.items()), 'translated header or native HP/EXP pixels changed'
                assert max(x for x,y in extra)==first-64-3+12, 'two-pixel clearance before name'
                assert max(y for x,y in extra)==max(y for x,y in native if y<0), 'name/icon bottom borders differ'
                assert max(x for x,y in extra)-min(x for x,y in extra)+1==width
                for status in range(1,7):
                    h.invoke('Status',G,status,0);assert compose(cell,h.image(0))==shifted
                    h.invoke('Status',G,0,0);assert compose(cell,h.image(0))==actual
                h.invoke('Del',G,0);assert compose(cell,h.image(0))==native
            checks.append(dict(native_name_first_x=first-64,dual_left=first-75,mono_left=first-64,name_shift=12,info_shift=8,icon_shift=12,top=-10,clearance=2))
        # Shared regular-player resources must leave doubles' extension blank.
        h=Harness(game);h.add(2,(9,2),1);assert not any(h.image(2,1)[2048:])
        reports[game]=dict(placements=checks,header_translation_exact=True,lower_panel_unchanged=True,all_statuses_and_removal_restore=True,
                          added_oam_pieces=1,added_vram_per_regular_player=256,doubles_extension_transparent=True)
    (HERE/'build/layout-verification.json').write_text(json.dumps(reports,indent=2)+'\n')
    print(json.dumps(reports,indent=2))

def verify_capture(state_path, old_path):
    """Measure actual captured name/OAM pixels, then run both new DLL fixtures.

    Input is the W2 0.3.6 capture with the player icons one pixel too low.
    No raw memory is copied into the report, source snapshot or release archive.
    """
    from verify_dst import read_state, relocated, RAM, u32
    from rpm_read import read_rpm
    mem=read_state(state_path);ram=mem['WRAM'];old=read_rpm(old_path.read_bytes())
    profile=json.loads((HERE/'profile-W2.json').read_text())
    site=next(h['address'] for h in profile['hooks'] if h['name']=='Main')
    a,b=struct.unpack_from('<HH',ram,site-RAM)
    assert a&0xf800==0xf000 and b&0xf800==0xf800
    delta=((a&2047)<<12)|((b&2047)<<1)
    if delta&0x400000:delta-=0x800000
    r=next(r for r in old['relocations'] if r['module']=='168' and r['address']==site)
    base=site+4+delta-old['symbols'][r['symbol']]['address']
    assert ram[base-RAM:base-RAM+len(old['code'])]==relocated(old,base)
    state=base+len(old['code'])
    assert old['bss']==364 and ram[state+360-RAM]==0
    assert ram[state+56-RAM]&7==0 and ram[state+59-RAM]&3==0
    gauge=u32(ram,state-RAM);sprite=u32(ram,gauge+0x40-RAM)
    cell_data=u32(ram,sprite+0xa4-RAM);count=u32(ram,cell_data-RAM)&65535
    assert count==3
    attrs=u32(ram,cell_data+4-RAM)
    cell=bytearray(0x38+count*6);struct.pack_into('<H',cell,0x30,count)
    cell[0x38:]=ram[attrs-RAM:attrs-RAM+count*6]
    assert cell[0x38:]==bytes.fromhex('f040c0c10000f04000c01000f440b0812000')
    image=u32(ram,state+12-RAM)-0x06400000
    assert image==u32(ram,sprite+0x20-RAM)
    raw=mem['LCDM'][0x80000+image:0x80000+image+2304]
    native_cell=bytearray(cell);struct.pack_into('<H',native_cell,0x30,2)
    native=compose(native_cell,raw[:2048]);captured=compose(cell,raw)
    name_bottom=max(y for x,y in native if -56<=x<-24 and y<0)
    captured_bottom=max(y for x,y in captured.keys()-native.keys())
    assert name_bottom==-1 and captured_bottom==0
    expansion=json.loads((HERE/'panel-expansion.json').read_text())
    new_cell=transform((HERE/'build/W2-resource-439.bin').read_bytes(),expansion['439'])
    results={}
    for game in ('B2','W2'):
        h=Harness(game);h.raw[(0,0)]=raw[:2048]+bytes(256)
        shifted_image=bytearray(raw[:2048]+bytes(256));player_header(shifted_image)
        shifted=compose(new_cell,shifted_image)
        checks=[]
        for pair in ((7,3),(13,13)):
            h.add(0,pair);h.check(0,pair)
            actual=compose(new_cell,h.image(0));extra=set(actual)-set(shifted)
            assert max(y for x,y in extra)==name_bottom
            assert all(actual.get(p)==c for p,c in shifted.items())
            h.writes.clear();h.invoke('Main',G);assert not h.writes
            for status in range(1,7):
                h.invoke('Status',G,status,0);assert compose(new_cell,h.image(0))==shifted
                h.invoke('Status',G,0,0);assert compose(new_cell,h.image(0))==actual
            h.invoke('Del',G,0);assert compose(new_cell,h.image(0))==native
            checks.append(dict(types=pair,icon_bottom=max(y for x,y in extra),name_bottom=name_bottom,
                               name_shift=12,info_shift=8,icon_shift=12))
        results[game]=dict(checks=checks,header_translation_exact=True,lower_panel_unchanged=True,unchanged_update_no_writes=True,
                          statuses_restore=True,release_sha256=hashlib.sha256((HERE/'build'/f'TypeIcons{game}.dll').read_bytes()).hexdigest())
    report=dict(loaded_old_code_matches=True,old_dll_sha256=hashlib.sha256(old_path.read_bytes()).hexdigest(),
                captured_name_bottom=name_bottom,captured_icon_bottom=captured_bottom,corrected=results,
                limitations=['Read-only capture inspection and compiled function fixtures; no game boot or frames.',
                             'Captured native name and OAM data; native gauge creation/update use fixture stubs.'])
    (HERE/'build/player-alignment-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    main()
    if len(sys.argv)>1:verify_capture(*map(Path,sys.argv[1:3]))
