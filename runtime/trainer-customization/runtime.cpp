#include "native.h"

struct MemberSettings {
    u8 shiny;
    u8 status;
    u8 sleepTurns;
    u8 hpMode;
    u8 hp[2];
};
static_assert(sizeof(MemberSettings) == 6);

static bool readSettings(u32 trainer, u32 slot, MemberSettings& settings) {
    RomFile file;
    if (!file.open("rom:/battle/trainer-customization.bin")) return false;
    u8 header[16];
    bool ok = file.read(header, sizeof(header));
    if (ok) {
        const u32 count = word(header + 8);
        ok = word(header) == 0x43545750 && half(header + 4) == 1 && half(header + 6) == sizeof(settings)
            && word(header + 12) == 0 && count <= 65536 && trainer < count
            && file.length() == sizeof(header) + count * 6 * sizeof(settings)
            && file.seek(sizeof(header) + (trainer * 6 + slot) * sizeof(settings))
            && file.read(&settings, sizeof(settings));
    }
    file.close();
    return ok;
}

static bool validSettings(const MemberSettings& settings) {
    return settings.shiny <= 2 && settings.status <= 6 && settings.sleepTurns <= 3
        && (settings.status == 2 || settings.sleepTurns == 0) && settings.hpMode <= 2
        && (settings.hpMode == 0 ? !half(settings.hp) : half(settings.hp) > 0)
        && (settings.hpMode != 1 || half(settings.hp) <= 100);
}

static u32 get(void* mon, u32 field) {
    return thumb<u32(*)(void*, u32, void*)>(PARTY_FUNCTION(0x0201cd24))(mon, field, nullptr);
}
static void put(void* mon, u32 field, u32 value) {
    thumb<void(*)(void*, u32, u32)>(PARTY_FUNCTION(0x0201cd48))(mon, field, value);
}

// battle/trainer-move-pools.bin: a 16-byte header (PWMP, version 1, key size 8, key count, payload size), keys
// sorted by source and index (u16 source, u8 index, u8 zero, u32 payload offset), then one entry per key: four
// alternative counts, four 16-bit weights for each slot's own move, and the alternatives as 16-bit move and weight.
static constexpr u32 MovePoolMagic = 0x504d5750;
static constexpr u32 MaxSlotMoves = 15;
static constexpr u32 MaxMoveOptions = 32;

struct MovePools {
    u8 counts[4];
    u8 weights[8];
    u8 options[MaxMoveOptions * 4];
};

static bool readMovePools(u32 key, MovePools& pools) {
    RomFile file;
    if (!file.open("rom:/battle/trainer-move-pools.bin")) return false;
    u8 header[16], entry[8];
    bool found = false;
    if (file.read(header, sizeof(header)) && word(header) == MovePoolMagic && half(header + 4) == 1 && half(header + 6) == sizeof(entry)) {
        const u32 count = word(header + 8), payload = word(header + 12);
        const u32 keysEnd = sizeof(header) + count * sizeof(entry);
        if (count <= 0x10000 && file.length() == keysEnd + payload) {
            u32 low = 0, high = count;
            while (low < high) {
                const u32 middle = (low + high) / 2;
                if (!file.seek(sizeof(header) + middle * sizeof(entry)) || !file.read(entry, sizeof(entry))) break;
                const u32 at = (half(entry) << 8) | entry[2];
                if (at < key) {
                    low = middle + 1;
                    continue;
                }
                if (at > key) {
                    high = middle;
                    continue;
                }
                const u32 offset = word(entry + 4);
                if (entry[3] || offset > payload || payload - offset < 12 || !file.seek(keysEnd + offset)
                    || !file.read(pools.counts, 4) || !file.read(pools.weights, 8)) break;
                u32 total = 0;
                for (u32 slot = 0; slot < 4; ++slot)
                    total += pools.counts[slot] > MaxSlotMoves ? MaxMoveOptions + 1 : pools.counts[slot];
                found = total && total <= MaxMoveOptions && payload - offset - 12 >= total * 4 && file.read(pools.options, total * 4);
                break;
            }
        }
    }
    file.close();
    return found;
}

// The battle builds more than one BattleMon from each trainer Pokémon (the server's and each client's), and this
// hook runs for every one. The first call rolls the moves; later ones for the same setup, side and party slot
// reuse that roll, so every copy agrees.
struct RolledMoves { const u8* setup; u32 client, slot; u16 moves[4]; };
static RolledMoves rolled[24];
static u32 nextRolled;

void forgetRolledMoves(const u8* setup) {
    for (auto& entry : rolled)
        if (entry.setup == setup) entry.setup = nullptr;
}

static RolledMoves* findRolled(const u8* setup, u32 client, u32 slot) {
    for (auto& entry : rolled)
        if (entry.setup == setup && entry.client == client && entry.slot == slot) return &entry;
    return nullptr;
}

static void setMoves(void* mon, const u16* moves) {
    for (u32 slot = 0; slot < 4; ++slot) {
        if (get(mon, 0x36 + slot) == moves[slot]) continue;
        put(mon, 0x36 + slot, moves[slot]);
        put(mon, 0x3a + slot, moves[slot] ? get(mon, 0x42 + slot) : 0);
    }
}

// Give each slot with alternatives one of its moves by weight. The slot's own move is the first choice. A move
// can't appear twice; a roll that leaves a slot with nothing left starts over, and after 16 tries the
// Pokémon keeps the moves it was built with.
static void rollMoves(const u8* setup, u32 client, u32 partySlot, void* mon, u32 key) {
    MovePools pools;
    if (!readMovePools(key, pools)) return;
    if (const auto* previous = findRolled(setup, client, partySlot)) {
        setMoves(mon, previous->moves);
        return;
    }
    const auto random = thumb<u32(*)(u32)>(0x02005748);
    u32 current[4], chosen[4];
    for (u32 slot = 0; slot < 4; ++slot) current[slot] = get(mon, 0x36 + slot);
    const auto taken = [&](u32 move) {
        if (!move) return false;
        for (u32 slot = 0; slot < 4; ++slot)
            if (chosen[slot] == move) return true;
        return false;
    };
    bool complete = false;
    for (u32 attempt = 0; attempt < 16 && !complete; ++attempt) {
        // Slots without alternatives keep their moves, and the rolled slots avoid them.
        for (u32 slot = 0; slot < 4; ++slot) chosen[slot] = pools.counts[slot] ? 0xffffffffu : current[slot];
        const u8* options = pools.options;
        complete = true;
        for (u32 slot = 0; slot < 4 && complete; ++slot) {
            const u32 count = pools.counts[slot];
            if (!count) continue;
            const auto move = [&](u32 i) { return i ? half(options + (i - 1) * 4) : current[slot]; };
            const auto weight = [&](u32 i) { return i ? half(options + (i - 1) * 4 + 2) : half(pools.weights + slot * 2); };
            u32 total = 0;
            for (u32 i = 0; i <= count; ++i)
                if (!taken(move(i))) total += weight(i);
            if (!total) {
                complete = false;
                break;
            }
            u32 roll = random(total);
            for (u32 i = 0; i <= count; ++i) {
                if (taken(move(i))) continue;
                if (roll < weight(i)) {
                    chosen[slot] = move(i);
                    break;
                }
                roll -= weight(i);
            }
            options += count * 4;
        }
    }
    RolledMoves* entry = nullptr;
    for (auto& candidate : rolled) {
        if (!candidate.setup) {
            entry = &candidate;
            break;
        }
    }
    if (!entry) {
        // Every entry is in use: replace the oldest.
        entry = &rolled[nextRolled];
        nextRolled = nextRolled + 1 == sizeof(rolled) / sizeof(rolled[0]) ? 0 : nextRolled + 1;
    }
    entry->setup = setup;
    entry->client = client;
    entry->slot = partySlot;
    for (u32 slot = 0; slot < 4; ++slot) entry->moves[slot] = complete ? chosen[slot] : current[slot];
    setMoves(mon, entry->moves);
}

extern "C" __attribute__((visibility("default"))) u8* CustomizeBattleMon(
    void* mon, u32 monId, u32 heap, u8** mainModule, u32 slot, u32 client
) {
    const auto create = thumb<u8*(*)(void*, u32, u32)>(BATTLE_FUNCTION(0x021ba5c4));
    auto* setup = *mainModule;
    if (word(setup) != 1 || setup[0x20] != 0 || (client != 1 && client != 3) || slot >= 6)
        return create(mon, monId, heap);
    auto* trainer = trainerSetup(setup, client);
    MemberSettings settings;
    if (!trainer) return create(mon, monId, heap);
    const u8* direct = nullptr;
    const u32 partySlot = slot;
    u32 movesKey = 0;
    const u32 source = trainerRosterSource(setup, client, word(trainer), slot, direct, movesKey);
    rollMoves(setup, client, partySlot, mon, movesKey);
    if (direct) {
        settings = {direct[0], direct[1], direct[2], direct[3], {direct[4], direct[5]}};
    } else if (!readSettings(source, slot, settings)) {
        return create(mon, monId, heap);
    }
    if (!validSettings(settings)) return create(mon, monId, heap);

    // Keep the original personality, form, gender, and ability. The shininess
    // test folds the personality and OT ID into a 16-bit XOR.
    if (settings.shiny) {
        const u32 pid = get(mon, 0);
        const u32 id = get(mon, 7);
        const u32 xorValue = pid ^ id;
        const u32 shinyXor = (xorValue ^ (xorValue >> 16)) & 0xffff;
        if ((shinyXor < 8) != (settings.shiny == 1))
            put(mon, 7, id ^ (settings.shiny == 1 ? shinyXor : 8));
    }
    if (settings.hpMode) {
        const u32 maximum = get(mon, 0xa1);
        u32 hp = half(settings.hp);
        if (settings.hpMode == 1) {
            const auto divide = reinterpret_cast<u32(*)(u32, u32)>(PARTY_FUNCTION(0x0208d894));
            hp = divide(maximum * hp, 100);
            if (!hp && maximum) hp = 1;
        }
        put(mon, 0xa0, hp < maximum ? hp : maximum);
    }
    // Bad poison uses the same party status as poison. Its counter lives in
    // BattleMon's condition word, as does the optional sleep turn count.
    if (settings.status) put(mon, 0x9d, settings.status == 6 ? 5 : settings.status);
    auto* battleMon = create(mon, monId, heap);
    auto* conditions = reinterpret_cast<u32*>(battleMon + 0x1c);
    if (settings.status == 6)
        conditions[5] = thumb<u32(*)()>(BATTLE_FUNCTION(0x021ce2d8))();
    if (settings.status == 2 && settings.sleepTurns)
        conditions[2] = (conditions[2] & ~(0x3fu << 3)) | (u32(settings.sleepTurns) << 3);
    return battleMon;
}
