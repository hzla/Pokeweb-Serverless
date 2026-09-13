#include "swan/swantypes.h"
#include "w2u_battle_log.h"
#include "w2u_menu_evolution_logic.h"
#include "w2u_menu_relearn_logic.h"

namespace {

constexpr u32 kEvolutionArcId = 19;
constexpr u32 kEvolutionRecordSizeRetail = 42;
constexpr u32 kEvolutionRecordSizeExpanded = 48;
constexpr u32 kMaxPartyMenuItems = 8;
constexpr u32 kPartyMenuEnd = 16;
constexpr u32 kPartyMenuClose = 6;
constexpr u32 kPartyMenuEvolve = 11;
// PMIT_LEAVE is accepted by the retail menu builder but is otherwise used
// only in daycare mode. Do not alias Mail Read/Give, which field menus use.
constexpr u32 kPartyMenuRelearn = 7;
constexpr u32 kPartyModeField = 0;
constexpr u32 kPartyReturnLevelEvolution = 9;
constexpr u32 kPartyMainFadeOut = 19;
constexpr u32 kEvolutionConditionLevel = 4;
constexpr u32 kEvolutionMethodKoCount = 29;
constexpr u32 kEvolutionCheckTypeLevel = 0;
constexpr u32 kBattleCompetitorTrainer = 1;
constexpr u32 kBattleResultPlayerPartyOffset = 0x24;
constexpr u32 kBattleResultOutcomeOffset = 0xa8;
constexpr u32 kBattleResultWin = 1;
constexpr u32 kProcessPokeList = 0;
constexpr u32 kProcessBag = 2;
constexpr u32 kProcessReturn = 0;
constexpr u32 kProcessNext = 4;
constexpr u32 kTakeoverEvolutionItem = 3;
constexpr u32 kTakeoverEvolutionLevel = 4;
constexpr u32 kPk5ParamSpecies = 5;
constexpr u32 kPk5ParamForm = 0x6f;
constexpr u32 kPk5ParamLevel = 158;
constexpr u32 kPk5FastModeFlag = 1u << 1;
constexpr u32 kPk5EggFlag = 1u << 30;
constexpr u32 kPk5EncryptedBytes = 128;
constexpr u32 kPk5Words = kPk5EncryptedBytes / sizeof(u16);
constexpr u32 kPk5ParamMove1 = 54;
constexpr u32 kMoveArcId = 21;
constexpr u32 kMoveReminderOverlay = 258;
constexpr u32 kEventHeap = 4;
constexpr u32 kProcLinkWorkSize = 0x7c;
constexpr char kLevelLearnsetPath[] = "a/0/1/8";
constexpr char kKoLearnsetPath[] = "battlelog_ko/learnsets.narc";

constexpr u32 kWorkMainSeqOffset = 0x0c;
constexpr u32 kWorkCursorOffset = 0x30;
constexpr u32 kWorkSelectedPokemonOffset = 0x3c;
constexpr u32 kWorkMenuResultOffset = 0x40;
constexpr u32 kWorkMessageHandleOffset = 0x138;
constexpr u32 kWorkPartyDataOffset = 0x28c;
constexpr u32 kPartyDataModeOffset = 0x44;
constexpr u32 kPartyDataReturnSlotOffset = 0x4c;
constexpr u32 kPartyDataReturnModeOffset = 0x50;
constexpr u32 kPartyDataAfterSpeciesOffset = 0x64;
constexpr u32 kPartyDataEvolutionConditionOffset = 0x68;
constexpr u32 kProcessNowTypeOffset = 0x04;
constexpr u32 kProcessNextTypeOffset = 0x0c;
constexpr u32 kProcessTakeoverModeOffset = 0x70;
constexpr u32 kBattleReturnEvolutionBitsOffset = 0x3a;
constexpr u32 kBattleReturnHeapIdOffset = 0x3c;

struct Pk5CoreView {
    u32 pid;
    u16 sanityFlags;
    u16 checksum;
    u8 encryptedData[kPk5EncryptedBytes];
};

static_assert(sizeof(Pk5CoreView) == 136,
    "Gen 5 boxed Pokemon core must remain 136 bytes");

using PokemonEvolutionSnapshot = W2UMenuEvolutionSnapshot;

struct MenuEvolutionConfig {
    u8 magic[8];
    u16 version;
    u16 messageId;
    u16 messageIdXor;
    u16 relearnMessageId;
    u16 relearnMessageIdXor;
    u16 reserved;
};

static_assert(sizeof(MenuEvolutionConfig) == 20, "Party command config v2 size");

// Retail WAZAOSHIE_DATA, shared by the NPC and our field-menu entry point.
struct MoveReminderData {
    void* pokemon;
    void* trainer;
    void* config;
    void* gameSystem;
    u16* moves;
    u16 cursor;
    u16 scroll;
    u8 page;
    u8 mode;
    u8 result;
    u8 deletedSlot;
};
static_assert(sizeof(MoveReminderData) == 28, "BW2 move reminder parameter size");
static_assert(__builtin_offsetof(MoveReminderData, moves) == 0x10, "Tutor moves offset");
static_assert(__builtin_offsetof(MoveReminderData, mode) == 0x19, "Tutor mode offset");

// Extend only our event's allocation; the retail 0x7c-byte prefix is untouched.
// Keeping state per event avoids a stale global request leaking to another menu.
struct RelearnEventWork {
    u8 retail[kProcLinkWorkSize];
    MoveReminderData* reminder;
    u32 restoreSlot; // 0xffffffff unless reopening the selected Pokemon's menu.
};
static_assert(__builtin_offsetof(RelearnEventWork, reminder) == 0x7c, "Event extension offset");
static_assert(sizeof(RelearnEventWork) == 0x84, "Extended party-link event size");

extern "C" {
__attribute__((used, section(".menu_evolution_config")))
volatile MenuEvolutionConfig gMenuEvolutionConfig = {
    {'M', 'E', 'V', 'O', 'M', 'S', 'G', 0},
    2,
    0xffff,
    0,
    0xffff,
    0,
    0,
};
}

using PkmDecryptFn = b32 (*)(void*);
using PkmReEncryptFn = b32 (*)(void*, b32);
using PkmCryptoRunFn = void (*)(void*, u32, u32);
using PkmGetBlockFn = void* (*)(void*, u32, int);
using PokemonGetFn = u32 (*)(void*, u32, void*);
using PersonalDataIdFn = u32 (*)(u32, u32);
using ArcOpenFn = void* (*)(u32, u32);
using ArcFreeFn = void (*)(void*);
using ArcReadFn = void (*)(void*, u32, void*);
using ArcSizeFn = u32 (*)(void*, u32);
using ArcCountFn = u32 (*)(void*);
using CreateStringFn = void* (*)(void*, u32);
using CheckFieldMoveFn = u32 (*)(void*, u32);
using OpenPartyMenuFn = void (*)(void*, void*, u32*);
using CreateMenuStringFn = void* (*)(void*, void*, u32);
using SelectMenuExitFn = void (*)(void*);
using CheckEvolutionFn = u16 (*)(void*, void*, u32, u32, u8, u32*, u32);
using CheckLevelUpPokemonFn = void (*)(void*, void*);
using GameDataGetPartyFn = void* (*)(void*);
using PartyGetCountFn = u32 (*)(void*);
using PartyGetMemberFn = void* (*)(void*, u32);
using HeapAllocFn = void* (*)(u32, u32);
using HeapFreeFn = void (*)(void*);
using FsInitFn = void (*)(void*);
using FsOpenFn = b32 (*)(void*, const char*);
using FsCloseFn = b32 (*)(void*);
using ArcInitFn = void (*)(void*);
using ProcLinkEventFn = u32 (*)(void*, int*, void*);
using CreateEventFn = void* (*)(void*, void*, ProcLinkEventFn, u32);
using EventDataFn = void* (*)(void*);
using GameSystemDataFn = void* (*)(void*);
using QueueProcFn = void (*)(void*, u32, const void*, void*);

// These ARM9 addresses precede the B2/W2 divergence and match both binaries.
constexpr uintptr_t kCreateEventAddress = 0x02016CB5;
constexpr uintptr_t kEventDataAddress = 0x02016EDD;
constexpr uintptr_t kGameSystemDataAddress = 0x02016AD9;
constexpr uintptr_t kGameDataTrainerAddress = 0x0201736D;
constexpr uintptr_t kQueueProcAddress = 0x02016A99;

#if defined(W2U_TARGET_B2)
constexpr uintptr_t kPkmDecryptAddress = 0x0201CC99;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCC1;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ECDD;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEC5;
constexpr uintptr_t kPokemonGetAddress = 0x0201CCF9;
constexpr uintptr_t kPersonalDataIdAddress = 0x02020481;
constexpr uintptr_t kArcOpenAddress = 0x0204AA31;
constexpr uintptr_t kArcFreeAddress = 0x0204AB0D;
constexpr uintptr_t kArcReadAddress = 0x0204ABA5;
constexpr uintptr_t kArcSizeAddress = 0x0204AC0D;
constexpr uintptr_t kArcCountAddress = 0x0204AD81;
constexpr uintptr_t kCreateStringAddress = 0x0204898D;
constexpr uintptr_t kCheckFieldMoveAddress = 0x0219D9B9;
constexpr uintptr_t kOpenPartyMenuAddress = 0x0219FB55;
constexpr uintptr_t kCreateMenuStringAddress = 0x0219FE11;
constexpr uintptr_t kSelectMenuExitAddress = 0x0219CFE5;
constexpr uintptr_t kCheckEvolutionAddress = 0x02020789;
constexpr uintptr_t kCheckLevelUpPokemonAddress = 0x0219D321;
constexpr uintptr_t kGameDataGetPartyAddress = 0x0201735D;
constexpr uintptr_t kPartyGetCountAddress = 0x0201FDF9;
constexpr uintptr_t kPartyGetMemberAddress = 0x0201FF09;
constexpr uintptr_t kHeapAllocAddress = 0x02039D9D;
constexpr uintptr_t kHeapFreeAddress = 0x0203A24D;
constexpr uintptr_t kFsInitAddress = 0x02070C7D;
constexpr uintptr_t kFsOpenAddress = 0x02070EA1;
constexpr uintptr_t kFsCloseAddress = 0x02070DB5;
constexpr uintptr_t kArcInitAddress = 0x0204AA9D;
constexpr uintptr_t kProcLinkEventAddress = 0x0215B50D;
constexpr uintptr_t kMoveReminderProcDataAddress = 0x0219B9A8;
#else
constexpr uintptr_t kPkmDecryptAddress = 0x0201CCC5;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCED;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ED09;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEF1;
constexpr uintptr_t kPokemonGetAddress = 0x0201CD25;
constexpr uintptr_t kPersonalDataIdAddress = 0x020204AD;
constexpr uintptr_t kArcOpenAddress = 0x0204AA5D;
constexpr uintptr_t kArcFreeAddress = 0x0204AB39;
constexpr uintptr_t kArcReadAddress = 0x0204ABD1;
constexpr uintptr_t kArcSizeAddress = 0x0204AC39;
constexpr uintptr_t kArcCountAddress = 0x0204ADAD;
constexpr uintptr_t kCreateStringAddress = 0x020489B9;
constexpr uintptr_t kCheckFieldMoveAddress = 0x0219D9F9;
constexpr uintptr_t kOpenPartyMenuAddress = 0x0219FB95;
constexpr uintptr_t kCreateMenuStringAddress = 0x0219FE51;
constexpr uintptr_t kSelectMenuExitAddress = 0x0219D025;
constexpr uintptr_t kCheckEvolutionAddress = 0x020207B5;
constexpr uintptr_t kCheckLevelUpPokemonAddress = 0x0219D361;
constexpr uintptr_t kGameDataGetPartyAddress = 0x0201735D;
constexpr uintptr_t kPartyGetCountAddress = 0x0201FE25;
constexpr uintptr_t kPartyGetMemberAddress = 0x0201FF35;
constexpr uintptr_t kHeapAllocAddress = 0x02039DC9;
constexpr uintptr_t kHeapFreeAddress = 0x0203A279;
constexpr uintptr_t kFsInitAddress = 0x02070CA9;
constexpr uintptr_t kFsOpenAddress = 0x02070ECD;
constexpr uintptr_t kFsCloseAddress = 0x02070DE1;
constexpr uintptr_t kArcInitAddress = 0x0204AAC9;
constexpr uintptr_t kProcLinkEventAddress = 0x0215B54D;
constexpr uintptr_t kMoveReminderProcDataAddress = 0x0219B9E8;
#endif

static void* gPendingPokemon;
static u16 gPendingSpecies;
static W2UMenuPostBattleEvolution gPostBattleEvolution;
static bool gMenuEvolutionReturning;

static u16 ReadU16(const u8* data)
{
    return static_cast<u16>(data[0] | (data[1] << 8));
}

static u32 ReadU32(const u8* data)
{
    return static_cast<u32>(data[0])
        | (static_cast<u32>(data[1]) << 8)
        | (static_cast<u32>(data[2]) << 16)
        | (static_cast<u32>(data[3]) << 24);
}

static u16 Pk5Checksum(const u8* data)
{
    const u16* words = reinterpret_cast<const u16*>(data);
    u16 checksum = 0;
    for (u32 index = 0; index < kPk5Words; ++index) {
        checksum = static_cast<u16>(checksum + words[index]);
    }
    return checksum;
}

static bool ConfiguredMessageId(u16* messageId, bool relearn = false)
{
    const u16 configured = relearn
        ? gMenuEvolutionConfig.relearnMessageId : gMenuEvolutionConfig.messageId;
    const u16 complement = relearn
        ? gMenuEvolutionConfig.relearnMessageIdXor : gMenuEvolutionConfig.messageIdXor;
    if (gMenuEvolutionConfig.version != 2
        || configured == 0xffff
        || static_cast<u16>(configured ^ 0xffff) != complement) {
        return false;
    }
    *messageId = configured;
    return true;
}

static bool ReadPokemonSnapshot(void* partyPokemon, PokemonEvolutionSnapshot* snapshot)
{
    if (!partyPokemon || !snapshot) {
        return false;
    }

    Pk5CoreView* pokemon = reinterpret_cast<Pk5CoreView*>(partyPokemon);
    const u16 originalSanityFlags = pokemon->sanityFlags;
    const u16 originalChecksum = pokemon->checksum;
    const bool wasAlreadyDecrypted =
        (originalSanityFlags & kPk5FastModeFlag) != 0;
    const b32 decryptedByCaller =
        reinterpret_cast<PkmDecryptFn>(kPkmDecryptAddress)(pokemon);

    if (Pk5Checksum(pokemon->encryptedData) != originalChecksum) {
        if (!wasAlreadyDecrypted) {
            pokemon->sanityFlags = originalSanityFlags;
            reinterpret_cast<PkmCryptoRunFn>(kPkmCryptoRunAddress)(
                pokemon->encryptedData,
                kPk5EncryptedBytes,
                originalChecksum);
        } else {
            reinterpret_cast<PkmReEncryptFn>(kPkmReEncryptAddress)(
                pokemon, decryptedByCaller);
        }
        return false;
    }

    u8* blockA = static_cast<u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, 0));
    u8* blockB = static_cast<u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, 1));
    u8* blockC = static_cast<u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, 2));
    const bool valid = blockA && blockB && blockC
        && ReadU16(blockA) != 0
        && (ReadU32(blockB + 0x10) & kPk5EggFlag) == 0;

    if (valid) {
        PokemonGetFn get = reinterpret_cast<PokemonGetFn>(kPokemonGetAddress);
        snapshot->species = static_cast<u16>(get(partyPokemon, kPk5ParamSpecies, 0));
        snapshot->form = static_cast<u16>(get(partyPokemon, kPk5ParamForm, 0));
        snapshot->level = static_cast<u16>(get(partyPokemon, kPk5ParamLevel, 0));
        snapshot->battlesBrought = ReadU16(blockB + 0x1c);
        snapshot->battlesUsed = ReadU16(blockB + 0x1e);
        snapshot->kos = W2U_ReadPk5KoCounter(
            reinterpret_cast<const W2UPk5BattleCounterBlockB*>(blockB),
            reinterpret_cast<const W2UPk5BattleCounterBlockC*>(blockC));
    }

    reinterpret_cast<PkmReEncryptFn>(kPkmReEncryptAddress)(
        pokemon, decryptedByCaller);
    return valid && snapshot->species != 0;
}

static u32 AppendRelearnArchive(
    u16* moves, u32 count, const char* path, u32 personalId,
    u16 threshold, const u16 known[4], u32 moveCount)
{
    // ArcTool = 72-byte Nitro FSFile plus 8 bytes of NARC metadata. Opening
    // by path avoids assigning a new global archive ID to the optional NARC.
    u32 arc[20] = {};
    reinterpret_cast<FsInitFn>(kFsInitAddress)(arc);
    if (!reinterpret_cast<FsOpenFn>(kFsOpenAddress)(arc, path)) return count;
    reinterpret_cast<ArcInitFn>(kArcInitAddress)(arc);
    const u32 members = reinterpret_cast<ArcCountFn>(kArcCountAddress)(arc);
    if (personalId < members) {
        const u32 size = reinterpret_cast<ArcSizeFn>(kArcSizeAddress)(arc, personalId);
        if (size >= 4 && size <= W2U_RELEARN_RECORD_BYTES && (size & 3) == 0) {
            u8 record[W2U_RELEARN_RECORD_BYTES];
            reinterpret_cast<ArcReadFn>(kArcReadAddress)(arc, personalId, record);
            count = W2URelearnAppend(moves, count, record, size,
                threshold, known, moveCount);
        }
    }
    reinterpret_cast<FsCloseFn>(kFsCloseAddress)(arc);
    return count;
}

static u32 BuildRelearnMoves(void* pokemon, u32 heapId, u16* moves)
{
    moves[0] = W2U_RELEARN_END;
    PokemonEvolutionSnapshot snapshot = {};
    if (!ReadPokemonSnapshot(pokemon, &snapshot)) return 0;
    void* arc = reinterpret_cast<ArcOpenFn>(kArcOpenAddress)(kMoveArcId, heapId);
    if (!arc) return 0;
    const u32 moveCount = reinterpret_cast<ArcCountFn>(kArcCountAddress)(arc);
    reinterpret_cast<ArcFreeFn>(kArcFreeAddress)(arc);
    const u32 personalId = reinterpret_cast<PersonalDataIdFn>(
        kPersonalDataIdAddress)(snapshot.species, snapshot.form);
    u16 known[4];
    for (u32 i = 0; i < 4; ++i) {
        known[i] = reinterpret_cast<PokemonGetFn>(kPokemonGetAddress)(
            pokemon, kPk5ParamMove1 + i, 0);
    }
    const u32 count = AppendRelearnArchive(moves, 0, kLevelLearnsetPath,
        personalId, snapshot.level, known, moveCount);
    return AppendRelearnArchive(moves, count, kKoLearnsetPath,
        personalId, snapshot.kos, known, moveCount);
}

static u16 ResolveEvolution(
    void* partyPokemon,
    u32 heapId,
    u16 requiredMethod = 0)
{
    PokemonEvolutionSnapshot snapshot = {};
    if (!ReadPokemonSnapshot(partyPokemon, &snapshot)) {
        return 0;
    }

    void* handle = reinterpret_cast<ArcOpenFn>(kArcOpenAddress)(
        kEvolutionArcId, heapId);
    if (!handle) {
        return 0;
    }

    const u32 memberCount = reinterpret_cast<ArcCountFn>(kArcCountAddress)(handle);
    const u32 personalId = reinterpret_cast<PersonalDataIdFn>(
        kPersonalDataIdAddress)(snapshot.species, snapshot.form);
    if (personalId >= memberCount) {
        reinterpret_cast<ArcFreeFn>(kArcFreeAddress)(handle);
        return 0;
    }

    const u32 size = reinterpret_cast<ArcSizeFn>(kArcSizeAddress)(
        handle, personalId);
    if (size != kEvolutionRecordSizeRetail
        && size != kEvolutionRecordSizeExpanded) {
        reinterpret_cast<ArcFreeFn>(kArcFreeAddress)(handle);
        return 0;
    }

    u8 evolution[kEvolutionRecordSizeExpanded] = {};
    reinterpret_cast<ArcReadFn>(kArcReadAddress)(handle, personalId, evolution);
    reinterpret_cast<ArcFreeFn>(kArcFreeAddress)(handle);

    return W2UMenuEvolutionResolveRecord(
        evolution, size, memberCount, snapshot, requiredMethod);
}

static void CheckLevelUpPokemonHook(void* work, void* rawParameter)
{
    W2UMenuPostBattleEvolutionClear(gPostBattleEvolution);
    reinterpret_cast<CheckLevelUpPokemonFn>(kCheckLevelUpPokemonAddress)(
        work, rawParameter);

    if (!work || !rawParameter) {
        return;
    }

    void* gameData = *reinterpret_cast<void**>(rawParameter);
    u8* battleResult = *reinterpret_cast<u8**>(
        static_cast<u8*>(rawParameter) + 4);
    if (!gameData || !battleResult
        || *reinterpret_cast<u32*>(battleResult) != kBattleCompetitorTrainer
        || *reinterpret_cast<u32*>(battleResult + kBattleResultOutcomeOffset)
            != kBattleResultWin) {
        return;
    }

    void* oldParty = reinterpret_cast<GameDataGetPartyFn>(
        kGameDataGetPartyAddress)(gameData);
    void* newParty = *reinterpret_cast<void**>(
        battleResult + kBattleResultPlayerPartyOffset);
    if (!oldParty || !newParty) {
        return;
    }

    PartyGetCountFn getCount = reinterpret_cast<PartyGetCountFn>(
        kPartyGetCountAddress);
    PartyGetMemberFn getMember = reinterpret_cast<PartyGetMemberFn>(
        kPartyGetMemberAddress);
    u32 count = getCount(oldParty);
    const u32 newCount = getCount(newParty);
    if (count > newCount) {
        count = newCount;
    }
    if (count > W2U_BATTLE_LOG_PARTY_SLOTS) {
        count = W2U_BATTLE_LOG_PARTY_SLOTS;
    }

    u16* evolutionBits = reinterpret_cast<u16*>(
        static_cast<u8*>(work) + kBattleReturnEvolutionBitsOffset);
    const u32 heapId = *reinterpret_cast<u16*>(
        static_cast<u8*>(work) + kBattleReturnHeapIdOffset);
    for (u32 slot = 0; slot < count; ++slot) {
        void* oldPokemon = getMember(oldParty, slot);
        void* newPokemon = getMember(newParty, slot);
        PokemonEvolutionSnapshot oldSnapshot = {};
        PokemonEvolutionSnapshot newSnapshot = {};
        if (!ReadPokemonSnapshot(oldPokemon, &oldSnapshot)
            || !ReadPokemonSnapshot(newPokemon, &newSnapshot)
            || newSnapshot.kos <= oldSnapshot.kos) {
            continue;
        }
        const u16 target = ResolveEvolution(newPokemon, heapId, kEvolutionMethodKoCount);
        if (target != 0) {
            W2UMenuPostBattleEvolutionQueue(gPostBattleEvolution, slot, oldPokemon, target);
            *evolutionBits = static_cast<u16>(*evolutionBits | (1u << slot));
        }
    }
}

// Battle return has its own SHINKA_Check call in overlay 166; it never uses
// the overlay-12 field-menu handoff. Resolve only the requests collected above
// before retail copied the result party back into the persistent party.
static u16 CheckPostBattleEvolutionHook(
    void* party, void* pokemon, u32 type, u32 parameter, u8 season,
    u32* condition, u32 heapId)
{
    const u16 retailTarget = reinterpret_cast<CheckEvolutionFn>(kCheckEvolutionAddress)(
        party, pokemon, type, parameter, season, condition, heapId);
    return W2UMenuPostBattleEvolutionTake(
        gPostBattleEvolution, pokemon, retailTarget, type, condition);
}

static u8* Bytes(void* pointer)
{
    return static_cast<u8*>(pointer);
}

static u32 ReadWorkU32(void* work, u32 offset)
{
    return *reinterpret_cast<u32*>(Bytes(work) + offset);
}

static void WriteWorkU32(void* work, u32 offset, u32 value)
{
    *reinterpret_cast<u32*>(Bytes(work) + offset) = value;
}

static bool IsFieldPartyMenu(void* work)
{
    if (!work) {
        return false;
    }
    void* partyData = reinterpret_cast<void*>(ReadWorkU32(work, kWorkPartyDataOffset));
    return partyData
        && ReadWorkU32(partyData, kPartyDataModeOffset) == kPartyModeField;
}

static u32 MenuCapacity(void* pokemon)
{
    u32 fieldMoveCount = 0;
    CheckFieldMoveFn check = reinterpret_cast<CheckFieldMoveFn>(
        kCheckFieldMoveAddress);
    for (u32 slot = 0; slot < 4; ++slot) {
        if (check(pokemon, slot) != 0) {
            ++fieldMoveCount;
        }
    }
    return W2URelearnMenuSpace(fieldMoveCount);
}

static bool AppendPartyItem(u32* itemArray, u32 item)
{
    if (!itemArray) {
        return false;
    }
    for (u32 index = 0; index + 2 < kMaxPartyMenuItems; ++index) {
        if (itemArray[index] == kPartyMenuClose
            && itemArray[index + 1] == kPartyMenuEnd) {
            itemArray[index] = item;
            itemArray[index + 1] = kPartyMenuClose;
            itemArray[index + 2] = kPartyMenuEnd;
            return true;
        }
    }
    return false;
}

static void OpenPartyMenuHook(void* work, void* menuWork, u32* itemArray)
{
    u16 messageId;
    if (IsFieldPartyMenu(work)) {
        void* pokemon = reinterpret_cast<void*>(
            ReadWorkU32(work, kWorkSelectedPokemonOffset));
        const u32 heapId = ReadWorkU32(work, 0);
        u32 space = pokemon ? MenuCapacity(pokemon) : 0;
        if (space && ConfiguredMessageId(&messageId)
            && ResolveEvolution(pokemon, heapId) != 0
            && AppendPartyItem(itemArray, kPartyMenuEvolve)) {
            --space;
        }
        if (space && ConfiguredMessageId(&messageId, true)) {
            u16 moves[W2U_RELEARN_MAX_MOVES + 1];
            if (BuildRelearnMoves(pokemon, heapId, moves)) {
                AppendPartyItem(itemArray, kPartyMenuRelearn);
            }
        }
    }
    reinterpret_cast<OpenPartyMenuFn>(kOpenPartyMenuAddress)(
        work, menuWork, itemArray);
}

static void* CreateMenuStringHook(void* work, void* menuWork, u32 type)
{
    u16 messageId;
    if ((type == kPartyMenuEvolve || type == kPartyMenuRelearn)
        && IsFieldPartyMenu(work)
        && ConfiguredMessageId(&messageId, type == kPartyMenuRelearn)) {
        void* messageHandle = reinterpret_cast<void*>(
            ReadWorkU32(work, kWorkMessageHandleOffset));
        return reinterpret_cast<CreateStringFn>(kCreateStringAddress)(
            messageHandle, messageId);
    }
    return reinterpret_cast<CreateMenuStringFn>(kCreateMenuStringAddress)(
        work, menuWork, type);
}

static void SelectMenuExitHook(void* work)
{
    if (IsFieldPartyMenu(work)
        && ReadWorkU32(work, kWorkMenuResultOffset) == kPartyMenuRelearn) {
        void* partyData = reinterpret_cast<void*>(ReadWorkU32(work, kWorkPartyDataOffset));
        *reinterpret_cast<u8*>(Bytes(work) + kWorkMainSeqOffset) = kPartyMainFadeOut;
        WriteWorkU32(partyData, kPartyDataReturnSlotOffset, ReadWorkU32(work, kWorkCursorOffset));
        WriteWorkU32(partyData, kPartyDataReturnModeOffset, W2U_RELEARN_PARTY_RETURN);
        return;
    }
    if (IsFieldPartyMenu(work)
        && ReadWorkU32(work, kWorkMenuResultOffset) == kPartyMenuEvolve) {
        void* pokemon = reinterpret_cast<void*>(
            ReadWorkU32(work, kWorkSelectedPokemonOffset));
        const u32 heapId = ReadWorkU32(work, 0);
        const u16 target = ResolveEvolution(pokemon, heapId);
        if (target != 0) {
            void* partyData = reinterpret_cast<void*>(
                ReadWorkU32(work, kWorkPartyDataOffset));
            const u32 cursor = ReadWorkU32(work, kWorkCursorOffset);
            *reinterpret_cast<u8*>(Bytes(work) + kWorkMainSeqOffset) =
                kPartyMainFadeOut;
            WriteWorkU32(partyData, kPartyDataReturnSlotOffset, cursor);
            WriteWorkU32(partyData, kPartyDataReturnModeOffset,
                kPartyReturnLevelEvolution);
            *reinterpret_cast<u16*>(Bytes(partyData)
                + kPartyDataAfterSpeciesOffset) = target;
            WriteWorkU32(partyData, kPartyDataEvolutionConditionOffset,
                kEvolutionConditionLevel);
            gPendingPokemon = pokemon;
            gPendingSpecies = target;
            gMenuEvolutionReturning = true;
            return;
        }
    }
    reinterpret_cast<SelectMenuExitFn>(kSelectMenuExitAddress)(work);
}

static void ReopenPartyMenu(void* work, int* sequence)
{
    // Keep the old PLIST_DATA until the retail SEQ_PROC_CALL frees it, using
    // the same release callback as any normal party-to-party transition.
    WriteWorkU32(work, kProcessNowTypeOffset, kProcessPokeList);
    WriteWorkU32(work, 0x08, kProcessPokeList);
    WriteWorkU32(work, kProcessNextTypeOffset, kProcessPokeList);
    WriteWorkU32(work, 0x10, kProcessNext);
    *sequence = 11;
}

static u32 RelearnProcLinkEvent(void* event, int* sequence, void* rawWork)
{
    RelearnEventWork* work = static_cast<RelearnEventWork*>(rawWork);
    const u32 process = ReadWorkU32(work, kProcessNowTypeOffset);
    void* partyData = reinterpret_cast<void*>(ReadWorkU32(work, 0x1c));
    const bool fieldParty = process == kProcessPokeList && partyData
        && ReadWorkU32(partyData, kPartyDataModeOffset) == kPartyModeField;
    const W2URelearnAction action = W2URelearnDispatch(*sequence,
        process, work->reminder != 0,
        fieldParty, fieldParty ? ReadWorkU32(partyData, kPartyDataReturnModeOffset) : 0);
    if (action == W2U_RELEARN_FINISH) {
        reinterpret_cast<HeapFreeFn>(kHeapFreeAddress)(work->reminder->moves);
        reinterpret_cast<HeapFreeFn>(kHeapFreeAddress)(work->reminder);
        work->reminder = 0;
        ReopenPartyMenu(work, sequence);
        return 0;
    }
    if (action == W2U_RELEARN_START) {
        const u32 slot = ReadWorkU32(partyData, kPartyDataReturnSlotOffset);
        void* parameters = reinterpret_cast<void*>(ReadWorkU32(work, 0x18));
        void* gameSystem = *static_cast<void**>(parameters);
        void* gameData = reinterpret_cast<GameSystemDataFn>(kGameSystemDataAddress)(gameSystem);
        void* party = reinterpret_cast<GameDataGetPartyFn>(kGameDataGetPartyAddress)(gameData);
        const u32 count = reinterpret_cast<PartyGetCountFn>(kPartyGetCountAddress)(party);
        work->restoreSlot = slot < count && slot < 6 ? slot : 0;
        if (slot < count && slot < 6) {
            void* pokemon = reinterpret_cast<PartyGetMemberFn>(kPartyGetMemberAddress)(party, slot);
            u16* moves = static_cast<u16*>(reinterpret_cast<HeapAllocFn>(kHeapAllocAddress)(
                kEventHeap, sizeof(u16) * (W2U_RELEARN_MAX_MOVES + 1)));
            if (moves && BuildRelearnMoves(pokemon, kEventHeap, moves)) {
                MoveReminderData* data = static_cast<MoveReminderData*>(
                    reinterpret_cast<HeapAllocFn>(kHeapAllocAddress)(kEventHeap, sizeof(MoveReminderData)));
                if (data) {
                    *data = {};
                    data->pokemon = pokemon;
                    data->trainer = reinterpret_cast<GameSystemDataFn>(kGameDataTrainerAddress)(gameData);
                    data->gameSystem = gameSystem;
                    data->moves = moves;
                    data->mode = 1; // WAZAOSHIE_MODE_REMIND, exactly as the NPC.
                    work->reminder = data;
                    reinterpret_cast<QueueProcFn>(kQueueProcAddress)(gameSystem,
                        kMoveReminderOverlay, reinterpret_cast<const void*>(kMoveReminderProcDataAddress), data);
                    *sequence = 12; // Let retail wait for the app and unload it.
                    return 0;
                }
            }
            if (moves) reinterpret_cast<HeapFreeFn>(kHeapFreeAddress)(moves);
        }
        // Invalid Pokemon, no remaining moves, or allocation failure: return
        // quietly without ever launching an empty tutor screen.
        ReopenPartyMenu(work, sequence);
        return 0;
    }
    const bool restoring = *sequence == 11 && work->restoreSlot != 0xffffffff;
    const u32 result = reinterpret_cast<ProcLinkEventFn>(kProcLinkEventAddress)(event, sequence, work);
    if (restoring && *sequence == 12) {
        // GSYS_QueueProc stores the arguments; the new app starts next tick.
        // Restore selection before its Init sees the newly allocated data.
        void* newPartyData = reinterpret_cast<void*>(ReadWorkU32(work, 0x1c));
        WriteWorkU32(newPartyData, kPartyDataReturnSlotOffset, work->restoreSlot);
        work->restoreSlot = 0xffffffff;
    }
    return result;
}

static void* CreateProcLinkEventHook(
    void* gameSystem, void* parent, ProcLinkEventFn callback, u32 size)
{
    CreateEventFn create = reinterpret_cast<CreateEventFn>(kCreateEventAddress);
    if (size != kProcLinkWorkSize
        || callback != reinterpret_cast<ProcLinkEventFn>(kProcLinkEventAddress)) {
        return create(gameSystem, parent, callback, size);
    }
    void* event = create(gameSystem, parent, RelearnProcLinkEvent, sizeof(RelearnEventWork));
    if (event) {
        RelearnEventWork* work = static_cast<RelearnEventWork*>(
            reinterpret_cast<EventDataFn>(kEventDataAddress)(event));
        work->reminder = 0;
        work->restoreSlot = 0xffffffff;
    }
    return event;
}

static u16 CheckEvolutionHook(
    void* party,
    void* pokemon,
    u32 type,
    u32 parameter,
    u8 season,
    u32* condition,
    u32 heapId)
{
    if (gPendingSpecies != 0 && pokemon == gPendingPokemon) {
        const u16 target = gPendingSpecies;
        gPendingPokemon = 0;
        gPendingSpecies = 0;
        if (condition) {
            *condition = kEvolutionConditionLevel;
        }
        return target;
    }
    const u16 retailTarget = reinterpret_cast<CheckEvolutionFn>(
        kCheckEvolutionAddress)(
        party, pokemon, type, parameter, season, condition, heapId);
    if (retailTarget != 0 || type != kEvolutionCheckTypeLevel) {
        return retailTarget;
    }

    const u16 koTarget = ResolveEvolution(
        pokemon, heapId, kEvolutionMethodKoCount);
    if (koTarget != 0 && condition) {
        *condition = kEvolutionConditionLevel;
    }
    return koTarget;
}

static u32 EvolutionReturnHook(void* work)
{
    if (!work) {
        gMenuEvolutionReturning = false;
        return kProcessReturn;
    }

    if (gMenuEvolutionReturning) {
        gMenuEvolutionReturning = false;
        gPendingPokemon = 0;
        gPendingSpecies = 0;

        // The dispatcher copies now_type to pre_type after this returns.
        // Reporting PokeList on both sides reopens the party menu in normal
        // field mode instead of the Rare Candy continuation that prints
        // "You used your last None."
        WriteWorkU32(work, kProcessNowTypeOffset, kProcessPokeList);
        WriteWorkU32(work, kProcessNextTypeOffset, kProcessPokeList);
        return kProcessNext;
    }

    const u32 mode = ReadWorkU32(work, kProcessTakeoverModeOffset);
    if (mode == kTakeoverEvolutionItem) {
        WriteWorkU32(work, kProcessNextTypeOffset, kProcessBag);
        return kProcessNext;
    }
    if (mode == kTakeoverEvolutionLevel) {
        WriteWorkU32(work, kProcessNextTypeOffset, kProcessPokeList);
        return kProcessNext;
    }
    return kProcessReturn;
}

} // namespace

#if defined(W2U_TARGET_B2)
extern "C" void* THUMB_BRANCH_LINK_12_0x215B498(
    void* gameSystem, void* parent, ProcLinkEventFn callback, u32 size)
{
    return CreateProcLinkEventHook(gameSystem, parent, callback, size);
}

extern "C" void THUMB_BRANCH_LINK_165_0x219BAFE(
    void* work, void* menuWork, u32* itemArray)
{
    OpenPartyMenuHook(work, menuWork, itemArray);
}

extern "C" void* THUMB_BRANCH_LINK_165_0x219FDC4(
    void* work, void* menuWork, u32 type)
{
    return CreateMenuStringHook(work, menuWork, type);
}

extern "C" void THUMB_BRANCH_LINK_165_0x219CEE4(void* work)
{
    SelectMenuExitHook(work);
}

extern "C" u16 THUMB_BRANCH_LINK_12_0x215C366(
    void* party,
    void* pokemon,
    u32 type,
    u32 parameter,
    u8 season,
    u32* condition,
    u32 heapId)
{
    return CheckEvolutionHook(
        party, pokemon, type, parameter, season, condition, heapId);
}

extern "C" u32 THUMB_BRANCH_12_0x215C3A4(void* work)
{
    return EvolutionReturnHook(work);
}

extern "C" void THUMB_BRANCH_LINK_166_0x219CF64(
    void* work, void* parameter)
{
    CheckLevelUpPokemonHook(work, parameter);
}

extern "C" u16 THUMB_BRANCH_LINK_166_0x219D26A(
    void* party, void* pokemon, u32 type, u32 parameter, u8 season,
    u32* condition, u32 heapId)
{
    return CheckPostBattleEvolutionHook(party, pokemon, type, parameter, season, condition, heapId);
}
#else
extern "C" void* THUMB_BRANCH_LINK_12_0x215B4D8(
    void* gameSystem, void* parent, ProcLinkEventFn callback, u32 size)
{
    return CreateProcLinkEventHook(gameSystem, parent, callback, size);
}

extern "C" void THUMB_BRANCH_LINK_165_0x219BB3E(
    void* work, void* menuWork, u32* itemArray)
{
    OpenPartyMenuHook(work, menuWork, itemArray);
}

extern "C" void* THUMB_BRANCH_LINK_165_0x219FE04(
    void* work, void* menuWork, u32 type)
{
    return CreateMenuStringHook(work, menuWork, type);
}

extern "C" void THUMB_BRANCH_LINK_165_0x219CF24(void* work)
{
    SelectMenuExitHook(work);
}

extern "C" u16 THUMB_BRANCH_LINK_12_0x215C3A6(
    void* party,
    void* pokemon,
    u32 type,
    u32 parameter,
    u8 season,
    u32* condition,
    u32 heapId)
{
    return CheckEvolutionHook(
        party, pokemon, type, parameter, season, condition, heapId);
}

extern "C" u32 THUMB_BRANCH_12_0x215C3E4(void* work)
{
    return EvolutionReturnHook(work);
}

extern "C" void THUMB_BRANCH_LINK_166_0x219CFA4(
    void* work, void* parameter)
{
    CheckLevelUpPokemonHook(work, parameter);
}

extern "C" u16 THUMB_BRANCH_LINK_166_0x219D2AA(
    void* party, void* pokemon, u32 type, u32 parameter, u8 season,
    u32* condition, u32 heapId)
{
    return CheckPostBattleEvolutionHook(party, pokemon, type, parameter, season, condition, heapId);
}
#endif
