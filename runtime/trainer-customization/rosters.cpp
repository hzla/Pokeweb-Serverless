#include "native.h"

static constexpr u32 NoRoster = 0xffff;
static constexpr u16 RetailRoster = 0xfffe;
static constexpr u32 PoolFlag = 0x8000;
static bool isPool(u32 source) { return source > PoolFlag && source <= PoolFlag + 0x3fff; }
static constexpr u32 TrainerLimit = 0x500;
static constexpr u32 MaxChoices = 32;
static constexpr u32 EntrySize = 6;

struct BattleRosters {
    const u8* setup;
    u16 source[2];
    TrainerPoolParty pool[2];
};
// One entry per live setup. The native reset and teardown calls release it.
static BattleRosters selections[8];

static int findSetup(const u8* setup) {
    for (unsigned index = 0; index < sizeof(selections) / sizeof(selections[0]); ++index)
        if (selections[index].setup == setup) return index;
    return -1;
}

u32 trainerRosterSource(const u8* setup, u32 client, u32 original, u32& slot, const u8*& direct, u32& memberKey) {
    const int index = findSetup(setup);
    memberKey = (original << 8) | slot;
    if (index < 0) return original;
    const u32 chosen = selections[index].source[client >> 1];
    if (isPool(chosen)) {
        const auto& pool = selections[index].pool[client >> 1];
        if (slot >= pool.size) return original;
        const auto& member = pool.members[slot];
        // A pool's own Pokémon keep their move pools under the pool; linked ones use their source slot's.
        if (!member.trainer()) {
            direct = member.bytes + 22;
            memberKey = (chosen << 8) | pool.index[slot];
        } else {
            memberKey = (member.trainer() << 8) | member.slot();
        }
        slot = member.slot();
        return member.trainer();
    }
    const u32 source = chosen >= RetailRoster ? original : chosen;
    memberKey = (source << 8) | slot;
    return source;
}

extern "C" void* ClearTrainerRosters(u8* setup, int value, u32 size) {
    const int index = findSetup(setup);
    if (index >= 0) selections[index].setup = nullptr;
    forgetRolledMoves(setup);
    const auto clear = reinterpret_cast<void*(*)(void*, int, u32)>(PARTY_FUNCTION(0x020787d4));
    return clear(setup, value, size);
}

static u32 pickRoster(const u8* choices, u32 choiceCount, u32 minimum) {
    u32 total = 0, eligible = 0, last = NoRoster;
    for (u32 index = 0; index < choiceCount; ++index) {
        auto* entry = choices + index * EntrySize;
        const u32 roster = half(entry), weight = half(entry + 2), size = entry[4];
        if ((!roster || roster >= TrainerLimit) && !isPool(roster)) return NoRoster;
        if (!weight || !size || size > 6 || entry[5]) return NoRoster;
        if (size < minimum) continue;
        total += weight;
        last = roster;
        ++eligible;
    }
    if (eligible <= 1) return last;
    u32 roll = thumb<u32(*)(u32)>(0x02005748)(total);
    for (u32 index = 0; index < choiceCount; ++index) {
        auto* entry = choices + index * EntrySize;
        if (entry[4] < minimum) continue;
        const u32 weight = half(entry + 2);
        if (roll < weight) return half(entry);
        roll -= weight;
    }
    return NoRoster;
}

static u32 rollRoster(u32 trainer, u32 minimum) {
    RomFile file;
    if (!file.open("rom:/battle/trainer-rosters.bin")) return NoRoster;
    u8 header[16];
    u8 offsets[8];
    u8 choices[MaxChoices * EntrySize];
    u32 choiceCount = 0;
    if (file.read(header, sizeof(header))) {
        const u32 trainers = word(header + 8);
        const u32 entries = word(header + 12);
        const u32 directoryEnd = sizeof(header) + (trainers + 1) * 4;
        if (word(header) == 0x52545750 && half(header + 4) == 1 && half(header + 6) == EntrySize
            && trainers <= TrainerLimit && trainer < trainers && entries <= trainers * MaxChoices
            && file.length() == directoryEnd + entries * EntrySize
            && file.seek(sizeof(header) + trainer * 4) && file.read(offsets, sizeof(offsets))) {
            const u32 start = word(offsets), end = word(offsets + 4);
            if (start < end && end <= entries && end - start <= MaxChoices
                && file.seek(directoryEnd + start * EntrySize) && file.read(choices, (end - start) * EntrySize))
                choiceCount = end - start;
        }
    }
    file.close();

    return pickRoster(choices, choiceCount, minimum);
}

enum ConditionKind { Species, TypeCount, HighestLevel, Starter };
static constexpr u32 MaxConditions = 8;
static constexpr u32 MaxRules = 8;
static constexpr u32 ConditionSize = 6;

struct PartyMember { u16 species; u8 level, type1, type2; };
struct PlayerState {
    PartyMember members[6];
    u32 count;
    int starter;
};

static PlayerState readPlayer(const u8* setup) {
    PlayerState player;
    player.count = 0;
    player.starter = -1;
    const auto* gameData = *reinterpret_cast<void* const*>(setup + 0x70);
    if (!gameData) return player;
    auto* party = thumb<const void*(*)(const void*)>(0x0201735c)(gameData);
    if (party) {
        const auto get = thumb<u32(*)(const void*, u32, void*)>(PARTY_FUNCTION(0x0201cd24));
        const auto member = thumb<const void*(*)(const void*, u32)>(PARTY_FUNCTION(0x0201ff34));
        const u32 count = thumb<u32(*)(const void*)>(PARTY_FUNCTION(0x0201fe24))(party);
        for (u32 i = 0; i < count && i < 6; ++i) {
            const auto* mon = member(party, i);
            const u32 species = get(mon, 5, nullptr);
            if (!species || get(mon, 0x4c, nullptr)) continue;
            auto& out = player.members[player.count++];
            out.species = species;
            out.level = get(mon, 0x9e, nullptr);
            out.type1 = get(mon, 0xae, nullptr);
            out.type2 = get(mon, 0xaf, nullptr);
        }
    }
    const auto* work = thumb<const void*(*)(const void*)>(0x02017394)(gameData);
    // Bianca sets this flag when the starter is received. The choice variable
    // is initially zero, which is also the first starter's index.
    if (work && thumb<u32(*)(const void*, u32)>(PARTY_FUNCTION(0x020191d8))(work, 0x961)) {
        const auto* value = thumb<const u16*(*)(const void*, u32)>(PARTY_FUNCTION(0x020192c0))(work, 0x4030);
        if (*value <= 2) player.starter = *value;
    }
    return player;
}

static bool comparison(u32 actual, u32 op, u32 expected) {
    switch (op) {
    case 0: return actual == expected;
    case 1: return actual != expected;
    case 2: return actual < expected;
    case 3: return actual <= expected;
    case 4: return actual > expected;
    case 5: return actual >= expected;
    default: return false;
    }
}

// -1 denotes a malformed condition so an Any group cannot mask it.
static int matches(const PlayerState& player, const u8* condition) {
    const u32 op = condition[1], subject = half(condition + 2), value = half(condition + 4);
    switch (condition[0]) {
    case Species: {
        if (op > 1 || !subject || value) return -1;
        bool found = false;
        for (u32 i = 0; i < player.count; ++i)
            if (player.members[i].species == subject) found = true;
        return op == 0 ? found : !found;
    }
    case TypeCount: {
        if (op > 5 || subject > 17 || value > 6) return -1;
        u32 count = 0;
        for (u32 i = 0; i < player.count; ++i) {
            const auto& mon = player.members[i];
            if (mon.type1 == subject || mon.type2 == subject) ++count;
        }
        return comparison(count, op, value);
    }
    case HighestLevel: {
        if (op > 5 || subject || !value || value > 100) return -1;
        u32 level = 0;
        for (u32 i = 0; i < player.count; ++i)
            if (player.members[i].level > level) level = player.members[i].level;
        return player.count && comparison(level, op, value);
    }
    case Starter:
        if (op > 1 || subject || value > 2) return -1;
        return player.starter >= 0 && comparison(player.starter, op, value);
    default:
        return -1;
    }
}

static u32 matchRules(RomFile& file, u32 start, u32 end, u32 minimum, const u8* setup) {
    u8 conditions[MaxConditions * ConditionSize];
    u8 choices[MaxChoices * EntrySize];
    const PlayerState player = readPlayer(setup);
    for (u32 rule = 0; rule < MaxRules && start < end; ++rule) {
        u8 header[4];
        if (end - start < sizeof(header) || !file.seek(start) || !file.read(header, sizeof(header))) return NoRoster;
        const u32 conditionsSize = header[0] * ConditionSize;
        const u32 choicesSize = header[1] * EntrySize;
        const u32 size = sizeof(header) + conditionsSize + choicesSize;
        if (!header[0] || header[0] > MaxConditions || !header[1] || header[1] > MaxChoices
            || header[2] > 1 || header[3] || size > end - start || !file.read(conditions, conditionsSize))
            return NoRoster;
        u32 matched = 0;
        for (u32 i = 0; i < header[0]; ++i) {
            const int result = matches(player, conditions + i * ConditionSize);
            if (result < 0) return NoRoster;
            matched += result;
        }
        if (header[2] ? matched > 0 : matched == header[0]) {
            if (!file.read(choices, choicesSize)) return NoRoster;
            const u32 roster = pickRoster(choices, header[1], minimum);
            if (roster != NoRoster) return roster;
        }
        start += size;
    }
    return NoRoster;
}

static u32 conditionalRoster(u32 trainer, u32 minimum, const u8* setup) {
    RomFile file;
    if (!file.open("rom:/battle/trainer-roster-rules.bin")) return NoRoster;
    u8 header[16];
    u8 offsets[8];
    u32 result = NoRoster;
    if (file.read(header, sizeof(header))) {
        const u32 trainers = word(header + 8);
        const u32 payload = word(header + 12);
        if (word(header) == 0x43525750 && half(header + 4) == 1 && half(header + 6) == 0
            && trainers <= TrainerLimit && trainer < trainers) {
            const u32 directoryEnd = sizeof(header) + (trainers + 1) * 4;
            if (payload <= trainers * MaxRules * (4 + MaxConditions * ConditionSize + MaxChoices * EntrySize)
                && file.length() == directoryEnd + payload
                && file.seek(sizeof(header) + trainer * 4) && file.read(offsets, sizeof(offsets))) {
                const u32 start = word(offsets), end = word(offsets + 4);
                if (start < end && end <= payload)
                    result = matchRules(file, directoryEnd + start, directoryEnd + end, minimum, setup);
            }
        }
    }
    file.close();
    return result;
}

static u32 minimumPartySize(const u8* setup, u32 caller) {
    const u32 style = word(setup + 4);
    if (style == 2 || style == 3) return 3; // Triples and rotation.
    // Both multi-trainer setup routines have the same addresses in US BW2.
    const bool twoOpponents = caller >= 0x0201835c && caller < 0x0201840c;
    return style == 1 && !twoOpponents ? 2 : 1;
}

extern "C" void LoadTrainerRoster(u32 original, void* party, u32 heap, u8* setup, u32 client, u32 caller) {
    const auto load = thumb<void(*)(u32, void*, u32)>(PARTY_FUNCTION(0x020308ec));
    if (word(setup) != 1 || setup[0x20] != 0 || (client != 1 && client != 3)) {
        load(original, party, heap);
        return;
    }
    const auto* trainer = trainerSetup(setup, client);
    if (!trainer) {
        load(original, party, heap);
        return;
    }
    int index = findSetup(setup);
    if (index < 0) {
        index = findSetup(nullptr);
        if (index >= 0) {
            selections[index].setup = setup;
            // Each opponent resolves its own choice when its party is built.
            selections[index].source[0] = NoRoster;
            selections[index].source[1] = NoRoster;
        }
    }
    if (index < 0) {
        load(original, party, heap);
        return;
    }
    auto& choice = selections[index].source[client >> 1];
    auto& pool = selections[index].pool[client >> 1];
    if (choice == NoRoster) {
        const u32 minimum = minimumPartySize(setup, caller);
        const u32 trainerId = word(trainer);
        u32 chosen = conditionalRoster(trainerId, minimum, setup);
        if (isPool(chosen) && !selectTrainerPool(chosen - PoolFlag, trainerId, minimum, pool)) chosen = NoRoster;
        if (chosen == NoRoster) {
            chosen = rollRoster(trainerId, minimum);
            if (isPool(chosen) && !selectTrainerPool(chosen - PoolFlag, trainerId, minimum, pool)) chosen = NoRoster;
        }
        choice = chosen == NoRoster ? RetailRoster : chosen;
    }
    if (isPool(choice)) {
        if (buildTrainerPool(pool, original, party, heap)) return;
        choice = RetailRoster;
    }
    load(choice == RetailRoster ? original : choice, party, heap);
}
