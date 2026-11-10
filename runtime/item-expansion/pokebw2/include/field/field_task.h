#ifndef POKEBW2_FIELD_FIELD_TASK_H
#define POKEBW2_FIELD_FIELD_TASK_H

// Function names from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)

#include "types.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "struct_decls.h"

// A task that the field runs each frame until its callback returns TRUE
typedef struct FieldTask FieldTask;

typedef BOOL (*FieldTaskCallback)(void *data);

// Allocates dataSize bytes of data for the task
FieldTask *FieldTask_Create(HeapID heapId, u32 dataSize, FieldTaskCallback callback);
void FieldTask_Free(FieldTask *task);
// Runs the callback once the task has started, and ends the task when it returns TRUE
void FieldTask_Run(FieldTask *task);
void FieldTask_SetStarted(FieldTask *task);
void *FieldTask_GetData(FieldTask *task);
BOOL FieldTask_CheckStateReqEnd(FieldTask *task);
u32 FieldTask_GetState(FieldTask *task);
FieldTaskCallback FieldTask_GetCallback(FieldTask *task);
void FieldTaskManager_AddTask(FieldTaskManager *mgr, FieldTask *task, FieldTask *parent);
// Whether a task with the callback is running
BOOL FieldTaskManager_CheckCallbackRegistered(FieldTaskManager *mgr, FieldTaskCallback callback);
FieldTask *FieldActorSpinTask_CreatePlayerAccel(Field *field, u32 duration, u32 direction);
FieldTask *FieldActorSpinTask_CreatePlayer(Field *field, u32 duration, u32 direction);
// The player's spin slowing down to face dir, a wait of duration frames, and the effect task of an actor
FieldTask *FieldActorSpinTask_CreatePlayerDeaccel(Field *field, u32 duration, u32 direction, u32 dir);
FieldTask *FieldWaitTask_Create(Field *field, u16 duration);
FieldTask *FieldActorEffectTask_Create(Field *field, FieldActor *actor, u16 duration, u16 interval);
// Moves the player to pos over duration frames. pos isn't const: the original loads it only after storing duration
FieldTask *FieldPlayerMoveTask_Create(Field *field, u32 duration, VecFx32 *pos);
FieldTask *FieldActorMoveTask_CreatePlayer(Field *field, u32 duration, const VecFx32 *offset);
FieldTask *FieldActorSpinTask_Create(Field *field, u32 duration, u32 direction, FieldActor *actor);
// Moves the actor by offset, or to pos, over duration frames
FieldTask *FieldActorMoveTask_CreateRel(Field *field, s32 duration, const VecFx32 *offset, FieldActor *actor);
FieldTask *FieldActorMoveTask_CreateAbs(Field *field, s32 duration, const VecFx32 *pos, FieldActor *actor);
// Drops the actor from height onto the ground over duration frames
FieldTask *FieldActorFallTask_Create(Field *field, FieldActor *actor, u32 duration, s32 height);
// A task that fades the screen
FieldTask *FieldFadeTask_Create(Field *field, u32 mode, u32 from, u32 to, u32 speed);
// Tasks that move the camera to a zoom, angle or target offset over duration frames
FieldTask *FieldCameraMoveTaskZoom_Create(Field *field, u16 duration, fx32 zoom);
FieldTask *FieldCameraMoveTaskPitch_Callback(Field *field, u32 duration, u16 pitch);
FieldTask *FieldCameraMoveTaskYaw_Callback(Field *field, u32 duration, u16 yaw);
FieldTask *FieldCameraMoveTaskTargetOffs_Create(Field *field, u32 duration, const VecFx32 *offset);
// Moves the camera's target from one position to another
FieldTask *FieldCameraMoveTaskTarget_Create(Field *field, u16 duration, const VecFx32 *from, const VecFx32 *to);
FieldTaskManager *FieldTaskManager_Create(u32 count, HeapID heapId);
void FieldTaskManager_Free(FieldTaskManager *manager);
void FieldTaskManager_Update(FieldTaskManager *manager);

#endif // POKEBW2_FIELD_FIELD_TASK_H
