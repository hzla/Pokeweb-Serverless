#include "info.h"
#include "info_logic.h"
#include "info_messages.generated.h"
#include "info_background.generated.h"

namespace {
// Only the overlay-258 module owns this state; no field/menu heap growth.
constexpr u32 Heap=79, TextCapacity=256;
struct Page { u16 offset; u8 option; bool incoming; };
struct DisplayChain { Chain chain; InfoNode nodes[3]; };
struct IconKey { u16 species,form,gender; };
struct InfoView {
    void* work;
    u16 selectedName[64], title[96], partyCue[12], requirements[8][TextCapacity];
    u16 targets[8][64], labels[6][16], status[64];
    u16 statsUnavailable[64];
    u16 abilityNames[3][64]; Abilities abilities;
    u8 iconFrame,iconTicks;
    u8 types[2],typeCount;
    u8 stats[6]; bool statsValid, evolutionValid;
    Chain chain; DisplayChain branches[8]; u16 gender;
    u8 iconSlots[3];
    Page pages[128]; u16 pageCount,page;
    ViewSelection navigation[2];
};
struct InfoState : InfoView {
    // Read-only ROM data shared by selections within this viewer session.
    // Native windows, party data and the field request are never cached here.
    u8 icons[3][1024]; u16 palettes[3][16];
    IconKey iconKeys[3]; bool iconsValid[3];
    InfoNode* graph; u32 graphCount; bool graphReady;
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
void headerTypes() {
    const u32 width=state->partyCue[0]==End?240:232-measure(state->partyCue);
    const u32 badges=state->typeCount?4+state->typeCount*32+(state->typeCount-1)*2:0;
    ellipsis(state->title,width-badges);
    // Anchor the final badge eight pixels before the party cue, independent
    // of species-name length. Keep a minimum four-pixel name/badge gap.
    const u32 left=8+width-badges+4;
    for(u32 i=0;i<2;++i) {
        void* actor=at<void*>(state->work,0x124+4*i);
        if(i<state->typeCount) {
            // Reuse native upper type actors/resources. Cell 0 is a centered
            // 32x16 badge; Y=12 centers it in the black header (Y=3..20).
            const short position[]={short(left+16+i*34),12};
            native<void(*)(void*,const short*)>(0x204c23d,0x204c211)(actor,position);
            const u32 palette=native<u32(*)(u32)>(0x202d815,0x202d7e9)(state->types[i]);
            native<void(*)(void*,u32,u32)>(0x204c3a5,0x204c379)(actor,palette,1);
            // The tutor's existing VBlank queue loads member 34+type into
            // this actor's private character resource; never replace palettes.
            at<volatile u32>(state->work,0x140+i*8)=state->types[i];
            at<volatile u32>(state->work,0x144+i*8)=1;
        } else at<volatile u32>(state->work,0x144+i*8)=0;
        native<void(*)(void*,u32)>(0x204c151,0x204c125)(actor,i<state->typeCount);
    }
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
        || read32(data+40)!=1024 || pal>=3 || palLength<40+(pal+1)*32)return false;
    // NCGR is 32x64: cache both native 32x32 poses in the session heap.
    // This reads the same 1072-byte member as before; idle ticks need no I/O.
    for(u32 i=0;i<1024;++i)state->icons[index][i]=data[48+i];
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
    // Physical party slot, not evolution-page position. Invalid/legacy context
    // simply omits the cue; the field-owned request is never changed here.
    state->partyCue[0]=End;
    const u32 count=partyCount(request->party);
    if(count && count<=6 && request->partySlot<count) {
        u16* cue=state->partyCue;u32 n=0;
        if(count>1){cue[n++]='<';cue[n++]=' ';}
        n+=decimal(cue+n,request->partySlot+1);cue[n++]='/';n+=decimal(cue+n,count);
        if(count>1){cue[n++]=' ';cue[n++]='>';}
        cue[n]=End;
    }
    Archive personal,evolutions;Messages messages;
    const bool msgOk=messages.open("a/0/0/2");
    const auto identity=viewIdentity(request);
    const u32 species=identity.species,form=identity.form;
    state->gender=species==pokemonGet(request->tutor.pokemon,5) && form==pokemonGet(request->tutor.pokemon,0x6f)
        ? pokemonGet(request->tutor.pokemon,0x6e) : 0;
    u16 name[64],format[128];speciesName(messages,species,name,64);
    copyText(state->selectedName,64,name);
    for(u32 i=0;name[i]!=End;++i)name[i]=infoUpper(name[i]);
    privateString(messages,InfoMessage::Title,format,128);
    expandInfo(state->title,96,format,name);
    for(u32 i=0;i<6;++i) {
        privateString(messages,static_cast<InfoMessage>(1+i),state->labels[i],16);
        ellipsis(state->labels[i],26);
    }
    privateString(messages,InfoMessage::EvolutionUnavailable,state->status,64);
    privateString(messages,InfoMessage::StatsUnavailable,state->statsUnavailable,64);
    privateString(messages,InfoMessage::AbilitiesUnavailable,state->abilityNames[0],64);
    if(!personal.open("a/0/1/6") || !personal.count || personal.count>MaxPersonal || !species || species>=personal.count)return;
    if(state->graphCount!=personal.count) {
        release(state->graph);state->graph=nullptr;state->graphCount=0;state->graphReady=false;
    }
    if(!state->graph) {
        state->graph=static_cast<InfoNode*>(alloc(Heap,personal.count*sizeof(InfoNode)));
        if(state->graph)state->graphCount=personal.count;
    }
    InfoNode* nodes=state->graph;
    if(!nodes)return;
    const bool rebuild=!state->graphReady;
    u8 record[76];
    if(rebuild) {
        personal.buffer();
        for(u32 i=0;i<personal.count;++i)nodes[i]={};
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
    }
    // Use the game's current form resolver (including any compatible hooks).
    const u32 selected=native<u32(*)(u32,u32)>(0x20204ad,0x2020481)(species,form);
    if(selected>=personal.count || !nodes[selected].valid)return;
    u16 defaultParent=nodes[selected].parent;
    if(personal.member(selected,record,76)==76) {
        const u8 offsets[]={0,1,2,4,5,3};
        for(u32 i=0;i<6;++i)state->stats[i]=record[offsets[i]];
        state->statsValid=true;
        // Types follow the same resolved form record as base stats. Reject
        // out-of-range IDs before indexing the native type-resource tables.
        if(record[6]<18 && record[7]<18) {
            state->types[0]=record[6];state->types[1]=record[7];
            state->typeCount=record[6]==record[7]?1:2;
        }
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
    Evolutions options={},incoming={};
    if(evolutions.open("a/0/1/9") && evolutions.count<=MaxPersonal) {
        if(rebuild) {
            evolutions.buffer();
            for(u32 source=1;source<evolutions.count && source<personal.count;++source) {
                if(!nodes[source].valid)continue;
                u8 raw[48]; const u32 length=evolutions.member(source,raw,48);
                Evolutions e=parseEvolutions(raw,length,personal.count);
                if(e.valid)for(u32 i=0;i<e.count;++i)if(!nodes[e.entries[i].target].valid)e.valid=false;
                nodes[source].evolutionValid=e.valid;
                if(!e.valid)continue;
                for(u32 i=0;i<e.count;++i) {
                    const u16 target=e.entries[i].target;
                    if(!nodes[source].next)nodes[source].next=target;
                    if(!nodes[target].parent)nodes[target].parent=source;
                }
            }
            state->graphReady=true;
        }
        // Sibling navigation/requirements often ask for the same parent more
        // than once. Keep four tiny records on the stack, not whole archives.
        struct Recent {u16 id; Evolutions data;} recent[4]={};u32 cursor=0;
        auto read=[&](u16 source) {
            for(u32 i=0;i<4;++i)if(recent[i].id==source)return recent[i].data;
            u8 raw[48];const u32 length=evolutions.member(source,raw,48);
            auto e=parseEvolutions(raw,length,personal.count);
            if(e.valid)for(u32 i=0;i<e.count;++i)if(!nodes[e.entries[i].target].valid)e.valid=false;
            recent[cursor]={source,e};cursor=(cursor+1)&3;
            return e;
        };
        options=read(u16(selected));
        defaultParent=nodes[selected].parent;
        // Preserve the actual source when following an edge in a ROM with
        // multiple possible predecessors. Never trust an unrelated parent hint.
        const auto hint=request->view.parent;
        if(hint.species && hint.species<personal.count) {
            const u32 parent=native<u32(*)(u32,u32)>(0x20204ad,0x2020481)(hint.species,hint.form);
            if(parent<personal.count && nodes[parent].valid) {
                u16 targets[8];const u32 n=familyTargets(nodes,personal.count,read(parent),targets);
                for(u32 i=0;i<n;++i)if(sameNode(nodes,targets[i],selected))nodes[selected].parent=parent;
            }
        }
        for(u32 direction=0;direction<2;++direction) {
            const auto step=familyStep(nodes,personal.count,u16(selected),direction!=0,read);
            if(step.target) {
                const auto& node=nodes[step.target];
                state->navigation[direction].identity={node.species,node.form};
                if(step.parent && step.parent<personal.count && nodes[step.parent].valid) {
                    const auto& parent=nodes[step.parent];
                    state->navigation[direction].parent={parent.species,parent.form};
                }
            }
        }
        // Terminal stages describe the immediate predecessor already chosen
        // for the chain (including a verified navigation hint), not whichever
        // sibling happens to be first in that predecessor's evolution record.
        const u16 parent=nodes[selected].parent;
        if(options.valid && !options.count && parent && nodes[parent].evolutionValid) {
            const auto e=read(parent);
            if(e.valid) {
                incoming.valid=true;
                for(u32 i=0;i<e.count;++i)if(nodes[e.entries[i].target].valid
                    && sameNode(nodes,e.entries[i].target,selected)) {
                    // ROM slot order is authoritative: show only the last
                    // matching method/parameter pair, never alternate pages.
                    incoming.entries[0]=e.entries[i];incoming.count=1;
                }
            }
        }
        evolutions.unbuffer();
    }
    // Snapshot the at-most-three identities for each option. The graph and
    // icon pixels are session-owned; paging never performs ROM reads.
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
    const bool fromParent=incoming.valid && incoming.count;
    const auto& details=fromParent?incoming:options;
    if(state->evolutionValid)for(u32 i=0;i<details.count;++i) {
        if(fromParent) {
            u16 detail[TextCapacity],source[64],format[64];
            requirement(messages,details.entries[i],detail);
            speciesName(messages,nodes[nodes[selected].parent].species,source,64);
            privateString(messages,InfoMessage::FromPredecessor,format,64);
            expandInfo(state->requirements[i],TextCapacity,format,source,detail);
        } else {
            requirement(messages,details.entries[i],state->requirements[i]);
            speciesName(messages,nodes[details.entries[i].target].species,state->targets[i],64);
        }
        u16 line[128];u32 offset=0;
        do {
            if(state->pageCount>=128)break;
            state->pages[state->pageCount++]={u16(offset),u8(i),fromParent};
            for(u32 n=0;n<2;++n)offset=wrapInfo(state->requirements[i],offset,line,128,240,measure);
        }while(state->requirements[i][offset]!=End);
    }
    // A selected stage's verified navigation hint must not leak into another
    // selection's deterministic predecessor lookup in the shared graph.
    nodes[selected].parent=defaultParent;
}
constexpr u16 rgb(u32 r,u32 g,u32 b){return (r>>3)|((g>>3)<<5)|((b>>3)<<10);}
constexpr u16 colors[16]={rgb(48,50,65),rgb(48,50,65),rgb(32,33,43),rgb(24,27,31),
    rgb(82,89,100),rgb(58,71,80),rgb(64,188,180),rgb(142,235,219),
    rgb(180,184,192),rgb(218,218,222),rgb(238,175,62),rgb(255,219,149),
    rgb(205,158,247),0,0,rgb(239,244,240)};
constexpr u16 HiddenAbilityColor=rgb(120,72,160);
constexpr u32 InsetInk=13;
constexpr u32 InsetTextInk=(6<<10)|(14<<5), HiddenAbilityInk=(12<<10)|(14<<5);
u32 iconX(u32 index){return (state->chain.count==3?120:state->chain.count==2?144:168)+index*48;}
// Compact the upper content, preserving the font size and footer text area.
constexpr u32 CardTop=46, CardBottom=81, IconY=48, StatY=41, StatStep=15,
    AbilityY=84, UpperBottom=131, GutterY=132, EvolutionY=140;
constexpr u32 StatInk=InsetTextInk;
// POKEICON_ANM_HPMAX in both US a/0/0/7 NANRs is cells 0/1, eight ticks each.
// These informational species icons use healthy idle, not party HP/status.
constexpr u32 IconFrameTicks=8;
bool drawIconPixels(u8* data) {
    bool changed=false;
    for(u32 i=0;i<state->chain.count;++i) {
        const u32 slot=state->iconSlots[i],x=iconX(i);
        if(!state->iconsValid[slot])continue;
        const u8* frame=state->icons[slot]+(i==state->chain.selected?state->iconFrame*512:0);
        for(u32 t=0;t<16;++t) {
            const u32 tx=t%4,ty=t/4;
            for(u32 b=0;b<32;++b)data[((IconY/8+ty)*32+x/8+tx)*32+b]=frame[t*32+b];
        }
        changed=true;
    }
    return changed;
}
void animateIcons() {
    if(++state->iconTicks<IconFrameTicks)return;
    state->iconTicks=0;state->iconFrame^=1;
    u8* data=pixels();
    if(data && drawIconPixels(data)) {
        // Native bitmap-character upload only. Keep the existing CPU tilemap,
        // per-icon palettes, text, frame and lower screen entirely untouched.
        native<void(*)(void*)>(0x2048271,0x2048245)(at<void*>(state->work,0x38));
    }
}
void background(u8* data) {
    // Retail title rails, one clipped pale stats panel, and a matching pale
    // icon/ability panel. No row rules or per-stat/card grid is needed.
    // Fill the existing bitmap; no new resource reads, hooks or allocations.
    native<void(*)(u32,u32)>(0x2044cc5,0x2044c99)(3,0);
    volatile u16* palette=reinterpret_cast<volatile u16*>(0x05000000);
    // DS sub BG starts at +0x400 bytes. +0x200 is MAIN OBJ and contains
    // Pokemon sprite colors, not the lower description background.
    const volatile u16* subBg=reinterpret_cast<const volatile u16*>(0x05000400);
    const u16 panelColor=subBg[17];
    palette[0]=panelColor; // Transparent icon pixels match both light panels.
    for(u32 i=0;i<16;++i)palette[14*16+i]=colors[i];
    for(const auto& color:TutorBackgroundColors)palette[14*16+color.index]=color.value;
    // Keep retail title-rail colors and font shadows intact. Bank 9 serves
    // only content rows. Use a darker hidden-ability purple on the pale fill.
    for(u32 i=0;i<16;++i)palette[9*16+i]=palette[14*16+i];
    palette[9*16+7]=rgb(32,120,120); // Selected frame only; keep title/fin teal bright.
    palette[9*16+9]=panelColor;
    palette[9*16+InsetInk]=panelColor;
    palette[9*16+12]=HiddenAbilityColor;
    // Retail loads the same ROM font palette into bank 15 on both screens.
    // Reuse its dark foreground and visible glyph shadow in unused slots;
    // matching the panel fill to the shadow had made the upper text look thin.
    palette[9*16+6]=palette[15*16+1];
    palette[9*16+14]=palette[15*16+2];
    // Extend the description-style left shade through the icon area without
    // changing the surrounding fill or the native icon palettes.
    palette[9*16+2]=subBg[19];
    palette[9*16+5]=subBg[21];
    // The final eight tile rows also carry the last stat/ability glyph pixels.
    // Preserve the dark footer's white text while matching the upper light rows.
    for(u32 i=0;i<16;++i)palette[13*16+i]=palette[14*16+i];
    palette[13*16+1]=rgb(48,80,80);
    palette[13*16+5]=rgb(56,56,64);
    palette[13*16+9]=panelColor;
    palette[13*16+InsetInk]=panelColor; // Last four panel rows share footer tiles.
    palette[13*16+12]=HiddenAbilityColor;
    palette[13*16+6]=palette[15*16+1];
    palette[13*16+14]=palette[15*16+2];
    // Ability rows reuse the lower description's rule and shaded left edge.
    // A private palette isolates these colors from the dark footer and icons.
    for(u32 i=0;i<16;++i)palette[8*16+i]=palette[13*16+i];
    palette[8*16+2]=subBg[19];
    palette[8*16+5]=subBg[21];
    palette[8*16+7]=palette[9*16+7];
    infoRect(data,0,0,256,192,1);
    for(const auto& row:TutorBackgroundRuns)if(row.y<40)
        infoRect(data,0,row.y,256,row.height<40-row.y?row.height:40-row.y,row.color);
    for(u32 y=40;y<=UpperBottom;++y)infoRect(data,0,y,y<52?100+y-40:112,1,9);
    // One muted frame groups the entire evolution/ability section; the
    // native icon tiles remain unscaled and only the selected one is teal.
    for(u32 y=40;y<=UpperBottom;++y) {
        const u32 cut=y<44?44-y:y>UpperBottom-4?y-(UpperBottom-4):0;
        const u32 left=112+cut,right=255-cut;
        infoRect(data,left,y,right-left+1,1,y==40 || y==UpperBottom?4:InsetInk);
        infoPixel(data,left,y,4);infoPixel(data,right,y,4);
    }
    for(u32 y=41;y<UpperBottom;++y) {
        const u32 cut=y<44?44-y:y>UpperBottom-4?y-(UpperBottom-4):0;
        const u32 left=112+cut,right=255-cut;
        infoRect(data,left+1,y,3,1,5);
        infoPixel(data,left+4,y,2);
        if(y==AbilityY+16 || y==AbilityY+32)infoRect(data,left+4,y,right-left-4,1,2);
    }
    // Four uninterrupted rows of slate-teal precede the fin; the same fill
    // continues behind its sloping edge instead of meeting pale stats directly.
    infoRect(data,0,GutterY,256,4,1);
    // The fin and top strip share a dark cap above a lighter charcoal body,
    // as in the Pokedex. Keep teal hatch marks, without side/bottom outlines.
    // Geometry and text baselines are unchanged.
    infoRect(data,0,140,256,52,5);
    infoRect(data,0,136,25,1,3);
    for(u32 d=1;d<=3;++d) {
        infoRect(data,0,136+d,24+d,1,3);
        infoPixel(data,24+d,136+d,3);
        infoPixel(data,16+d,136+d,7);
        infoPixel(data,20+d,136+d,7);
    }
    infoRect(data,27,139,229,1,3);
}
u16* paletteMap() {
    u16* map=native<u16*(*)(u32)>(0x2045841,0x2045815)(2);
    if(map)for(u32 y=5;y<24;++y)for(u32 x=0;x<32;++x)
        map[y*32+x]=u16((map[y*32+x]&0x0fff)|((x>=14 && y>=10 && y<17?8:y<16?9:13)<<12));
    return map;
}
void render() {
    u8* data=pixels();
    if(!data)return;
    // A full opaque BG2 panel covers retail BG3; disable BG3 so transparent
    // icon pixels cannot reveal the old move bars or name plate underneath.
    background(data);
    volatile u16* palette=reinterpret_cast<volatile u16*>(0x05000000);
    put(state->title,8,4);
    if(state->partyCue[0]!=End)put(state->partyCue,248-int(measure(state->partyCue)),4,(7<<10)|(3<<5));
    u16 text[128];
    if(state->statsValid)for(u32 i=0;i<6;++i) {
        const u32 y=StatY+StatStep*i;put(state->labels[i],6,y,StatInk);
        number(text,state->stats[i]);put(text,52-int(measure(text)),y,StatInk);
        infoRect(data,57,y+4,46,8,8);
        infoRect(data,57,y+4,statBar(state->stats[i]),8,10);
        infoRect(data,57,y+4,statBar(state->stats[i]),2,11);
    } else {
        copyText(text,128,state->statsUnavailable);ellipsis(text,96);put(text,6,64,StatInk);
    }
    for(u32 i=0;i<state->chain.count;++i) {
        const u32 x=iconX(i),slot=state->iconSlots[i];
        // Only the selected identity gets a frame. All native 32x32 icons
        // remain tile-aligned and unscaled, with no opaque default cards.
        if(i==state->chain.selected) {
            infoRect(data,x-2,CardTop,36,CardBottom-CardTop+1,7);
            infoRect(data,x-1,CardTop+1,34,CardBottom-CardTop-1,InsetInk);
        }
        if(state->iconsValid[slot]) {
            for(u32 t=0;t<16;++t)palette[(10+i)*16+t]=state->palettes[slot][t];
        } else {asciiText(text,128,"?");put(text,x+12,IconY+8,InsetTextInk);}
        if(i+1<state->chain.count) {
            // A wider, explicit right-pointing arrow; no change to chain order.
            infoRect(data,x+35,IconY+15,10,2,4);
            for(u32 d=1;d<4;++d) {infoPixel(data,x+44-d,IconY+15-d,4);infoPixel(data,x+44-d,IconY+16+d,4);}
        }
    }
    drawIconPixels(data);
    for(u32 dot=0;dot<3;++dot) {
        if(state->chain.before)infoPixel(data,iconX(0)-7+dot*2,IconY+15,4);
        if(state->chain.after)infoPixel(data,iconX(state->chain.count-1)+34+dot*2,IconY+15,4);
    }
    const u32 count=state->abilities.count?state->abilities.count:1;
    for(u32 i=0;i<count;++i) {
        copyText(text,128,state->abilityNames[i]);
        if(state->abilities.count)infoTitleCase(text);
        ellipsis(text,132);
        put(text,120,AbilityY+16*i,state->abilities.hidden[i]?HiddenAbilityInk:InsetTextInk);
    }
    if(state->pageCount) {
        u32 headerWidth=240;
        if(state->pageCount>1) {
            asciiText(text,128,"A ");u32 n=2;n+=decimal(text+n,state->page+1);text[n++]='/';n+=decimal(text+n,state->pageCount);
            text[n]=End;
            const u32 width=measure(text);put(text,248-int(width),EvolutionY);headerWidth-=width+8;
        }
        const Page& p=state->pages[state->page];
        if(p.incoming)copyText(text,128,state->status);
        else {
            u16 a[64],b[64];copyText(a,64,state->selectedName);copyText(b,64,state->targets[p.option]);
            ellipsis(a,(headerWidth-20)/2);ellipsis(b,(headerWidth-20)/2);u32 n=copyText(text,128,a);
            text[n++]=' ';text[n++]=0x2192;text[n++]=' ';copyText(text+n,128-n,b);
        }
        ellipsis(text,headerWidth);put(text,8,EvolutionY);
        u32 offset=p.offset;
        for(u32 row=0;row<2;++row) {offset=wrapInfo(state->requirements[p.option],offset,text,128,240,measure);put(text,8,EvolutionY+16+row*16);}
    } else {
        u32 offset=0;
        for(u32 row=0;row<3;++row){offset=wrapInfo(state->status,offset,text,128,240,measure);put(text,8,EvolutionY+row*16);}
    }
    void* window=at<void*>(state->work,0x38);
    native<void(*)(void*)>(0x2048271,0x2048245)(window);
    native<void(*)(void*)>(0x2048299,0x204826d)(window);
    // MakeTransWindow creates a single-palette map. Assign the three icon
    // rectangles their original ROM palettes in the *CPU* map before upload.
    u16* map=paletteMap();
    if(map)for(u32 i=0;i<state->chain.count;++i)if(state->iconsValid[state->iconSlots[i]])
        for(u32 y=IconY/8;y<IconY/8+4;++y)for(u32 x=iconX(i)/8;x<iconX(i)/8+4;++x)
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
        u8* data=native<u8*(*)(void*)>(0x2046f21,0x2046ef5)(bitmap);
        if(data)background(data);
        u16 text[32];asciiText(text,32,"Info unavailable.");
        void* buffer=at<void*>(work,0x4c);stringSet(buffer,text);
        native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(bitmap,8,StatY,buffer,at<void*>(work,0x60),StatInk);
        native<void(*)(void*)>(0x2048271,0x2048245)(window);
        native<void(*)(void*)>(0x2048299,0x204826d)(window);
        paletteMap();
        native<void(*)(u32)>(0x2045ba9,0x2045b7d)(2);
        return;
    }
    *state={};state->work=work;
    load(request);headerTypes();render();
}
void infoInput(void* work) {
    if(!state || state->work!=work)return;
    animateIcons();
    if(state->pageCount<2)return;
    const u32 keys=native<u32(*)()>(0x203df29,0x203defd)();
    if((keys&3)==1)state->page=state->page+1==state->pageCount?0:state->page+1;
    else return;
    // A pages only the requirement text. The family window stays fixed until
    // L/R selects a different species; it never changes the real party Pokemon.
    render();
}
void infoReload(void* work,Request* request) {
    if(!state || state->work!=work)return;
    // Keep the existing application/windows/VRAM alive. Loading touches only
    // CPU state; the old screen stays visible until buffered uploads are ready.
    static_cast<InfoView&>(*state)={};state->work=work;
    load(request);headerTypes();render();
}
bool infoNavigate(void* work,Request* request,bool forward) {
    if(!state || state->work!=work || !request)return false;
    const auto& next=state->navigation[forward?1:0];
    if(!next.identity.species)return false;
    request->nextView=next;request->nextSlot=BrowseFamily;
    return true;
}
void infoEnd() {InfoState* old=state;state=nullptr;if(old)release(old->graph);release(old);}

// Only called at the tutor's window-creation call site. Keep valid tiny
// windows for unused upper slots so the original destruction loop is intact.
extern "C" void* LearnsetWindow(u32 frame,u32 x,u32 y,u32 width,u32 height,u32 palette,u32 direction) {
    if(LearnsetIsActive() && frame==2 && width>1) {
        if(y==0){x=0;y=0;width=32;height=24;palette=14;}
        else {x=0;y=24;width=1;height=1;}
    }
    return native<void*(*)(u32,u32,u32,u32,u32,u32,u32)>(0x20480ed,0x20480c1)(frame,x,y,width,height,palette,direction);
}
