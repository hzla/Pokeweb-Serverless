#ifndef POKEBW2_BATTLE_BTLV_MCSS_H
#define POKEBW2_BATTLE_BTLV_MCSS_H

// Overlay 168's btlv_mcss.c (named by its string), the battle view's Pokémon sprites: it wraps the MCSS sprite system,
// loading, placing, scaling, animating and recoloring each battler's sprite, and moves them with tasks. The names are
// ours; swan has none for this file

#include "types.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "nitro/gx.h"
#include "struct_decls.h"
#include "system/mcss.h"

// A sprite's position: 0 and 1 the Pokémon of a single battle, 2 to 7 those of the other battles, even on the player's
// side, and from 8 on the trainers. An enum, so MWCC keeps the first test of the loops over the positions
typedef enum {
    BTLV_MCSS_POS_FIRST = 0,
    BTLV_MCSS_POS_SINGLE_PLAYER = 0, // the player's Pokémon of a single battle
    BTLV_MCSS_POS_SINGLE_ENEMY = 1,  // the opponent's
    BTLV_MCSS_POS_TRAINER = 8,
    BTLV_MCSS_POS_MAX = 14,
} BtlvMcssPos;

// What BtlvMcss_GetFlags returns of a sprite
#define BTLV_MCSS_FLAG_UNK0 (1 << 0)       // set and cleared with the substitute
#define BTLV_MCSS_FLAG_RARE (1 << 1)       // shiny
#define BTLV_MCSS_FLAG_SUBSTITUTE (1 << 2) // the sprite shows the substitute
#define BTLV_MCSS_FLAG_N_POKEMON (1 << 3)  // one of N's Pokémon
#define BTLV_MCSS_FLAG_FAMOUS (1 << 4)     // a Pokéstar fame of 4 or more

// A move of a sprite around a circle, which BtlvMcss_MoveCircle copies from pos on into its task. The alignment of
// work, here and in BtlvMcssShake, is a guess: it changes no layout, only how MWCC compiles accesses through the
// member, and with it the end callbacks load work before pos, as the original does (docs/matching.md, Loops:
// "Where a member's alignment is written")
typedef struct {
    ATTRIBUTE_ALIGN(4) BtlvMcss *work; // 0x00
    s32 pos;                           // 0x04
    s32 mode;                          // 0x08  bit 0: the other way round; bits 1-2: the plane, 0: y-z, 1: x-z, 2: x-y
    u32 start;                         // 0x0c  the circle point it starts from, 0-3; mirrored for the enemy side
    fx32 radius1;                      // 0x10
    fx32 radius2;                      // 0x14
    s32 frames;                        // 0x18  steps by turn
    s32 wait;                          // 0x1c  frames between steps
    s32 count;                         // 0x20  turns
    s32 turnWait;                      // 0x24  frames to wait after each turn
    s32 angle;                         // 0x28
    s32 speed;                         // 0x2c
    s32 waitCount;                     // 0x30
    s32 turnWaitLeft;                  // 0x34
    u32 seq;                           // 0x38  the position's move counter when the task started
} BtlvMcssCircle;

// A shake of a sprite along an axis by a sine, which BtlvMcss_Shake copies into its task
typedef struct {
    ATTRIBUTE_ALIGN(4) BtlvMcss *work; // 0x00
    s32 pos;                           // 0x04
    VecFx32 start;                     // 0x08  the position, read when the shake starts
    s32 axis;                          // 0x14  0: x, otherwise y
    fx32 angle;                        // 0x18  the sine's angle, a 16-bit angle in fx32
    fx32 speed;                        // 0x1c
    fx32 amplitude;                    // 0x20
    s32 frames;                        // 0x24
    u32 seq;                           // 0x28  the position's move counter when the task started
} BtlvMcssShake;

BtlvMcss *BtlvMcss_Create(u32 battleStyle, TCBManager *tcbMgr, HeapID heapId);
void BtlvMcss_Delete(BtlvMcss *work);
void BtlvMcss_Main(BtlvMcss *work);
void BtlvMcss_Draw(BtlvMcss *work);
void BtlvMcss_AddPokemon(BtlvMcss *work, PartyPkm *pkm, int pos);
void BtlvMcss_AddTrainer(BtlvMcss *work, u32 trainerType, int pos);
void BtlvMcss_Remove(BtlvMcss *work, int pos);
void BtlvMcss_SetSideScale(BtlvMcss *work, fx32 scaleNear, fx32 scaleFar);
void BtlvMcss_SetPosition(BtlvMcss *work, int pos, fx32 x, fx32 y, fx32 z);
void BtlvMcss_SetFlatAll(BtlvMcss *work);
void BtlvMcss_ClearFlatAll(BtlvMcss *work);
void BtlvMcss_SetFlat(BtlvMcss *work, int pos);
void BtlvMcss_ClearFlat(BtlvMcss *work, int pos);
void BtlvMcss_SetAnimPause(BtlvMcss *work, int pos, int mode);
BOOL BtlvMcss_GetVanish(BtlvMcss *work, int pos);
void BtlvMcss_SetVanish(BtlvMcss *work, int pos, int mode);
void BtlvMcss_GetDefaultPos(BtlvMcss *work, VecFx32 *out, int pos);
void BtlvMcss_GetDefaultPosForStyle(BtlvMcss *work, VecFx32 *out, int pos, u32 battleStyle);
fx32 BtlvMcss_GetDefaultScale(BtlvMcss *work, int pos, BOOL flat);
void BtlvMcss_SetShadows(BtlvMcss *work, BOOL shadows);
void BtlvMcss_SetShadowVanish(BtlvMcss *work, int pos, u8 value);
void BtlvMcss_SetAnimSpeed(BtlvMcss *work, int pos, fx32 speed);
void BtlvMcss_MovePosition(BtlvMcss *work, int pos, int type, VecFx32 *dest, s32 frames, s32 wait, s32 count);
void BtlvMcss_MoveVec518(BtlvMcss *work, int pos, int type, VecFx32 *dest, s32 frames, s32 wait, s32 count);
void BtlvMcss_MoveScale(BtlvMcss *work, int pos, int type, VecFx32 *dest, s32 frames, s32 wait, s32 count);
void BtlvMcss_MoveVec524(BtlvMcss *work, int pos, int type, VecFx32 *dest, s32 frames, s32 wait, s32 count);
void BtlvMcss_MoveVec51c(BtlvMcss *work, int pos, int type, VecFx32 *dest, s32 frames, s32 wait, s32 count);
void BtlvMcss_SwapPositions(BtlvMcss *work, int pos1, int pos2);
void BtlvMcss_Blink(BtlvMcss *work, int pos, int type, s32 wait, s32 count);
void BtlvMcss_MoveAlpha(BtlvMcss *work, int pos, int type, int alpha, s32 frames, s32 wait, s32 count);
void BtlvMcss_MoveCircle(BtlvMcss *work, BtlvMcssCircle *param);
void BtlvMcss_Shake(BtlvMcss *work, BtlvMcssShake *param);
void BtlvMcss_MoveLevel(BtlvMcss *work, int pos, int type, int level, s32 frames, s32 wait, s32 count);
BOOL BtlvMcss_IsBusy(BtlvMcss *work, int pos);
BOOL BtlvMcss_IsAnyBusy(BtlvMcss *work);
BOOL BtlvMcss_Exists(BtlvMcss *work, int pos);
void BtlvMcss_StartPaletteFade(BtlvMcss *work, int pos, u8 startEvy, u8 endEvy, u8 wait, u32 color);
void BtlvMcss_ChangePokemon(BtlvMcss *work, int pos, PartyPkm *pkm);
u16 BtlvMcss_GetWeight(BtlvMcss *work, int pos);
u32 BtlvMcss_GetFlags(BtlvMcss *work, int pos);
BOOL BtlvMcss_IsNoBounce(BtlvMcss *work, int pos);
u8 BtlvMcss_GetUnk(BtlvMcss *work, int pos);
void BtlvMcss_SetSubstitute(BtlvMcss *work, int pos, BOOL substitute, BOOL flag);
void BtlvMcss_Transform(BtlvMcss *work, int targetPos, int pos);
void BtlvMcss_ReloadSprite(BtlvMcss *work, int pos, const MCSSLoadInfo *info);
u32 BtlvMcss_PlayCry(BtlvMcss *work, int pos, int speed, int volume, int arg4, int arg5, int arg6);
void BtlvMcss_StartRotation(BtlvMcss *work, int side, int dir, BOOL playSe);
u32 BtlvMcss_GetBall(BtlvMcss *work, int pos);
void BtlvMcss_SetupPokemonLoadInfo(BtlvMcss *work, PartyPkm *pkm, MCSSLoadInfo *info, int pos);
BOOL BtlvMcss_SetAnimation(BtlvMcss *work, int pos, int anim);
void BtlvMcss_WatchAnimationEnd(BtlvMcss *work, int pos);
BOOL BtlvMcss_IsAnimationSet(BtlvMcss *work, int pos);
void BtlvMcss_ResetPosition(BtlvMcss *work, int pos);
void BtlvMcss_SetUnkB270(BtlvMcss *work, int pos, BOOL check);
BOOL BtlvMcss_CheckChanged(BtlvMcss *work, int pos);
void BtlvMcss_SaveVanish(BtlvMcss *work);
void BtlvMcss_RestoreVanish(BtlvMcss *work);

#endif // POKEBW2_BATTLE_BTLV_MCSS_H
