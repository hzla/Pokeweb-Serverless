#include "w2u_battle.h"
#include "w2u_battle_log.h"
#include "w2u_battle_log_attribution.h"

#if !defined(W2U_TARGET_BW1)
extern "C" void* MainModule_GetBtlSetup(MainModule* mainModule);
#endif
extern "C" u8 W2U_BattleLog_OriginalRegisterTargets(
    ServerFlow* serverFlow,
    BattleMon* attacker,
    u32 targetPosition,
    const void* moveParam,
    PokeSet* targets);
extern "C" b32 W2U_BattleLog_OriginalCheckFainted(
    ServerFlow* serverFlow,
    BattleMon* battleMon);
extern "C" void W2U_BattleLog_OriginalNotifyBattleResult(
    MainModule* mainModule,
    u32 result);

static_assert(sizeof(MoveDamageRec) == 8, "MoveDamageRec must match the retail BW/BW2 record");
static_assert(__builtin_offsetof(MoveDamageRec, moveType) == 4, "MoveDamageRec move type offset");
static_assert(__builtin_offsetof(MoveDamageRec, pokeID) == 5, "MoveDamageRec attacker ID offset");
static_assert(__builtin_offsetof(MoveDamageRec, pokePos) == 6, "MoveDamageRec attacker position offset");

namespace {

constexpr u32 kBattleSlotCount = 24;
constexpr u8 kInvalidBattleSlot = 0xFF;
constexpr u32 kPlayerClient = 0;
constexpr u32 kPartnerClient = 2;
constexpr u32 kFirstEnemyClient = 1;
constexpr u32 kSecondEnemyClient = 3;
constexpr u32 kBattlePositionCount = 6;
constexpr u32 kPk5CounterRpcMagic = 0xB10C0000;
#if !defined(W2U_TARGET_BW1)
constexpr u32 kPk5CounterImmediateKoRpcMagic = 0xB10C1000;
#endif

#if defined(W2U_TARGET_BW1)
constexpr uintptr_t kSaveControlGetInstanceAddress = 0x020070A5;
// SaveControl_DataPtrGet.  The preceding wrapper at 0x020071C1 is
// GetSaveAsyncMain_WritingSize and ignores the requested save-block ID.
constexpr uintptr_t kSaveControlGetBlockPtrAddress = 0x020071CD;
#if defined(W2U_TARGET_B1)
constexpr uintptr_t kMainModuleGetBtlSetupAddress = 0x021B871F;
constexpr uintptr_t kMainModuleGetBattleTypeAddress = 0x021B86B9;
constexpr uintptr_t kBtlSetupGetBattleStyleAddress = 0x021B8589;
constexpr uintptr_t kHandlerPokeIDToPokePosAddress = 0x021C8011;
constexpr uintptr_t kBattleMonIsFaintedAddress = 0x021D5B69;
#else
constexpr uintptr_t kMainModuleGetBtlSetupAddress = 0x021B873F;
constexpr uintptr_t kMainModuleGetBattleTypeAddress = 0x021B86D9;
constexpr uintptr_t kBtlSetupGetBattleStyleAddress = 0x021B85A9;
constexpr uintptr_t kHandlerPokeIDToPokePosAddress = 0x021C8031;
constexpr uintptr_t kBattleMonIsFaintedAddress = 0x021D5B89;
#endif
#else
constexpr uintptr_t kSaveControlGetInstanceAddress = 0x020072FD;
constexpr uintptr_t kSaveControlGetBlockPtrAddress = 0x02007449;
#if defined(W2U_TARGET_B2)
constexpr uintptr_t kBattleMonIsFaintedAddress = 0x021BB369;
#else
constexpr uintptr_t kBattleMonIsFaintedAddress = 0x021BB3A9;
#endif
#endif

struct TrainerBattleSetupView {
    u32 trainerID;
};

struct BtlSetupView {
    u8 padding[0x48];
    TrainerBattleSetupView* trainerSetups[4];
};

struct LogBlockSpec {
    u32 saveBlockID;
    u32 size;
    u16 capacity;
};

struct PendingTrainerRecord {
    u16 trainerID;
    u8 playerCreditsByEnemy[W2U_BATTLE_LOG_PARTY_SLOTS];
    u8 enemyCreditsByPlayer[W2U_BATTLE_LOG_PARTY_SLOTS];
    bool present;
};

struct PendingBattleRecord {
    MainModule* mainModule;
    u16 playerSpecies[W2U_BATTLE_LOG_PARTY_SLOTS];
    PendingTrainerRecord opponents[2];
#if defined(W2U_TARGET_BW1)
    u8 playerKoDeltas[W2U_BATTLE_LOG_PARTY_SLOTS];
#endif
    u8 playerCount;
#if defined(W2U_TARGET_BW1)
    bool valid;
    bool committed;
#endif
};

struct KOAttribution {
    u8 opponentIndex;
    u8 victimSubIndex;
    u8 creditedSubIndex;
    bool playerKO;
    bool valid;
};

const LogBlockSpec kLogBlocks[] = {
    {
        W2U_BATTLE_LOG_BLOCK_WIFI_HISTORY,
        W2U_BATTLE_LOG_WIFI_HISTORY_SIZE,
        W2U_BATTLE_LOG_WIFI_HISTORY_CAPACITY,
    },
    {
        W2U_BATTLE_LOG_BLOCK_WIFI_LIST,
        W2U_BATTLE_LOG_WIFI_LIST_SIZE,
        W2U_BATTLE_LOG_WIFI_LIST_CAPACITY,
    },
    {
        W2U_BATTLE_LOG_BLOCK_WIFI_NEGOTIATION,
        W2U_BATTLE_LOG_WIFI_NEGOTIATION_SIZE,
        W2U_BATTLE_LOG_WIFI_NEGOTIATION_CAPACITY,
    },
};

static_assert(
    W2U_BATTLE_LOG_HEADER_SIZE
            + W2U_BATTLE_LOG_WIFI_HISTORY_CAPACITY * W2U_BATTLE_LOG_RECORD_SIZE
        <= W2U_BATTLE_LOG_WIFI_HISTORY_SIZE,
    "battle log exceeds save block 29");
static_assert(
    W2U_BATTLE_LOG_HEADER_SIZE
            + W2U_BATTLE_LOG_WIFI_LIST_CAPACITY * W2U_BATTLE_LOG_RECORD_SIZE
        <= W2U_BATTLE_LOG_WIFI_LIST_SIZE,
    "battle log exceeds save block 30");
static_assert(
    W2U_BATTLE_LOG_HEADER_SIZE
            + W2U_BATTLE_LOG_WIFI_NEGOTIATION_CAPACITY * W2U_BATTLE_LOG_RECORD_SIZE
        <= W2U_BATTLE_LOG_WIFI_NEGOTIATION_SIZE,
    "battle log exceeds save block 31");
static_assert(
    W2U_BATTLE_LOG_WIFI_HISTORY_CAPACITY
            + W2U_BATTLE_LOG_WIFI_LIST_CAPACITY
            + W2U_BATTLE_LOG_WIFI_NEGOTIATION_CAPACITY
        == W2U_BATTLE_LOG_MAX_RECORDS,
    "battle log capacities do not total 600 records");

struct BattleLogRuntimeState {
    PendingBattleRecord pendingBattle;
    ServerFlow* observedServerFlow;
    u32 lastObservedTurn;
    u8 lastTargeter[kBattleSlotCount];
};

BattleLogRuntimeState sRuntimeState;

#define sPendingBattle sRuntimeState.pendingBattle
#define sObservedServerFlow sRuntimeState.observedServerFlow
#define sLastObservedTurn sRuntimeState.lastObservedTurn
#define sLastTargeter sRuntimeState.lastTargeter

using SaveControlGetInstanceFn = void* (*)();
using SaveControlGetBlockPtrFn = void* (*)(void*, u32);
using BattleMonIsFaintedRpcFn = b32 (*)(
    BattleMon*, u32, ServerFlow*, const u8*);

#if defined(W2U_TARGET_BW1)
using MainModuleGetBtlSetupFn = void* (*)(MainModule*);
using MainModuleGetBattleTypeFn = BattleType (*)(MainModule*);
using BtlSetupGetBattleStyleFn = BattleStyle (*)(MainModule*);
using HandlerPokeIDToPokePosFn = u32 (*)(ServerFlow*, u32);

#if defined(W2U_TARGET_B1)
constexpr uintptr_t kPkmDecryptAddress = 0x02017DBD;
constexpr uintptr_t kPkmReEncryptAddress = 0x02017DE5;
constexpr uintptr_t kPkmCryptoRunAddress = 0x02019A51;
constexpr uintptr_t kPkmGetBlockAddress = 0x02019C39;
#else
constexpr uintptr_t kPkmDecryptAddress = 0x02017DD9;
constexpr uintptr_t kPkmReEncryptAddress = 0x02017E01;
constexpr uintptr_t kPkmCryptoRunAddress = 0x02019A6D;
constexpr uintptr_t kPkmGetBlockAddress = 0x02019C55;
#endif

static void* BattleLog_GetBtlSetup(MainModule* mainModule)
{
    return reinterpret_cast<MainModuleGetBtlSetupFn>(
        kMainModuleGetBtlSetupAddress)(mainModule);
}

static BattleType BattleLog_GetBattleType(MainModule* mainModule)
{
    return reinterpret_cast<MainModuleGetBattleTypeFn>(
        kMainModuleGetBattleTypeAddress)(mainModule);
}

static BattleStyle BattleLog_GetBattleStyle(MainModule* mainModule)
{
    return reinterpret_cast<BtlSetupGetBattleStyleFn>(
        kBtlSetupGetBattleStyleAddress)(mainModule);
}

static u32 BattleLog_PokeIDToPokePos(ServerFlow* serverFlow, u32 battleSlot)
{
    return reinterpret_cast<HandlerPokeIDToPokePosFn>(
        kHandlerPokeIDToPokePosAddress)(serverFlow, battleSlot);
}

static u32 BattleLog_PokePosToPokeID(ServerFlow* serverFlow, u32 position)
{
    // PW1Code's Black/White 1 symbol for Handler_PokePosToPokeID resolves to
    // a literal pool entry (0x00000271), not executable code. Invert the
    // verified Handler_PokeIDToPokePos mapping instead of branching into data.
    for (u32 battleSlot = 0; battleSlot < kBattleSlotCount; ++battleSlot) {
        if (BattleLog_PokeIDToPokePos(serverFlow, battleSlot) == position) {
            return battleSlot;
        }
    }
    return kBattleSlotCount;
}
#else
static void* BattleLog_GetBtlSetup(MainModule* mainModule)
{
    return MainModule_GetBtlSetup(mainModule);
}

static BattleType BattleLog_GetBattleType(MainModule* mainModule)
{
    return MainModule_GetBattleType(mainModule);
}

static BattleStyle BattleLog_GetBattleStyle(MainModule* mainModule)
{
    return BtlSetup_GetBattleStyle(mainModule);
}

static u32 BattleLog_PokeIDToPokePos(ServerFlow* serverFlow, u32 battleSlot)
{
    return Handler_PokeIDToPokePos(serverFlow, battleSlot);
}

static u32 BattleLog_PokePosToPokeID(ServerFlow* serverFlow, u32 position)
{
    return Handler_PokePosToPokeID(serverFlow, position);
}
#endif

static void BattleLog_CommitIndividualCounters(ServerFlow* serverFlow)
{
    BattleParty* playerParty = &serverFlow->pokeCon->party[kPlayerClient];
    reinterpret_cast<BattleMonIsFaintedRpcFn>(
        kBattleMonIsFaintedAddress)(
            playerParty->members[0],
            kPk5CounterRpcMagic,
            serverFlow,
#if defined(W2U_TARGET_BW1)
            sPendingBattle.playerKoDeltas);
#else
            0);
#endif
}

static void* GetSaveControl()
{
    const SaveControlGetInstanceFn getInstance =
        reinterpret_cast<SaveControlGetInstanceFn>(kSaveControlGetInstanceAddress);
    return getInstance();
}

static u8* GetSaveBlock(void* saveControl, u32 blockID)
{
    const SaveControlGetBlockPtrFn getBlock =
        reinterpret_cast<SaveControlGetBlockPtrFn>(kSaveControlGetBlockPtrAddress);
    return static_cast<u8*>(getBlock(saveControl, blockID));
}

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

static void WriteU16(u8* data, u16 value)
{
    data[0] = static_cast<u8>(value);
    data[1] = static_cast<u8>(value >> 8);
}

static void WriteU32(u8* data, u32 value)
{
    data[0] = static_cast<u8>(value);
    data[1] = static_cast<u8>(value >> 8);
    data[2] = static_cast<u8>(value >> 16);
    data[3] = static_cast<u8>(value >> 24);
}

// Records are zeroed before packing, so only the set bits need to be written.
// Every caller has already bounded its value to the field width.
static void WriteBits(u8* data, u32 bitOffset, u32 value)
{
    while (value) {
        data[bitOffset >> 3] |= static_cast<u8>((value & 1) << (bitOffset & 7));
        value >>= 1;
        ++bitOffset;
    }
}

static u16 GetBlockCount(const u8* block)
{
    return ReadU16(block + 6);
}

static void SetBlockCount(u8* block, u16 count)
{
    WriteU16(block + 6, count);
}

static bool IsBlockHeaderValid(const u8* block, const LogBlockSpec& spec)
{
    if (!block
        || ReadU32(block) != W2U_BATTLE_LOG_MAGIC
        || ReadU16(block + 4) != W2U_BATTLE_LOG_VERSION
        || ReadU16(block + 8) != spec.capacity
        || GetBlockCount(block) > spec.capacity) {
        return false;
    }
    return true;
}

static bool CanRepairMissingWifiListBlock(u8* const blocks[3], const bool valid[3])
{
    // The original v2 release did not guard White 2's heap-resident Pal Pad
    // shadow. GAMEDATA_SaveDataUpdate consequently restored retail Wi-Fi List
    // bytes over block 30 while leaving blocks 29 and 31 intact. This shape is
    // unambiguous while block 29 has not filled and block 31 is still empty.
    return valid[0]
        && !valid[1]
        && valid[2]
        && GetBlockCount(blocks[0]) < kLogBlocks[0].capacity
        && GetBlockCount(blocks[2]) == 0;
}

static void ZeroBlock(u8* block, u32 size)
{
    // Volatile stores prevent freestanding GCC from introducing a libc memset
    // import into this independently unloadable overlay module.
    volatile u8* output = block;
    for (u32 byte = 0; byte < size; ++byte) {
        output[byte] = 0;
    }
}

static void InitializeBlock(u8* block, const LogBlockSpec& spec)
{
    ZeroBlock(block, spec.size);
    WriteU32(block, W2U_BATTLE_LOG_MAGIC);
    WriteU16(block + 4, W2U_BATTLE_LOG_VERSION);
    SetBlockCount(block, 0);
    WriteU16(block + 8, spec.capacity);
}

static bool LoadLogBlocks(u8* blocks[3])
{
    void* saveControl = GetSaveControl();
    if (!saveControl) {
        return false;
    }

    bool blockValid[3];
    for (u32 i = 0; i < 3; ++i) {
        blocks[i] = GetSaveBlock(saveControl, kLogBlocks[i].saveBlockID);
        blockValid[i] = IsBlockHeaderValid(blocks[i], kLogBlocks[i]);
    }
    bool valid = blockValid[0] && blockValid[1] && blockValid[2];

    if (!valid && CanRepairMissingWifiListBlock(blocks, blockValid)) {
        InitializeBlock(blocks[1], kLogBlocks[1]);
        valid = true;
    }

    // Later blocks may only contain records after all earlier blocks fill.
    if (valid) {
        valid = !(GetBlockCount(blocks[0]) < kLogBlocks[0].capacity
                    && (GetBlockCount(blocks[1]) != 0 || GetBlockCount(blocks[2]) != 0));
        valid = valid && !(GetBlockCount(blocks[1]) < kLogBlocks[1].capacity
                            && GetBlockCount(blocks[2]) != 0);
    }

    if (!valid) {
        for (u32 i = 0; i < 3; ++i) {
            if (!blocks[i]) {
                return false;
            }
        }
        for (u32 i = 0; i < 3; ++i) {
            InitializeBlock(blocks[i], kLogBlocks[i]);
        }
    }
    return true;
}

static void AppendLogRecord(const u8 packedRecord[W2U_BATTLE_LOG_RECORD_SIZE])
{
    u8* blocks[3];
    if (!LoadLogBlocks(blocks)) {
        return;
    }

    for (u32 i = 0; i < 3; ++i) {
        const u16 count = GetBlockCount(blocks[i]);
        if (count >= kLogBlocks[i].capacity) {
            continue;
        }

        volatile u8* record = blocks[i] + W2U_BATTLE_LOG_HEADER_SIZE
            + static_cast<u32>(count) * W2U_BATTLE_LOG_RECORD_SIZE;
        for (u32 byte = 0; byte < W2U_BATTLE_LOG_RECORD_SIZE; ++byte) {
            record[byte] = packedRecord[byte];
        }
        SetBlockCount(blocks[i], count + 1);
        return;
    }

    WriteU16(blocks[2] + 10, ReadU16(blocks[2] + 10) | W2U_BATTLE_LOG_FLAG_OVERFLOW);
}

static u32 GetClientID(u32 battleSlot)
{
    if (battleSlot < 6) {
        return 0;
    }
    if (battleSlot < 12) {
        return 2;
    }
    if (battleSlot < 18) {
        return 1;
    }
    if (battleSlot < 24) {
        return 3;
    }
    return 4;
}

static bool IsEnemyClient(u32 clientID)
{
    return clientID == kFirstEnemyClient || clientID == kSecondEnemyClient;
}

static u8 GetTrainerSubIndex(u32 battleSlot)
{
    if (battleSlot < 6) {
        return static_cast<u8>(battleSlot + 1);
    }
    if (battleSlot < 12) {
        return static_cast<u8>(battleSlot - 5);
    }
    if (battleSlot < 18) {
        return static_cast<u8>(battleSlot - 11);
    }
    if (battleSlot < 24) {
        return static_cast<u8>(battleSlot - 17);
    }
    return 0;
}

static void InitializePendingBattle(ServerFlow* serverFlow);

static void ResetTargetState(ServerFlow* serverFlow)
{
    volatile u8* targeters = sLastTargeter;
    for (u32 slot = 0; slot < kBattleSlotCount; ++slot) {
        targeters[slot] = kInvalidBattleSlot;
    }
    sObservedServerFlow = serverFlow;
    sLastObservedTurn = serverFlow ? serverFlow->turnCount : 0;
    InitializePendingBattle(serverFlow);
}

static void EnsureTargetState(ServerFlow* serverFlow)
{
    if (sObservedServerFlow != serverFlow
        || (serverFlow
            && sPendingBattle.mainModule
            && sPendingBattle.mainModule != serverFlow->mainModule)
        || (serverFlow && serverFlow->turnCount < sLastObservedTurn)) {
        ResetTargetState(serverFlow);
    }
    if (serverFlow) {
        sLastObservedTurn = serverFlow->turnCount;
    }
}

static bool IsEligibleTrainerBattle(ServerFlow* serverFlow)
{
    return serverFlow
        && serverFlow->mainModule
        && BattleLog_GetBattleType(serverFlow->mainModule) == BTL_TYPE_TRAINER;
}

static BtlSetupView* GetBattleSetup(MainModule* mainModule)
{
    return static_cast<BtlSetupView*>(BattleLog_GetBtlSetup(mainModule));
}

static void InitializePendingBattle(ServerFlow* serverFlow)
{
    ZeroBlock(reinterpret_cast<u8*>(&sPendingBattle), sizeof(sPendingBattle));
    if (!IsEligibleTrainerBattle(serverFlow) || !serverFlow->pokeCon) {
        return;
    }

    BattleParty* playerParty = &serverFlow->pokeCon->party[kPlayerClient];
    if (!playerParty || playerParty->memberCount == 0) {
        return;
    }

#if defined(W2U_TARGET_BW1)
    sPendingBattle.mainModule = serverFlow->mainModule;
#endif
    sPendingBattle.playerCount = playerParty->memberCount < W2U_BATTLE_LOG_PARTY_SLOTS
        ? playerParty->memberCount
        : W2U_BATTLE_LOG_PARTY_SLOTS;
    for (u32 slot = 0; slot < sPendingBattle.playerCount; ++slot) {
        BattleMon* member = playerParty->members[slot];
        if (!member || member->battleSlot >= W2U_BATTLE_LOG_PARTY_SLOTS) {
            continue;
        }
        const u32 originalSlot = member->battleSlot;
        sPendingBattle.playerSpecies[originalSlot] =
            static_cast<u16>(member->species & 0x3FF);
    }

    BtlSetupView* setup = GetBattleSetup(serverFlow->mainModule);
    if (!setup) {
        return;
    }

    for (u32 opponent = 0; opponent < 2; ++opponent) {
        const u32 clientID = opponent == 0 ? kFirstEnemyClient : kSecondEnemyClient;
        BattleParty* enemyParty = &serverFlow->pokeCon->party[clientID];
        TrainerBattleSetupView* trainerSetup = setup->trainerSetups[clientID];
        if (!enemyParty || enemyParty->memberCount == 0 || !trainerSetup) {
            continue;
        }
        sPendingBattle.opponents[opponent].trainerID = static_cast<u16>(
            trainerSetup->trainerID & 0x3FF);
        sPendingBattle.opponents[opponent].present = true;
#if defined(W2U_TARGET_BW1)
        sPendingBattle.valid = true;
#else
        sPendingBattle.mainModule = serverFlow->mainModule;
#endif
    }
}

static u32 GetFacedPosition(BattleStyle style, u32 position)
{
    if (position >= kBattlePositionCount) {
        return kBattlePositionCount;
    }

    u32 opposingIndex = 0;
    const u32 ownIndex = position >> 1;
    if (style == BTL_STYLE_DOUBLE) {
        opposingIndex = ownIndex ^ 1;
    } else if (style == BTL_STYLE_TRIPLE) {
        opposingIndex = 2 - ownIndex;
    }

    return ((position & 1) == 0 ? 1 : 0) + opposingIndex * 2;
}

static u8 GetFallbackCredit(ServerFlow* serverFlow, u32 victimSlot)
{
    const u32 victimPosition = BattleLog_PokeIDToPokePos(serverFlow, victimSlot);
    const u32 facedPosition = GetFacedPosition(
        BattleLog_GetBattleStyle(serverFlow->mainModule), victimPosition);
    if (facedPosition >= kBattlePositionCount) {
        return kInvalidBattleSlot;
    }

    const u32 creditedSlot = BattleLog_PokePosToPokeID(serverFlow, facedPosition);
    return creditedSlot < kBattleSlotCount
        ? static_cast<u8>(creditedSlot)
        : kInvalidBattleSlot;
}

static bool IsValidCredit(u32 victimSlot, u32 creditedSlot)
{
    if (victimSlot >= kBattleSlotCount || creditedSlot >= kBattleSlotCount) {
        return false;
    }
    // Client IDs 0/2 are the player's side and 1/3 are the opposing side.
    return (GetClientID(victimSlot) & 1) != (GetClientID(creditedSlot) & 1);
}

static u8 SelectCreditedSlot(
    ServerFlow* serverFlow,
    BattleMon* victim,
    u32 victimSlot)
{
    const u32 recordTurn = victim->damageRecTurn;
    const u8 recordCount = victim->damageRecCount[recordTurn];
    // Move damage records contain both the executing attacker's persistent
    // battle slot (pokeID) and its transient field position (pokePos).  Credit
    // the persistent ID so doubles switches cannot turn positions 0/2/4 into
    // unrelated party slots.  End-of-turn/simple damage keeps using resolved
    // target history below.
    if (W2U_BattleLogHasCurrentDirectDamage(
            serverFlow->turnCheckSeq,
            (victim->turnFlag[0] & (1 << TURNFLAG_DAMAGED)) != 0,
            recordCount)) {
        return victim->damageRec[recordTurn][recordCount - 1].pokeID;
    }
    const BattleStyle style = BattleLog_GetBattleStyle(serverFlow->mainModule);
    if ((style == BTL_STYLE_DOUBLE || style == BTL_STYLE_TRIPLE)
        && IsValidCredit(victimSlot, sLastTargeter[victimSlot])) {
        return sLastTargeter[victimSlot];
    }

    const u8 fallback = GetFallbackCredit(serverFlow, victimSlot);
    return IsValidCredit(victimSlot, fallback) ? fallback : kInvalidBattleSlot;
}

static KOAttribution BuildAttribution(ServerFlow* serverFlow, BattleMon* victim)
{
    KOAttribution attribution;
    attribution.opponentIndex = 0;
    attribution.victimSubIndex = 0;
    attribution.creditedSubIndex = 0;
    attribution.playerKO = false;
    attribution.valid = false;
#if defined(W2U_TARGET_BW1)
    if (!sPendingBattle.valid || !victim) {
#else
    if (!sPendingBattle.mainModule || !victim) {
#endif
        return attribution;
    }

    const u32 victimSlot = victim->battleSlot;
    if (victimSlot >= kBattleSlotCount) {
        return attribution;
    }
    const u32 victimClient = GetClientID(victimSlot);
    if (victimClient == kPartnerClient || (!IsEnemyClient(victimClient) && victimClient != kPlayerClient)) {
        return attribution;
    }

    const u8 creditedSlot = SelectCreditedSlot(serverFlow, victim, victimSlot);
    if (creditedSlot >= kBattleSlotCount) {
        return attribution;
    }

    const u32 creditedClient = GetClientID(creditedSlot);
    if ((victimClient & 1) == (creditedClient & 1)) {
        return attribution;
    }
    const u32 aiClient = victimClient == kPlayerClient ? creditedClient : victimClient;
    if (!IsEnemyClient(aiClient)) {
        return attribution;
    }

    attribution.opponentIndex = aiClient == kFirstEnemyClient ? 0 : 1;
    attribution.victimSubIndex = GetTrainerSubIndex(victimSlot);
    attribution.playerKO = IsEnemyClient(victimClient);
    attribution.creditedSubIndex = creditedClient == kPartnerClient
        ? W2U_BATTLE_LOG_PARTNER_KO_CREDIT
        : GetTrainerSubIndex(creditedSlot);
    attribution.valid = sPendingBattle.opponents[attribution.opponentIndex].present
        && attribution.victimSubIndex >= 1
        && attribution.victimSubIndex <= W2U_BATTLE_LOG_PARTY_SLOTS
        && attribution.creditedSubIndex >= 1
        && attribution.creditedSubIndex <= W2U_BATTLE_LOG_PARTNER_KO_CREDIT;
    return attribution;
}

static void RecordAttribution(
    ServerFlow* serverFlow,
    const KOAttribution& attribution)
{
#if defined(W2U_TARGET_BW1)
    if (!attribution.valid || attribution.opponentIndex >= 2) {
        return;
    }
#endif
    PendingTrainerRecord& opponent = sPendingBattle.opponents[attribution.opponentIndex];
    if (attribution.playerKO
        && attribution.creditedSubIndex <= W2U_BATTLE_LOG_PARTY_SLOTS) {
#if defined(W2U_TARGET_BW1)
        u8& koDelta = sPendingBattle.playerKoDeltas[attribution.creditedSubIndex - 1];
        if (koDelta != 0xFF) {
            ++koDelta;
        }
#else
        // Client 0's global battle-slot IDs are the original party indexes.
        // PokeCon keeps those same IDs in activeBattleMon even after switches,
        // so the counter DLL can update the credited PK5 without a party scan.
        BattleMon* creditedPokemon = serverFlow->pokeCon->activeBattleMon[
            attribution.creditedSubIndex - 1];
        reinterpret_cast<BattleMonIsFaintedRpcFn>(
            kBattleMonIsFaintedAddress)(
                creditedPokemon,
                kPk5CounterImmediateKoRpcMagic,
                serverFlow,
                0);
#endif
    }
    u8* destination = attribution.playerKO
        ? &opponent.playerCreditsByEnemy[attribution.victimSubIndex - 1]
        : &opponent.enemyCreditsByPlayer[attribution.victimSubIndex - 1];
    if (*destination == 0) {
        *destination = attribution.creditedSubIndex;
    }
}

static void PackTrainerRecord(
    const PendingTrainerRecord& opponent,
    u8 output[W2U_BATTLE_LOG_RECORD_SIZE])
{
    ZeroBlock(output, W2U_BATTLE_LOG_RECORD_SIZE);

    WriteBits(output, W2U_BATTLE_LOG_TRAINER_ID_BIT, opponent.trainerID);
    WriteBits(
        output,
        W2U_BATTLE_LOG_PLAYER_COUNT_BIT,
        sPendingBattle.playerCount);
    for (u32 slot = 0; slot < W2U_BATTLE_LOG_PARTY_SLOTS; ++slot) {
        WriteBits(
            output,
            W2U_BATTLE_LOG_PLAYER_SPECIES_BIT + slot * W2U_BATTLE_LOG_SPECIES_BITS,
            sPendingBattle.playerSpecies[slot]);
        WriteBits(
            output,
            W2U_BATTLE_LOG_PLAYER_KO_CREDIT_BIT + slot * W2U_BATTLE_LOG_SLOT_BITS,
            opponent.playerCreditsByEnemy[slot]);
        WriteBits(
            output,
            W2U_BATTLE_LOG_AI_KO_CREDIT_BIT + slot * W2U_BATTLE_LOG_SLOT_BITS,
            opponent.enemyCreditsByPlayer[slot]);
    }
}

static void CommitPendingBattle(MainModule* mainModule)
{
#if defined(W2U_TARGET_BW1)
    if (!sPendingBattle.valid
        || sPendingBattle.committed
        || sPendingBattle.mainModule != mainModule) {
        return;
    }

    // Mark first so repeated result notifications cannot duplicate a battle.
    sPendingBattle.committed = true;
#else
    if (sPendingBattle.mainModule != mainModule) {
        return;
    }

    // Mark first so repeated result notifications cannot duplicate a battle.
    sPendingBattle.mainModule = 0;
#endif

    ServerFlow* serverFlow = sObservedServerFlow;
    if (serverFlow
        && serverFlow->mainModule == mainModule) {
        BattleLog_CommitIndividualCounters(serverFlow);
    }

    for (u32 opponent = 0; opponent < 2; ++opponent) {
        if (!sPendingBattle.opponents[opponent].present) {
            continue;
        }
        u8 record[W2U_BATTLE_LOG_RECORD_SIZE];
        PackTrainerRecord(sPendingBattle.opponents[opponent], record);
        AppendLogRecord(record);
    }
}

} // namespace

#if defined(W2U_TARGET_B1)
#define W2U_BATTLE_LOG_REGISTER_TARGETS_HOOK THUMB_BRANCH_93_0x21CA7F4
#define W2U_BATTLE_LOG_CHECK_FAINTED_HOOK THUMB_BRANCH_93_0x21C4F64
#define W2U_BATTLE_LOG_NOTIFY_RESULT_HOOK THUMB_BRANCH_93_0x21B916C
#elif defined(W2U_TARGET_W1)
#define W2U_BATTLE_LOG_REGISTER_TARGETS_HOOK THUMB_BRANCH_93_0x21CA814
#define W2U_BATTLE_LOG_CHECK_FAINTED_HOOK THUMB_BRANCH_93_0x21C4F84
#define W2U_BATTLE_LOG_NOTIFY_RESULT_HOOK THUMB_BRANCH_93_0x21B918C
#else
#define W2U_BATTLE_LOG_REGISTER_TARGETS_HOOK THUMB_BRANCH_ServerControl_RegisterTargets
#define W2U_BATTLE_LOG_CHECK_FAINTED_HOOK THUMB_BRANCH_ServerControl_CheckFainted
#define W2U_BATTLE_LOG_NOTIFY_RESULT_HOOK THUMB_BRANCH_MainModule_NotifyBattleResult
#endif

extern "C" u8 W2U_BATTLE_LOG_REGISTER_TARGETS_HOOK(
    ServerFlow* serverFlow,
    BattleMon* attacker,
    u32 targetPosition,
    const void* moveParam,
    // A distant THUMB_BRANCH stub saves LR on the incoming stack. Declaring
    // that word explicitly keeps the retail fifth argument at ABI slot six.
    void*,
    PokeSet* targets)
{
    EnsureTargetState(serverFlow);
    const u8 targetCount = W2U_BattleLog_OriginalRegisterTargets(
        serverFlow, attacker, targetPosition, moveParam, targets);

    if (!targetCount
        || !attacker
        || !targets
#if defined(W2U_TARGET_BW1)
        || !sPendingBattle.valid) {
#else
        || !sPendingBattle.mainModule) {
#endif
        return targetCount;
    }

    const u32 attackerSlot = attacker->battleSlot;
    if (attackerSlot >= kBattleSlotCount) {
        return targetCount;
    }

    const u32 count = targets->count < 6 ? targets->count : 6;
    for (u32 i = 0; i < count; ++i) {
        BattleMon* target = targets->battleMon[i];
        if (!target) {
            continue;
        }
        const u32 targetSlot = target->battleSlot;
        if (targetSlot < kBattleSlotCount
            && IsValidCredit(targetSlot, attackerSlot)) {
            sLastTargeter[targetSlot] = static_cast<u8>(attackerSlot);
        }
    }
    return targetCount;
}

extern "C" b32 W2U_BATTLE_LOG_CHECK_FAINTED_HOOK(
    ServerFlow* serverFlow,
    BattleMon* victim)
{
    EnsureTargetState(serverFlow);
    const KOAttribution attribution = BuildAttribution(serverFlow, victim);
    const b32 newlyFainted = W2U_BattleLog_OriginalCheckFainted(serverFlow, victim);
    if (!newlyFainted || !attribution.valid) {
        return newlyFainted;
    }

    RecordAttribution(serverFlow, attribution);
    return newlyFainted;
}

// Append complete records only once the retail battle controller publishes a
// terminal result. Aborted overlays therefore never leave half-built records.
extern "C" void W2U_BATTLE_LOG_NOTIFY_RESULT_HOOK(
    MainModule* mainModule,
    u32 result)
{
    W2U_BattleLog_OriginalNotifyBattleResult(mainModule, result);
    if (result <= 6) {
        CommitPendingBattle(mainModule);
    }
}
