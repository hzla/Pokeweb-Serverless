// Independent move-preview module: no gauge hooks, icon records or allocations.
#include "hud_common.h"
#include "move_colors.h"
#ifdef GAME_B2
#include "build/hooks-MoveEffectiveness-B2.h"
#else
#include "build/hooks-MoveEffectiveness-W2.h"
#endif
