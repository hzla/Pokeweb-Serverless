"""Compare unchanged move-screen pixels against the isolated native baseline."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
import ndspy.rom,ndspy.narc
HERE=Path(__file__).resolve().parent
rom=ndspy.rom.NintendoDSRom.fromFile(HERE.parents[2]/'cleanwhite2.nds')
files=ndspy.narc.NARC(rom.getFileByName('a/0/8/2')).files
results=[]
for frame in [1500,1700]:
    patched=np.asarray(Image.open(HERE/f'build/emulator-W2/frame-{frame}.png'))
    baseline=np.asarray(Image.open(HERE/f'build/emulator-W2-native/frame-{frame}.png'))
    for row,member in enumerate([50,43,48,39]):
        raw=files[member][48:];mask=np.zeros((16,32),bool)
        for tile in range(8):
            for pixel in range(64):
                mask[tile//4*8+pixel//8,tile%4*8+pixel%8]=bool((raw[tile*32+pixel//2]>>(pixel%2*4))&15)
        y=192+17+row*32
        a=patched[y:y+16,18:50][mask];b=baseline[y:y+16,18:50][mask]
        assert np.array_equal(a,b),(frame,member,'native move badge changed')
        results.append({'frame':frame,'member':member,'identicalOpaquePixels':int(mask.sum())})
    # Compare these rectangles on Stats. Move details has an animated selected
    # plate underneath, whose native flashing phase can differ by one tick.
    if frame==1500:
        for x in [80,114]:
            assert np.array_equal(patched[200:216,x:x+32],baseline[200:216,x:x+32]),(frame,'information badge leaked')
    if frame==1700:
        for x,y,label in [(156,48,'move category'),(192,304,'Pokemon type in move details')]:
            assert np.array_equal(patched[y:y+16,x:x+32],baseline[y:y+16,x:x+32]),label
(HERE/'build/render-comparison.json').write_text(json.dumps(results,indent=2)+'\n')
print('Native move badges, category, move-details Pokemon type and hidden information actors match the unmodified-icon baseline exactly.')
