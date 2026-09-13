#include "w2u_ko_move_pending.h"

#undef NDEBUG
#include <cassert>

static void TestLearningSessions()
{
    constexpr uint16_t fireBlast = 126, surf = 57, flareBlitz = 394;
    constexpr uint16_t full = 0x8000, alreadyKnown = 0xFFFE;
    bool koOnly = false;
    int levelIndex = 0, levelCalls = 0, koCalls = 0;
    uint16_t koResult = fireBlast | full;
    const auto levelCheck = [&]() -> uint16_t {
        ++levelCalls;
        return levelIndex++ == 0 ? flareBlitz | full : 0;
    };
    const auto koCheck = [&]() -> uint16_t {
        ++koCalls;
        const auto result = koResult;
        koResult = 0;
        return result;
    };
    const auto check = [&]() {
        return W2U_CheckBattleMoveLearn(koOnly, levelCheck, koCheck);
    };

    // A real level 99 -> 100 entry still offers its level move and KO move.
    assert(check() == (flareBlitz | full));
    assert(koCalls == 0);
    assert(check() == (fireBlast | full));
    assert(check() == 0);
    assert(!koOnly);

    // KO #2 at level 100 resets the retail cursor, but must only offer Surf.
    // This also covers declining Flare Blitz: it is still absent from PK5,
    // so re-running the retail checker would offer it again.
    levelIndex = 0;
    const int callsBeforeKo = levelCalls;
    koOnly = true;
    koResult = surf | full;
    assert(check() == (surf | full));
    assert(koOnly); // Last KO entry consumed, but its prompt is still open.
    assert(check() == 0); // Accept OR decline ends without a level replay.
    assert(!koOnly && levelCalls == callsBeforeKo);

    // An ordinary level-up for the next Pokemon is not suppressed.
    assert(check() == (flareBlitz | full));
    assert(check() == 0);

    // Below level 100, a zero-EXP KO check may run before real EXP arrives.
    // Learning into an empty slot and already-known moves retain KO-only
    // mode just like replacement prompts, even when several moves qualify.
    koOnly = true;
    levelIndex = 0;
    const int callsBeforeZeroExp = levelCalls;
    koResult = fireBlast;
    assert(check() == fireBlast && koOnly);
    koResult = alreadyKnown;
    assert(check() == alreadyKnown && koOnly);
    koResult = surf;
    assert(check() == surf && koOnly);
    assert(check() == 0 && !koOnly);
    assert(levelCalls == callsBeforeZeroExp);
    assert(check() == (flareBlitz | full)); // Later genuine level-up.
    assert(check() == 0);

    // No qualifying KO entries (or a missing/invalid member) still clears
    // the session, without consulting the current-level learnset at all.
    koOnly = true;
    const int callsBeforeEmpty = levelCalls;
    assert(check() == 0 && !koOnly);
    assert(levelCalls == callsBeforeEmpty);
}

int main()
{
    TestLearningSessions();
    W2UKoMovePending entries[W2U_KO_MOVE_PLAYER_SLOTS] = {};
    struct Pokemon { uint32_t pid; };
    // nolearn.dst: two allocations, same Charizard and original battle ID.
    Pokemon server = {0xBF94A262}, client = {0xBF94A262};
    assert(&server != &client);
    assert(W2U_FindPendingKoMove(entries, 0, client.pid) == nullptr);
    assert(W2U_QueuePendingKoMove(entries, 0, server.pid, 0, 1));
    auto* pending = W2U_FindPendingKoMove(entries, 0, client.pid);
    assert(pending == &entries[0]);
    assert(pending->lowerExclusive == 0 && pending->upperInclusive == 1);
    assert(pending->nextIndex == 0);

    // Identical PIDs in another party slot must not steal the learning request.
    assert(W2U_FindPendingKoMove(entries, 1, client.pid) == nullptr);
    assert(W2U_FindPendingKoMove(entries, 0, client.pid + 1) == nullptr);
    const uint32_t nonPlayerIds[] = {6, 12, 18, 255};
    for (uint32_t id : nonPlayerIds) {
        assert(W2U_FindPendingKoMove(entries, id, client.pid) == nullptr);
        assert(!W2U_QueuePendingKoMove(entries, id, client.pid, 0, 1));
    }
    // Switching/party reordering changes pointers, not original battle IDs.
    Pokemon sortedClient = client;
    assert(W2U_FindPendingKoMove(entries, 0, sortedClient.pid) == pending);

    // A second KO before the client drains commands extends the same range.
    pending->nextIndex = 1;
    assert(W2U_QueuePendingKoMove(entries, 0, server.pid, 1, 2));
    assert(pending->lowerExclusive == 0 && pending->upperInclusive == 2);
    assert(pending->nextIndex == 1);
    pending->pending = false;
    assert(W2U_FindPendingKoMove(entries, 0, client.pid) == nullptr);
    assert(W2U_QueuePendingKoMove(entries, 0, server.pid, 2, 3));
    assert(pending->lowerExclusive == 2 && pending->nextIndex == 0);

    // Reused slot in a later battle cannot inherit another Pokemon's range.
    assert(W2U_QueuePendingKoMove(entries, 0, 42, 8, 9));
    assert(W2U_FindPendingKoMove(entries, 0, client.pid) == nullptr);
    assert(pending->lowerExclusive == 8 && pending->upperInclusive == 9);
    assert(!W2U_QueuePendingKoMove(entries, 0, 42, 65535, 65535));
    assert(!W2U_QueuePendingKoMove(entries, 0, 42, 10, 9));

    // Each of the six original player IDs is independent, including slot 5.
    for (uint32_t id = 0; id < W2U_KO_MOVE_PLAYER_SLOTS; ++id) {
        entries[id].pending = false;
        assert(W2U_QueuePendingKoMove(entries, id, client.pid, 0, 1));
        assert(W2U_FindPendingKoMove(entries, id, server.pid) == &entries[id]);
    }
    return 0;
}
