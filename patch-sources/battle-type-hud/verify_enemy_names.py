"""Measure retail species names with the retail battle font; no game boot.

Raw text/font data is read from the user's clean reference ROMs, not bundled.
"""
import hashlib, json, struct
import ndspy.narc
from verify import HERE, Harness, G, normalized, header_pixel, set_header, enemy_header, player_header
from analyze import load
from unicorn import UC_HOOK_CODE

def names(rom):
    data=ndspy.narc.NARC(rom.getFileByName('a/0/0/2')).files[90]
    count=struct.unpack_from('<H',data,2)[0];block=struct.unpack_from('<I',data,12)[0]
    out=[]
    for i in range(count):
        at,n=struct.unpack_from('<IH',data,block+4+i*8)
        enc=list(struct.unpack_from('<'+'H'*n,data,block+at));key=enc[-1]^65535;dec=[]
        for c in reversed(enc):dec.append(c^key);key=((key>>3)|(key<<13))&65535
        dec.reverse()
        if dec[0]==0xf100:
            values=[];bits=0;acc=0
            for c in dec[1:]:
                acc|=c<<bits;bits+=16
                while bits>=9:
                    v=acc&511;values.append(65535 if v==511 else v);acc>>=9;bits-=9
            dec=values
        out.append(''.join(chr(c) for c in dec[:dec.index(65535)]))
    assert out[1]=='Bulbasaur' and out[649]=='Genesect'
    return out[1:650]

class Font:
    def __init__(self,rom):
        self.raw=ndspy.narc.NARC(rom.getFileByName('a/0/2/3')).files[2]
        self.glyph,_,self.mapping=struct.unpack_from('<III',self.raw,32)
        self.w,self.h,self.size=struct.unpack_from('<BBH',self.raw,self.glyph)
    def char(self,ch):
        code=ord(ch);at=self.mapping;data=self.raw
        while True:
            first,last,method,_,nxt=struct.unpack_from('<HHHHI',data,at)
            if first<=code<=last:
                if method==0:index=code-first+struct.unpack_from('<H',data,at+12)[0]
                elif method==1:index=struct.unpack_from('<H',data,at+12+2*(code-first))[0]
                else:
                    pairs=dict(struct.iter_unpack('<HH',data[at+14:at+14+4*struct.unpack_from('<H',data,at+12)[0]]))
                    index=pairs[code]
                break
            assert nxt,(ch,code)
            at=nxt
        at=self.glyph+8+index*self.size;left,width,advance=data[at:at+3]
        raw=data[at+3:at+self.size]
        pixels={(x+left,y):((raw[(y*self.w+x)//4]>>(6-2*((y*self.w+x)%4)))&3)
                for y in range(self.h) for x in range(self.w)}
        return advance,{p:(1 if c==1 else 2) for p,c in pixels.items() if c in (1,2)}
    def text(self,text):
        cursor=0;out={}
        for ch in text:
            advance,glyph=self.char(ch)
            out.update({(x+cursor,y):c for (x,y),c in glyph.items()});cursor+=advance
        return cursor,out

def panel(raw,font,name,level=100,player=False):
    out=bytearray(normalized(raw));width,glyph=font.text(name)
    # Native 64px name bitmap uses x=2 for >48px, otherwise x=8.
    begin=8 if player else 16;split=72 if player else 80;digits_start=88 if player else 96
    start=begin+(2 if width>48 else 8)
    for y in range(16):
        for x in range(begin,split):set_header(out,x,y,0)
        for x in range(digits_start,128):set_header(out,x,y,0)
    for (x,y),c in glyph.items():
        if x+start<split and y+5<16:set_header(out,x+start,y+5,c)
    for y in range(7,15):
        for x in range(split,split+7):set_header(out,x,y,5) # full native gender bounds
    _,digits=font.text(''.join(chr(0xff10+int(c)) for c in str(level)))
    for (x,y),c in digits.items():
        if x<24 and y+5<16:set_header(out,digits_start+x,y+5,c)
    assert sum(c!=0 for c in glyph.values())==sum(header_pixel(out,x,y)!=0 for y in range(16) for x in range(begin,split)),name
    return bytes(out),width

def main():
    reports={}
    for game in ('B2','W2'):
        rom,_=load(game);font=Font(rom);all_names=names(rom);h=Harness(game)
        widths={name:font.text(name)[0] for name in all_names}
        minimum_margin=100;minimum_gap=100;maximum_end=0
        for name in all_names:
            for p in (1,3,5,7):
                raw,_=panel(h.raw[(2 if p==7 else 0,1)],font,name)
                shifted=bytearray(raw);left=enemy_header(shifted,p);anchor={1:60,3:64,5:60,7:56}[p]
                screen_left=anchor-64+left
                # Count the shifted name's pixel span using its original span.
                first=min(x for y in range(16) for x in range(16,80) if header_pixel(raw,x,y))
                name_first=max(anchor-64+first,23)
                gap=name_first-(screen_left+20)-1
                minimum_margin=min(minimum_margin,screen_left);minimum_gap=min(minimum_gap,gap)
                maximum_end=max(maximum_end,max(x+anchor-64 for y in range(16) for x in range(128) if header_pixel(shifted,x,y)))
                assert screen_left>=1 and gap>=1 and maximum_end<256
        widest=sorted(widths,key=lambda n:widths[n],reverse=True)[:8]
        chosen=list(dict.fromkeys(widest+['Mew','Gengar','Feraligatr','Kangaskhan']))
        for p,t in ((1,0),(3,1),(5,1),(3,2),(5,2),(7,2)):
            for name in chosen:
                key=(2 if t==2 else 0,1);base=h.raw[key]
                raw,_=panel(base,font,name);h.raw[key]=raw
                for pair in ((7,3),(13,13)):
                    h.add(p,pair,t);h.check(p,pair,t)
                    h.writes.clear();h.invoke('Main',G);assert not h.writes
                # A native reload at the same image address must not erase
                # freshly loaded letters while restoring the previous icons.
                h.c.mem_write(0x06400000+p*0x1000,raw);h.invoke('Main',G);h.check(p,(13,13),t)
                h.invoke('Status',G,1,p);h.check(p,(13,13),t,status=True)
                h.invoke('Status',G,0,p);h.check(p,(13,13),t)
                # Unbinding restores the original header pixel for pixel.
                h.invoke('Del',G,p);assert h.image(p,t)==raw
                h.raw[key]=base
        # Native text updates operate on the original coordinates, then the
        # wrapper translates the completed row again without cumulative drift.
        p,t=7,2;key=(2,1);base=h.raw[key];raw,_=panel(base,font,'Kangaskhan')
        h.raw[key]=raw;h.add(p,(7,3),t)
        for function,field in (('NameDraw',range(16,80)),('LevelDraw',range(96,120)),('SexDraw',range(80,88))):
            if function=='NameDraw':next_raw,_=panel(base,font,'Mew')
            elif function=='LevelDraw':next_raw,_=panel(base,font,'Mew',5)
            else:
                next_raw=bytearray(raw)
                for y in range(16):
                    for x in field:set_header(next_raw,x,y,0)
                next_raw=bytes(next_raw)
            def redraw(c,pc,size,user):
                address=0x06400000+p*0x1000
                assert bytes(c.mem_read(address,len(raw)))==raw,'native hook saw shifted text'
                changed=bytearray(raw)
                for y in range(16):
                    for x in field:set_header(changed,x,y,header_pixel(next_raw,x,y))
                assert bytes(changed)==next_raw
                c.mem_write(address,bytes(changed))
            at=h.profile['functions'][function];hook=h.c.hook_add(UC_HOOK_CODE,redraw,begin=at,end=at)
            h.raw[key]=next_raw
            args=(G,G+0x40+p*0x84,0x2273000) if function=='NameDraw' else (G,G+0x40+p*0x84)
            h.invoke(function,*args);h.c.hook_del(hook);h.check(p,(7,3),t);raw=next_raw
        h.invoke('Del',G,p);assert h.image(p,t)==raw

        # Player singles: every retail name and Lv.100 fits the exact requested
        # shifts; native callbacks still receive unshifted art.
        player_base=h.raw[(0,0)];rightmost=0
        for name in all_names:
            raw,_=panel(player_base,font,name,player=True)
            shifted=bytearray(raw);player_header(shifted)
            rightmost=max(rightmost,max(200-64+x for y in range(16) for x in range(128) if header_pixel(shifted,x,y)))
        assert rightmost<256
        for name in chosen:
            raw,_=panel(player_base,font,name,player=True);h.raw[(0,0)]=raw
            for pair in ((7,3),(13,13)):
                h.add(0,pair);h.check(0,pair)
                h.writes.clear();h.invoke('Main',G);assert not h.writes
                # Both full and header-only reloads can leave the same binding.
                for count in (2048,len(raw)):
                    h.c.mem_write(0x06400000,raw[:count]);h.invoke('Main',G);h.check(0,pair)
                for status in range(1,7):
                    h.invoke('Status',G,status,0);h.check(0,pair,status=True)
                    h.invoke('Status',G,0,0);h.check(0,pair)
                h.invoke('Del',G,0);assert h.image(0)==raw
        p=0;t=0;key=(0,0);raw,_=panel(player_base,font,'Kangaskhan',player=True)
        h.raw[key]=raw;h.add(0,(7,3))
        for function,field in (('NameDraw',range(8,72)),('LevelDraw',range(88,112)),('SexDraw',range(72,80))):
            if function=='NameDraw':next_raw,_=panel(player_base,font,'Mew',player=True)
            elif function=='LevelDraw':next_raw,_=panel(player_base,font,'Mew',5,player=True)
            else:
                next_raw=bytearray(raw)
                for y in range(16):
                    for x in field:set_header(next_raw,x,y,0)
                next_raw=bytes(next_raw)
            def redraw_player(c,pc,size,user):
                address=0x06400000
                assert bytes(c.mem_read(address,len(raw)))==raw,'native player hook saw shifted text'
                changed=bytearray(raw)
                for y in range(16):
                    for x in field:set_header(changed,x,y,header_pixel(next_raw,x,y))
                assert bytes(changed)==next_raw
                c.mem_write(address,bytes(changed))
            at=h.profile['functions'][function];hook=h.c.hook_add(UC_HOOK_CODE,redraw_player,begin=at,end=at)
            h.raw[key]=next_raw
            args=(G,G+0x40,0x2273000) if function=='NameDraw' else (G,G+0x40)
            h.invoke(function,*args);h.c.hook_del(hook);h.check(0,(7,3));raw=next_raw
        h.invoke('Del',G,0);assert h.image(0)==raw
        reports[game]=dict(species_names_measured=len(all_names),player_names_measured=len(all_names),
            player_name_shift=12,player_info_shift=8,player_icon_shift=12,player_rightmost_header_pixel=rightmost,widest=[dict(name=n,width=widths[n]) for n in widest],
            minimum_screen_margin=minimum_margin,minimum_name_gap=minimum_gap,rightmost_header_pixel=maximum_end,
            compiled_names=chosen,layouts=['singles','both doubles','all three triples'],level=100,
            unchanged_update_no_writes=True,header_restored_on_removal=True,in_place_graphics_reload=True,
            name_gender_level_hooks_use_native_coordinates=True,
            release_sha256=hashlib.sha256((HERE/'build'/f'TypeIcons{game}.dll').read_bytes()).hexdigest())
    report=dict(games=reports,limitations=['Retail English species names and battle font; no game boot or frames.',
                'Native creation/status functions are instrumented fixtures; actual ARM DLLs are executed.'])
    (HERE/'build/enemy-name-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
