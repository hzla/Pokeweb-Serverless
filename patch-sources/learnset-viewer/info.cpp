#include "info.h"
#include "info_logic.h"
#include "info_messages.generated.h"

namespace {
// Only the overlay-258 module owns this state; no field/menu heap growth.
constexpr u32 Heap=79, TextCapacity=256;
struct Page { u16 offset; u8 option; u8 reserved; };
struct DisplayChain { Chain chain; InfoNode nodes[3]; };
struct IconKey { u16 species,form,gender; };
struct InfoState {
    void* work;
    u16 selectedName[64], title[96], requirements[8][TextCapacity];
    u16 targets[8][64], labels[6][16], status[64];
    u16 statsUnavailable[64];
    u16 abilityNames[3][64]; Abilities abilities;
    u8 icons[3][512]; u16 palettes[3][16];
    u8 stats[6]; bool statsValid, evolutionValid, iconsValid[3];
    Chain chain; DisplayChain branches[8]; u16 gender;
    IconKey iconKeys[3]; u8 iconSlots[3];
    Page pages[128]; u16 pageCount,page;
};
InfoState* state;

// The game's asserting NARC reader is not used for user-edited data.
// Bounds are checked before every filesystem read, including empty members.
struct Archive {
    u32 file[20]={},size=0,count=0,image=0,imageSize=0; bool opened=false;
    // Fixed-size streaming windows, never an allocation proportional to a
    // hacked archive's payload size. Allocation failure uses the bounded reader.
    struct Cache { u32 fatAt,fatLength,dataAt,dataLength; u8 fat[1024],data[4096]; };
    Cache* cache=nullptr;
    bool read(u32 offset,void* out,u32 length) {
        return opened && offset<=size && length<=size-offset
            && native<u32(*)(void*,u32,u32)>(0x2070e55,0x2070e29)(file,offset,0)
            && native<int(*)(void*,void*,u32)>(0x2070e6d,0x2070e41)(file,out,length)==int(length);
    }
    bool open(const char* path) {
        native<void(*)(void*)>(0x2070ca9,0x2070c7d)(file);
        opened=native<u32(*)(void*,const char*)>(0x2070ecd,0x2070ea1)(file,path)!=0;
        if(!opened)return false;
        size=native<u32(*)(void*)>(0x2070ded,0x2070dc1)(file);
        u8 h[16];
        if(!read(0,h,16) || read32(h)!=0x4352414e || read32(h+4)!=0x0100fffe
            || read32(h+8)!=size || read16(h+12)!=16 || read16(h+14)!=3)return false;
        if(!read(16,h,12) || read32(h)!=0x46415442)return false;
        const u32 fat=read32(h+4);count=read16(h+8);
        if(fat<12+count*8 || fat>size-16)return false;
        u32 offset=16+fat;
        if(!read(offset,h,8) || read32(h)!=0x464e5442)return false;
        const u32 names=read32(h+4);
        if(names<8 || names>size-offset)return false;
        offset+=names;
        if(!read(offset,h,8) || read32(h)!=0x46494d47 || read32(h+4)<8 || read32(h+4)!=size-offset)return false;
        image=offset+8; imageSize=size-image;return true;
    }
    void buffer() {cache=static_cast<Cache*>(alloc(Heap,sizeof(Cache)));if(cache)*cache={};}
    void unbuffer() {release(cache);cache=nullptr;}
    bool cachedRead(u32 offset,void* out,u32 length,bool fat) {
        if(!cache)return read(offset,out,length);
        u32& at=fat?cache->fatAt:cache->dataAt;
        u32& available=fat?cache->fatLength:cache->dataLength;
        u8* data=fat?cache->fat:cache->data;
        const u32 capacity=fat?sizeof(cache->fat):sizeof(cache->data);
        if(offset>size || length>size-offset)return false;
        if(length>capacity)return read(offset,out,length);
        if(offset<at || offset-at>available || length>available-(offset-at)) {
            at=offset;available=size-offset<capacity?size-offset:capacity;
            if(!read(at,data,available)){available=0;return false;}
        }
        u8* dest=static_cast<u8*>(out);
        for(u32 i=0;i<length;++i)dest[i]=data[offset-at+i];
        return true;
    }
    u32 member(u32 id,void* out,u32 capacity,bool prefix=false) {
        u8 h[8];
        if(!image || id>=count || !cachedRead(28+8*id,h,8,true))return 0;
        u32 begin=read32(h),end=read32(h+4);
        if(begin>end || end>imageSize || end==begin || (!prefix && end-begin>capacity))return 0;
        const u32 length=end-begin<capacity?end-begin:capacity;
        return cachedRead(image+begin,out,length,false)?length:0;
    }
    ~Archive(){unbuffer();if(opened)native<u32(*)(void*)>(0x2070de1,0x2070db5)(file);}
};

// Reuse the small private bank and one ROM name bank while initializing.
// Never hold every species/item/move bank in memory at once or across sessions.
struct Messages : Archive {
    void* privateHandle=nullptr; void* nameHandle=nullptr; u32 nameBank=0;
    struct Bank {u16 id,count;bool checked,valid;}; Bank banks[6]={};
    void* handle(u32 bank,u32 id) {
        const u16 ids[]={401,90,64,403,487,374};u32 slot=0;
        while(slot<6 && ids[slot]!=bank)++slot;
        if(slot==6)return nullptr;
        auto& entry=banks[slot];
        if(!entry.checked) {
            u8 header[4];entry.checked=true;
            entry.valid=member(bank,header,4,true)==4;
            if(entry.valid)entry.count=read16(header+2);
        }
        if(!entry.valid || id>=entry.count)return nullptr;
        if(bank==401) {
            if(!privateHandle)privateHandle=messageOpen(bank,Heap);
            return privateHandle;
        }
        if(nameHandle && nameBank!=bank){messageClose(nameHandle);nameHandle=nullptr;}
        if(!nameHandle){nameHandle=messageOpen(bank,Heap);nameBank=bank;}
        return nameHandle;
    }
    ~Messages(){if(privateHandle)messageClose(privateHandle);if(nameHandle)messageClose(nameHandle);}
};

void* bmp() { return native<void*(*)(void*)>(0x2048521,0x20484f5)(at<void*>(state->work,0x38)); }
u8* pixels() { return native<u8*(*)(void*)>(0x2046f21,0x2046ef5)(bmp()); }
void put(const u16* text,int x,int y,u32 color=0x3c40) {
    void* buffer=at<void*>(state->work,0x4c);stringSet(buffer,text);
    native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(bmp(),x,y,buffer,at<void*>(state->work,0x60),color);
}
u32 measure(const u16* text) {
    void* buffer=at<void*>(state->work,0x4c);stringSet(buffer,text);
    return native<u32(*)(void*,void*,u32)>(0x20228b5,0x2022889)(buffer,at<void*>(state->work,0x60),0);
}
void ellipsis(u16* text,u32 width) {
    u32 n=0;while(text[n]!=End && text[n])++n;
    if(measure(text)<=width)return;
    n=n>3?n-3:0;
    do {text[n]='.';text[n+1]='.';text[n+2]='.';text[n+3]=End;
        if(measure(text)<=width || !n)break;
        --n;
    }while(true);
}
bool bankString(Messages& messages,u32 bank,u32 id,u16* out,u32 capacity) {
    out[0]=End;
    void* handle=messages.handle(bank,id);
    if(!handle)return false;
    void* text=message(handle,id);
    if(text){copyText(out,capacity,stringText(text));stringFree(text);}
    return text!=nullptr;
}
bool privateString(Messages& messages,InfoMessage key,u16* out,u32 capacity) {
    const u32 i=static_cast<u32>(key);
    const u16 id=learnsetInfoConfig.ids[i][0],inverse=learnsetInfoConfig.ids[i][1];
    if(learnsetInfoConfig.version!=1 || learnsetInfoConfig.count!=InfoMessageCount || !configured(id,inverse)) {
        asciiText(out,capacity,"Info unavailable.");return false;
    }
    if(bankString(messages,401,id,out,capacity))return true;
    asciiText(out,capacity,"Info unavailable.");return false;
}
void number(u16* out,u32 value) {out[decimal(out,value)]=End;}
void speciesName(Messages& messages,u16 species,u16* out,u32 capacity) {
    if(!bankString(messages,90,species,out,capacity)) {asciiText(out,capacity,"#");number(out+1,species);}
}
void requirement(Messages& messages,const Evolution& e,u16* out) {
    u16 format[192],parameter[64],second[16];number(parameter,e.parameter);number(second,e.parameter);
    u32 bank=0;
    switch(e.method) {
        case 6:case 8:case 17:case 18:case 19:case 20:bank=64;break;
        case 7:case 22:bank=90;break;
        case 21:bank=403;break;
    }
    if(bank && !bankString(messages,bank,e.parameter,parameter,64))number(parameter,e.parameter);
    InfoMessage key=InfoMessage::Unknown;
    if(e.method>=1 && e.method<=31)key=static_cast<InfoMessage>(static_cast<u32>(InfoMessage::Method1)+e.method-1);
    else number(parameter,e.method);
    privateString(messages,key,format,192);
    expandInfo(out,TextCapacity,format,parameter,second);
}
bool loadIcon(Archive& icons,const InfoNode& node,u32 gender,u32 index) {
    const u32 member=native<u32(*)(u32,u32,u32,u32)>(0x2020fc1,0x2020f95)(node.species,node.form,gender,0);
    const u32 pal=native<u32(*)(u32,u32,u32,u32)>(0x2021061,0x2021035)(node.species,node.form,gender,0);
    u8 data[1072],palette[256];
    const u32 length=icons.member(member,data,sizeof(data));
    const u32 palLength=icons.member(0,palette,sizeof(palette));
    if(length!=1072 || read32(data)!=0x4e434752 || read32(data+16)!=0x43484152
        || read32(data+40)<512 || pal>=3 || palLength<40+(pal+1)*32)return false;
    // NCGR is 32x64 (two frames), tile data begins at 0x30; use frame zero.
    for(u32 i=0;i<512;++i)state->icons[index][i]=data[48+i];
    for(u32 i=0;i<16;++i)state->palettes[index][i]=read16(palette+40+pal*32+i*2);
    return true;
}
void showBranch(u32 option) {
    const auto& branch=state->branches[option];state->chain=branch.chain;
    bool used[3]={};
    // Reserve existing identities before replacing any cache slot, including
    // failed icons. A continuation page performs no ROM I/O at all.
    for(u32 i=0;i<state->chain.count;++i) {
        state->iconSlots[i]=3;
        const auto& node=branch.nodes[i];
        const u32 gender=i==state->chain.selected?state->gender:0;
        for(u32 s=0;s<3;++s)if(!used[s] && state->iconKeys[s].species==node.species
            && state->iconKeys[s].form==node.form && state->iconKeys[s].gender==gender) {
            state->iconSlots[i]=s;used[s]=true;break;
        }
    }
    Archive icons;bool tried=false,opened=false;
    for(u32 i=0;i<state->chain.count;++i)if(state->iconSlots[i]==3) {
        u32 slot=0;while(used[slot])++slot;used[slot]=true;state->iconSlots[i]=slot;
        if(!tried){tried=true;opened=icons.open("a/0/0/7");}
        const auto& node=branch.nodes[i];
        const u16 gender=i==state->chain.selected?state->gender:0;
        state->iconKeys[slot]={node.species,node.form,gender};
        state->iconsValid[slot]=opened && loadIcon(icons,node,gender,slot);
    }
}
void load(Request* request) {
    Archive personal,evolutions;Messages messages;
    const bool msgOk=messages.open("a/0/0/2");
    const u32 species=pokemonGet(request->tutor.pokemon,5),form=pokemonGet(request->tutor.pokemon,0x6f);
    state->gender=pokemonGet(request->tutor.pokemon,0x6e);
    u16 name[64],format[128];speciesName(messages,species,name,64);
    copyText(state->selectedName,64,name);
    for(u32 i=0;name[i]!=End;++i)name[i]=infoUpper(name[i]);
    privateString(messages,InfoMessage::Title,format,128);
    expandInfo(state->title,96,format,name);
    // Truncate only the species component, never the possessive suffix.
    u32 nameLength=0;while(name[nameLength]!=End)++nameLength;
    if(measure(state->title)>240)nameLength=nameLength>3?nameLength-3:1;
    while(nameLength && measure(state->title)>240) {
        --nameLength;name[nameLength]='.';name[nameLength+1]='.';name[nameLength+2]='.';name[nameLength+3]=End;
        expandInfo(state->title,96,format,name);
    }
    for(u32 i=0;i<6;++i) {
        privateString(messages,static_cast<InfoMessage>(1+i),state->labels[i],16);
        ellipsis(state->labels[i],26);
    }
    privateString(messages,InfoMessage::EvolutionUnavailable,state->status,64);
    privateString(messages,InfoMessage::StatsUnavailable,state->statsUnavailable,64);
    privateString(messages,InfoMessage::AbilitiesUnavailable,state->abilityNames[0],64);
    if(!personal.open("a/0/1/6") || !personal.count || personal.count>MaxPersonal || !species || species>=personal.count)return;
    InfoNode* nodes=static_cast<InfoNode*>(alloc(Heap,personal.count*sizeof(InfoNode)));
    if(!nodes)return;
    personal.buffer();
    for(u32 i=0;i<personal.count;++i)nodes[i]={};
    u8 record[76];
    for(u32 i=1;i<personal.count;++i) {
        if(personal.member(i,record,76)==76) {nodes[i].species=i;nodes[i].valid=true;}
    }
    for(u32 i=1;i<personal.count;++i) {
        if(!nodes[i].valid || nodes[i].form || personal.member(i,record,76)!=76)continue;
        const u32 first=read16(record+28),forms=record[32];
        if(!first || forms<2 || forms>32 || first>=personal.count || forms-1>personal.count-first)continue;
        for(u32 f=1;f<forms;++f)if(nodes[first+f-1].valid && !nodes[first+f-1].form) {
            nodes[first+f-1].species=i;nodes[first+f-1].form=f;
        }
    }
    // Use the game's current form resolver (including any compatible hooks).
    const u32 selected=native<u32(*)(u32,u32)>(0x20204ad,0x2020481)(species,form);
    if(selected>=personal.count || !nodes[selected].valid){release(nodes);return;}
    if(personal.member(selected,record,76)==76) {
        const u8 offsets[]={0,1,2,4,5,3};
        for(u32 i=0;i<6;++i)state->stats[i]=record[offsets[i]];
        state->statsValid=true;
        // BW2 personal bytes 24..26 are the two normal and hidden slots.
        state->abilities=infoAbilities(record+24);
        if(!state->abilities.count)privateString(messages,InfoMessage::NoAbilities,state->abilityNames[0],64);
        for(u32 i=0;i<state->abilities.count;++i) {
            u16* name=state->abilityNames[i];const u32 id=state->abilities.ids[i];
            // Match Pokeweb's ROM-name precedence, including expanded banks.
            if(!bankString(messages,487,id,name,64) || name[0]==End)
                if(!bankString(messages,374,id,name,64) || name[0]==End) {
                    asciiText(name,64,"#");number(name+1,id);
                }
        }
    }
    personal.unbuffer();
    Evolutions options={};
    if(evolutions.open("a/0/1/9") && evolutions.count<=MaxPersonal) {
        evolutions.buffer();
        for(u32 source=1;source<evolutions.count && source<personal.count;++source) {
            if(!nodes[source].valid)continue;
            u8 raw[48]; const u32 length=evolutions.member(source,raw,48);
            Evolutions e=parseEvolutions(raw,length,personal.count);
            if(e.valid)for(u32 i=0;i<e.count;++i)if(!nodes[e.entries[i].target].valid)e.valid=false;
            nodes[source].evolutionValid=e.valid;
            if(source==selected)options=e;
            if(!e.valid)continue;
            for(u32 i=0;i<e.count;++i) {
                const u16 target=e.entries[i].target;
                if(!nodes[source].next)nodes[source].next=target;
                if(!nodes[target].parent)nodes[target].parent=source;
            }
        }
        evolutions.unbuffer();
    }
    // Snapshot only the at-most-three identities for each option. The full
    // graph is temporary; paging never rescans personal/evolution archives.
    const u32 branches=options.valid && options.count?options.count:1;
    for(u32 b=0;b<branches;++b) {
        auto& branch=state->branches[b];
        branch.chain=infoChain(nodes,personal.count,selected,options.valid && options.count?options.entries[b].target:End);
        for(u32 i=0;i<branch.chain.count;++i)branch.nodes[i]=nodes[branch.chain.ids[i]];
    }
    showBranch(0);
    state->evolutionValid=options.valid && msgOk;
    if(state->evolutionValid && !options.count)
        privateString(messages,nodes[selected].parent?InfoMessage::NoFurtherEvolution:InfoMessage::NoEvolution,state->status,64);
    if(state->evolutionValid)for(u32 i=0;i<options.count;++i) {
        requirement(messages,options.entries[i],state->requirements[i]);
        speciesName(messages,nodes[options.entries[i].target].species,state->targets[i],64);
        u16 line[128];u32 offset=0;
        do {
            if(state->pageCount>=128)break;
            state->pages[state->pageCount++]={u16(offset),u8(i),0};
            for(u32 n=0;n<2;++n)offset=wrapInfo(state->requirements[i],offset,line,128,240,measure);
        }while(state->requirements[i][offset]!=End);
    }
    release(nodes);
}
constexpr u16 rgb(u32 r,u32 g,u32 b){return (r>>3)|((g>>3)<<5)|((b>>3)<<10);}
constexpr u16 colors[16]={rgb(48,50,65),rgb(48,50,65),rgb(32,33,43),rgb(24,27,31),
    rgb(82,89,100),rgb(58,71,80),rgb(64,188,180),rgb(142,235,219),
    rgb(180,192,196),rgb(104,120,127),rgb(238,175,62),rgb(255,219,149),
    rgb(205,158,247),0,0,rgb(239,244,240)};
u32 iconX(u32 index){return (state->chain.count==3?120:state->chain.count==2?144:168)+index*48;}
void render() {
    u8* data=pixels();
    if(!data)return;
    // A full opaque BG2 panel covers retail BG3; disable BG3 so transparent
    // icon pixels cannot reveal the old move bars or name plate underneath.
    native<void(*)(u32,u32)>(0x2044cc5,0x2044c99)(3,0);
    volatile u16* palette=reinterpret_cast<volatile u16*>(0x05000000);
    palette[0]=colors[0];
    for(u32 i=0;i<16;++i)palette[14*16+i]=colors[i];
    infoRect(data,0,0,256,192,1);infoRect(data,0,0,256,24,3);
    infoRect(data,0,0,256,1,6);infoRect(data,0,23,256,1,6);
    infoRect(data,108,31,1,95,4);infoRect(data,0,130,256,1,6);
    infoRect(data,0,132,256,60,3);
    put(state->title,8,4);
    u16 text[128];
    if(state->statsValid)for(u32 i=0;i<6;++i) {
        const u32 y=32+16*i;put(state->labels[i],6,y);
        number(text,state->stats[i]);put(text,52-int(measure(text)),y);
        infoRect(data,56,y+3,48,10,4);infoRect(data,57,y+4,46,8,2);
        infoRect(data,57,y+4,statBar(state->stats[i]),8,10);
        infoRect(data,57,y+4,statBar(state->stats[i]),2,11);
    } else {
        copyText(text,128,state->statsUnavailable);ellipsis(text,96);put(text,6,64);
    }
    for(u32 i=0;i<state->chain.count;++i) {
        const u32 x=iconX(i),slot=state->iconSlots[i];
        infoRect(data,x-2,30,36,36,i==state->chain.selected?7:4);
        infoRect(data,x-1,31,34,34,1);
        if(state->iconsValid[slot]) {
            for(u32 t=0;t<16;++t) {
                palette[(10+i)*16+t]=state->palettes[slot][t];
                const u32 tx=t%4,ty=t/4;
                for(u32 b=0;b<32;++b)data[((4+ty)*32+x/8+tx)*32+b]=state->icons[slot][t*32+b];
            }
        } else {asciiText(text,128,"?");put(text,x+12,40);}
        if(i+1<state->chain.count) {
            // A wider, explicit right-pointing arrow; no change to chain order.
            infoRect(data,x+35,47,10,2,8);
            for(u32 d=1;d<4;++d) {infoPixel(data,x+44-d,47-d,8);infoPixel(data,x+44-d,48+d,8);}
        }
    }
    for(u32 dot=0;dot<3;++dot) {
        if(state->chain.before)infoPixel(data,iconX(0)-7+dot*2,47,8);
        if(state->chain.after)infoPixel(data,iconX(state->chain.count-1)+35+dot*2,47,8);
    }
    const u32 count=state->abilities.count?state->abilities.count:1;
    for(u32 i=0;i<count;++i) {
        copyText(text,128,state->abilityNames[i]);
        if(state->abilities.count)infoTitleCase(text);
        ellipsis(text,132);
        put(text,120,76+16*i,state->abilities.hidden[i]?0x3040:0x3c40);
    }
    if(state->pageCount) {
        u32 headerWidth=240;
        if(state->pageCount>1) {
            asciiText(text,128,"L ");u32 n=2;n+=decimal(text+n,state->page+1);text[n++]='/';n+=decimal(text+n,state->pageCount);
            text[n++]=' ';text[n++]='R';text[n]=End;
            const u32 width=measure(text);put(text,248-int(width),136);headerWidth-=width+8;
        }
        const Page& p=state->pages[state->page];
        u16 a[64],b[64];copyText(a,64,state->selectedName);copyText(b,64,state->targets[p.option]);
        ellipsis(a,(headerWidth-20)/2);ellipsis(b,(headerWidth-20)/2);u32 n=copyText(text,128,a);
        text[n++]=' ';text[n++]=0x2192;text[n++]=' ';copyText(text+n,128-n,b);
        ellipsis(text,headerWidth);put(text,8,136);
        u32 offset=p.offset;
        for(u32 row=0;row<2;++row) {offset=wrapInfo(state->requirements[p.option],offset,text,128,240,measure);put(text,8,152+row*16);}
    } else {
        u32 offset=0;
        for(u32 row=0;row<3;++row){offset=wrapInfo(state->status,offset,text,128,240,measure);put(text,8,136+row*16);}
    }
    void* window=at<void*>(state->work,0x38);
    native<void(*)(void*)>(0x2048271,0x2048245)(window);
    native<void(*)(void*)>(0x2048299,0x204826d)(window);
    // MakeTransWindow creates a single-palette map. Assign the three icon
    // rectangles their original ROM palettes in the *CPU* map before upload.
    u16* map=native<u16*(*)(u32)>(0x2045841,0x2045815)(2);
    if(map)for(u32 i=0;i<state->chain.count;++i)if(state->iconsValid[state->iconSlots[i]])
        for(u32 y=4;y<8;++y)for(u32 x=iconX(i)/8;x<iconX(i)/8+4;++x)
            map[y*32+x]=u16((map[y*32+x]&0x0fff)|((10+i)<<12));
    native<void(*)(u32)>(0x2045ba9,0x2045b7d)(2);
}
}

void infoInit(void* work,Request* request) {
    infoEnd();
    for(u32 offset=0x124;offset<=0x134;offset+=4)
        native<void(*)(void*,u32)>(0x204c151,0x204c125)(at<void*>(work,offset),0);
    state=static_cast<InfoState*>(alloc(Heap,sizeof(InfoState)));
    if(!state) {
        // Even an exhausted info allocation leaves a readable, dismissible
        // screen. Native tutor windows already exist and own their buffers.
        void* window=at<void*>(work,0x38);
        void* bitmap=native<void*(*)(void*)>(0x2048521,0x20484f5)(window);
        native<void(*)(void*,u32)>(0x2047169,0x204713d)(bitmap,1);
        volatile u16* palette=reinterpret_cast<volatile u16*>(0x05000000);
        for(u32 i=0;i<16;++i)palette[14*16+i]=colors[i];
        u16 text[32];asciiText(text,32,"Info unavailable.");
        void* buffer=at<void*>(work,0x4c);stringSet(buffer,text);
        native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(bitmap,8,32,buffer,at<void*>(work,0x60),0x3c40);
        native<void(*)(void*)>(0x2048271,0x2048245)(window);
        native<void(*)(void*)>(0x2048299,0x204826d)(window);
        native<void(*)(u32)>(0x2045ba9,0x2045b7d)(2);
        return;
    }
    *state={};state->work=work;
    load(request);render();
}
void infoInput(void* work) {
    if(!state || state->work!=work || state->pageCount<2)return;
    const u32 keys=native<u32(*)()>(0x203df29,0x203defd)();
    if((keys&0x300)==0x100)state->page=state->page+1==state->pageCount?0:state->page+1;
    else if((keys&0x300)==0x200)state->page=state->page?state->page-1:state->pageCount-1;
    else return;
    showBranch(state->pages[state->page].option);
    render();
}
void infoEnd() {InfoState* old=state;state=nullptr;release(old);}

// Only called at the tutor's window-creation call site. Keep valid tiny
// windows for unused upper slots so the original destruction loop is intact.
extern "C" void* LearnsetWindow(u32 frame,u32 x,u32 y,u32 width,u32 height,u32 palette,u32 direction) {
    if(LearnsetIsActive() && frame==2 && width>1) {
        if(y==0){x=0;y=0;width=32;height=24;palette=14;}
        else {x=0;y=24;width=1;height=1;}
    }
    return native<void*(*)(u32,u32,u32,u32,u32,u32,u32)>(0x20480ed,0x20480c1)(frame,x,y,width,height,palette,direction);
}
