"""Build Pokenav's pinned native selector/footer art from each input ROM."""
import struct
import ndspy.narc

def header(rom,arm9,party,delta):
    fonts=ndspy.narc.NARC(rom.getFileByName('a/0/2/3')).files
    font=fonts[0]
    glyph=struct.unpack_from('<I',font,32)[0]
    assert struct.unpack_from('<BB',font,glyph)==(12,15)
    assert struct.unpack_from('<BB',fonts[1],struct.unpack_from('<I',fonts[1],32)[0])==(10,10)
    palette=struct.unpack_from('<16H',fonts[5],40)
    assert palette[15]==0x7fff and palette[2]==(20|(20<<5)|(21<<10))
    delta_arm=0 if rom.idCode==b'IRDO' else 44
    for address,expected in [(0x2022d84,'f0b583b0089d061c0293'),(0x2022dd4,'10b5041c00f04ef9')]:
        start=address-delta_arm-rom.arm9RamAddress
        assert arm9[start:start+len(expected)//2]==bytes.fromhex(expected)
    # Pokenav releases the tutor's shared connection actor through the native
    # owner-clearing routine. Verify each game's binding independently.
    release=(0x203e808 if rom.idCode==b'IRDO' else 0x203e7dc)-rom.arm9RamAddress
    assert arm9[release:release+24]==bytes.fromhex('10b5fff7b5ff044c6068002803d0fff73bff0020606010bd')
    sine=struct.unpack_from('<I',party.data,0x219a350-delta-party.ramAddress)[0]
    pulse=[]
    for phase in range(64):
        value=struct.unpack_from('<h',arm9,sine-rom.arm9RamAddress+phase*256)[0]
        assert -4096<=value<=4096
        weight=(value+4096)>>1;color=0
        for shift in (0,5,10):
            lo=0x4140>>shift&31;hi=0x7be9>>shift&31
            color|=(lo+(((hi-lo)*weight)>>12))<<shift
        pulse.append(color)
    arc=ndspy.narc.NARC(rom.getFileByName('a/0/8/2')).files
    assert arc[19][:4]==arc[27][:4]==b'RLCN' and arc[20][:4]==arc[28][:4]==b'RGCN'
    assert struct.unpack_from('<HHI',arc[21],24)==(23,0,24)
    # Native common-control cells 0/1: red X and blue return, 32x32 each.
    assert struct.unpack_from('<3H',arc[21],232)==(0,0x8000,0)
    assert struct.unpack_from('<3H',arc[21],238)==(0,0x8000,16)
    def array(kind,name,values):
        return f'constexpr {kind} {name}[]={{'+','.join(str(x) for x in values)+'};\n'
    return '#pragma once\n'+array('unsigned short','PokenavPulse',pulse)+array('unsigned short','PokenavFooterColors',struct.unpack_from('<16H',arc[27],40))+array('unsigned short','PokenavControlColors',struct.unpack_from('<16H',arc[19],40))+array('unsigned char','PokenavFooterStrip',arc[28][80:144])+array('unsigned char','PokenavFooterIcons',arc[20][48:1072])
