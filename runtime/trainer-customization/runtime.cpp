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
    const u32 source = trainerRosterSource(setup, client, word(trainer), slot, direct);
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
