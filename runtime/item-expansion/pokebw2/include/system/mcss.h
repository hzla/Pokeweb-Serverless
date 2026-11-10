#ifndef POKEBW2_SYSTEM_MCSS_H
#define POKEBW2_SYSTEM_MCSS_H

#include "types.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "nitro/gx.h"
#include "nnsys/g2d.h"
#include "struct_decls.h"

// MCSS, the system that draws Pokémon and trainer sprites from multi-cell animations. It is mcss.c in the main module

typedef struct MCSSSystem MCSSSystem;
typedef struct MCSS MCSS;

// The archive and files of a sprite's graphics, as SetupPokemonLoaderFSTool fills it in
typedef struct {
    u32 arcId;
    u32 character;
    u32 palette;
    u32 cells;
    u32 cellAnime;
    u32 multiCells;
    u32 multiCellAnime;
    u32 bin;
    u32 unk20;
} MCSSLoadInfo;

// Called with the callback's parameter and the animation's frame
typedef void (*MCSSAnimationCallback)(u32 param, fx32 frame);

// A sprite's characters and palette on their way to VRAM, which a task loads in the V-blank. A palette that the
// system blends has no files: its palette data and colors are allocated
typedef struct {
    NNSG2dCharacterData *chars;
    NNSG2dPaletteData *pltt;
    NNSG2dImageProxy *imageProxy;
    NNSG2dImagePaletteProxy *plttProxy;
    void *charFile;
    void *plttFile;
    u32 charAddr;
    u32 plttAddr;
    MCSSSystem *system;
    MCSS *mcss;
    // Whether the task runs in the system's task manager, and not in the V-blank's
    BOOL inTcbMgr;
} MCSSLoad;

// Called with a sprite's files read and not yet loaded, to change its characters. Returning TRUE removes the callback
typedef BOOL (*MCSSLoadCallback)(const MCSSLoadInfo *info, MCSSLoad *load, u32 work);

MCSSSystem *MCSSSys_Create(u32 capacity, HeapID heapId);
void MCSSSys_Free(MCSSSystem *system);
// Steps the animation of every sprite that is not paused
void MCSSSys_Update(MCSSSystem *system);
void MCSSSys_Draw(MCSSSystem *system);
MCSS *MCSSSys_Add(MCSSSystem *system, fx32 x, fx32 y, fx32 z, const MCSSLoadInfo *info);
void MCSSSys_Remove(MCSSSystem *system, MCSS *mcss);
void MCSSSys_EnableOrtho(MCSSSystem *system);
void MCSSSys_DisableOrtho(MCSSSystem *system);
// The archive of the sprites' files, which MCSSSys_OpenArc opens and MCSSSys_CloseArc closes, and the task manager that
// runs the sprites' fades, which an app clears while it adds sprites
void MCSSSys_OpenArc(MCSSSystem *system, u32 arcId);
void MCSSSys_CloseArc(MCSSSystem *system);
void MCSSSys_SetTCBManager(MCSSSystem *system, TCBManager *tcbMgr);
void MCSSSys_SetLoadCallback(MCSSSystem *system, MCSSLoadCallback callback, u32 work);
void MCSS_Reload(MCSSSystem *system, MCSS *mcss, const MCSSLoadInfo *info);
// Where the sprites' character and palette data go: each sprite's is at these offsets plus 0x4000 and 0x20 bytes per
// slot
void MCSSSys_SetTexBase(MCSSSystem *system, u32 characterOffset);
void MCSSSys_SetPlttBase(MCSSSystem *system, u32 paletteOffset);
void MCSSSys_SetOffsetScale(MCSSSystem *system, u32 offset);

void MCSS_GetPosition(MCSS *mcss, VecFx32 *position);
void MCSS_SetPosition(MCSS *mcss, VecFx32 *position);
void MCSS_SetScale(MCSS *mcss, VecFx32 *scale);
void MCSS_SetScaleOffset(MCSS *mcss, VecFx32 *a1);
void MCSS_SetShadowScale(MCSS *mcss, VecFx32 *a1);
void MCSS_SetShadowRotX(MCSS *mcss, u16 a1);
void MCSS_SetShadowOffset(MCSS *mcss, VecFx32 *a1);
void MCSS_EnableFlipV(MCSS *mcss);
void MCSS_DisableFlipV(MCSS *mcss);
void MCSS_PauseAnimation(MCSS *mcss);
void MCSS_ResumeAnimation(MCSS *mcss);
void MCSS_Hide(MCSS *mcss);
void MCSS_Show(MCSS *mcss);
// Sets the callback that runs when the sprite's animation reaches its last frame
void MCSS_SetAnimationEndCallback(MCSS *mcss, u32 param, MCSSAnimationCallback callback, u32 unused);
// Alpha from 0 to 31
void MCSS_SetAlpha(MCSS *mcss, u8 alpha);
void MCSS_SetAnimation(MCSS *mcss, u32 animation);
void MCSS_RestartAnimation(MCSS *mcss);
// Alpha from 0 to 31
u8 MCSS_GetAlpha(MCSS *mcss);
// Fades the palette between two levels of a color, and whether the fade is running
void MCSS_StartFade(MCSS *mcss, u8 startLevel, u8 endLevel, s32 wait, u32 color);
BOOL MCSS_IsFading(MCSS *mcss);
void MCSS_SetNoShadow(MCSS *mcss, u32 a1);
void MCSS_SetShadowAlpha(MCSS *mcss, u32 a1);
void MCSS_SetPositionOffset(MCSS *mcss, VecFx32 *a1);
u16 MCSS_GetHeight(MCSS *mcss);
u16 MCSS_GetWidth(MCSS *mcss);
s16 MCSS_GetOffsetX(MCSS *mcss);
s16 MCSS_GetOffsetY(MCSS *mcss);
// The sprite's multi-cell animation, whose animation controller NNS_G2dSetAnimCtrlCallBackFunctor takes
NNSG2dMultiCellAnimation *MCSS_GetMultiCellAnimation(MCSS *mcss);
void MCSS_SetLoopAnimation(MCSS *mcss);
// Called as a sprite's animation ends
void MCSS_RequestRestart(MCSS *mcss);

// More of a sprite's state, which the battle view's sprites use
void MCSS_EnableOrtho(MCSS *mcss);
void MCSS_DisableOrtho(MCSS *mcss);
void MCSS_GetPositionOffset(MCSS *mcss, VecFx32 *out);
void MCSS_GetScale(MCSS *mcss, VecFx32 *out);
void MCSS_GetScaleOffset(MCSS *mcss, VecFx32 *out);
void MCSS_GetRotation(MCSS *mcss, VecFx32 *out);
void MCSS_SetRotation(MCSS *mcss, const VecFx32 *in);
void MCSS_GetShadowScaleOffset(MCSS *mcss, VecFx32 *out);
void MCSS_SetShadowScaleOffset(MCSS *mcss, VecFx32 *in);
void MCSS_SetShadowRotZ(MCSS *mcss, u16 value);
void MCSS_ToggleFlipV(MCSS *mcss);
BOOL MCSS_IsPaused(MCSS *mcss);
void MCSS_FreezeAnimation(MCSS *mcss);
void MCSS_UnfreezeAnimation(MCSS *mcss);
BOOL MCSS_IsHidden(MCSS *mcss);
void MCSS_ToggleHidden(MCSS *mcss);
u16 MCSS_GetAnimationCount(MCSS *mcss);
u8 MCSS_GetIdleNodeCount(MCSS *mcss);
u16 MCSS_GetIdleNode(MCSS *mcss, u8 index);
u8 func_0201ae00(MCSS *mcss);
void MCSS_TraverseNodes(MCSS *mcss, u32 param,
                        BOOL (*func)(u32 param, const NNSG2dMultiCellHierarchyData *node, NNSG2dCellAnimation *cellAnim,
                                     u16 nodeIdx));
u8 MCSS_GetMosaic(MCSS *mcss);
void MCSS_SetMosaic(MCSSSystem *system, MCSS *mcss, int level);
void MCSS_SetAnimSpeed(MCSS *mcss, fx32 speed);
u16 MCSS_GetSequenceCount(MCSS *mcss);
void MCSS_BlendPalette(MCSSSystem *system, MCSS *mcss, u8 evy, u32 color);
void MCSS_ResetPalette(MCSSSystem *system, MCSS *mcss);
void MCSS_SetReverse(MCSS *mcss, BOOL flag);
void MCSSSys_SetCellDepth(MCSSSystem *system, u32 value);
void MCSSSys_SetOrthoNear(MCSSSystem *system, BOOL flag);
// The rest is mcss_tool.c's, which fills in the files of a Pokémon's or a trainer's sprite

// The files of a Pokémon's sprite, with dir and egg as GetPokemonPaletteDataNo takes them
void SetupPokemonLoaderFSTool(u32 species, u32 form, u32 sex, BOOL rare, BOOL egg, MCSSLoadInfo *info, u32 dir);
// The files of a trainer's sprite, from the front or the back
void GetTrainerSpriteResIDs(u32 trainerType, MCSSLoadInfo *info, BOOL back);
// Draws a Spinda's spots for its personality on the next sprite added
void MCSSSys_SetSpindaLoadCallback(MCSSSystem *system, u32 personality);
// Draws a Spinda's spots for its personality on a sprite's characters
void MCSS_DrawSpindaSpots(void *chars, u32 personality);
// Adds the sprite of a party Pokémon
MCSS *MCSSSys_AddPartyPkm(MCSSSystem *system, PartyPkm *pkm, u32 dir, fx32 x, fx32 y, fx32 z);

// SetupPokemonLoaderByBoxData for a party Pokémon
void SetupPokemonLoaderByPartyPkm(PartyPkm *pkm, MCSSLoadInfo *info, u32 dir);

#endif // POKEBW2_SYSTEM_MCSS_H
