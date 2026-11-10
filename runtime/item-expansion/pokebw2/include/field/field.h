#ifndef POKEBW2_FIELD_FIELD_H
#define POKEBW2_FIELD_FIELD_H

#include "types.h"
// For the files that call field_msgbg.c through this header: comm_entry_menu.c, field_subscreen.c and fieldmap.c
#include "field/field_msgbg.h"
#include "gfl/bmpwin.h"
#include "gfl/g3d.h"
#include "gfl/heap.h"
#include "gfl/tcb.h"
#include "nitro/fx.h"
#include "struct_decls.h"
#include "system/bmp_menulist.h"

void BeginContinuePlaceNameDisp(PlaceName *placeName, s32 zoneId);
void BeginForcePlaceNameDisp(PlaceName *placeName, s32 zoneId);
void EncEff_StartEvent(EncEff *encEff, GameEvent *event, s32 effect);
void FieldG2D_Prepare3DSurface(Field *field);
void FieldG2D_SetLCDConfig(void);
FieldActor *FieldPlayer_GetActor(FieldPlayer *player);
// GENDER_MALE or GENDER_FEMALE
u32 FieldPlayer_GetSex(FieldPlayer *player);
void FieldPlayer_GetWPos(FieldPlayer *player, VecFx32 *pos);
u16 FieldPlayer_GetFaceDir(FieldPlayer *player);
// The unit vector of the direction on the grid, and the rail position a step in the direction on rails
void func_ov036_0219aab0(FieldPlayer *player, u16 dir, VecFx32 *vec);
// Whether the player is on a catwalk, and takes them off it
BOOL func_ov036_0219ac8c(FieldPlayer *player);
void func_ov036_0219acac(FieldPlayer *player);
void func_ov036_0219ad30(FieldPlayer *player, u16 dir, RailPosition *pos);
// The player's object code for a sex, in a form or an extra state
u16 FieldPlayer_GetObjCodeByForme(u32 sex, u32 forme);
u16 FieldPlayer_GetObjCodeByExState(u32 sex, u32 exState);
void *Field_GetMsgBGSys(Field *field);
BOOL Field_IsEventRunning(Field *field);
u32 Field_GetRenderMode(Field *field);
void Field_SetRenderMode(Field *field, u32 mode);
void *Field_GetSceneArea(Field *field);
void Field_SetFadeFlag(Field *field, BOOL flag);
u16 Field_GetDayPeriod(Field *field);
BOOL Field_GetSeasonBannerOverdrawFlag(Field *field);
void Field_SetEffectRunningFlag(Field *field, BOOL flag);
void *Field_GetNDemoDataHandle(Field *field);
void Field_SetCasteliaRush(Field *field, CasteliaRush *rush);
CasteliaRush *Field_GetCasteliaRush(Field *field);
void *Field_GetColorPostFX(Field *field);
void Field_SetPlayerPosPtr(Field *field, VecFx32 *position);
// The money window that the scripts show on the field's message BG
void *Field_GetMoneyWin(Field *field);
void Field_SetMoneyWin(Field *field, void *moneyWin);
// Recolors a texture resource with the field's color post-FX
void FieldColorPostFX_Apply(void *postFx, void *texture);
fx32 Field_GetActorYOffset(Field *field);
void FieldPlayer_GetGPos(FieldPlayer *player, s16 *x, s16 *y, s16 *z);
// A number below 6 that overlay 137 reads from the game data
u32 TrainerCard_CountStars(GameData *gameData);
// The grid position in front of the player, facing dir
void GetPlayerGPosPlusDir(FieldPlayer *player, u16 dir, s16 *x, s16 *y, s16 *z);
// Where a balloon over an actor goes, from where the player stands, and the offset and window position of each
u8 ActorMsgWin_CalcWinPosAuto(FieldActor *player, const VecFx32 *pos);
void func_ov036_021a8bec(const VecFx32 *pos, VecFx32 *offset, G3DCamera *g3dCamera, FieldCamera *camera, u8 winPos);
void func_ov036_021a8c00(u32 winPos, u32 *a1, u32 *a2);
GameEvent *JoinAvenueNameEntry_Create(u16 target, GameSystem *gsys, u16 *result, u16 useCurrent);
// Check the party and the Battle Box against a regulation. func_ov036_021aebf0 returns the event that lets the player
// choose between them, or NULL when neither can enter
GameEvent *func_ov036_021aebf0(GameSystem *gsys, u32 a1, Regulation *regulation, u16 *result, HeapID heapId);
u32 func_ov036_021aece0(GameSystem *gsys, u32 a1, Regulation *regulation, HeapID heapId);
// The screen that picks the party or the Battle Box for a battle, whether it is done, and the choice
void *func_ov036_021c3180(Field *field, PokeParty *party, PokeParty *battleBoxParty, u8 partyOk, u32 battleBoxOk,
                          HeapID heapId);
BOOL func_ov036_021c3278(void *select);
int func_ov036_021c3218(void *select, u32 *a1);
void *func_ov036_021c6574(void *effects, u32 a1, const VecFx32 *pos);
void func_ov036_021c65a8(void *obj, u16 a1);
void func_ov036_021c65e8(void *obj, u16 a1);
void FieldPlayer_SetWPos(FieldPlayer *player, const VecFx32 *pos);
void FieldPlayer_SetDirection(FieldPlayer *player, u16 dir);
void FieldFadeTCB_Start(GameSystem *gsys, Field *field, u32 a2, u32 a3, u32 a4);

// The work of the zone's gimmick, such as a gym's puzzle, which the gimmick's overlay allocates at the zone's start
void *Field_AllocGimmickWorkBlock(Field *field, u32 id, HeapID heapId, u32 size);
void *Field_GetGimmickWorkBlock(Field *field, u32 id);
// Whether the gimmick work was allocated with the password
BOOL Field_CheckGimmickWorkPassword(Field *field, u32 password);
void Field_DeleteGimmickWorkBlock(Field *field, u32 id);

// A list of areas of the map, which the list's entry index sets: a grid rectangle, a value and flags
void *func_ov036_021ba5d0(u32 count, u8 heapId);
void func_ov036_021ba624(u8 index, u32 x, u32 z, u32 width, u32 depth, u32 value, u32 flags, void *list);
void func_ov036_021ba670(void *list);
u32 func_ov036_021ba684(void *list);
BOOL func_ov036_021ba688(s32 x, s32 z, void *list, u8 index);
u32 func_ov036_021ba6a4(u8 index, void *list);
u32 func_ov036_021ba6b0(u8 index, void *list);
// Sets whether the entry at index is in use, which func_ov036_021ba624 checks before it fills one in
void func_ov036_021ba6bc(u8 index, BOOL inUse, void *list);
// Overlay 36's field_fade.c: whether a grid position is in the rectangle of an entry of the list
BOOL func_ov036_021ba594(s32 x, s32 z, const void *entry);
// The mapper's WFBC work
void *func_ov036_0218adac(HeapID heapId);
void func_ov036_0218add0(void *wfbc);
void func_ov036_0218ade0(void *wfbc, CityState *city, BOOL isOther, HeapID heapId);
void FieldSubscreen_ChangeImm(FieldSubscreen *subscreen, u32 mode);
BOOL FieldTaskManager_IsIdle(FieldTaskManager *taskManager);
u32 FieldTaskManager_GetActiveTaskCount(FieldTaskManager *taskManager);
MMSys *Field_GetActorSystem(Field *field);
FieldCamera *Field_GetCameraSystem(Field *field);
NoGridMapper *Field_GetNoGridMapper(Field *field);
FieldExpObjSystem *Field_GetExpObjSystem(Field *field);
// Whether a fade that FieldFadeTCB_Start started is still running
BOOL Field_GetFadeFlag(Field *field);
FieldFog *Field_GetFog(Field *field);
FieldG3DMapper *Field_GetG3DMapper(Field *field);
GameSystem *Field_GetGameSystem(Field *field);
AreaData *Field_GetAreaData(Field *field);
TCBManager *Field_GetTCBMgr(Field *field);
EncEff *Field_GetEncEff(Field *field);
EncountSystem *Field_GetEncountSystem(Field *field);
u16 Field_GetHeapID(Field *field);
FieldLensFlare *Field_GetLensFlare(Field *field);
PlaceName *Field_GetPlaceName(Field *field);
FieldPlayer *Field_GetPlayer(Field *field);
u16 Field_GetPlayerStateZoneID(Field *field);
u32 Field_GetResolvedControllerTypeID(Field *field);
FieldSubscreen *Field_GetSubscreen(Field *field);
FieldTaskManager *Field_GetTaskManager(Field *field);
void Field_SetSeasonBannerOverdrawFlag(Field *field, BOOL flag);
u32 GetZoneFogIndexAll(Field *field, u16 zoneId);
void ShutdownFollowWork(GameData *gameData);
void EvTime_Update(GameData *gameData);
void FestMission_OnZoneEnter(GameSystem *gsys, u16 zoneId);
void func_ov036_0219ad24(FieldPlayer *player, RailPosition *pos);
void func_ov036_021a2398(EncountSystem *encount, u32 a1);

// One of N's Pokémon, which createNPkm makes
typedef struct {
    // The zones it appears in, from firstZone on
    u16 firstZone : 14;
    u16 zoneCount : 2;
    u16 species;
    u8 level;
    u8 nature;
    u8 sex;
    // 0 or 1 for the species' abilities, 2 for its hidden ability
    u8 ability;
} NPokeSpec;

void createNPkm(PartyPkm *pkm, const NPokeSpec *spec);

void Field_RequestClose(Field *field);
BOOL Field_CheckMapLoadFinished(Field *field);
void FieldRenderPhase2_FieldEffect(Field *field);
void FieldRenderPhase2_EncountEffect(Field *field);
void *FieldG2D_GetDispControl(Field *field);
void *Field_GetFieldEffects(Field *field);
void *Field_GetG3DObjSys(Field *field);
u32 GetZoneFogIndex(u16 zoneId);
u32 ZoneData_GetObjectProjectionMatrixType(u16 zoneId);
u32 GetObjectProjectionMatrixOffset(u16 zoneId);
BOOL func_ov036_021813b8(u16 zoneId);
BOOL IsZoneTwoPassLoad(u16 zoneId);
BOOL func_ov036_0218141c(u16 zoneId);
u32 GetZoneMapType(u16 zoneId);
u32 GetZoneMapType2(u16 zoneId);
void SetupLoadZoneMapTypeData(u16 zoneId, AreaData *area, FieldG3DMapperConfig *config, MapMatrix *matrix);
const FieldmapCtrlVTable *GetZoneFieldmapCtrlVTable(u16 zoneId);
u32 GetFieldmapZoneHeapSize(u16 zoneId);
PlaceName *FieldPlaceName_Create(GameSystem *gsys, HeapID heapId, void *msgBGSys);
void FieldPlaceName_Free(PlaceName *placeName);
void func_ov036_021b4ff8(PlaceName *placeName);
void func_ov036_021b5064(PlaceName *placeName);
void Field_InitGimmick(Field *field);
void Field_TerminateGimmick(Field *field);
void Field_UpdateGimmick(Field *field);
BOOL Field_CheckGimmickID(Field *field, u32 id);
void func_ov036_021b5180(PlaceName *placeName);
BOOL FieldmapProc_Init(GameProc *proc, u32 *seq, void *param, void *work);
BOOL FieldmapProc_Update(GameProc *proc, u32 *seq, void *param, void *work);
BOOL FieldmapProc_End(GameProc *proc, u32 *seq, void *param, void *work);
Field *Field_Create(GameSystem *gsys, HeapID heapId);
void Field_Free(Field *field);
void Field_RenderStart(Field *field);
BOOL Field_CallRoutines(GameSystem *gsys, Field *field);
void FieldG2D_Init(Field *field);
void func_ov036_02180630(Field *field);
void Field_FreeGraphicsSystems(Field *field);
void FieldG3D_InitCallback(void);
void FieldG3D_Init(Field *field);
void FieldG3D_Update(Field *field);
void FieldG3D_RenderPhase1(Field *field);
void FieldG3D_RenderPhase2(Field *field);
void FieldG3D_Free(Field *field);
void FldActSys_AsyncMatLoadTCBFunc(TCB *tcb, void *data);
void FldActSys_VRAMUploadFunc(BOOL type, u32 dest, void *src, u32 size);
void Field_LoadEdgeColorTable(AreaData *area, u16 zoneId);
void Field_LoadActorMatColorPreset(Field *field);
void Field_InitActorSystem(Field *field);
void Field_SuspendActorSystem(Field *field);
BOOL Field_CheckDoRealTimeLoad(Field *field);
BOOL Field_UpdateZoneStatePos(Field *field);
BOOL Field_ShouldSwapZone(Field *field);
void Field_SwapZoneByMatrix(Field *field);
void Field_HotswapSpawnActors(Field *field, GameData *gameData, MMSys *actorSystem, EventData *eventData, u32 zoneId);
void Field_SwapZoneBGM(Field *field, u32 zoneId);
void Field_SwapWeather(Field *field, u32 zoneId);
void Field_CheckGiveDiamondDustMedal(Field *field);
void Field_SwapFog(Field *field, u32 zoneId);
void Field_UpdatePlayerStateZoneID(GameData *gameData, u32 zoneId);
void Field_SwapCameraBoundaries(Field *field, u32 zoneId);
void Field_ResetController(Field *field);
void FieldCameraBoundary_ChangeZone(Field *field, u32 zoneId, HeapID heapId);
void Field_LoadWFBC(GameData *gameData, Field *field, u32 zoneId);
void Field_LoadJoinAvenue(GameData *gameData, Field *field, u32 zoneId);
void Field_LoadSceneArea(Field *field, u32 zoneId);
u32 func_ov036_02180f80(GameCommSys *comm);
BOOL func_ov036_02180fc0(GameCommSys *comm);

void FieldRenderPhase1_Fieldmap(Field *field);
void FieldRenderPhase2_Fieldmap(Field *field);
fx32 Field_CalcActorYOffset(Field *field);
void FieldColorPostFX_Set(void *postFx, void *luminanceTable, BOOL flashback);

#endif // POKEBW2_FIELD_FIELD_H
