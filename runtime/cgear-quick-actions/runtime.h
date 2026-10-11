#pragma once
using u8=unsigned char; using u16=unsigned short; using u32=unsigned int; using s16=short;
#include "profiles.generated.h"
template<class T> T& at(void* p,u32 n) { return *reinterpret_cast<T*>(static_cast<u8*>(p)+n); }
template<class F> F api(u32 w2) { return reinterpret_cast<F>(nativeAddress(w2)|1); }
template<class F> F ov(u32 w2) { return reinterpret_cast<F>(overlayAddress(w2)|1); }
constexpr u32 INVALID=0xffffffff;
struct Subscreen { u32 mode,next,state;u16 heap,pad;u32 result;void* field;void* callback;void* callbackData;void* work; };
struct Point { u8 x,y; };
struct MapRequest {
    void* system;void* field;void* parent;u32 subscreen,call;void* data;
    void* open;void* close;void* before;void* user;
    u32 result,selection,pokemon,zone,x,y,z;
};
static_assert(sizeof(MapRequest)==68);
struct FlyCheck { u16 zone,bits;u32 form;void* system;void* actor;void* field; };
struct UseHeader { u16 pokemon,move;u32 zone; };
extern "C" void QaCGearInit(Subscreen*);
extern "C" void* QaGearUnit(u32,u32,u32);
extern "C" void QaGearEnd(void*);
extern "C" void QaCGearExit(Subscreen*);
extern "C" void QaCGearUpdate(Subscreen*,u32);
extern "C" void* QaCGearEvent(Subscreen*,u32);
extern "C" void QaNoGearInit(Subscreen*);
extern "C" void QaInput(void*);
extern "C" int QaButtonHit(void*);
extern "C" int QaTownMapReturn(void*,void*);
extern "C" u32 QaRepelStep(void*,void*);
extern "C" u32 QaRepelDepleted(void*,void*);
