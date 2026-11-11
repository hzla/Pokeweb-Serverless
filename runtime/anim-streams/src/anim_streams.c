// Pokeweb animated sprite streams (w2anim W2AS / MANI) for Black 2 and White 2.
//
// A C port of White2Upgrade's w2anim streamer (src/w2anim/w2u_anim_streams.cpp, itself from MegaB2W2's AnimSprites;
// pokebw2 carries the same design as src/w2u/graphics/anim_stream.c). It replaces Pokeweb's PWAN runtimes
// (PokewebPwan{Battle,Summary,Misc,Trainer}): animated MCSS sprites, Pokemon and trainers, on every screen that draws
// MCSS sprites, with the frames streamed from one ROM file into the sprite's own texture slot.
//  - registration at MCSS's three LoadMCSSGraphicsData calls (ARM9), the tick after every caller of MCSSSys_Update
//    (battle, trade, summary, Hall of Fame, evolution, intro, Pokedex forms, egg hatch), release at MCSSSys_Remove;
//  - the index is read from the ROM when a sprite loads (no table in RAM): sorted {arc, sheet file} -> stream;
//  - two texture modes: TEX4 (the sprite keeps its native 4 bpp texture and cells: each frame overwrites the rows its
//    cells show) and A3I5 (up to 128x128, the proxy switched to a 128x128 A3I5 texture);
//  - frame durations in ms or in 1/60 s ticks; frames are deduplicated (the timeline indexes unique frames);
//  - every buffer on the sprite's own game heap (the battle / scene heap): only this code is in PMC's heap;
//  - evolution (ov284): its morph renderer draws the before / after Pokemon from its own 128x128 bitmaps; their
//    stream's current frame and palette are written into it;
//  - Hall of Fame (ov265): the first frame only.
//
// File `w2anim/streams.bin`:
//   header  {'W2AS', u16 version 1, u16 reserved, u32 entryCount, u32 entriesOffset}
//   entries entryCount x {u16 arc, u16 flags, u32 sheetFile, u32 maniOffset, u32 shinyNclrFile} sorted by (arc, sheet);
//           flags & ENTRY_CARRIER (W2U trainers): MCSS loads the front set of pokegra block shinyNclrFile / 20 instead
//           (a 96x96 carrier, primed with the stream's frame 0 and palette, so its own art never shows);
//           flags & ENTRY_TRAINER_CARRIER (Pokeweb trainers): MCSS loads the trainer graphic whose first file is
//           shinyNclrFile in the entry's own arc (8 files: NCGR, NCBR, NCER, NANR, NMCR, NMAR, NCEC, NCLR), Pokeweb's
//           96x96 trainer carrier
//   MANI    {'MANI', u16 version 2, u16 flags, u16 boxW, boxH, seqCount, uniqueCount, u32 seqOffset, framesOffset,
//            paletteOffset} (offsets from the MANI start); seq {u16 unique, u16 duration}; frames {u32 offset, size}
//            (from the MANI start; LZ10 / LZ11 blobs of boxH rows); palettes 2 x 16 BGR555 (normal, shiny)
//           flags: 1 own palettes, 2 TEX4 (else A3I5: rows of 128 texels, index | alpha << 5), 4 durations in 1/60 s
//           ticks (else ms), 8 morph block at MANI + 0x1C {s16 x0, y0; u8 map[16]; u8 source[16]} (A3I5 only)
//
// MCSS facts (MegaB2W2 docs/MODLOG.md "Animated sprites"): a sprite slot owns 16 KB of texture VRAM (sys->texBase +
// slot * 0x4000; 256x128 4 bpp natively) and 0x20 bytes of palette VRAM (sys->palBase + slot * 0x20); its image proxy
// (spr + 0x9C: +0xA8 size S, +0xAC size T, +0xB0 format) builds TEXIMAGE_PARAM; spr + 0xD4 / 0xD8 are the original /
// working palette copies its fades start from. Black 2 and White 2 share the layout (the MCSS code is identical).
#include "types.h"
#include "nitro/fs.h"
#include "hooks.h"

// Game functions under neutral names; build.py binds each to the game's own symbol (pokebw2 names for Black 2 /
// White 2, aletheia names for Black / White):
//   McssLoad          LoadMCSSGraphicsData        MCSS_LoadResource      (sys, slot, params)
//   McssUpdate        MCSSSys_Update              MCSS_Main
//   McssFreeFiles     MCSS_FreeFiles              MCSS_FreeResource
//   HeapAlloc         GFL_HeapAllocate            GFL_HEAP_Alloc         (heap, size, clear, file, line)
//   HeapFree          GFL_HeapFree                GFL_HEAP_Free
//   AddUploadTask     GFL_VBlankTCBAdd            GFL_USE_AddMainTask    (MCSS's own uploads run in this list)
//   RemoveUploadTask  GFL_TCBRemove               TCB_DeleteTask
//   FsLength          FS_GetFileLength            FS_GetLength
// The evolution morph hooks (ANIM_STREAMS_MORPH) exist only in Black 2 / White 2: Black / White's evolution scene
// builds its particle grid from the sprite's static sheet (the carrier's first frame).
void McssLoad(void *sys, int slot, u32 *params);
void McssUpdate(void *sys);
void McssFreeFiles(void *spr);
#ifdef ANIM_STREAMS_MORPH
void *McssAddPartyPkm(void *sys, const void *pp, int dir, s32 x, s32 y, s32 z);
void MorphUpdatePieces(void *work);
void MorphDrawPieces(void *work);
#endif
void MI_UncompressLZ8(const void *src, void *dst);
void DC_FlushRange(const void *addr, u32 size);
void GX_BeginLoadTex(void);
void GX_LoadTex(const void *src, u32 offset, u32 size);
void GX_EndLoadTex(void);
void GX_BeginLoadTexPltt(void);
void GX_LoadTexPltt(const void *src, u32 offset, u32 size);
void GX_EndLoadTexPltt(void);
void *HeapAlloc(u16 heapId, u32 size, BOOL clear, const char *file, u16 line);
void HeapFree(void *p);
typedef struct TCB TCB;
typedef void (*TCBFunc)(TCB *tcb, void *data);
TCB *AddUploadTask(TCBFunc func, void *data, u32 priority);
BOOL RemoveUploadTask(TCB *tcb);
u32 FsLength(FSFile *file);
BOOL OS_IsRunOnTwl(void);

#define STREAMS_MAGIC 0x53413257u // 'W2AS'
#define MANI_MAGIC 0x494E414Du    // 'MANI'
#define MAX_STREAMS 8             // MCSS systems have at most 8 sprite slots in use
#define SLOT_TEX_BYTES 0x4000u
#define SLOT_PAL_BYTES 0x20u
#define NATIVE_ROW_BYTES 128u // 256 texels, 4 bpp
#define A3I5_ROW_BYTES 128u   // 128 texels, 8 bpp
#define GX_TEXSIZE_128 4u
#define GX_TEXFMT_A3I5 1u
#define MAX_FRAME_BLOB (20u * 1024u)

#define MANI_OWN_PALETTES 1u
#define MANI_TEX4 2u
#define MANI_TICKS 4u
#define MANI_MORPH 8u
#define MANI_FLAGS 15u
#define MANI_MORPH_OFFSET 0x1Cu
#define ENTRY_CARRIER 1u
#define ENTRY_TRAINER_CARRIER 2u
#define ARC_POKEGRA 4u
#define NO_FRAME 0xFFFFu

static const char sStreamsPath[] = "w2anim/streams.bin";

typedef struct { u32 magic; u16 version, reserved; u32 entryCount, entriesOffset; } StreamsHeader;
typedef struct { u16 arc, flags; u32 sheetFile, maniOffset, shinyNclrFile; } IndexEntry;
typedef struct {
    u32 magic; u16 version, flags; u16 boxW, boxH; u16 seqCount, uniqueCount; u32 seqOffset, framesOffset, paletteOffset;
} ManiHeader;
typedef struct { u16 unique, duration; } SeqEntry;
typedef struct { s16 x0, y0; u8 map[16]; u8 source[16]; } MorphBlock;
typedef struct { u32 offset, size; } FrameEntry;

// MCSS system / sprite fields
#define SYS_TEX_BASE(sys) (*(u32 *)((u8 *)(sys) + 0x30))
#define SYS_PAL_BASE(sys) (*(u32 *)((u8 *)(sys) + 0x34))
#define SYS_COUNT(sys) (*(u32 *)((u8 *)(sys) + 0x10))
#define SYS_SPRITE(sys, slot) ((*(u8 ***)((u8 *)(sys) + 0x14))[slot])
#define SPR_UPLOAD_TASK(spr) (*(void **)(spr))
#define SPR_FLAGS(spr) (*(u32 *)((spr) + 0x140))
#define SPR_HEAP(spr) ((u16) * (u32 *)((spr) + 0x14C))
#define SPR_ANIM_SPEED(spr) (*(s32 *)((spr) + 0x174)) // fx32 frames per tick
#define SPR_PALETTE_ORIG(spr) (*(u16 **)((spr) + 0xD4))
#define SPR_PALETTE_WORK(spr) (*(u16 **)((spr) + 0xD8))
#define SPR_PALETTE_SIZE(spr) (*(u32 *)((spr) + 0xDC))
#define SPR_ANIM_PAUSED(spr) (((SPR_FLAGS(spr) << 21) >> 30) != 0) // as MCSSSys_Update

typedef struct {
    void *sys;
    u8 *spr;
    u32 slot;
    u32 mani; // offset of the MANI in the streams file
    u16 flags, boxW, boxH, seqCount, uniqueCount, rowBytes;
    u8 *meta;    // seq table then frame table (heap)
    u8 *lz;      // one compressed frame (heap, the largest blob)
    u8 *staging; // boxH * rowBytes (heap)
    u32 seqPos;
    s32 elapsed; // time into the current entry, 1/60000 s
    u16 shown;   // unique frame in the texture (NO_FRAME: none yet)
    volatile u8 pending; // staging holds a frame for the next VBlank
    volatile u8 palettePending;
    u8 active, started, formatSet;
    u8 still;  // A3I5 primed without buffers: only keeps the A3I5 format
    u8 primed; // frame 0 and the palette went into MCSS's own upload
    u8 role;   // evolution: 1 the Pokemon before, 2 after (0: none)
    volatile u8 indepPending; // evolution: the morph bitmap holds a new frame for VBlank
    u16 indepShown;           // evolution: unique frame in the morph bitmap
    u8 *indepBmp;
    u32 indepTex; // evolution: the morph renderer's bitmap (RAM) and its VRAM
    u16 palette[16]; // own palette (normal or shiny), MANI_OWN_PALETTES only
    MorphBlock morph; // MANI_MORPH only
} Stream;

static Stream sStreams[MAX_STREAMS];
static TCB *sVBlankTask;
static s8 sFileState; // 0 unknown, 1 present, -1 missing / invalid
static StreamsHeader sHeader;
static FSFile sFile;
static BOOL sFileOpen;
static u32 sFileSize;
static u8 sUploadCursor;
#ifdef ANIM_STREAMS_MORPH
static u8 sEvoAdds;
static void *sEvoSys;
#endif

static SeqEntry *Seq(Stream *s) { return (SeqEntry *)s->meta; }
static FrameEntry *Frames(Stream *s) { return (FrameEntry *)(s->meta + s->seqCount * sizeof(SeqEntry)); }

// Native DSi mode exposes 16 MiB of main RAM. In DS mode the extra addresses mirror the 4 MiB allocation space.
static BOOL InMainRam(const void *p, u32 size) {
    u32 address = (u32)p;
    if (!size || address < 0x02000000u || address >= 0x03000000u) return FALSE;
    if (address < 0x02400000u && size <= 0x02400000u - address) return TRUE;
    return size <= 0x03000000u - address && OS_IsRunOnTwl();
}

static void Copy16(u16 *dst, const u16 *src, u32 count) {
    u32 i;
    for (i = 0; i < count; i++) dst[i] = src[i];
}

// ---- the streams file --------------------------------------------------------------------------------------
// It stays open (each frame change would look its path up again). Only the main update reads it, never VBlank. A
// failed read reopens the file once and retries.
static BOOL Read(u32 offset, void *dst, u32 size) {
    int attempt;
    for (attempt = 0; attempt < 2; attempt++) {
        if (!sFileOpen) {
            FS_InitFile(&sFile);
            if (!FS_OpenFile(&sFile, sStreamsPath)) return FALSE;
            sFileOpen = TRUE;
            sFileSize = FsLength(&sFile);
        }
        if (offset > sFileSize || size > sFileSize - offset) return FALSE;
        if (!size) return TRUE;
        if (FS_SeekFile(&sFile, (s32)offset, FS_SEEK_SET) && FS_ReadFile(&sFile, dst, (s32)size) == (s32)size)
            return TRUE;
        FS_CloseFile(&sFile);
        sFileOpen = FALSE;
    }
    return FALSE;
}

static BOOL HaveFile(void) {
    if (sFileState == 0) {
        sFileState = Read(0, &sHeader, sizeof(sHeader)) && sHeader.magic == STREAMS_MAGIC && sHeader.version == 1 &&
                             !sHeader.reserved && sHeader.entriesOffset >= sizeof(sHeader) &&
                             !(sHeader.entriesOffset & 3) && sHeader.entriesOffset <= sFileSize &&
                             sHeader.entryCount <= (sFileSize - sHeader.entriesOffset) / sizeof(IndexEntry)
                         ? 1
                         : -1;
    }
    return sFileState > 0;
}

// Binary search of the sorted index in the ROM file (a sprite load reads about log2(entries) entries).
static BOOL FindEntry(u16 arc, u32 sheet, IndexEntry *out) {
    u32 lo = 0, hi, mid;
    IndexEntry e;
    if (!HaveFile()) return FALSE;
    hi = sHeader.entryCount;
    while (lo < hi) {
        mid = (lo + hi) >> 1;
        if (!Read(sHeader.entriesOffset + mid * sizeof(IndexEntry), &e, sizeof(e))) return FALSE;
        if (e.arc == arc && e.sheetFile == sheet) {
            *out = e;
            return TRUE;
        }
        if (e.arc < arc || (e.arc == arc && e.sheetFile < sheet)) lo = mid + 1;
        else hi = mid;
    }
    return FALSE;
}

static void FreeBuffers(Stream *s) {
    if (s->meta) HeapFree(s->meta);
    if (s->lz) HeapFree(s->lz);
    if (s->staging) HeapFree(s->staging);
    s->meta = s->lz = s->staging = NULL;
}

static void Free(Stream *s) {
    u32 i;
    BOOL any = FALSE;
    if (!s->active) return;
    s->active = 0;
    s->still = 0;
    s->pending = 0;
    s->palettePending = 0;
    s->indepPending = 0;
    s->role = 0;
    s->indepBmp = NULL;
    FreeBuffers(s);
    for (i = 0; i < MAX_STREAMS; i++) any |= sStreams[i].active != 0;
    if (!any && sVBlankTask) {
        RemoveUploadTask(sVBlankTask);
        sVBlankTask = NULL;
    }
}

// ---- VBlank upload -----------------------------------------------------------------------------------------
// While an upload runs, texture / palette VRAM is mapped to the CPU and the 3D engine reads nothing from it. The 3D
// engine starts drawing the next frame at about scanline 214, so every upload has to end before then. A TEX4 frame
// costs about 9 scanlines per 96 rows (one call per row). An upload that would not end by UPLOAD_LAST_LINE waits for
// the next VBlank (its sprite's frame shows 1/60 s later).
#define UPLOAD_LAST_LINE 211u
#define VCOUNT() (*(volatile u16 *)0x04000006)

static u32 StreamUploadLines(const Stream *s) {
    return (s->flags & MANI_TEX4) ? s->boxH * 3u / 32u + 1u : s->boxH * A3I5_ROW_BYTES / 4096u + 1u;
}

static void SetA3I5(u8 *spr) {
    *(u32 *)(spr + 0xA8) = GX_TEXSIZE_128;
    *(u32 *)(spr + 0xAC) = GX_TEXSIZE_128;
    *(u32 *)(spr + 0xB0) = GX_TEXFMT_A3I5;
}

static void VBlankUpload(TCB *task, void *unused);

static void EnsureVBlankTask(void) {
    if (!sVBlankTask) sVBlankTask = AddUploadTask(VBlankUpload, NULL, 0);
}

static void VBlankUpload(TCB *task, void *unused) {
    // Native MCSS / particle uploads need to START on lines 192..200. Equal priorities run in insertion order, so a
    // persistent priority-0 task would starve newly queued native uploads: yield and rejoin the end of priority 0
    // (TCB {manager, prev, next, priority, ...}; the manager's list head is at +8).
    u8 *t = (u8 *)task;
    u8 *next = *(u8 **)(t + 8);
    u8 *head = *(u8 **)t + 8;
    BOOL begun = FALSE;
    u32 i, y;
    u16 vcount;
    (void)unused;
    if (next != head && *(u32 *)(next + 12) == 0) {
        RemoveUploadTask(task);
        sVBlankTask = AddUploadTask(VBlankUpload, NULL, 0);
        return;
    }
    vcount = VCOUNT();
    if (vcount < 0xC0 || vcount > 0xC8) return; // like MCSS's own upload: only at the start of VBlank
    for (i = 0; i < MAX_STREAMS; i++) {
        Stream *s = &sStreams[(sUploadCursor + i) % MAX_STREAMS]; // round robin: no sprite waits forever
        u32 tex;
        if (!s->active || !s->pending) continue;
        if (VCOUNT() + StreamUploadLines(s) > UPLOAD_LAST_LINE) continue;
        if (!begun) {
            GX_BeginLoadTex();
            begun = TRUE;
        }
        tex = SYS_TEX_BASE(s->sys) + s->slot * SLOT_TEX_BYTES;
        if (s->flags & MANI_TEX4) {
            // the native 256-texel rows: only the part the sprite's cells show is replaced
            for (y = 0; y < s->boxH; y++) GX_LoadTex(s->staging + y * s->rowBytes, tex + y * NATIVE_ROW_BYTES, s->rowBytes);
        } else {
            GX_LoadTex(s->staging, tex, s->boxH * A3I5_ROW_BYTES);
            if (!s->formatSet) {
                SetA3I5(s->spr);
                s->formatSet = 1;
            }
        }
        s->pending = 0;
    }
    sUploadCursor = (u8)((sUploadCursor + 1) % MAX_STREAMS);
    for (i = 0; i < MAX_STREAMS; i++) { // evolution: the morph renderer's bitmap
        Stream *s = &sStreams[i];
        if (!s->active || !s->indepPending || !s->indepBmp) continue;
        if (VCOUNT() + 0x2000u / 4096u + 1u > UPLOAD_LAST_LINE) continue;
        if (!begun) {
            GX_BeginLoadTex();
            begun = TRUE;
        }
        GX_LoadTex(s->indepBmp, s->indepTex, 0x2000);
        s->indepPending = 0;
    }
    if (begun) GX_EndLoadTex();
    begun = FALSE;
    for (i = 0; i < MAX_STREAMS; i++) {
        Stream *s = &sStreams[i];
        if (!s->active || !s->palettePending) continue;
        if (VCOUNT() + 1u > UPLOAD_LAST_LINE) continue;
        if (!begun) {
            GX_BeginLoadTexPltt();
            begun = TRUE;
        }
        GX_LoadTexPltt(s->palette, SYS_PAL_BASE(s->sys) + s->slot * SLOT_PAL_BYTES, sizeof(s->palette));
        s->palettePending = 0;
    }
    if (begun) GX_EndLoadTexPltt();
}

// ---- frames ------------------------------------------------------------------------------------------------
// Validate the compressed stream without allocating another frame: the native decompressor trusts lengths and
// backreferences.
static BOOL ValidLz(const u8 *bytes, u32 size, u32 expected) {
    u32 input = 4, output = 0, length, bit;
    if (!bytes || size < 4 || (bytes[0] != 0x10 && bytes[0] != 0x11)) return FALSE;
    length = bytes[1] | ((u32)bytes[2] << 8) | ((u32)bytes[3] << 16);
    if (!length && bytes[0] == 0x11) {
        if (size < 8) return FALSE;
        length = bytes[4] | ((u32)bytes[5] << 8) | ((u32)bytes[6] << 16) | ((u32)bytes[7] << 24);
        input = 8;
    }
    if (!expected || expected > SLOT_TEX_BYTES || length != expected) return FALSE;
    while (output < expected) {
        u8 flags;
        if (input >= size) return FALSE;
        flags = bytes[input++];
        for (bit = 0; bit < 8 && output < expected; bit++) {
            u32 a, b, c, d, count, distance;
            if (!(flags & (0x80 >> bit))) {
                if (input >= size) return FALSE;
                input++;
                output++;
                continue;
            }
            if (size - input < 2) return FALSE;
            a = bytes[input++];
            b = bytes[input++];
            if (bytes[0] == 0x10) {
                count = (a >> 4) + 3;
                distance = ((a & 15) << 8 | b) + 1;
            } else if (!(a >> 4)) {
                if (input >= size) return FALSE;
                c = bytes[input++];
                count = ((a & 15) << 4 | b >> 4) + 0x11;
                distance = ((b & 15) << 8 | c) + 1;
            } else if ((a >> 4) == 1) {
                if (size - input < 2) return FALSE;
                c = bytes[input++];
                d = bytes[input++];
                count = ((a & 15) << 12 | b << 4 | c >> 4) + 0x111;
                distance = ((c & 15) << 8 | d) + 1;
            } else {
                count = (a >> 4) + 1;
                distance = ((a & 15) << 8 | b) + 1;
            }
            if (distance > output || count > expected - output) return FALSE;
            output += count;
        }
    }
    return TRUE;
}

static BOOL LoadFrame(Stream *s, u16 u) {
    FrameEntry fe = Frames(s)[u];
    return Read(s->mani + fe.offset, s->lz, fe.size) && ValidLz(s->lz, fe.size, s->boxH * s->rowBytes);
}

// Decompress unique frame `u` into staging and hand it to the next VBlank.
static void Prepare(Stream *s, u16 u) {
    if (!LoadFrame(s, u)) { // keep the last frame
        s->shown = u;
        return;
    }
    MI_UncompressLZ8(s->lz, s->staging);
    DC_FlushRange(s->staging, s->boxH * s->rowBytes);
    s->shown = u;
    s->pending = 1;
}

// MCSS's texture upload task (a VBlank TCB made by LoadMCSSGraphicsData; sprite +0 = its handle) copies its work's
// character data (+0x00 NNSG2dCharacterData: +0x14 pRawData, linear 256-texel 4 bpp rows) and palette (+0x04
// NNSG2dPaletteData: +0x0C pRawData) to the slot's VRAM. Writing frame 0 and the stream's palette there first means
// the carrier's own art never reaches the screen. The work is the pointer in the task whose +0x20 / +0x24 are this
// system / sprite.
static u8 *McssUploadWork(void *sys, u8 *spr) {
    u32 *tcb = (u32 *)SPR_UPLOAD_TASK(spr);
    u32 i;
    if (!tcb || !InMainRam(tcb, 12 * sizeof(u32))) return NULL;
    for (i = 0; i < 12; i++) {
        u8 *w = (u8 *)tcb[i];
        if (InMainRam(w, 0x28) && (((u32)w) & 3) == 0 && *(void **)(w + 0x20) == sys && *(u8 **)(w + 0x24) == spr)
            return w;
    }
    return NULL;
}

static void CopyPaletteToMcss(Stream *s) {
    u32 n = SPR_PALETTE_SIZE(s->spr) < sizeof(s->palette) ? SPR_PALETTE_SIZE(s->spr) : sizeof(s->palette);
    if (SPR_PALETTE_ORIG(s->spr)) Copy16(SPR_PALETTE_ORIG(s->spr), s->palette, n / 2); // its fades start from them
    if (SPR_PALETTE_WORK(s->spr)) Copy16(SPR_PALETTE_WORK(s->spr), s->palette, n / 2);
}

// TEX4: frame 0 goes into the rows of MCSS's 256x128 sheet buffer its cells show. A3I5: that 16 KB buffer is the size
// of the 128x128 A3I5 texture, both with 128-byte rows, so frame 0 is decompressed straight into it (the rows below
// the box cleared: alpha 0) and the proxy switched to A3I5 before MCSS's own upload.
static BOOL Prime(Stream *s) {
    u8 *work = McssUploadWork(s->sys, s->spr);
    u8 *chr = work ? *(u8 **)work : NULL;
    u8 *raw = chr ? *(u8 **)(chr + 0x14) : NULL;
    BOOL tex4 = (s->flags & MANI_TEX4) != 0;
    u16 u;
    u32 x, y, i;
    if (!raw || *(u32 *)(chr + 0x10) < (tex4 ? (u32)(s->boxH - 1) * NATIVE_ROW_BYTES + s->rowBytes : SLOT_TEX_BYTES))
        return FALSE;
    u = Seq(s)[0].unique;
    if (!LoadFrame(s, u)) return FALSE;
    if (tex4) {
        MI_UncompressLZ8(s->lz, s->staging);
        for (y = 0; y < s->boxH; y++) {
            u8 *dst = raw + y * NATIVE_ROW_BYTES;
            const u8 *src = s->staging + y * s->rowBytes;
            for (x = 0; x < s->rowBytes; x++) dst[x] = src[x];
        }
        DC_FlushRange(raw, s->boxH * NATIVE_ROW_BYTES);
    } else {
        MI_UncompressLZ8(s->lz, raw);
        for (i = s->boxH * A3I5_ROW_BYTES; i < SLOT_TEX_BYTES; i++) raw[i] = 0;
        DC_FlushRange(raw, SLOT_TEX_BYTES);
        SetA3I5(s->spr);
        s->formatSet = 1;
    }
    if (s->flags & MANI_OWN_PALETTES) {
        u8 *pal = *(u8 **)(work + 4);
        u16 *palRaw = pal ? *(u16 **)(pal + 0x0C) : NULL;
        if (palRaw) {
            Copy16(palRaw, s->palette, 16);
            DC_FlushRange(palRaw, sizeof(s->palette));
        }
        CopyPaletteToMcss(s);
    }
    s->shown = u;
    return TRUE;
}

static void Register(void *sys, int slot, const IndexEntry *entry, BOOL shiny) {
    Stream *s = NULL;
    ManiHeader h;
    u8 *spr;
    u16 heap;
    u32 i, seqBytes, metaSize, remaining, maxBlob = 0;
    BOOL valid = TRUE;
    FrameEntry *frames;
    for (i = 0; i < MAX_STREAMS; i++)
        if (!sStreams[i].active) {
            s = &sStreams[i];
            break;
        }
    if (!s) return;
    if (!Read(entry->maniOffset, &h, sizeof(h)) || h.magic != MANI_MAGIC || h.version != 2 || (h.flags & ~MANI_FLAGS) ||
        !h.seqCount || !h.uniqueCount || !h.boxH || !h.boxW || h.boxH > 128 ||
        h.boxW > ((h.flags & MANI_TEX4) ? 256 : 128) || ((h.flags & MANI_TEX4) && (h.boxW & 1)) ||
        ((h.flags & MANI_MORPH) && (h.flags & MANI_TEX4)))
        return;
    spr = SYS_SPRITE(sys, slot);
    heap = SPR_HEAP(spr);
    seqBytes = h.seqCount * sizeof(SeqEntry);
    metaSize = seqBytes + h.uniqueCount * sizeof(FrameEntry);
    remaining = sFileSize - entry->maniOffset;
    if (h.seqOffset < sizeof(h) || h.framesOffset < sizeof(h) || h.seqOffset > remaining ||
        seqBytes > remaining - h.seqOffset || h.framesOffset > remaining ||
        metaSize - seqBytes > remaining - h.framesOffset ||
        ((h.flags & MANI_OWN_PALETTES) && (h.paletteOffset > remaining || 64 > remaining - h.paletteOffset)))
        return;
    s->flags = h.flags;
    s->boxW = h.boxW;
    s->boxH = h.boxH;
    s->seqCount = h.seqCount;
    s->uniqueCount = h.uniqueCount;
    s->rowBytes = (h.flags & MANI_TEX4) ? (u16)(h.boxW / 2) : (u16)A3I5_ROW_BYTES;
    s->lz = s->staging = NULL;
    s->meta = (u8 *)HeapAlloc(heap, metaSize, FALSE, "w2anim", __LINE__);
    if (!s->meta) return;
    if (!Read(entry->maniOffset + h.seqOffset, s->meta, seqBytes) ||
        !Read(entry->maniOffset + h.framesOffset, s->meta + seqBytes, h.uniqueCount * sizeof(FrameEntry)))
        valid = FALSE;
    if (valid && (h.flags & MANI_OWN_PALETTES))
        valid = Read(entry->maniOffset + h.paletteOffset + (shiny ? sizeof(s->palette) : 0), s->palette,
                     sizeof(s->palette));
    if (valid && (h.flags & MANI_MORPH)) {
        u32 end = MANI_MORPH_OFFSET + sizeof(MorphBlock);
        valid = h.seqOffset >= end && h.framesOffset >= end &&
                (!(h.flags & MANI_OWN_PALETTES) || h.paletteOffset >= end) &&
                Read(entry->maniOffset + MANI_MORPH_OFFSET, &s->morph, sizeof(s->morph));
        for (i = 0; valid && i < 16; i++) valid = s->morph.map[i] >= 1 && s->morph.map[i] <= 15 && s->morph.source[i] < 16;
    }
    frames = (FrameEntry *)(s->meta + seqBytes);
    for (i = 0; valid && i < h.seqCount; i++) valid = Seq(s)[i].unique < h.uniqueCount && Seq(s)[i].duration != 0;
    for (i = 0; valid && i < h.uniqueCount; i++) {
        valid = frames[i].size >= 4 && frames[i].size <= MAX_FRAME_BLOB && frames[i].offset <= remaining &&
                frames[i].size <= remaining - frames[i].offset;
        if (frames[i].size > maxBlob) maxBlob = frames[i].size;
    }
    if (!valid) {
        FreeBuffers(s);
        return;
    }
    s->sys = sys;
    s->spr = spr;
    s->slot = (u32)slot;
    s->mani = entry->maniOffset;
    s->formatSet = 0;
    s->started = 0;
    s->pending = 0;
    s->palettePending = 0;
    s->role = 0;
    s->indepPending = 0;
    s->indepShown = NO_FRAME;
    s->indepBmp = NULL;
    s->indepTex = 0;
    s->seqPos = 0;
    s->elapsed = 0;
    s->shown = NO_FRAME;
    s->lz = (u8 *)HeapAlloc(heap, (maxBlob + 3) & ~3u, FALSE, "w2anim", __LINE__);
    s->staging = s->lz ? (u8 *)HeapAlloc(heap, h.boxH * s->rowBytes, FALSE, "w2anim", __LINE__) : NULL;
    if (!s->lz || !s->staging) {
        // No room to animate: an A3I5 sprite is still primed (its first frame and colours instead of the carrier's
        // 4 bpp sheet) and kept as a still, without buffers, so the A3I5 format is set again once MCSS's own upload
        // is done (that upload resets the image proxy). A TEX4 sprite shows its carrier sheet (the first frame).
        BOOL still = s->lz && !(h.flags & MANI_TEX4) && Prime(s);
        FreeBuffers(s);
        if (still) {
            s->still = 1;
            s->active = 1;
            EnsureVBlankTask();
        }
        return;
    }
    s->still = 0;
    s->primed = (u8)Prime(s);
    s->active = 1;
    EnsureVBlankTask();
}

// a slot is gone when MCSS no longer lists our sprite there
static BOOL SlotGone(Stream *s) { return s->slot >= SYS_COUNT(s->sys) || SYS_SPRITE(s->sys, s->slot) != s->spr; }

static void Tick(void *sys, BOOL firstFrameOnly) {
    u32 i, guard, pos;
    for (i = 0; i < MAX_STREAMS; i++) {
        Stream *s = &sStreams[i];
        s32 unit;
        if (!s->active || s->sys != sys) continue;
        if (SlotGone(s)) {
            Free(s);
            continue;
        }
        if (s->still) { // primed A3I5 still: the format again after MCSS's upload
            if (!s->started && !SPR_UPLOAD_TASK(s->spr)) {
                s->started = 1;
                SetA3I5(s->spr);
            }
            continue;
        }
        if (s->pending) continue; // previous frame not uploaded yet
        if (!s->started) {
            if (SPR_UPLOAD_TASK(s->spr)) continue; // MCSS is still uploading its own texture
            s->started = 1;
            if (s->primed && !(s->flags & MANI_TEX4)) SetA3I5(s->spr); // in case MCSS's upload reset the proxy
            if (s->primed) continue; // frame 0 and the palette came with MCSS's own upload
            if (s->flags & MANI_OWN_PALETTES) {
                CopyPaletteToMcss(s);
                DC_FlushRange(s->palette, sizeof(s->palette));
                s->palettePending = 1;
            }
            Prepare(s, Seq(s)[0].unique);
            continue;
        }
        if (SPR_ANIM_PAUSED(s->spr) || firstFrameOnly) continue;
        // time in 1/60000 s: one 60 fps tick is 1000 at the normal MCSS speed (fx32 4096); a duration is ms (x 60) or
        // 1/60 s ticks (x 1000)
        unit = (s->flags & MANI_TICKS) ? 1000 : 60;
        s->elapsed += (SPR_ANIM_SPEED(s->spr) * 1000) >> 12;
        pos = s->seqPos;
        for (guard = 0; Seq(s)[pos].duration && s->elapsed >= (s32)Seq(s)[pos].duration * unit && guard < s->seqCount;
             guard++) {
            s->elapsed -= (s32)Seq(s)[pos].duration * unit;
            pos = pos + 1 < s->seqCount ? pos + 1 : 0;
        }
        s->seqPos = pos;
        if (Seq(s)[pos].unique != s->shown) Prepare(s, Seq(s)[pos].unique);
    }
}

#ifdef ANIM_STREAMS_MORPH
// ---- evolution (ov284): the morph renderer -----------------------------------------------------------------
// Its work (+0x58) holds a manager with the two Pokemon (+0x08 before, +0x0C after); each has a GFL bitmap (+0x10 ->
// +0x00: 128x128 4 bpp, 64 bytes a row, high nibble = left pixel) uploaded to texture VRAM +0x14, and a palette (+0x2C
// current 16 colours, faded towards +0x4C at rate +0x56 / 31). A 96x96 TEX4 box is centred (it sits at (16, 16)).
#define EVO_WORK_MORPH 0x58u
#define POKE_BMP 0x10u
#define POKE_TEX 0x14u
#define POKE_PAL 0x2Cu
#define POKE_FADE_COLOR 0x4Cu
#define POKE_FADE_RATE 0x56u
#define MORPH_SIDE 128
#define MORPH_ROW_BYTES (MORPH_SIDE / 2)
#define MORPH_ORIGIN 16
#define MORPH_GROUND_ROW 88

static u16 Fade(u16 c, u16 to, s32 rate) {
    s32 out = 0, sh;
    if (rate <= 0) return c;
    if (rate >= 31) return to;
    for (sh = 0; sh < 15; sh += 5) {
        s32 a = (c >> sh) & 31, b = (to >> sh) & 31;
        out |= ((a + (((b - a) * rate) >> 5)) & 31) << sh;
    }
    return (u16)out;
}

static void MorphUpdate(void *work) {
    static const u8 pokeOffsets[2] = { 0x08, 0x0C };
    u8 *mgr = InMainRam(work, 4) ? *(u8 **)((u8 *)work + EVO_WORK_MORPH) : NULL;
    u32 r, i;
    s32 x, y;
    if (!InMainRam(mgr, 0x10)) return;
    for (r = 0; r < 2; r++) {
        u8 *poke = *(u8 **)(mgr + pokeOffsets[r]);
        Stream *s = NULL;
        BOOL tex4;
        u8 *bmpObj, *bmp;
        for (i = 0; i < MAX_STREAMS; i++) {
            Stream *o = &sStreams[i];
            if (o->active && !o->still && o->role == r + 1 && o->started && o->shown != NO_FRAME) {
                s = o;
                break;
            }
        }
        if (!s || !InMainRam(poke, 0x58)) continue;
        tex4 = (s->flags & MANI_TEX4) != 0;
        if (!tex4 && (s->flags & (MANI_MORPH | MANI_OWN_PALETTES)) != (MANI_MORPH | MANI_OWN_PALETTES)) continue;
        if (s->flags & MANI_OWN_PALETTES) { // the renderer's fade, applied to the stream's palette
            u16 *pal = (u16 *)(poke + POKE_PAL);
            u16 to = *(u16 *)(poke + POKE_FADE_COLOR);
            s32 rate = *(s16 *)(poke + POKE_FADE_RATE);
            for (i = 1; i < 16; i++) pal[i] = Fade(s->palette[tex4 ? i : s->morph.source[i]], to, rate);
        }
        bmpObj = *(u8 **)(poke + POKE_BMP);
        bmp = InMainRam(bmpObj, 4) ? *(u8 **)bmpObj : NULL;
        if (!InMainRam(bmp, MORPH_SIDE * MORPH_ROW_BYTES) || (s->indepShown == s->shown && s->indepBmp == bmp)) continue;
        if (!tex4) {
            // A3I5 (8 bpp, index | alpha << 5) -> the bitmap's 4 bpp through the stream's colour map; the box sits
            // where a 96x96 frame's ground point would be (frame at (16, 16), ground row 88)
            s32 bx = (MORPH_ORIGIN + 48) + s->morph.x0, by = (MORPH_ORIGIN + MORPH_GROUND_ROW) + s->morph.y0;
            for (y = 0; y < MORPH_SIDE; y++) {
                u8 *row = bmp + y * MORPH_ROW_BYTES;
                s32 sy = y - by;
                for (x = 0; x < MORPH_SIDE; x += 2) {
                    u8 pair = 0;
                    s32 k;
                    for (k = 0; k < 2; k++) {
                        s32 sx = x + k - bx;
                        u8 t;
                        if (sy < 0 || sy >= (s32)s->boxH || sx < 0 || sx >= (s32)s->boxW) continue;
                        t = s->staging[sy * A3I5_ROW_BYTES + sx];
                        if (t >> 5) pair |= (u8)(s->morph.map[t & 15] << (k ? 0 : 4)); // high nibble = left pixel
                    }
                    row[x / 2] = pair;
                }
            }
        } else {
            // centred in pixels (odd nibble offsets included), oversized boxes clipped
            s32 originX = (MORPH_SIDE - (s32)s->boxW) / 2, originY = (MORPH_SIDE - (s32)s->boxH) / 2;
            for (y = 0; y < MORPH_SIDE; y++) {
                u8 *row = bmp + y * MORPH_ROW_BYTES;
                s32 sy = y - originY;
                for (x = 0; x < MORPH_ROW_BYTES; x++) {
                    u8 v = 0;
                    s32 pixel;
                    for (pixel = 0; pixel < 2; pixel++) {
                        s32 sx = x * 2 + pixel - originX;
                        if (sy >= 0 && sy < (s32)s->boxH && sx >= 0 && sx < (s32)s->boxW) {
                            u8 packed = s->staging[sy * s->rowBytes + sx / 2];
                            v |= ((packed >> ((sx & 1) * 4)) & 15) << ((1 - pixel) * 4);
                        }
                    }
                    row[x] = v;
                }
            }
        }
        DC_FlushRange(bmp, MORPH_SIDE * MORPH_ROW_BYTES);
        s->indepBmp = bmp;
        s->indepTex = *(u32 *)(poke + POKE_TEX);
        s->indepShown = s->shown;
        s->indepPending = 1;
    }
}

static void TagEvolution(void *spr, u8 role) {
    u32 i;
    for (i = 0; i < MAX_STREAMS; i++)
        if (sStreams[i].active && sStreams[i].spr == spr) sStreams[i].role = role;
}

#endif // ANIM_STREAMS_MORPH

// McssLoad(sys, slot, params): params = {arc, ncbr, nclr, ncer, nanr, nmcr, nmar, ncec, heap flag}.
static void LoadAndRegister(void *sys, int slot, u32 *params) {
    IndexEntry entry;
    BOOL found;
    u32 i;
    for (i = 0; i < MAX_STREAMS; i++)
        if (sStreams[i].active && sStreams[i].sys == sys && sStreams[i].slot == (u32)slot) Free(&sStreams[i]); // reloaded
    found = params[0] <= 0xFFFF && FindEntry((u16)params[0], params[1], &entry);
    if (found && (entry.flags & ENTRY_TRAINER_CARRIER)) {
        u32 b = entry.shinyNclrFile, carrier[9];
        carrier[0] = params[0];
        carrier[1] = b + 1;
        carrier[2] = b + 7;
        carrier[3] = b + 2;
        carrier[4] = b + 3;
        carrier[5] = b + 4;
        carrier[6] = b + 5;
        carrier[7] = b + 6;
        carrier[8] = params[8];
        McssLoad(sys, slot, carrier);
    } else if (found && (entry.flags & ENTRY_CARRIER)) {
        u32 b = entry.shinyNclrFile; // the carrier block's first file: its front set
        u32 carrier[9];
        carrier[0] = ARC_POKEGRA;
        carrier[1] = b + 2;
        carrier[2] = b + 18;
        carrier[3] = b + 4;
        carrier[4] = b + 5;
        carrier[5] = b + 6;
        carrier[6] = b + 7;
        carrier[7] = b + 8;
        carrier[8] = params[8];
        McssLoad(sys, slot, carrier);
    } else {
        McssLoad(sys, slot, params);
    }
    if (found)
        Register(sys, slot, &entry,
                 !(entry.flags & (ENTRY_CARRIER | ENTRY_TRAINER_CARRIER)) && params[2] == entry.shinyNclrFile);
}

// ---- hooks (addresses in hooks.h, from pokebw2's symbols, checked against both games' binaries) ----------------
// The three calls of LoadMCSSGraphicsData (MCSS_Reload, MCSSSys_Add, MCSS_SetMosaic).
void HOOK_LOAD_RELOAD(void *sys, int slot, u32 *params) { LoadAndRegister(sys, slot, params); }
void HOOK_LOAD_ADD(void *sys, int slot, u32 *params) { LoadAndRegister(sys, slot, params); }
void HOOK_LOAD_MOSAIC(void *sys, int slot, u32 *params) { LoadAndRegister(sys, slot, params); }

// MCSSSys_Remove(sys, spr) +0x8: bl McssFreeFiles(spr) - also reached from MCSSSys_Exit.
void HOOK_REMOVE(void *spr) {
    u32 i;
    for (i = 0; i < MAX_STREAMS; i++)
        if (sStreams[i].active && sStreams[i].spr == spr) Free(&sStreams[i]);
    McssFreeFiles(spr);
}

// Every caller of MCSSSys_Update (one per screen that draws MCSS sprites): tick the streams right after MCSS's own
// animations.
#define MCSS_UPDATE_CALLER(name)                                                                                        \
    void name(void *sys) {                                                                                             \
        McssUpdate(sys);                                                                                           \
        Tick(sys, FALSE);                                                                                              \
    }
MCSS_UPDATE_CALLER(HOOK_UPDATE_BATTLE)
MCSS_UPDATE_CALLER(HOOK_UPDATE_TRADE)
MCSS_UPDATE_CALLER(HOOK_UPDATE_SUMMARY)
MCSS_UPDATE_CALLER(HOOK_UPDATE_EVOLUTION)
MCSS_UPDATE_CALLER(HOOK_UPDATE_INTRO)
MCSS_UPDATE_CALLER(HOOK_UPDATE_ZUKAN)
MCSS_UPDATE_CALLER(HOOK_UPDATE_EGG)
void HOOK_UPDATE_HALL_OF_FAME(void *sys) { // Hall of Fame: the first frame only
    McssUpdate(sys);
    Tick(sys, TRUE);
}

#ifdef ANIM_STREAMS_MORPH
// Evolution (ov284): the scene adds the Pokemon before, then after (a loop of two calls), or only the one after.
void *HOOK_EVO_ADD_PAIR(void *sys, const void *pp, int dir, s32 x, s32 y, s32 z) {
    void *spr = McssAddPartyPkm(sys, pp, dir, x, y, z);
    if (sys != sEvoSys) { // a new scene starts with the Pokemon before
        sEvoSys = sys;
        sEvoAdds = 0;
    }
    TagEvolution(spr, (sEvoAdds++ & 1) ? 2 : 1);
    return spr;
}
void *HOOK_EVO_ADD_AFTER(void *sys, const void *pp, int dir, s32 x, s32 y, s32 z) {
    void *spr = McssAddPartyPkm(sys, pp, dir, x, y, z);
    TagEvolution(spr, 2);
    return spr;
}
// The morph renderer's update and draw: the streams' frames and palettes go into its bitmaps after its own update and
// again right before it draws (its fade changes the palette every frame).
void HOOK_EVO_MORPH_UPDATE(void *work) {
    MorphUpdatePieces(work);
    MorphUpdate(work);
}
void HOOK_EVO_MORPH_DRAW(void *work) {
    MorphUpdate(work);
    MorphDrawPieces(work);
}
#endif // ANIM_STREAMS_MORPH
