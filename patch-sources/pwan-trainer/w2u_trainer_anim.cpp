#include "nds/fs.h"
#include "pwan_types.h"
#include "w2u_pwan_archive.h"

#define TRAINER_CONFIG_MEMBER 3203u
#define TRAINER_ASSET_BASE 3204u
#define TRAINER_CONFIG_MAGIC 0x544E5750u
#define TRAINER_CONFIG_VERSION 1u
#define TRAINER_CONFIG_HEADER_BYTES 16u
#define TRAINER_CONFIG_ENTRY_BYTES 4u
#define TRAINER_FRONT_ARC_ID 71u
#define TRAINER_FILES_PER_GRAPHIC 8u
#define TRAINER_MAX_ACTORS 8u
#define PWAN_MAGIC 0x4E415750u
#define PWAN_FRAME_BYTES 0x1200u
#define PWAN_MAX_TIMELINE 192u
#define MCSS_TEX_STRIDE_BYTES 128u
#define MCSS_SLOT_COUNT 8u
#define MCSS_BASE_PLTT_DATA_OFFSET 0xd4u
#define MCSS_FADE_PLTT_DATA_OFFSET 0xd8u
#define MCSS_PLTT_DATA_SIZE_OFFSET 0xdcu
#define MCSS_IMAGE_PROXY_VRAM_OFFSET 0x9cu
#define MCSS_FLAGS_OFFSET 0x140u
#define MCSS_FLAGS_LOADED (1u << 13)
#define MCSS_FLAGS_PALETTE_UPDATE (1u << 12)
#define MCSS_INDEX_OFFSET 0x148u
#define MAIN_RAM_START 0x02000000u
#define MAIN_RAM_END 0x02400000u

namespace w2u {
namespace trainer_anim {

struct TrainerConfigHeader {
    u32 magic;
    u16 version;
    u16 count;
    u16 maxTimeline;
    u16 carrierGraphic;
    u32 entriesOffset;
};

struct TrainerConfigEntry { u16 graphic; u16 asset; };
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
struct FileTimelineEntry { u16 frame; u16 ticks; };
struct TimelineEntry { u8 frame; u8 ticks; };
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
struct Asset {
    PwanHeader header;
    TimelineEntry timeline[PWAN_MAX_TIMELINE];
    u16 palette[16];
};
struct Actor {
    b32 active;
    void *mcss;
    u16 asset;
    u16 slot;
    u16 frame;
    u16 paletteInstalled;
    u32 tick;
    Asset data;
};

static Actor sActors[TRAINER_MAX_ACTORS];
static b32 sPending;
static u16 sPendingAsset;
static u8 sTextureScratch[96u * 48u] __attribute__((aligned(4)));
static u8 *const sFrameScratch = W2U_PwanFrameScratch;

static volatile u16 *const TextureVram = (volatile u16 *)0x06800000;
static volatile u8 *const VramA = (volatile u8 *)0x04000240;
static volatile u8 *const VramB = (volatile u8 *)0x04000241;
static volatile u8 *const VramC = (volatile u8 *)0x04000242;
static volatile u8 *const VramD = (volatile u8 *)0x04000243;
static volatile u16 *const Vcount = (volatile u16 *)0x04000006;

static b32 MainRam(const void *ptr)
{
    const u32 value = (u32)ptr;
    return value >= MAIN_RAM_START && value < MAIN_RAM_END;
}

static b32 ResourcesReady(const void *mcss)
{
    return MainRam(mcss) && (*(const u32 *)((const u8 *)mcss + MCSS_FLAGS_OFFSET) & MCSS_FLAGS_LOADED) != 0u;
}

static b32 FindConfig(u16 graphic, u16 *asset, u16 *carrier)
{
    TrainerConfigHeader header = {};
    if (!pwan_archive::ReadMemberRange(TRAINER_CONFIG_MEMBER, 0, &header, sizeof(header)) ||
        header.magic != TRAINER_CONFIG_MAGIC || header.version != TRAINER_CONFIG_VERSION ||
        header.maxTimeline > PWAN_MAX_TIMELINE || header.entriesOffset < TRAINER_CONFIG_HEADER_BYTES) return false;
    for (u32 i = 0; i < header.count; ++i) {
        TrainerConfigEntry entry = {};
        if (!pwan_archive::ReadMemberRange(TRAINER_CONFIG_MEMBER,
                header.entriesOffset + i * TRAINER_CONFIG_ENTRY_BYTES, &entry, sizeof(entry))) return false;
        if (entry.graphic == graphic) {
            *asset = entry.asset;
            *carrier = header.carrierGraphic;
            return true;
        }
    }
    return false;
}

static b32 LoadAsset(u16 assetId, Asset *asset)
{
    const u32 member = TRAINER_ASSET_BASE + assetId;
    if (!pwan_archive::ReadMemberRange(member, 0, &asset->header, sizeof(asset->header))) return false;
    const PwanHeader *h = &asset->header;
    if (h->magic != PWAN_MAGIC || h->version != 1u || h->width != 96u || h->height != 96u ||
        h->bpp != 4u || h->frameBytes != PWAN_FRAME_BYTES || h->paletteColors != 16u ||
        h->frameCount == 0u || h->timelineCount == 0u || h->timelineCount > PWAN_MAX_TIMELINE || h->totalTicks == 0u) return false;
    if (!pwan_archive::ReadMemberRange(member, h->paletteOffset, asset->palette, sizeof(asset->palette))) return false;
    FileTimelineEntry timeline[PWAN_MAX_TIMELINE];
    if (!pwan_archive::ReadMemberRange(member, h->timelineOffset, timeline, h->timelineCount * sizeof(timeline[0]))) return false;
    for (u32 i = 0; i < h->timelineCount; ++i) {
        if (timeline[i].frame >= h->frameCount || timeline[i].frame > 0xffu || timeline[i].ticks == 0u || timeline[i].ticks > 0xffu) return false;
        asset->timeline[i].frame = (u8)timeline[i].frame;
        asset->timeline[i].ticks = (u8)timeline[i].ticks;
    }
    return true;
}

static u16 FrameForTick(const Asset *asset, u32 tick)
{
    u32 at = 0;
    for (u32 i = 0; i < asset->header.timelineCount; ++i) {
        at += asset->timeline[i].ticks;
        if (tick < at) return asset->timeline[i].frame;
    }
    return asset->timeline[asset->header.timelineCount - 1u].frame;
}

static void BlitTiles(u8 *dst, const u8 *src, u32 dstX, u32 dstY, u32 tilesW, u32 tilesH)
{
    for (u32 ty = 0; ty < tilesH; ++ty) for (u32 tx = 0; tx < tilesW; ++tx) {
        const u8 *tile = src + (ty * tilesW + tx) * 32u;
        for (u32 y = 0; y < 8u; ++y) {
            u8 *row = dst + (dstY + ty * 8u + y) * 48u + (dstX + tx * 8u) / 2u;
            for (u32 x = 0; x < 4u; ++x) row[x] = tile[y * 4u + x];
        }
    }
}

static b32 StageFrame(const Actor *actor, u16 frame)
{
    const u32 offset = actor->data.header.frameOffset + (u32)frame * actor->data.header.frameBytes;
    if (!pwan_archive::ReadMemberRange(TRAINER_ASSET_BASE + actor->asset, offset, sFrameScratch, PWAN_FRAME_BYTES)) return false;
    BlitTiles(sTextureScratch, sFrameScratch + 0x0000u, 0, 0, 8, 8);
    BlitTiles(sTextureScratch, sFrameScratch + 0x0800u, 64, 0, 4, 8);
    BlitTiles(sTextureScratch, sFrameScratch + 0x0c00u, 0, 64, 8, 4);
    BlitTiles(sTextureScratch, sFrameScratch + 0x1000u, 64, 64, 4, 4);
    return true;
}

static void WaitVblank(void)
{
    while (*Vcount < 192u || *Vcount > 200u) {}
}

static b32 InstallNativePalette(Actor *actor)
{
    if (actor->paletteInstalled) return true;
    u8 *mcss = (u8 *)actor->mcss;
    u16 *base = *(u16 **)(mcss + MCSS_BASE_PLTT_DATA_OFFSET);
    u16 *fade = *(u16 **)(mcss + MCSS_FADE_PLTT_DATA_OFFSET);
    const u32 size = *(u32 *)(mcss + MCSS_PLTT_DATA_SIZE_OFFSET);
    if (!MainRam(base) || !MainRam(fade) || size < 32u || size > 0x200u) return false;

    // Install the imported colors once as the native fade's source. MCSS
    // blends that source into a queued VBlank upload and owns the palette
    // proxy. Rebinding it to a full-bright PWAN palette on GIF frame changes
    // fights those uploads and flashes between full and partially faded color.
    for (u32 i = 0; i < 16u; ++i) base[i] = fade[i] = actor->data.palette[i];
    *(u32 *)(mcss + MCSS_FLAGS_OFFSET) |= MCSS_FLAGS_PALETTE_UPDATE;
    actor->paletteInstalled = true;
    return true;
}

static void Upload(Actor *actor, u16 frame)
{
    // MCSS_Add can return before the native resource upload completes. A
    // palette proxy is not a slot identifier and is not ready at that point.
    if (!ResourcesReady(actor->mcss)) return;
    if (!InstallNativePalette(actor)) return;
    const u32 textureBase = *(const u32 *)((const u8 *)actor->mcss + MCSS_IMAGE_PROXY_VRAM_OFFSET);
    if (textureBase >= 0x80000u || textureBase + 95u * MCSS_TEX_STRIDE_BYTES + 48u > 0x80000u) return;
    if (!StageFrame(actor, frame)) return;
    WaitVblank();
    u8 a = *VramA, b = *VramB, c = *VramC, d = *VramD;
    *VramA = *VramB = *VramC = *VramD = 0x80u;
    volatile u16 *tex = TextureVram + (textureBase >> 1);
    for (u32 y = 0; y < 96u; ++y) {
        volatile u16 *dst = tex + y * (MCSS_TEX_STRIDE_BYTES >> 1);
        const u16 *src = (const u16 *)(sTextureScratch + y * 48u);
        for (u32 x = 0; x < 24u; ++x) dst[x] = src[x];
    }
    *VramA = a; *VramB = b; *VramC = c; *VramD = d;
    actor->frame = frame;
}

extern "C" void W2U_TrainerAnim_Prepare(McssAddWork *maw)
{
    sPending = false;
    if (!maw || maw->arcID != TRAINER_FRONT_ARC_ID || maw->ncbr == 0u || ((maw->ncbr - 1u) & 7u) != 0u) return;
    const u16 graphic = (u16)((maw->ncbr - 1u) >> 3);
    u16 asset = 0, carrier = 0xffffu;
    if (!FindConfig(graphic, &asset, &carrier) || carrier == 0xffffu) return;
    const u32 base = (u32)carrier << 3;
    maw->ncbr = base + 1u; maw->nclr = base + 7u; maw->ncer = base + 2u; maw->nanr = base + 3u;
    maw->nmcr = base + 4u; maw->nmar = base + 5u; maw->ncec = base + 6u;
    sPendingAsset = asset;
    sPending = true;
}

extern "C" void W2U_TrainerAnim_Commit(void *mcss)
{
    if (!sPending || !MainRam(mcss)) { sPending = false; return; }
    sPending = false;
    const u32 slot = *(const u32 *)((const u8 *)mcss + MCSS_INDEX_OFFSET);
    if (slot >= MCSS_SLOT_COUNT) return;
    Actor *actor = 0;
    for (u32 i = 0; i < TRAINER_MAX_ACTORS; ++i) if (!sActors[i].active) { actor = &sActors[i]; break; }
    if (!actor) return;
    actor->active = true; actor->mcss = mcss; actor->asset = sPendingAsset; actor->slot = (u16)slot;
    actor->tick = 0; actor->frame = 0xffffu; actor->paletteInstalled = false;
    if (!LoadAsset(actor->asset, &actor->data)) { actor->active = false; return; }
    Upload(actor, FrameForTick(&actor->data, 0));
}

extern "C" void W2U_TrainerAnim_Update(void)
{
    for (u32 i = 0; i < TRAINER_MAX_ACTORS; ++i) {
        Actor *actor = &sActors[i];
        if (!actor->active) continue;
        if (!ResourcesReady(actor->mcss)) { actor->frame = 0xffffu; actor->paletteInstalled = false; continue; }
        if (actor->frame == 0xffffu) {
            Upload(actor, FrameForTick(&actor->data, actor->tick));
            continue;
        }
        const u32 total = actor->data.header.totalTicks;
        actor->tick = actor->tick + 1u;
        if (actor->tick >= total) actor->tick = 0;
        const u16 frame = FrameForTick(&actor->data, actor->tick);
        if (frame != actor->frame) Upload(actor, frame);
    }
}

extern "C" void W2U_TrainerAnim_Delete(void *mcss)
{
    for (u32 i = 0; i < TRAINER_MAX_ACTORS; ++i) if (sActors[i].mcss == mcss) { sActors[i].active = false; sActors[i].mcss = 0; }
}

extern "C" void W2U_TrainerAnim_Term(void)
{
    for (u32 i = 0; i < TRAINER_MAX_ACTORS; ++i) { sActors[i].active = false; sActors[i].mcss = 0; }
    sPending = false;
}

} // namespace trainer_anim
} // namespace w2u
