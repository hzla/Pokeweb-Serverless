"""Pin native US BW1 Learnset bindings and generate candidate build inputs.

Entries retain their actual ARM/Thumb modes. Profiles are disabled until the
compiled and DS gameplay acceptance suites are complete for both retail games.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB
import ndspy.rom
import ndspy.narc
import ndspy.codeCompression
import ndspy.lz10
from background import profile, header

HERE=Path(__file__).resolve().parent
WORKSPACE=HERE.parents[2]
BINDINGS={
    0x2006255: (0x20061e5, 0x20061e5),
    0x2016a99: (0x20120b5, 0x20120b5),
    0x2016ad9: (0x20120f5, 0x20120f5),
    0x201735d: (0x2012935, 0x2012935),
    0x201736d: (0x2012945, 0x2012945),
    0x201cd25: (0x2017e1d, 0x2017e39),
    0x201fe25: (0x201aa19, 0x201aa35),
    0x201ff35: (0x201ab29, 0x201ab45),
    0x20204ad: (0x201afd5, 0x201aff1),
    0x2020fc1: (0x201babd, 0x201bad9),
    0x2021061: (0x201bb5d, 0x201bb79),
    0x20216dd: (0x201c159, 0x201c175),
    0x2021d55: (0x201c7d1, 0x201c7ed),
    0x20228b5: (0x201d305, 0x201d321),
    0x2024f8d: (0x201f81d, 0x201f839),
    0x2024fd9: (0x201f869, 0x201f885),
    0x202ba91: (0x20260e5, 0x2026101),
    0x202d815: (0x20275ed, 0x2027605),
    0x2039dc9: (0x2030098, 0x20300b0),
    0x203a279: (0x2030164, 0x203017c),
    0x203df29: (0x20362dc, 0x20362f4),
    0x2044cc5: (0x2040588, 0x20405a0),
    0x2044fbd: (0x20409b4, 0x20409cc),
    0x2044fdd: (0x20409e0, 0x20409f8),
    0x204508d: (0x2040af0, 0x2040b08),
    0x2045841: (0x204162c, 0x2041644),
    0x2045ba9: (0x2041b6c, 0x2041b84),
    0x2046f21: (0x20437d4, 0x20437ec),
    0x20480ed: (0x20450f0, 0x2045108),
    0x2048271: (0x2045334, 0x204534c),
    0x2048299: (0x2045374, 0x204538c),
    0x2048501: (0x2045730, 0x2045748),
    0x2048521: (0x2045770, 0x2045788),
    0x204855d: (0x20457b0, 0x20457c8),
    0x2048591: (0x2045808, 0x2045820),
    0x2048641: (0x2045924, 0x204593c),
    0x204871d: (0x2045a90, 0x2045aa8),
    0x2048789: (0x2045b38, 0x2045b50),
    0x2048801: (0x2045c04, 0x2045c1c),
    0x20489b9: (0x2045ec0, 0x2045ed8),
    0x204aa5d: (0x20490f4, 0x204910c),
    0x204ab39: (0x2049238, 0x2049250),
    0x204adad: (0x204961c, 0x2049634),
    0x204af7d: (0x20498f4, 0x204990c),
    0x204b359: (0x2049ef4, 0x2049f0c),
    0x204c151: (0x204b3dc, 0x204b3f4),
    0x204c23d: (0x204b528, 0x204b540),
    0x204c3a5: (0x204b6f4, 0x204b70c),
    0x2070ca9: (0x20788ac, 0x20788c4),
    0x2070de1: (0x2078a80, 0x2078a98),
    0x2070ded: (0x2078a94, 0x2078aac),
    0x2070e55: (0x2078b44, 0x2078b5c),
    0x2070e6d: (0x2078b70, 0x2078b88),
    0x2070ecd: (0x2078c18, 0x2078c30),
    0x215b54d: (0x21607e1, 0x2160801),
    0x2199901: (0x21b6101, 0x21b6121),
    0x2199975: (0x21b6175, 0x21b6195),
    0x2199a51: (0x21b6251, 0x21b6271),
    0x219a4c5: (0x21b6cc1, 0x21b6ce1),
    0x219a7f1: (0x21b6fdd, 0x21b6ffd),
    0x219a8ed: (0x21b70d9, 0x21b70f9),
    0x219a9d9: (0x21b71c5, 0x21b71e5),
    0x219b181: (0x21b7969, 0x21b7989),
    0x219b2f5: (0x21b7add, 0x21b7afd),
    0x219b6c9: (0x21b7eb1, 0x21b7ed1),
    0x219b77d: (0x21b7f65, 0x21b7f85),
    0x219b859: (0x21b8041, 0x21b8061),
    0x219b995: (0x21b817d, 0x21b819d),
    0x219d025: (0x21b916d, 0x21b918d),
    0x219fca1: (0x21bbc05, 0x21bbc25),
    0x219b9e8: (0x21b81d0,0x21b81f0),
}
PROFILES={
    "B": {"idCode":"IRBO", "default":WORKSPACE/"cleanblack.nds", "isDsi":0x2085d3c,"debugFree":0x20307b0},
    "W": {"idCode":"IRAO", "default":Path.home()/"Downloads/cleanroms/cleanwhite.nds", "isDsi":0x2085d54,"debugFree":0x20307c8},
}

PINS={'B': {'ARM9': 'f9cb027e4de3b4388c2ac02ae7e22aee8bf9bd25e9e7325bdf3265fec0370e92', '10': '003fdef42c2584b5448ff223360bf2fecb1a2bf6d36ed63a429fd1033779fda7', '91': '813d39b2dd3fb1fd972f496a686201182d823e32e6a38c2d1452752b72f82f17', '173': '25fe454d4f2b4aef73ba7ecf490f5b6e674076d610ec8d4e2c33e0117a6217b9'}, 'W': {'ARM9': '2d36e7e501fee340e6af419492fb6e0648b8d75e872c718b450c2526dd1a681e', '10': '232353df8f9865a141bd81a254526d503b1e27e27cdea13460353e279bc01b51', '91': '687ee398636c612b1fbdaeb891af3810ce4e46838e56d7803ed3af63c6ef6b80', '173': 'fbd4eba75b18d613416750b9d9f1dfb04b1eada945281fdfda3acd636a383b9a'}}

def segments(rom):
    return {'ARM9':(rom.arm9RamAddress,ndspy.codeCompression.decompress(rom.arm9)),
            **{n:(o.ramAddress,bytes(o.data)) for n,o in rom.loadArm9Overlays([10,91,173]).items()}}

def configure(game):
    settings=PROFILES[game]
    rom=ndspy.rom.NintendoDSRom.fromFile(os.environ.get(f'LEARNSET_{game}_ROM',settings['default']))
    assert rom.idCode==settings['idCode'].encode() and rom.version==0
    segs=segments(rom)
    for n,(base,data) in segs.items():
        assert hashlib.sha256(data).hexdigest()==PINS[game][str(n)],f"Unexpected {game} native segment {n}"
    index=0 if game=='B' else 1
    api=[]
    for source,pair in BINDINGS.items():
        entry=pair[index]
        segment='ARM9' if entry<0x2100000 else 91 if source in (0x219d025,0x219fca1) else 10 if source==0x215b54d else 173
        base,data=segs[segment];at=(entry&~1)-base
        assert at>=0
        length=12 if source==0x219b9e8 else 64
        api.append({'reference':hex(source),'entry':entry,'segment':segment,
                    'mode':'data' if source==0x219b9e8 else 'Thumb' if entry&1 else 'ARM',
                    'expectedHex':data[at:at+length].hex()})
    # Every literal native() binding must be represented. Never silently call
    # a BW2 address in a BW1 candidate after a later source change.
    references=set()
    for path in [HERE/'runtime.h',*HERE.glob('*.cpp')]:
        references.update(int(m[1],16) for m in re.finditer(r'native<.*?>\s*\((0x[\da-f]+)\s*,\s*(0x[\da-f]+)\)',path.read_text(),re.I))
    assert references<=BINDINGS.keys(),references-BINDINGS.keys()
    native={'isDsi':settings['isDsi'],'debugFree':settings['debugFree']}
    for label,entry in native.items():
        b,d=segs['ARM9'];api.append({'label':label,'entry':entry,'segment':'ARM9','mode':'ARM','expectedHex':d[entry-b:entry-b+32].hex()})
    callbacks=BINDINGS[0x219b9e8][index];b,d=segs[173]
    assert d[callbacks-b:callbacks-b+12]==struct.pack('<III',*(BINDINGS[v][index] for v in (0x2199901,0x2199975,0x2199a51)))
    # Record exact native hook bytes, including BLX sites with seven arguments.
    md=Cs(CS_ARCH_ARM,CS_MODE_THUMB);md.skipdata=True
    codeEnd=callbacks-b
    instructions={i.address:i for i in md.disasm(d[:codeEnd],b)}
    hooks=[]
    def hook(label,ov,address,size,kind):
        base,data=segs[ov];at=address-base
        hooks.append({'label':label,'overlayId':ov,'address':address,'expectedHex':data[at:at+max(size,16 if kind=='FULL_COPY' and size==8 else size)].hex(),'patchType':kind,'patchSize':size})
    for source,label,ov in ((0x219fca1,'MenuCreate',91),(0x219d025,'MenuSelect',91),(0x215b54d,'Dispatch',10)):
        address=BINDINGS[source][index]&~1
        base,data=segs[ov]
        prologue=list(md.disasm(data[address-base:address-base+8],address))
        assert sum(i.size for i in prologue)==8 and all(i.mnemonic in ('push','sub','adds','movs') for i in prologue)
        hook(label,ov,address,8,'FULL_COPY')
    for source,label in ((0x219a7f1,'DrawLine'),(0x219b995,'Confirm'),(0x219b6c9,'EnterButton'),(0x219a9d9,'Details'),(0x219b181,'TypeIcons'),(0x219a4c5,'FixedText')):
        target=BINDINGS[source][index]&~1
        calls=[i.address for i in instructions.values() if i.mnemonic=='bl' and i.op_str==f'#0x{target:x}']
        assert calls,(game,label)
        for address in calls:hook(label,173,address,4,'THUMB_BRANCH_LINK')
    # Independently confirmed native call sites: lower map frame7/member2;
    # bitmap-window constructor preserves width in r3 and three stack args.
    sites={'B':{'Screen':0x21b6724,'Window':0x21b67e4},'W':{'Screen':0x21b6744,'Window':0x21b6804}}
    for label,source in (('Screen',0x204af7d),('Window',0x20480ed)):
        address=sites[game][label];i=instructions[address]
        assert i.mnemonic=='blx' and i.op_str==f'#0x{BINDINGS[source][index]:x}'
        hook(label,173,address,4,'THUMB_BRANCH_LINK')
    hook('Viewer callbacks',173,callbacks,12,'FULL_COPY')
    graphics=ndspy.narc.NARC(rom.getFileByName('a/1/2/4')).files
    rows=profile(graphics)
    types=ndspy.narc.NARC(rom.getFileByName('a/0/8/3')).files
    for member in (60,63):
        unpacked=types[member] if types[member][:4] in (b'RECN',b'RNAN') else ndspy.lz10.decompress(types[member])
        assert unpacked[:4] in (b'RECN',b'RNAN')
    assert all(len(types[m])==304 for m in range(34,52))
    personal=ndspy.narc.NARC(rom.getFileByName('a/0/1/6')).files
    assert len(personal)==669 and len(personal[0])==56 and len(personal[-1])==1300
    assert all(len(record)==60 for record in personal[1:-1])
    resources=[]
    for path,members in (('a/1/2/4',(0,1,2,4,5,7,8,17)),('a/0/8/3',(*range(34,52),60,63)),('a/0/0/7',(0,1,2,3,4,5,6))):
        files=ndspy.narc.NARC(rom.getFileByName(path)).files
        resources.extend({'archive':path,'member':m,'sha256':hashlib.sha256(files[m]).hexdigest()} for m in members)
    result={'game':game,'idCode':settings['idCode'],'revision':0,'dsAccepted':False,
            'partyOverlay':91,'dispatchOverlay':10,'tutorOverlay':173,'graphicsArchive':'a/1/2/4',
            'typeGraphicsArchive':'a/0/8/3','menuBankId':157,'viewerBankId':204,
            'nameBanks':{'species':284,'move':286,'item':54,'ability':285},
            'layout':{'personalRecordSize':60,'partyRequest':0x280,'partyMessage':0x134,'partyCommand':0x3c,'partySlot':0x2c,'requestMode':0x34,'requestSlot':0x3c,'requestResult':0x40,'tutorWorkSize':0x228},
            'segments':{str(n):{'address':base,'sha256':hashlib.sha256(data).hexdigest()} for n,(base,data) in segs.items()},
            'apis':api,'hooks':hooks,'resources':resources}
    (HERE/f'profile-{game}.json').write_text(json.dumps(result,indent=2)+'\n')
    return result,rows

def main():
    build=HERE/'build';build.mkdir(exist_ok=True)
    results={};rows=None
    for game in PROFILES:
        result,other=configure(game);results[game]=result
        assert rows is None or rows==other
        rows=other
        print(f"{game}: {len(result['apis'])} native entries, {len(result['hooks'])} hooks pinned; acceptance pending")
    text=['#pragma once','constexpr u32 bw1Address(u32 reference) {','    switch(reference) {']
    for source,(black,white) in BINDINGS.items():
        text += [f'    case 0x{source:x}:', '#if defined(GAME_B)',f'        return 0x{black:x};','#else',f'        return 0x{white:x};','#endif']
    text += ['    default:return 0;','    }','}', '#if defined(GAME_B)',f"constexpr u32 Bw1IsDsi=0x{PROFILES['B']['isDsi']:x}, Bw1DebugFree=0x{PROFILES['B']['debugFree']:x};",'#else',f"constexpr u32 Bw1IsDsi=0x{PROFILES['W']['isDsi']:x}, Bw1DebugFree=0x{PROFILES['W']['debugFree']:x};",'#endif']
    (build/'addresses_bw1.generated.h').write_text('\n'.join(text)+'\n')
    (build/'info_background_bw1.generated.h').write_text(header(rows).replace('US W2/B2','US B/W'))

if __name__=='__main__':main()
