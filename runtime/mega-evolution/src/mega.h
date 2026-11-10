// Pokeweb Mega Evolution runtime (Black 2 / White 2, PMC DLL on battle overlay 167).
//
// Ported from White2Upgrade's w2u_mega.cpp (Mega Evolution originally implemented by Dararo; Battle UI and
// transformation animation by Hibiki), placed at the native hook points pokebw2's decomp identifies. Retail
// structures are accessed through the offsets below (checked against pokebw2's headers; identical in both games).
#ifndef POKEWEB_MEGA_H
#define POKEWEB_MEGA_H

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed int s32;
typedef int BOOL;
#define TRUE 1
#define FALSE 0
#define NULL ((void *)0)

typedef struct BattleMon BattleMon;
typedef struct BtlServerFlow BtlServerFlow;
typedef struct BtlvCore BtlvCore;
typedef struct PartyPkm PartyPkm;
typedef struct ActionOrderEntry ActionOrderEntry;
typedef union { u32 raw; } BattleAction;

// BattleMon (0x1f8 bytes)
#define MON_SRC(m) (*(PartyPkm **)((u8 *)(m) + 0x00))
#define MON_SPECIES(m) (*(u16 *)((u8 *)(m) + 0x0c))
#define MON_HP(m) (*(u16 *)((u8 *)(m) + 0x10))
#define MON_HELD_ITEM(m) (*(u16 *)((u8 *)(m) + 0x12))
#define MON_BASE_ABILITY(m) (*(u16 *)((u8 *)(m) + 0x16))
#define MON_ID(m) (*(u8 *)((u8 *)(m) + 0x19))
#define MON_FLAGS1B(m) (*(u8 *)((u8 *)(m) + 0x1b)) // baseForm : 5, transformed : 1, illusion : 1
#define MON_BASE_FORM(m) (MON_FLAGS1B(m) & 0x1f)
#define MON_TRANSFORMED(m) ((MON_FLAGS1B(m) >> 5) & 1)
#define MON_MOVE_ID(m, i) (*(u16 *)((u8 *)(m) + 0x104 + (i) * 14))
#define MON_ABILITY(m) (*(u16 *)((u8 *)(m) + 0x13c))
#define MON_WEIGHT(m) (*(u16 *)((u8 *)(m) + 0x13e))
#define MON_MOVE_COUNT(m) (*(u8 *)((u8 *)(m) + 0x140))
#define MON_FORM(m) (*(u8 *)((u8 *)(m) + 0x141))
#define MON_EXP(m) (*(u32 *)((u8 *)(m) + 0x08))

// ActionOrderEntry (16 bytes): mon, action, key, clientId, done
#define AOE_SIZE 16
#define AOE_MON(e) (*(BattleMon **)((u8 *)(e) + 0))
#define AOE_ACTION(e) ((BattleAction *)((u8 *)(e) + 4))
#define AOE_DONE(e) (*(u8 *)((u8 *)(e) + 13))

// BattleAction: action bits 0-3, move bits 7-22, the five spare bits 27-31 carry the chosen Mega form
#define ACTION_KIND(a) ((a)->raw & 0xf)
#define ACTION_MEGA(a) (((a)->raw >> 27) & 0x1f)
#define ACTION_SET_MEGA(a, f) ((a)->raw = ((a)->raw & 0x07ffffffu) | ((u32)(f) << 27))

// BtlServerFlow
#define FLOW_MAIN_MODULE(f) (*(void **)((u8 *)(f) + 0x04))
#define FLOW_POKECON(f) (*(void **)((u8 *)(f) + 0x08))
#define FLOW_QUEUE(f) (*(void **)((u8 *)(f) + 0x0c))
#define FLOW_ACTION_ORDER_COUNT(f) (*(u8 *)((u8 *)(f) + 0x782))
#define FLOW_ACTION_ORDER(f) ((ActionOrderEntry *)((u8 *)(f) + 0x7e0))
#define FLOW_ACTION_STATE(f) ((void *)((u8 *)(f) + 0x1d78))

// BtlvCore
#define CORE_MAIN_MODULE(c) (*(void **)((u8 *)(c) + 0x00))
#define CORE_CLIENT(c) (*(void **)((u8 *)(c) + 0x04))
#define CORE_POKECON(c) (*(void **)((u8 *)(c) + 0x08))
#define CORE_ACTION(c) (*(BattleAction **)((u8 *)(c) + 0xb8))
#define CORE_MON(c) (*(BattleMon **)((u8 *)(c) + 0xbc))
#define CORE_SCU(c) (*(void **)((u8 *)(c) + 0x1c0))

#define PKM_PARAM_PID 0x0
#define PKM_PARAM_ITEM 0x6
#define PKM_PARAM_EXP 0x8
#define PKM_PARAM_ABILITY 0xa
#define PKM_PARAM_FORM 0x6f
#define PKM_PARAM_HIDDEN_ABILITY 0x71
#define PKM_PARAM_ORIGIN_GAME 0x77
#define PKM_PARAM_HP 0xa0
#define PERSONAL_ABILITY_1 26
#define PERSONAL_ABILITY_2 27
#define PERSONAL_ABILITY_HIDDEN 28
#define PERSONAL_FORM_COUNT 32
#define PERSONAL_WEIGHT 38
#define SPECIES_GIRATINA 487
#define SPECIES_SHAYMIN 492
#define SPECIES_ARCEUS 493
#define SPECIES_GENESECT 649
#define ITEM_GRISEOUS_ORB 112
#define MOVE_TARGET_USER 7
#define ABILITY_KLUTZ 0x67
#define CONDITION_GASTRO_ACID 16
#define PAD_BUTTON_START 0x8
#define VERSION_WHITE 20

typedef struct {
    u8 top, bottom, left, right;
} TouchRect;

// Retail functions (absolute addresses at link time; names from pokebw2)
u32 PML_PersonalGetParamSingle(u32 species, u32 form, u32 param);
u32 PokeParty_GetParam(PartyPkm *pkm, u32 param, void *extra);
void PokeParty_SetParam(PartyPkm *pkm, u32 param, u32 value);
void PokeParty_RecalcStats(PartyPkm *pkm);
BOOL PokeParty_DecryptPkm(PartyPkm *pkm);
BOOL PokeParty_EncryptPkm(PartyPkm *pkm, BOOL wasEncrypted);
BOOL PokeParty_ChangeForme(PartyPkm *pkm, u16 form);
void PokeParty_SetStatusCond(PartyPkm *pkm, u32 status);
void setupBySrcDataBase(BattleMon *mon, PartyPkm *src, BOOL readTypes);
u32 GetBattleMonStatus(BattleMon *mon);
void SetMovesAndPP(BattleMon *mon);
BOOL IsFainted(BattleMon *mon);
BOOL CheckCondition(BattleMon *mon, u32 condition);
u8 GetSideFromMonID(u8 monId);
u8 MonIDToClientID(u8 monId);
BOOL IsWildOpponent(BtlServerFlow *flow, u8 monId);
BOOL IsClientNPCTrainer(void *mainModule, u8 clientId);
u8 ActionOrder_Build(BtlServerFlow *flow, void *clientActions, ActionOrderEntry *order, u8 max);
u32 ActionOrder_Proc(BtlServerFlow *flow, ActionOrderEntry *entry);
void ActionOrder_RecalcAndSort(BtlServerFlow *flow, ActionOrderEntry *order, u32 count);
void ServerDisplay_SetMessage(BtlServerFlow *flow, u16 message, u32 count, const u32 *args);
void BtlServerCmdQueue_Put(void *queue, u32 event, ...);
u32 PushState(void *state, u32 command);
void PopState(void *state, u32 value, u32 command);
void ServerEvent_ChangeAbilityBefore(BtlServerFlow *flow, u8 monId, u16 oldAbility, u16 newAbility);
void ServerEvent_ChangeAbilityAfter(BtlServerFlow *flow, u8 monId);
void AbilityEvent_RemoveItem(BattleMon *mon);
void AbilityEvent_AddItem(BattleMon *mon);
void ServerControl_CheckItemReaction(BtlServerFlow *flow, BattleMon *mon, u32 arg);
BOOL IsArceusPlate(u16 item);
BOOL IsGenesectDrive(u16 item);
BOOL BtlvCore_WaitMoveSelect(BtlvCore *core);
BOOL BattleAction_GetMoveInfoFlag(const BattleAction *action);
u32 GCTX_HIDGetHeldKeys(void);
s32 GFL_HIDGetTouchHeldRect(const TouchRect *rects);
void GFL_SndSEPlay(u32 se);
BOOL IsBattleSceneOff(void *mainModule);
BOOL BattleClient_IsChapterSkipping(void *client);
u8 ViewPosToBattlePos(void *mainModule, u32 viewPos);
BattleMon *PokeCon_GetPosMonInner(void *pokeCon, u8 pos);
PartyPkm *GetSrcData(BattleMon *mon);
void BtlvEffect_ChangeSprite(PartyPkm *pkm, u32 viewPos);
BOOL BtlvEffect_IsBusy(void);
void BtlvScu_StartChangeForm(void *scu, u32 viewPos, BOOL skip);
BOOL BtlvScu_WaitChangeSprite(void *scu);
void BtlvScu_StartMoveEffect(void *scu, u8 attackerPos, u8 targetPos, u16 move, s32 target, u32 arg5, u8 arg6);
BOOL BtlvScu_WaitMoveEffect(void *scu);

// The install-time table (patched by Pokeweb; tag "PWMG")
#define PW_MEGA_MAGIC 0x474d5750u
#define PW_MEGA_VERSION 1
#define PW_MEGA_MAX_ROUTES 192
#define PW_MEGA_ROUTE_MOVE 1 // trigger is a move the Pokémon knows (Mega Rayquaza), not a held item

typedef struct {
    u16 species;
    u16 trigger;
    u8 sourceForm;
    u8 targetForm;
    u8 flags;
    u8 reserved;
} PwMegaRoute;

typedef struct {
    u32 magic;
    u16 version;
    u16 count;
    u16 msgReacting;   // std battle message: PKNICK(0)'s ITEM(1) is reacting to TRNAME(2)'s Mega Ring
    u16 msgEvolved;    // PKNICK(0) has Mega Evolved
    u16 msgWish;       // TRNAME(1)'s fervent wish has reached PKNICK(0) (move-triggered routes)
    u16 animationMove; // battle animation for the transformation, as BtlvScu_StartMoveEffect takes it; 0 = native
    u16 seArm;
    u16 seDisarm;
    u16 revealFrame;   // the frame of the animation at which the Mega sprite replaces the base sprite
    u16 options;       // bit 0: trainers the game controls (opponents, partners) Mega Evolve whenever they can
    PwMegaRoute routes[PW_MEGA_MAX_ROUTES];
} PwMegaConfig;

#define PW_MEGA_OPTION_AUTO_FOES 1

extern PwMegaConfig gPwMegaConfig;

#endif
