#ifndef POKEBW2_SYSTEM_GAME_SYSTEM_H
#define POKEBW2_SYSTEM_GAME_SYSTEM_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/proc.h"
#include "gfl/str.h"
#include "nitro/fx.h"
#include "struct_decls.h"
#include "system/game_event.h"

typedef enum {
    GAME_ENTRYPOINT_OPENING,
    GAME_ENTRYPOINT_FIELD_CONTINUE,
    GAME_ENTRYPOINT_DEBUG,
} GameEntryPoint;

struct GameSystemProcData {
    GameEntryPoint entryPoint;
    VecFx32 spawnPos;
    u16 zoneId;
    u16 unk12;
};

// The game itself, from the title screen's choice to the reset: the process that owns the game data, the field map,
// the running event and the processes the events start
struct GameSystem {
    HeapID heapId;
    GameSystemProcData *procData;
    GameProcManager *procManager;
    // What GFL_ProcMgrUpdate returned last: 0 with no process left
    u32 procManagerState;
    // Asked for a new event each frame that none runs
    GameEventProvider eventProvider;
    void *eventProviderData;
    GameEvent *event;
    GameData *gameData;
    // NULL while the field map is down
    Field *field;
    GameCommSys *comm;
    u32 unk28;
    ISS *iss;
    LinkFestival *festival;
    // Set when a communication error is found, so that the field shows it, and cleared with the error
    u8 netErrorPending;
    // Whether an event ran at the start of the frame
    u8 eventRunning;
    // Nonzero keeps GSYS_TryBootGameComm from starting the field's communication (the scripts pause it)
    u8 gameCommPaused;
    // Set when the low battery turned the C-Gear off, until the C-Gear screen has handled it
    u8 lowBatteryCGearOff : 1;
};

extern const GameProcFunctions GAMESYSTEM_PROC_FUNCTIONS;
extern GameSystem *g_GameSystem;

GameSystemProcData *GameSystem_CreateProcData(GameEntryPoint entryPoint, u16 zoneId, VecFx32 *spawnPos, s16 unk12);
Field *GSYS_GetField(GameSystem *gsys);
// A VBlank task that draws from the random generator, which the anti-piracy checks add when they fail, and how many
// they added
void get_mt(TCB *tcb, void *data);
extern u32 g_AntiPiracyTaskCount;
// Whether the field map is up, which Game Freak's asserts call GAMESYSTEM_CheckFieldMapWork
BOOL GSYS_CheckField(GameSystem *gsys);
PlayerState *GSYS_GetPlayerState(GameSystem *gsys);
GameCommSys *GSYS_GetGameCommSystem(GameSystem *gsys);
GameData *GSYS_GetGameData(GameSystem *gsys);
LinkFestival *GSYS_GetLinkFestival(GameSystem *gsys);
BOOL GSYS_GetProcMgrState(GameSystem *gsys);
BOOL GSYS_GetEventRunningFlag(GameSystem *gsys);
// Whether an event is running
BOOL GSYS_CheckNowEvent(GameSystem *gsys);
void GSYS_QueueProc(GameSystem *gsys, s32 overlayId, const GameProcFunctions *functions, void *param);
void GSYS_QueueProcAsEvent(GameEvent *event, s32 overlayId, const GameProcFunctions *functions, void *param);
BOOL GSYS_TryBootGameComm(GameSystem *gsys);
void GSYS_SetNetErrorPending(GameSystem *gsys, u32 a1);
u8 GSYS_IsNetErrorPending(GameSystem *gsys);
void GSYS_SetGameCommPaused(GameSystem *gsys, u32 value);
u8 GSYS_IsGameCommPaused(GameSystem *gsys);
u32 GSYS_IsCGearOn(GameSystem *gsys);
void GSYS_SetCGearOn(GameSystem *gsys, u32 value);
BOOL GSYS_IsLowBatteryCGearOff(GameSystem *gsys);
ISS *GameSystem_GetISS(GameSystem *gsys);
u32 getStatusOfFesMission(LinkFestival *festival);

void GSYS_SetEventProvider(GameSystem *gsys, void *provider, void *data);
GameEvent *GSYS_GetNowEvent(GameSystem *gsys);
void GSYS_SetNowEvent(GameSystem *gsys, GameEvent *event);
void GSYS_StartFieldmapProc(GameSystem *gsys);
void GSYS_ClearLowBatteryCGearOff(GameSystem *gsys);
void GSYS_SetField(GameSystem *gsys, Field *field);

// Overlay 36's field map process (fieldmap_proc.c), declared here until its header has it
extern const GameProcFunctions FIELDMAP_PROC_FUNCS;

#endif // POKEBW2_SYSTEM_GAME_SYSTEM_H
