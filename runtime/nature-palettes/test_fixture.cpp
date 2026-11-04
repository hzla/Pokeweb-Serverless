// CPU-test boundary for the native allocator/archive load. Never linked into DLLs.
#include "runtime.h"
extern "C" void* NatureTestAdd(void* sys, np_u32, np_u32, np_u32, void* maw) {
    auto fn = reinterpret_cast<np_u32(*)(void*,void*,void*)>(nature_palettes::field(sys, 0x38));
    if (fn) fn(maw, reinterpret_cast<void*>(0x02204000), reinterpret_cast<void*>(nature_palettes::field(sys, 0x3c)));
    return reinterpret_cast<void*>(0x02205000);
}
extern "C" void NatureTestReload(void* sys, void*, void* maw) { NatureTestAdd(sys,0,0,0,maw); }
