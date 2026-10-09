#include "runtime.h"
#ifdef LEARNSET_BW1_TRACE
extern "C" { __attribute__((used,section(".learnset_trace"))) volatile struct {
    char magic[8]; u32 words[15];
} learnsetMenuTrace={{'L','V','T','R','A','C','E','1'},{}}; }
#endif
namespace {
struct MenuItem { void* text; u16 color; u16 pad; u32 cancel; };
struct MenuWork { u8 count; u8 pad; u16 ids[8]; u16 padding; MenuItem items[8]; };
static_assert(__builtin_offsetof(MenuWork, items) == 0x14, "US party menu layout");
Request* session;
void* sessionOwner;
u32 restoreSlot = 0xffffffff;
bool isField(void* work) { return work && at<void*>(work,PartyRequestOffset) && at<u32>(at<void*>(work,PartyRequestOffset),RequestModeOffset) == 0; }
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
    native<void(*)(void*,u32,const void*,void*)>(0x2016a99,0x2016a99)(session->tutor.gameSystem,TutorOverlay,&callbacks,session);
    return true;
}
}
extern "C" void OriginalMenuCreate(void*,void*,u32*);
extern "C" void OriginalMenuSelect(void*);
extern "C" u32 OriginalDispatch(void*,int*,void*);
extern "C" void LearnsetMenuCreate(void* work,void* rawMenu,u32* input) {
#ifdef LEARNSET_BW1_TRACE
    learnsetMenuTrace.words[0]=u32(work);learnsetMenuTrace.words[1]=u32(rawMenu);learnsetMenuTrace.words[2]=u32(input);
    learnsetMenuTrace.words[3]=u32(at<void*>(work,PartyRequestOffset));
    learnsetMenuTrace.words[4]=at<u32>(at<void*>(work,PartyRequestOffset),RequestModeOffset);
#endif
    OriginalMenuCreate(work,rawMenu,input);
    MenuWork* menu=static_cast<MenuWork*>(rawMenu);
#ifdef LEARNSET_BW1_TRACE
    learnsetMenuTrace.words[5]=menu->count;learnsetMenuTrace.words[6]=menu->count?menu->ids[menu->count-1]:End;
    learnsetMenuTrace.words[7]=input[0];learnsetMenuTrace.words[8]=isField(work);learnsetMenuTrace.words[9]=canAppend(input,menu->count,isField(work));
    learnsetMenuTrace.words[10]=0xffffffff;learnsetMenuTrace.words[11]=learnsetConfig.menu;learnsetMenuTrace.words[12]=learnsetConfig.menuXor;learnsetMenuTrace.words[13]=customUiConfig.learnsetEnabled;
#endif
    if(!canAppend(input,menu->count,isField(work)) || menu->ids[menu->count-1]!=6)return;
    auto append=[&](u16 id,u16 command) {
        if(menu->count>=8)return;
        void* text=message(at<void*>(work,PartyMessageOffset),id);
#ifdef LEARNSET_BW1_TRACE
        learnsetMenuTrace.words[10]=u32(text);
#endif
        if(!text)return;
        const u32 index=menu->count-1;
        menu->ids[index+1]=menu->ids[index];menu->items[index+1]=menu->items[index];
        menu->ids[index]=command;menu->items[index]={text,0x39e0,0,0};++menu->count;
    };
    if(customUiConfig.learnsetEnabled && configured(learnsetConfig.menu,learnsetConfig.menuXor))append(learnsetConfig.menu,Command);
    if(customUiConfig.version==1 && customUiConfig.enabled==1 && configured(customUiConfig.menu,customUiConfig.menuXor))append(customUiConfig.menu,CustomCommand);
#ifdef LEARNSET_BW1_TRACE
    learnsetMenuTrace.words[14]=menu->count;
#endif
}
extern "C" void LearnsetMenuSelect(void* work) {
    if (isField(work) && (at<u32>(work,PartyCommandOffset)==Command || (at<u32>(work,PartyCommandOffset)==CustomCommand && customUiConfig.enabled==1))) {
        void* data=at<void*>(work,PartyRequestOffset);
        at<u8>(work,12)=19;
        at<u32>(data,RequestSlotOffset)=at<u32>(work,PartySlotOffset);
        at<u32>(data,RequestResultOffset)=at<u32>(work,PartyCommandOffset)==CustomCommand?CustomTransition:Transition;
        return;
    }
    OriginalMenuSelect(work);
}
extern "C" u32 LearnsetDispatch(void* event,int* seq,void* work) {
    void* partyData=at<void*>(work,0x1c);
    const bool field=at<u32>(work,4)==0 && partyData && at<u32>(partyData,RequestModeOffset)==0;
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
    if (*seq==13 && field && (at<u32>(partyData,RequestResultOffset)==Transition || (at<u32>(partyData,RequestResultOffset)==CustomTransition && customUiConfig.enabled==1))) {
        const bool custom=at<u32>(partyData,RequestResultOffset)==CustomTransition;
        at<u32>(partyData,RequestResultOffset)=0;
        const u32 slot=at<u32>(partyData,RequestSlotOffset);
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
                session->party=party;session->reserved=custom?CustomCommand:0;
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
        if(next) at<u32>(next,RequestSlotOffset)=restoreSlot;
        restoreSlot=0xffffffff; sessionOwner=0;
    }
    return result;
}
