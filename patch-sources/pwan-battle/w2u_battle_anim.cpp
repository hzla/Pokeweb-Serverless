#include "species_ids.h"
#include "nds/fs.h"
#include "pwan_types.h"
#include "string.h"
#include "w2u_pwan_archive.h"

#define W2U_PWAN_MAGIC 0x4E415750u
#define W2U_FRAME_BYTES 0x1200u
#define W2U_MCSS_TEX_BYTES 0x4000u
#define W2U_MCSS_TEX_WIDTH 256u
#define W2U_MCSS_TEX_STRIDE_BYTES (W2U_MCSS_TEX_WIDTH / 2u)
#define W2U_VISIBLE_TEX_WIDTH 96u
#define W2U_VISIBLE_TEX_HEIGHT 96u
#define W2U_VISIBLE_TEX_ROW_BYTES (W2U_VISIBLE_TEX_WIDTH / 2u)
#define W2U_VISIBLE_TEX_ROW_HALFWORDS (W2U_VISIBLE_TEX_ROW_BYTES / 2u)
#define W2U_VISIBLE_TEX_BYTES (W2U_VISIBLE_TEX_ROW_BYTES * W2U_VISIBLE_TEX_HEIGHT)
#define W2U_STAGING_TEX_STRIDE_BYTES W2U_VISIBLE_TEX_ROW_BYTES
#define W2U_STAGING_TEX_BYTES (W2U_STAGING_TEX_STRIDE_BYTES * W2U_VISIBLE_TEX_HEIGHT)
#define W2U_LEGACY_TEX_BYTES_AVOIDED (W2U_MCSS_TEX_BYTES - W2U_VISIBLE_TEX_BYTES)
#define W2U_MCSS_TEX_BASE 0x24000u
#define W2U_MCSS_TEX_SLOT_BYTES 0x4000u
#define W2U_MCSS_TEX_SLOT_COUNT 8u
#define W2U_PWAN_PLTT_BASE 0x1800u
#define W2U_MCSS_PLTT_SLOT_BYTES 0x20u
#define W2U_LCDC_TEX_VRAM ((volatile u16 *)0x06800000)
#define W2U_LCDC_TEX_PLTT ((volatile u16 *)0x06890000)
#define W2U_VRAMCNT_A ((volatile u8 *)0x04000240)
#define W2U_VRAMCNT_B ((volatile u8 *)0x04000241)
#define W2U_VRAMCNT_C ((volatile u8 *)0x04000242)
#define W2U_VRAMCNT_D ((volatile u8 *)0x04000243)
#define W2U_VRAMCNT_E ((volatile u8 *)0x04000244)
#define W2U_VRAMCNT_F ((volatile u8 *)0x04000245)
#define W2U_VRAMCNT_G ((volatile u8 *)0x04000246)
#define W2U_VRAM_LCDC_ENABLE 0x80u
#define W2U_REG_VCOUNT ((volatile u16 *)0x04000006)
#define W2U_MCSS_VCOUNT_LOW 192u
#define W2U_MCSS_VCOUNT_HIGH 200u
#define W2U_BTLV_BEW_PTR ((void **)0x021F4280)
#define W2U_BATTLE_SPRITE_SYSTEM_OFFSET 0x190u
#define W2U_BTLV_POS_AA 0
#define W2U_BTLV_POS_BB 1
#define W2U_BTLV_POS_A 2
#define W2U_BTLV_POS_B 3
#define W2U_BTLV_POS_C 4
#define W2U_BTLV_POS_D 5
#define W2U_BTLV_POS_E 6
#define W2U_BTLV_POS_F 7
#define W2U_BATTLE_PROFILE_MAGIC 0x46525042u
#define W2U_BATTLE_PROFILE_VERSION 19u
#define W2U_BATTLE_ACTOR_ENTRY_BASE 0x08u
#define W2U_BATTLE_ACTOR_ENTRY_BYTES 0x5cu
#define W2U_BATTLE_ACTOR_SPECIES_OFFSET 0x2cu
#define W2U_BATTLE_ACTOR_FORM_OFFSET 0x30u
#define W2U_BATTLE_SPECIES_FORM_MASK 0x7ffu
#define W2U_MINIOR_CORE_FORM_START 7u
#define W2U_MINIOR_FORM_COUNT 14u
#define W2U_MINIOR_SHINY_CORE_ASSET 1196u
#define W2U_MCSS_BASE_PLTT_DATA_OFFSET 0xd4u
#define W2U_MCSS_FADE_PLTT_DATA_OFFSET 0xd8u
#define W2U_MCSS_PLTT_DATA_SIZE_OFFSET 0xdcu
#define W2U_MCSS_PALETTE_PROXY_VRAM_OFFSET 0xc8u
#define W2U_MAIN_RAM_START 0x02000000u
#define W2U_MAIN_RAM_END 0x02400000u

namespace w2u {
namespace battle_anim {

struct PwanHeader {
    u32 magic;
    u16 version;
    u16 width;
    u16 height;
    u16 bpp;
    u16 frameCount;
    u16 timelineCount;
    u32 totalTicks;
    u32 frameBytes;
    u32 paletteColors;
    u32 paletteOffset;
    u32 timelineOffset;
    u32 frameOffset;
};

struct PwanTimelineEntry {
    u16 frame;
    u16 ticks;
};

struct RuntimeTimelineEntry {
    u8 frame;
    u8 ticks;
};

#define W2U_PWAN_MAX_OVERRIDES 768u
#define W2U_PWAN_MAX_ASSET_INDEX 1600u
#define W2U_PWAN_ASSET_COUNT ((W2U_PWAN_MAX_ASSET_INDEX + 1u) * 2u)
#define W2U_PWAN_MAX_TIMELINE 192u

typedef W2U_PwanConfigHeader PwanConfigHeader;
typedef W2U_PwanConfigEntry PwanConfigEntry;

struct BattleActorIdentity {
    s32 rawMonsNo;
    u16 species;
    u16 form;
    b32 shiny;
};

struct McssAddWork {
    u32 arcID;
    u32 ncbr;
    u32 nclr;
    u32 ncer;
    u32 nanr;
    u32 nmcr;
    u32 nmar;
    u32 ncec;
    u32 heapLow;
};

enum ActorId {
    ACTOR_SINGLE_PLAYER_BACK = 0,
    ACTOR_SINGLE_ENEMY_FRONT = 1,
    ACTOR_MULTI_PLAYER_0_BACK = 2,
    ACTOR_MULTI_ENEMY_0_FRONT = 3,
    ACTOR_MULTI_PLAYER_1_BACK = 4,
    ACTOR_MULTI_ENEMY_1_FRONT = 5,
    ACTOR_MULTI_PLAYER_2_BACK = 6,
    ACTOR_MULTI_ENEMY_2_FRONT = 7,
    ACTOR_COUNT = 8,
};

enum BattleAssetId {
    ASSET_NONE = 0xffffu,
};

#define ASSET_COUNT W2U_PWAN_ASSET_COUNT

struct ActorConfig {
    u8 position;
};

struct Asset {
    b32 loaded;
    u32 assetId;
    PwanHeader header;
    RuntimeTimelineEntry timeline[W2U_PWAN_MAX_TIMELINE];
    u16 palette[16];
};

struct ActorState {
    b32 active;
    b32 textureDirty;
    b32 paletteDirty;
    u32 tick;
    u16 copiedFrame;
    u16 pendingFrame;
    s16 mcssIndex;
    u16 species;
    u16 form;
    u16 assetId;
    b32 shiny;
    b32 mcssMawPatched;
    void *mcss;
};

#if !W2U_PWAN_DIAGNOSTICS
#define u32 w2u::pwan_profile::SinkWord
#define s32 w2u::pwan_profile::SinkWord
#endif
struct BattleAnimProfile {
    u32 magic;
    u32 version;
    u32 structSize;
    u32 drawCalls;
    u32 waitCalls;
    u32 waitSpinIterations;
    u32 maxWaitSpinIterations;
    u32 textureUploadCalls;
    u32 textureUploadActors;
    u32 textureBytesUploaded;
    u32 legacyTextureBytesAvoided;
    u32 lastUploadBytes;
    u32 lastUploadActors;
    u32 lastVcountBeforeWait;
    u32 lastVcountAfterWait;
    u32 updateCalls;
    u32 nullBewCount;
    u32 nullBmwCount;
    u32 lastBew;
    u32 lastBmw;
    u32 mcssIndexCalls;
    u32 mcssIndexValid;
    u32 mcssIndexInvalid;
    u32 lastMcssIndexPosition;
    s32 lastMcssIndexResult;
    u32 monsReadCalls;
    u32 entryNullCount;
    u32 monsInvalidCount;
    u32 lastEntry;
    u32 lastEntryMcss;
    s32 lastEntryMons;
    u32 loadFailCount;
    u32 stageFailCount;
    u32 lastLoadFailActor;
    u32 lastLoadFailAsset;
    u32 lastStageFailActor;
    u32 lastStageFailAsset;
    u32 lastStageFailFrame;
    u32 lastActiveMask;
    u32 lastTextureDirtyMask;
    u32 actorPosition[ACTOR_COUNT];
    s32 actorMcssIndex[ACTOR_COUNT];
    u32 actorSpecies[ACTOR_COUNT];
    u32 actorForm[ACTOR_COUNT];
    s32 actorRawMons[ACTOR_COUNT];
    u32 actorAsset[ACTOR_COUNT];
    u32 actorFrame[ACTOR_COUNT];
    u32 paletteUploadCalls;
    u32 paletteCpuCopyCalls;
    u32 paletteCpuCopyFailCount;
    u32 lastPaletteActor;
    u32 lastPaletteAsset;
    u32 lastPaletteMcss;
    u32 lastPaletteBase;
    u32 lastPaletteFade;
    u32 lastPaletteSize;
    u32 lastConfigVersion;
    u32 lastConfigMatchMode;
    u32 lastDecodedSpecies;
    u32 lastDecodedForm;
    u32 carrierPatchCalls;
    u32 carrierPatchMatches;
    u32 lastCarrierPatchPosition;
    u32 lastCarrierPatchOldNcbr;
    u32 lastCarrierPatchNewNcbr;
};
#if !W2U_PWAN_DIAGNOSTICS
#undef s32
#undef u32
#endif

struct State {
    Asset asset[ACTOR_COUNT];
    ActorState actor[ACTOR_COUNT];
    u8 nextUploadActor;
};

#if W2U_PWAN_DIAGNOSTICS
extern "C" {
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
volatile BattleAnimProfile W2U_BattleAnim_Profile = {
    W2U_BATTLE_PROFILE_MAGIC,
    W2U_BATTLE_PROFILE_VERSION,
    sizeof(BattleAnimProfile),
};
#pragma GCC diagnostic pop
}
#else
static BattleAnimProfile W2U_BattleAnim_Profile;
#endif

static const ActorConfig kActorConfig[ACTOR_COUNT] = {
    {W2U_BTLV_POS_AA},
    {W2U_BTLV_POS_BB},
    {W2U_BTLV_POS_A},
    {W2U_BTLV_POS_B},
    {W2U_BTLV_POS_C},
    {W2U_BTLV_POS_D},
    {W2U_BTLV_POS_E},
    {W2U_BTLV_POS_F},
};

static State sState;
static u8 *const sFrameScratch = W2U_PwanFrameScratch;
// Pack CPU staging rows; only the VRAM destination uses the 256-pixel stride.
static u8 sTextureScratch[W2U_STAGING_TEX_BYTES] __attribute__((aligned(4)));
static s32 sNativeFormChangePosition = -1;
static u16 sNativeFormChangeVisualAsset = ASSET_NONE;
static b32 sNativeFormChangeSwapReached = false;

typedef s32 (*McssGetIndexFn)(void *bmw, int position);
typedef void (*McssOverwriteMawFn)(void *bmw, int position, const McssAddWork *maw);

static b32 IsSafeMcssTextureIndex(s32 mcssIndex);

static McssGetIndexFn const BattleSpriteGetIndex_Fn = (McssGetIndexFn)0x021E97D5u;
static McssOverwriteMawFn const BattleSpriteOverwriteMaw_Fn =
    (McssOverwriteMawFn)0x021E7FBDu;
extern "C" void W2U_BattleAnim_Term(void);

extern "C" void W2U_BattleAnim_BeginNativeFormChange(u32 position)
{
    sNativeFormChangePosition = -1;
    sNativeFormChangeVisualAsset = ASSET_NONE;
    sNativeFormChangeSwapReached = false;

    if (position >= ACTOR_COUNT) {
        return;
    }

    // This runs immediately before BTLV_EFFECT_Henge updates the native MCSS
    // identity. Remember the PWAN asset that is currently visible so it remains
    // on the stable, pre-change carrier until the native mosaic reaches its swap
    // point. Actors without a PWAN asset keep the unmodified native path.
    const ActorState *actorState = &sState.actor[position];
    if (!actorState->active || actorState->assetId >= ASSET_COUNT) {
        return;
    }

    sNativeFormChangePosition = (s32)position;
    sNativeFormChangeVisualAsset = actorState->assetId;
}

extern "C" void W2U_BattleAnim_EndNativeFormChange(void)
{
    sNativeFormChangePosition = -1;
    sNativeFormChangeVisualAsset = ASSET_NONE;
    sNativeFormChangeSwapReached = false;
}

static b32 ReadRange(BattleAssetId assetId, u32 offset, void *buffer, u32 size)
{
    if ((u32)assetId >= ASSET_COUNT) return false;
    return w2u::pwan_archive::ReadMemberRange(
        w2u::pwan_archive::MemberIdForAsset((u32)assetId), offset, buffer, size);
}

static b32 ReadConfigRange(u32 offset, void *buffer, u32 size)
{
    return w2u::pwan_archive::ReadMemberRange(W2U_PWAN_CONFIG_MEMBER_ID, offset, buffer, size);
}

static b32 LoadAsset(ActorId actor, BattleAssetId assetId)
{
    if (assetId >= ASSET_COUNT) {
        return false;
    }

    Asset *asset = &sState.asset[actor];
    if (asset->loaded && asset->assetId == (u32)assetId) {
        return true;
    }
    asset->loaded = false;
    asset->assetId = (u32)assetId;

    if (!ReadRange(assetId, 0, &asset->header, sizeof(asset->header))) {
        return false;
    }
    if (asset->header.magic != W2U_PWAN_MAGIC ||
        asset->header.version != 1 ||
        asset->header.width != 96 ||
        asset->header.height != 96 ||
        asset->header.bpp != 4 ||
        asset->header.frameBytes != W2U_FRAME_BYTES ||
        asset->header.paletteColors != 16 ||
        asset->header.timelineCount > W2U_PWAN_MAX_TIMELINE) {
        return false;
    }

    if (!ReadRange(assetId, asset->header.paletteOffset, asset->palette, sizeof(asset->palette))) {
        return false;
    }
    PwanTimelineEntry fileTimeline[W2U_PWAN_MAX_TIMELINE];
    if (!ReadRange(assetId, asset->header.timelineOffset, fileTimeline,
                   asset->header.timelineCount * sizeof(fileTimeline[0]))) {
        return false;
    }
    for (u32 i = 0; i < asset->header.timelineCount; ++i) {
        if (fileTimeline[i].frame > 0xffu || fileTimeline[i].ticks > 0xffu) {
            return false;
        }
        asset->timeline[i].frame = (u8)fileTimeline[i].frame;
        asset->timeline[i].ticks = (u8)fileTimeline[i].ticks;
    }

    asset->loaded = true;
    return true;
}

static b32 IsLikelyMainRamPointer(const void *ptr)
{
    const u32 value = (u32)ptr;
    return value >= W2U_MAIN_RAM_START && value < W2U_MAIN_RAM_END;
}

static void *GetMcssPointerByIndex(void *bmw, s32 mcssIndex)
{
    if (!bmw || !IsSafeMcssTextureIndex(mcssIndex)) {
        return 0;
    }
    u8 *entry = (u8 *)bmw + W2U_BATTLE_ACTOR_ENTRY_BASE +
                ((u32)mcssIndex * W2U_BATTLE_ACTOR_ENTRY_BYTES);
    return *(void **)entry;
}

static void CopyPaletteToLiveMcss(ActorId actor)
{
    const BattleAssetId assetId = (BattleAssetId)sState.actor[actor].assetId;
    if (assetId >= ASSET_COUNT) {
        return;
    }

    Asset *asset = &sState.asset[actor];
    void *mcss = sState.actor[actor].mcss;
    W2U_BattleAnim_Profile.lastPaletteActor = (u32)actor;
    W2U_BattleAnim_Profile.lastPaletteAsset = (u32)assetId;
    W2U_BattleAnim_Profile.lastPaletteMcss = (u32)mcss;

    if (!IsLikelyMainRamPointer(mcss)) {
        W2U_BattleAnim_Profile.paletteCpuCopyFailCount =
            W2U_BattleAnim_Profile.paletteCpuCopyFailCount + 1u;
        return;
    }

    u16 *base = *(u16 **)((u8 *)mcss + W2U_MCSS_BASE_PLTT_DATA_OFFSET);
    u16 *fade = *(u16 **)((u8 *)mcss + W2U_MCSS_FADE_PLTT_DATA_OFFSET);
    const u32 size = *(u32 *)((u8 *)mcss + W2U_MCSS_PLTT_DATA_SIZE_OFFSET);
    W2U_BattleAnim_Profile.lastPaletteBase = (u32)base;
    W2U_BattleAnim_Profile.lastPaletteFade = (u32)fade;
    W2U_BattleAnim_Profile.lastPaletteSize = size;

    if (!IsLikelyMainRamPointer(base) || !IsLikelyMainRamPointer(fade) ||
        size < W2U_MCSS_PLTT_SLOT_BYTES || size > 0x200u) {
        W2U_BattleAnim_Profile.paletteCpuCopyFailCount =
            W2U_BattleAnim_Profile.paletteCpuCopyFailCount + 1u;
        return;
    }

    for (u32 i = 0; i < 16; ++i) {
        base[i] = asset->palette[i];
        fade[i] = asset->palette[i];
    }
    W2U_BattleAnim_Profile.paletteCpuCopyCalls =
        W2U_BattleAnim_Profile.paletteCpuCopyCalls + 1u;
}

static u32 GetPwanPaletteBase(s32 mcssIndex)
{
    if (!IsSafeMcssTextureIndex(mcssIndex)) {
        return W2U_PWAN_PLTT_BASE;
    }
    return W2U_PWAN_PLTT_BASE + W2U_MCSS_PLTT_SLOT_BYTES * (u32)mcssIndex;
}

static void SetMcssPaletteBase(void *mcss, u32 paletteBase)
{
    if (IsLikelyMainRamPointer(mcss)) {
        *(u32 *)((u8 *)mcss + W2U_MCSS_PALETTE_PROXY_VRAM_OFFSET) = paletteBase;
    }
}

static b32 LiveMcssPaletteMatches(ActorId actor)
{
    const BattleAssetId assetId = (BattleAssetId)sState.actor[actor].assetId;
    if (assetId >= ASSET_COUNT) {
        return true;
    }

    Asset *asset = &sState.asset[actor];
    void *mcss = sState.actor[actor].mcss;
    if (!IsLikelyMainRamPointer(mcss)) {
        return true;
    }

    u16 *base = *(u16 **)((u8 *)mcss + W2U_MCSS_BASE_PLTT_DATA_OFFSET);
    u16 *fade = *(u16 **)((u8 *)mcss + W2U_MCSS_FADE_PLTT_DATA_OFFSET);
    const u32 size = *(u32 *)((u8 *)mcss + W2U_MCSS_PLTT_DATA_SIZE_OFFSET);
    if (!IsLikelyMainRamPointer(base) || !IsLikelyMainRamPointer(fade) ||
        size < W2U_MCSS_PLTT_SLOT_BYTES || size > 0x200u) {
        return true;
    }

    for (u32 i = 0; i < 16; ++i) {
        if (base[i] != asset->palette[i] || fade[i] != asset->palette[i]) {
            return false;
        }
    }
    return true;
}

static void SetTextureBanksLcdc(u8 *a, u8 *b, u8 *c, u8 *d)
{
    *a = *W2U_VRAMCNT_A;
    *b = *W2U_VRAMCNT_B;
    *c = *W2U_VRAMCNT_C;
    *d = *W2U_VRAMCNT_D;

    *W2U_VRAMCNT_A = W2U_VRAM_LCDC_ENABLE;
    *W2U_VRAMCNT_B = W2U_VRAM_LCDC_ENABLE;
    *W2U_VRAMCNT_C = W2U_VRAM_LCDC_ENABLE;
    *W2U_VRAMCNT_D = W2U_VRAM_LCDC_ENABLE;
}

static void RestoreTextureBanks(u8 a, u8 b, u8 c, u8 d)
{
    *W2U_VRAMCNT_A = a;
    *W2U_VRAMCNT_B = b;
    *W2U_VRAMCNT_C = c;
    *W2U_VRAMCNT_D = d;
}

static void SetTexturePaletteBanksLcdc(u8 *e, u8 *f, u8 *g)
{
    *e = *W2U_VRAMCNT_E;
    *f = *W2U_VRAMCNT_F;
    *g = *W2U_VRAMCNT_G;

    *W2U_VRAMCNT_E = W2U_VRAM_LCDC_ENABLE;
    *W2U_VRAMCNT_F = W2U_VRAM_LCDC_ENABLE;
    *W2U_VRAMCNT_G = W2U_VRAM_LCDC_ENABLE;
}

static void RestoreTexturePaletteBanks(u8 e, u8 f, u8 g)
{
    *W2U_VRAMCNT_E = e;
    *W2U_VRAMCNT_F = f;
    *W2U_VRAMCNT_G = g;
}

static b32 IsSafeVramUploadTime()
{
    const u16 vcount = *W2U_REG_VCOUNT;
    return vcount >= W2U_MCSS_VCOUNT_LOW && vcount <= W2U_MCSS_VCOUNT_HIGH;
}

static void WaitForSafeVramUploadTime()
{
    u32 spins = 0;
    W2U_BattleAnim_Profile.waitCalls = W2U_BattleAnim_Profile.waitCalls + 1u;
    W2U_BattleAnim_Profile.lastVcountBeforeWait = *W2U_REG_VCOUNT;
    while (!IsSafeVramUploadTime()) {
        spins++;
    }
    W2U_BattleAnim_Profile.waitSpinIterations += spins;
    if (spins > W2U_BattleAnim_Profile.maxWaitSpinIterations) {
        W2U_BattleAnim_Profile.maxWaitSpinIterations = spins;
    }
    W2U_BattleAnim_Profile.lastVcountAfterWait = *W2U_REG_VCOUNT;
}

static void UploadPalette(ActorId actor, u32 paletteBase)
{
    const BattleAssetId assetId = (BattleAssetId)sState.actor[actor].assetId;
    if (assetId >= ASSET_COUNT) {
        return;
    }

    Asset *asset = &sState.asset[actor];
    u8 e, f, g;
    SetTexturePaletteBanksLcdc(&e, &f, &g);

    volatile u16 *dst = W2U_LCDC_TEX_PLTT +
                        (paletteBase >> 1);
    for (u32 i = 0; i < 16; ++i) {
        dst[i] = asset->palette[i];
    }

    RestoreTexturePaletteBanks(e, f, g);
    W2U_BattleAnim_Profile.paletteUploadCalls =
        W2U_BattleAnim_Profile.paletteUploadCalls + 1u;
    sState.actor[actor].paletteDirty = false;
}

static u16 FrameForTick(const Asset *asset, u32 tick)
{
    u32 at = 0;
    for (u32 i = 0; i < asset->header.timelineCount; ++i) {
        at += asset->timeline[i].ticks;
        if (tick < at) {
            return asset->timeline[i].frame;
        }
    }
    return asset->timeline[asset->header.timelineCount - 1].frame;
}

static void BlitTileSegmentToTexture(u8 *dst, const u8 *src, u32 dstX, u32 dstY, u32 tilesW, u32 tilesH)
{
    for (u32 tileY = 0; tileY < tilesH; ++tileY) {
        for (u32 tileX = 0; tileX < tilesW; ++tileX) {
            const u8 *tile = src + ((tileY * tilesW + tileX) * 32u);
            for (u32 y = 0; y < 8; ++y) {
                u8 *row = dst + (dstY + tileY * 8u + y) * W2U_STAGING_TEX_STRIDE_BYTES +
                          (dstX + tileX * 8u) / 2u;
                const u8 *srcRow = tile + y * 4u;
                row[0] = srcRow[0];
                row[1] = srcRow[1];
                row[2] = srcRow[2];
                row[3] = srcRow[3];
            }
        }
    }
}

static void ConvertFrameToTexture(void)
{
    u8 *texture = sTextureScratch;
    const u8 *frame = sFrameScratch;
    BlitTileSegmentToTexture(texture, frame + 0x0000u, 0, 0, 8, 8);
    BlitTileSegmentToTexture(texture, frame + 0x0800u, 64, 0, 4, 8);
    BlitTileSegmentToTexture(texture, frame + 0x0c00u, 0, 64, 8, 4);
    BlitTileSegmentToTexture(texture, frame + 0x1000u, 64, 64, 4, 4);
}

static void UploadTexture(ActorId actor, s32 mcssIndex)
{
    u8 a, b, c, d;
    SetTextureBanksLcdc(&a, &b, &c, &d);

    volatile u16 *dst = W2U_LCDC_TEX_VRAM +
                        ((W2U_MCSS_TEX_BASE + W2U_MCSS_TEX_SLOT_BYTES * (u32)mcssIndex) / 2u);
    for (u32 y = 0; y < W2U_VISIBLE_TEX_HEIGHT; ++y) {
        volatile u16 *dstRow = dst + ((y * W2U_MCSS_TEX_STRIDE_BYTES) / 2u);
        const u16 *srcRow = (const u16 *)(sTextureScratch + y * W2U_STAGING_TEX_STRIDE_BYTES);
        for (u32 x = 0; x < W2U_VISIBLE_TEX_ROW_HALFWORDS; ++x) {
            dstRow[x] = srcRow[x];
        }
    }

    RestoreTextureBanks(a, b, c, d);
    W2U_BattleAnim_Profile.textureUploadActors = W2U_BattleAnim_Profile.textureUploadActors + 1u;
    W2U_BattleAnim_Profile.textureBytesUploaded += W2U_VISIBLE_TEX_BYTES;
    W2U_BattleAnim_Profile.legacyTextureBytesAvoided += W2U_LEGACY_TEX_BYTES_AVOIDED;
    W2U_BattleAnim_Profile.lastUploadActors = W2U_BattleAnim_Profile.lastUploadActors + 1u;
    W2U_BattleAnim_Profile.lastUploadBytes += W2U_VISIBLE_TEX_BYTES;
    sState.actor[actor].textureDirty = false;
}

static b32 StageFrameTexture(ActorId actor, u16 frame)
{
    const BattleAssetId assetId = (BattleAssetId)sState.actor[actor].assetId;
    if (assetId >= ASSET_COUNT) {
        W2U_BattleAnim_Profile.stageFailCount = W2U_BattleAnim_Profile.stageFailCount + 1u;
        W2U_BattleAnim_Profile.lastStageFailActor = (u32)actor;
        W2U_BattleAnim_Profile.lastStageFailAsset = (u32)assetId;
        W2U_BattleAnim_Profile.lastStageFailFrame = frame;
        return false;
    }

    Asset *asset = &sState.asset[actor];
    const u32 offset = asset->header.frameOffset + (frame * asset->header.frameBytes);
    if (!ReadRange(assetId, offset, sFrameScratch, W2U_FRAME_BYTES)) {
        W2U_BattleAnim_Profile.stageFailCount = W2U_BattleAnim_Profile.stageFailCount + 1u;
        W2U_BattleAnim_Profile.lastStageFailActor = (u32)actor;
        W2U_BattleAnim_Profile.lastStageFailAsset = (u32)assetId;
        W2U_BattleAnim_Profile.lastStageFailFrame = frame;
        return false;
    }

    ConvertFrameToTexture();
    return true;
}

static void *GetMcssWork()
{
    void *bew = *W2U_BTLV_BEW_PTR;
    W2U_BattleAnim_Profile.lastBew = (u32)bew;
    if (!bew) {
        W2U_BattleAnim_Profile.nullBewCount = W2U_BattleAnim_Profile.nullBewCount + 1u;
        W2U_BattleAnim_Profile.lastBmw = 0;
        return 0;
    }
    void *bmw = *(void **)((u8 *)bew + W2U_BATTLE_SPRITE_SYSTEM_OFFSET);
    W2U_BattleAnim_Profile.lastBmw = (u32)bmw;
    if (!bmw) {
        W2U_BattleAnim_Profile.nullBmwCount = W2U_BattleAnim_Profile.nullBmwCount + 1u;
    }
    return bmw;
}

static s32 GetMcssIndex(void *bmw, int position)
{
    W2U_BattleAnim_Profile.mcssIndexCalls = W2U_BattleAnim_Profile.mcssIndexCalls + 1u;
    W2U_BattleAnim_Profile.lastMcssIndexPosition = (u32)position;
    if (!bmw) {
        W2U_BattleAnim_Profile.mcssIndexInvalid = W2U_BattleAnim_Profile.mcssIndexInvalid + 1u;
        W2U_BattleAnim_Profile.lastMcssIndexResult = -1;
        return -1;
    }
    const s32 index = BattleSpriteGetIndex_Fn(bmw, position);
    W2U_BattleAnim_Profile.lastMcssIndexResult = index;
    if (index >= 0 && (u32)index < W2U_MCSS_TEX_SLOT_COUNT) {
        W2U_BattleAnim_Profile.mcssIndexValid = W2U_BattleAnim_Profile.mcssIndexValid + 1u;
    } else {
        W2U_BattleAnim_Profile.mcssIndexInvalid = W2U_BattleAnim_Profile.mcssIndexInvalid + 1u;
    }
    return index;
}

static s32 GetMcssMonsNo(void *bmw, int position)
{
    W2U_BattleAnim_Profile.monsReadCalls = W2U_BattleAnim_Profile.monsReadCalls + 1u;
    if (!bmw) {
        W2U_BattleAnim_Profile.monsInvalidCount = W2U_BattleAnim_Profile.monsInvalidCount + 1u;
        return SPECIES_NONE;
    }

    const s32 index = GetMcssIndex(bmw, position);
    if (index < 0) {
        W2U_BattleAnim_Profile.monsInvalidCount = W2U_BattleAnim_Profile.monsInvalidCount + 1u;
        return SPECIES_NONE;
    }

    u8 *entry = (u8 *)bmw + W2U_BATTLE_ACTOR_ENTRY_BASE +
                ((u32)index * W2U_BATTLE_ACTOR_ENTRY_BYTES);
    W2U_BattleAnim_Profile.lastEntry = (u32)entry;
    W2U_BattleAnim_Profile.lastEntryMcss = (u32)(*(void **)entry);
    if (*(void **)entry == 0) {
        W2U_BattleAnim_Profile.entryNullCount = W2U_BattleAnim_Profile.entryNullCount + 1u;
        W2U_BattleAnim_Profile.monsInvalidCount = W2U_BattleAnim_Profile.monsInvalidCount + 1u;
        return SPECIES_NONE;
    }

    const s32 monsNo = *(s32 *)(entry + W2U_BATTLE_ACTOR_SPECIES_OFFSET);
    W2U_BattleAnim_Profile.lastEntryMons = monsNo;
    if (monsNo <= SPECIES_NONE) {
        W2U_BattleAnim_Profile.monsInvalidCount = W2U_BattleAnim_Profile.monsInvalidCount + 1u;
    }
    return monsNo;
}

static BattleActorIdentity DecodeBattleActorIdentity(s32 rawMonsNo)
{
    BattleActorIdentity identity;
    identity.rawMonsNo = rawMonsNo;
    identity.species = SPECIES_NONE;
    identity.form = 0;
    identity.shiny = false;

    if (rawMonsNo <= SPECIES_NONE) {
        return identity;
    }

    const u32 raw = (u32)rawMonsNo;
    identity.species = (u16)(raw & W2U_BATTLE_SPECIES_FORM_MASK);
    identity.form = (u16)(raw >> 11);
    if (identity.form == 0) {
        identity.species = (u16)raw;
    }

    W2U_BattleAnim_Profile.lastDecodedSpecies = identity.species;
    W2U_BattleAnim_Profile.lastDecodedForm = identity.form;
    return identity;
}

static s32 GetMcssFormNo(void *bmw, int position)
{
    if (!bmw) {
        return 0;
    }

    const s32 index = GetMcssIndex(bmw, position);
    if (index < 0) {
        return 0;
    }

    u8 *entry = (u8 *)bmw + W2U_BATTLE_ACTOR_ENTRY_BASE +
                ((u32)index * W2U_BATTLE_ACTOR_ENTRY_BYTES);
    if (*(void **)entry == 0) {
        return 0;
    }

    return *(s32 *)(entry + W2U_BATTLE_ACTOR_FORM_OFFSET);
}

static b32 GetMcssIsShiny(void *bmw, int position)
{
    if (!bmw) {
        return false;
    }

    const s32 index = GetMcssIndex(bmw, position);
    if (index < 0) {
        return false;
    }

    u8 *entry = (u8 *)bmw + W2U_BATTLE_ACTOR_ENTRY_BASE +
                ((u32)index * W2U_BATTLE_ACTOR_ENTRY_BYTES);
    if (*(void **)entry == 0) {
        return false;
    }

    // Every native battle sprite occupies a 20-member block. Its normal and
    // shiny palettes are members 18 and 19 respectively. PWAN carrier patches
    // retain that choice so it remains observable after a form change.
    return (*(u32 *)(entry + 12u) & 1u) != 0u;
}

static McssAddWork MakeSpriteMaw(u32 spriteIndex, int position, b32 shiny)
{
    McssAddWork maw;
    const u32 base = spriteIndex * 20u;
    const b32 front = (position & 1) != 0;
    maw.arcID = 4u;
    maw.ncbr = base + (front ? 2u : 11u);
    maw.nclr = base + 18u + (shiny ? 1u : 0u);
    maw.ncer = base + (front ? 4u : 13u);
    maw.nanr = base + (front ? 5u : 14u);
    maw.nmcr = base + (front ? 6u : 15u);
    maw.nmar = base + (front ? 7u : 16u);
    maw.ncec = base + (front ? 8u : 17u);
    maw.heapLow = 0;
    return maw;
}

static b32 PatchMcssCarrierFromSpriteIndex(void *bmw, int position, ActorState *actorState,
                                           u32 spriteIndex)
{
    W2U_BattleAnim_Profile.carrierPatchCalls =
        W2U_BattleAnim_Profile.carrierPatchCalls + 1u;

    if (!bmw || !actorState || spriteIndex > W2U_PWAN_MAX_ASSET_INDEX) {
        return false;
    }

    const s32 index = GetMcssIndex(bmw, position);
    if (!IsSafeMcssTextureIndex(index)) {
        return false;
    }

    u8 *entry = (u8 *)bmw + W2U_BATTLE_ACTOR_ENTRY_BASE +
                ((u32)index * W2U_BATTLE_ACTOR_ENTRY_BYTES);
    if (*(void **)entry == 0) {
        return false;
    }

    const McssAddWork maw = MakeSpriteMaw(spriteIndex, position, actorState->shiny);
    const u32 oldNcbr = *(u32 *)(entry + 8u);
    const u32 oldNclr = *(u32 *)(entry + 12u);
    const u32 oldNcec = *(u32 *)(entry + 32u);
    if (oldNcbr == maw.ncbr && oldNclr == maw.nclr && oldNcec == maw.ncec) {
        if (!actorState->mcssMawPatched) {
            actorState->textureDirty = true;
            actorState->paletteDirty = true;
            actorState->copiedFrame = 0xffffu;
            actorState->pendingFrame = 0xffffu;
        }
        actorState->mcssMawPatched = true;
        return actorState->textureDirty || actorState->paletteDirty;
    }

    BattleSpriteOverwriteMaw_Fn(bmw, position, &maw);

    actorState->mcssMawPatched = true;
    actorState->textureDirty = true;
    actorState->paletteDirty = true;
    actorState->copiedFrame = 0xffffu;
    actorState->pendingFrame = 0xffffu;
    W2U_BattleAnim_Profile.carrierPatchMatches =
        W2U_BattleAnim_Profile.carrierPatchMatches + 1u;
    W2U_BattleAnim_Profile.lastCarrierPatchPosition = (u32)position;
    W2U_BattleAnim_Profile.lastCarrierPatchOldNcbr = oldNcbr;
    W2U_BattleAnim_Profile.lastCarrierPatchNewNcbr = maw.ncbr;
    return true;
}

static b32 PatchFormFromPwanConfig(void *bmw, int position, ActorState *actorState)
{
    if (!actorState ||
        actorState->form == 0 ||
        actorState->assetId == (u16)ASSET_NONE ||
        (u32)actorState->assetId >= ASSET_COUNT) {
        return false;
    }

    // Mimikyu's busted battle carrier deliberately inherits the base form's
    // geometry and animation metadata. Reusing the live base carrier avoids
    // scheduling the native static busted texture, which otherwise arrives
    // several frames after PWAN and overwrites its frame-0 texture in VRAM.
    if (actorState->species == SPECIES_778 && actorState->form == 1u) {
        if (!actorState->mcssMawPatched) {
            actorState->textureDirty = true;
            actorState->paletteDirty = true;
            actorState->copiedFrame = 0xffffu;
            actorState->pendingFrame = 0xffffu;
        }
        actorState->mcssMawPatched = true;
        return actorState->textureDirty || actorState->paletteDirty;
    }

    const u32 spriteIndex = ((u32)actorState->assetId) / 2u;
    return PatchMcssCarrierFromSpriteIndex(bmw, position, actorState, spriteIndex);
}

static BattleActorIdentity GetMcssActorIdentity(void *bmw, int position)
{
    BattleActorIdentity identity = DecodeBattleActorIdentity(GetMcssMonsNo(bmw, position));
    if (identity.species != SPECIES_NONE) {
        identity.shiny = GetMcssIsShiny(bmw, position);
        const s32 formNo = GetMcssFormNo(bmw, position);
        if (formNo >= 0 && formNo <= 31) {
            identity.form = (u16)formNo;
            W2U_BattleAnim_Profile.lastDecodedForm = identity.form;
        }
    }
    return identity;
}

static BattleAssetId AssetForEntrySide(const PwanConfigEntry *entry, b32 isFront)
{
    if (isFront) {
        if ((entry->flags & W2U_PWAN_CONFIG_FRONT_FLAG) == 0 ||
            entry->assetIndex > W2U_PWAN_MAX_ASSET_INDEX) return ASSET_NONE;
        return (BattleAssetId)(entry->assetIndex * 2u);
    }

    if ((entry->flags & W2U_PWAN_CONFIG_BACK_FLAG) == 0 ||
        entry->assetIndex > W2U_PWAN_MAX_ASSET_INDEX) return ASSET_NONE;
    return (BattleAssetId)(entry->assetIndex * 2u + 1u);
}

static BattleAssetId GetAssetForSpeciesSide(const BattleActorIdentity *identity, b32 isFront)
{
    if (identity->species == SPECIES_774 &&
        identity->form >= W2U_MINIOR_CORE_FORM_START &&
        identity->form < W2U_MINIOR_FORM_COUNT &&
        identity->shiny) {
        return (BattleAssetId)(W2U_MINIOR_SHINY_CORE_ASSET * 2u +
                               (isFront ? 0u : 1u));
    }

    PwanConfigHeader header = {};
    if (!ReadConfigRange(0, &header, sizeof(header)) ||
        header.magic != W2U_PWAN_CONFIG_MAGIC ||
        header.version != W2U_PWAN_CONFIG_VERSION ||
        header.count > W2U_PWAN_MAX_OVERRIDES ||
        header.maxTimeline > W2U_PWAN_MAX_TIMELINE ||
        header.entriesOffset < sizeof(PwanConfigHeader)) {
        W2U_BattleAnim_Profile.lastConfigVersion = header.version;
        return ASSET_NONE;
    }
    W2U_BattleAnim_Profile.lastConfigVersion = header.version;

    for (u32 i = 0; i < header.count; ++i) {
        u8 raw[W2U_PWAN_CONFIG_ENTRY_BYTES];
        const u32 offset = W2U_PwanConfigEntryOffset(&header, i);
        if (!ReadConfigRange(offset, raw, W2U_PWAN_CONFIG_ENTRY_BYTES)) return ASSET_NONE;
        PwanConfigEntry entry = W2U_DecodePwanConfigEntry(raw);
        if (entry.species == identity->species && entry.form == identity->form) {
            W2U_BattleAnim_Profile.lastConfigMatchMode = 2u;
            return AssetForEntrySide(&entry, isFront);
        }
    }
    W2U_BattleAnim_Profile.lastConfigMatchMode = 0;
    return ASSET_NONE;
}

static BattleAssetId GetAssetForPositionSpecies(int position, const BattleActorIdentity *identity)
{
    if ((position & 1) == 0) {
        return GetAssetForSpeciesSide(identity, false);
    }

    return GetAssetForSpeciesSide(identity, true);
}

static b32 IsSafeMcssTextureIndex(s32 mcssIndex)
{
    return mcssIndex >= 0 && (u32)mcssIndex < W2U_MCSS_TEX_SLOT_COUNT;
}

static void RecordActorProfile(ActorId actor, u32 position, s32 mcssIndex,
                               const BattleActorIdentity *identity,
                               BattleAssetId assetId, b32 active, b32 textureDirty, u16 frame)
{
    W2U_BattleAnim_Profile.actorPosition[actor] = position;
    W2U_BattleAnim_Profile.actorMcssIndex[actor] = mcssIndex;
    W2U_BattleAnim_Profile.actorSpecies[actor] = identity->species;
    W2U_BattleAnim_Profile.actorForm[actor] = identity->form;
    W2U_BattleAnim_Profile.actorRawMons[actor] = identity->rawMonsNo;
    W2U_BattleAnim_Profile.actorAsset[actor] = (u32)assetId;
    W2U_BattleAnim_Profile.actorFrame[actor] = frame;
    if (active) {
        W2U_BattleAnim_Profile.lastActiveMask |= (1u << (u32)actor);
    }
    if (textureDirty) {
        W2U_BattleAnim_Profile.lastTextureDirtyMask |= (1u << (u32)actor);
    }
}

static void DeactivateActor(ActorId actor)
{
    sState.actor[actor].active = false;
    sState.actor[actor].textureDirty = false;
    sState.actor[actor].paletteDirty = false;
    sState.actor[actor].copiedFrame = 0xffffu;
    sState.actor[actor].pendingFrame = 0xffffu;
    sState.actor[actor].mcssIndex = -1;
    sState.actor[actor].species = SPECIES_NONE;
    sState.actor[actor].form = 0;
    sState.actor[actor].shiny = false;
    sState.actor[actor].assetId = ASSET_NONE;
    sState.actor[actor].mcssMawPatched = false;
    sState.actor[actor].mcss = 0;
}

static void UpdateActor(ActorId actor, void *bmw)
{
    const ActorConfig *cfg = &kActorConfig[actor];
    ActorState *actorState = &sState.actor[actor];

    const s32 mcssIndex = GetMcssIndex(bmw, cfg->position);
    if (!IsSafeMcssTextureIndex(mcssIndex)) {
        BattleActorIdentity none;
        none.rawMonsNo = SPECIES_NONE;
        none.species = SPECIES_NONE;
        none.form = 0;
        none.shiny = false;
        RecordActorProfile(actor, cfg->position, mcssIndex, &none, ASSET_NONE, false, false, 0xffffu);
        DeactivateActor(actor);
        return;
    }
    const BattleActorIdentity identity = GetMcssActorIdentity(bmw, cfg->position);
    BattleAssetId assetId = GetAssetForPositionSpecies(cfg->position, &identity);
    if (sNativeFormChangePosition == (s32)cfg->position &&
        !sNativeFormChangeSwapReached &&
        sNativeFormChangeVisualAsset < ASSET_COUNT) {
        assetId = (BattleAssetId)sNativeFormChangeVisualAsset;
    }
    if (assetId >= ASSET_COUNT || !LoadAsset(actor, assetId)) {
        W2U_BattleAnim_Profile.loadFailCount = W2U_BattleAnim_Profile.loadFailCount + 1u;
        W2U_BattleAnim_Profile.lastLoadFailActor = (u32)actor;
        W2U_BattleAnim_Profile.lastLoadFailAsset = (u32)assetId;
        RecordActorProfile(actor, cfg->position, mcssIndex, &identity, assetId, false, false, 0xffffu);
        DeactivateActor(actor);
        return;
    }

    const b32 wasInactive = !actorState->active;
    void *oldMcss = actorState->mcss;
    void *currentMcss = GetMcssPointerByIndex(bmw, mcssIndex);
    const b32 mcssIndexChanged = actorState->mcssIndex != (s16)mcssIndex;
    const b32 mcssPointerChanged = oldMcss != currentMcss;
    const b32 speciesChanged = actorState->species != identity.species ||
                               actorState->form != identity.form ||
                               actorState->shiny != identity.shiny ||
                               actorState->assetId != assetId;
    if (speciesChanged) {
        actorState->tick = 0;
        actorState->copiedFrame = 0xffffu;
        actorState->pendingFrame = 0xffffu;
        actorState->mcssMawPatched = false;
    } else if (mcssIndexChanged || mcssPointerChanged) {
        actorState->copiedFrame = 0xffffu;
        actorState->pendingFrame = 0xffffu;
        actorState->mcssMawPatched = false;
    }

    actorState->active = true;
    actorState->mcssIndex = (s16)mcssIndex;
    actorState->species = identity.species;
    actorState->form = identity.form;
    actorState->shiny = identity.shiny;
    actorState->assetId = (u16)assetId;
    actorState->mcss = currentMcss;
    if (wasInactive || mcssIndexChanged || mcssPointerChanged || speciesChanged) {
        actorState->paletteDirty = true;
    }
    // The native change-form effect snapshots the old MAW and restores it partway
    // through the animation with BattleSpriteOverwriteMaw. Calling that same
    // routine here on the intervening frames makes the renderer alternate between
    // the effect snapshot and the new carrier, which appears as a positional
    // flicker. PWAN texture/palette uploads are safe during the effect; defer only
    // the carrier replacement until the native task has released this position.
    const b32 nativeFormChangeOwnsCarrier =
        sNativeFormChangePosition == (s32)cfg->position;
    const b32 carrierPatched = nativeFormChangeOwnsCarrier ?
        false : PatchFormFromPwanConfig(bmw, cfg->position, actorState);
    if (carrierPatched) {
        actorState->mcss = GetMcssPointerByIndex(bmw, mcssIndex);
    }
    SetMcssPaletteBase(actorState->mcss, GetPwanPaletteBase(mcssIndex));
    if (!LiveMcssPaletteMatches(actor)) {
        actorState->paletteDirty = true;
        actorState->copiedFrame = 0xffffu;
    }
    if (actorState->paletteDirty) {
        CopyPaletteToLiveMcss(actor);
    }

    Asset *asset = &sState.asset[actor];
    const u32 totalTicks = asset->header.totalTicks ? asset->header.totalTicks : 1;
    if (actorState->tick >= totalTicks) {
        actorState->tick = 0;
    }
    const u16 frame = FrameForTick(asset, actorState->tick);
    if (wasInactive || mcssIndexChanged || speciesChanged || frame != actorState->copiedFrame) {
        actorState->pendingFrame = frame;
        actorState->textureDirty = true;
    }
    RecordActorProfile(actor, cfg->position, mcssIndex, &identity, assetId, true,
                       actorState->textureDirty, frame);
    actorState->tick = actorState->tick + 1u;
    if (actorState->tick >= totalTicks) {
        actorState->tick = 0;
    }
}

extern "C" void W2U_BattleAnim_Update(void)
{
    W2U_BattleAnim_Profile.updateCalls = W2U_BattleAnim_Profile.updateCalls + 1u;
    W2U_BattleAnim_Profile.lastActiveMask = 0;
    W2U_BattleAnim_Profile.lastTextureDirtyMask = 0;
    void *bmw = GetMcssWork();
    if (!bmw) {
        W2U_BattleAnim_Term();
        return;
    }

    for (u32 i = 0; i < ACTOR_COUNT; ++i) {
        UpdateActor((ActorId)i, bmw);
    }
}

static b32 UploadPendingActor(ActorId actor)
{
    ActorState *actorState = &sState.actor[actor];
    if (!actorState->active ||
        actorState->mcssIndex < 0 ||
        (!actorState->textureDirty && !actorState->paletteDirty)) {
        return false;
    }

    b32 stagedTexture = true;
    if (actorState->textureDirty) {
        stagedTexture = StageFrameTexture(actor, actorState->pendingFrame);
    }
    if (stagedTexture) {
        WaitForSafeVramUploadTime();
        if (actorState->paletteDirty) {
            CopyPaletteToLiveMcss(actor);
            UploadPalette(actor, GetPwanPaletteBase(actorState->mcssIndex));
        }
        if (actorState->textureDirty) {
            UploadTexture(actor, actorState->mcssIndex);
            actorState->copiedFrame = actorState->pendingFrame;
        }
    } else {
        actorState->textureDirty = false;
        actorState->paletteDirty = false;
    }
    return true;
}

extern "C" b32 W2U_BattleAnim_ShouldSuppressNativeFormCarrier(
    void *bmw,
    u32 position)
{
    if (!bmw || position >= ACTOR_COUNT) {
        return false;
    }

    const BattleActorIdentity identity = GetMcssActorIdentity(bmw, (int)position);
    return identity.species == SPECIES_778 && identity.form == 1u;
}

extern "C" b32 W2U_BattleAnim_OnNativeFormChangeSwap(
    void *bmw,
    u32 position)
{
    if (!bmw || position >= ACTOR_COUNT ||
        sNativeFormChangePosition != (s32)position ||
        sNativeFormChangeVisualAsset >= ASSET_COUNT) {
        return false;
    }

    const BattleActorIdentity identity = GetMcssActorIdentity(bmw, (int)position);
    const BattleAssetId targetAsset = GetAssetForPositionSpecies((int)position, &identity);
    if (targetAsset >= ASSET_COUNT ||
        !LoadAsset((ActorId)position, targetAsset)) {
        // The destination has no usable PWAN asset, so release ownership and let
        // BTLV_MCSS_OverwriteMAW perform the normal native form swap.
        sNativeFormChangePosition = -1;
        sNativeFormChangeVisualAsset = ASSET_NONE;
        sNativeFormChangeSwapReached = false;
        return false;
    }

    // Do not replace the MAW while its mosaic transform is active: changing the
    // carrier's cell/anchor at this point is what makes the blurry pixels jump.
    // The hook uploads the destination PWAN pixels to the existing carrier now;
    // the final carrier is installed only after the effect has fully completed.
    sNativeFormChangeSwapReached = true;
    return true;
}

extern "C" void W2U_BattleAnim_RefreshPositionNow(u32 position)
{
    ActorId actor = ACTOR_COUNT;
    for (u32 i = 0; i < ACTOR_COUNT; ++i) {
        if ((u32)kActorConfig[i].position == position) {
            actor = (ActorId)i;
            break;
        }
    }
    if (actor == ACTOR_COUNT) {
        return;
    }

    void *bmw = GetMcssWork();
    if (!bmw) {
        return;
    }

    ActorState *actorState = &sState.actor[actor];
    actorState->mcssMawPatched = false;
    actorState->textureDirty = true;
    actorState->paletteDirty = true;
    actorState->copiedFrame = 0xffffu;
    actorState->pendingFrame = 0xffffu;

    UpdateActor(actor, bmw);
    if (!actorState->active ||
        (!actorState->textureDirty && !actorState->paletteDirty)) {
        return;
    }

    W2U_BattleAnim_Profile.lastUploadBytes = 0;
    W2U_BattleAnim_Profile.lastUploadActors = 0;
    W2U_BattleAnim_Profile.textureUploadCalls =
        W2U_BattleAnim_Profile.textureUploadCalls + 1u;
    UploadPendingActor(actor);
}

extern "C" void W2U_BattleAnim_Draw(void)
{
    W2U_BattleAnim_Profile.drawCalls = W2U_BattleAnim_Profile.drawCalls + 1u;

    b32 needsUpload = false;
    for (u32 i = 0; i < ACTOR_COUNT; ++i) {
        if (!sState.actor[i].active) {
            continue;
        }
        SetMcssPaletteBase(sState.actor[i].mcss,
                           GetPwanPaletteBase(sState.actor[i].mcssIndex));
        if (sState.actor[i].textureDirty || sState.actor[i].paletteDirty) {
            needsUpload = true;
        }
    }
    if (!needsUpload) {
        return;
    }

    W2U_BattleAnim_Profile.lastUploadBytes = 0;
    W2U_BattleAnim_Profile.lastUploadActors = 0;
    W2U_BattleAnim_Profile.textureUploadCalls = W2U_BattleAnim_Profile.textureUploadCalls + 1u;

    for (u32 attempt = 0; attempt < ACTOR_COUNT; ++attempt) {
        u32 actorIndex = sState.nextUploadActor + attempt;
        while (actorIndex >= ACTOR_COUNT) {
            actorIndex -= ACTOR_COUNT;
        }
        const ActorId actor = (ActorId)actorIndex;
        ActorState *actorState = &sState.actor[actor];
        if (!actorState->active ||
            actorState->mcssIndex < 0 ||
            (!actorState->textureDirty && !actorState->paletteDirty)) {
            continue;
        }

        UploadPendingActor(actor);
        actorIndex = actorIndex + 1u;
        if (actorIndex >= ACTOR_COUNT) {
            actorIndex = 0;
        }
        sState.nextUploadActor = (u8)actorIndex;
        break;
    }
}

extern "C" void W2U_BattleAnim_Term(void)
{
    for (u32 i = 0; i < ACTOR_COUNT; ++i) {
        sState.actor[i].active = false;
        sState.actor[i].textureDirty = false;
        sState.actor[i].paletteDirty = false;
        sState.actor[i].tick = 0;
        sState.actor[i].copiedFrame = 0xffffu;
        sState.actor[i].pendingFrame = 0xffffu;
        sState.actor[i].mcssIndex = -1;
        sState.actor[i].species = SPECIES_NONE;
        sState.actor[i].form = 0;
        sState.actor[i].shiny = false;
        sState.actor[i].assetId = ASSET_NONE;
        sState.actor[i].mcssMawPatched = false;
        sState.actor[i].mcss = 0;
    }
    sState.nextUploadActor = 0;
    sNativeFormChangePosition = -1;
    sNativeFormChangeVisualAsset = ASSET_NONE;
    sNativeFormChangeSwapReached = false;
}

} // namespace battle_anim
} // namespace w2u
