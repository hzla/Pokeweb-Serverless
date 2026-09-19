#include "w2u_battle_log_attribution.h"

#include <cassert>

int main()
{
    assert(W2U_BattleLogHasCurrentDirectDamage(0, true, 1));
    assert(!W2U_BattleLogHasCurrentDirectDamage(1, true, 1));
    assert(!W2U_BattleLogHasCurrentDirectDamage(0, false, 1));
    assert(!W2U_BattleLogHasCurrentDirectDamage(0, true, 0));

    // Fatal direct damage always outranks stale target history.
    assert(W2U_BattleLogSelectCredit(
               true, 0, true, true, 1, true, 2, 0xFF)
        == 0);
    // Indirect damage retains the resolved-target fallback in multi battles.
    assert(W2U_BattleLogSelectCredit(
               false, 0xFF, true, true, 1, true, 2, 0xFF)
        == 1);
    // With no direct source or target history, use the facing battler.
    assert(W2U_BattleLogSelectCredit(
               false, 0xFF, true, false, 0xFF, true, 2, 0xFF)
        == 2);
    return 0;
}
