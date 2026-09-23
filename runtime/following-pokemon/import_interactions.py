"""Import audited English or Italian neutral-mood HeartGold reactions."""
import argparse, hashlib, json, struct, zlib
from pathlib import Path
import ndspy.rom, ndspy.narc, ndspy.texture
HERE=Path(__file__).resolve().parent
ASSETS=HERE.parents[1]/'src/assets/following'
SOURCE={
 'en': {'code':b'IPKE','sha256':'65f02a56842b75aa92d775d56d657a56fe3fa993550b04dc20704ab82d760105'},
 'it': {'code':b'IPKI','sha256':'013d04f5512b01ad98735a5f850dc039f0ee80bc57035b3a10e8b650be690ce1',
        'messageSha256':'18209e26335e88f826ce056bd6dfe48c3f862569f3feb292f9535c1e20b5679a'},
}
COMMON_ARCHIVES={'a/2/2/0':'cb485461c656c1feb6219b5583db610870d9177e95502fb55227ee872d053447',
 'a/2/2/1':'ef26df849cc5a59347ac34365e5c7c81cf7b787ecdcc9f038da1cd87ff595f09',
 'a/2/2/2':'f2eb692d2c50f60bf794931d4c70b64cb7e460ed21cb88a93fa20a5c17e3b913',
 'a/1/0/3':'45486a7c13c393fb8ad420c794a072903417a661f04c894422aa4d35a5d32061'}

def canonical_narc(files):
    archive=ndspy.narc.NARC();archive.files=files;data=archive.save()
    fat_end=16+struct.unpack_from('<I',data,20)[0]
    fnt_end=fat_end+struct.unpack_from('<I',data,fat_end+4)[0]
    data=bytearray(data[:fat_end]+b'BTNF'+struct.pack('<I',16)+bytes.fromhex('0400000000000100')+data[fnt_end:])
    struct.pack_into('<I',data,8,len(data));return bytes(data)

def message_words(data,index,language='en'):
    _,key=struct.unpack_from('<HH',data)
    mask=((765*(index+1)*key)&65535)*65537
    offset,length=struct.unpack_from('<II',data,4+index*8);offset^=mask;length^=mask
    if offset+2*length>len(data):raise ValueError('Invalid HGSS text allocation')
    key=((index+1)*596947)&65535;words=[]
    for i in range(length):
        words.append(struct.unpack_from('<H',data,offset+2*i)[0]^key);key=(key+18749)&65535
    out=[];i=0
    punctuation={0x1de:32,0x1ab:33,0x1ac:63,0x1ad:44,0x1ae:46,0x1af:0x2026,0x1b2:39,0x1b3:39,0xe000:0xfffe}
    while i<len(words):
        c=words[i];i+=1
        if c==65535:break
        if c==65534:
            kind,count=words[i:i+2];args=words[i+2:i+2+count];i+=2+count
            if (kind,args)==(0x101,[0,0]):out.append(0xfff0)
            elif (kind,args)==(0x103,[2,0]):out.append(0xfff1)
            else:raise ValueError(('Unsupported substitution',kind,args))
        elif 0x121<=c<=0x12a:out.append(48+c-0x121)
        elif 0x12b<=c<=0x144:out.append(65+c-0x12b)
        elif 0x145<=c<=0x15e:out.append(97+c-0x145)
        elif c in punctuation:out.append(punctuation[c])
        elif language=='it' and c==0x187:out.append(0x00e8)
        else:raise ValueError(('Unsupported glyph',hex(c)))
    if len(out)+1>128:raise ValueError('Follower text exceeds the installed message limit')
    return out+[65535]

def build(rompath,language='en'):
    if language not in SOURCE:raise ValueError('Unsupported follower language')
    rawrom=Path(rompath).read_bytes()
    if hashlib.sha256(rawrom).hexdigest()!=SOURCE[language]['sha256']:
        raise ValueError('HeartGold ROM fingerprint does not match the audited language source')
    rom=ndspy.rom.NintendoDSRom.fromFile(rompath)
    if bytes(rom.idCode)!=SOURCE[language]['code']:raise ValueError('Unexpected HeartGold game code')
    for path,expected in COMMON_ARCHIVES.items():
        if hashlib.sha256(rom.getFileByName(path)).hexdigest()!=expected:
            raise ValueError('HeartGold follower reaction/motion/emote archive differs: '+path)
    def arc(path):return ndspy.narc.NARC(rom.getFileByName(path)).files
    occurrences=arc('a/2/2/0')[0];reactions=arc('a/2/2/1');motions=arc('a/2/2/2');messages=arc('a/0/2/7')[265];effects=arc('a/1/0/3')
    if language=='it' and hashlib.sha256(messages).hexdigest()!=SOURCE[language]['messageSha256']:
        raise ValueError('Italian HeartGold message bank 265 fingerprint differs')
    if len(occurrences)!=1400 or struct.unpack_from('<H',messages)[0]!=759:raise ValueError('Unexpected reaction layout')
    rules=[];mids=set();aids=set();bids=set();excluded=[]
    for i in range(70):
        d=occurrences[i*20:(i+1)*20];w8,w10,zone,attr=struct.unpack_from('<HHHH',d,8);rc=w10>>6
        # Keep only HP, status, friendship, facing and neutral/unspecified mood.
        if not rc or d[2]&31 or any(d[3:8]) or w8&8191 or w10&63 or zone or attr or d[16] or any(d[18:20]) or (d[1]&15) not in (0,5,9):
            excluded.append(i);continue
        raw=reactions[rc-1]
        if len(raw)!=52:raise ValueError('Reaction record size')
        select,yes,no,friend,mood,acce,leaf=struct.unpack_from('<IHHbbBB',raw,40)
        if select or yes or no or acce or leaf:raise ValueError('Unexpected branch or reward')
        steps=[]
        for j in range(5):
            action,msg,se,bubble,wait=struct.unpack_from('<HHHBB',raw,j*8)
            if action==65535:break
            if se not in (0,2379,2380):raise ValueError('Unexpected sound')
            if action:aids.add(action)
            if msg:mids.add(msg-1)
            if bubble:bids.add(bubble)
            steps.append((action,msg,se,bubble,wait))
        rules.append((rc,d[0],d[1]>>4,d[2]>>5,w8>>13,d[17],steps))
    mids=sorted(mids);aids=sorted(aids);bids=sorted(bids)
    assert (len(rules),len(mids),len(aids),len(bids))==(34,27,12,7)
    # Header: magic, ABI, total bytes, payload CRC, four counts, four offsets.
    data=bytearray(48);ro=len(data);data.extend(bytes(len(rules)*12))
    ao=len(data)
    for aid in aids:
        raw=motions[aid-1];steps=[]
        for j in range(0,len(raw),8):
            direction,frames,x,y,z,sound=struct.unpack_from('<BBbbbB',raw,j)
            if direction==255:break
            steps.append(struct.pack('<BBbbbBxx',direction,max(1,frames),x,y,z,sound))
        if not 1<=len(steps)<=10:raise ValueError('Motion size')
        data.extend(struct.pack('<HBB',aid,len(steps),0)+b''.join(steps)+bytes((10-len(steps))*8))
    mo=len(data);data.extend(bytes(len(mids)*8));bo=len(data);resources=[]
    source_members={1:2,2:3,4:5,6:7,7:8,12:13,13:14}
    for bid in bids:
        tex=ndspy.texture.NSBTX(effects[source_members[bid]])
        if len(tex.textures)!=2 or len(tex.palettes)!=1:raise ValueError('Unexpected emote texture')
        frames=tex.textures[:];first=len(resources)
        if any((t.width,t.height,int(t.format))!=(32,32,3) for _,t in frames):raise ValueError('Emotes require 32px I4 textures')
        for frame in frames:
            tex.textures=[frame];resources.append(tex.save())
        # The HGSS controller uses the stored frame values as durations.
        timing=effects[149+bid]
        if timing!=bytes.fromhex('040000000000040008000c000001000100000000'):raise ValueError('Emote timing changed')
        data.extend(struct.pack('<BBH4H4B',bid,4,first,1,4,8,12,0,1,0,1))
    for i,(rc,hp,friend,status,direction,chance,steps) in enumerate(rules):
        struct.pack_into('<H6BI',data,ro+i*12,rc,hp,friend,status,direction,chance,len(steps),len(data))
        for action,msg,se,bubble,wait in steps:
            data.extend(struct.pack('<HHHBB',aids.index(action)+1 if action else 0,mids.index(msg-1)+1 if msg else 0,se-2378 if se else 0,bids.index(bubble)+1 if bubble else 0,wait))
    text_manifest=[]
    for i,mid in enumerate(mids):
        words=message_words(messages,mid,language)
        struct.pack_into('<IHH',data,mo+i*8,len(data),len(words),mid)
        data.extend(struct.pack('<'+'H'*len(words),*words))
        text_manifest.append({'sourceMessage':mid,'text':''.join('{nickname}' if c==0xfff0 else '{player}' if c==0xfff1 else '\n' if c==0xfffe else chr(c) for c in words[:-1])})
    emotes=canonical_narc(resources)
    struct.pack_into('<4I4H6I',data,0,0x4b545746,1,len(data),0,len(rules),len(aids),len(mids),len(bids),ro,ao,mo,bo,len(emotes),zlib.crc32(emotes))
    # Recompute after counts and offsets have been populated.
    struct.pack_into('<I',data,12,zlib.crc32(data[16:]));data=bytes(data);emotes=canonical_narc(resources)
    if len(data)>8192:raise ValueError('Follower interaction package exceeds the 8 KiB runtime buffer')
    manifest={'schemaVersion':1,'sourceGame':'HeartGold '+SOURCE[language]['code'].decode(),'mood':0,'rules':34,'messages':27,'motions':12,'emotes':7,'resourceMembers':14,'dataSha256':hashlib.sha256(data).hexdigest(),'dataBytes':len(data),'emotesSha256':hashlib.sha256(emotes).hexdigest(),'emotesBytes':len(emotes),'emotesCrc32':zlib.crc32(emotes),'sourceRuleIds':[r[0] for r in rules],'excludedOccurrenceRows':excluded,'texts':text_manifest}
    output=ASSETS if language=='en' else ASSETS/'white2italy'
    output.mkdir(parents=True,exist_ok=True)
    if language=='it':
        manifest.update(language='it',sourceRomSha256=SOURCE[language]['sha256'],sourceMessageBankSha256=SOURCE[language]['messageSha256'])
    (output/'interactions.bin').write_bytes(data)
    if language=='en':(output/'interaction-emotes.narc').write_bytes(emotes)
    (output/'interactions.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(f'Imported {len(rules)} rules, {len(mids)} messages, {len(aids)} motions, {len(bids)} emotes; {len(data)} + {len(emotes)} bytes')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('rom',type=Path);p.add_argument('--language',choices=tuple(SOURCE),default='en');args=p.parse_args();build(args.rom,args.language)
