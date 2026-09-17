#include "runtime.h"
namespace {
struct MenuItem { void* text; u16 color; u16 pad; u32 cancel; };
struct MenuWork { u8 count; u8 pad; u16 ids[8]; u16 padding; MenuItem items[8]; };
static_assert(__builtin_offsetof(MenuWork, items) == 0x14, "US party menu layout");
Request* session;
void* sessionOwner;
u32 restoreSlot = 0xffffffff;
bool isField(void* work) { return work && at<void*>(work,0x28c) && at<u32>(at<void*>(work,0x28c),0x44) == 0; }
const ProcTable* viewerTable() { return native<const ProcTable*>(0x219b9e8,0x219b9a8); }
u32 viewerInit(void* proc, int* seq, void* data, void* work) {
    // Fail closed if the companion could not load. Never launch the teaching
    // app with our data in that case. PMC applies the callback-table hook first.
    const Proc init = viewerTable()->init;
    if (init == native<Proc>(0x2199901,0x21998c1) || !init) return 1;
    if (session != data) return 1;
    return init(proc,seq,data,work);
}
u32 viewerMain(void* proc, int* seq, void* data, void* work) {
    return session && session->viewerStarted ? viewerTable()->main(proc,seq,data,work) : 1;
}
u32 viewerEnd(void* proc, int* seq, void* data, void* work) {
    return session && session->viewerStarted ? viewerTable()->end(proc,seq,data,work) : 1;
}
const ProcTable callbacks = {viewerInit,viewerMain,viewerEnd};
void reopen(void* work,int* seq) {
    at<u32>(work,4)=0; at<u32>(work,8)=0; at<u32>(work,12)=0; at<u32>(work,16)=4;
    *seq=11;
}
bool launch(u32 slot,bool family=false) {
    const u32 count=partyCount(session->party);
    if(slot>=count || count>6)return false;
    void* pokemon=partyPokemon(session->party,slot);
    if(!viewable(pokemon))return false;
    if(family) {
        if(!session->nextView.identity.species)return false;
        session->view=session->nextView;
    } else session->view={{u16(pokemonGet(pokemon,5)),u16(pokemonGet(pokemon,0x6f))},{0,0}};
    session->nextView={};
    // This runs only after the preceding app's native End has released its
    // windows, lists and heap. Never rewrite a request still used by a viewer.
    session->partySlot=slot;session->nextSlot=0xff;session->viewerStarted=0;
    session->tutor={pokemon,session->tutor.trainer,nullptr,session->tutor.gameSystem,
                    session->ids,0,0,0,0xfe,0,0};
    buildList(session,4);
    for(u32 i=0;i<MaxEntries+1;++i)session->ids[i]=End;
    for(u32 i=0;i<session->list.count;++i)session->ids[i]=session->list.entries[i].moveId;
    // A harmless native row keeps empty/error cursor allocations valid.
    if(!session->list.count)session->ids[0]=1;
    restoreSlot=slot;
    native<void(*)(void*,u32,const void*,void*)>(0x2016a99,0x2016a99)(session->tutor.gameSystem,258,&callbacks,session);
    return true;
}
}
extern "C" void OriginalMenuCreate(void*,void*,u32*);
extern "C" void OriginalMenuSelect(void*);
extern "C" u32 OriginalDispatch(void*,int*,void*);
extern "C" void LearnsetMenuCreate(void* work,void* rawMenu,u32* input) {
    OriginalMenuCreate(work,rawMenu,input);
    MenuWork* menu=static_cast<MenuWork*>(rawMenu);
    if (!canAppend(input,menu->count,isField(work)) || menu->ids[menu->count-1]!=6
        || !configured(learnsetConfig.menu,learnsetConfig.menuXor)) return;
    void* text=message(at<void*>(work,0x138),learnsetConfig.menu);
    if (!text) return;
    const u32 index=menu->count-1;
    menu->ids[index+1]=menu->ids[index]; menu->items[index+1]=menu->items[index];
    menu->ids[index]=Command;
    menu->items[index]={text,0x39e0,0,0};
    ++menu->count;
}
extern "C" void LearnsetMenuSelect(void* work) {
    if (isField(work) && at<u32>(work,0x40)==Command) {
        void* data=at<void*>(work,0x28c);
        at<u8>(work,12)=19;
        at<u32>(data,0x4c)=at<u32>(work,0x30);
        at<u32>(data,0x50)=Transition;
        return;
    }
    OriginalMenuSelect(work);
}
extern "C" u32 LearnsetDispatch(void* event,int* seq,void* work) {
    void* partyData=at<void*>(work,0x1c);
    const bool field=at<u32>(work,4)==0 && partyData && at<u32>(partyData,0x44)==0;
    if (*seq==13 && session && sessionOwner==work) {
        if(!session->viewerStarted && session->nextSlot==BrowseFamily && launch(session->partySlot,true)) {
            *seq=12;return 0;
        }
        if(!session->viewerStarted && session->nextSlot!=0xff
            && session->nextSlot!=session->partySlot && launch(session->nextSlot)) {
            *seq=12;return 0;
        }
        session->magic=0;
        Request* old=session; session=0;
        release(old);
        reopen(work,seq);
        return 0;
    }
    if (*seq==13 && field && at<u32>(partyData,0x50)==Transition) {
        at<u32>(partyData,0x50)=0;
        const u32 slot=at<u32>(partyData,0x4c);
        void* gs=*at<void**>(work,0x18);
        void* gd=native<void*(*)(void*)>(0x2016ad9,0x2016ad9)(gs);
        void* party=native<void*(*)(void*)>(0x201735d,0x201735d)(gd);
        const u32 count=partyCount(party);
        restoreSlot=slot<count && slot<6 ? slot : 0;
        sessionOwner=work;
        if (slot<count && slot<6 && !session) {
            session=static_cast<Request*>(alloc(4,sizeof(Request)));
            if (session) {
                *session={};
                session->magic=RequestMagic; session->version=RequestVersion; session->size=sizeof(Request);
                session->party=party;
                session->tutor.trainer=native<void*(*)(void*)>(0x201736d,0x201736d)(gd);
                session->tutor.gameSystem=gs;
                if(launch(slot)){*seq=12;return 0;}
                session->magic=0;release(session);session=nullptr;
            }
        }
        reopen(work,seq); return 0;
    }
    const bool restoring=*seq==11 && sessionOwner==work && restoreSlot!=0xffffffff;
    const u32 result=OriginalDispatch(event,seq,work);
    if (restoring && *seq==12) {
        void* next=at<void*>(work,0x1c);
        if(next) at<u32>(next,0x4c)=restoreSlot;
        restoreSlot=0xffffffff; sessionOwner=0;
    }
    return result;
}
