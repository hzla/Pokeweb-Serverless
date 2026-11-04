#include "runtime.h"
using namespace nature_palettes;
extern "C" void PWNP_SetLoadContext(void*, LoadContext*);
#ifdef PWNP_COMBINED
extern "C" void PWNP_BattleResourcesChanged(void*);
#endif
// Battle-wide IDs remain attached to their party slots until scene teardown.
static np_u8 transformedNature[24];
static np_u32 transformedValid;
static np_u8* battleWork() {
#ifdef GAME_BLACK2
    return *reinterpret_cast<np_u8**>(0x021f4240);
#else
    return *reinterpret_cast<np_u8**>(0x021f4280);
#endif
}
static np_u32 monNature(void* mon) {
    if (!ram(mon, 0x1c)) return 255;
    const np_u32 id = static_cast<np_u8*>(mon)[0x19];
    if ((static_cast<np_u8*>(mon)[0x1b] & 0x20) && id < 24 && (transformedValid & (1u << id))) return transformedNature[id];
    return ppNature(reinterpret_cast<void*>(field(mon, 0)));
}
extern "C" np_u32 PWNP_BattleNature(np_u32 view) {
    auto* work = battleWork();
    if (view >= 8 || !ram(work, 0x1e8)) return 255;
    auto* scu = reinterpret_cast<void*>(field(work, 0x1e0));
    auto* main = reinterpret_cast<void*>(field(work, 0x1e4));
    if (!ram(scu, 0x13c) || !ram(main)) return 255;
    auto* con = reinterpret_cast<void*>(field(scu, 0x138));
    if (!ram(con)) return 255;
    const np_u32 position = api<np_u32(*)(void*,np_u32)>(0x0219c784)(main, view);
    if (position >= 6) return 255;
    void* mon = api<void*(*)(void*,np_u32)>(0x0219d1c8)(con, position);
    if (!ram(mon, 0x1c)) return 255;
    mon = api<void*(*)(void*,void*,void*)>(0x0219cc98)(main, con, mon);
    return monNature(mon);
}
extern "C" np_u32 PWNP_Transform(void* mon, void* target) {
    const np_u32 nature = monNature(target);
    const np_u32 result = api<np_u32(*)(void*,void*)>(0x021bc490)(mon, target);
    const np_u32 id = static_cast<np_u8*>(mon)[0x19];
    if (result && id < 24) { transformedNature[id] = nature < 25 ? nature : 255; transformedValid |= 1u << id; }
    return result;
}
extern "C" void PWNP_BattleTerm() { transformedValid = 0; }
extern "C" void* PWNP_BattleAdd(void* sys, np_i32 x, np_i32 y, np_i32 z, void* maw, void*, np_u32 view) {
    auto context = begin(sys, PWNP_BattleNature(view));
    PWNP_SetLoadContext(sys, &context);
    void* result = api<void*(*)(void*,np_i32,np_i32,np_i32,void*)>(0x0201a8d4)(sys,x,y,z,maw);
    end(sys, context);
#ifdef PWNP_COMBINED
    PWNP_BattleResourcesChanged(result);
#endif
    return result;
}
extern "C" void PWNP_BattleReload(void* sys, void* mcss, void* maw) {
    np_u32 nature = 255;
    auto* work = battleWork();
    auto* bmw = ram(work, 0x194) ? reinterpret_cast<np_u8*>(field(work, 0x190)) : nullptr;
    if (ram(bmw, 14 * 0x5c + 8)) for (np_u32 i = 0; i < 14; ++i) {
        if (field(bmw, 8 + i * 0x5c) == reinterpret_cast<np_u32>(mcss)) {
            nature = PWNP_BattleNature(field(bmw, 0x50 + i * 0x5c)); break;
        }
    }
    auto context = begin(sys, nature);
    PWNP_SetLoadContext(sys, &context);
    api<void(*)(void*,void*,void*)>(0x02019c04)(sys,mcss,maw);
    end(sys, context);
#ifdef PWNP_COMBINED
    PWNP_BattleResourcesChanged(mcss);
#endif
}
