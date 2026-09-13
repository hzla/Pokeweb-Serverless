#ifndef W2U_MENU_EVOLUTION_LOGIC_H
#define W2U_MENU_EVOLUTION_LOGIC_H

#include <stdint.h>

struct W2UMenuEvolutionSnapshot {
    uint16_t species;
    uint16_t form;
    uint16_t level;
    uint16_t kos;
    uint16_t battlesBrought;
    uint16_t battlesUsed;
};

// Bind post-battle requests to the destination party Pokemon, which retail
// copies in place between collecting candidates and launching evolution.
// Do not use the field-menu pending request or a global SHINKA_Check fallback:
// wild battles and unrelated level/item/script checks must remain vanilla.
struct W2UMenuPostBattleEvolution {
    const void* pokemon[6];
    uint16_t target[6];
};

static inline void W2UMenuPostBattleEvolutionClear(W2UMenuPostBattleEvolution& pending)
{
    for (uint32_t slot = 0; slot < 6; ++slot) {
        pending.pokemon[slot] = 0;
        pending.target[slot] = 0;
    }
}

static inline void W2UMenuPostBattleEvolutionQueue(
    W2UMenuPostBattleEvolution& pending, uint32_t slot, const void* pokemon, uint16_t target)
{
    if (slot < 6 && pokemon && target != 0) {
        pending.pokemon[slot] = pokemon;
        pending.target[slot] = target;
    }
}

static inline uint16_t W2UMenuPostBattleEvolutionTake(
    W2UMenuPostBattleEvolution& pending, const void* pokemon, uint16_t retailTarget,
    uint32_t checkType, uint32_t* condition)
{
    if (!pokemon || checkType != 0) return retailTarget;
    for (uint32_t slot = 0; slot < 6; ++slot) {
        if (pending.pokemon[slot] != pokemon) continue;
        const uint16_t target = pending.target[slot];
        pending.pokemon[slot] = 0;
        pending.target[slot] = 0;
        // Keep vanilla evolution precedence and consume each request once,
        // including when the player later cancels the evolution animation.
        if (retailTarget != 0 || target == 0) return retailTarget;
        if (condition) *condition = 4; // SHINKA_COND is a 32-bit enum.
        return target;
    }
    return retailTarget;
}

static inline uint16_t W2UMenuEvolutionReadU16(const uint8_t* data)
{
    return static_cast<uint16_t>(data[0] | (data[1] << 8));
}

static inline uint16_t W2UMenuEvolutionResolveRecord(
    const uint8_t* evolution,
    uint32_t recordSize,
    uint32_t memberCount,
    const W2UMenuEvolutionSnapshot& snapshot,
    uint16_t requiredMethod = 0)
{
    const uint32_t slotCount = recordSize == 42
        ? 7
        : recordSize == 48
            ? 8
            : 0;
    if (!evolution || slotCount == 0) {
        return 0;
    }

    for (uint32_t slot = 0; slot < slotCount; ++slot) {
        const uint8_t* entry = evolution + slot * 6;
        const uint16_t method = W2UMenuEvolutionReadU16(entry);
        const uint16_t parameter = W2UMenuEvolutionReadU16(entry + 2);
        const uint16_t target = W2UMenuEvolutionReadU16(entry + 4);
        if ((requiredMethod != 0 && method != requiredMethod)
            || target == 0 || target >= memberCount) {
            continue;
        }

        const bool eligible = (method == 4 && snapshot.level >= parameter)
            || (method == 29 && snapshot.kos >= parameter)
            || (method == 30 && snapshot.battlesBrought >= parameter)
            || (method == 31 && snapshot.battlesUsed >= parameter);
        if (eligible) {
            return target;
        }
    }
    return 0;
}

#endif
