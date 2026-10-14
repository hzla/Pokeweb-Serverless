"""Explicit US revision-0 BW1 C-Gear adapters (entry bits retain ARM/Thumb mode)."""
import hashlib, importlib.util, json, os, struct
from pathlib import Path
import ndspy.rom, ndspy.codeCompression, ndspy.narc

HERE=Path(__file__).resolve().parent
WS=HERE.parents[2]
spec=importlib.util.spec_from_file_location('party_bw1',HERE.parent/'party-quick-actions/configure_bw1.py')
party=importlib.util.module_from_spec(spec);spec.loader.exec_module(party)

# Symbol-bearing function matches are only candidates; these entries are also
# checked against retail callers, tables, argument layouts and execution mode.
FUNCTIONS={
 'Game':('ARM9',0x20120f5,0x20120f5),
 'Field':('ARM9',0x201210d,0x201210d),
 'Save':('ARM9',0x2012ebd,0x2012ebd),
 'Etc':('ARM9',0x200ed49,0x200ed49),
 'Bag':('ARM9',0x201292d,0x201292d),
 'Party':('ARM9',0x2012935,0x2012935),
 'Player':('ARM9',0x20127a5,0x20127a5),
 'PlayerForm':('ARM9',0x2012b29,0x2012b29),
 'Flags':('ARM9',0x201296d,0x201296d),
 'EncounterState':('ARM9',0x2012a39,0x2012a39),
 'Misc':('ARM9',0x2012f09,0x2012f09),
 'Badge':('ARM9',0x200c235,0x200c235),
 'SubscreenMode':('ARM9',0x20129b9,0x20129b9),
 'EventCreate':('ARM9',0x20122c1,0x20122c1),
 'EventChild':('ARM9',0x2012375,0x2012375),
 'EventSystem':('ARM9',0x20124e5,0x20124e5),
 'EventData':('ARM9',0x20124e9,0x20124e9),
 'Random':('ARM9',0x2005729,0x2005729),
 'RepelStep':('ARM9',0x200d565,0x200d565),
 'RepelDepleted':('ARM9',0x200d58d,0x200d58d),
 'Touch':('ARM9',0x2035cb8,0x2035cd0),
 'BackgroundVisible':('ARM9',0x2040588,0x20405a0),
 'SubPlanes':('ARM9',0x20435f4,0x204360c),
 'NativeButtonInput':('ARM9',0x2051c88,0x2051ca0),
 'ActorPalette':('ARM9',0x204b6f4,0x204b70c),
 'NetworkPosition':('ARM9',0x203d88c,0x203d8a4),
 'ArchiveSize':('ARM9',0x20493d4,0x20493ec),
 'Init':('21',0x21a0fe9,0x21a1009),
 'Update':('21',0x21a10e1,0x21a1101),
 'Exit':('21',0x21a10c1,0x21a10e1),
 'Event':('21',0x21a1139,0x21a1159),
 'NoGearInit':('21',0x21a1145,0x21a1165),
 'GearDispose':('29',0x21f26e1,0x21f2701),
 'GearTouch':('29',0x21f1759,0x21f1779),
 'GearIdle':('29',0x21f2181,0x21f21a1),
 'GearSleep':('29',0x21f2da9,0x21f2dc9),
 'FieldHeap':('21',0x2188c85,0x2188ca5),
 'FieldMessage':('21',0x2188c55,0x2188c75),
 'FieldEncounter':('21',0x2188ce9,0x2188d09),
 'FieldController':('21',0x2188cfd,0x2188d1d),
 'Phenomenon':('21',0x21aa80d,0x21aa82d),
 'PhenomenonInterval':('21',0x21aabc5,0x21aabe5),
 'Script':('10',0x2158769,0x2158789),
 'Application':('10',0x216075d,0x216077d),
 'TownMapReturn':('10',0x2161281,0x21612a1),
 'ItemCheck':('10',0x21644c5,0x21644e5),
 'ItemEvent':('10',0x21644f5,0x2164515),
 'FlyInit':('10',0x215e841,0x215e861),
 'FlyCheck':('10',0x215ec6d,0x215ec8d),
 'FlyUse':('10',0x215ea39,0x215ea59),
 'Report':('10',0x2169ab9,0x2169ad9),
 'SubscreenChange':('21',0x21a0f31,0x21a0f51),
 'SubscreenReady':('21',0x21a0ed5,0x21a0ef5),
}
# Reuse sprite/library APIs already independently audited by the BW1 toolbar.
SHARED={
 'VBlank':0x20056fc,'Sound':0x2006254,'HasItem':0x2008474,
 'Flag':0x20191d8,'GetMon':0x201ff34,'PartyCount':0x201fe24,'MonGet':0x201cd24,
 'HeapFree':0x2039f8c,'HeapLargest':0x2039fbc,'Alloc':0x203a228,'Free':0x203a278,
 'TaskDelete':0x203a6d4,'VramInvalid':0x203cb14,'Keys':0x203df4c,
 'ArchiveInit':0x204aac8,'ArchiveClose':0x204ab38,'ArchiveRead':0x204ab48,
 'PaletteLoad':0x204bbcc,'PaletteDelete':0x204bcfc,'PaletteUpload':0x204bd3c,
 'AnimationLoad':0x204be0c,'AnimationDelete':0x204be90,'UnitCreate':0x204bf48,
 'CharCreate':0x204b8e8,'CharDelete':0x204b9b8,'CharUpload':0x204ba6c,
 'ActorCreate':0x204c06c,'ActorDelete':0x204c134,'ActorVisible':0x204c150,
 'ActorPlace':0x204c16c,'ActorAnimate':0x204c54c,'FileInit':0x2070ca8,'FileOpen':0x2070ecc,
}
for name,ref in SHARED.items():FUNCTIONS[name]=('ARM9',*party.BINDINGS[ref])

# Calls have explicit sites and targets in each game, including ARM BLX.
CALLS=[
 ('QaInput',29,0x21f2136,0x21f2156,'NativeButtonInput',''),
 ('QaGearUnit',29,0x21f1e12,0x21f1e32,'UnitCreate',''),
 ('QaGearEnd',29,0x21f2988,0x21f29a8,'GearDispose',''),
 ('QaGearEnd',29,0x21f29b0,0x21f29d0,'GearDispose',''),
 ('QaRepelStep',21,0x218ac5c,0x218ac7c,'RepelStep','adds r1,r4,#0'),
 ('QaRepelDepleted',21,0x21a9420,0x21a9440,'RepelDepleted','adds r1,r4,#0'),
 ('QaPhenomenonInterval',21,0x21aa8a4,0x21aa8c4,'PhenomenonInterval',''),
 ('QaPhenomenonChance',21,0x21aa8b0,0x21aa8d0,'Random',''),
]
WORDS=[
 ('QaCGearInit',21,0x21d872c,0x21d8744,'Init'),
 ('QaCGearUpdate',21,0x21d8730,0x21d8748,'Update'),
 ('QaCGearEvent',21,0x21d8738,0x21d8750,'Event'),
 ('QaCGearExit',21,0x21d873c,0x21d8754,'Exit'),
 ('QaNoGearInit',21,0x21d87b8,0x21d87d0,'NoGearInit'),
 ('QaTownMapReturn',10,0x2171380,0x21713a0,'TownMapReturn'),
]

def rom_path(game):
    default=WS/'cleanblack.nds' if game=='B' else Path.home()/'Downloads/cleanroms/cleanwhite.nds'
    return Path(os.environ.get(f'QUICK_ACTIONS_{game}_ROM',default))
def configure(game):
    index=1 if game=='B' else 2
    rom=ndspy.rom.NintendoDSRom.fromFile(str(rom_path(game)))
    assert rom.idCode==(b'IRBO'if game=='B'else b'IRAO')and rom.version==0
    overlays=rom.loadArm9Overlays([10,21,29]);arm=ndspy.codeCompression.decompress(rom.arm9)
    signatures=[]
    def pin(label,module,address,length,patch=0):
        base=rom.arm9RamAddress if module=='ARM9'else overlays[int(module)].ramAddress
        data=arm if module=='ARM9'else overlays[int(module)].data
        out=bytes(data[address-base:address-base+length]);assert len(out)==length
        signatures.append({'label':label,'module':str(module),'address':address,'expectedHex':out.hex(),'patchSize':patch})
        return out
    for name,row in FUNCTIONS.items():pin('Native '+name,row[0],row[index]&~1,32)
    assert pin('Reserved save block size','ARM9',0x200ed38,4)==bytes.fromhex('fc207047')
    assert pin('Reserved save block getter','ARM9',0x200ed48,12)[0:6]==bytes.fromhex('014b44211847')
    script=ndspy.narc.NARC(rom.files[rom.filenames.idOf('a/0/5/7')]).files[868]
    assert hashlib.sha256(script).hexdigest()=='6df48b0926233422b88e6bf0a62f1b42b36fcc786b59f6332e420910027903ed'
    assert script[0x2ee:0x2f4]==bytes.fromhex('280027800000')
    for label,module,black,white,target,prep in CALLS:
        address=black if game=='B'else white;raw=pin(label,module,address,4,4)
        x,y=struct.unpack('<HH',raw);assert x&0xf800==0xf000 and y&0xe800==0xe800,(label,raw.hex())
        delta=((x&2047)<<12)|((y&2047)<<1)
        if delta&0x400000:delta-=0x800000
        actual=address+4+delta
        if y&0xf800==0xe800:actual&=~3
        assert actual==FUNCTIONS[target][index]&~1,(game,label,hex(address),hex(actual),hex(FUNCTIONS[target][index]))
    for label,module,black,white,target in WORDS:
        address=black if game=='B'else white
        assert struct.unpack('<I',pin(label,module,address,4,4))[0]==FUNCTIONS[target][index],(game,label,hex(address))
    # Pin the complete request initializer, dispatch tables, generator and
    # C-Gear work initialization, not just each function's prologue.
    for label,module,black,white,length in [
        ('Subscreen visibility cache synchronization','ARM9',0x20435f4,0x204360c,40),
        ('Application request ownership',10,0x216075c,0x216077c,148),
        ('Native field item dispatch',10,0x21714dc,0x21714fc,88),
        ('C-Gear work layout',29,0x21f251c,0x21f253c,452),
        ('Native phenomenon generator',21,0x21aa80c,0x21aa82c,0x108),
        ('Native PC script mapping',10,0x21702d4,0x21702f4,10),
        ('Native script VM ownership and instruction pointer',10,0x2158bfc,0x2158c1c,0xb8),
    ]:pin(label,module,black if game=='B'else white,length)
    profile={'idCode':rom.idCode.decode(),'revision':0,'fileName':f'CGearQuickActions{game}.dll','signatures':signatures,
             'functions':{n:{'module':v[0],'entry':v[index]}for n,v in FUNCTIONS.items()},
             'nativeArchive':'a/0/3/0','maxSaveFlag':2911,'saveRecord':{'block':68,'offset':164,'size':48},
             'sourceHashes':{'ARM9':hashlib.sha256(arm).hexdigest(),**{str(k):hashlib.sha256(v.data).hexdigest()for k,v in overlays.items()}}}
    return rom,profile

def header():
    out=['#pragma once','namespace Native {']
    for name,(_,black,white) in FUNCTIONS.items():out += [f'#ifdef GAME_B',f'constexpr u32 {name}=0x{black:x};','#else',f'constexpr u32 {name}=0x{white:x};','#endif']
    out+=['#ifdef GAME_B','constexpr u32 SpriteSystem=0x2146a74;','#else','constexpr u32 SpriteSystem=0x2146a94;','#endif','}']
    return '\n'.join(out)+'\n'

if __name__=='__main__':
    for game in ('B','W'):
        rom,profile=configure(game)
        (HERE/f'profile-{game}.json').write_text(json.dumps(profile,indent=2)+'\n')
        print(game,'retail hook signatures verified')
