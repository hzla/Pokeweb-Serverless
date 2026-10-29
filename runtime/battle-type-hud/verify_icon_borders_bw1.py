"""Verify BW1's configurable outline literal in its unchanged native renderer."""
import argparse,hashlib,json,struct
from pathlib import Path
from verify_bw1_renderer import Harness,BASE,HERE,panel_index,positions

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--games",nargs="+",choices=["B","W"],default=["B","W"]);args=parser.parse_args()
    manifest=json.loads((HERE.parents[1]/'src/assets/codeinjection/typeIconBorderManifest.json').read_text())
    builds=json.loads((HERE.parents[1]/'src/assets/codeinjection/battleTypeHudManifest.json').read_text())
    rows=[]
    for game in args.games:
        for style,module in [('letters','TypeIcons'),('circular','TypeIconsCircular')]:
            h=Harness(game,module)
            version=builds['games'][game]['variants'][style]['version'];at=manifest['bw1'][game][version]
            h.put(BASE+at,0x6b5a)
            for layout in range(4):
                for pos in positions(layout):
                    h.create(pos,layout,(9,10));h.put(h.g+0x40+0x80*pos+64,layout)
                    h.invoke('Add',h.g,0x1234,h.mons[pos],layout,pos)
                    index=panel_index(pos);bank=h.c.mem_read(h.state+132*index+126,1)[0]
                    assert h.c.mem_read(h.state+792,1)[0]==0 and any(h.image(pos))
                    assert struct.unpack('<H',h.c.mem_read(h.pal+32*bank+4,2))[0]==0x6b5a
                    h.invoke('Del',h.g,pos)
            assert bytes(h.c.mem_read(h.pal,512))==h.originalPalette
            blob=(HERE/'build'/f'{module}{game}.dll').read_bytes()
            rows.append(dict(game=game,style=style,passed=True,dllSha256=hashlib.sha256(blob).hexdigest(),configuredRgb555=0x6b5a,nativeGraphicsAndPalettesUnchanged=True,paletteOwnershipAndCleanup=True,abiRegistersAndStack=True))
            print(game,style,'custom border with native graphics/palette preservation passed',flush=True)
    (HERE/'build/icon-borders/bw1-verification.json').write_text(json.dumps(dict(passed=True,checks=rows,gameplayTested=False),indent=2)+'\n')
if __name__=='__main__':main()
