"""Verify source-to-native crops/alpha/directions and render a review contact sheet."""
import argparse,hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw
import ndspy.narc,ndspy.texture
from convert_fan_followers import convert
HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);a=p.parse_args()
bundle=HERE.parents[1]/'src/assets/following/white2upgrade';m=json.loads((bundle/'later-followers.json').read_text());narc=ndspy.narc.NARC.fromFile(bundle/'later-followers.narc')
def decode(tex,palette):
    values=[index for byte in tex.data1 for index in (byte&15,byte>>4)]
    return [tuple(palette.colors[i][:3])+(31 if i else 0,) for i in values[:tex.width*tex.height]]
verified=0
for r in m['resources']:
    data=narc.files[r['member']];assert hashlib.sha256(data).hexdigest()==r['sha256']
    if r['source']!='fan-png':continue
    path=a.source/r['sourcePath'];im=Image.open(path).convert('RGBA');cell=im.width//4;half=cell//2
    actual=ndspy.texture.NSBTX(data);size=r['size'];colors=actual.palettes[0][1]
    again,*_=convert(path);assert data==again,'Nondeterministic PNG conversion'
    assert len(actual.textures)==(8 if size==32 else 6)
    for j,(_,tex) in enumerate(actual.textures):
        # Independent expected crop: native north/south/west/east = RPG rows 3/0/1/2.
        row=[3,0,1,2][j//2];col=[0,2][j%2]
        source=im.crop((col*cell,row*cell,(col+1)*cell,(row+1)*cell)).resize((half,half),Image.Resampling.NEAREST)
        expected=Image.new('RGBA',(size,size));expected.paste(source,((size-half)//2,size-half))
        rgb=decode(tex,colors);pixels=list(expected.getdata())
        for src,dst in zip(pixels,rgb):
            assert bool(src[3])==bool(dst[3]),(path,j,'alpha/crop')
            if src[3] and not r['conversion']['paletteQuantized']:
                assert tuple(v>>3 for v in src[:3])==dst[:3],(path,j,'palette index')
    verified+=1
# Each row shows actual decoded native up/down/left/right at walking frame zero.
examples=[650,658,666,668,718,720,724,774,810,849,888,906,908,923,964,979,982,1007,1008,1012,1017,1023]
canvas=Image.new('RGB',(620,150*len(examples)+40),(220,220,225));draw=ImageDraw.Draw(canvas)
draw.text((12,10),'Species       UP                 DOWN               LEFT                RIGHT',fill='black')
for row,species in enumerate(examples):
    e=next(x for x in m['appearances'] if x['species']==species and x['form']==0 and not x['shiny'])
    btx=ndspy.texture.NSBTX(narc.files[e['member']]);size=e['size'];draw.text((10,55+row*150),str(species),fill='black')
    for direction in range(4):
        index=direction*2 if direction<3 or size==32 else 4
        tex=btx.textures[index][1];pixels=[tuple(v*255//31 for v in pixel) for pixel in decode(tex,btx.palettes[0][1])]
        image=Image.new('RGBA',(size,size));image.putdata(pixels)
        if direction==3 and size==64:image=image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        # Fixed scale: large artwork remains larger instead of filling every cell.
        image=image.resize((size*2,size*2),Image.Resampling.NEAREST)
        canvas.paste(image,(80+direction*134+(128-size*2)//2,35+row*150+140-size*2),image)
output=HERE/'build/white2upgrade-test';output.mkdir(parents=True,exist_ok=True);canvas.save(output/'converted-preview.png')
print(f'{verified} PNG resources reproduce deterministically; every frame matches source crop, direction, transparency, and exact palettes where <=15 visible colors. Contact sheet generated.')
