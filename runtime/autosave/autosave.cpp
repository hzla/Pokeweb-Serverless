// Experimental US revision-0 B2/W2 map-transition autosave.
using u8=unsigned char; using u16=unsigned short; using u32=unsigned int;
#include "profiles.generated.h"
template<class T> T& at(void* p,u32 offset){return *reinterpret_cast<T*>(static_cast<u8*>(p)+offset);}
template<class F> F api(u32 address){return reinterpret_cast<F>(nativeAddress(address)|1);}
using Check=void*(*)(void*,void*);
#define EXPORT extern "C" __attribute__((visibility("default")))
struct Session { void* system; void* game; Check native; u16 zone; bool known,pending,active; };
static Session session;
static void clear(void* p,u32 size){auto* b=static_cast<volatile u8*>(p);while(size--)*b++=0;}
// ASMV, version, transitions, saves started/finished/failed/skipped,
// event stage, last zone, native advance calls, current field, checks.
extern "C" { __attribute__((visibility("default"))) volatile u32 AutosaveDebug[12]={0x564d5341,2,0,0,0,0,0,0,0,0,0,0}; }
constexpr u32 SAVE_STEPS_PER_TICK=8;
struct Work { void* field; void* game; void* string; void* window; u32 stage,age; };
static u16 zone(void* field){return at<u16>(field,0xe8);}
static void transition(void* field){
    session.zone=zone(field);session.pending=true;
    ++AutosaveDebug[2];AutosaveDebug[8]=session.zone;
}
static void release(Work* w){
    if(w->window){api<void(*)(void*)>(0x2187c5c)(w->window);w->window=nullptr;}
    if(w->string){api<void(*)(void*)>(0x2048590)(w->string);w->string=nullptr;}
    session.active=false;AutosaveDebug[7]=0;
}
static bool message(Work* w,const u16* text){
    void* bg=at<void*>(w->field,0x28);
    if(!bg)return false;
    u32 heap=at<u16>(w->field,0);
    if(api<u32(*)(u32)>(0x2039fbc)(heap)<32768)return false;
    w->string=api<void*(*)(u32,u32)>(0x204855c)(64,heap);
    if(!w->string)return false;
    api<void(*)(void*,const u16*)>(0x2048640)(w->string,text);
    // Native compact message box and font, with no speech-balloon tail.
    w->window=api<void*(*)(void*,void*,u32,u32,u32,u32)>(0x2187c3c)(bg,nullptr,1,21,12,2);
    if(w->window)api<void(*)(void*,u32,u32,void*)>(0x2187c8c)(w->window,0,0,w->string);
    return w->window!=nullptr;
}
static int tick(void*,u32*,Work* w){
    static const u16 saving[]={'S','a','v','i','n','g','.','.','.',0xffff};
    static const u16 failed[]={'S','a','v','e',' ','f','a','i','l','e','d','.',0xffff};
    AutosaveDebug[7]=w->stage+1;
    switch(w->stage){
    case 0:
        if(!message(w,saving)){++AutosaveDebug[6];release(w);return 1;}
        w->stage=1;break;
    case 1:
        if(!api<int(*)(void*)>(0x2187cb0)(w->window))break;
        // Give the final text upload a VBlank before freezing the field.
        if(++w->age<2)break;
        api<void(*)(void*,u32)>(0x20095a0)(api<void*(*)(void*)>(0x2017994)(w->game),1);
        api<void(*)(void*)>(0x201782c)(w->game);
        ++AutosaveDebug[3];w->stage=2;break;
    case 2:{
        int result=0;
        // Bound the batch and let the unchanged native routine enforce its
        // asynchronous completion checks. Stop immediately on success/error:
        // its completion path releases the save lock and must run only once.
        for(u32 step=0;step<SAVE_STEPS_PER_TICK;++step){
            ++AutosaveDebug[9];
            result=api<int(*)(void*)>(0x2017850)(w->game);
            if(result>=2)break;
        }
        if(result<2)break;
        if(result==2)++AutosaveDebug[4];else ++AutosaveDebug[5];
        w->stage=result==2?3:4;break;
    }
    case 3:case 4:
        api<void(*)(void*)>(0x2187c5c)(w->window);w->window=nullptr;
        api<void(*)(void*)>(0x2048590)(w->string);w->string=nullptr;
        if(w->stage==3){release(w);return 1;}
        if(!message(w,failed)){release(w);return 1;}
        w->stage=5;w->age=0;break;
    case 5:
        if(api<int(*)(void*)>(0x2187cb0)(w->window) && ++w->age>=120){
            w->stage=3;
        }
        break;
    default:release(w);return 1;
    }
    return 0;
}
static void* check(void* system,void* field){
    ++AutosaveDebug[11];AutosaveDebug[10]=reinterpret_cast<u32>(field);
    // Arrival scripts, trainer checks, encounters, communication and native
    // menu requests always get first opportunity to claim this event tick.
    void* native=session.native(system,field);
    if(native || !session.pending || session.active)return native;
    void* game=at<void*>(field,8);void* sub=at<void*>(field,0x24);
    if(at<u32>(field,0xd0)!=1 || at<u32>(field,0x150)
       || api<u32(*)(void*)>(0x20178bc)(game)
       || !api<u32(*)()>(0x2027af8)()
       || !sub || !api<u32(*)(void*)>(0x21983dc)(sub))return nullptr;
    void* player=at<void*>(field,0x94);if(!player)return nullptr;
    u32 state=api<u32(*)(void*)>(0x219a6f8)(player);
    if(state!=0 && state!=3)return nullptr;
    int menu=api<int(*)(void*,void*,u32)>(0x21a0204)(game,api<void*(*)(void*)>(0x2017394)(game),zone(field));
    if((menu!=0 && menu!=2 && menu!=3 && menu!=6)
       || api<int(*)(void*)>(0x200746c)(api<void*(*)(void*)>(0x2017934)(game))){
        session.pending=false;++AutosaveDebug[6];return nullptr;
    }
    if(api<u32(*)(u32)>(0x2039fbc)(4)<32768){session.pending=false;++AutosaveDebug[6];return nullptr;}
    void* event=api<void*(*)(void*,void*,void*,u32)>(0x2016cb4)(system,nullptr,reinterpret_cast<void*>(tick),sizeof(Work));
    session.pending=false;
    if(!event){++AutosaveDebug[6];return nullptr;}
    auto* work=api<Work*(*)(void*)>(0x2016edc)(event);
    // Retail allocates cleared event data. Explicit initialization also keeps
    // the event's complete request independent of any caller's stack frame.
    clear(work,sizeof(*work));work->field=field;work->game=game;
    session.active=true;
    api<void(*)(void*)>(0x219a5d8)(player);
    return event;
}
EXPORT void AutosaveRegister(void* system,Check native,void* field){
    void* game=at<void*>(field,8);
    if(session.system!=system || session.game!=game){clear(&session,sizeof(session));session.system=system;session.game=game;}
    if(session.known && session.zone!=zone(field))transition(field);
    session.zone=zone(field);session.known=true;session.native=native;
    // Exclude the native Union/Colosseum callback altogether.
    bool ordinary=reinterpret_cast<u32>(native)!=(nativeAddress(0x218190c)|1);
    if(!ordinary)session.pending=false;
    api<void(*)(void*,Check,void*)>(0x2016a80)(system,ordinary?check:native,field);
}
EXPORT int AutosaveZone(void* field){
    int changed=api<int(*)(void*)>(0x2180b40)(field);
    if(changed)transition(field);
    return changed;
}
EXPORT void AutosaveArrival(void* system,u32 heap){
    api<void(*)(void*,u32)>(0x2153a28)(system,heap);
    // Actual map initialization has a separate path from application recovery.
    // This includes same-header warps; the first Continue only sets a baseline.
    if(session.known && session.system==system){
        void* field=api<void*(*)(void*)>(0x2016af0)(system);
        if(field)transition(field);
    }
}
EXPORT void AutosaveSnapshot(void* game){
    // The ARM9 save-preparation hook also keeps this module resident while
    // field overlays are unloaded. A manual save consumes any pending request.
    session.pending=false;
    api<void(*)(void*)>(0x2017750)(game);
}
