#pragma once
#include "logic.h"
using namespace learnset;
template<class T> inline T& at(void* p, u32 offset) { return *reinterpret_cast<T*>(static_cast<u8*>(p) + offset); }
template<class F> inline F native(u32 w2, u32 b2) {
#if defined(GAME_B2)
    (void)w2; return reinterpret_cast<F>(b2);
#else
    (void)b2; return reinterpret_cast<F>(w2);
#endif
}
struct TutorData {
    void* pokemon; void* trainer; void* config; void* gameSystem; u16* moves;
    u16 cursor; u16 scroll; u8 page; u8 mode; u8 result; u8 deletedSlot;
};
struct Request {
    TutorData tutor;
    u32 magic;
    u16 version;
    u16 size;
    List list;
    u16 ids[MaxEntries + 1];
    u8 viewerStarted;
    void* party;
    u8 partySlot;
    u8 nextSlot; // 0xff until the viewer requests a party switch.
    u16 reserved;
    ViewSelection view,nextView;
};
static_assert(sizeof(TutorData) == 28, "Retail tutor request prefix");
static_assert(__builtin_offsetof(Request, magic) == 28, "Viewer extension");
static_assert(__builtin_offsetof(Request, party) == 236 && __builtin_offsetof(Request,view)==244
    && sizeof(Request)==260, "Version 3 read-only family navigation suffix");
using Proc = u32 (*)(void*, int*, void*, void*);
struct ProcTable { Proc init; Proc main; Proc end; };
using Dispatch = u32 (*)(void*, int*, void*);
inline void* alloc(u32 heap, u32 size) { return native<void*(*)(u32,u32)>(0x2039dc9,0x2039d9d)(heap,size); }
inline void release(void* p) { if (p) native<void(*)(void*)>(0x203a279,0x203a24d)(p); }
inline u32 pokemonGet(void* p, u32 field) { return native<u32(*)(void*,u32,void*)>(0x201cd25,0x201ccf9)(p,field,0); }
inline ViewIdentity viewIdentity(const Request* request) {
    if(request->view.identity.species)return request->view.identity;
    return {u16(pokemonGet(request->tutor.pokemon,5)),u16(pokemonGet(request->tutor.pokemon,0x6f))};
}
inline u32 partyCount(void* party) { return party?native<u32(*)(void*)>(0x201fe25,0x201fdf9)(party):0; }
inline void* partyPokemon(void* party,u32 slot) { return native<void*(*)(void*,u32)>(0x201ff35,0x201ff09)(party,slot); }
inline bool viewable(void* pokemon) { return pokemon && pokemonGet(pokemon,5) && !pokemonGet(pokemon,0x4c); }
inline void* message(void* handle, u32 id) { return native<void*(*)(void*,u32)>(0x20489b9,0x204898d)(handle,id); }
inline void* messageOpen(u32 bank,u32 heap) { return native<void*(*)(u32,u32,u32,u32)>(0x2048789,0x204875d)(0,2,bank,heap); }
inline void messageClose(void* p) { native<void(*)(void*)>(0x2048801,0x20487d5)(p); }
inline void stringFree(void* p) { native<void(*)(void*)>(0x2048591,0x2048565)(p); }
inline void* stringCreate(u32 size) { return native<void*(*)(u32,u32)>(0x204855d,0x2048531)(size,79); }
inline void stringSet(void* p, const u16* text) { native<void(*)(void*,const u16*)>(0x2048641,0x2048615)(p,text); }
inline const u16* stringText(void* p) { return native<const u16*(*)(void*)>(0x204871d,0x20486f1)(p); }
struct Config {
    u8 magic[8]; u16 version; u16 menu; u16 menuXor; u16 empty; u16 emptyXor; u16 error; u16 errorXor; u16 reserved;
};
static_assert(sizeof(Config) == 24, "Installer config");
extern "C" volatile Config learnsetConfig;
inline bool configured(u16 value, u16 inverse) { return value != End && u16(value ^ inverse) == End; }

// Shared bounded reader: field initialization uses heap 4; in-place viewer
// refreshes use application heap 79. No party data is modified.
inline void buildList(Request* request,u32 heap) {
    request->list={};
    request->list.status=Status::Unavailable;
    void* moveArc = native<void*(*)(u32,u32)>(0x204aa5d,0x204aa31)(21,heap);
    if (!moveArc) return;
    auto count = native<u32(*)(void*)>(0x204adad,0x204ad81);
    const u32 moveCount=count(moveArc);
    native<void(*)(void*)>(0x204ab39,0x204ab0d)(moveArc);
    const auto identity=viewIdentity(request);
    const u32 personalId=native<u32(*)(u32,u32)>(0x20204ad,0x2020481)(identity.species,identity.form);
    u32 arc[20]={};
    native<void(*)(void*)>(0x2070ca9,0x2070c7d)(arc);
    if (!native<u32(*)(void*,const char*)>(0x2070ecd,0x2070ea1)(arc,"a/0/1/8")) return;
    const u32 fileSize=native<u32(*)(void*)>(0x2070ded,0x2070dc1)(arc);
    u8 bytes[132];
    const u32 size=readMember(fileSize,personalId,bytes,sizeof(bytes),[&](u32 offset,u8* data,u32 length) {
        if (!native<u32(*)(void*,u32,u32)>(0x2070e55,0x2070e29)(arc,offset,0)) return false;
        return native<int(*)(void*,void*,u32)>(0x2070e6d,0x2070e41)(arc,data,length)==int(length);
    });
    if (size) request->list=parse(bytes,size,moveCount);
    native<u32(*)(void*)>(0x2070de1,0x2070db5)(arc);
}
