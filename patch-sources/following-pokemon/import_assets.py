"""Deterministic PNG, HGSS BTX and hg-engine bundle to follower asset-pack importer.

Each appearance and frame mapping is explicit in an input JSON manifest. Files
are read only. The output is a data-only ZIP consumable by the asset editor.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import zipfile
from PIL import Image
import ndspy.texture

def pixel_list(image):
    return list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())

def key_string(k):
    if not isinstance(k.get('shiny'), bool): raise ValueError('shiny must be boolean')
    for name, lo, hi in [('species',1,649),('form',0,255),('gender',0,2)]:
        if type(k.get(name)) is not int or not lo<=k[name]<=hi: raise ValueError('Invalid '+name)
    return f"{k['species']}:{k['form']}:{k['gender']}:{int(k['shiny'])}"

def palette(path):
    lines=Path(path).read_text().splitlines()
    if lines[:2]!=['JASC-PAL','0100'] or int(lines[2])!=16 or len(lines)<19: raise ValueError('Expected a 16-color JASC palette')
    colors=[tuple(map(int,line.split())) for line in lines[3:19]]
    if any(len(c)!=3 or any(v<0 or v>255 for v in c) for c in colors):raise ValueError('Invalid palette color')
    return colors

def decode_i4(texture, palette):
    if int(texture.format)!=3 or texture.width not in (32,64) or texture.height!=texture.width or not texture.isColor0Transparent:
        raise ValueError('Expected square I4 HGSS texture with color-zero transparency')
    size=texture.width
    if len(texture.data1)!=size*size//2:raise ValueError('Truncated HGSS texture')
    raw=palette.save()[3]
    if len(raw)<32:raise ValueError('Truncated HGSS palette')
    words=struct.unpack_from('<16H',raw)
    def rgba(index):
        word=words[index];channels=[(word>>shift)&31 for shift in (0,5,10)]
        return tuple((v<<3)|(v>>2) for v in channels)+(255 if index else 0,)
    colors=[rgba(i) for i in range(16)]
    pixels=[colors[(texture.data1[i//2]>>(4*(i%2)))&15] for i in range(size*size)]
    image=Image.new('RGBA',(size,size));image.putdata(pixels);return image

def frames_from_entry(entry, base):
    source=entry['source']; path=base/entry['path']
    if source=='png':
        im=Image.open(path).convert('RGBA');size=im.width//2
        if size not in (32,64) or im.size!=(size*2,size*4):raise ValueError('PNG template must be 64x128 or 128x256')
        return [im.crop(((i%2)*size,(i//2)*size,(i%2+1)*size,(i//2+1)*size)) for i in range(8)]
    indices=entry.get('frameIndices')
    if not isinstance(indices,list) or len(indices)!=8 or any(type(i) is not int or i<0 for i in indices):raise ValueError('Supply eight explicit frameIndices in up/down/left/right pose order')
    if source=='hgss':
        btx=ndspy.texture.NSBTX(path.read_bytes());pal=entry['paletteIndex']
        if type(pal) is not int or not 0<=pal<len(btx.palettes):raise ValueError('Invalid HGSS palette index')
        if max(indices)>=len(btx.textures):raise ValueError('HGSS frame index is out of range')
        return [decode_i4(btx.textures[i][1],btx.palettes[pal][1]) for i in indices]
    if source=='hg-engine':
        metadata=json.loads((base/entry['metadata']).read_text());im=Image.open(path)
        if im.mode!='P':raise ValueError('hg-engine PNG must retain indexed palette values')
        colors=palette(base/entry['palette']);records=list(metadata['frames'].values());frames=[]
        if max(indices)>=len(records):raise ValueError('hg-engine frame index out of range')
        for index in indices:
            rec=records[index];size=rec['width']
            if size not in (32,64) or rec['height']!=size or rec['format']!=3 or rec['color0']!=1:raise ValueError('Unsupported hg-engine texture format')
            if rec.get('flipX') or rec.get('flipY'):raise ValueError('Normalize texture coordinate mirroring before importing')
            top=rec['frame']*size
            if im.width!=size or top<0 or top+size>im.height:raise ValueError('hg-engine frame is outside PNG bounds')
            pixels=pixel_list(im.crop((0,top,size,top+size)))
            if any(i>=16 for i in pixels):raise ValueError('Indexed PNG exceeds I4 palette')
            frame=Image.new('RGBA',(size,size));frame.putdata([(*colors[i],255 if i else 0) for i in pixels]);frames.append(frame)
        return frames
    raise ValueError('Unsupported import source')

def encode(frames):
    size=frames[0].width
    if len(frames)!=8 or size not in (32,64) or any(f.size!=(size,size) for f in frames):raise ValueError('Expected eight equal 32/64-pixel square frames')
    pixels=[pixel_list(f.convert('RGBA')) for f in frames]
    def color(p):return (p[0]>>3)|((p[1]>>3)<<5)|((p[2]>>3)<<10)
    if any(p[3] not in (0,255) for frame in pixels for p in frame):raise ValueError('Partial alpha is unsupported')
    colors=sorted({color(p) for frame in pixels for p in frame if p[3]})
    if len(colors)>15:raise ValueError('Artwork exceeds 15 opaque DS colors')
    lookup={c:i+1 for i,c in enumerate(colors)}
    btx=ndspy.texture.NSBTX();exponent={32:2,64:3}[size]
    params=(exponent<<4)|(exponent<<7)|(3<<10)|0x2000
    for i,frame in enumerate(pixels):
        indices=[lookup[color(p)] if p[3] else 0 for p in frame]
        data=bytes(indices[j]|indices[j+1]<<4 for j in range(0,len(indices),2))
        btx.textures.append((f'following{i}',ndspy.texture.Texture(0,0,params,size|size<<11,data,b'')))
    pal=struct.pack('<16H',0,*colors,*([0]*(15-len(colors))))
    btx.palettes=[('following',ndspy.texture.Palette(0,0,0,pal))]
    return btx.save()

def convert(manifest_path,catalog_path,output):
    manifest_path=Path(manifest_path);manifest=json.loads(manifest_path.read_text());base=manifest_path.parent
    catalog=json.loads(Path(catalog_path).read_text());valid={key_string(e['key']) for e in catalog['entries']}
    entries=manifest['entries']
    if manifest.get('schemaVersion')!=1 or not 1<=len(entries)<=4096:raise ValueError('Unsupported import manifest')
    files={};out=[];seen=set()
    for entry in entries:
        key=key_string(entry['key'])
        if key not in valid or key in seen:raise ValueError('Invalid or duplicate catalog appearance '+key)
        seen.add(key);data=encode(frames_from_entry(entry,base));name='assets/'+key.replace(':','-')+'.btx';files[name]=data
        placeholder=entry.get('placeholder',False);reason=entry.get('placeholderReason')
        if type(placeholder) is not bool or (placeholder and not reason):raise ValueError('Placeholder imports require an explicit reason')
        out.append({'key':entry['key'],'path':name,'profile':'pokemon-asymmetric','source':entry['source'],
                    'placeholder':placeholder,'placeholderReason':reason,'sha256':hashlib.sha256(data).hexdigest()})
    files['manifest.json']=(json.dumps({'schemaVersion':1,'entries':out},sort_keys=True,indent=2)+'\n').encode()
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in sorted(files.items()):
            info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
            archive.writestr(info,data,compresslevel=9)
    # No output until every input has passed validation.
    Path(output).write_bytes(stream.getvalue())
    print(f'Imported {len(out)} explicitly mapped appearances. No ROM or runtime was modified.')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('manifest',type=Path);p.add_argument('--catalog',required=True,type=Path);p.add_argument('--output',required=True,type=Path)
    a=p.parse_args();convert(a.manifest,a.catalog,a.output)
