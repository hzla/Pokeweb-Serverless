// Native Gen V conditions are permanent (status 1), and remain removable.
using u8 = unsigned char;
using u16 = unsigned short;
using u32 = unsigned int;
using i32 = int;
static_assert(sizeof(u32) == 4);

template<class F> static F api(u32 address) {
#ifdef GAME_BLACK2
    if (address >= 0x020191d8 && address < 0x02100000) address -= 44;
    else if (address >= 0x02199900 && address < 0x021e0000) address -= 64;
#endif
    return reinterpret_cast<F>(address | 1);
}
static u16 half(const u8* b) { return b[0] | (u16(b[1]) << 8); }
static u32 word(const u8* b) { return half(b) | (u32(half(b + 2)) << 16); }
static bool readRecord(u32 trainer, u8* record) {
    // Nitro FSFile is 0x48 bytes. Keep the same conservative 80-byte storage
    // used by the other standalone runtimes, with native initialization.
    u32 file[20];
    api<void(*)(void*)>(0x02070ca8)(file);
    if (!api<u32(*)(void*, const char*)>(0x02070ecc)(file, "rom:/battle/trainer-fields.bin")) return false;
    u8 header[16];
    bool valid = api<i32(*)(void*, void*, u32)>(0x02070e6c)(file, header, 16) == 16;
    if (valid) {
        const u32 count = word(header + 8);
        valid = word(header) == 0x43465750 && half(header + 4) == 1 && half(header + 6) == 12
            && word(header + 12) == 0 && count > 0 && count <= 65536 && trainer < count
            && api<u32(*)(void*)>(0x02070dec)(file) == 16 + count * 12;
    }
    if (valid) valid = api<u32(*)(void*, u32, u32)>(0x02070e54)(file, 16 + trainer * 12, 0)
        && api<i32(*)(void*, void*, u32)>(0x02070e6c)(file, record, 12) == 12;
    api<u32(*)(void*)>(0x02070de0)(file);
    return valid && record[0] <= 5 && record[1] == 0 && !(half(record + 2) & ~0xF6u)
        && !(half(record + 4) & ~0x393Fu) && !(half(record + 6) & ~0x393Fu)
        && record[8] <= 3 && record[9] <= 2 && record[10] <= 3 && record[11] <= 2;
}

extern "C" __attribute__((visibility("default"))) void* TrainerFieldStart(void* mainModule, void* serverFlow) {
    auto* setup = *static_cast<u8**>(mainModule);
    auto* field = setup + 8;
    // Facility, wild, link, online and demo battles retain their own rules.
    if (word(setup) != 1 || setup[0x20] != 0) return field;
    auto* enemy = *reinterpret_cast<u8**>(setup + 0x4C);
    if (!enemy) return field;
    u8 record[12];
    if (!readRecord(word(enemy), record)) return field;

    // This call site precedes retail opening weather and all switch-in
    // processing. A leading Drizzle/Drought/Sand Stream/Snow Warning wins.
    if (record[0]) {
        field[8] = record[0] - 1;
        if (record[0] == 1 && api<u32(*)()>(0x021d59f0)() != 0)
            api<void(*)(void*, u32, u32)>(0x021a76a8)(serverFlow, 0, 255);
    }
    const u32 permanent = api<u32(*)()>(0x021ce240)();
    const u32 fields = half(record + 2);
    for (u32 effect = 1; effect < 8; ++effect) {
        if (fields & (1u << effect)) api<u32(*)(u32, u32)>(0x021d5a34)(effect, permanent);
    }
    for (u32 side = 0; side < 2; ++side) {
        const u32 mask = half(record + 4 + side * 2);
        for (u32 effect = 0; effect < 14; ++effect) {
            u32 layers = (mask & (1u << effect)) ? 1 : 0;
            if (effect == 6) layers = record[8 + side * 2];
            if (effect == 7) layers = record[9 + side * 2];
            while (layers--) api<void*(*)(u32, u32, u32)>(0x06898c10)(side, effect, permanent);
        }
    }
    return field;
}

// Presentation is queued after initial placement/weather, before entry abilities.
// These are display commands only: no move executes and no PP is consumed.
static void openingAnimation(void* flow, u32 attacker, u32 target, u32 move) {
    void* queue = *reinterpret_cast<void**>(static_cast<u8*>(flow) + 12);
    api<void(*)(void*, u32, ...)>(0x021b1474)(queue, 0x30, attacker, target, move, 0, 0);
}
static void openingMessage(void* flow, u32 message, u32 mon = 24) {
    void* queue = *reinterpret_cast<void**>(static_cast<u8*>(flow) + 12);
    // Native standard messages (bank 19) already have paired side variants.
    // Trick Room uses a set message (bank 18) with an active Pokémon ID.
    if (mon < 24) api<void(*)(void*, u32, u32, ...)>(0x021b1610)(queue, 0x5B, message, mon, 0xFFFF0000u);
    else api<void(*)(void*, u32, u32, ...)>(0x021b1610)(queue, 0x5A, message, 0xFFFF0000u);
}
extern "C" __attribute__((visibility("default"))) u32 TrainerFieldFinish(void* serverFlow) {
    auto* mainModule = *reinterpret_cast<u8**>(static_cast<u8*>(serverFlow) + 4);
    auto* setup = *reinterpret_cast<u8**>(mainModule);
    auto* enemy = *reinterpret_cast<u8**>(setup + 0x4C);
    u8 record[12];
    if (word(setup) == 1 && setup[0x20] == 0 && enemy && readRecord(word(enemy), record)) {
        // Native IDs 0..11 belong to the player side and 12..23 to the enemy.
        // Resolve an actually active position; slot zero may have fainted in
        // the save, and triples/rotation use their own native placement.
        u32 positions[2] = {6, 6};
        u32 mons[2] = {24, 24};
        for (u32 mon = 0; mon < 24; ++mon) {
            const u32 side = mon < 12 ? 0 : 1;
            if (positions[side] < 6) continue;
            const u32 pos = api<u32(*)(void*, u32)>(0x021abb90)(serverFlow, mon);
            if (pos < 6) { positions[side] = pos; mons[side] = mon; }
        }
        static const u16 fieldMoves[8] = {0, 433, 356, 0, 346, 300, 472, 478};
        static const u16 sideMoves[14] = {115, 113, 219, 54, 366, 381, 191, 390, 446, 0, 0, 518, 519, 520};
        static const u16 fieldMessages[8] = {0, 857, 117, 0, 114, 115, 178, 180};
        static const u16 sideMessages[14] = {124, 128, 132, 136, 140, 144, 148, 152, 156, 0, 0, 164, 168, 172};
        const u32 fields = half(record + 2);
        const u32 wholeFieldPos = positions[0] < 6 ? positions[0] : positions[1];
        if (wholeFieldPos < 6) for (u32 effect = 1; effect < 8; ++effect) {
            if ((fields & (1u << effect)) && fieldMoves[effect]) {
                openingAnimation(serverFlow, wholeFieldPos, wholeFieldPos, fieldMoves[effect]);
                const u32 mon = mons[0] < 24 ? mons[0] : mons[1];
                // The set-message renderer selects the wild/foe variant itself.
                openingMessage(serverFlow, fieldMessages[effect], effect == 1 ? mon : 24);
            }
        }
        for (u32 side = 0; side < 2; ++side) {
            if (positions[side] >= 6) continue;
            const u32 mask = half(record + 4 + side * 2);
            for (u32 effect = 0; effect < 14; ++effect) {
                bool enabled = (mask & (1u << effect)) != 0;
                if (effect == 6) enabled = record[8 + side * 2] != 0;
                if (effect == 7) enabled = record[9 + side * 2] != 0;
                if (!enabled || !sideMoves[effect]) continue;
                // Hazards and Pledges point toward the affected side; screens
                // and support moves originate on that side.
                const bool targeted = effect >= 6;
                const u32 from = targeted && positions[side ^ 1] < 6 ? positions[side ^ 1] : positions[side];
                openingAnimation(serverFlow, from, positions[side], sideMoves[effect]);
                openingMessage(serverFlow, sideMessages[effect] + side);
            }
        }
    }
    // Preserve retail activation and its return value, including weather abilities.
    return api<u32(*)(void*)>(0x021a14e8)(serverFlow);
}
