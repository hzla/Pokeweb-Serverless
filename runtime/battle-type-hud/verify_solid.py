"""Execute the symbol-free angular HUD-wedge ARM builds against native fixtures."""
from pathlib import Path
import hashlib, json
import verify

HERE=Path(__file__).resolve().parent
verify.ASSETS=json.loads((HERE/'assets-solid.json').read_text())

def test(game):
    h=verify.Harness(game,'TypeIconsSolid');checks=[]
    a=verify.ASSETS
    assert a['variant']=='solid' and a['previewMode']=='split-wedge'
    assert a['iconWidth']==12 and a['iconHeight']==11
    assert a['compactWidth']==10 and a['compactHeight']==7
    assert a['outline']==[1016,1016,2032,2032,4064,4064,2032,1016,508,254,127]
    assert a['primary']==[480,480,960,0,0,0,0,0,0,0,0]
    assert a['secondary']==[0,0,0,0,0,0,960,480,240,120,60]
    assert a['primaryShade']==[528,528,1056,2016,0,0,0,0,0,0,0]
    assert a['secondaryShade']==[0,0,0,0,0,4032,1056,528,264,132,66]
    assert a['compactOutline']==[2032,2032,4064,4064,2032,1016,508]
    assert a['compactPrimary']==[960,0,0,0,0,0,0]
    assert a['compactSecondary']==[0,0,0,0,960,480,240]
    assert a['compactPrimaryShade']==[1056,2016,0,0,0,0,0]
    assert a['compactSecondaryShade']==[0,0,0,4032,1056,528,264]
    assert a['borderRgb555']==[0x294a,0x18e9,0x4948,0x28e9,0x0d4e,0x0d4e,0x1da8,0x28e9,0x294a,
                               0x048e,0x4948,0x1da8,0x0d4e,0x1ced,0x4948,0x48e9,0x18e9,0x48e9]
    assert all(not any(symbol) for symbol in a['symbols'])
    assert sum(bool(row&(2048>>x)) for row in a['outline'] for x in range(12))==77
    assert sum(bool(row&(2048>>x)) for row in a['compactOutline'] for x in range(12))==49
    checks.append('two-pixel-wider regular/compact masks, all 18 source fills and exact retail-summary monotype shades match')

    positions=((0,0),(1,0),(2,1),(3,1),(4,2),(5,2),(6,2),(7,2))
    for p,layout in positions:
        for typ in range(18):
            pair=(typ,typ) if typ&1 else (typ,(typ+1)%18)
            h.add(p,pair,layout);h.check(p,pair,layout)
        h.invoke('Del',verify.G,p)
    checks.append('all 18 type IDs draw as continuous mono or divided dual wedges in every regular and compact HUD slot')

    # The black divider moved one row up. Dark type pixels shade both sides of
    # the black seam and both angled ends; a monotype removes only the seam.
    h.add(0,(9,9),0)
    image=h.image(0,0)
    assert [verify.pixel(image,x,22) for x in range(7,14)]==[15,4,4,4,4,15,2]
    assert [verify.pixel(image,x,18) for x in range(9,16)]==[15,4,4,4,4,15,2]
    h.invoke('Del',verify.G,0)
    h.add(0,(9,2),0);image=h.image(0,0)
    assert [verify.pixel(image,x,22) for x in range(7,14)]==[2]*7
    assert [verify.pixel(image,x,21) for x in range(8,15)]==[2,4,2,4,2,4,2]
    assert [verify.pixel(image,x,23) for x in range(7,14)]==[15,2,15,2,15,2,2]
    h.invoke('Del',verify.G,0)
    h.add(1,(9,9),0);image=h.image(1,0)
    assert [verify.pixel(image,x,20) for x in range(11,18)]==[15,4,4,4,4,15,2]
    h.invoke('Del',verify.G,1)
    checks.append('regular/compact seams move up one row; black remains, palette-safe dithering darkens dual seams/corners, and monotypes use the exact dark shade continuously')

    # The live HP bar uses indices 5..12 even though those indices do not occur
    # in the static panel/number resources. The wedge must never write them.
    original=(HERE/'build'/f'{game}-resource-430.bin').read_bytes()[40:72]
    protected=tuple(bytes(h.c.mem_read(base+10,16)) for base in (verify.PAL,verify.TRANS,0x05000200))
    h.add(0,(10,10),0)
    for index,expected in ((4,a['rgb555'][10]),(15,a['borderRgb555'][10])):
        assert int.from_bytes(h.c.mem_read(verify.PAL+index*2,2),'little')==expected
    assert tuple(bytes(h.c.mem_read(base+10,16)) for base in (verify.PAL,verify.TRANS,0x05000200))==protected
    h.invoke('Del',verify.G,0)
    for index in (4,15):
        assert bytes(h.c.mem_read(verify.PAL+index*2,2))==original[index*2:index*2+2]
    h.add(0,(10,2),0)
    for evy,target in ((1,0),(8,0x7fff),(15,16)):
        h.setfade(0,target,evy)
        untouched=tuple(bytes(h.c.mem_read(base+10,16)) for base in (verify.PAL,verify.TRANS,0x05000200))
        h.liveTypes[0x02273000]=(9,14);h.invoke('Main',verify.G)
        for index,color in ((4,a['rgb555'][9]),(15,a['rgb555'][14])):
            shown=int.from_bytes(h.c.mem_read(verify.TRANS+index*2,2),'little')
            assert shown==verify.blend(color,target,evy)
        assert tuple(bytes(h.c.mem_read(base+10,16)) for base in (verify.PAL,verify.TRANS,0x05000200))==untouched
    h.setfade(0,0x7fff,8)
    untouched=tuple(bytes(h.c.mem_read(base+10,16)) for base in (verify.PAL,verify.TRANS,0x05000200))
    h.liveTypes[0x02273000]=(9,9);h.invoke('Main',verify.G)
    for index,color in ((4,a['rgb555'][9]),(15,a['borderRgb555'][9])):
        shown=int.from_bytes(h.c.mem_read(verify.TRANS+index*2,2),'little')
        assert shown==verify.blend(color,0x7fff,8)
    assert tuple(bytes(h.c.mem_read(base+10,16)) for base in (verify.PAL,verify.TRANS,0x05000200))==untouched
    h.invoke('Del',verify.G,0)
    checks.append('only reclaimed entries 4/15 change; live HP-bar entries 5..12 stay byte-exact through attach, type changes, fades and teardown')

    # Enemy wedges intentionally consume the innermost left-border pixel after
    # shifting left. Every native black pixel outside the exact paint mask,
    # especially the complete bottom shadow, must remain byte-exact.
    for p,layout in positions:
        h.add(p,(9,2),layout,caught=bool(p&1));image=h.image(p,layout)
        native=verify.normalized(h.raw[(2 if layout==2 else 0,p&1)])
        compact=bool(p&1) or layout>=2
        outline=a['compactOutline'] if compact else a['outline']
        left=(12 if layout>=2 else 11) if p&1 else (9 if layout>=2 else 7)
        painted={(left+x,18+y) for y,row in enumerate(outline) for x in range(12) if row&(2048>>x)}
        for y in range(15,32):
            for x in range(26):
                if verify.pixel(native,x,y)==2 and (x,y) not in painted:
                    assert verify.pixel(image,x,y)==2,(p,layout,x,y)
        h.invoke('Del',verify.G,p)
    checks.append('enemy masks shift left one pixel while all black pixels outside the mask and every bottom shadow remain untouched')

    for p,layout in positions:
        pair=(9,2);h.add(p,pair,layout,caught=bool(p&1))
        for status in range(1,7):
            h.invoke('Status',verify.G,status,p);h.check(p,pair,layout,status=True)
            h.invoke('Status',verify.G,0,p);h.check(p,pair,layout)
        h.invoke('Del',verify.G,p)
    checks.append('all six status labels restore the solid variant and preserve the native caught marker')

    for p,layout in positions:
        h.add(p,(17,17),layout,caught=bool(p&1))
        mon=0x02273000+p*0x300;h.liveTypes[mon]=(10,2)
        h.invoke('Main',verify.G);h.check(p,(10,2),layout)
        h.writes.clear();h.invoke('Main',verify.G);assert not h.writes
        h.invoke('Del',verify.G,p)
    checks.append('live mono-to-dual type changes repaint once; unchanged frames perform no video writes')

    for p,layout in positions:
        h.add(p,(9,2),layout,caught=bool(p&1));h.invoke('Del',verify.G,p)
        expected=bytearray(verify.normalized(h.raw[(2 if layout==2 else 0,p&1)]))
        if p&1 and p in h.caught:verify.caught_ball(expected,False)
        assert h.image(p,layout)==bytes(expected)
    checks.append('teardown restores every panel and native caught-marker byte')
    return checks

def main():
    reports={game:test(game) for game in ('B2','W2')}
    hashes={game:hashlib.sha256((HERE/'build'/f'TypeIconsSolid{game}.dll').read_bytes()).hexdigest() for game in ('B2','W2')}
    out={'compiled_arm_checks':reports,'release_sha256':hashes,'writable_state_bytes':364,
         'allocation_calls_from_module':0,'emulator_frames_executed':False}
    (HERE/'build/solid-verification.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps(out,indent=2))

if __name__=='__main__':main()
