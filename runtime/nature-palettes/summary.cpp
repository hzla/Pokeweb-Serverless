#include "runtime.h"
using namespace nature_palettes;
extern "C" void PWNP_SetLoadContext(void*, LoadContext*);
extern "C" void* PWNP_SummaryAdd(void* sys, void* pp, np_u32 side, np_u32 x, np_u32 y, np_u32 z) {
    // Match MCSS_TOOL_AddPokeMcss, installing our callback after its Spinda hook.
    const np_u32 personality = api<np_u32(*)(void*,np_u32,np_u32)>(0x0201cd24)(pp, 0, 0);
    api<void(*)(void*,np_u32)>(0x0201c1b4)(sys, personality);
    np_u32 maw[9];
    api<void(*)(void*,void*,np_u32)>(0x0201c008)(pp, maw, side);
    auto context = begin(sys, ppNature(pp));
    PWNP_SetLoadContext(sys, &context);
    void* result = api<void*(*)(void*,np_u32,np_u32,np_u32,void*)>(0x0201a8d4)(sys,x,y,z,maw);
    end(sys, context);
    return result;
}
