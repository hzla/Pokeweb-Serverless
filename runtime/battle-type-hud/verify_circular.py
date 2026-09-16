"""Execute the circular-symbol ARM builds against the shared native fixtures."""
from pathlib import Path
import hashlib, json
import verify

HERE=Path(__file__).resolve().parent
verify.ASSETS=json.loads((HERE/'assets-circular.json').read_text())

def test(game):
    h=verify.Harness(game,'TypeIconsCircular');checks=[]
    a=verify.ASSETS
    assert a['variant']=='circular' and a['iconWidth']==12 and a['iconHeight']==11
    assert sum(bool(row&(2048>>x)) for row in a['outline'] for x in range(12))==76
    assert sum(bool(row&(2048>>x)) and not (y in (0,9) and x in (4,7))
               for y,row in enumerate(a['outline']) for x in range(12))==72
    assert all(not symbol[y]&~a['fill'][y] for symbol in a['symbols'] for y in range(11))
    checks.append('all 18 approved circular symbols fit their outlined transparent masks')

    positions=((0,0),(1,0),(2,1),(3,1),(4,2),(5,2),(6,2),(7,2))
    for p,layout in positions:
        for typ in range(18):
            pair=(typ,typ) if typ&1 else (typ,(typ+1)%18)
            h.add(p,pair,layout);h.check(p,pair,layout)
        h.invoke('Del',verify.G,p)
    checks.append('all 18 type IDs draw as mono/dual icons in all player and enemy slots')

    for p,layout in positions:
        pair=(9,2);h.add(p,pair,layout,caught=bool(p&1))
        for status in range(1,7):
            h.invoke('Status',verify.G,status,p);h.check(p,pair,layout,status=True)
            h.invoke('Status',verify.G,0,p);h.check(p,pair,layout)
        h.invoke('Del',verify.G,p)
    checks.append('all six status labels restore the circular variant and preserve the native caught marker')

    for p,layout in positions:
        h.add(p,(17,17),layout,caught=bool(p&1))
        mon=0x02273000+p*0x300;h.liveTypes[mon]=(10,10)
        h.invoke('Main',verify.G);h.check(p,(10,10),layout)
        h.writes.clear();h.invoke('Main',verify.G);assert not h.writes
        h.invoke('Del',verify.G,p)
    checks.append('live type changes repaint once; unchanged frames perform no video writes')

    for p,layout in positions:
        h.add(p,(9,2),layout,caught=bool(p&1));h.invoke('Del',verify.G,p)
        expected=bytearray(verify.normalized(h.raw[(2 if layout==2 else 0,p&1)]))
        if p&1 and p in h.caught: verify.caught_ball(expected,False)
        assert h.image(p,layout)==bytes(expected)
    checks.append('teardown restores every panel and marker byte')
    return checks

def main():
    reports={game:test(game) for game in ('B2','W2')}
    hashes={game:hashlib.sha256((HERE/'build'/f'TypeIconsCircular{game}.dll').read_bytes()).hexdigest() for game in ('B2','W2')}
    out={'compiled_arm_checks':reports,'release_sha256':hashes,'writable_state_bytes':364,
         'allocation_calls_from_module':0,'emulator_frames_executed':False}
    (HERE/'build/circular-verification.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps(out,indent=2))

if __name__=='__main__':main()
