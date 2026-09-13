#ifndef W2U_KO_MOVE_PENDING_H
#define W2U_KO_MOVE_PENDING_H

#include <stdint.h>

constexpr uint32_t W2U_KO_MOVE_PLAYER_SLOTS = 6;

struct W2UKoMovePending {
    uint32_t pid;
    uint16_t lowerExclusive;
    uint16_t upperInclusive;
    uint8_t nextIndex;
    bool pending;
};

// BattleMon IDs are stable across switching/party sorting. Client and server
// have separate PK5 allocations, so their pointers must never be compared.
static inline W2UKoMovePending* W2U_FindPendingKoMove(
    W2UKoMovePending* entries, uint32_t battleSlot, uint32_t pid)
{
    if (battleSlot >= W2U_KO_MOVE_PLAYER_SLOTS) {
        return 0; // Includes NPC partners and both opposing trainers.
    }
    W2UKoMovePending& entry = entries[battleSlot];
    return entry.pending && entry.pid == pid ? &entry : 0;
}

static inline bool W2U_QueuePendingKoMove(
    W2UKoMovePending* entries, uint32_t battleSlot, uint32_t pid,
    uint16_t oldKos, uint16_t newKos)
{
    if (battleSlot >= W2U_KO_MOVE_PLAYER_SLOTS || newKos <= oldKos) {
        return false;
    }
    W2UKoMovePending& entry = entries[battleSlot];
    if (!entry.pending || entry.pid != pid) {
        entry.pid = pid;
        entry.lowerExclusive = oldKos;
        entry.nextIndex = 0;
        entry.pending = true;
    }
    entry.upperInclusive = newKos;
    return true;
}

// The retail learning loop resets its level-learnset cursor on every entry.
// A synthetic zero-EXP entry must therefore skip that learnset for the whole
// session, including all prompts/retries, until NONE ends the retail loop.
// The battle client executes these sessions serially. Real level-up entries
// keep their ordinary learnset first, followed by any pending KO moves.
template <typename LevelCheck, typename KoCheck>
static inline uint16_t W2U_CheckBattleMoveLearn(
    bool& koOnlySession, LevelCheck levelCheck, KoCheck koCheck)
{
    if (!koOnlySession) {
        const uint16_t levelMove = levelCheck();
        if (levelMove != 0) {
            return levelMove;
        }
    }
    const uint16_t koMove = koCheck();
    if (koMove == 0) {
        koOnlySession = false;
    }
    return koMove;
}

#endif
