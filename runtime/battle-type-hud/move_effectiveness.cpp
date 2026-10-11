// Independent move-preview module: no gauge hooks, icon records or allocations.
#if defined(GAME_B) || defined(GAME_W)
#define BW1_MOVE_PROFILE
#endif
#include "hud_common.h"
#include "move_layout.h"
#include "move_colors.h"
#if defined(GAME_B)
#include "build/hooks-MoveEffectiveness-B.h"
#elif defined(GAME_W)
#include "build/hooks-MoveEffectiveness-W.h"
#elif defined(GAME_B2)
#include "build/hooks-MoveEffectiveness-B2.h"
#else
#include "build/hooks-MoveEffectiveness-W2.h"
#endif
