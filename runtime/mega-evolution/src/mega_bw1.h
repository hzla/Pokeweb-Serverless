// Pokeweb Mega Evolution runtime, Black / White: the retail functions mega.c calls, under their Black 2 / White 2
// (pokebw2) names, mapped to Black / White's own (aletheia, the Black / White decomp). Included by mega.h for PW_BW1
// builds only. Each mapping was checked against aletheia's source: same arguments, same behaviour.
#ifndef POKEWEB_MEGA_BW1_H
#define POKEWEB_MEGA_BW1_H

// ---- Retail functions (aletheia names; absolute addresses at link time) ----
u32 POKE_TOOL_GetPersonalParam(u16 species, u16 form, u32 field);
u32 POKE_TOOL_GetPartyValue(PartyPkm *pkm, u32 param, void *extra);
void POKE_TOOL_SetPartyValue(PartyPkm *pkm, u32 param, u32 value);
void POKE_TOOL_RecalcParam(PartyPkm *pkm);
u32 POKE_TOOL_DecodePartyParam(PartyPkm *pkm);
u32 POKE_TOOL_EncodePartyParam(PartyPkm *pkm, u32 didDecode);
u32 POKE_TOOL_ChangeForm(PartyPkm *pkm, u32 form);
void POKE_TOOL_SetStatusCondition(PartyPkm *pkm, u32 status);
void BTL_POKEPARAM_LoadStats(BattleMon *mon, PartyPkm *src, u32 withTypes);
u32 BTL_POKEPARAM_GetMajorStatusIndex(BattleMon *mon);
void BTL_POKEPARAM_SaveMovesToMon(BattleMon *mon);
BOOL BTL_POKEPARAM_IsFainted(BattleMon *mon);
BOOL BTL_POKEPARAM_HasSick(BattleMon *mon, int sick);
PartyPkm *BTL_POKEPARAM_GetMon(BattleMon *mon);
u8 BTL_MAIN_PokeIdToClientId(u32 monId);
BOOL BTL_MAIN_IsTrainerSlotNpc(void *mainModule, int clientId);
BOOL BTL_MAIN_CheckSceneOff(void *mainModule);
u8 BTL_MAIN_GetSlotFromViewPos(void *mainModule, u8 viewPos);
BattleMon *BTL_SIDE_GetPokeAtPos(void *pokeCon, u8 pos);
BOOL BTLV_CORE_CheckPartySlotCondition(BtlServerFlow *flow, int monId); // pokebw2's IsWildOpponent
u8 BTL_SERVER_FLOW_BuildActionOrder(BtlServerFlow *flow, void *clientActions, ActionOrderEntry *order, int max);
u32 BTL_SERVER_FLOW_ProcAction(BtlServerFlow *flow, ActionOrderEntry *entry);
void BTL_SERVER_FLOW_ResortActionOrder(BtlServerFlow *flow, ActionOrderEntry *order, u32 count);
void BTL_SERVER_FLOW_PushMsgSet(BtlServerFlow *flow, u32 message, int count, const u32 *args);
void BTL_SERVER_CMD_Push(void *queue, u32 command, ...);
u32 BTL_SERVER_FLOW_BeginHandExScope(void *scope, int line);
void BTL_SERVER_FLOW_NotifyAbilityChangeEvent(BtlServerFlow *flow, u32 monId, u16 oldAbility, u16 newAbility);
void BTL_SERVER_FLOW_NotifyAbilityChangedEvent(BtlServerFlow *flow, u32 monId);
void HAND_TOKUSEI_RemoveAbilityHandlers(BattleMon *mon);
void *HAND_TOKUSEI_AddAbilityHandlers(BattleMon *mon);
void BTL_SERVER_FLOW_ProcDamagedItemReaction(BtlServerFlow *flow, BattleMon *mon, u32 trigger);
// Overlay 95 is loaded far from overlay 93 (out of BL range): called through a register.
__attribute__((long_call)) int BTL_ID_IsArceusPlate(unsigned item);
__attribute__((long_call)) int BTL_ID_IsGenesectDrive(unsigned item);
u32 BTLV_CORE_PollMoveMenu(BtlvCore *core);
u32 BTL_ACTION_GetFightSlotFlag(const BattleAction *action);
u32 KEY_GetCont(void);
int TOUCHPANEL_HitCont(const TouchRect *rects); // -1 when not touched, else the rectangle's index (0xff ends)
void GFL_USE_PlaySeDefaultVolume(u32 se);
BOOL BTL_CLIENT_IsMainStepActive(void *client);
void BTLV_EFFECT_ResetPokeSprite(PartyPkm *pkm, int viewPos);
BOOL BTLV_EFFECT_IsBusy(void);
void BTLV_SCU_StartMonGraphicSwap(void *scu, u32 viewPos, u32 instant);
u32 BTLV_SCU_IsMonGraphicSwapDone(void *scu);
void BTLV_SCU_StartWazaEffect(void *scu, int attackerPos, int defenderPos, u32 move, u32 target, int turn, u8 cont);
int BTLV_SCU_RunWazaProc(void *scu);

// ---- pokebw2 names ----
#define PML_PersonalGetParamSingle(species, form, param) POKE_TOOL_GetPersonalParam((species), (form), (param))
#define PokeParty_GetParam POKE_TOOL_GetPartyValue
#define PokeParty_SetParam POKE_TOOL_SetPartyValue
#define PokeParty_RecalcStats POKE_TOOL_RecalcParam
#define PokeParty_DecryptPkm POKE_TOOL_DecodePartyParam
#define PokeParty_EncryptPkm POKE_TOOL_EncodePartyParam
#define PokeParty_ChangeForme POKE_TOOL_ChangeForm
#define PokeParty_SetStatusCond POKE_TOOL_SetStatusCondition
#define setupBySrcDataBase BTL_POKEPARAM_LoadStats
#define GetBattleMonStatus BTL_POKEPARAM_GetMajorStatusIndex
#define SetMovesAndPP BTL_POKEPARAM_SaveMovesToMon
#define IsFainted BTL_POKEPARAM_IsFainted
#define CheckCondition BTL_POKEPARAM_HasSick
#define GetSrcData BTL_POKEPARAM_GetMon
#define MonIDToClientID BTL_MAIN_PokeIdToClientId
#define IsClientNPCTrainer BTL_MAIN_IsTrainerSlotNpc
#define IsBattleSceneOff BTL_MAIN_CheckSceneOff // TRUE while battle animations are on, as in Black 2 / White 2
#define ViewPosToBattlePos BTL_MAIN_GetSlotFromViewPos
#define PokeCon_GetPosMonInner BTL_SIDE_GetPokeAtPos
#define IsWildOpponent BTLV_CORE_CheckPartySlotCondition
#define ActionOrder_Build BTL_SERVER_FLOW_BuildActionOrder
#define ActionOrder_Proc BTL_SERVER_FLOW_ProcAction
#define ActionOrder_RecalcAndSort BTL_SERVER_FLOW_ResortActionOrder
#define ServerDisplay_SetMessage BTL_SERVER_FLOW_PushMsgSet // command 0x5b in both games
#define BtlServerCmdQueue_Put BTL_SERVER_CMD_Push
#define ServerEvent_ChangeAbilityBefore BTL_SERVER_FLOW_NotifyAbilityChangeEvent
#define ServerEvent_ChangeAbilityAfter BTL_SERVER_FLOW_NotifyAbilityChangedEvent
#define AbilityEvent_RemoveItem HAND_TOKUSEI_RemoveAbilityHandlers
#define AbilityEvent_AddItem(mon) ((void)HAND_TOKUSEI_AddAbilityHandlers(mon))
#define ServerControl_CheckItemReaction BTL_SERVER_FLOW_ProcDamagedItemReaction
#define IsArceusPlate BTL_ID_IsArceusPlate
#define IsGenesectDrive BTL_ID_IsGenesectDrive
#define BtlvCore_WaitMoveSelect BTLV_CORE_PollMoveMenu
#define BattleAction_GetMoveInfoFlag BTL_ACTION_GetFightSlotFlag
#define GCTX_HIDGetHeldKeys KEY_GetCont
#define GFL_HIDGetTouchHeldRect TOUCHPANEL_HitCont
#define GFL_SndSEPlay GFL_USE_PlaySeDefaultVolume
#define BattleClient_IsChapterSkipping BTL_CLIENT_IsMainStepActive
#define BtlvEffect_ChangeSprite BTLV_EFFECT_ResetPokeSprite
#define BtlvEffect_IsBusy BTLV_EFFECT_IsBusy
#define BtlvScu_StartChangeForm BTLV_SCU_StartMonGraphicSwap
#define BtlvScu_WaitChangeSprite BTLV_SCU_IsMonGraphicSwapDone
#define BtlvScu_StartMoveEffect BTLV_SCU_StartWazaEffect // (scu, attacker, target, move, move target, 0, 0)
#define BtlvScu_WaitMoveEffect BTLV_SCU_RunWazaProc

// The player's bag: BtlMain.setup (0x00) -> BattleSetupParam.myItem (0x60), as BTL_MAIN_RemoveItemFromBag reads it.
u32 MYITEM_SAVEDATA_HasItem(void *bag, u16 item, u16 quantity, u16 heapId);
#define GetBagSave(mainModule) (*(void **)((u8 *)*(void **)(mainModule) + 0x60))
#define BagSave_CheckAmount(bag, item, count, heapId) MYITEM_SAVEDATA_HasItem((bag), (item), (count), (heapId))

// The hand-ex scope (pokebw2's BtlActionState): Black / White take a source line for their debug build instead of
// a command; BTL_SERVER_FLOW_EndHandExScope only restores the word.
#define PushState(state, command) BTL_SERVER_FLOW_BeginHandExScope((state), 0)
#define PopState(state, value, command) ((void)(*(u32 *)(state) = (value)))

#endif
