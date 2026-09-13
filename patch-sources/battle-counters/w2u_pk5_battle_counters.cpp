#include "w2u_battle.h"
#include "w2u_battle_log.h"
#include "w2u_ko_move_pending.h"

namespace {

constexpr u32 kPk5CounterRpcMagic = 0xB10C0000;
#if !defined(W2U_TARGET_BW1)
constexpr u32 kPk5CounterImmediateKoRpcMagic = 0xB10C1000;
constexpr u32 kKoLearnsetMaxEntries = 32;
constexpr u16 kMoveLearnNone = 0;
constexpr u16 kMoveSetFailed = 0xFFFF;
constexpr u16 kMoveSetSame = 0xFFFE;
constexpr u16 kMoveLearnFull = 0x8000;
constexpr u32 kPk5ParamSpecies = 5;
constexpr u32 kPk5ParamForm = 0x6F;
constexpr char kKoLearnsetPath[] = "battlelog_ko/learnsets.narc";
#endif
constexpr u16 kPk5FastModeFlag = 1 << 1;
constexpr u32 kPk5EggFlag = 1u << 30;
constexpr u8 kBattleMonEnteredBattleFlag = 1 << 7;
constexpr u32 kPlayerClient = 0;
constexpr u32 kPk5WordCount = W2U_PK5_ENCRYPTED_DATA_SIZE / sizeof(u16);
constexpr int kPk5BlockA = 0;
constexpr int kPk5BlockB = 1;
constexpr int kPk5BlockC = 2;

struct Pk5CoreView {
    u32 pid;
    u16 sanityFlags;
    u16 checksum;
    u8 encryptedData[W2U_PK5_ENCRYPTED_DATA_SIZE];
};

static_assert(sizeof(Pk5CoreView) == W2U_PK5_SIZE,
    "Gen 5 boxed Pokemon core must remain 136 bytes");
static_assert(__builtin_offsetof(BattleMon, currentHP) == 0x10,
    "BattleMon current-HP offset changed");

using PkmDecryptFn = b32 (*)(void*);
using PkmReEncryptFn = b32 (*)(void*, b32);
using PkmCryptoRunFn = void (*)(void*, u32, u32);
using PkmGetBlockFn = void* (*)(void*, u32, int);
#if !defined(W2U_TARGET_BW1)
using PokemonGetFn = u32 (*)(void*, u32, void*);
using PersonalDataIdFn = u32 (*)(u32, u32);
using ArcReadHeapNewDirectFn = void* (*)(const char*, u16, u32);
using FsConvertPathToFileIdFn = b32 (*)(u32*, const char*);
using HeapFreeFn = void (*)(void*);
using CheckMoveLearnFn = u16 (*)(void*, int*, u32);
using SetMoveFn = u16 (*)(void*, u16);
#endif

#if defined(W2U_TARGET_B1)
constexpr uintptr_t kPkmDecryptAddress = 0x02017DBD;
constexpr uintptr_t kPkmReEncryptAddress = 0x02017DE5;
constexpr uintptr_t kPkmCryptoRunAddress = 0x02019A51;
constexpr uintptr_t kPkmGetBlockAddress = 0x02019C39;
#elif defined(W2U_TARGET_W1)
constexpr uintptr_t kPkmDecryptAddress = 0x02017DD9;
constexpr uintptr_t kPkmReEncryptAddress = 0x02017E01;
constexpr uintptr_t kPkmCryptoRunAddress = 0x02019A6D;
constexpr uintptr_t kPkmGetBlockAddress = 0x02019C55;
#elif defined(W2U_TARGET_B2)
constexpr uintptr_t kPkmDecryptAddress = 0x0201CC99;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCC1;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ECDD;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEC5;
#if !defined(W2U_TARGET_BW1)
constexpr uintptr_t kPokemonGetAddress = 0x0201CCF9;
constexpr uintptr_t kPersonalDataIdAddress = 0x02020481;
constexpr uintptr_t kArcReadHeapNewDirectAddress = 0x0204A961;
constexpr uintptr_t kFsConvertPathToFileIdAddress = 0x02070CC9;
constexpr uintptr_t kHeapFreeAddress = 0x0203A24D;
constexpr uintptr_t kCheckMoveLearnAddress = 0x0201D359;
constexpr uintptr_t kSetMoveAddress = 0x0201D0BD;
constexpr uintptr_t kMoveLearnSubSequenceAddress = 0x021DB04C;
#endif
#else
constexpr uintptr_t kPkmDecryptAddress = 0x0201CCC5;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCED;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ED09;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEF1;
#if !defined(W2U_TARGET_BW1)
constexpr uintptr_t kPokemonGetAddress = 0x0201CD25;
constexpr uintptr_t kPersonalDataIdAddress = 0x020204AD;
constexpr uintptr_t kArcReadHeapNewDirectAddress = 0x0204A98D;
constexpr uintptr_t kFsConvertPathToFileIdAddress = 0x02070CF5;
constexpr uintptr_t kHeapFreeAddress = 0x0203A279;
constexpr uintptr_t kCheckMoveLearnAddress = 0x0201D385;
constexpr uintptr_t kSetMoveAddress = 0x0201D0E9;
constexpr uintptr_t kMoveLearnSubSequenceAddress = 0x021DB08C;
#endif
#endif

#if !defined(W2U_TARGET_BW1)
using PendingKoMoveLearn = W2UKoMovePending;
static_assert(W2U_KO_MOVE_PLAYER_SLOTS == W2U_BATTLE_LOG_PARTY_SLOTS,
    "KO move IDs must match the six original player battle slots");

struct CounterBattleRuntime {
    ServerFlow* serverFlow;
    PendingKoMoveLearn moveLearn[W2U_BATTLE_LOG_PARTY_SLOTS];
    bool koOnlyLearning;
};

CounterBattleRuntime sCounterRuntime;
#endif

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

static u16 Pk5Checksum(const u8* decryptedData)
{
    const u16* words = reinterpret_cast<const u16*>(decryptedData);
    u16 checksum = 0;
    for (u32 i = 0; i < kPk5WordCount; ++i) {
        checksum = static_cast<u16>(checksum + words[i]);
    }
    return checksum;
}

static u16 SaturatingAddU16(u16 value, u32 delta)
{
    const u32 sum = static_cast<u32>(value) + delta;
    return static_cast<u16>(sum > 0xFFFF ? 0xFFFF : sum);
}

static bool UpdatePk5BattleCounters(
    PartyPkm* partyPokemon,
    u8 koDelta,
    bool addBrought,
    bool used,
    u16* oldKoCount = 0,
    u16* newKoCount = 0)
{
    if (oldKoCount) {
        *oldKoCount = 0;
    }
    if (newKoCount) {
        *newKoCount = 0;
    }
    if (!partyPokemon) {
        return false;
    }

    // PartyPkm begins with its 136-byte BoxPkm core in all four Gen 5 games.
    Pk5CoreView* pokemon = reinterpret_cast<Pk5CoreView*>(partyPokemon);
    const u16 originalSanityFlags = pokemon->sanityFlags;
    const u16 originalChecksum = pokemon->checksum;
    const bool wasAlreadyDecrypted =
        (originalSanityFlags & kPk5FastModeFlag) != 0;
    const b32 decryptedByCaller =
        reinterpret_cast<PkmDecryptFn>(kPkmDecryptAddress)(pokemon);

    if (!wasAlreadyDecrypted
        && Pk5Checksum(pokemon->encryptedData) != originalChecksum) {
        // PML_PkmDecrypt deliberately does not checksum-check. Restore the
        // exact malformed ciphertext and sanity flags instead of blessing it.
        pokemon->sanityFlags = originalSanityFlags;
        reinterpret_cast<PkmCryptoRunFn>(kPkmCryptoRunAddress)(
            pokemon->encryptedData,
            W2U_PK5_ENCRYPTED_DATA_SIZE,
            originalChecksum);
        return false;
    }

    u8* blockA = static_cast<u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, kPk5BlockA));
    u8* blockBBytes = static_cast<u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, kPk5BlockB));
    u8* blockCBytes = static_cast<u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, kPk5BlockC));
    const bool isEmpty = !blockA || ReadU16(blockA) == 0;
    const bool isEgg = !blockBBytes
        || (ReadU32(blockBBytes + 0x10) & kPk5EggFlag) != 0;

    if (!isEmpty && !isEgg && blockCBytes) {
        W2UPk5BattleCounterBlockB* blockB =
            reinterpret_cast<W2UPk5BattleCounterBlockB*>(blockBBytes);
        W2UPk5BattleCounterBlockC* blockC =
            reinterpret_cast<W2UPk5BattleCounterBlockC*>(blockCBytes);
        if (addBrought) {
            blockB->battlesBrought = SaturatingAddU16(
                blockB->battlesBrought, 1);
        }
        if (used) {
            blockB->battlesUsed = SaturatingAddU16(blockB->battlesUsed, 1);
        }
        const u16 oldKos = W2U_ReadPk5KoCounter(blockB, blockC);
        const u16 kos = SaturatingAddU16(oldKos, koDelta);
        W2U_WritePk5KoCounter(blockB, blockC, kos);
        if (oldKoCount) {
            *oldKoCount = oldKos;
        }
        if (newKoCount) {
            *newKoCount = kos;
        }
    }

    reinterpret_cast<PkmReEncryptFn>(kPkmReEncryptAddress)(
        pokemon, decryptedByCaller);
    return !isEmpty && !isEgg && blockCBytes;
}

#if !defined(W2U_TARGET_BW1)
static void ClearCounterRuntime()
{
    sCounterRuntime.serverFlow = 0;
    sCounterRuntime.koOnlyLearning = false;
    for (u32 slot = 0; slot < W2U_BATTLE_LOG_PARTY_SLOTS; ++slot) {
        sCounterRuntime.moveLearn[slot].pid = 0;
        sCounterRuntime.moveLearn[slot].lowerExclusive = 0;
        sCounterRuntime.moveLearn[slot].upperInclusive = 0;
        sCounterRuntime.moveLearn[slot].nextIndex = 0;
        sCounterRuntime.moveLearn[slot].pending = false;
    }
}

static void EnsureCounterRuntime(ServerFlow* serverFlow)
{
    if (sCounterRuntime.serverFlow != serverFlow) {
        ClearCounterRuntime();
        sCounterRuntime.serverFlow = serverFlow;
    }
}

static PendingKoMoveLearn* FindPendingMoveLearn(BattleMon* battlePokemon)
{
    if (!battlePokemon || !battlePokemon->partySrc) {
        return 0;
    }
    return W2U_FindPendingKoMove(sCounterRuntime.moveLearn,
        battlePokemon->battleSlot,
        reinterpret_cast<const Pk5CoreView*>(battlePokemon->partySrc)->pid);
}

static void RecordImmediateKo(BattleMon* battleMon, ServerFlow* serverFlow)
{
    if (!battleMon || !battleMon->partySrc || !serverFlow
        || battleMon->battleSlot >= W2U_BATTLE_LOG_PARTY_SLOTS) {
        return;
    }

    EnsureCounterRuntime(serverFlow);
    const u32 slot = battleMon->battleSlot;

    u16 oldKos = 0;
    u16 newKos = 0;
    if (!UpdatePk5BattleCounters(
            battleMon->partySrc, 1, false, false, &oldKos, &newKos)) {
        return;
    }
    if (newKos == oldKos) {
        return;
    }

    // Battle Counters can be installed without Menu Evolution/KO moves.
    // The retail direct-NARC reader assumes FS_OpenFile succeeds; don't call
    // it (or enqueue a learning action) when the optional archive is absent.
    u32 fileId[2]; // Nitro FSFileID: archive pointer, member/file ID.
    if (!reinterpret_cast<FsConvertPathToFileIdFn>(
            kFsConvertPathToFileIdAddress)(fileId, kKoLearnsetPath)) {
        return;
    }
    W2U_QueuePendingKoMove(sCounterRuntime.moveLearn, slot,
        reinterpret_cast<const Pk5CoreView*>(battleMon->partySrc)->pid,
        oldKos, newKos);

    // KO moves reuse the retail move-learning sub-sequence at the end of an
    // EXP command.  Retail does not enqueue that command for a level-100
    // Pokemon (or whenever its awarded EXP is zero), so enqueue a zero-EXP
    // action explicitly.  It has no visible EXP side effects, but guarantees
    // that the pending KO range is checked immediately after every KO.
    if (serverFlow->serverCommandQueue) {
        ServerDisplay_AddCommon(
            serverFlow->serverCommandQueue,
            SCID_Exp,
            battleMon->battleSlot,
            0u);
    }
}

static void CommitParticipationCounters(ServerFlow* serverFlow)
{
    EnsureCounterRuntime(serverFlow);
    BattleParty* playerParty = &serverFlow->pokeCon->party[kPlayerClient];
    const u32 memberCount = playerParty->memberCount < W2U_BATTLE_LOG_PARTY_SLOTS
        ? playerParty->memberCount
        : W2U_BATTLE_LOG_PARTY_SLOTS;
    for (u32 slot = 0; slot < memberCount; ++slot) {
        BattleMon* member = playerParty->members[slot];
        if (!member || member->battleSlot >= W2U_BATTLE_LOG_PARTY_SLOTS) {
            continue;
        }
        UpdatePk5BattleCounters(
            member->partySrc,
            0,
            true,
            (member->flags & kBattleMonEnteredBattleFlag) != 0);
    }
    ClearCounterRuntime();
}

static bool HasPendingMoveLearn(BattleMon* battlePokemon)
{
    return FindPendingMoveLearn(battlePokemon) != 0;
}

static u16 CheckKoMoveLearn(
    PartyPkm* pokemon, u32 heapId, BattleMon* battlePokemon)
{
    if (!battlePokemon || battlePokemon->partySrc != pokemon) {
        return kMoveLearnNone;
    }
    PendingKoMoveLearn* pending = FindPendingMoveLearn(battlePokemon);
    if (!pending) {
        return kMoveLearnNone;
    }

    PokemonGetFn get = reinterpret_cast<PokemonGetFn>(kPokemonGetAddress);
    const u32 species = get(pokemon, kPk5ParamSpecies, 0);
    const u32 form = get(pokemon, kPk5ParamForm, 0);
    const u32 personalId = reinterpret_cast<PersonalDataIdFn>(
        kPersonalDataIdAddress)(species, form);
    u8* entries = static_cast<u8*>(
        reinterpret_cast<ArcReadHeapNewDirectFn>(
            kArcReadHeapNewDirectAddress)(
                kKoLearnsetPath, static_cast<u16>(personalId), heapId));
    if (!entries) {
        pending->pending = false;
        return kMoveLearnNone;
    }

    u16 result = kMoveLearnNone;
    for (u32 index = pending->nextIndex;
         index < kKoLearnsetMaxEntries;
         ++index) {
        const u16 move = ReadU16(entries + index * 4);
        const u16 threshold = ReadU16(entries + index * 4 + 2);
        pending->nextIndex = static_cast<u8>(index + 1);
        if (move == 0xFFFF) {
            pending->pending = false;
            break;
        }
        if (move == 0 || threshold <= pending->lowerExclusive
            || threshold > pending->upperInclusive) {
            continue;
        }

        const u16 setResult = reinterpret_cast<SetMoveFn>(kSetMoveAddress)(
            pokemon, move);
        result = setResult == kMoveSetFailed
            ? static_cast<u16>(move | kMoveLearnFull)
            : setResult;
        break;
    }
    if (pending->nextIndex >= kKoLearnsetMaxEntries) {
        pending->pending = false;
    }
    reinterpret_cast<HeapFreeFn>(kHeapFreeAddress)(entries);
    return result;
}
#endif

} // namespace

#if defined(W2U_TARGET_B1)
#define W2U_PK5_COUNTER_HOOK THUMB_BRANCH_93_0x21D5B68
#elif defined(W2U_TARGET_W1)
#define W2U_PK5_COUNTER_HOOK THUMB_BRANCH_93_0x21D5B88
#else
#define W2U_PK5_COUNTER_HOOK THUMB_BRANCH_BattleMon_IsFainted
#endif

extern "C" b32 W2U_PK5_COUNTER_HOOK(
    BattleMon* battleMon,
    u32 command,
    ServerFlow* serverFlow,
    const u8* koDeltas)
{
#if !defined(W2U_TARGET_BW1)
    if (command == kPk5CounterImmediateKoRpcMagic
        && serverFlow) {
        RecordImmediateKo(battleMon, serverFlow);
    } else
#endif
    if (command == kPk5CounterRpcMagic
        && serverFlow
        && serverFlow->pokeCon
#if defined(W2U_TARGET_BW1)
        && koDeltas
#endif
        ) {
#if !defined(W2U_TARGET_BW1)
        CommitParticipationCounters(serverFlow);
#else
        BattleParty* playerParty = &serverFlow->pokeCon->party[kPlayerClient];
        const u32 memberCount = playerParty->memberCount < W2U_BATTLE_LOG_PARTY_SLOTS
            ? playerParty->memberCount
            : W2U_BATTLE_LOG_PARTY_SLOTS;
        for (u32 slot = 0; slot < memberCount; ++slot) {
            BattleMon* member = playerParty->members[slot];
            if (!member || member->battleSlot >= W2U_BATTLE_LOG_PARTY_SLOTS) {
                continue;
            }
            UpdatePk5BattleCounters(
                member->partySrc,
                koDeltas[member->battleSlot],
                true,
                (member->flags & kBattleMonEnteredBattleFlag) != 0);
        }
#endif
    }

    // Retail BattleMon_IsFainted reads current HP through GetValue(13) and
    // returns exactly this predicate. Keeping its ordinary behavior makes the
    // overlay-local RPC hook transparent to every existing battle caller.
    return !battleMon || battleMon->currentHP == 0;
}

#if !defined(W2U_TARGET_BW1)
extern "C" void W2U_KoMoveFinishExpHelper(
    BattleMon* battlePokemon,
    int* sequence)
{
    if (!sequence) {
        return;
    }
    // This path has no level-up: only pending KO moves may enter the retail
    // learning UI. Keep the mode until its NONE result, not until the final
    // KO entry is consumed (a learn/replace/decline prompt can still be open).
    sCounterRuntime.koOnlyLearning = HasPendingMoveLearn(battlePokemon);
    if (sCounterRuntime.koOnlyLearning) {
        *sequence = 12;
        *reinterpret_cast<int*>(kMoveLearnSubSequenceAddress) = 0;
    } else {
        *sequence = 13;
    }
}

#if defined(W2U_TARGET_B2)
#define W2U_KO_MOVE_FINISH_EXP_HOOK THUMB_BRANCH_LINK_167_0x21B7E94
#define W2U_KO_MOVE_EXP_RETURN "0x021B8063"
#define W2U_KO_MOVE_CHECK_HOOK THUMB_BRANCH_LINK_167_0x21B8104
#else
#define W2U_KO_MOVE_FINISH_EXP_HOOK THUMB_BRANCH_LINK_167_0x21B7ED4
#define W2U_KO_MOVE_EXP_RETURN "0x021B80A3"
#define W2U_KO_MOVE_CHECK_HOOK THUMB_BRANCH_LINK_167_0x21B8144
#endif

extern "C" __attribute__((naked)) void W2U_KO_MOVE_FINISH_EXP_HOOK()
{
    // Intercept cmp exp,#0 / beq SEQ_END, not mov #13 / str [seq].
    // That later str is a shared tail reached directly by many other states
    // (including returning from wazaOboeSeq). Replacing it with a BL suffix
    // makes those branches enter the middle of the hook and execute data.
    asm volatile(
        "cmp r0, #0\n"
        "bne 1f\n"
        "push {r0-r4, lr}\n"
        "mov r0, r6\n"
        "mov r1, r4\n"
        "bl W2U_KoMoveFinishExpHelper\n"
        "ldr r0, =" W2U_KO_MOVE_EXP_RETURN "\n"
        "str r0, [sp, #20]\n"
        "pop {r0-r4, pc}\n"
        "1: bx lr\n"
        ".align 2\n"
        ".ltorg\n");
}

extern "C" u16 W2U_KoMoveCheckHelper(
    PartyPkm* pokemon,
    int* learnsetIndex,
    u32 heapId,
    BattleMon* battlePokemon)
{
    const CheckMoveLearnFn checkLevelMove =
        reinterpret_cast<CheckMoveLearnFn>(kCheckMoveLearnAddress);
    return W2U_CheckBattleMoveLearn(sCounterRuntime.koOnlyLearning,
        [=]() { return checkLevelMove(pokemon, learnsetIndex, heapId); },
        [=]() { return CheckKoMoveLearn(pokemon, heapId, battlePokemon); });
}

extern "C" __attribute__((naked)) void W2U_KO_MOVE_CHECK_HOOK()
{
    // wazaOboeSeq saves its original client BattleMon at [sp, #0] on both
    // US B2/W2. Preserve the retail three arguments and supply that stable
    // identity as argument four. Our two-register push moves it to sp+8.
    asm volatile(
        "push {r4, lr}\n"
        "ldr r3, [sp, #8]\n"
        "bl W2U_KoMoveCheckHelper\n"
        "pop {r4, pc}\n");
}
#endif
