#include "w2u_menu_evolution_logic.h"

#include <cstdint>

static void WriteU16(uint8_t* data, uint16_t value)
{
    data[0] = static_cast<uint8_t>(value);
    data[1] = static_cast<uint8_t>(value >> 8);
}

static void SetEvolution(
    uint8_t* record,
    uint32_t slot,
    uint16_t method,
    uint16_t parameter,
    uint16_t target)
{
    uint8_t* entry = record + slot * 6;
    WriteU16(entry, method);
    WriteU16(entry + 2, parameter);
    WriteU16(entry + 4, target);
}

static int Expect(bool value, int failure)
{
    return value ? 0 : failure;
}

int main()
{
    W2UMenuEvolutionSnapshot snapshot = {1, 0, 20, 3, 7, 5};
    uint8_t retail[42] = {};
    SetEvolution(retail, 0, 4, 20, 2);
    if (int error = Expect(W2UMenuEvolutionResolveRecord(retail, sizeof(retail), 100, snapshot) == 2, 1)) return error;
    snapshot.level = 19;
    if (int error = Expect(W2UMenuEvolutionResolveRecord(retail, sizeof(retail), 100, snapshot) == 0, 2)) return error;

    uint8_t expanded[48] = {};
    SetEvolution(expanded, 0, 29, 4, 3);
    SetEvolution(expanded, 1, 30, 7, 4);
    SetEvolution(expanded, 2, 31, 5, 5);
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 100, snapshot) == 4, 3)) return error;
    snapshot.battlesBrought = 6;
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 100, snapshot) == 5, 4)) return error;
    snapshot.battlesUsed = 4;
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 100, snapshot) == 0, 5)) return error;

    SetEvolution(expanded, 0, 29, 0, 9);
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 100, snapshot) == 9, 6)) return error;
    SetEvolution(expanded, 0, 29, 0, 100);
    SetEvolution(expanded, 1, 29, 0, 1100);
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 1200, snapshot) == 100, 7)) return error;
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 100, snapshot) == 0, 8)) return error;
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, 44, 1200, snapshot) == 0, 9)) return error;

    SetEvolution(expanded, 0, 29, 0, 1100);
    SetEvolution(expanded, 1, 30, 0, 11);
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 1200, snapshot) == 1100, 10)) return error;
    SetEvolution(expanded, 0, 30, 0, 11);
    SetEvolution(expanded, 1, 29, 1, 12);
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 1200, snapshot, 29) == 12, 11)) return error;
    if (int error = Expect(W2UMenuEvolutionResolveRecord(expanded, sizeof(expanded), 1200, snapshot, 31) == 0, 12)) return error;

    // Regression: level-100 Charizard reaches one KO. The battle-return
    // candidate pass must feed its separate resolver, not the party menu.
    uint8_t charizardEvolution[42] = {};
    SetEvolution(charizardEvolution, 0, 29, 1, 9);
    W2UMenuEvolutionSnapshot charizard = {6, 0, 100, 1, 1, 1};
    const uint16_t blastoise = W2UMenuEvolutionResolveRecord(
        charizardEvolution, sizeof(charizardEvolution), 709, charizard, 29);
    if (int error = Expect(blastoise == 9, 13)) return error;
    int party[6] = {};
    W2UMenuPostBattleEvolution pending = {};
    W2UMenuPostBattleEvolutionQueue(pending, 0, &party[0], blastoise);
    uint32_t condition = 0xdeadbeef;
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[0], 0, 0, &condition) == 9 && condition == 4, 14)) return error;
    // No repeated evolution after consumption/cancellation.
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[0], 0, 0, &condition) == 0, 15)) return error;

    W2UMenuPostBattleEvolutionQueue(pending, 0, &party[0], 9);
    condition = 8;
    // Another Pokemon or item/trade check cannot consume this request.
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[1], 0, 0, &condition) == 0, 16)) return error;
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[0], 25, 2, &condition) == 25 && condition == 8, 17)) return error;
    // A vanilla evolution wins, with its full condition untouched.
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[0], 26, 0, &condition) == 26 && condition == 8, 18)) return error;
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[0], 0, 0, &condition) == 0, 19)) return error;

    for (uint32_t slot = 0; slot < 6; ++slot) {
        W2UMenuPostBattleEvolutionQueue(pending, slot, &party[slot], static_cast<uint16_t>(slot + 1));
    }
    W2UMenuPostBattleEvolutionQueue(pending, 6, &party[0], 999);
    for (uint32_t slot = 0; slot < 6; ++slot) {
        if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[slot], 0, 0, 0) == slot + 1, 20)) return error;
    }
    W2UMenuPostBattleEvolutionQueue(pending, 0, &party[0], 9);
    W2UMenuPostBattleEvolutionClear(pending); // Called before every battle return, including wild/loss.
    condition = 0xaabbccdd;
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[0], 0, 0, &condition) == 0 && condition == 0xaabbccdd, 21)) return error;
    W2UMenuPostBattleEvolutionQueue(pending, 0, &party[0], 0);
    if (int error = Expect(W2UMenuPostBattleEvolutionTake(pending, &party[0], 0, 0, &condition) == 0, 22)) return error;
    return 0;
}
