#ifndef __W2U_BATTLE_LOG_ATTRIBUTION_H
#define __W2U_BATTLE_LOG_ATTRIBUTION_H

#include "swan/swantypes.h"

static inline bool W2U_BattleLogHasCurrentDirectDamage(
    u8 turnCheckSequence,
    bool directlyDamaged,
    u8 recordCount)
{
    return turnCheckSequence == 0 && directlyDamaged && recordCount != 0;
}

static inline u8 W2U_BattleLogSelectCredit(
    bool directValid,
    u8 directSlot,
    bool multiBattle,
    bool lastTargeterValid,
    u8 lastTargeter,
    bool fallbackValid,
    u8 fallback,
    u8 invalidSlot)
{
    if (directValid) {
        return directSlot;
    }
    if (multiBattle && lastTargeterValid) {
        return lastTargeter;
    }
    return fallbackValid ? fallback : invalidSlot;
}

#endif
