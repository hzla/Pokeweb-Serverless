#ifndef POKEBW2_BATTLE_BTL_POKEPARAM_H
#define POKEBW2_BATTLE_BTL_POKEPARAM_H

#include "types.h"
#include "constants/battle.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "struct_decls.h"

struct BattleCondition {
    union {
        u32 raw;
        struct {
            u32 type : 3;
            u32 turns : 6;
            u32 unk09 : 23;
        } common;
        struct {
            u32 type : 3;
            u32 turns : 6;
            u32 param : 16;
            u32 unk25 : 7;
        } timed;
        struct {
            u32 unk00 : 9;
            u32 monId : 6;
            u32 unk15 : 17;
        } mon;
        struct {
            u32 unk00 : 25;
            u32 flag : 1;
            u32 unk26 : 6;
        } one;
        struct {
            u32 unk00 : 31;
            u32 flag : 1;
        } four;
    };
};

// A move slot of a BattleMon: its true move and the surface one in use, which a move like Mimic or Transform
// replaces (MoveWork_ClearSurface resets it)
struct BattleMoveCore {
    u16 id;
    union {
        struct {
            u8 pp;
            u8 maxPP;
        };
        u16 ppPair;
    };
    union {
        struct {
            u8 ppUp;
            u8 flagsLow : 4;
            u8 flagsHigh : 4;
        };
        u16 flagsPair;
    };
};

struct BattleMoveWork {
    BattleMoveCore truth;
    BattleMoveCore surface;
    // Set while the surface is the true move, so PP changes go to both
    u8 linked;
};

// A BattleMon's stat stages, from 0 to 12 with 6 neutral
typedef struct {
    s8 attack;
    s8 defense;
    s8 spAttack;
    s8 spDefense;
    s8 speed;
    s8 accuracy;
    s8 evasion;
} BattleMonStatStages;

// One hit a BattleMon took, which BattleMon_AddDamageRecord records and GetDamageReceived reads
typedef struct {
    u16 move;
    u16 damage;
    u8 type;
    u8 attackerId;
    u8 attackerPos;
    u8 unk7;
} BattleMonDamageRecord;

static inline void BattleMonDamageRecord_Init(BattleMonDamageRecord *record, u8 attackerId, u8 attackerPos, u16 move,
                                              u8 type, u16 damage) {
    record->move = move;
    record->damage = damage;
    record->type = type;
    record->attackerId = attackerId;
    record->attackerPos = attackerPos;
}

// A condition's ID. The CONDITION_* values are #defines in constants/battle.h, which tr_ai.inc includes too. MWCC
// keeps a local of this type in a register where it folds an integer one into each use, as HandlerChatter's status
typedef enum {
    CONDITION_ID_COUNT = 36,
} BattleConditionID;

// The first part of a BattleMon, which TransformSet keeps while it copies the rest from the target
typedef struct {
    PartyPkm *src;
    PartyPkm *illusionDisguise;
    u32 exp;
    u16 species;
    u16 maxHP;
    u16 hp;
    u16 heldItem;
    u16 consumedItem;
    u16 baseAbility;
    u8 level;
    u8 monId;
    u8 unk1a;
    u8 baseForm : 5;
    u8 transformed : 1;
    u8 illusion : 1;
    u8 unk1b_7 : 1;
    BattleCondition conditions[CONDITION_ID_COUNT];
    u8 conditionCounters[CONDITION_ID_COUNT];
    // The IDs of up to 24 Pokémon, each recorded once
    u8 unkD0Count;
    u8 unkD1[24];
} BattleMonCore;

// A Pokémon in battle, 0x1f8 bytes from BattleMon_Create. Offsets are from btl_pokeparam.c's accessors.
struct BattleMon {
    BattleMonCore core;
    u16 transformedSpecies;
    u16 attack;
    u16 defense;
    u16 spAttack;
    u16 spDefense;
    u16 speed;
    u8 type1;
    u8 type2;
    u8 sex;
    u8 unkFB;
    BattleMonStatStages statStages;
    u8 unk103;
    BattleMoveWork moves[4];
    u16 ability;
    u16 weight;
    u8 moveCount;
    u8 form;
    u8 unk142;
    u8 unk143;
    u8 unk144;
    u8 unk145;
    u16 unk146;
    u16 unk148;
    u16 prevMoveUsed;
    u16 prevMoveId;
    u16 consecutiveMoveCount;
    u8 unk150[2];
    u8 prevTargetPos;
    u8 turnFlags[2];
    u8 conditionFlags[2];
    u8 counters[5];
    // The hits of the last 3 turns, 6 each
    BattleMonDamageRecord damageRecords[3][6];
    u8 damageRecordCounts[3];
    u8 damageRecordTurn;
    u8 unk1f0;
    u8 unk1f1;
    u16 substituteHP;
    u16 comboMove;
    u8 comboMonId;
    u8 unk1f7;
};

// What BattleMon_AddExp reports of a level-up: the new level and the stats gained
typedef struct {
    u8 level;
    u16 hp;
    u16 attack;
    u16 defense;
    u16 spAttack;
    u16 spDefense;
    u16 speed;
} BattleMonLevelUp;

// The condition word returned by GetConditionContinuationParam.
typedef BattleCondition BattleConditionCont;

// Two types, the first in bits 8 to 15 and the second in bits 0 to 7
typedef u16 PokeTypePair;

PokeTypePair PokeTypePair_Make(u32 type1, u32 type2);
PokeTypePair PokeTypePair_MakeMonotype(u32 type);
BOOL PokeTypePair_IsMonotype(PokeTypePair pair);

void IncrementTurn(BattleCondition *condition, u32 amount);
void SetTurns(BattleCondition *condition, u32 turns);
BattleCondition SetConditionTurns(u8 turns);
BattleCondition AddTurnCondition(u32 turns, u16 param);
BattleCondition MakeConditionDependPoke(u32 turns);
BattleCondition MakeConditionPermanent(void);
BattleCondition MakeConditionParamPermanent(u16 param);
BattleCondition MakeConditionPermanentTurnsParam(u8 turns, u16 param);
BattleCondition MakeConditionDependPokeTurns(u32 monId, u8 turns);
BattleCondition MakeConditionBadlyPoisoned(void);
void Condition_SetMonID(BattleCondition *condition, u32 value);
u8 Condition_GetTurns(BattleCondition condition);
void Condition_SetParam(BattleCondition *condition, u16 value);
u16 Condition_GetParam(BattleCondition condition);
void SetConditionFlag(BattleCondition *condition, u32 flag);
u32 GetConditionFlag(BattleCondition condition);

BOOL CanPokemonBattle(BattleMon *mon);
PartyPkm *GetSrcData(const BattleMon *mon);
BOOL CheckCondition(const BattleMon *mon, u32 index);
void CopyBatonPassParams(BattleMon *target, BattleMon *source);
BOOL Condition_IsBadlyPoisoned(BattleConditionCont cont);
u8 Condition_GetMonID(BattleCondition condition);
u32 GetAdditionalConditionFlag(BattleMon *mon, u32 flag);
u32 GetTurnFlag(BattleMon *mon, u32 flag);
u32 GetBattleMonHeldItem(BattleMon *mon);
u8 GetBattleMonMoveCount(BattleMon *mon);
u16 GetBattleMonSpecies(const BattleMon *mon);
// Move rules use Transform's copied species; Illusion remains cosmetic.
#if defined(WHITE2) && defined(W2U_SHARED_BATTLE) && (defined(W2U_RAGING_BULL) || defined(W2U_SCREEN_REMOVERS)) &&     \
    !defined(BLACK2)
u16 W2U_BattleMonEffectiveSpecies(const BattleMon *mon);
#endif
u32 GetBattleMonStat(const BattleMon *mon, u32 stat);
u32 GetBattleMonStatus(BattleMon *mon);
u16 GetDisabledMove(BattleMon *mon, u32 index);
u8 BattleMon_GetConditionTurnCount(BattleMon *mon, u32 index);
BattleConditionCont GetConditionContinuationParam(BattleMon *mon, u32 index);
u8 GetConditionCount(BattleMon *mon, u32 index);
u32 GetConsecutiveMoveCount(BattleMon *mon);
fx32 GetHPRatio(BattleMon *mon);
u8 GetMonID(BattleMon *mon);
u16 GetMovePP(BattleMon *mon, u8 index);
PokeTypePair GetPokeType(BattleMon *mon);
#if defined(WHITE2) && defined(W2U_SHARED_BATTLE) && !defined(BLACK2)
// Cached native two-slot types after Roost, with separate value availability.
// The caller retains its original member lifetime; this issues no role or query
// permission. Failure preserves the independent output, including for NULL mon.
BOOL W2U_BattleMonReadRoostTypes(const BattleMon *mon, PokeTypePair *types);
#endif
u16 GetPreviousMoveID(BattleMon *mon);
u8 BattleMon_GetPrevMoveType(BattleMon *mon);
BOOL IsFainted(const BattleMon *mon);
BOOL TransformCheck(BattleMon *mon);
void ChangeForm(BattleMon *mon, u8 form);
void ChangePokeType(BattleMon *mon, u16 type);
void ChangeAbility(BattleMon *mon, u32 ability);
BOOL func_ov167_021ad6e8(u16 ability);
void SetWeight(BattleMon *mon, u16 weight);
u16 GetBattleMonWeight(BattleMon *mon);
void HPAdd(BattleMon *mon, u16 amount);
void HPZero(BattleMon *mon);
BOOL IsMonFullHP(BattleMon *mon);
BOOL StatStageRecover(BattleMon *mon);
void StatStageReset(BattleMon *mon);
void BattleMon_SetTurnFlag(BattleMon *mon, u32 flag);
void BattleMon_SetConditionFlag(BattleMon *mon, u32 flag);
void BattleMon_ClearConditionFlag(BattleMon *mon, u32 flag);
void BattleMon_ClearTurnFlag(BattleMon *mon, u32 flag);
BOOL IsSubstituteActive(BattleMon *mon);
void BattleMon_SetSubstituteHP(BattleMon *mon, u16 value);
void ResetSpActPriority(BattleMon *mon);
void ComboMove_ClearParam(BattleMon *mon);
BOOL IsIllusionEnabled(BattleMon *mon);
void IllusionBreak(BattleMon *mon);
BOOL IsSemiInvulnMove(BattleMon *mon);
BOOL TransformSet(BattleMon *mon, BattleMon *target);
void RemoveForceAll(BattleMon *mon);
void AbilityEvent_RemoveItem(BattleMon *mon);
BattleEventItem *AbilityEvent_AddItem(BattleMon *mon);
void ClearConsumedItem(BattleMon *mon);
void ConsumeItem(BattleMon *mon, u16 item);
u16 MoveGetID(BattleMon *mon, u8 index);
u8 PokeTypePair_GetType1(PokeTypePair pair);
u32 PokeTypePair_GetType2(PokeTypePair pair);
void PokeTypePair_Split(PokeTypePair pair, u8 *type1, u8 *type2);
BOOL PokeTypePair_IsMatch(PokeTypePair pair, u32 type);
BOOL PokeTypePair_IsMatchEither(PokeTypePair first, PokeTypePair second);
u8 CountUsedMoves(const BattleMon *mon);
u8 GetMovePPUsed(BattleMon *mon, u8 index);
u16 BattleMon_GetTurnsOnField(BattleMon *mon);
u16 GetConsumedItem(BattleMon *mon);
u16 GetPreviousMoveUsed(BattleMon *mon);
u8 GetPrevTargetPos(BattleMon *mon);
void MoveWork_UpdateNumber(BattleMoveWork *work, u16 move, u8 maxPP, BOOL updateCurrent);
void MoveCore_UpdateNumber(BattleMoveCore *core, u16 move, u8 maxPP);
void MoveWork_ClearUsedFlags(BattleMoveWork *move);
void ClearUsedMoveFlag(BattleMon *mon);
void ClearMoveStatusWork(BattleMon *mon, u32 flag);
void ClearCounter(BattleMon *mon);
void setupBySrcData(BattleMon *mon, PartyPkm *src, BOOL readHP, BOOL readAbility);
void MoveWork_ClearSurface(BattleMon *mon);
void ClearFormChange(BattleMon *mon);
void ResetStatStages(BattleMonStatStages *stages);
s32 BattleMon_GetStatRaiseRoom(BattleMon *mon, u32 stat);
BOOL Move_IsPPFull(BattleMon *mon, u8 index, BOOL truth);
u16 Move_IncrementPP(BattleMon *mon, u8 index, u8 amount);
u16 Move_IncrementPP_Org(BattleMon *mon, u8 index, u8 amount);
void Move_UpdateID(BattleMon *mon, u8 index, u16 move, u8 maxPP, BOOL updateCurrent);
BOOL MoveIsUsable(const BattleMon *mon, u16 move);
u32 BattleMon_ApplyWonderRoom(const BattleMon *mon, u32 stat);
void BattleMon_GetSrcStats(BattleMon *mon, BattleMonLevelUp *stats);
void BattleMon_ResetIllusion(BattleMon *mon);
PartyPkm *BattleMon_GetViewSrcData(const BattleMon *mon);
void SetBaseStatus(BattleMon *mon, u32 stat, u16 value);
s32 RawBattleMonStat(const BattleMon *mon, u32 stat);
u32 CritAtkDefLevel(BattleMon *mon, u32 stat);
void splitTypeCore(BattleMon *mon, u8 *type1, u8 *type2);
BOOL DoesMonHaveType(BattleMon *mon, u32 type);
void SetIllusionDisguise(BattleMon *mon, PartyPkm *disguise);
s8 *BattleMon_GetStatStagePtr(BattleMon *mon, u32 stat, s8 *min, s8 *max);
BOOL IsStatChangeValid(BattleMon *mon, u32 stat, s32 change);
BOOL AreStatsLowered(BattleMon *mon);
u32 BattleMon_GetSemiInvulnFlag(BattleMon *mon);
extern const u32 data_ov167_021d7490[];
BattleCondition ZeroConditionTurns(void);
BOOL Condition_IsNull(BattleCondition condition);
void SetMoveCondition(BattleMon *mon, u32 condition, BattleCondition value);
void CureCondition(BattleMon *mon);
void CureDependentCondition(BattleMon *mon, u32 condition);
void CureMoveCondition(BattleMon *mon, u32 condition);
void BattleMon_CureConditionsFromMon(BattleMon *mon, u32 monId);

BattleMon *BattleMon_Create(PartyPkm *src, u8 monId, HeapID heapId);
u32 GetNumMoves(BattleMon *mon, PartyPkm *src, BOOL reset);
void SetMovesAndPP(BattleMon *mon);
void BattleMon_ReloadMoves(BattleMon *mon);
BOOL MoveCore_LoadFromSrc(BattleMoveCore *core, PartyPkm *src, u8 index);
void setupBySrcDataBase(BattleMon *mon, PartyPkm *src, BOOL readTypes);
void BattleMon_Delete(BattleMon *mon);
void InitStatStages(BattleMonStatStages *stages);
BOOL RecoverStatStages(BattleMonStatStages *stages);
u8 BattleMon_GetOrgMoveCount(BattleMon *mon);
u8 BattleMon_GetUsedMoveKindCount(BattleMon *mon);
u16 BattleMon_GetOrgMoveID(BattleMon *mon, u8 index);
u8 CheckIfMoveWasUsed(BattleMon *mon, u8 index);
void BattleMon_CopyMoves(BattleMon *mon, BattleMon *dest);
u16 BattleMon_GetMoveInfo(BattleMon *mon, u8 index, u8 *pp, u8 *maxPP);
u8 BattleMon_GetOrgMovePPUsed(BattleMon *mon, u8 index);
u8 BattleMon_GetPPOfMove(const BattleMon *mon, u16 move);
void Move_DecrementPP(BattleMon *mon, u8 index, u8 amount);
void Move_DecrementPP_Org(BattleMon *mon, u8 index, u8 amount);
void Move_SetUsed(BattleMon *mon, u8 index);
u8 BattleMon_FindMoveSlot(BattleMon *mon, u16 move);
void SetItem(BattleMon *mon, u16 item);
u32 BattleMon_RaiseStatStage(BattleMon *mon, u32 stat, u8 amount);
u32 BattleMon_LowerStatStage(BattleMon *mon, u32 stat, u8 amount);
void BattleMon_SetStatStage(BattleMon *mon, u32 stat, u8 value);
u8 BattleMon_GetCritStage(BattleMon *mon);
BOOL BattleMon_AddCritStage(BattleMon *mon, s32 amount);
void HPSub(BattleMon *mon, u16 amount);
BOOL BattleMon_TickCondition(BattleMon *mon, u32 index, BattleCondition *prev, BOOL *cured);
BOOL BattleMon_TickSleep(BattleMon *mon);
BOOL BattleMon_TickConfusion(BattleMon *mon);
u32 BattleMon_GetResidualDamage(BattleMon *mon, u32 index);
void BattleMon_SetAppearTurn(BattleMon *mon, u16 turn);
void BattleMon_EndTurn(BattleMon *mon);
void Clear_ForFainted(BattleMon *mon);
void Clear_ForSwitch(BattleMon *mon);
void BattleMon_ClearForSwitchIn(BattleMon *mon);
void BattleMon_SetPrevMove(BattleMon *mon, u8 targetPos, BOOL success, u8 unk144, u16 moveId, u16 moveUsed);
BOOL BattleMon_HasAppeared(BattleMon *mon);
void BattleMon_ClearDamageRecords(BattleMon *mon);
void BattleMon_AdvanceDamageRecordTurn(BattleMon *mon);
void BattleMon_AddDamageRecord(BattleMon *mon, const BattleMonDamageRecord *record);
u8 BattleMon_GetDamageRecordCount(BattleMon *mon, u8 turnsAgo);
BOOL GetDamageReceived(const BattleMon *mon, u8 turnsAgo, u8 index, BattleMonDamageRecord *record);
void COUNTER_Set(BattleMon *mon, u32 index, u8 value);
BOOL BattleMon_AddExp(BattleMon *mon, u32 *exp, BattleMonLevelUp *levelUp);
u32 GetExpForLv100(BattleMon *mon);
void BattleMon_WriteToSrc(BattleMon *mon, BOOL keepBaseForm);
void BattleMon_ReloadSrcData(BattleMon *mon);
void BattleMon_SetSrcData(BattleMon *mon, PartyPkm *src);
u32 BattleMon_GetSubstituteHP(BattleMon *mon);
BOOL BattleMon_DamageSubstitute(BattleMon *mon, u16 *damage);
void BattleMon_ClearConfrontedMons(BattleMon *mon);
void BattleMon_AddConfrontedMon(BattleMon *mon, u8 monId);
u8 BattleMon_GetConfrontedMonCount(BattleMon *mon);
u8 BattleMon_GetConfrontedMonID(BattleMon *mon, u8 index);
void BattleMon_SetCaughtBall(BattleMon *mon, u16 item);
void BattleMon_SetComboMove(BattleMon *mon, u8 monId, u16 move);
BOOL BattleMon_GetComboMove(BattleMon *mon, u8 *monId, u16 *move);
BOOL BattleMon_HasComboMove(BattleMon *mon);
void BattleMon_RecalcStats(BattleMon *mon);
BOOL func_ov167_021bc6ac(BattleMon *mon);

// Overlay 169's, which ov167 calls through a linker veneer: whether a condition passes to the Pokémon that Baton Pass
// brings in

#endif // POKEBW2_BATTLE_BTL_POKEPARAM_H
