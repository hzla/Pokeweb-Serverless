#include "species_ids.h"
#include "nds/fs.h"
#include "pwan_types.h"
#include "w2u_pwan_archive.h"

#define W2U_PWAN_MAGIC 0x4E415750u
#define W2U_FRAME_BYTES 0x1200u
#define W2U_FRAME_VRAM_OFFSET 0x7000u
#define W2U_OBJ_1D_64K_BLOCK_BYTES 64u
#define W2U_TILE_BASE (W2U_FRAME_VRAM_OFFSET / W2U_OBJ_1D_64K_BLOCK_BYTES)
#define W2U_OBJ_PLT 15u
#define W2U_OAM_BASE ((volatile u16 *)0x07000000)
#define W2U_OBJ_VRAM ((volatile u16 *)0x06400000)
#define W2U_OBJ_PLTT ((volatile u16 *)0x05000200)
#define W2U_REG_DISPCNT ((volatile u32 *)0x04000000)
#define W2U_VRAMCNT_E ((volatile u8 *)0x04000244)
#define W2U_DISPCNT_OBJ_ENABLE (1u << 12)
#define W2U_DISPCNT_OBJ_1D_MAP (1u << 4)
#define W2U_VRAMCNT_ENABLE 0x80u
#define W2U_VRAMCNT_MST_MAIN_OBJ 0x02u
#define W2U_OAM_INDEX 0u
#define W2U_EGG_BASE_X 80u
#define W2U_EGG_BASE_Y 56u
#define W2U_MCSS_FLAGS_OFFSET 0x140u
#define W2U_MCSS_FLAGS_VANISH_SHIFT 11u
#define W2U_MAIN_RAM_START 0x02000000u
#define W2U_MAIN_RAM_END 0x02400000u

namespace w2u {
namespace egg_hatch_anim {

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

typedef u32 AssetId;
#define ASSET_NONE 0xffffffffu

struct Asset {
    b32 loaded;
    AssetId assetId;
    PwanHeader header;
    RuntimeTimelineEntry timeline[W2U_PWAN_MAX_TIMELINE];
    u16 palette[16];
};

struct State {
    b32 active;
    b32 revealed;
    b32 sawNativeHidden;
    b32 readyToDraw;
    void *system;
    void *mcss;
    u16 species;
    u16 copiedFrame;
    u32 tick;
    AssetId assetId;
    AssetId copiedAsset;
    AssetId paletteAsset;
    u8 savedVramcntE;
    b32 savedVramcntEValid;
    Asset asset;
};

enum EggSkipReason {
    EGG_SKIP_NONE = 0,
    EGG_SKIP_INACTIVE = 1,
    EGG_SKIP_WRONG_SYSTEM = 2,
    EGG_SKIP_NO_ASSET = 3,
    EGG_SKIP_LOAD_FAIL = 4,
    EGG_SKIP_NOT_REVEALED = 5,
    EGG_SKIP_FRAME_READ_FAIL = 6,
    EGG_SKIP_BAD_MCSS = 7,
};

#if !W2U_PWAN_DIAGNOSTICS
#define u32 w2u::pwan_profile::SinkWord
#endif
struct EggProfile {
    u32 magic;
    u32 version;
    u32 structSize;
    u32 addCalls;
    u32 drawCalls;
    u32 deleteCalls;
    u32 nativeDrawCalls;
    u32 hideNativeCalls;
    u32 oamDrawCalls;
    u32 loadFailCount;
    u32 frameReadFailCount;
    u32 lastSystem;
    u32 lastMcss;
    u32 lastSpecies;
    u32 lastAsset;
    u32 revealed;
    u32 copiedFrame;
    u32 skipReason;
    u32 lastMcssFlags;
    u32 lastOamAttr0[4];
    u32 lastOamAttr1[4];
    u32 lastOamAttr2[4];
    u32 lastDispcntBefore;
    u32 lastDispcntAfter;
    u32 lastVramcntEBeforeNative;
    u32 lastVramcntEForObj;
    u32 prepareObjCalls;
    u32 sawNativeHidden;
    u32 afterObjCalls;
    u32 visibleDrawCalls;
    u32 readyToDraw;
    u32 frameTailCalls;
};
#if !W2U_PWAN_DIAGNOSTICS
#undef u32
#endif

#if W2U_PWAN_DIAGNOSTICS
extern "C" {
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
volatile EggProfile W2U_EggHatch_Profile = {
    0x52464745u,
    1u,
    sizeof(EggProfile),
};
#pragma GCC diagnostic pop
}
#else
static EggProfile W2U_EggHatch_Profile;
#endif

static State sState;
static u8 *const sFrameScratch = W2U_PwanFrameScratch;

typedef u32 (*PpGetFn)(const void *pp, int id, void *buf);
typedef void *(*AddPokeMcssFn)(void *system, const void *pp, int dir, s32 x, s32 y, s32 z);
typedef void (*McssDrawFn)(void *system);
typedef void (*McssDelFn)(void *system, void *mcss);
typedef void (*McssFlagFn)(void *mcss);
typedef void (*McssShadowVanishFn)(void *mcss, u8 flag);
typedef void (*EggObjMainFn)(void *arg);
typedef void (*EggFrameTailFn)(void *arg);

static PpGetFn const PP_Get_Fn = (PpGetFn)0x0201CD25u;
static AddPokeMcssFn const NativeAddPokeSprite_Fn = (AddPokeMcssFn)0x0201C179u;
static McssDrawFn const MCSS_Draw_Fn = (McssDrawFn)0x02019C39u;
static McssDelFn const MCSS_Del_Fn = (McssDelFn)0x0201AAADu;
static McssFlagFn const MCSS_SetVanishFlag_Fn = (McssFlagFn)0x0201ADA9u;
static McssShadowVanishFn const MCSS_SetShadowVanishFlag_Fn =
    (McssShadowVanishFn)0x0201AEF9u;
static EggObjMainFn const Egg_ObjMain_Fn = (EggObjMainFn)0x021DF335u;
static EggFrameTailFn const Egg_FrameTail_Fn = (EggFrameTailFn)0x021DE939u;

static b32 IsLikelyMainRamPointer(const void *ptr)
{
    const u32 value = (u32)ptr;
    return value >= W2U_MAIN_RAM_START && value < W2U_MAIN_RAM_END;
}

static u32 GetMcssFlags(void *mcss)
{
    if (!IsLikelyMainRamPointer(mcss)) {
        return 0;
    }
    return *(u32 *)((u8 *)mcss + W2U_MCSS_FLAGS_OFFSET);
}

static b32 McssIsVanished(void *mcss)
{
    return ((GetMcssFlags(mcss) >> W2U_MCSS_FLAGS_VANISH_SHIFT) & 1u) != 0;
}

static b32 ReadRange(AssetId assetId, u32 offset, void *buffer, u32 size)
{
    if (assetId >= W2U_PWAN_ASSET_COUNT) return false;
    return w2u::pwan_archive::ReadMemberRange(
        w2u::pwan_archive::MemberIdForAsset(assetId), offset, buffer, size);
}

static b32 ReadConfigRange(u32 offset, void *buffer, u32 size)
{
    return w2u::pwan_archive::ReadMemberRange(W2U_PWAN_CONFIG_MEMBER_ID, offset, buffer, size);
}

static AssetId GetAssetForSpeciesSide(u16 species, b32 isFront)
{
    PwanConfigHeader header;
    if (!ReadConfigRange(0, &header, sizeof(header)) ||
        header.magic != W2U_PWAN_CONFIG_MAGIC ||
        header.version != W2U_PWAN_CONFIG_VERSION ||
        header.count > W2U_PWAN_MAX_OVERRIDES ||
        header.maxTimeline > W2U_PWAN_MAX_TIMELINE ||
        header.entriesOffset < sizeof(PwanConfigHeader)) {
        return ASSET_NONE;
    }
    for (u32 i = 0; i < header.count; ++i) {
        u8 raw[W2U_PWAN_CONFIG_ENTRY_BYTES];
        const u32 offset = W2U_PwanConfigEntryOffset(&header, i);
        if (!ReadConfigRange(offset, raw, W2U_PWAN_CONFIG_ENTRY_BYTES)) return ASSET_NONE;
        PwanConfigEntry entry = W2U_DecodePwanConfigEntry(raw);
        if (entry.species != species || entry.form != 0) continue;
        if (isFront) {
            if ((entry.flags & W2U_PWAN_CONFIG_FRONT_FLAG) == 0 ||
                entry.assetIndex > W2U_PWAN_MAX_ASSET_INDEX) return ASSET_NONE;
            return (AssetId)(entry.assetIndex * 2u);
        }
        if ((entry.flags & W2U_PWAN_CONFIG_BACK_FLAG) == 0 ||
            entry.assetIndex > W2U_PWAN_MAX_ASSET_INDEX) return ASSET_NONE;
        return (AssetId)(entry.assetIndex * 2u + 1u);
    }
    return ASSET_NONE;
}

static b32 LoadAsset(Asset *asset, AssetId assetId)
{
    if (assetId >= W2U_PWAN_ASSET_COUNT) {
        return false;
    }
    if (asset->loaded && asset->assetId == assetId) {
        return true;
    }
    asset->loaded = false;
    asset->assetId = assetId;

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
        asset->header.frameCount == 0 ||
        asset->header.timelineCount == 0 ||
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

static u16 FrameForTick(const Asset *asset, u32 tick)
{
    u32 at = 0;
    for (u32 i = 0; i < asset->header.timelineCount; ++i) {
        at += asset->timeline[i].ticks;
        if (tick < at) {
            const u16 frame = asset->timeline[i].frame;
            return frame < asset->header.frameCount ? frame : 0;
        }
    }
    const u16 frame = asset->timeline[asset->header.timelineCount - 1].frame;
    return frame < asset->header.frameCount ? frame : 0;
}

static void AdvanceTick()
{
    const u32 totalTicks = sState.asset.header.totalTicks ?
        sState.asset.header.totalTicks : 1u;
    sState.tick = sState.tick + 1u;
    if (sState.tick >= totalTicks) {
        sState.tick = 0;
    }
}

static void HideOam()
{
    for (u32 i = 0; i < 4; ++i) {
        volatile u16 *oam = W2U_OAM_BASE + ((W2U_OAM_INDEX + i) * 4);
        oam[0] = 192;
        oam[1] = 0;
        oam[2] = 0;
        oam[3] = 0;
    }
}

static void RestoreNativeVramMapping()
{
    if (sState.savedVramcntEValid) {
        *W2U_VRAMCNT_E = sState.savedVramcntE;
        W2U_EggHatch_Profile.lastVramcntEBeforeNative = sState.savedVramcntE;
    }
}

static void PrepareObjDisplay()
{
    W2U_EggHatch_Profile.prepareObjCalls = W2U_EggHatch_Profile.prepareObjCalls + 1u;
    W2U_EggHatch_Profile.lastDispcntBefore = *W2U_REG_DISPCNT;
    *W2U_REG_DISPCNT = *W2U_REG_DISPCNT | W2U_DISPCNT_OBJ_ENABLE | W2U_DISPCNT_OBJ_1D_MAP;
    W2U_EggHatch_Profile.lastDispcntAfter = *W2U_REG_DISPCNT;
    if (!sState.savedVramcntEValid) {
        sState.savedVramcntE = *W2U_VRAMCNT_E;
        sState.savedVramcntEValid = true;
    }
    *W2U_VRAMCNT_E = W2U_VRAMCNT_ENABLE | W2U_VRAMCNT_MST_MAIN_OBJ;
    W2U_EggHatch_Profile.lastVramcntEForObj = *W2U_VRAMCNT_E;
}

static void CopyPalette()
{
    for (u32 i = 0; i < 16; ++i) {
        W2U_OBJ_PLTT[W2U_OBJ_PLT * 16 + i] = sState.asset.palette[i];
    }
    sState.paletteAsset = sState.assetId;
}

static b32 CopyFrameToVram(u16 frame)
{
    const u32 offset = sState.asset.header.frameOffset + frame * sState.asset.header.frameBytes;
    if (!ReadRange(sState.assetId, offset, sFrameScratch, W2U_FRAME_BYTES)) {
        W2U_EggHatch_Profile.frameReadFailCount =
            W2U_EggHatch_Profile.frameReadFailCount + 1u;
        W2U_EggHatch_Profile.skipReason = EGG_SKIP_FRAME_READ_FAIL;
        return false;
    }

    volatile u16 *dst = W2U_OBJ_VRAM + (W2U_FRAME_VRAM_OFFSET / 2u);
    const u16 *src = (const u16 *)sFrameScratch;
    for (u32 i = 0; i < W2U_FRAME_BYTES / 2u; ++i) {
        dst[i] = src[i];
    }
    sState.copiedFrame = frame;
    sState.copiedAsset = sState.assetId;
    W2U_EggHatch_Profile.copiedFrame = frame;
    return true;
}

static b32 RefreshFrameInVram()
{
    return CopyFrameToVram(sState.copiedFrame);
}

static void SetObj(u32 index, u32 x, u32 y, u32 shape, u32 size, u32 tile)
{
    volatile u16 *oam = W2U_OAM_BASE + ((W2U_OAM_INDEX + index) * 4);
    oam[0] = (y & 0xffu) | (shape << 14);
    oam[1] = (x & 0x1ffu) | (size << 14);
    oam[2] = (tile & 0x3ffu) | (W2U_OBJ_PLT << 12);
    oam[3] = 0;
    W2U_EggHatch_Profile.lastOamAttr0[index] = oam[0];
    W2U_EggHatch_Profile.lastOamAttr1[index] = oam[1];
    W2U_EggHatch_Profile.lastOamAttr2[index] = oam[2];
}

static void DrawFrame()
{
    W2U_EggHatch_Profile.oamDrawCalls = W2U_EggHatch_Profile.oamDrawCalls + 1u;
    const u32 x = W2U_EGG_BASE_X;
    const u32 y = W2U_EGG_BASE_Y;
    SetObj(0, x, y, 0, 3, W2U_TILE_BASE);
    SetObj(1, x + 64u, y, 2, 3, W2U_TILE_BASE + (0x0800u / W2U_OBJ_1D_64K_BLOCK_BYTES));
    SetObj(2, x, y + 64u, 1, 3, W2U_TILE_BASE + (0x0c00u / W2U_OBJ_1D_64K_BLOCK_BYTES));
    SetObj(3, x + 64u, y + 64u, 0, 2, W2U_TILE_BASE + (0x1000u / W2U_OBJ_1D_64K_BLOCK_BYTES));
}

static void DrawVisiblePwan()
{
    if (!sState.active || !sState.revealed || !sState.readyToDraw) {
        W2U_EggHatch_Profile.readyToDraw = sState.readyToDraw ? 1u : 0u;
        HideOam();
        return;
    }

    W2U_EggHatch_Profile.visibleDrawCalls =
        W2U_EggHatch_Profile.visibleDrawCalls + 1u;
    W2U_EggHatch_Profile.readyToDraw = 1u;
    PrepareObjDisplay();
    CopyPalette();
    const u16 frame = FrameForTick(&sState.asset, sState.tick);
    if (sState.copiedFrame != frame || sState.copiedAsset != sState.assetId) {
        if (!CopyFrameToVram(frame)) {
            HideOam();
            return;
        }
    } else if (!RefreshFrameInVram()) {
        HideOam();
        return;
    }
    DrawFrame();
    AdvanceTick();
}

static void HideNativeMcss(void *mcss)
{
    if (!mcss) {
        return;
    }
    W2U_EggHatch_Profile.hideNativeCalls = W2U_EggHatch_Profile.hideNativeCalls + 1u;
    MCSS_SetVanishFlag_Fn(mcss);
    MCSS_SetShadowVanishFlag_Fn(mcss, true);
}

static void ClearState()
{
    HideOam();
    sState.active = false;
    sState.revealed = false;
    sState.sawNativeHidden = false;
    sState.readyToDraw = false;
    sState.system = 0;
    sState.mcss = 0;
    sState.species = SPECIES_NONE;
    sState.copiedFrame = 0xffffu;
    sState.tick = 0;
    sState.assetId = ASSET_NONE;
    sState.copiedAsset = ASSET_NONE;
    sState.paletteAsset = ASSET_NONE;
    sState.savedVramcntE = 0;
    sState.savedVramcntEValid = false;
}

static u16 GetPpSpecies(const void *pp)
{
    if (!pp) return SPECIES_NONE;
    return (u16)PP_Get_Fn(pp, 5, 0);
}

static void NativeDraw(void *system)
{
    MCSS_Draw_Fn(system);
    W2U_EggHatch_Profile.nativeDrawCalls = W2U_EggHatch_Profile.nativeDrawCalls + 1u;
}

} // namespace egg_hatch_anim
} // namespace w2u

extern "C" void *W2U_EggHatch_AddPokeMcss(void *system, const void *pp, int dir,
                                           s32 x, s32 y, s32 z)
{
    void *mcss = w2u::egg_hatch_anim::NativeAddPokeSprite_Fn(system, pp, dir, x, y, z);
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.addCalls =
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.addCalls + 1u;

    w2u::egg_hatch_anim::ClearState();
    const u16 species = w2u::egg_hatch_anim::GetPpSpecies(pp);
    const w2u::egg_hatch_anim::AssetId assetId =
        w2u::egg_hatch_anim::GetAssetForSpeciesSide(species, true);

    w2u::egg_hatch_anim::W2U_EggHatch_Profile.lastSystem = (u32)system;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.lastMcss = (u32)mcss;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.lastSpecies = species;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.lastAsset = assetId;

    if (!system || !w2u::egg_hatch_anim::IsLikelyMainRamPointer(mcss)) {
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
            w2u::egg_hatch_anim::EGG_SKIP_BAD_MCSS;
        return mcss;
    }
    if (assetId >= W2U_PWAN_ASSET_COUNT) {
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
            w2u::egg_hatch_anim::EGG_SKIP_NO_ASSET;
        return mcss;
    }
    if (!w2u::egg_hatch_anim::LoadAsset(&w2u::egg_hatch_anim::sState.asset, assetId)) {
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.loadFailCount =
            w2u::egg_hatch_anim::W2U_EggHatch_Profile.loadFailCount + 1u;
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
            w2u::egg_hatch_anim::EGG_SKIP_LOAD_FAIL;
        return mcss;
    }

    w2u::egg_hatch_anim::sState.active = true;
    w2u::egg_hatch_anim::sState.revealed = false;
    w2u::egg_hatch_anim::sState.sawNativeHidden = false;
    w2u::egg_hatch_anim::sState.readyToDraw = false;
    w2u::egg_hatch_anim::sState.system = system;
    w2u::egg_hatch_anim::sState.mcss = mcss;
    w2u::egg_hatch_anim::sState.species = species;
    w2u::egg_hatch_anim::sState.assetId = assetId;
    w2u::egg_hatch_anim::sState.copiedFrame = 0xffffu;
    w2u::egg_hatch_anim::sState.copiedAsset = ASSET_NONE;
    w2u::egg_hatch_anim::sState.paletteAsset = ASSET_NONE;
    w2u::egg_hatch_anim::sState.tick = 0;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.revealed = 0;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.copiedFrame = 0xffffu;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
        w2u::egg_hatch_anim::EGG_SKIP_NOT_REVEALED;
    return mcss;
}

extern "C" void W2U_EggHatch_Draw(void *system)
{
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.drawCalls =
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.drawCalls + 1u;

    if (!w2u::egg_hatch_anim::sState.active) {
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
            w2u::egg_hatch_anim::EGG_SKIP_INACTIVE;
        w2u::egg_hatch_anim::HideOam();
        w2u::egg_hatch_anim::NativeDraw(system);
        return;
    }
    if (w2u::egg_hatch_anim::sState.system != system) {
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
            w2u::egg_hatch_anim::EGG_SKIP_WRONG_SYSTEM;
        w2u::egg_hatch_anim::HideOam();
        w2u::egg_hatch_anim::NativeDraw(system);
        return;
    }

    void *mcss = w2u::egg_hatch_anim::sState.mcss;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.lastMcssFlags =
        w2u::egg_hatch_anim::GetMcssFlags(mcss);
    if (!w2u::egg_hatch_anim::sState.revealed) {
        const b32 vanished = w2u::egg_hatch_anim::McssIsVanished(mcss);
        if (vanished) {
            w2u::egg_hatch_anim::sState.sawNativeHidden = true;
            w2u::egg_hatch_anim::W2U_EggHatch_Profile.sawNativeHidden = 1;
        }
        if (!w2u::egg_hatch_anim::sState.sawNativeHidden || vanished) {
            w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
                w2u::egg_hatch_anim::EGG_SKIP_NOT_REVEALED;
            w2u::egg_hatch_anim::W2U_EggHatch_Profile.revealed = 0;
            w2u::egg_hatch_anim::sState.readyToDraw = false;
            w2u::egg_hatch_anim::HideOam();
            w2u::egg_hatch_anim::NativeDraw(system);
            w2u::egg_hatch_anim::AdvanceTick();
            return;
        }
        w2u::egg_hatch_anim::sState.revealed = true;
    }

    w2u::egg_hatch_anim::W2U_EggHatch_Profile.revealed = 1;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.skipReason =
        w2u::egg_hatch_anim::EGG_SKIP_NONE;
    w2u::egg_hatch_anim::sState.readyToDraw = true;
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.readyToDraw = 1u;
    w2u::egg_hatch_anim::HideNativeMcss(mcss);
    w2u::egg_hatch_anim::RestoreNativeVramMapping();
    w2u::egg_hatch_anim::NativeDraw(system);
}

extern "C" void W2U_EggHatch_AfterObjMain(void *arg)
{
    w2u::egg_hatch_anim::Egg_ObjMain_Fn(arg);
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.afterObjCalls =
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.afterObjCalls + 1u;
}

extern "C" void W2U_EggHatch_AfterFrameTail(void *arg)
{
    w2u::egg_hatch_anim::Egg_FrameTail_Fn(arg);
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.frameTailCalls =
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.frameTailCalls + 1u;
    w2u::egg_hatch_anim::DrawVisiblePwan();
}

extern "C" void W2U_EggHatch_Del(void *system, void *mcss)
{
    w2u::egg_hatch_anim::W2U_EggHatch_Profile.deleteCalls =
        w2u::egg_hatch_anim::W2U_EggHatch_Profile.deleteCalls + 1u;
    if (w2u::egg_hatch_anim::sState.mcss == mcss) {
        w2u::egg_hatch_anim::ClearState();
    }
    w2u::egg_hatch_anim::MCSS_Del_Fn(system, mcss);
}
