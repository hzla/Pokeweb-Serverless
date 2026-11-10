#ifndef POKEBW2_FIELD_FIELD_SCRIPT_H
#define POKEBW2_FIELD_FIELD_SCRIPT_H

#include "types.h"
#include "field/field.h"
#include "gfl/heap.h"
#include "gfl/str.h"
#include "struct_decls.h"
#include "system/game_event.h"

// Fields accessed by the field script work helpers; the remaining storage is not yet identified.
struct ScriptWork {
    u32 unk00;
    u16 scriptId;
    u16 unk06;
    FieldActor *parentActor;
    HeapID heapId;
    u16 unk0E;
    GameSystem *gsys;
    GameEvent *event;
    u8 fieldWork[8];
    u32 unk20;
    u32 reducedFeatureLevel;
    u32 featureLevel;
    WordSet *wordSet;
    StrBuf *mainStrBuf;
    StrBuf *altStrBuf;
    void *unk38;
    void *userHeap;
    // A bit per sound effect player that the script waits on
    u8 seBitMask;
    u8 unk41[3];
    u8 trainerState[2][0x1c];
    u16 localWork[0x62];
    FieldActorAnmProc *actorAnmProc;
    void *stadiumTrainers;
    void *subwork;
};

// The list menu of a script, which the script fills with options and then shows
typedef struct {
    u16 x;
    u16 y;
    u16 cursor;
    // Bit 7 makes the rows taller
    u8 flags;
    // 1 to put the menu's right edge at x
    u8 align;
    u16 *result;
    WordSet *wordSet;
    BOOL ownsMsgData;
    MsgData *msgData;
    ListMenuOption *options;
    ListMenuUI *ui;
    // What the description window shows for each option
    StrBuf *descriptions[32];
} ScriptListMenu;

// What actorWork holds: the actor that a message balloon is over, and where the balloon goes
typedef struct {
    u16 actorId;
    u16 winX;
    // The actor's position plus offset
    VecFx32 pos;
    VecFx32 actorPos;
    VecFx32 offset;
} ScriptActorWork;

struct ScriptSubwork {
    ScriptWork *work;
    GameSystem *gsys;
    GameData *gameData;
    MMSys *mmSys;
    void *playerGridEventTCB;
    FieldAcmdTCB *acmdTasks[8];
    ScriptListMenu listMenu;
    u8 actorWork[0x28];
    void *mapDisplayInfo;
    void *specialMessageIcon;
    u8 actorMsgPosActual;
    u8 actorMsgPos;
    u16 waitCounter;
    u32 nowPkmVoice;
    void *elevatorTable;
};

struct FieldScriptEnvArgs {
    u16 zoneId;
    u16 unk02;
    u32 featureLevel;
    u32 reducedFeatureLevel;
    ScriptWork *work;
};

struct FieldScriptEnv {
    HeapID heapId;
    u16 unk02;
    FieldScriptEnvArgs args;
    MsgData *msgData;
    u16 msgFileNo;
    u8 vmIndex;
    u8 unk1B;
    void *ownedHeap;
    ScriptSubwork *subwork;
};

// The work a field subprocess's callback gets, which the callback frees
typedef struct {
    void *resource;
    void *data;
} ScriptProcCallbackWork;

struct ScriptOverlayWork {
    void *resource;
    void *data;
    void (*cleanup)(ScriptOverlayWork *work);
};

extern const char data_ov012_0216e1e4[];
extern const char data_ov012_0216e208[];
extern const char data_ov012_0216e1b4[];

ScriptSubwork *InitScriptSubwork(ScriptWork *work, HeapID heapId);
void FreeScriptSubwork(void *subwork);
FieldScriptEnv *CreateFieldScriptEnv(const FieldScriptEnvArgs *args, HeapID heapId);
void FreeFieldScriptEnv(FieldScriptEnv *env);
u32 FieldScriptEnv_IsReducedFeatureLevel(FieldScriptEnv *env);
u32 FieldScriptEnv_GetFeatureLevel(FieldScriptEnv *env);
void FieldScriptEnv_RemoveAcmdTasks(FieldScriptEnv *env);
void InitListMenu(FieldScriptEnv *env, u16 x, u16 y, u16 cursor, u16 flags, u32 align, u16 *result, WordSet *wordSet,
                  MsgData *msgData);
void AddItemToListMenu(FieldScriptEnv *env, u32 messageId, u32 descriptionId, u32 value, StrBuf *expanded,
                       StrBuf *temp);
void FieldScriptEnv_ShowListMenu(FieldScriptEnv *env);
void FreeListMenuWork(ScriptListMenu *menu);
BOOL FieldScriptEnv_UpdateListMenu(FieldScriptEnv *env);
BOOL FieldScriptEnv_UpdateListMenuEx(FieldScriptEnv *env);
void ListMenu_ShowDescription(BmpMenuList *list, s32 value, u8 a2);
void *FieldScriptEnv_GetMsgBGSys(FieldScriptEnv *env);
MsgData *GetFieldScriptMsgData(FieldScriptEnv *env);
u16 GetFieldScriptMsgFileNo(FieldScriptEnv *env);
void setMapDisplayInfoPtr(FieldScriptEnv *env, void *info);
void *getMapDisplayInfoPtr(FieldScriptEnv *env);
void SetSpecialMessageIconPtr(FieldScriptEnv *env, void *icon);
void *GetSpecialMessageIconPtr(FieldScriptEnv *env);
void *GetFieldScriptActorWk(FieldScriptEnv *env);
u8 ActorMsgWin_GetPosActual(FieldScriptEnv *env);
void ActorMsgWin_SetPosActual(FieldScriptEnv *env, u8 pos);
u8 ActorMsgWin_GetPos(FieldScriptEnv *env);
void ActorMsgWin_SetPos(FieldScriptEnv *env, u8 pos);

// Runs a script from an event, and returns its work
ScriptWork *EventScriptCall_Start(GameEvent *event, u16 scriptId, FieldActor *actor, u32 param, HeapID heapId);
ScriptWork *ScriptWork_Create(HeapID heapId, GameSystem *gsys, GameEvent *event, u16 scriptId, u32 arg4,
                              u32 featureLevel);
void ScriptWork_Free(ScriptWork *work);
// Sets the script's parameters, which it reads from its work
void ScriptWork_SetParams(ScriptWork *work, u16 param0, u32 param1, u16 param2, u16 param3);
void FieldScript_ResetMapLocalEvents(EventWork *eventWork);
const u8 *FieldScript_GetInitSCRID(const u8 *script, u32 mode, u16 *scriptId);
u16 FieldScript_GetSceneChangeSCRID(GameData *gameData, const u8 *script, u32 mode);
GameEvent *FieldScript_CheckSceneChangeEvent(GameSystem *gsys, HeapID heapId);
u32 FieldScript_CallZoneInitCore(GameSystem *gsys, u32 arg1, u32 mode, u32 featureLevel);
void FieldScript_CallOnZoneReload(GameSystem *gsys, u32 arg1);
void FieldScript_CallOnZoneNewLoad(GameSystem *gsys, u32 arg1);
void FieldScript_CallOnZoneInit(GameSystem *gsys, u32 a1);
void FieldScript_CallPlayerInitSetup(GameSystem *gsys, u32 a1);
void FieldScript_CallPlayerPostHOFSetup(GameSystem *gsys, u32 unused);
void resetRebattleTrainers(EventWork *eventWork);

// A field script command. env is the running script's environment
typedef BOOL (*FieldScriptCommand)(VM *vm, FieldScriptEnv *env);

extern const FieldScriptCommand EVCMD_TABLE[];
extern const u32 EVCMD_MAX;

u32 FieldScript_IsVMFeatureSetReduced(u32 featureLevel);
BOOL FieldScript_CheckSCRID(u16 scriptId);
u32 FieldScript_ResolveSCRID(u32 zoneId, u16 scriptId, u16 *fileId, u16 *msgArcId, u16 *msgFileNo);
void *FieldScript_LoadData(u16 fileId, HeapID heapId);
void FieldScript_ThrowOpcodeAccessError(void);
BOOL FieldScript_OpcodeGuard(VM *vm, void *env, void *gsys, u16 cmd);
void FieldScript_AttachOpcodeGuard(VM *vm);

BOOL s0000_VMNop(VM *vm, FieldScriptEnv *env);
BOOL s0001_VMNop2(VM *vm, FieldScriptEnv *env);
BOOL s0002_VMHalt(VM *vm, FieldScriptEnv *env);
BOOL swapToScrcmdEnvirDecPauseCtr(VM *vm, void *env);
BOOL s0003_VMSleep(VM *vm, FieldScriptEnv *env);
BOOL s0004_VMCall(VM *vm, FieldScriptEnv *env);
BOOL s0005_VMReturn(VM *vm, FieldScriptEnv *env);
BOOL s0006_DebugPrint(VM *vm, FieldScriptEnv *env);
BOOL s0007_DebugStack(VM *vm, FieldScriptEnv *env);
BOOL s0014_VMRegSet8(VM *vm, FieldScriptEnv *env);
BOOL s0015_VMRegSet32(VM *vm, FieldScriptEnv *env);
BOOL s0016_VMRegMov(VM *vm, FieldScriptEnv *env);
u8 VMCmp(u32 left, u32 right);
BOOL s0017_VMRegCmp8(VM *vm, FieldScriptEnv *env);
BOOL s0018_VMRegCmpConst8(VM *vm, FieldScriptEnv *env);
BOOL s0019_WorkCmpConst(VM *vm, FieldScriptEnv *env);
BOOL s001A_WorkCmpWork(VM *vm, FieldScriptEnv *env);
BOOL s001B_RTCallGlobalAsync(VM *vm, FieldScriptEnv *env);
BOOL ScriptNative_WaitFinishSubScript(VM *vm, void *data);
BOOL s001C_RTCallGlobal(VM *vm, FieldScriptEnv *env);
BOOL s0008_VMStackPushConst(VM *vm, FieldScriptEnv *env);
BOOL s0009_VMStackPush(VM *vm, FieldScriptEnv *env);
BOOL s000A_VMStackPop(VM *vm, FieldScriptEnv *env);
BOOL s000B_VMStackDiscard(VM *vm, FieldScriptEnv *env);
BOOL s000C_VMStackAdd(VM *vm, FieldScriptEnv *env);
BOOL s000D_VMStackSub(VM *vm, FieldScriptEnv *env);
BOOL s000E_VMStackMul(VM *vm, FieldScriptEnv *env);
BOOL s000F_VMStackDiv(VM *vm, FieldScriptEnv *env);
BOOL s0010_VMStackPushFlag(VM *vm, FieldScriptEnv *env);
BOOL s013C_GameCommTryBoot(VM *vm, FieldScriptEnv *env);
BOOL s013D_GameCommPause(VM *vm, FieldScriptEnv *env);
BOOL s013E_GameCommResume(VM *vm, FieldScriptEnv *env);
BOOL s024A_FieldSubscreenIsEnabled(VM *vm, FieldScriptEnv *env);
// scrcmd_phrase_select.c and scrcmd_weather.c
BOOL s01DA_CallPhraseSelect(VM *vm, FieldScriptEnv *env);
BOOL s0136_FieldSetWeather(VM *vm, FieldScriptEnv *env);
// scrcmd_ndemo.c: the scenes with N, which overlay 155 plays
BOOL s01C9_NDemoStart(VM *vm, FieldScriptEnv *env);
BOOL s01CA_NDemoEnd(VM *vm, FieldScriptEnv *env);
BOOL s01CB_NDemoReadyTalkMotion(VM *vm, FieldScriptEnv *env);
// enceff.c: the count of the trainer IDs of the Pokémon the player didn't catch
BOOL func_ov036_021c6220(VM *vm, FieldScriptEnv *env);
// fldeff_iaigiri.c: the League's lift, the beacon commands, the Pass Power that ran out and its flash
BOOL s01B1_CallLeagueLiftWarp(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c3018(VM *vm, FieldScriptEnv *env);
BOOL s01DE_PassPowerPopDepletedID(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c315c(VM *vm, FieldScriptEnv *env);
// fldeff_ochiba.c: the player sinking into a pile of leaves
BOOL s02AC_CallLeafPileStuck(VM *vm, FieldScriptEnv *env);

BOOL s02CF_PokeDexCheckHabitatList(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c9a40(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c9a7c(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c9ab0(VM *vm, FieldScriptEnv *env);
BOOL s02DD_UnityTowerGetVisitorCount(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c9b38(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c9b88(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c9bec(VM *vm, FieldScriptEnv *env);
BOOL s02DE_UnityTowerSetHobby(VM *vm, FieldScriptEnv *env);
BOOL s02DF_UnityTowerGetHobby(VM *vm, FieldScriptEnv *env);
BOOL s02DB_UnityTowerSetFloor(VM *vm, FieldScriptEnv *env);
BOOL s02DC_UnityTowerInitVisitorMessage(VM *vm, FieldScriptEnv *env);
BOOL func_ov036_021c9d24(VM *vm, FieldScriptEnv *env);
BOOL s024B_FieldSubscreenDisable(VM *vm, FieldScriptEnv *env);
BOOL s00EB_DayCareCheckSpawnFlag(VM *vm, FieldScriptEnv *env);
BOOL s00EC_DayCareBreed(VM *vm, FieldScriptEnv *env);
BOOL s00ED_DayCareResetSeed(VM *vm, FieldScriptEnv *env);
BOOL s00F7_DayCareCallPokeSelect(VM *vm, FieldScriptEnv *env);
BOOL s00F0_DayCareDeposit(VM *vm, FieldScriptEnv *env);
BOOL s00F1_DayCareWithdraw(VM *vm, FieldScriptEnv *env);
BOOL s00EE_DayCareGetPkmCount(VM *vm, FieldScriptEnv *env);
BOOL s00EF_DayCareCalcEggSpawnChance(VM *vm, FieldScriptEnv *env);
BOOL s00F2_DayCareGetSpecies(VM *vm, FieldScriptEnv *env);
BOOL s00F3_DayCareGetForme(VM *vm, FieldScriptEnv *env);
BOOL s00F8_DayCareGetSex(VM *vm, FieldScriptEnv *env);
BOOL s00F4_DayCareCalcNewLevel(VM *vm, FieldScriptEnv *env);
BOOL s00F5_DayCareCalcLevelGain(VM *vm, FieldScriptEnv *env);
BOOL s00F6_DayCareCalcWithdrawCost(VM *vm, FieldScriptEnv *env);
BOOL s023E_DayCareGetSexForNamePrint(VM *vm, FieldScriptEnv *env);
BOOL s0011_VMStackCmp(VM *vm, FieldScriptEnv *env);
BOOL s0021_RTReserveScript(VM *vm, FieldScriptEnv *env);
BOOL s0022_FieldGetContinueFlag(VM *vm, FieldScriptEnv *env);
BOOL s0023_FlagSet(VM *vm, FieldScriptEnv *env);
BOOL s0024_FlagReset(VM *vm, FieldScriptEnv *env);
BOOL s0025_FlagGet(VM *vm, FieldScriptEnv *env);
BOOL s0026_WorkAdd(VM *vm, FieldScriptEnv *env);
BOOL s0027_WorkSub(VM *vm, FieldScriptEnv *env);
BOOL s002B_WorkMul(VM *vm, FieldScriptEnv *env);
BOOL s002C_WorkDiv(VM *vm, FieldScriptEnv *env);
BOOL s002D_WorkMod(VM *vm, FieldScriptEnv *env);
BOOL s0012_WorkAnd(VM *vm, FieldScriptEnv *env);
BOOL s0013_WorkOr(VM *vm, FieldScriptEnv *env);
BOOL s0028_WorkSetConst(VM *vm, FieldScriptEnv *env);
BOOL s0029_WorkGet(VM *vm, FieldScriptEnv *env);
BOOL s002A_WorkSet(VM *vm, FieldScriptEnv *env);
BOOL s001D_RTEndGlobal(VM *vm, FieldScriptEnv *env);
BOOL s001E_VMJump(VM *vm, FieldScriptEnv *env);
BOOL s001F_VMJumpIf(VM *vm, FieldScriptEnv *env);
BOOL s0020_VMCallIf(VM *vm, FieldScriptEnv *env);
BOOL testAB(VM *vm, void *env);
BOOL s0031_ABKeyWait(VM *vm, FieldScriptEnv *env);
BOOL ScriptNative_LastKeyWait(VM *vm, void *env);
BOOL s0032_LastKeyWait(VM *vm, FieldScriptEnv *env);
BOOL PauseEventMModels(VM *vm, FieldScriptEnv *env);
void EnableAllActorsMovementScr(FieldScriptEnv *env);
// The work of the event that finishes the script's sub events, one by one
typedef struct {
    GameSystem *gsys;
    FieldScriptEnv *env;
    ScriptWork *scriptWork;
    u32 state;
    s32 index;
    s32 count;
#if defined(WHITE2) && (defined(W2U_SHARED_BATTLE) || defined(W2U_SHARED_BATTLE_ABI)) && !defined(BLACK2)
    GameEvent *returnEvent;
#endif
} FinishScriptSubEventsWork;

// Returns TRUE once the sub event is finished
typedef BOOL (*FieldScriptSubEventFinishFunc)(FinishScriptSubEventsWork *work, u32 *state);

extern const FieldScriptSubEventFinishFunc FIELD_SCRIPT_SUB_EVENT_FINISH_FUNCS[15];
// scrcmd_network.c: tries to boot the game's communication again
BOOL GameCommPause_Finish(FinishScriptSubEventsWork *work, u32 *state);
// scrcmd_ndemo.c
BOOL FieldScriptSubEventFinish_NDemo(FinishScriptSubEventsWork *work, u32 *state);

GameEventReturnCode EventFinishScriptSubEvents_Callback(GameEvent *event, u32 *state, void *data);
GameEvent *EventFinishScriptSubEvents_Create(FieldScriptEnv *env);
#if defined(WHITE2) && defined(W2U_SHARED_BATTLE) && !defined(BLACK2)
// The caller separately qualifies native standard-cleanup scope and keeps the original script event, env, work,
// restored field and callback owners live until this event and all of its children finish. It must chain the
// returned event under its actual live fault event before allowing the original script parent to resume.
// This primitive grants no cleanup-scope or cancellation authority and does not change ScriptWork.event.
GameEvent *W2U_EventFinishScriptSubEvents_Create(FieldScriptEnv *env);
// work is the actual live FinishScriptSubEventsWork supplied to its native finish callback; child is its newly
// created native child event. Neither argument transfers ownership of the original script context.
void W2U_FinishScriptSubEvents_CallEvent(FinishScriptSubEventsWork *work, GameEvent *child);
#endif
BOOL s002E_ActorsPauseAll(VM *vm, FieldScriptEnv *env);
BOOL s002F_ActorsUnpauseAll(VM *vm, FieldScriptEnv *env);
BOOL s0030_FinishAllEvents(VM *vm, FieldScriptEnv *env);

GameSystem *FieldScriptEnv_GetGameSystem(FieldScriptEnv *env);
GameData *FieldScriptEnv_GetGameData(FieldScriptEnv *env);
u16 FieldScriptEnv_GetZoneID(FieldScriptEnv *env);
HeapID FieldScriptEnv_GetHeapID(FieldScriptEnv *env);
u16 GetScriptEnvZoneID(FieldScriptEnv *env);
ScriptWork *FieldScriptEnv_GetScriptWork(FieldScriptEnv *env);
void FieldScriptEnv_SetPlayerGridEventTCB(FieldScriptEnv *env, void *task);
void *FieldScriptEnv_GetPlayerGridEventTCB(FieldScriptEnv *env);
FieldActorAnmProc *ScriptWork_GetActorAnmProc(ScriptWork *work);
void ScriptWork_SetActorAnmProc(ScriptWork *work, FieldActorAnmProc *proc);
void ScriptWork_SetStadiumTrainers(ScriptWork *work, void *trainers);
void *ScriptWork_GetStadiumTrainers(ScriptWork *work);
void *ScriptWork_GetTrainerState(ScriptWork *work, int index);
void FieldScriptSubEvent_ResetAll(void);
void FieldScriptSubEvent_Register(int id);
void FieldScriptSubEvent_Unregister(int id);
BOOL FieldScriptSubEvent_IsRegistered(int id);
BOOL FieldScriptSubEvent_IsRegisteredCore(int id);
// Reads a value from the script, or the value of the variable it names (IDs from 0x4000)
u16 ScriptReadAny(VM *vm, FieldScriptEnv *env);
// Reads a variable's ID from the script, and returns the variable
u16 *ScriptReadVar(VM *vm, FieldScriptEnv *env);
// Runs event before the script goes on
void ScriptWork_CallEvent(ScriptWork *work, GameEvent *event);
void ScriptWork_SetPostEvent(ScriptWork *work, GameEvent *event);
GameEvent *ScriptWork_GetEvent(ScriptWork *work);
FieldScriptSupervisor *ScriptWork_GetSupervisor(ScriptWork *work);
ScriptWork *EventScriptCall_GetWork(GameEvent *event);
ScriptWork *EventScriptCall_Replace(GameEvent *event, u16 scriptId, FieldActor *actor, HeapID heapId);
u32 ScriptWork_AddVM(ScriptWork *work, u16 zoneId, u16 scriptId);
BOOL FieldScript_VMExists(ScriptWork *work, u8 index);
void FieldScript_Run(GameSystem *gsys, ScriptWork *work, u16 scriptId, u32 featureLevel);
// What ScriptWork_GetFieldWork returns: the field's message BG system and the field, or NULLs outside the field
typedef struct {
    void *msgBGSys;
    Field *field;
} ScriptFieldWork;

void UpdateScriptFieldWk(void *fieldWork, GameSystem *gsys);
void *ScriptWork_GetFieldWork(ScriptWork *work);
void *ScriptWork_GetSubwork(ScriptWork *work);
u8 *ScriptWork_GetSEBitMask(ScriptWork *work);
u16 ScriptWork_GetSCRID(ScriptWork *work);
// A variable of the script (IDs from 0x8000) or saved event work (from 0x4000)
u16 *ScriptWork_GetWkAddr(ScriptWork *work, GameData *gameData, u16 id);
u16 ScriptWork_ResolveHybridValue(ScriptWork *work, GameData *gameData, u16 value);
BOOL ScriptWork_SetWkValue(ScriptWork *work, u16 id, u32 value);
// Waits a number of frames: UpdateWaitCounter returns TRUE once they have passed
void FieldScriptEnv_SetWaitCounter(FieldScriptEnv *env, u16 frames);
BOOL FieldScriptEnv_UpdateWaitCounter(FieldScriptEnv *env);
u32 GetScrEnvNowPkmVoice(FieldScriptEnv *env);
void SetScrEnvNowPkmVoice(FieldScriptEnv *env, u32 voice);
void *FieldScriptEnv_GetElevatorTable(FieldScriptEnv *env);
void FieldScriptEnv_SetElevatorTable(FieldScriptEnv *env, void *table);
void SetFieldScriptEnvMsgData(FieldScriptEnv *env, u32 arcId, u32 fileNo);
void FieldScriptEnv_Save(FieldScriptEnv *env);
void FieldScriptEnv_Restore(FieldScriptEnv *env);
void SetScrEnvVMIndex(FieldScriptEnv *env, u32 index);
u8 FieldScriptEnv_GetVMIndex(FieldScriptEnv *env);
void FieldScriptEnv_AddAcmdTask(FieldScriptEnv *env, FieldAcmdTCB *task);
BOOL FieldScriptEnv_CheckAcmdQueueRunning(FieldScriptEnv *env);
GameSystem *ScriptWork_GetGameSystem(ScriptWork *work);
StrBuf *ScriptWork_GetMainStrBuf(ScriptWork *work);
StrBuf *ScriptWork_GetAltStrBuf(ScriptWork *work);
void ScriptWork_SetSignFont(ScriptWork *work, void *value);
void *ScriptWork_GetSignFont(ScriptWork *work);
FieldActor *ScriptWork_GetParentActor(ScriptWork *work);
void ScriptWork_SetParentActor(ScriptWork *work, FieldActor *actor);
// A pointer that a command can keep its own work in while the script waits
void **ScriptWork_GetUserHeapPtr(ScriptWork *work);
void *ScriptWork_GetUserHeap(ScriptWork *work);
void ScriptWork_FreeUserHeap(ScriptWork *work);
void *ScriptWork_CreateVarCopy(ScriptWork *work);
void ScriptWork_RestoreVarCopy(ScriptWork *work, void *copy);
u16 *ScriptWork_GetLocalWork(ScriptWork *work, u16 id);
WordSet *ScriptWork_GetWordSet(ScriptWork *work);
MMSys *GetScrEnvMMdlSys(FieldScriptEnv *env);
// Adds an entry to the script's list menu
void AddItemToListMenu(FieldScriptEnv *env, u32 a1, u32 message, u32 value, StrBuf *a4, StrBuf *a5);

// Overlay 36: show a message, and have the script wait for it
BOOL func_ov036_021a8eb4(VM *vm, FieldScriptEnv *env, StrBuf *message, u16 actorId, u16 pos, u32 a5);
BOOL loadMsgBox(VM *vm, FieldScriptEnv *env, StrBuf *message, u32 a3, u8 a4);

#endif // POKEBW2_FIELD_FIELD_SCRIPT_H
