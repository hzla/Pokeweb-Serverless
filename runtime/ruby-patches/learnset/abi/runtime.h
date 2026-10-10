#pragma once
#include "logic.generated.h"
using namespace learnset;
#include "layout.h"
#if defined(GAME_B) || defined(GAME_W)
#include "addresses_bw1.generated.h"
#endif
template<class T> inline T& at(void* p, u32 offset) { return *reinterpret_cast<T*>(static_cast<u8*>(p) + offset); }
template<class F> inline F native(u32 w2, u32 b2) {
#if defined(GAME_B) || defined(GAME_W)
    (void)b2; return reinterpret_cast<F>(bw1Address(w2));
#elif defined(GAME_B2)
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

struct Config {
    u8 magic[8]; u16 version; u16 menu; u16 menuXor; u16 empty; u16 emptyXor; u16 error; u16 errorXor; u16 reserved;
};
static_assert(sizeof(Config) == 24, "Installer config");
extern "C" volatile Config learnsetConfig;

// Shared bounded reader: field initialization uses heap 4; in-place viewer
// refreshes use application heap 79. No party data is modified.

// Shared party registration: each command is optional and capacity checked.
struct CustomConfig {u8 magic[8];u16 version,enabled,menu,menuXor,learnsetEnabled,reserved;};
extern "C" volatile CustomConfig customUiConfig;
constexpr u16 CustomCommand=0x5057;
constexpr u32 CustomTransition=0x50575549;
