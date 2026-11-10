#ifndef POKEBW2_GFL_CLACT_H
#define POKEBW2_GFL_CLACT_H

#include "types.h"
#include "gfl/arc.h"
#include "gfl/graphics.h"
#include "gfl/gx_layers.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "nnsys/g2d.h"

// Cell actors, the OAM sprites of the 2D engines

// Holds cell actors, 0xe4 bytes each
typedef struct ClActUnit ClActUnit;
typedef struct ClActor ClActor;
typedef struct ClActAnim ClActAnim;
typedef struct ClActSys ClActSys;

typedef struct {
    s16 x;
    s16 y;
    u16 sequence;
    u8 priority;
    u8 bgPriority;
} ClActorSetup;

typedef struct {
    // Where the main and sub screens are, for actors positioned on them
    s16 mainX;
    s16 mainY;
    s16 subX;
    s16 subY;
    // The OAMs of each engine the system uses
    u8 oamStartMain;
    u8 oamCountMain;
    u8 oamStartSub;
    u8 oamCountSub;
    // How many VRAM transfer cell animations can play at once
    u32 transferCount;
    // How many resources of each kind can be loaded
    u16 charCount;
    u16 plttCount;
    u16 cellAnimCount;
    u16 unk16;
    // Where the resources start in OBJ VRAM, in 32-byte units
    u16 charOffsetMain;
    u16 charOffsetSub;
} ClActSysSetup;

// The setup that most apps create the system with, the same as the intro's copy
extern const ClActSysSetup data_02093f08;
// Game Sync's screens' setup, with 192 for the sub screen's y
extern const ClActSysSetup data_02093f24;

// Where a resource is loaded: CLACT_VRAM_MAIN, _SUB or _BOTH
enum {
    CLACT_VRAM_MAIN,
    CLACT_VRAM_SUB,
    CLACT_VRAM_BOTH,
};

// The surfaces of the default renderer, which the actors' positions are relative to. An enum, which MWCC does not
// propagate as a constant, as the Pokédex's info page shows
typedef enum {
    CLACT_SURFACE_MAIN,
    CLACT_SURFACE_SUB,
} ClActSurface;

typedef struct ClActRenderer ClActRenderer;

// A surface of a renderer: its view, its screen and how it culls cells
typedef struct {
    s16 x;
    s16 y;
    s16 w;
    s16 h;
    u32 screen;
    u32 culling;
} ClActSurfaceSetup;

typedef struct {
    s16 x;
    s16 y;
} ClActorPos;

typedef struct {
    fx32 x;
    fx32 y;
} ClActorScale;

typedef struct {
    ClActorSetup base;
    ClActorPos affineCenter;
    fx32 scaleX;
    fx32 scaleY;
    u16 rotation;
    u16 affineMode;
} ClActorSetupEx;

// When an animation callback is called
enum {
    CLACT_CALLBACK_LAST_FRAME,
    CLACT_CALLBACK_FRAME,
    CLACT_CALLBACK_EVERY_FRAME,
};

typedef struct {
    u16 type;
    // For CLACT_CALLBACK_FRAME
    u16 frame;
    u32 param;
    NNSG2dAnmCallBackPtr func;
} ClActorCallback;

// The system's resources and transfers, laid out in clact.c
typedef struct ClActCharRes ClActCharRes;
typedef struct ClActPlttRes ClActPlttRes;
typedef struct ClActCellAnimRes ClActCellAnimRes;
typedef struct ClActTransferTask ClActTransferTask;

typedef struct {
    VRAMMan *vmanMain;
    VRAMMan *vmanSub;
    ClActCharRes *chars;
    ClActPlttRes *pltts;
    ClActCellAnimRes *cellAnims;
    u16 charCount;
    u16 plttCount;
    u16 cellAnimCount;
    u16 unk1A;
    u16 offsetMain;
    u16 offsetSub;
} ClActResMan;

typedef struct {
    NNSG2dOamManagerInstance man;
    BOOL active;
} ClActOamMan;

struct ClActRenderer {
    NNSG2dRendererInstance renderer;
    NNSG2dRenderSurface *surfaces;
    u16 surfaceCount;
    // The hint that the renderers begin rendering with, NNS_G2D_RDR_OPZHINT_LOCK_PARAMS with a single surface
    u16 opzHint;
};

typedef struct {
    NNSG2dCellTransferState *states;
    ClActTransferTask *tasks;
    u32 count;
    BOOL active;
} ClActTransfer;

struct ClActSys {
    ClActOamMan oamMans[2];
    ClActRenderer renderer;
    ClActTransfer transfer;
    // What the OAMs' palettes are offset or set to, which the renderers set for each actor they draw
    u16 palettes[2];
    u32 paletteMode;
    BOOL updating;
    BOOL oamReady;
    ClActUnit *units;
    ClActResMan res;
};

struct ClActUnit {
    ClActor *actors;
    // The actors in use, as a list sorted by priority
    ClActor *actorList;
    ClActRenderer *renderer;
    u16 count;
    u8 rendererType : 4;
    u8 active : 1;
    // These two pick the unit's renderer (clact_itcm.c): whether only the visible actors' animations advance, and
    // whether the renderer is set up once, with the first actor's images, attributes and palette, for every actor
    u8 visibleAnimOnly : 1;
    u8 sharedParams : 1;
    u8 priority;
    ClActUnit *next;
    ClActUnit *prev;
};

// How an actor animates: a cell animation, one whose characters are transferred to VRAM as it plays, or a multi-cell
// animation
enum {
    CLACT_ANIM_CELL,
    CLACT_ANIM_VRAM_TRANSFER,
    CLACT_ANIM_MULTICELL,
};

struct ClActAnim {
    u32 type;
    NNSG2dCellDataBank *cells;
    NNSG2dAnimBankData *anims;
    union {
        struct {
            NNSG2dCellAnimation cellAnim;
            u32 transferHandle;
        };
        struct {
            NNSG2dMultiCellAnimation mcAnim;
            NNSG2dMultiCellDataBank *mcBank;
            NNSG2dAnimBankData *mcAnims;
            void *mcWork;
        };
    };
};

struct ClActor {
    ClActor *next;
    ClActor *prev;
    ClActUnit *unit;
    ClActorPos pos;
    ClActorPos affineCenter;
    ClActorScale scale;
    NNSG2dImageProxy imgProxy;
    NNSG2dImagePaletteProxy pltProxy;
    // How far the renderers advance the animation each frame, with autoAnim
    fx32 autoAnimSpeed;
    u16 rotation;
    u16 sequence;
    u16 charIdx;
    u16 plttIdx;
    u32 priority : 8;
    // The OAM attributes the renderer overwrites, NNS_G2D_RND_OVERWRITE_*
    u32 overwrite : 4;
    u32 palette : 4;
    u32 bgPriority : 2;
    u32 affineMode : 2;
    u32 flip : 2;
    u32 objMode : 2;
    u32 mosaic : 1;
    u32 autoAnim : 1;
    u32 visible : 1;
    u32 playMode : 4;
    // Whether palette is the OAMs' palette rather than an offset to it
    u32 paletteMode : 1;
    // Whether the renderers draw only the current cell, without the animation's own transforms
    u32 cellOnly : 1;
    ClActAnim anim;
};

void ClActSys_Create(const ClActSysSetup *setup, const BGSysVRAMConfig *vramConfig, HeapID heapId);
void ClActSys_Delete(void);
void ClActSys_Draw(void);
void ClActSys_VBlank(void);
void ClActSys_ResetOamBuffers(void);

// Load characters (NCGR), a palette (NCLR), and cells with their animations (NCER and NANR) from an archive, and
// return their resource indices
u32 ClActSys_LoadChars(ArcTool *arc, u32 fileId, BOOL compressed, u32 vramType, HeapID heapId);
u32 ClActSys_AllocChars(u32 size, u32 vramType, HeapID heapId);
void ClActSys_FreeChars(u32 chars);
// Replace the data of loaded characters
void ClActSys_ReplaceCharData(u32 chars, NNSG2dCharacterData *character);
void ClActSys_WriteCharData(u32 chars, void *src, u32 size, u32 offset, u32 vramType);
void ClActSys_GetCharProxy(u32 chars, NNSG2dImageProxy *proxy);
u32 ClActSys_GetCharVramAddr(u32 chars, BOOL sub);
#if defined(WHITE2) && defined(W2U_SHARED_BATTLE)
// Zero for an invalid or released resource; no mutable resource layout escapes.
u32 ClActSys_GetCharVramSize(u32 chars);
u32 ClActSys_GetPlttVramSize(u32 palette);
#endif
u32 ClActSys_LoadPltt(ArcTool *arc, u32 fileId, u32 vramType, u16 offset, HeapID heapId);
// ClActSys_LoadPltt loading count palettes from start, all when 0
u32 ClActSys_LoadPlttRange(ArcTool *arc, u32 fileId, u32 vramType, u16 offset, u16 start, u16 count, HeapID heapId);
u32 ClActSys_LoadPlttEx(ArcTool *arc, u32 fileId, u32 vramType, u16 offset, HeapID heapId);
void ClActSys_FreePltt(u32 palette);
// Replace the data of a loaded palette, count palettes of it or all when 0
void ClActSys_ReplacePlttData(u32 palette, NNSG2dPaletteData *data, u32 count);
void ClActSys_GetPlttProxy(u32 palette, NNSG2dImagePaletteProxy *proxy);
u32 ClActSys_GetPlttVramAddr(u32 palette, BOOL sub);
u32 ClActSys_LoadCellAnims(ArcTool *arc, u32 cellFileId, u32 animFileId, HeapID heapId);
void ClActSys_FreeCellAnims(u32 cellAnims);

// A renderer of its own for units, with count surfaces
ClActRenderer *ClActRenderer_Create(const ClActSurfaceSetup *setups, u16 count, HeapID heapId);
void ClActRenderer_Delete(ClActRenderer *renderer);
void ClActRenderer_SetSurfacePos(ClActRenderer *renderer, u32 surface, const ClActorPos *pos);
void ClActRenderer_GetSurfacePos(ClActRenderer *renderer, u32 surface, ClActorPos *pos);
void ClActRenderer_SetCulling(ClActRenderer *renderer, BOOL cull);

ClActUnit *ClActUnit_Create(u16 count, u8 priority, HeapID heapId);
void ClActUnit_Delete(ClActUnit *unit);
void ClActUnit_SetActive(ClActUnit *unit, BOOL active);
BOOL ClActUnit_IsActive(ClActUnit *unit);
void ClActUnit_SetVisibleAnimOnly(ClActUnit *unit, BOOL a1);
void ClActUnit_SetSharedParams(ClActUnit *unit, BOOL a1);
void ClActUnit_SetRenderer(ClActUnit *unit, ClActRenderer *renderer);
void ClActUnit_UseSystemRenderer(ClActUnit *unit);

// Positions are relative to a surface of the unit's renderer, or absolute with surface 0xffff
ClActor *ClActor_Create(ClActUnit *unit, u32 chars, u32 palette, u32 cellAnims, const ClActorSetup *setup, u16 surface,
                        HeapID heapId);
ClActor *ClActor_CreateEx(ClActUnit *unit, u32 chars, u32 palette, u32 cellAnims, const ClActorSetupEx *setup,
                          u16 surface, HeapID heapId);
void ClActor_Delete(ClActor *actor);
void ClActor_SetVisible(ClActor *actor, BOOL visible);
BOOL ClActor_IsVisible(ClActor *actor);
void ClActor_SetSurfacePos(ClActor *actor, const ClActorPos *pos, u16 surface);
void ClActor_GetSurfacePos(ClActor *actor, ClActorPos *pos, u16 surface);
void ClActor_SetSurfacePosAxis(ClActor *actor, s16 value, u16 surface, u32 axis);
s16 ClActor_GetSurfacePosAxis(ClActor *actor, u16 surface, u32 axis);
void ClActor_SetPos(ClActor *actor, const ClActorPos *pos);
void ClActor_GetPos(const ClActor *actor, ClActorPos *pos);
void ClActor_SetPosAxis(ClActor *actor, s16 value, u32 axis);
s16 ClActor_GetPosAxis(ClActor *actor, u32 axis);
void ClActor_SetAffineMode(ClActor *actor, u32 affineMode);
void ClActor_SetAffineCenter(ClActor *actor, const ClActorPos *center);
void ClActor_SetAffineCenterAxis(ClActor *actor, s16 value, u32 axis);
void ClActor_SetScale(ClActor *actor, const ClActorScale *scale);
void ClActor_GetScale(ClActor *actor, ClActorScale *scale);
void ClActor_SetScaleAxis(ClActor *actor, fx32 value, u32 axis);
fx32 ClActor_GetScaleAxis(ClActor *actor, u32 axis);
void ClActor_SetRotation(ClActor *actor, u16 rotation);
u16 ClActor_GetRotation(ClActor *actor);
void ClActor_SetFlip(ClActor *actor, u32 axis, BOOL flip);
BOOL ClActor_GetFlip(ClActor *actor, u32 axis);
// The actor's OBJ mode, GX_OAM_MODE_*
void ClActor_SetObjMode(ClActor *actor, u32 mode);
u32 ClActor_GetObjMode(ClActor *actor);
void ClActor_SetPalette(ClActor *actor, u32 palette, u32 a2);
u8 ClActor_GetPalette(ClActor *actor);
void ClActor_SetPlttProxy(ClActor *actor, const NNSG2dImagePaletteProxy *proxy);
void ClActor_GetPlttProxy(ClActor *actor, NNSG2dImagePaletteProxy *proxy);
void ClActor_SetImageProxy(ClActor *actor, const NNSG2dImageProxy *proxy);
void ClActor_GetImageProxy(ClActor *actor, NNSG2dImageProxy *proxy);
u16 ClActor_GetCharIdx(ClActor *actor);
u16 ClActor_GetPlttIdx(ClActor *actor);
void ClActor_SetPriority(ClActor *actor, u8 priority);
u8 ClActor_GetPriority(ClActor *actor);
void ClActor_SetBgPriority(ClActor *actor, u32 bgPriority);
u8 ClActor_GetBgPriority(ClActor *actor);
// Sets the actor's animation sequence
void ClActor_SetSequence(ClActor *actor, u16 sequence);
u16 ClActor_GetSequence(ClActor *actor);
u16 ClActor_GetSequenceCount(ClActor *actor);
// Sets it only when it changes
void ClActor_ChangeSequence(ClActor *actor, u16 sequence);
// Act on the actor's animation controller
void ClActor_SetAnimTime(ClActor *actor, fx32 time);
void ClActor_SetAnimSpeed(ClActor *actor, fx32 speed);
fx32 ClActor_GetAnimTime(ClActor *actor);
void ClActor_SetAnimFrame(ClActor *actor, u16 frame);
u16 ClActor_GetAnimFrame(ClActor *actor);
void ClActor_SetAutoAnim(ClActor *actor, BOOL a1);
BOOL ClActor_IsAutoAnim(ClActor *actor);
void ClActor_SetAutoAnimSpeed(ClActor *actor, fx32 a1);
void ClActor_StartAnim(ClActor *actor);
void ClActor_StopAnim(ClActor *actor);
BOOL ClActor_IsAnimActive(ClActor *actor);
void ClActor_RestartAnim(ClActor *actor);
void ClActor_SetPlayMode(ClActor *actor, u32 playMode);
void ClActor_SetAnimCallback(ClActor *actor, const ClActorCallback *callback);
void ClActor_ClearAnimCallback(ClActor *actor);
void ClActor_SetDrawAnim(ClActor *actor, BOOL a1);
// The actor system, which the renderers of clact_itcm.c read
extern ClActSys *g_ClActSys;

// Called from the renderers of clact_itcm.c: tick the actor's animation, and set its speed
void ClActAnim_Tick(ClActAnim *anim, fx32 frames);
void ClActAnim_SetSpeed(ClActAnim *anim, fx32 speed);

#endif // POKEBW2_GFL_CLACT_H
