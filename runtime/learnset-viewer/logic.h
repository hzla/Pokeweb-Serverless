#pragma once
#include <stdint.h>
namespace learnset {
using u8 = uint8_t;
using u16 = uint16_t;
using u32 = uint32_t;
constexpr u32 MaxEntries = 32;
constexpr u16 End = 0xffff;
constexpr u16 Command = 0x4c53;
constexpr u32 Transition = 0x4c535631;
constexpr u32 RequestMagic = 0x3156534c;
constexpr u16 RequestVersion = 2;
struct Entry { u16 moveId; u16 level; };
enum class Status : u16 { Ready, Empty, Unavailable };
struct List { Entry entries[MaxEntries]; u16 count; Status status; };
// D-pad Right advances in party order; Left goes backwards. One bounded
// pass skips Eggs/empty slots and returns the current slot if it is alone.
template<class Eligible>
inline u32 nextPartySlot(u32 current,u32 count,bool forward,Eligible eligible) {
    if(count<2 || count>6 || current>=count)return current;
    u32 slot=current;
    for(u32 visited=1;visited<count;++visited) {
        slot=forward?(slot+1==count?0:slot+1):(slot?slot-1:count-1);
        if(eligible(slot))return slot;
    }
    return current;
}
inline u16 read16(const u8* p) { return u16(p[0] | (u16(p[1]) << 8)); }
inline u32 read32(const u8* p) { return read16(p) | (u32(read16(p+2)) << 16); }

// Bounded NARC lookup, without the retail archive reader's fatal assertions.
// Read must return false on a short read; all arithmetic is checked first.
template<class Read>
inline u32 readMember(u32 size, u32 member, u8* out, u32 capacity, Read read) {
    u8 header[16];
    auto block = [&](u32 offset, u8* data, u32 length) {
        return offset <= size && length <= size-offset && read(offset,data,length);
    };
    if (!block(0,header,16) || read32(header)!=0x4352414e || read32(header+4)!=0x0100fffe
        || read32(header+8)!=size || read16(header+12)!=16 || read16(header+14)!=3) return 0;
    if (!block(16,header,12) || read32(header)!=0x46415442) return 0;
    const u32 fatSize=read32(header+4), count=read16(header+8);
    if (fatSize<12+count*8 || fatSize>size-16 || member>=count) return 0;
    if (!block(28+member*8,header,8)) return 0;
    const u32 start=read32(header), end=read32(header+4);
    u32 offset=16+fatSize;
    if (!block(offset,header,8) || read32(header)!=0x464e5442) return 0;
    const u32 nameSize=read32(header+4);
    if (nameSize<8 || nameSize>size-offset) return 0;
    offset+=nameSize;
    if (!block(offset,header,8) || read32(header)!=0x46494d47) return 0;
    const u32 imageSize=read32(header+4);
    if (imageSize<8 || imageSize!=size-offset || start>end || end>imageSize-8
        || end-start>capacity || !end || end==start) return 0;
    return block(offset+8+start,out,end-start) ? end-start : 0;
}

// No filtering by the Pokemon's level or known moves. Exact duplicates only.
inline List parse(const u8* bytes, u32 length, u32 moveCount) {
    List result = {};
    result.status = Status::Unavailable;
    if (!bytes || length < 4 || length > (MaxEntries + 1) * 4 || (length & 3)) return result;
    bool terminated = false;
    for (u32 offset = 0; offset < length; offset += 4) {
        Entry entry = {read16(bytes + offset), read16(bytes + offset + 2)};
        if (entry.moveId == End && entry.level == End) { terminated = true; break; }
        if (!entry.moveId || entry.moveId >= moveCount || entry.level > 100 || offset / 4 >= MaxEntries) {
            result.count = 0;
            return result;
        }
        bool duplicate = false;
        for (u32 i = 0; i < result.count; ++i)
            if (result.entries[i].moveId == entry.moveId && result.entries[i].level == entry.level) duplicate = true;
        if (duplicate) continue;
        u32 pos = result.count++;
        while (pos && result.entries[pos - 1].level > entry.level) {
            result.entries[pos] = result.entries[pos - 1];
            --pos;
        }
        result.entries[pos] = entry;
    }
    if (!terminated) { result.count = 0; return result; }
    result.status = result.count ? Status::Ready : Status::Empty;
    return result;
}

// Check the unexpanded *main* menu as well as the already-expanded count.
// Item/mail submenus and Egg menus have different prefixes.
inline bool canAppend(const u32* input, u32 expandedCount, bool fieldMode) {
    if (!fieldMode || !input || expandedCount == 0 || expandedCount >= 8
        || input[0] != 0 || input[1] != 1 || input[2] != 3
        || (input[3] != 4 && input[3] != 5)) return false;
    for (u32 i = 4; i < 7; ++i) {
        if (input[i] == 6) return input[i + 1] == 16;
        if (input[i] != 7 && input[i] != 11) return false;
    }
    return false;
}
inline u32 decimal(u16* out, u32 value) {
    const u32 places[] = {1000000000,100000000,10000000,1000000,100000,10000,1000,100,10,1};
    u32 count = 0;
    for (u32 place : places) {
        u16 digit='0';
        while (value>=place) { value-=place; ++digit; }
        if (count || digit!='0' || place==1) out[count++]=digit;
    }
    return count;
}

// The caller supplies PRINTSYS_GetStrWidth; host tests use a deterministic font.
template<class Measure>
inline void label(u16* out, u32 capacity, u16 level, const u16* name, u32 width, Measure measure) {
    if (capacity < 12) return;
    u32 prefix = decimal(out, level);
    out[prefix++] = ' '; out[prefix++] = '-'; out[prefix++] = ' ';
    u32 end = prefix;
    while (*name != End && *name && end + 4 < capacity) out[end++] = *name++;
    out[end] = End;
    if ((*name == End || !*name) && measure(out) <= width) return;
    do {
        out[end] = '.'; out[end + 1] = '.'; out[end + 2] = '.'; out[end + 3] = End;
        if (measure(out) <= width || end == prefix) break;
        --end;
    } while (true);
}
}
