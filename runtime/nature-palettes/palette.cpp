#include "runtime.h"
namespace nature_palettes {
np_u32 sprite(np_u32 species, np_u32 form) {
    if (!species || species > 649 || form > 31) return 65535;
    if (!form) return species;
    const np_u32 count = api<np_u32(*)(np_u32,np_u32,np_u32)>(0x0201ef48)(species, 0, 0x20);
    if (form >= count) return species;
    return 685 + api<np_u32(*)(np_u32,np_u32,np_u32)>(0x0201ef48)(species, 0, 0x1f) + form - 1;
}
np_u32 ppNature(void* pp) {
    return ram(pp) ? api<np_u32(*)(void*,np_u32,np_u32)>(0x0201cd24)(pp, 0x70, 0) : 255;
}
static bool read(void* file, np_u32 offset, void* buffer, np_u32 size) {
    return api<np_u32(*)(void*,np_u32,np_u32)>(0x02070e54)(file, offset, 0)
        && api<np_i32(*)(void*,void*,np_u32)>(0x02070e6c)(file, buffer, size) == static_cast<np_i32>(size);
}
bool apply(np_u16* palette, np_u32 requested) {
    if (requested > 65536u * 150u - 1u) return false;
    np_u32 file[20];
    api<void(*)(void*)>(0x02070ca8)(file);
    if (!api<np_u32(*)(void*,const char*)>(0x02070ecc)(file, "rom:/pokemon/nature-palettes.bin")) return false;
    np_u8 header[16], entry[8], record[32];
    const np_u32 size = api<np_u32(*)(void*)>(0x02070dec)(file);
    bool valid = size >= 16 && read(file, 0, header, 16);
    np_u32 count = valid ? word(header + 8) : 0;
    valid = valid && word(header) == 0x504e5750 && half(header + 4) == 1 && half(header + 6) == 16
        && word(header + 12) == size && count <= 0x15555555 && count * 12 <= size - 16;
    np_u32 lo = 0, hi = count, at = 0;
    while (valid && lo < hi) {
        const np_u32 mid = lo + (hi - lo) / 2;
        valid = read(file, 16 + mid * 8, entry, 8);
        if (!valid) break;
        const np_u32 found = word(entry);
        if (found < requested) lo = mid + 1;
        else if (found > requested) hi = mid;
        else { at = word(entry + 4); break; }
    }
    valid = valid && at >= 16 + count * 8 && at <= size - 2 && !(at & 1) && read(file, at, record, 2);
    np_u32 mask = valid ? half(record) : 0, colors = 0;
    for (np_u32 bits = mask; bits; bits &= bits - 1) ++colors;
    valid = valid && mask && !(mask & 1) && colors <= 15 && colors * 2 <= size - at - 2 && read(file, at + 2, record + 2, colors * 2);
    // Reject an overlapping/truncated payload, including an unsorted neighbor.
    if (valid) {
        const np_u32 index = lo + (hi - lo) / 2;
        if (index + 1 < count) valid = read(file, 16 + (index + 1) * 8, entry, 8) && word(entry) > requested && word(entry + 4) == at + 2 + colors * 2;
        else valid = at + 2 + colors * 2 == size;
        if (valid && index) valid = read(file, 16 + (index - 1) * 8, entry, 8) && word(entry) < requested && word(entry + 4) < at && word(entry + 4) >= 16 + count * 8;
        for (np_u32 i = 0; valid && i < colors; ++i) valid = half(record + 2 + i * 2) <= 0x7fff;
    }
    api<np_u32(*)(void*)>(0x02070de0)(file);
    if (!valid) return false;
    np_u32 n = 0;
    for (np_u32 i = 1; i < 16; ++i) if (mask & (1u << i)) palette[i] = half(record + 2 + (n++) * 2);
    return true;
}
static np_u32 load(void* maw, void* task, LoadContext* context) {
    if (context->hook && reinterpret_cast<np_u32(*)(void*,void*,np_u32)>(context->hook)(maw, task, context->param) == 1) { context->hook = 0; context->param = 0; }
    // Only Pokemon archive 4, members 18/19 of each 20-file sprite block.
    const np_u32 member = field(maw, 8);
    if (member >= 65536 * 20) return 0;
    np_u32 spriteIndex = 0, slot = member;
    for (np_u32 bit = 32768, divisor = 655360; bit; bit >>= 1, divisor >>= 1) {
        if (slot >= divisor) { slot -= divisor; spriteIndex |= bit; }
    }
    if (context->nature >= 25 || field(maw, 0) != 4 || (slot != 18 && slot != 19)) return 0;
    auto* nclr = reinterpret_cast<np_u8*>(field(task, 4));
    auto* work = reinterpret_cast<np_u8*>(field(task, 0x24));
    if (!ram(nclr, 16) || !ram(work, 0xe0) || field(nclr, 8) < 32 || field(work, 0xdc) < 32) return 0;
    auto* source = reinterpret_cast<np_u16*>(field(nclr, 12));
    auto* base = reinterpret_cast<np_u16*>(field(work, 0xd4));
    if (!ram(source, 32) || !ram(base, 32)) return 0;
    if (apply(source, key(spriteIndex, 0, context->nature, slot == 19))) {
        for (np_u32 i = 0; i < 16; ++i) base[i] = source[i];
    }
    return 0; // Keep our stack-scoped callback until the synchronous load returns.
}
LoadContext begin(void* sys, np_u32 nature) {
    LoadContext context = {field(sys, 0x38), field(sys, 0x3c), nature};
    return context;
}
// Context is installed by the caller after its return-value copy has settled.
extern "C" void PWNP_SetLoadContext(void* sys, LoadContext* context) {
    *reinterpret_cast<np_u32*>(static_cast<np_u8*>(sys) + 0x38) = reinterpret_cast<np_u32>(&load);
    *reinterpret_cast<np_u32*>(static_cast<np_u8*>(sys) + 0x3c) = reinterpret_cast<np_u32>(context);
}
void end(void* sys, const LoadContext& context) {
    *reinterpret_cast<np_u32*>(static_cast<np_u8*>(sys) + 0x38) = context.hook;
    *reinterpret_cast<np_u32*>(static_cast<np_u8*>(sys) + 0x3c) = context.param;
}
}
