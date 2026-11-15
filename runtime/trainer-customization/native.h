#pragma once

using u8 = unsigned char;
using u16 = unsigned short;
using u32 = unsigned int;
using i32 = int;

#ifdef BLACK2
#define PARTY_FUNCTION(address) ((address) - 44)
#define BATTLE_FUNCTION(address) ((address) - 64)
#else
#define PARTY_FUNCTION(address) (address)
#define BATTLE_FUNCTION(address) (address)
#endif

template<class F> static F thumb(u32 address) { return reinterpret_cast<F>(address | 1); }
inline u32 half(const u8* p) { return p[0] | (u32(p[1]) << 8); }
inline u32 word(const u8* p) { return half(p) | (half(p + 2) << 16); }

struct RomFile {
    u32 storage[20];
    bool open(const char* path) {
        thumb<void(*)(void*)>(PARTY_FUNCTION(0x02070ca8))(storage);
        return thumb<u32(*)(void*, const char*)>(PARTY_FUNCTION(0x02070ecc))(storage, path);
    }
    bool read(void* data, u32 size) {
        return thumb<i32(*)(void*, void*, u32)>(PARTY_FUNCTION(0x02070e6c))(storage, data, size) == i32(size);
    }
    bool seek(u32 offset) {
        return thumb<u32(*)(void*, u32, u32)>(PARTY_FUNCTION(0x02070e54))(storage, offset, 0);
    }
    u32 length() {
        return thumb<u32(*)(void*)>(PARTY_FUNCTION(0x02070dec))(storage);
    }
    void close() {
        thumb<u32(*)(void*)>(PARTY_FUNCTION(0x02070de0))(storage);
    }
};

inline u8* trainerSetup(u8* setup, u32 client) {
    return *reinterpret_cast<u8**>(setup + 0x48 + client * 4);
}

static constexpr u32 LinkedPoolMemberSize = 10;
static constexpr u32 DirectPoolMemberSize = 28;

struct TrainerPoolMember {
    u8 bytes[DirectPoolMemberSize];
    u32 trainer() const { return half(bytes); }
    u32 slot() const { return bytes[2] & 7; }
    u32 format() const { return bytes[3]; }
};
struct TrainerPoolParty { u32 size; TrainerPoolMember members[6]; };

bool selectTrainerPool(u32 id, u32 trainer, u32 minimum, TrainerPoolParty& result);
bool buildTrainerPool(const TrainerPoolParty& pool, u32 original, void* party, u32 heap);
u32 trainerRosterSource(const u8* setup, u32 client, u32 original, u32& slot, const u8*& direct);
