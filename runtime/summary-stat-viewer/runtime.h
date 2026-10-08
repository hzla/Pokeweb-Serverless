#pragma once
using u8=unsigned char;
using u16=unsigned short;
using u32=unsigned int;
using s16=short;
#if defined(GAME_B) || defined(GAME_W)
#include "profiles-bw1.generated.h"
#else
#include "profiles.generated.h"
#endif
template<class T> inline T& at(void* p,u32 n) { return *reinterpret_cast<T*>(static_cast<u8*>(p)+n); }
template<class F> inline F api(u32 w2) {
#if defined(GAME_B) || defined(GAME_W)
    // BW1's graphics library uses ARM entry points; Pokémon helpers are Thumb.
    return reinterpret_cast<F>(nativeApiAddress(w2));
#else
    return reinterpret_cast<F>(nativeApiAddress(w2)|1);
#endif
}
template<class F> inline F overlay(u32 w2) {
#if defined(GAME_B) || defined(GAME_W)
    return reinterpret_cast<F>(nativeOverlayAddress(w2)|1);
#elif defined(GAME_B2)
    return reinterpret_cast<F>((w2-0x40)|1);
#else
    return reinterpret_cast<F>(w2|1);
#endif
}
struct Configuration { u8 magic[8]; u16 version,size; u32 flags,check; };
extern "C" volatile Configuration summaryStatConfiguration;
