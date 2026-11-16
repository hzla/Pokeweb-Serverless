#include "native.h"

static constexpr u32 MaxMembers = 32;
static constexpr u32 HeaderSize = 16;
static constexpr u32 SlotCount = 6;
static constexpr u32 SlotPoolMemberSize = DirectPoolMemberSize + 1;

struct Pool {
    u32 size, count, leads, aces;
    u32 entrySize;
    bool perSlot;
    u32 slotOptions[SlotCount];
    u8 members[MaxMembers * SlotPoolMemberSize];
    const u8* member(u32 index) const { return members + entrySize * index; }
    u8 fallback[6];
    u32 blocked[MaxMembers];
};

static bool readPool(RomFile& file, u32 id, u32 trainerId, u32 minimum, Pool& pool) {
    u8 header[HeaderSize], offsets[8], config[HeaderSize];
    if (!file.read(header, sizeof(header))) return false;
    const u32 count = word(header + 8), payload = word(header + 12);
    const u32 version = half(header + 4);
    pool.entrySize = half(header + 6);
    const bool linkedOnly = version == 1 && pool.entrySize == LinkedPoolMemberSize;
    const bool slotFormat = version == 4 && pool.entrySize == SlotPoolMemberSize;
    const bool mixed = ((version == 2 || version == 3) && pool.entrySize == DirectPoolMemberSize) || slotFormat;
    const u32 rowHeader = HeaderSize + (slotFormat ? SlotCount : 0);
    if (word(header) != 0x50545750 || (!linkedOnly && !mixed)
        || count > (version >= 3 ? 0x4000u : 256u) || id >= count || payload > count * (rowHeader + MaxMembers * (pool.entrySize + 2)))
        return false;
    const u32 directoryEnd = HeaderSize + (count + 1) * 4;
    if (file.length() != directoryEnd + payload || !file.seek(HeaderSize + id * 4) || !file.read(offsets, sizeof(offsets)))
        return false;
    const u32 start = word(offsets), end = word(offsets + 4);
    if (start > end || end > payload || end - start < rowHeader || !file.seek(directoryEnd + start) || !file.read(config, sizeof(config)))
        return false;
    pool.size = config[0];
    pool.count = config[1];
    pool.leads = config[6];
    pool.aces = config[7];
    const bool fixed = id > 255;
    const u32 owner = half(config + 14);
    if (fixed ? !owner || owner != trainerId || owner >= 0x500 : owner != 0) return false;
    const u32 speciesRule = config[2], itemClause = config[3], roleSlots = config[4], exceptionCount = config[5];
    if (pool.size < minimum || pool.size > SlotCount || pool.count < pool.size || pool.count > MaxMembers
        || speciesRule > 2 || itemClause > 1 || roleSlots < 1 || roleSlots > 2 || exceptionCount > MaxMembers
        || pool.leads > roleSlots || pool.aces > roleSlots || pool.leads + pool.aces > pool.size
        || (fixed && (pool.count != pool.size || speciesRule || itemClause || exceptionCount || pool.leads || pool.aces))
        || end - start != rowHeader + exceptionCount * 2 + pool.count * pool.entrySize)
        return false;
    u8 groups[SlotCount];
    pool.perSlot = false;
    if (slotFormat) {
        if (!file.read(groups, SlotCount)) return false;
        for (u32 i = 0; i < SlotCount; ++i) {
            if (groups[i] > SlotCount || (groups[i] && i >= pool.size)) return false;
            if (groups[i]) pool.perSlot = true;
        }
        if (pool.perSlot && (fixed || pool.leads || pool.aces)) return false;
    }
    if (pool.perSlot) {
        for (u32 slot = 0; slot < pool.size; ++slot) {
            if (!groups[slot]) return false;
            pool.slotOptions[slot] = 0;
        }
    }
    u8 exceptions[MaxMembers * 2];
    if ((exceptionCount && !file.read(exceptions, exceptionCount * 2)) || !file.read(pool.members, pool.count * pool.entrySize)) return false;

    // Compute conflicts once. A candidate always conflicts with itself.
    u16 items[MaxMembers];
    for (u32 i = 0; i < pool.count; ++i) {
        const auto* member = pool.member(i);
        const u32 trainer = half(member), packed = member[2];
        if ((!trainer && !mixed) || (fixed && (trainer || packed)) || trainer >= 0x500 || (packed & 7) > 5 || (packed >> 3) > 2 || member[3] > 3 || !half(member + 4))
            return false;
        if (!trainer && ((packed & 7) || half(member + 4) > 2047 || half(member + 6) > 31
            || (member[11] & 15) > 2 || !member[12] || member[12] > 100 || member[13] > 25)) return false;
        if (slotFormat) {
            const u32 membership = member[DirectPoolMemberSize];
            if (membership > (pool.perSlot ? (1u << SlotCount) - 1 : 0)) return false;
            if (pool.perSlot) {
                for (u32 slot = 0; slot < pool.size; ++slot)
                    if (membership & (1u << (groups[slot] - 1))) pool.slotOptions[slot] |= 1u << i;
            }
        }
        items[i] = itemClause ? half(member + 8) : 0;
        for (u32 e = 0; e < exceptionCount; ++e)
            if (items[i] == half(exceptions + e * 2)) items[i] = 0;

        pool.blocked[i] = 1u << i;
        for (u32 j = 0; j < i; ++j) {
            const auto* other = pool.member(j);
            if (trainer && trainer == half(other) && (packed & 7) == (other[2] & 7)) return false;
            const bool sameSpecies = speciesRule && half(member + 4) == half(other + 4)
                && (speciesRule == 1 || half(member + 6) == half(other + 6));
            if (sameSpecies || (items[i] && items[i] == items[j])) {
                pool.blocked[i] |= 1u << j;
                pool.blocked[j] |= 1u << i;
            }
        }
    }
    u32 blocked = 0;
    for (u32 slot = 0; slot < pool.size; ++slot) {
        const u32 index = config[8 + slot];
        const u32 role = slot < pool.leads ? 1 : slot >= pool.size - pool.aces ? 2 : 0;
        if (index >= pool.count || (fixed && index != slot) || (blocked & (1u << index)) || (pool.perSlot ? !(pool.slotOptions[slot] & (1u << index)) : pool.member(index)[2] >> 3 != role)) return false;
        pool.fallback[slot] = index;
        blocked |= pool.blocked[index];
    }
    return true;
}

struct Sample {
    const Pool& pool;
    u32 budget = 4096;
    u8 order[MaxMembers], chosen[SlotCount];
    u8 slotOrder[SlotCount][MaxMembers], slotCount[SlotCount];

    explicit Sample(const Pool& source) : pool(source) {}

    u32 roleAt(u32 depth) const {
        if (depth < pool.leads) return 1;
        return depth < pool.leads + pool.aces ? 2 : 0;
    }

    void shuffleSlots(u32 (*random)(u32)) {
        for (u32 slot = 0; slot < pool.size; ++slot) {
            u32 count = 0;
            for (u32 candidate = 0; candidate < pool.count; ++candidate) {
                if (!(pool.slotOptions[slot] & (1u << candidate))) continue;
                const u32 j = count ? random(count + 1) : 0;
                if (j != count) slotOrder[slot][count] = slotOrder[slot][j];
                slotOrder[slot][j] = candidate;
                ++count;
            }
            slotCount[slot] = count;
        }
    }

    bool pickSlots(u32 slot, u32 blocked) {
        if (slot == pool.size) return true;
        if (!(pool.slotOptions[slot] & ~blocked)) return false;
        for (u32 i = 0; i < slotCount[slot]; ++i) {
            if (!budget) return false;
            --budget;
            const u32 index = slotOrder[slot][i];
            if (blocked & (1u << index)) continue;
            chosen[slot] = index;
            if (pickSlots(slot + 1, blocked | pool.blocked[index])) return true;
        }
        return false;
    }

    bool pick(u32 depth, u32 start, u32 blocked) {
        if (depth == pool.size) return true;
        const u32 role = roleAt(depth);
        const u32 slot = role == 1 ? depth : role == 2 ? pool.size - pool.aces + depth - pool.leads : depth - pool.aces;
        const bool sameRole = roleAt(depth + 1) == role;
        for (u32 i = start; i < pool.count; ++i) {
            if (!budget) return false;
            --budget;
            const u32 index = order[i];
            if ((blocked & (1u << index)) || pool.member(index)[2] >> 3 != role) continue;
            chosen[slot] = index;
            if (pick(depth + 1, sameRole ? i + 1 : 0, blocked | pool.blocked[index])) return true;
        }
        return false;
    }
};

bool selectTrainerPool(u32 id, u32 trainer, u32 minimum, TrainerPoolParty& result) {
    Pool pool;
    RomFile file;
    if (!file.open("rom:/battle/trainer-party-pools.bin")) return false;
    const bool valid = readPool(file, id, trainer, minimum, pool);
    file.close();
    if (!valid) return false;

    const u8* choices = pool.fallback;
    Sample sample(pool);
    // Alternate parties use authored order. Only pools consume RNG to pick members.
    if (id <= 255) {
        const auto random = thumb<u32(*)(u32)>(0x02005748);
        if (pool.perSlot) {
            sample.shuffleSlots(random);
            if (sample.pickSlots(0, 0)) choices = sample.chosen;
        } else {
            for (u32 i = 0; i < pool.count; ++i) {
                const u32 j = i ? random(i + 1) : 0;
                if (j != i) sample.order[i] = sample.order[j];
                sample.order[j] = i;
            }
            if (sample.pick(0, 0, 0)) choices = sample.chosen;
        }
    }
    result.size = pool.size;
    for (u32 slot = 0; slot < pool.size; ++slot) {
        const auto* data = pool.member(choices[slot]);
        auto& member = result.members[slot];
        const u32 bytes = pool.entrySize < DirectPoolMemberSize ? pool.entrySize : DirectPoolMemberSize;
        for (u32 byte = 0; byte < bytes; ++byte) member.bytes[byte] = data[byte];
        result.index[slot] = choices[slot];
    }
    return true;
}

// All three hooks are inside the retail party builder. The override lasts
// only for a synchronous call building one selected donor Pokémon.
struct PoolBuild {
    const TrainerPoolMember* member;
    void* party;
    u32 trainer;
    bool append;
};
static PoolBuild active;

extern "C" void InitPoolParty(void* party, u32 capacity) {
    if (party != active.party || !active.append)
        thumb<void(*)(void*, u32)>(PARTY_FUNCTION(0x0201fd60))(party, capacity);
}

extern "C" void ReadPoolTrainer(u32 trainer, u8* data) {
    thumb<void(*)(u32, u8*)>(PARTY_FUNCTION(0x0203070c))(trainer, data);
    const auto* member = active.member;
    if (!member || active.trainer != trainer) return;
    if (!member->trainer()) {
        // Inline Pokémon use the opponent's class and ID for native defaults.
        data[0] = member->format();
        data[3] = 1;
    } else {
        data[3] = member->format() == data[0] && member->slot() < data[3] ? 1 : 0;
    }
}

extern "C" void ReadPoolPokemon(u32 trainer, u8* data) {
    const auto* member = active.member;
    if (member && active.trainer == trainer && !member->trainer()) {
        const u8* bytes = member->bytes;
        // Lay out a one-member native record for the chosen move/item template.
        for (u32 i = 0; i < 4; ++i) data[i] = bytes[10 + i];
        for (u32 i = 0; i < 4; ++i) data[4 + i] = bytes[4 + i];
        u32 offset = 8;
        if (member->format() & 2) {
            data[offset++] = bytes[8];
            data[offset++] = bytes[9];
        }
        if (member->format() & 1)
            for (u32 i = 0; i < 8; ++i) data[offset + i] = bytes[14 + i];
        return;
    }
    thumb<void(*)(u32, u8*)>(PARTY_FUNCTION(0x02030750))(trainer, data);
    if (member && active.trainer == trainer) {
        const u32 format = member->format();
        const u32 stride = 8 + (format & 1 ? 8 : 0) + (format & 2 ? 2 : 0);
        const u8* source = data + stride * member->slot();
        for (u32 i = 0; i < stride; ++i) data[i] = source[i];
    }
}

bool buildTrainerPool(const TrainerPoolParty& pool, u32 original, void* party, u32 heap) {
    const auto load = thumb<void(*)(u32, void*, u32)>(PARTY_FUNCTION(0x020308ec));
    const auto count = thumb<u32(*)(const void*)>(PARTY_FUNCTION(0x0201fe24));
    for (u32 i = 0; i < pool.size; ++i) {
        active.member = &pool.members[i];
        active.party = party;
        active.append = i != 0;
        const u32 linked = active.member->trainer();
        active.trainer = linked ? linked : original;
        load(active.trainer, party, heap);
        active.member = nullptr;
        active.party = nullptr;
        if (count(party) != i + 1) return false;
    }
    return true;
}
