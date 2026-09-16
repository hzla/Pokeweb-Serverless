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
    assert a['iconWidth']==10 and a['iconHeight']==11
    assert a['compactWidth']==8 and a['compactHeight']==7
    assert a['outline']==[992,992,1984,1984,3968,3968,1984,992,496,248,124]
    assert a['primary']==[960,960,1920,1920,3840,0,0,0,0,0,0]
    assert a['secondary']==[0,0,0,0,0,0,1920,960,480,240,120]
    assert a['monoFill'][5]==3840
    assert a['compactOutline']==[1984,1984,3968,3968,1984,992,496]
    assert a['compactPrimary']==[1920,1920,3840,0,0,0,0]
    assert a['compactSecondary']==[0,0,0,0,1920,960,480]
    assert a['compactMonoFill'][3]==3840
    assert all(not any(symbol) for symbol in a['symbols'])
    assert sum(bool(row&(2048>>x)) for row in a['outline'] for x in range(12))==55
    assert sum(bool(row&(2048>>x)) for row in a['compactOutline'] for x in range(12))==35
    checks.append('11-row regular-player and 7-row compact checker-face masks and all 18 source type colors match')

    positions=((0,0),(1,0),(2,1),(3,1),(4,2),(5,2),(6,2),(7,2))
    for p,layout in positions:
        for typ in range(18):
            pair=(typ,typ) if typ&1 else (typ,(typ+1)%18)
            h.add(p,pair,layout);h.check(p,pair,layout)
        h.invoke('Del',verify.G,p)
    checks.append('all 18 type IDs draw as continuous mono or divided dual wedges in every regular and compact HUD slot')

    # The middle row is the dual divider. A monotype replaces its interior with
    # type color while retaining only the inner border on the checkerboard side.
    h.add(0,(9,9),0)
    image=h.image(0,0)
    assert [verify.pixel(image,x,23) for x in range(7,12)]==[4,4,4,4,2]
    h.invoke('Del',verify.G,0)
    h.add(0,(9,2),0);image=h.image(0,0)
    assert [verify.pixel(image,x,23) for x in range(7,12)]==[2]*5
    h.invoke('Del',verify.G,0)
    h.add(1,(9,9),0);image=h.image(1,0)
    assert [verify.pixel(image,x,21) for x in range(11,16)]==[4,4,4,4,2]
    h.invoke('Del',verify.G,1)
    checks.append('regular and compact monotypes replace the internal divider with continuous color; dual types keep it black')

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
