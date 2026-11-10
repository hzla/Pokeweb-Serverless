#ifndef POKEBW2_FIELD_PLAYER_ACTION_H
#define POKEBW2_FIELD_PLAYER_ACTION_H

#include "types.h"
#include "nitro/fx.h"
#include "struct_decls.h"

// The number of field actions that PlayerActionPerms blocks or allows
#define PLAYER_ACTION_COUNT 12

// What the player may do where they stand: player_action_perms.c holds the accessors, overlay 12 the Create
struct PlayerActionPerms {
    u32 unk0;
    u32 exState;
    u16 paired;
    u8 unkA[10];
    // For each field action, -1 if it is blocked where the player stands
    s8 blocked[PLAYER_ACTION_COUNT];
};

// What the player can do where they stand, which the hidden moves check
struct PlayerActionPossibilities {
    u16 zoneId;
    u16 flags;
    u32 exState;
    GameSystem *gsys;
    FieldActor *actorInFront;
    Field *field;
};

// Overlay 12: whether an actor is a Strength boulder, and whether a boulder at the position stays where it was pushed
BOOL IsNPCStrengthRock(u16 objCode);
BOOL IsSavedStrengthRockAtPos(MMSys *actorSystem, const VecFx32 *position);

void PlayerActionPerms_Create(PlayerActionPerms *perms, GameSystem *gsys, Field *field);
void PlayerActionPerms_SetActionBlocked(PlayerActionPerms *perms, u32 action, s32 blocked);
u8 PlayerActionPerms_IsActionBlocked(PlayerActionPerms *perms, u32 action);

#endif // POKEBW2_FIELD_PLAYER_ACTION_H
