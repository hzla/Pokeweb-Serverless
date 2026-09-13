#ifndef __W2U_BATTLE_LOG_H
#define __W2U_BATTLE_LOG_H

#include "swan/swantypes.h"

// The log replaces the normal-save Wi-Fi History, Pal Pad/Wi-Fi List, and
// Wi-Fi Negotiation blocks. Each block owns its own header so the game's
// existing per-block checksum and mirrored-save handling remain intact.
#define W2U_BATTLE_LOG_MAGIC 0x474F4C4B // "KLOG" in little-endian storage
#define W2U_BATTLE_LOG_VERSION 2
#define W2U_BATTLE_LOG_HEADER_SIZE 16
#define W2U_BATTLE_LOG_RECORD_SIZE 14
#define W2U_BATTLE_LOG_MAX_RECORDS 600
#define W2U_BATTLE_LOG_PARTY_SLOTS 6
#define W2U_BATTLE_LOG_PARTNER_KO_CREDIT 7

#define W2U_BATTLE_LOG_BLOCK_WIFI_HISTORY 29
#define W2U_BATTLE_LOG_BLOCK_WIFI_LIST 30
#define W2U_BATTLE_LOG_BLOCK_WIFI_NEGOTIATION 31

#define W2U_BATTLE_LOG_WIFI_HISTORY_SIZE 0x1338
#define W2U_BATTLE_LOG_WIFI_LIST_SIZE 0x07C4
#define W2U_BATTLE_LOG_WIFI_NEGOTIATION_SIZE 0x0D54

#define W2U_BATTLE_LOG_WIFI_HISTORY_CAPACITY 350
#define W2U_BATTLE_LOG_WIFI_LIST_CAPACITY 140
#define W2U_BATTLE_LOG_WIFI_NEGOTIATION_CAPACITY 110

#define W2U_BATTLE_LOG_FLAG_OVERFLOW 0x0001

// On-disk 112-bit trainer-battle record (three high bits are reserved):
//   bits   0..9   AI trainer ID
//   bits  10..12  player party count (1..6)
//   bits  13..72  six player species IDs (10 bits each)
//   bits  73..90  enemy sub-index -> credited player party slot (3 bits each),
//                 where 7 means the player's AI partner received the KO
//   bits 91..108  player party slot -> credited enemy sub-index (3 bits each)
//   bits 109..111 reserved, zero
#define W2U_BATTLE_LOG_TRAINER_ID_BIT 0
#define W2U_BATTLE_LOG_PLAYER_COUNT_BIT 10
#define W2U_BATTLE_LOG_PLAYER_SPECIES_BIT 13
#define W2U_BATTLE_LOG_PLAYER_KO_CREDIT_BIT 73
#define W2U_BATTLE_LOG_AI_KO_CREDIT_BIT 91
#define W2U_BATTLE_LOG_RESERVED_BIT 109

#define W2U_BATTLE_LOG_SPECIES_BITS 10
#define W2U_BATTLE_LOG_SLOT_BITS 3

// Individual-Pokemon counters stored in otherwise reserved portions of the
// encrypted 136-byte Gen 5 PK5 core. These are logical, de-shuffled offsets
// from the start of BoxPkm, not physical offsets in every PID permutation.
//
// Block B's final bytes were dummy data in both BW and B2W2. The KO counter is
// deliberately split across PKHeX-recognized unused bytes 0x43 and 0x5E. A
// nonzero u32 at 0x64 made PKHeX's Gen 4/5 encryption probe decrypt an already
// decrypted PK5 a second time. Block D is intentionally not used: B2W2 assigns
// its final bytes to N-Pokemon and Pokestar Studios metadata.
#define W2U_PK5_SIZE 136
#define W2U_PK5_ENCRYPTED_DATA_OFFSET 0x08
#define W2U_PK5_ENCRYPTED_DATA_SIZE 0x80
#define W2U_PK5_BLOCK_SIZE 0x20
#define W2U_PK5_BLOCK_B_OFFSET 0x28
#define W2U_PK5_BLOCK_C_OFFSET 0x48

#define W2U_PK5_BATTLES_BROUGHT_OFFSET 0x44
#define W2U_PK5_BATTLES_USED_OFFSET 0x46
#define W2U_PK5_KOS_LOW_OFFSET 0x43
#define W2U_PK5_KOS_HIGH_OFFSET 0x5E
#define W2U_PK5_LEGACY_KOS_OFFSET 0x64

#define W2U_PK5_COUNTERS_IN_BLOCK_OFFSET 0x1C
#define W2U_PK5_KOS_LOW_IN_BLOCK_B_OFFSET 0x1B
#define W2U_PK5_KOS_HIGH_IN_BLOCK_C_OFFSET 0x16
#define W2U_PK5_LEGACY_KOS_IN_BLOCK_C_OFFSET 0x1C

#ifdef __cplusplus
struct W2UPk5BattleCounterBlockB {
    u8 preserved[W2U_PK5_KOS_LOW_IN_BLOCK_B_OFFSET];
    u8 kosLow;
    u16 battlesBrought;
    u16 battlesUsed;
};

struct W2UPk5BattleCounterBlockC {
    u8 preservedBeforeKoHigh[W2U_PK5_KOS_HIGH_IN_BLOCK_C_OFFSET];
    u8 kosHigh;
    u8 preservedBeforeLegacyKos[
        W2U_PK5_LEGACY_KOS_IN_BLOCK_C_OFFSET
        - W2U_PK5_KOS_HIGH_IN_BLOCK_C_OFFSET - 1];
    u16 legacyKos;
    u16 legacyReservedRibbonBits;
};

static inline u16 W2U_ReadSplitPk5KoCounter(
    const W2UPk5BattleCounterBlockB* blockB,
    const W2UPk5BattleCounterBlockC* blockC)
{
    return static_cast<u16>(blockB->kosLow)
        | static_cast<u16>(static_cast<u16>(blockC->kosHigh) << 8);
}

static inline u16 W2U_ReadPk5KoCounter(
    const W2UPk5BattleCounterBlockB* blockB,
    const W2UPk5BattleCounterBlockC* blockC)
{
    const u16 splitValue = W2U_ReadSplitPk5KoCounter(blockB, blockC);
    return splitValue != 0 ? splitValue : blockC->legacyKos;
}

static inline void W2U_WritePk5KoCounter(
    W2UPk5BattleCounterBlockB* blockB,
    W2UPk5BattleCounterBlockC* blockC,
    u16 value)
{
    blockB->kosLow = static_cast<u8>(value & 0xFF);
    blockC->kosHigh = static_cast<u8>(value >> 8);
    // Migrate old logger data and remove PKHeX's false encryption sentinel.
    blockC->legacyKos = 0;
}

static_assert(sizeof(W2UPk5BattleCounterBlockB) == W2U_PK5_BLOCK_SIZE,
    "PK5 Block B counter view must remain 32 bytes");
static_assert(sizeof(W2UPk5BattleCounterBlockC) == W2U_PK5_BLOCK_SIZE,
    "PK5 Block C counter view must remain 32 bytes");
static_assert(__builtin_offsetof(W2UPk5BattleCounterBlockB, battlesBrought)
        == W2U_PK5_COUNTERS_IN_BLOCK_OFFSET,
    "battles-brought offset changed");
static_assert(__builtin_offsetof(W2UPk5BattleCounterBlockB, battlesUsed)
        == W2U_PK5_COUNTERS_IN_BLOCK_OFFSET + sizeof(u16),
    "battles-used offset changed");
static_assert(__builtin_offsetof(W2UPk5BattleCounterBlockB, kosLow)
        == W2U_PK5_KOS_LOW_IN_BLOCK_B_OFFSET,
    "KO low-byte offset changed");
static_assert(__builtin_offsetof(W2UPk5BattleCounterBlockC, kosHigh)
        == W2U_PK5_KOS_HIGH_IN_BLOCK_C_OFFSET,
    "KO high-byte offset changed");
static_assert(__builtin_offsetof(W2UPk5BattleCounterBlockC, legacyKos)
        == W2U_PK5_LEGACY_KOS_IN_BLOCK_C_OFFSET,
    "legacy KO offset changed");
static_assert(W2U_PK5_BLOCK_B_OFFSET
        + __builtin_offsetof(W2UPk5BattleCounterBlockB, battlesBrought)
        == W2U_PK5_BATTLES_BROUGHT_OFFSET,
    "absolute battles-brought offset changed");
static_assert(W2U_PK5_BLOCK_B_OFFSET
        + __builtin_offsetof(W2UPk5BattleCounterBlockB, battlesUsed)
        == W2U_PK5_BATTLES_USED_OFFSET,
    "absolute battles-used offset changed");
static_assert(W2U_PK5_BLOCK_B_OFFSET
        + __builtin_offsetof(W2UPk5BattleCounterBlockB, kosLow)
        == W2U_PK5_KOS_LOW_OFFSET,
    "absolute KO low-byte offset changed");
static_assert(W2U_PK5_BLOCK_C_OFFSET
        + __builtin_offsetof(W2UPk5BattleCounterBlockC, kosHigh)
        == W2U_PK5_KOS_HIGH_OFFSET,
    "absolute KO high-byte offset changed");
static_assert(W2U_PK5_BLOCK_C_OFFSET
        + __builtin_offsetof(W2UPk5BattleCounterBlockC, legacyKos)
        == W2U_PK5_LEGACY_KOS_OFFSET,
    "absolute legacy KO offset changed");
#endif

#endif // __W2U_BATTLE_LOG_H
