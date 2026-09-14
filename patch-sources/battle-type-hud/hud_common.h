#pragma once
using u8 = unsigned char;
using u16 = unsigned short;
using u32 = unsigned int;
#ifdef GAME_B2
#include "build/addresses-B2.h"
#else
#include "build/addresses-W2.h"
#endif
namespace {
template<class T> T& field(void* p, unsigned offset) {
    return *reinterpret_cast<T*>(static_cast<u8*>(p)+offset);
}
bool ram(const void* p) {
    const u32 n=reinterpret_cast<u32>(p);
    return n>=0x02000000 && n<0x02400000 && !(n&3);
}
struct FadeBank {
    u16 *source, *transfer;
    u32 bytes;
    u16 bits, timing, target, step;
};
static_assert(sizeof(FadeBank)==20, "native fade ABI");
u16 blend(u16 color,u16 target,int evy) {
    unsigned out=0;
    for(unsigned shift=0;shift<15;shift+=5) {
        const int a=(color>>shift)&31, b=(target>>shift)&31;
        out|=static_cast<unsigned>(a+(((b-a)*evy)>>4))<<shift;
    }
    return static_cast<u16>(out);
}
int currentFade(const FadeBank& f,unsigned bank) {
    // now_evy advances AFTER native calculation. Recover the currently visible
    // value from untouched palette entries instead of applying the next frame.
    const u16* s=f.source+bank*16; const u16* t=f.transfer+bank*16;
    for(int evy=0;evy<=16;++evy)
        if(blend(s[1],f.target,evy)==t[1] && blend(s[2],f.target,evy)==t[2]
           && blend(s[3],f.target,evy)==t[3] && blend(s[13],f.target,evy)==t[13]) return evy;
    return -1; // unrecognized transient effect: wait for a compatible palette
}
}
