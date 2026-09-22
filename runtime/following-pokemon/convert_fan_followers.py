"""Convert user-supplied 4x4, 2x RPG follower sheets to native White 2 billboards."""
from collections import Counter
import hashlib
import struct
from PIL import Image
import ndspy.texture

# RPG sheet rows: south, west, east, north. Columns 0/2 are the opposing steps.
ROW_ORDER = [3, 0, 1, 2]
COLUMN_ORDER = [0, 2]

def convert(path):
    original=Image.open(path).convert('RGBA')
    if original.width!=original.height or original.width not in (256,280,320,512):
        raise ValueError(f'Unsupported 4x4 sheet dimensions: {path.name}: {original.size}')
    cell=original.width//4;half=cell//2;size=32 if half<=32 else 64
    directions=ROW_ORDER if size==32 else ROW_ORDER[:3]
    frames=[]
    for row in directions:
        for col in COLUMN_ORDER:
            frame=original.crop((col*cell,row*cell,(col+1)*cell,(row+1)*cell))
            if any(a not in (0,255) for a in frame.getchannel('A').getdata()):
                raise ValueError(f'Unexpected partial alpha: {path.name}')
            frame=frame.resize((half,half),Image.Resampling.NEAREST)
            canvas=Image.new('RGBA',(size,size));canvas.paste(frame,((size-half)//2,size-half))
            frames.append(canvas)
    pixels=[p for f in frames for p in f.getdata()]
    def rgb555(p):return tuple((v>>3)<<3 for v in p[:3])
    colors=Counter(rgb555(p) for p in pixels if p[3])
    if not colors:raise ValueError(f'Empty sprite: {path.name}')
    if any(r>=248 and g<=8 and b>=248 for r,g,b in colors):
        raise ValueError(f'Visible sentinel magenta in supplied artwork: {path.name}')
    # Index zero is reserved solely for alpha, never inferred from an RGB color.
    quantized=len(colors)>15
    if not quantized:palette=sorted(colors)
    else:
        # Deterministic farthest-color selection keeps rare, distinct accents
        # instead of averaging them into an unrelated hue. Colors are medoids
        # from the actual DS-rounded source palette; no dithering is introduced.
        palette=[max(colors,key=lambda c:(colors[c],c))]
        while len(palette)<15:
            palette.append(max((c for c in colors if c not in palette),key=lambda c:(
                min(sum((c[j]-p[j])**2 for j in range(3)) for p in palette),colors[c],c)))
        palette.sort()
    lookup={c:1+min(range(len(palette)),key=lambda i:sum((c[j]-palette[i][j])**2 for j in range(3))) for c in colors}
    indexed=[lookup[rgb555(p)] if p[3] else 0 for p in pixels]
    pal=[(0,0,0)]+palette+[(0,0,0)]*(15-len(palette))
    btx=ndspy.texture.NSBTX();exp={32:2,64:3}[size]
    params=(exp<<4)|(exp<<7)|(3<<10)|0x2000
    for i in range(len(frames)):
        frame=indexed[i*size*size:(i+1)*size*size]
        data=bytes(frame[j]|frame[j+1]<<4 for j in range(0,len(frame),2))
        btx.textures.append((f'following{i}',ndspy.texture.Texture(0,0,params,size|size<<11,data,b'')))
    packed=struct.pack('<16H',*[(r>>3)|((g>>3)<<5)|((b>>3)<<10) for r,g,b in pal])
    btx.palettes=[('following',ndspy.texture.Palette(0,0,0,packed))]
    meta={'sourceSheetSize':original.width,'sourceRows':directions,'sourceColumns':COLUMN_ORDER,'scaleDivisor':2,
          'padding':[ (size-half)//2,size-half ],'sourceVisibleColors555':len(colors),'outputVisibleColors':len(palette),
          'paletteQuantized':quantized,'maxChannelError':max(max(abs(c[j]-palette[lookup[c]-1][j]) for j in range(3)) for c in colors),
          'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    return btx.save(),size,'pokemon-asymmetric' if size==32 else 'pokemon-mirrored',meta
