#ifndef POKEBW2_FIELD_MUS_COMM_FUNC_H
#define POKEBW2_FIELD_MUS_COMM_FUNC_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/net.h"
#include "struct_decls.h"

// The communication work of a show, whose layout only mus_comm_func.c needs
typedef struct MusCommWork MusCommWork;

// mus_comm_func.c, overlay 211, which the ROM names: the musical's communication between the players of a show

void MusComm_Boot(HeapID heapId, GameSystem *gsys, GameCommSys *comm, u16 value);
void MusComm_Quit(MusCommWork *comm);
void MusComm_UpdateRole(MusCommWork *comm);
void MusComm_RegisterCommands(MusCommWork *comm);
void MusComm_SetUp(MusCommWork *comm, PlayerInfo *info, BoxPkm *pkm, GameCommSys *gameComm, Ov210Work *ov210,
                   HeapID heapId);
// Sends a timing number to synchronize on, and whether the others reached it (or the connection failed)
void MusComm_SendTiming(MusCommWork *comm, u8 timing);
BOOL MusComm_IsTimingReached(MusCommWork *comm, u8 timing);
void MusComm_StartSendingSound(MusCommWork *comm);
// Whether the sound data has all arrived
BOOL MusComm_IsSoundReceived(MusCommWork *comm);
PlayerInfo *MusComm_GetPlayerInfo(MusCommWork *comm, u8 index);
BoxPkm *MusComm_GetPlayerPkm(MusCommWork *comm, u8 index);
MusicalPoke *MusComm_GetPokeByPos(MusCommWork *comm, u8 index);
BOOL MusComm_IsProgramReceived(MusCommWork *comm);
BOOL MusComm_IsScriptReceived(MusCommWork *comm);
u8 MusComm_GetSelfPos(MusCommWork *comm);
// The players' props on the stage: asks to use one, and whether it was sent; the prop each Pokémon uses (10 for
// none), which is then cleared; the position of the Pokémon in the limelight (4 or more for none), cleared with
// MusComm_ClearLimelightPos; and the result of a prop's use
BOOL MusComm_RequestEquip(MusCommWork *comm, u8 equip);
void MusComm_SetEquipRequest(MusCommWork *comm, u8 pos, u8 equip);
u8 MusComm_GetEquipUsed(MusCommWork *comm, u8 pos);
void MusComm_ClearEquipUsed(MusCommWork *comm, u8 pos);
u8 MusComm_GetLimelightPos(MusCommWork *comm);
void MusComm_ClearLimelightPos(MusCommWork *comm);
void MusComm_QueueEquipResult(MusCommWork *comm, u8 pos, u8 equip, u32 result);
u8 MusComm_GetPlayerPos(MusCommWork *comm, u8 index);
u16 *MusComm_GetPlayerMusicalId(MusCommWork *comm, u8 index);
BOOL MusComm_IsParent(MusCommWork *comm);
BOOL MusComm_AreAllInfoReceived(MusCommWork *comm);
BOOL MusComm_AreAllPokesReceived(MusCommWork *comm);
void MusComm_BeginDataTiming(MusCommWork *comm, u32 a1, u32 a2);
void MusComm_BeginProgramTiming(MusCommWork *comm);
void MusComm_BeginSendPoke(MusCommWork *comm, MusicalPoke *poke);
u32 MusComm_GetUnk144(MusCommWork *comm);
u32 MusComm_GetUnk148(MusCommWork *comm);
u8 MusComm_GetPlayerEquip(MusCommWork *comm, u8 index, u8 a2);
// The network init data, which overlay 174 gets as a number
const GFLNetInitData *MusComm_GetNetInitData(GameData *gameData);
// Its GameCommSys callbacks for GAME_COMM_NO_MUSICAL (see game_comm.c)
void *MusComm_Init(u32 *seq, void *param);
BOOL MusComm_Exit(u32 *seq, void *param, void *work);
BOOL MusComm_ExitWait(u32 *seq, void *param, void *work);
void MusComm_Update(u32 *seq, void *param, void *work);

#endif // POKEBW2_FIELD_MUS_COMM_FUNC_H
