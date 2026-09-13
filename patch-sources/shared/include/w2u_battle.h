#ifndef __W2U_BATTLE_H
#define __W2U_BATTLE_H

#include "swan/swantypes.h"
#include "species_ids.h"
#include "Items.h"

#define W2U_ARRAY_COUNT(arr) (sizeof(arr) / sizeof((arr)[0]))

typedef u32 SPECIES;
typedef u32 ABILITY;
typedef u32 CONDITION;
typedef u32 ConditionData;
typedef u32 CONDITION_FLAG;
typedef u32 FIELD_EFFECT;
typedef u32 MOVE_ID;
typedef u32 POS_EFFECT;
typedef u32 SIDE_EFFECT;
typedef u32 TERRAIN;
typedef u32 TURN_FLAG;
typedef u32 WEATHER;
typedef u32 BattleStyle;

#define ABIL_PLUS 0x39
#define ABIL_MINUS 0x3A
#define ABIL_KLUTZ 0x67
#define ABIL_SHEER_FORCE 0x7D
#define ABIL_INFILTRATOR 0x97

#define BATTLE_MAX_SLOTS 31

#define BTL_STYLE_DOUBLE 0x01
#define BTL_STYLE_TRIPLE 0x02

#define CONDITION_NONE 0x00
#define CONDITION_PARALYSIS 0x01
#define CONDITION_SLEEP 0x02
#define CONDITION_FREEZE 0x03
#define CONDITION_BURN 0x04
#define CONDITION_POISON 0x05
#define CONDITION_CONFUSION 0x06
#define CONDITION_ATTRACT 0x07
#define CONDITION_BIND 0x08
#define CONDITION_TAUNT 0x0B
#define CONDITION_TORMENT 0x0C
#define CONDITION_DISABLE 0x0D
#define CONDITION_YAWN 0x0E
#define CONDITION_HEALBLOCK 0x0F
#define CONDITION_GASTROACID 0x10
#define CONDITION_LEECHSEED 0x12
#define CONDITION_BLOCK_ITEM 0x13
#define CONDITION_ENCORE 0x17
#define CONDITION_ROOST 0x18
#define CONDITION_MOVELOCK 0x19
#define CONDITION_CHARGELOCK 0x1A
#define CONDITION_CHOICELOCK 0x1B
#define CONDITION_SKYDROP 0x21
#define CONDITIONFLAG_NULL 0x0F
#define CONDITIONFLAG_BATONPASS 0x0E
#define TURNFLAG_ACTIONSTART 0x00
#define TURNFLAG_ACTIONDONE 0x01
#define TURNFLAG_DAMAGED 0x02
#define TURNFLAG_MOVEPROCDONE 0x03
#define TURNFLAG_PROTECT 0x07
#define TURNFLAG_ITEMCONSUMED 0x08
#define TURNFLAG_CANTUSEITEM 0x09
#define TURNFLAG_MOVED 0x0C
#define TURNFLAG_USINGFLING 0x0F

#define HANDLER_ABILITY_POPUP_FLAG 0x400000

#define BATTLE_MEGA_SYNC_MSGID 1153
#define BATTLE_MEGA_EVOLVE_MSGID 1156
#define BATTLE_AROMA_VEIL_MSGID 1165
#define BATTLE_FLOWER_VEIL_MSGID 1168
#define BATTLE_SWEET_VEIL_MSGID 1171
#define BATTLE_SYMBIOSIS_MSGID 1174
#define BATTLE_DARK_AURA_MSGID 1177
#define BATTLE_FAIRY_AURA_MSGID 1180
#define BATTLE_AURA_BREAK_MSGID 1183
#define BATTLE_DISGUISE_MSGID 1192
#define BATTLE_BATTLE_BOND_MSGID 1195
#define BATTLE_ELECTRIC_TERRAIN_MSGID 1292
#define BATTLE_GRASSY_TERRAIN_MSGID 1295
#define BATTLE_MISTY_TERRAIN_MSGID 1298
#define BATTLE_TERRAIN_END_MSGID 1301
#define BATTLE_PSYCHIC_TERRAIN_MSGID 1313
#define BATTLE_AURORA_VEIL_START_MSGID 1316
#define BATTLE_AURORA_VEIL_END_MSGID 1319
#define BATTLE_BEAK_BLAST_CHARGE_MSGID 1322
#define BATTLE_BURN_UP_MSGID 1325
#define BATTLE_LASER_FOCUS_MSGID 1328
#define BATTLE_INSTRUCT_MSGID 1331
#define BATTLE_SHELL_TRAP_SET_MSGID 1334
#define BATTLE_SPECTRAL_THIEF_STEAL_MSGID 1337
#define BATTLE_SPEED_SWAP_MSGID 1340
#define BATTLE_THROAT_CHOP_END_MSGID 1343
#define BATTLE_SPOTLIGHT_MSGID 670
#define BATTLE_BLADE_FORME_MSGID 1304
#define BATTLE_SHIELD_FORME_MSGID 1307
#define BATTLE_ION_DELUGE_MSGID 1310
#define BATTLE_BELCH_MSGID 225
#define BATTLE_ASSAULTVEST_MSGID 201
#define BATTLE_STICKY_WEB_USE_MSGID 226
#define BATTLE_STICKY_WEB_REMOVE_MSGID 228
#define BATTLE_CRAFTY_SHIELD_USE_MSGID 231
#define BATTLE_ELECTRIC_TERRAIN_STATUS_MSGID 1159
#define BATTLE_MISTY_TERRAIN_STATUS_MSGID 1162
#define BATTLE_MAT_BLOCK_MSGID 1259
#define BATTLE_STICKY_WEB_EFFECT_MSGID 1262
#define BATTLE_EXTRA_TYPE_MSGID 1265
#define BATTLE_TOPSY_TURVY_MSGID 1268
#define BATTLE_CRAFTY_SHIELD_EFFECT_MSGID 1271
#define BATTLE_ELECTRIFY_MSGID 1274
#define BATTLE_GEOMANCY_MSGID 1277
#define BATTLE_HAPPY_HOUR_MSGID 1280
#define BATTLE_POWDER_COVER_MSGID 1283
#define BATTLE_POWDER_EXPLODE_MSGID 1286
#define BATTLE_SPIKY_SHIELD_DAMAGE_MSGID 1289
#define BATTLE_RECOIL_MSGID 378
#define BATTLE_SOLAR_BEAM_CHARGE_MSGID 553

#define SIDEEFF_REFLECT 0
#define SIDEEFF_LIGHT_SCREEN 1
#define SIDEEFF_SAFEGUARD 2
#define SIDEEFF_MIST 3
#define SIDEEFF_SPIKES 6
#define SIDEEFF_TOXIC_SPIKES 7
#define SIDEEFF_STEALTH_ROCK 8
#define SIDEEFF_STICKY_WEB 14
#define SIDEEFF_AURORA_VEIL 15

#define POSEFF_ION_DELUGE 5
#define POSEFF_CRAFTY_SHIELD 6
#define POSEFF_ELECTRIFY 7
#define POSEFF_KINGS_SHIELD 8
#define POSEFF_MAT_BLOCK 9

#define TERRAIN_NULL 0
#define TERRAIN_ELECTRIC 1
#define TERRAIN_GRASSY 2
#define TERRAIN_MISTY 3
#define TERRAIN_PSYCHIC 4

#define WEATHER_NULL 0
#define WEATHER_SUN 1
#define WEATHER_RAIN 2
#define WEATHER_HAIL 3
#define WEATHER_SANDSTORM 4

#define DONT_OVERRIDE_EFFECTIVENESS 0
#define OVERRIDE_EFFECTIVENESS_1_2 1
#define OVERRIDE_EFFECTIVENESS_1 2
#define OVERRIDE_EFFECTIVENESS_2 3
#define COMPOUND_EFFECTIVENESS 4

enum PkmField : u32 {
    PF_Species = 0x5,
    PF_Item = 0x6,
    PF_Experience = 0x8,
    PF_Ability = 0xA,
    PF_Forme = 0x6F,
    PF_IsHiddenAbility = 0x71,
    PF_StatusCond = 0x9D,
    PF_NowHP = 0xA0,
    PF_MaxHP = 0xA1,
    PF_Attack = 0xA2,
    PF_Defense = 0xA3,
    PF_Speed = 0xA4,
    PF_SpAttack = 0xA5,
    PF_SpDefense = 0xA6,
};

enum BattleMonValue : u32 {
    VALUE_ATTACK_STAGE = 0x1,
    VALUE_DEFENSE_STAGE = 0x2,
    VALUE_SPECIAL_ATTACK_STAGE = 0x3,
    VALUE_SPECIAL_DEFENSE_STAGE = 0x4,
    VALUE_SPEED_STAGE = 0x5,
    VALUE_ACCURACY_STAGE = 0x6,
    VALUE_EVASION_STAGE = 0x7,
    VALUE_ATTACK_STAT = 0x8,
    VALUE_SPECIAL_ATTACK_STAT = 0xA,
    VALUE_SPEED_STAT = 0xC,
    VALUE_CURRENT_HP = 0xD,
    VALUE_MAX_HP = 0xE,
    VALUE_ABILITY = 0x10,
    VALUE_EFFECTIVE_ABILITY = 0x11,
    VALUE_FORM = 0x13,
};

enum BattleHandlerEffect : u32 {
    EFFECT_ABILITY_POPUP_ADD = 0x2,
    EFFECT_ABILITY_POPUP_REMOVE = 0x3,
    EFFECT_MESSAGE = 0x4,
    EFFECT_RECOVER_HP = 0x5,
    EFFECT_DRAIN = 0x6,
    EFFECT_DAMAGE = 0x7,
    EFFECT_CURE_STATUS = 0xB,
    EFFECT_ADD_CONDITION = 0xC,
    EFFECT_CHANGE_STAT_STAGE = 0xE,
    EFFECT_SET_STAT_STAGE = 0xF,
    EFFECT_SET_BASE_STATS = 0x11,
    EFFECT_CHANGE_TYPE = 0x14,
    EFFECT_SET_TURN_FLAG = 0x15,
    EFFECT_RESET_TURN_FLAG = 0x16,
    EFFECT_ADD_SIDE_EFFECT = 0x19,
    EFFECT_REMOVE_SIDE_EFFECT = 0x1A,
    EFFECT_ADD_FIELD_EFFECT = 0x1B,
    EFFECT_REMOVE_FIELD_EFFECT = 0x1C,
    EFFECT_ADD_POS_EFFECT = 0x1E,
    EFFECT_CHANGE_ABILITY = 0x1F,
    EFFECT_SWAP_ITEM = 0x24,
    EFFECT_QUIT_BATTLE = 0x28,
    EFFECT_SWITCH = 0x29,
    EFFECT_INTERRUPT_ACTION = 0x2F,
    EFFECT_ADD_ANIMATION = 0x37,
    EFFECT_CHANGE_FORM = 0x39,
    EFFECT_SET_ANIMATION_ID = 0x3A,
    EFFECT_FORCE_MOVE_SUCCESS = 0x3B,
};

enum StatStage : u32 {
    STATSTAGE_NULL = 0x0,
    STATSTAGE_ATTACK = 0x1,
    STATSTAGE_DEFENSE = 0x2,
    STATSTAGE_SPECIAL_ATTACK = 0x3,
    STATSTAGE_SPECIAL_DEFENSE = 0x4,
    STATSTAGE_SPEED = 0x5,
    STATSTAGE_ACCURACY = 0x6,
    STATSTAGE_EVASION = 0x7,
};

enum BattleType : u32 {
    BTL_TYPE_WILD = 0x0,
    BTL_TYPE_TRAINER = 0x1,
    BTL_TYPE_FACILITY = 0x2,
    BTL_TYPE_ONLINE = 0x3,
    BTL_TYPE_DEMO = 0x4,
};

enum ServerCommandID : u32 {
    SCID_ConsumeItem = 0x17,
    SCID_ChangeAbility = 0x1D,
    SCID_SetItem = 0x1E,
    SCID_MoveAnim = 0x30,
    SCID_Exp = 0x45,
    SCID_ChangeForm = 0x4F,
    SCID_SetMessage = 0x5B,
};

struct StrBuf;
struct MainModule;
struct PokeCon;
struct PokeParty;
struct PartyPkm;
struct BtlServerWk;
struct BtlvScu;
struct BattleEventItem;

struct StatStageParam {
    u8 AttackStage;
    u8 DefenseStage;
    u8 SpAttackStage;
    u8 SpDefenseStage;
    u8 SpeedStage;
    u8 AccuracyStage;
    u8 EvasionStage;
};

struct MoveCore {
    u16 moveID;
    u8 currentPP;
    u8 maxPP;
    u8 PPUpCount;
    u8 usedFlag;
};

struct MoveSet {
    MoveCore truth;
    MoveCore surface;
    u8 fLinked;
};

struct MoveDamageRec {
    u16 moveID;
    u16 damage;
    u8 damageType;
    u8 moveType;
    u8 pokeID;
    u8 pokePos;
};

struct BattleAction_Fight {
    u32 cmd : 4;
    u32 targetPos : 3;
    u32 moveID : 16;
    u32 pad : 9;
};

struct BattleAction_Item {
    u32 cmd : 4;
    u32 targetIdx : 3;
    u32 itemID : 16;
    u32 param : 8;
    u32 pad : 1;
};

struct BattleAction_Switch {
    u32 cmd : 4;
    u32 posIdx : 3;
    u32 memberIdx : 3;
    u32 depleteFlag : 1;
    u32 pad : 21;
};

struct BattleAction_Run {
    u32 cmd : 4;
    u32 pad : 28;
};

struct BattleAction_Default {
    u32 cmd : 4;
    u32 param : 28;
};

union BattleActionParam {
    BattleAction_Fight baFight;
    BattleAction_Item baItem;
    BattleAction_Switch baSwitch;
    BattleAction_Run baRun;
    BattleAction_Default baDefault;
};

struct BattleMon {
    PartyPkm* partySrc;
    PartyPkm* disguiseSrc;
    u32 experience;
    u16 species;
    u16 maxHP;
    u16 currentHP;
    u16 heldItem;
    u16 usedItem;
    u16 ability;
    u8 level;
    u8 battleSlot;
    u8 baseAttack;
    u8 flags;
    u8 conditions[36 * 4];
    u8 moveConditionCounter[36];
    u8 confrontRecCount;
    u8 confrontRec[24];
    u8 gapE9[5];
    u16 attack;
    u16 defense;
    u16 specialAttack;
    u16 specialDefense;
    u16 speed;
    u8 Type1;
    u8 Type2;
    u8 Sex;
    u8 field_FB;
    StatStageParam statStageParam;
    u8 field_103;
    MoveSet moves[4];
    u16 currentAbility;
    u16 weight;
    u8 moveCount;
    u8 form;
    u8 critStage;
    u8 usedMoveCount;
    u8 prevMoveType;
    u8 field_145;
    u16 turnCount;
    u16 appearedTurn;
    u16 previousMove;
    u16 previousMoveID;
    u16 consecutiveMoveCounter;
    u16 field_150;
    u8 prevTargetPos;
    u8 turnFlag[2];
    u8 conditionFlag[2];
    u8 counters[5];
    MoveDamageRec damageRec[3][6];
    u8 damageRecCount[3];
    u8 damageRecTurn;
    u8 damageRecPtr;
    u8 field_1F1;
    u16 substituteHP;
    u16 comboMoveID;
    u8 comboPokeID;
    u8 field_1F7;
};

struct BattleParty {
    BattleMon* members[6];
    u8 memberCount;
    u8 numCoverPos;
};

struct PokeCon {
    MainModule* mainModule;
    BattleParty party[4];
    PokeParty* srcParty[4];
    BattleMon* activeBattleMon[24];
    u32 forServer;
};

struct BtlClientWk;

struct BtlvInput_MoveSelect_2 {
    BattleMon* activeMons[3];
    u32 field_C[3][4];
};

struct BtlvCore {
    MainModule* mainModule;
    BtlClientWk* client;
    PokeCon* pokeCon;
    u8 myID;
    u8 gap_D[3];
    u32 field_10;
    bool(*func14)(BtlvCore*, u32*);
    u32 field_18;
    u32(*func_1C)(u32*, BtlvCore*);
    u32(*func_20)(u32*, BtlvCore*);
    BtlvCore* btlCore_24;
    u32 field_28;
    BtlvInput_MoveSelect_2 field_2C;
    u8 gap_68[68];
    StrBuf* strBuf;
    void* font1;
    void* font2;
    BattleActionParam* actionParam;
    BattleMon* activeMon;
    u32 activeMonID;
    u8 gap_C4[0xFC];
    BtlvScu* btlvScu;
};

struct ServerCommandQueue {
    u32 writePtr;
    u32 readPtr;
    u8 buffer[3000];
};

struct ActionOrderWork {
    BattleMon* battleMon;
    BattleActionParam action;
    u32 speed;
    u8 partyID;
    u8 done;
    u8 field_E;
    u8 field_F;
};

struct MoveRecordUnit {
    u32 turn;
    u16 moveID;
    u8 pokeID;
    u8 effective;
};

struct MoveRecord {
    u32 ptr;
    MoveRecordUnit record[120];
};

struct FaintRecordUnit {
    u8 count;
    u8 expChecked[24];
    u8 faintPokeID[24];
};

struct FaintRecord {
    FaintRecordUnit turnRecord[4];
};

struct PokeSet {
    BattleMon* battleMon[6];
    u16 damage[6];
    u16 substituteDamage[6];
    u8 damageType[6];
    u16 sortWork[6];
    u8 count;
    u8 countMax;
    u8 getIdx;
    u8 targetPosCount;
};

struct HitCheckParam {
    u8 countMax;
    u8 count;
    u8 checkEveryTime;
    u8 multiHitMove;
    u8 putAnimCmd;
    u8 multiHitEffectiveness;
};

struct HandlerParam_StrParams {
    u16 ID;
    u16 flags;
    u32 subProcID;
    u32 args[8];
};

struct HandlerParam_Header {
    u32 flags;
};

struct HandlerParam_Message {
    HandlerParam_Header header;
    HandlerParam_StrParams str;
};

struct HandlerParam_InterruptPoke {
    HandlerParam_Header header;
    u8 pokeID;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_SendLast {
    HandlerParam_Header header;
    u8 pokeID;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_AddAnimation {
    HandlerParam_Header header;
    u16 effectNo;
    u8 posFrom;
    u8 posTo;
    u16 reservedQueuePos;
    u8 reserveQueue;
    u8 hideMessageWindow;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_SetAnimationID {
    HandlerParam_Header header;
    u8 effectIndex;
};

struct HandlerParam_RecoverHP {
    HandlerParam_Header header;
    u16 recoverHP;
    u8 pokeID;
    u8 failCheckThru;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_Drain {
    HandlerParam_Header header;
    u16 recoverHP;
    u8 recoverPokeID;
    u8 damagedPokeID;
    HandlerParam_StrParams exStr;
};

static_assert(sizeof(HandlerParam_Drain) == 0x30,
    "HandlerParam_Drain layout changed");

struct HandlerParam_Damage {
    HandlerParam_Header header;
    u16 damage;
    u8 pokeID;
    u8 flags;
    u16 effectNo;
    u8 posFrom;
    u8 posTo;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_CureCondition {
    HandlerParam_Header header;
    CONDITION condition;
    u8 pokeID[12];
    u8 pokeCount;
    u8 msgDisable;
    u8 pad[2];
    HandlerParam_StrParams exStr;
};

struct HandlerParam_AddCondition {
    HandlerParam_Header header;
    CONDITION condition;
    ConditionData condData;
    u8 almost;
    u8 reserved;
    u8 overwriteMode;
    u8 pokeID;
    u8 overwriteMode2;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_ChangeType {
    HandlerParam_Header header;
    u16 pokeType;
    u8 pokeID;
    u8 field_7;
};

struct HandlerParam_ChangeAbility {
    HandlerParam_Header header;
    u16 ability;
    u8 pokeID;
    u8 sameAbilityEffective;
    u8 skipSwitchInEvent;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_SwapItem {
    HandlerParam_Header header;
    u8 pokeID;
    u8 incRecordCount;
    HandlerParam_StrParams exStr;
    HandlerParam_StrParams exSubStr1;
    HandlerParam_StrParams exSubStr2;
};

struct HandlerParam_ChangeStatStage {
    HandlerParam_Header header;
    StatStage stat;
    u32 pad;
    s8 volume;
    u8 pad2;
    u8 moveAnimation;
    u8 pokeCount;
    u8 pokeID[6];
    HandlerParam_StrParams exStr;
};

struct HandlerParam_SetStatStage {
    HandlerParam_Header header;
    u8 pokeID;
    s8 attack;
    s8 defense;
    s8 specialAttack;
    s8 specialDefense;
    s8 speed;
    s8 accuracy;
    s8 evasion;
};

struct HandlerParam_SetBaseStats {
    HandlerParam_Header header;
    u16 attack;
    u16 defense;
    u16 specialAttack;
    u16 specialDefense;
    u16 speed;
    u8 pokeID;
    u8 enableFlags;
    HandlerParam_StrParams exStr;
};

static_assert(sizeof(HandlerParam_SetBaseStats) == 0x38,
    "HandlerParam_SetBaseStats layout changed");

struct HandlerParam_SetTurnFlag {
    HandlerParam_Header header;
    TURN_FLAG flag;
    u8 pokeID;
    u8 pad[3];
};

struct HandlerParam_RemoveSideEffect {
    HandlerParam_Header header;
    u8 flags[3];
    u8 side;
};

struct HandlerParam_AddSideEffect {
    HandlerParam_Header header;
    SIDE_EFFECT sideEffect;
    ConditionData condData;
    u8 side;
    u8 pad[3];
    HandlerParam_StrParams exStr;
};

struct HandlerParam_RemoveFieldEffect {
    HandlerParam_Header header;
    FIELD_EFFECT effect;
};

struct HandlerParam_AddFieldEffect {
    HandlerParam_Header header;
    FIELD_EFFECT effect;
    ConditionData condData;
};

struct HandlerParam_AddPosEffect {
    HandlerParam_Header header;
    POS_EFFECT posEffect;
    u32 targetPos;
    u32 workToCopy[4];
    u32 workCount;
};

struct HandlerParam_ChangeForm {
    HandlerParam_Header header;
    u8 pokeID;
    u8 newForm;
    u8 dontResetOnSwitch;
    u8 pad;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_ConsumeItem {
    HandlerParam_Header header;
    u32 dontUse;
    HandlerParam_StrParams exStr;
};

struct HandlerParam_Switch {
    HandlerParam_Header header;
    HandlerParam_StrParams preStr;
    HandlerParam_StrParams exStr;
    u8 pokeID;
    u8 intrDisable;
    u8 pad[2];
};

struct ServerFlow {
    BtlServerWk* server;
    MainModule* mainModule;
    PokeCon* pokeCon;
    ServerCommandQueue* serverCommandQueue;
    u32 turnCount;
    u32 flowResult;
    u8 pad_18[0x3C8];
    FaintRecord faintRecord;
    u8 pad_4A4[0x2A];
    u16 field_4CE;
    u8 pad_4D0[0x2A4];
    u32 simulationCounter;
    u32 moveStatEffectSerial;
    u8 commandBuildStep;
    u8 actionOrderStep;
    u8 turnCheckSeq;
    u8 defaultTargetPos;
    u16 heapID;
    u8 numActOrder;
    u8 numEndActOrder;
    u8 pad_784[0x06];
    u8 field_78A;
    u8 pad_78B[0x55];
    ActionOrderWork actionOrderWork[6];
    u8 pad_840[0x154];
    PokeSet currentpokeSet;
    u8 pad_9A8[0x13D0];
    u32 HEManager;
};

static_assert(sizeof(ActionOrderWork) == 0x10, "ActionOrderWork layout changed");
static_assert(__builtin_offsetof(ServerFlow, numActOrder) == 0x782,
    "ServerFlow::numActOrder offset changed");
static_assert(__builtin_offsetof(ServerFlow, simulationCounter) == 0x774,
    "ServerFlow::simulationCounter offset changed");
static_assert(__builtin_offsetof(ServerFlow, field_78A) == 0x78A,
    "ServerFlow::field_78A offset changed");
static_assert(__builtin_offsetof(ServerFlow, actionOrderWork) == 0x7E0,
    "ServerFlow::actionOrderWork offset changed");

extern "C" u32 BattleAction_GetAction(BattleActionParam* param);
extern "C" void BattleAction_SetNull(BattleActionParam* actionParam);
extern "C" u32 BattleViewCmd_UI_SelectMove_Wait(BtlvCore* btlCore);
extern "C" u32 BattleRandom(u32 range);
extern "C" BattleStyle BtlSetup_GetBattleStyle(MainModule* mainModule);
extern "C" BattleType MainModule_GetBattleType(MainModule* mainModule);
extern "C" void MainModule_NotifyBattleResult(MainModule* mainModule, u32 result);
extern "C" b32 IsCenterInTripleBattle(u32 battlePos);

extern "C" u32 GCTX_HIDGetPressedKeys();

extern "C" b32 MainModule_IsAllyMonID(u32 slot1, u32 slot2);
extern "C" BattleMon* PokeCon_GetBattleMon(PokeCon* pokeCon, u32 index);
extern "C" BattleParty* PokeCon_GetBattleParty(PokeCon* pokeCon, u32 clientID);
extern "C" BattleMon* BattleParty_GetPartyMember(BattleParty* battleParty, u32 partySlot);
extern "C" void PokeSet_SeekStart(PokeSet* pokeSet);
extern "C" BattleMon* PokeSet_SeekNext(PokeSet* pokeSet);
extern "C" void PokeSet_Remove(PokeSet* pokeSet, BattleMon* battleMon);
extern "C" u32 BattleMon_GetValue(BattleMon* battleMon, BattleMonValue value);
extern "C" ITEM BattleMon_GetHeldItem(BattleMon* battleMon);
extern "C" bool BattleMon_IsFainted(BattleMon* battleMon);
extern "C" b32 BattleMon_IsStatChangeValid(BattleMon* battleMon, StatStage stat, int volume);
extern "C" void Turnflag_Clear(BattleMon* battleMon, TURN_FLAG turnFlag);
extern "C" void TurnFlag_Set(BattleMon* battleMon, TURN_FLAG turnFlag);
extern "C" u32 BattleMon_TransformCheck(BattleMon* battleMon);
extern "C" bool BattleMon_ChangeForm(BattleMon* battleMon, u32 form);
extern "C" void BattleMon_ChangeAbility(BattleMon* battleMon, u16 ability);
extern "C" void BattleMon_SetItem(BattleMon* battleMon, ITEM itemID);
extern "C" void BattleMon_ConsumeItem(BattleMon* battleMon, ITEM itemID);
extern "C" bool BattleMon_CheckIfMoveCondition(BattleMon* battleMon, CONDITION condition);
extern "C" ConditionData BattleMon_GetMoveCondition(BattleMon* battleMon, CONDITION condition);
extern "C" CONDITION BattleMon_GetStatus(BattleMon* battleMon);
extern "C" bool BattleMon_GetTurnFlag(BattleMon* battleMon, TURN_FLAG turnFlag);
extern "C" bool BattleMon_IsSubstituteActive(BattleMon* battleMon);
extern "C" void BattleMon_SetMovesAndPP(BattleMon* battleMon);
extern "C" bool BattleMon_GetConditionFlag(BattleMon* battleMon, CONDITION_FLAG conditionFlag);
extern "C" b32 BattleField_CheckEffect(FIELD_EFFECT fieldEffect);
extern "C" void BattleMon_ClearTransformChange(BattleMon* battleMon);
extern "C" void BattleMon_ClearUsedMoveFlag(BattleMon* battleMon);
extern "C" void BattleMon_ClearComboMoveData(BattleMon* battleMon);
extern "C" void BattleMon_IllusionBreak(BattleMon* battleMon);
extern "C" void BattleMon_RemoveSubstitute(BattleMon* battleMon);

extern "C" u32 PokeParty_GetParam(PartyPkm* pPkm, PkmField field, void* extra);
extern "C" void PokeParty_SetParam(PartyPkm* pPkm, PkmField field, u32 data);
extern "C" void PokeParty_RecalcStats(PartyPkm* pPoke);

extern "C" void ServerDisplay_AddCommon(ServerCommandQueue* serverCommandQueue, ServerCommandID commandID, ...);
extern "C" void ServerDisplay_AddMessageImpl(ServerCommandQueue* serverCommandQueue, ServerCommandID commandID, u16 msgID, ...);
extern "C" void ServerDisplay_AbilityPopupAdd(ServerFlow* serverFlow, BattleMon* battleMon);
extern "C" void ServerDisplay_AbilityPopupRemove(ServerFlow* serverFlow, BattleMon* battleMon);
extern "C" u32 ServerDisplay_IllusionSet(ServerFlow* serverFlow, u16* switchWork);
extern "C" void ServerDisplay_UseHeldItem(ServerFlow* serverFlow, BattleMon* battleMon);
extern "C" void ServerDisplay_SetConditionFlag(ServerFlow* serverFlow, BattleMon* battleMon, CONDITION_FLAG flag);
extern "C" void ServerDisplay_SetTurnFlag(ServerFlow* serverFlow, BattleMon* battleMon, TURN_FLAG flag);
extern "C" void ServerDisplay_SimpleHP(ServerFlow* serverFlow, BattleMon* battleMon, int damage, b32 animate);
extern "C" void BattleHandler_StrSetup(HandlerParam_StrParams* str, u32 strType, u32 msgID);
extern "C" void BattleHandler_AddArg(HandlerParam_StrParams* str, u32 arg);
extern "C" void BattleHandler_StrClear(HandlerParam_StrParams* str);
extern "C" void* BattleHandler_PushWork(ServerFlow* serverFlow, BattleHandlerEffect effect, u32 pokemonSlot);
extern "C" void BattleHandler_PopWork(ServerFlow* serverFlow, void* work);
extern "C" void BattleHandler_SetString(ServerFlow* serverFlow, HandlerParam_StrParams* str);
extern "C" u32 BattleMon_GetRealStat(BattleMon* battleMon, BattleMonValue statStage);

extern "C" u32 HEManager_PushState(u32* HEManager);
extern "C" void HEManager_PopState(u32* HEManager, u32 HEID);
extern "C" u32 AddConditionCheckFailOverwrite(
    ServerFlow* serverFlow,
    BattleMon* defendingMon,
    CONDITION condition,
    ConditionData condData,
    u8 overrideMode);
extern "C" u32 AddConditionCheckFailStandard(
    ServerFlow* serverFlow,
    BattleMon* defendingMon,
    u32 failStatus,
    CONDITION condition);
extern "C" u32 ServerEvent_MoveConditionCheckFail(
    ServerFlow* serverFlow,
    BattleMon* attackingMon,
    BattleMon* defendingMon,
    CONDITION condition);
extern "C" void ServerEvent_AddConditionFailed(
    ServerFlow* serverFlow,
    BattleMon* defendingMon,
    BattleMon* attackingMon,
    CONDITION condition);
extern "C" void ServerEvent_ChangeAbilityBefore(ServerFlow* serverFlow, u32 pokemonSlot, ABILITY oldAbility, ABILITY newAbility);
extern "C" void ServerEvent_ChangeAbilityAfter(ServerFlow* serverFlow, u32 pokemonSlot);
extern "C" WEATHER ServerEvent_GetWeather(ServerFlow* serverFlow);
extern "C" void ServerEvent_ItemSetDecide(ServerFlow* serverFlow, BattleMon* battleMon, ITEM itemID);
extern "C" void ServerEvent_ItemRewriteDone(ServerFlow* serverFlow, BattleMon* battleMon);
extern "C" void ServerEvent_CheckMultihitHits(ServerFlow* serverFlow, BattleMon* attackingMon, u32 moveID, HitCheckParam* params);
extern "C" u32 ServerEvent_CheckProtectBreak(ServerFlow* serverFlow, BattleMon* attackingMon);
extern "C" u32 ServerEvent_CalculateSpeed(ServerFlow* serverFlow, BattleMon* battleMon, b32 checkTrickRoom);
extern "C" void AbilityEvent_RemoveItem(BattleMon* battleMon);
extern "C" BattleEventItem* AbilityEvent_AddItem(BattleMon* battleMon);
extern "C" void ItemEvent_RemoveItem(BattleMon* battleMon);
extern "C" BattleEventItem* ItemEvent_AddItem(BattleMon* battleMon);
extern "C" BattleEventItem* ItemEvent_AddItemCore(BattleMon* battleMon, ITEM itemID);
extern "C" void ItemEvent_PushRun(BattleEventItem* item, ServerFlow* serverFlow, u32 pokemonSlot);
extern "C" b32 CommonConditionCodeMatch(ServerFlow* serverFlow, u32 pokemonSlot, CONDITION condition);
extern "C" void CommonTypeBoostingItem(BattleEventItem* item, ServerFlow* serverFlow, u32 pokemonSlot, u32 type);
extern "C" void CommonResistBerry(BattleEventItem* item, ServerFlow* serverFlow, u32 pokemonSlot, u32* work, u8 pokeType, b32 skipEffectivenessCheck);
extern "C" void HandlerCommonResistBerryDamageAfter(BattleEventItem* item, ServerFlow* serverFlow, u32 pokemonSlot, u32* work);
extern "C" void ServerControl_CheckItemReaction(ServerFlow* serverFlow, BattleMon* battleMon, u32 flags);
extern "C" b32 ServerControl_CheckFainted(ServerFlow* serverFlow, BattleMon* battleMon);
extern "C" b32 ServerControl_IsGuaranteedHit(ServerFlow* serverFlow, BattleMon* attackingMon, BattleMon* defendingMon);
extern "C" b32 ServerControl_CheckNoEffectCore(
    ServerFlow* serverFlow,
    u16* moveID,
    BattleMon* attackingMon,
    BattleMon* defendingMon,
    int dmgAffRec,
    u32 eventType);
extern "C" b32 ServerControl_CheckFloating(ServerFlow* serverFlow, BattleMon* battleMon, u32 checkSkyDrop);
extern "C" void ServerControl_CheckActivation(ServerFlow* serverFlow);
extern "C" b32 ServerControl_CheckMatchup(ServerFlow* serverFlow);
extern "C" u32 ServerControl_CheckExpGet(ServerFlow* serverFlow);
extern "C" b32 ServerControl_TurnCheck(ServerFlow* serverFlow);
extern "C" u32 ServerFlow_ReqChangePokeForServer(ServerFlow* serverFlow, u16* switchWork);
extern "C" void ServerControl_SwitchInCore(ServerFlow* serverFlow, u32 clientID, u32 switchInSlot, u32 switchOutSlot);
extern "C" void ServerControl_ChangeHeldItem(ServerFlow* serverFlow, BattleMon* battleMon, ITEM itemID, b32 consumeItem);
extern "C" b32 HandlerCommon_CheckIfCanStealPokeItem(ServerFlow* serverFlow, u32 thiefSlot, u32 targetSlot);
extern "C" b32 HandlerCommon_CheckTargetMonID(u32 pokemonSlot);
extern "C" b32 HandlerCommon_IsUnremovableItem(BattleMon* battleMon, ITEM itemID);
extern "C" b32 Handler_CheckMatchup(ServerFlow* serverFlow);
extern "C" b32 Handler_IsSimulationMode(ServerFlow* serverFlow);
extern "C" u32 Handler_IsPosOpenForRevivedMon(ServerFlow* serverFlow);
extern "C" void HandlerOvercoat(BattleEventItem* item, ServerFlow* serverFlow, u32 pokemonSlot, u32* work);
extern "C" void HandlerThiefStart(BattleEventItem* item, ServerFlow* serverFlow, u32 pokemonSlot, u32* work);
extern "C" u32 Handler_GetFightEnableBenchPokeNum(ServerFlow* serverFlow, u32 pokemonSlot);
extern "C" b32 Handler_CheckReservedMemberChangeAction(ServerFlow* serverFlow);
extern "C" BattleMon* Handler_GetBattleMon(ServerFlow* serverFlow, u32 pokemonSlot);
extern "C" u32 Handler_PokeIDToPokePos(ServerFlow* serverFlow, u32 pokemonSlot);
extern "C" u32 Handler_PokePosToPokeID(ServerFlow* serverFlow, u32 pokemonPos);

extern "C" u8* MoveWork_ClearSurface(BattleMon* battleMon);
extern "C" void ClearCounter(BattleMon* battleMon);
extern "C" void ClearMoveStatusWork(BattleMon* battleMon, bool removeStatus);
extern "C" void ResetStatStages(StatStageParam* statChanges);
extern "C" u32 ActionOrder_Proc(ServerFlow* serverFlow, ActionOrderWork* actionOrder);
extern "C" b32 ActionOrder_InterruptReserve(ServerFlow* serverFlow, u32 pokemonSlot);
extern "C" u32 ActionOrder_SendToLast(ServerFlow* serverFlow, u32 pokemonSlot);
extern "C" void SortActionOrderBySpeed(ServerFlow* serverFlow, ActionOrderWork* actionOrder, u32 remainingActions);
extern "C" u32 j_j_FaintRecord_GetCount_1(FaintRecord* faintRecord, u32 turn);
extern "C" ConditionData Condition_MakePermanent();
extern "C" ConditionData Condition_MakeTurn(u32 turnCount);
extern "C" ConditionData Condition_MakeTurnParam(u32 maxTurns, u32 param);
extern "C" ConditionData MakeBasicStatus(CONDITION condition);
extern "C" ConditionData MakeCondition(CONDITION condition, BattleMon* battleMon, ConditionData* condData);
extern "C" MOVE_ID Condition_GetParam(ConditionData conditionData);
extern "C" void MoveEvent_ForceRemoveItemFromBattleMon(BattleMon* battleMon, MOVE_ID moveID);
extern "C" void sys_memset(void* dst, int value, u32 size);

extern "C" u32 GetSideFromMonID(u32 pokemonSlot);
extern "C" u32 GetSideFromOpposingMonID(u32 pokemonSlot);

extern "C" bool GiratinaArceusGenesectItemCheck(BattleMon* battleMon, ITEM itemID);

#endif
