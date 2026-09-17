#include "runtime.h"
#include "info.h"
extern "C" void LearnsetDetails(void*,u32);
namespace {
Request* active;
struct MenuLine {void* text;u32 id;};
bool ours(void* work) { return active && work && at<void*>(work,0)==&active->tutor; }
void* bitmap(void* window) { return native<void*(*)(void*)>(0x2048521,0x20484f5)(window); }
void flush(void* window) {
    // US inlined GFL_BMPWIN_MakeTransWindow_VBlank sequence.
    native<void(*)(void*)>(0x2048271,0x2048245)(window);
    native<void(*)(void*)>(0x2048299,0x204826d)(window);
    const u32 frame=native<u32(*)(void*)>(0x2048501,0x20484d5)(window);
    native<void(*)(u32)>(0x2045ba9,0x2045b7d)(frame);
}
void draw(void* work,u32 window,int x,int y,void* text,u32 color) {
    native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(
        bitmap(at<void*>(work,4+window*4)),x,y,text,at<void*>(work,0x60),color);
}
void visible(void* sprite,bool enabled) { native<void(*)(void*,u32)>(0x204c151,0x204c125)(sprite,enabled); }
void freeList(void* lines) {native<void(*)(void*)>(0x2024fd9,0x2024fad)(lines);}
constexpr u32 MoveListSound=1356,SummaryPageSound=1637;
void navigationSound(u32 sound) {
    native<void(*)(u32)>(0x2006255,0x2006255)(sound);
}
bool refreshFamily(void* work) {
    Request next=*active;
    next.view=next.nextView;next.nextView={};next.nextSlot=0xff;
    active->nextView={};active->nextSlot=0xff;
    if(!next.view.identity.species)return false;
    buildList(&next,79);
    next.tutor.cursor=next.tutor.scroll=0;next.tutor.page=0;
    const u32 count=next.list.count?next.list.count:1;
    for(u32 i=0;i<MaxEntries+1;++i)next.ids[i]=End;
    for(u32 i=0;i<next.list.count;++i)next.ids[i]=next.list.entries[i].moveId;
    if(!next.list.count)next.ids[0]=1;
    // Prepare a complete native-owned list before changing the live request.
    // On allocation/name failure, retain the old screen and all its pointers.
    auto* lines=native<MenuLine*(*)(u32,u32)>(0x2024f8d,0x2024f61)(count,79);
    if(!lines)return false;
    void* names=messageOpen(403,79);
    if(!names){freeList(lines);return false;}
    for(u32 i=0;i<count;++i) {
        lines[i]={message(names,next.ids[i]),next.ids[i]};
        if(!lines[i].text){messageClose(names);freeList(lines);return false;}
    }
    messageClose(names);
    void* old=at<void*>(work,0x58);
    *active=next; // tutor.moves still points at active->ids, never stack storage.
    at<void*>(work,0x58)=lines;at<u8>(work,0x1b8)=count;
    at<u8>(work,0x1bb)=at<u8>(work,0x1bc)=at<u8>(work,0x1bd)=0;
    at<u16>(work,0x1cc)=0;
    native<void(*)(void*,u32)>(0x202ba91,0x202ba65)(at<void*>(work,0x1c8),0);
    freeList(old);
    infoReload(work,active);
    // Retail list redraw already calls our row/type hooks. Reset both scroll
    // controls, cursor and details; empty/error lists stay dismissible.
    native<void(*)(void*)>(0x219a8ed,0x219a8ad)(work);
    LearnsetDetails(work,active->ids[0]);
    native<void(*)(void*)>(0x219b77d,0x219b73d)(work);
    native<void(*)(void*)>(0x219b859,0x219b819)(work);
    native<void(*)(void*,u32,u32)>(0x219b2f5,0x219b2b5)(work,0,3);
    visible(at<void*>(work,0x10c),active->list.count!=0);
    return true;
}
}
extern "C" bool LearnsetIsActive() { return active!=nullptr; }
extern "C" u32 LearnsetViewerInit(void* proc,int* seq,void* data,void* work) {
    infoEnd();
    active=0;
    TutorData* tutor=static_cast<TutorData*>(data);
    if (tutor && tutor->mode==0xfe) {
        Request* request=static_cast<Request*>(data);
        // Only the private mode permits reading beyond the retail prefix.
        if (request->magic!=RequestMagic || request->version!=RequestVersion || request->size!=sizeof(Request)
            || request->list.count>MaxEntries || request->tutor.moves!=request->ids
            || !request->party || request->partySlot>=6) return 1;
        active=request;
        tutor->mode=1;
        request->viewerStarted=1;
    }
    return native<Proc>(0x2199901,0x21998c1)(proc,seq,data,work);
}
extern "C" u32 LearnsetViewerMain(void* proc,int* seq,void* data,void* work) {
    if (ours(work)) {
        // Defense in depth: never enter learn, replace, yes/no, or summary
        // states, even if a future input hook accidentally returns one.
        if (*seq==14) *seq=8;
        if (*seq!=0 && *seq!=1 && *seq!=8 && *seq!=9 && *seq!=13) *seq=1;
        if (!active->list.count) visible(at<void*>(work,0x10c),false);
        if (*seq==1) {
            const u32 keys=native<u32(*)()>(0x203df29,0x203defd)();
            // A/B keep precedence. D-pad changes party; shoulders browse family.
            if(!(keys&3) && ((keys&0x30)==0x20 || (keys&0x30)==0x10)) {
                const u32 slot=nextPartySlot(active->partySlot,partyCount(active->party),(keys&0x10)!=0,
                    [&](u32 i){return viewable(partyPokemon(active->party,i));});
                if(slot==active->partySlot)return 0;
                active->nextSlot=slot;
                navigationSound(SummaryPageSound);
                *seq=8; // Native fade, native End, then field-owned relaunch.
            } else if(!(keys&3) && ((keys&0x300)==0x100 || (keys&0x300)==0x200)
                && infoNavigate(work,active,(keys&0x100)!=0)) {
                if(refreshFamily(work))navigationSound(MoveListSound); // Successful changes only.
                return 0;
            } else infoInput(work);
        }
    }
    return native<Proc>(0x2199975,0x2199935)(proc,seq,data,work);
}
extern "C" u32 LearnsetViewerEnd(void* proc,int* seq,void* data,void* work) {
    infoEnd();
    const u32 result=native<Proc>(0x2199a51,0x2199a11)(proc,seq,data,work);
    if (active && data==active) active->viewerStarted=0;
    active=0;
    return result;
}
extern "C" void LearnsetDrawLine(void* work,u8 scroll,u8 pos) {
    if (!ours(work)) {
        native<void(*)(void*,u8,u8)>(0x219a7f1,0x219a7b1)(work,scroll,pos); return;
    }
    const u32 index=u32(scroll)+pos;
    if (index>=active->list.count || pos>=4) return;
    MenuLine* lines=at<MenuLine*>(work,0x58);
    void* buffer=at<void*>(work,0x4c);
    const u16* name=stringText(lines[index].text);
    u16 text[96];
    // Leave two native pixels after the type icon without moving PP or the
    // label's right edge. Measure/truncate within the remaining name area.
    constexpr u32 nameInset=2;
    label(text,96,active->list.entries[index].level,name,108-nameInset,[&](const u16* candidate) {
        stringSet(buffer,candidate);
        return native<u32(*)(void*,void*,u32)>(0x20228b5,0x2022889)(buffer,at<void*>(work,0x60),0);
    });
    stringSet(buffer,text);
    draw(work,11,nameInset,pos*24,buffer,0x3c40);
    text[0]='P'; text[1]='P'; text[2]=' ';
    const u32 pp=native<u32(*)(u32,u32)>(0x20216dd,0x20216b1)(active->list.entries[index].moveId,0);
    text[3+decimal(text+3,pp)]=End;
    stringSet(buffer,text);
    draw(work,11,120,pos*24,buffer,0x440);
    flush(at<void*>(work,0x30));
}
extern "C" int LearnsetConfirm(void* work) {
    if (ours(work)) return 1;
    return native<int(*)(void*)>(0x219b995,0x219b955)(work);
}
extern "C" void LearnsetEnterButton(void* work,u32 flag) {
    native<void(*)(void*,u32)>(0x219b6c9,0x219b689)(work,ours(work)?0:flag);
}
extern "C" void LearnsetDetails(void* work,u32 move) {
    if (ours(work) && !active->list.count) move=0xfffffffe;
    native<void(*)(void*,u32)>(0x219a9d9,0x219a999)(work,move);
    if (!ours(work) || active->list.count) return;
    const bool empty=active->list.status==Status::Empty;
    const u16 id=empty?learnsetConfig.empty:learnsetConfig.error;
    const u16 inverse=empty?learnsetConfig.emptyXor:learnsetConfig.errorXor;
    if (!configured(id,inverse)) return;
    void* text=message(at<void*>(work,0x44),id);
    if(text) { draw(work,6,0,0,text,0x440); flush(at<void*>(work,0x1c)); stringFree(text); }
}
extern "C" void LearnsetTypeIcons(void* work) {
    if (!ours(work) || active->list.count) {
        native<void(*)(void*)>(0x219b181,0x219b141)(work); return;
    }
    for(u32 i=0;i<4;++i) visible(at<void*>(work,0x114+i*4),false);
}
extern "C" void LearnsetFixedText(void* work) {
    if (!ours(work)) {native<void(*)(void*)>(0x219a4c5,0x219a485)(work);return;}
    // Preserve the two original lower labels, but do not execute the native
    // upper writes into our intentionally reduced unused upper windows.
    for(u32 i=0;i<2;++i) {
        void* text=message(at<void*>(work,0x44),23+i);
        if(text){draw(work,2+i,0,0,text,0x440);flush(at<void*>(work,12+i*4));stringFree(text);}
    }
    infoInit(work,active);
}

extern "C" void LearnsetScreen(void* arc,u32 member,u32 frame,u32 offset,u32 length,u32 compressed,u32 heap) {
    auto original=native<void(*)(void*,u32,u32,u32,u32,u32,u32)>(0x204af7d,0x204af51);
    if (!active || member!=2 || frame!=7) { original(arc,member,frame,offset,length,compressed,heap); return; }
    void* screen=0;
    void* allocation=native<void*(*)(void*,u32,u32,void**,u32)>(0x204b359,0x204b32d)(arc,member,compressed,&screen,heap);
    if (!allocation || !screen || at<u16>(screen,0)!=256 || at<u32>(screen,8)!=2048) {
        release(allocation); original(arc,member,frame,offset,length,compressed,heap); return;
    }
    u16* tiles=reinterpret_cast<u16*>(static_cast<u8*>(screen)+12);
    // Move the diagonal three 8px tiles. The row borders and type icon do
    // not move. The highlighted cursor is an outline-only sprite over this
    // same background, so both states use precisely the same divider.
    for(u32 y=8;y<21;++y) {
        u16* row=tiles+y*32;
        row[22]=row[19]; row[21]=row[18];
        row[18]=row[19]=row[20]=row[17];
    }
    // Match TransVramScreen's buffered path. Direct LoadScreen writes VRAM
    // only: the tutor subsequently uploads its CPU-side map, which would
    // otherwise still be all zeroes and erase the background.
    const u32 size=length ? length : at<u32>(screen,8);
    if (native<void*(*)(u32)>(0x2045841,0x2045815)(frame)) {
        native<void(*)(u32,const void*,u32,u32)>(0x204508d,0x2045061)(frame,tiles,size,offset);
        native<void(*)(u32)>(0x2044fbd,0x2044f91)(frame);
    } else {
        native<void(*)(u32,const void*,u32,u32)>(0x2044fdd,0x2044fb1)(frame,tiles,size,offset);
    }
    release(allocation);
}
