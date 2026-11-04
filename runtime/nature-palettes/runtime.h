#pragma once
using np_u8 = unsigned char;
using np_u16 = unsigned short;
using np_u32 = unsigned int;
using np_i32 = int;
namespace nature_palettes {
template<class F> inline F api(np_u32 address) {
#ifdef GAME_BLACK2
    if (address >= 0x020191d8 && address < 0x02100000) address -= 44;
    else if (address >= 0x02199900 && address < 0x02200000) address -= 64;
#endif
    return reinterpret_cast<F>(address | 1);
}
inline np_u32 half(const np_u8* b) { return b[0] | (np_u32(b[1]) << 8); }
inline np_u32 word(const np_u8* b) { return half(b) | (half(b + 2) << 16); }
inline bool ram(const void* p, np_u32 size = 4) { const auto a = reinterpret_cast<np_u32>(p); return a >= 0x02000000 && a <= 0x02400000 - size && !(a & 3); }
inline np_u32 field(const void* p, np_u32 offset) { return *reinterpret_cast<const np_u32*>(static_cast<const np_u8*>(p) + offset); }
inline np_u32 key(np_u32 sprite, np_u32 source, np_u32 nature, bool shiny) { return ((sprite * 3 + source) * 25 + nature) * 2 + shiny; }
np_u32 sprite(np_u32 species, np_u32 form);
bool apply(np_u16* palette, np_u32 key);
np_u32 ppNature(void* pp);
struct LoadContext { np_u32 hook; np_u32 param; np_u32 nature; };
LoadContext begin(void* sys, np_u32 nature);
void end(void* sys, const LoadContext& context);
}
extern "C" np_u32 PWNP_BattleNature(np_u32 viewPosition);
extern "C" void PWNP_BattleTerm();
