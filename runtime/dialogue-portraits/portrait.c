#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cutout_tiles.h"

enum {
    MESSAGE_BG = 1,
    PORTRAIT_SLOT = 31,
    BOXED_PALETTE_OFFSET = 8 * 32,
    CUTOUT_PALETTE_OFFSET = 6 * 32,
    BOXED_X = 3,
    BOXED_Y = 13,
    BOXED_TILES = 4,
#ifdef LEADER_COUNT
    CUTOUT_X = LEADER_X,
#else
    CUTOUT_X = 8,
#endif
    // The visible native border begins two pixels into tile row 18.
    CUTOUT_Y = 18 * 8 + 2 - CUTOUT_ROWS * 8,
    CUTOUT_BITMAP_COLUMNS = (CUTOUT_COLUMNS + 3) & ~3,
    CUTOUT_BITMAP_ROWS = (CUTOUT_ROWS + 1) & ~1,
    CUTOUT_SPRITES = (CUTOUT_BITMAP_COLUMNS / 4) * (CUTOUT_BITMAP_ROWS / 2),
    MAIN_SCREEN = 0,
    PORTRAIT_BOXED = 1,
    PORTRAIT_BOXED_BLINK = 2,
    PORTRAIT_CUTOUT = 3,
    PORTRAIT_CUTOUT_MIRRORED = 4,
#ifdef LEADER_COUNT
    PORTRAIT_LEADER_FIRST = 5,
    PORTRAIT_MAX = PORTRAIT_LEADER_FIRST + LEADER_COUNT - 1,
#else
    PORTRAIT_MAX = PORTRAIT_CUTOUT_MIRRORED,
#endif
    TALK_WINDOW_FREE = 0,
    TALK_WINDOW_SHOWN = 4,
};

typedef struct BmpWin BmpWin;
typedef struct Bitmap Bitmap;
typedef struct ArcTool ArcTool;
typedef struct ClActUnit ClActUnit;
typedef struct BmpOamSys BmpOamSys;
typedef struct BmpOamActor BmpOamActor;

typedef struct {
    Bitmap *bitmap;
    int16_t x, y;
    uint32_t palette;
    uint32_t palette_offset;
    uint8_t priority, bg_priority;
    uint16_t surface;
    uint32_t vram_type;
} BmpOamActorSetup;

typedef struct {
    uint16_t state;
    uint8_t skip_animation;
    uint8_t frame_type;
    uint32_t shape;
    void *stream;
    BmpWin *bitmap_window;
    const void *target;
    const void *content;
    uint8_t unused[0x4c];
} TalkWindow;

typedef struct {
    uint8_t setup[0x18];
    TalkWindow windows[32];
} TalkSystem;

typedef struct {
    uint8_t other[0x15c];
    TalkSystem *talk;
} MessageSystem;

typedef struct {
    MessageSystem *messages;
    void *field;
} ScriptFieldWork;

_Static_assert(sizeof(TalkWindow) == 0x64, "White 2 talk window stride");
_Static_assert(offsetof(TalkWindow, bitmap_window) == 0xc, "White 2 bitmap window offset");
_Static_assert(offsetof(MessageSystem, talk) == 0x15c, "White 2 field message system layout");

// These absolute bindings carry their Thumb bit in link.ld. An indirect call
// retains it even though the linker has no native function symbols.
#define NATIVE extern __attribute__((long_call))
NATIVE uint16_t VM_Read16(void *vm);
NATIVE void *FieldScriptEnv_GetScriptWork(void *env);
NATIVE ScriptFieldWork *ScriptWork_GetFieldWork(void *work);
NATIVE BmpWin *BmpWin_CreateDynamic(unsigned bg, unsigned x, unsigned y, unsigned width,
                                    unsigned height, unsigned palette, unsigned from_end);
NATIVE Bitmap *BmpWin_GetBitmap(BmpWin *window);
NATIVE Bitmap *GFL_BitmapCreate(unsigned tile_width, unsigned tile_height, unsigned tile_size, unsigned heap);
NATIVE void GFL_BitmapFree(Bitmap *bitmap);
NATIVE uint8_t *GFL_BitmapGetPixelData(Bitmap *bitmap);
NATIVE void BmpWin_FlushChar(BmpWin *window);
NATIVE void TalkWindow_DrawNormalFrame(TalkSystem *talk, BmpWin *window, unsigned frame_type);
NATIVE void TalkWindow_FreeSlot(TalkSystem *talk, unsigned slot);
NATIVE void GX_LoadBGPltt(const void *source, unsigned offset, unsigned length);
NATIVE void GX_LoadOBJPltt(const void *source, unsigned offset, unsigned length);
NATIVE uint16_t Field_GetHeapID(void *field);
NATIVE ArcTool *GFL_ArcSysCreateMemoryHandle(const void *data, unsigned size, unsigned heap);
NATIVE void GFL_ArcToolFree(ArcTool *arc);
NATIVE uint32_t ClActSys_LoadPltt(ArcTool *arc, unsigned file_id, unsigned vram, unsigned offset, unsigned heap);
NATIVE void ClActSys_FreePltt(uint32_t palette);
NATIVE ClActUnit *ClActUnit_Create(unsigned count, unsigned priority, unsigned heap);
NATIVE void ClActUnit_Delete(ClActUnit *unit);
NATIVE BmpOamSys *BmpOam_Init(unsigned heap, ClActUnit *unit);
NATIVE void BmpOam_Exit(BmpOamSys *system);
NATIVE BmpOamActor *BmpOam_ActorAdd(BmpOamSys *system, const BmpOamActorSetup *setup);
NATIVE void BmpOam_ActorDel(BmpOamActor *actor);
NATIVE void BmpOam_ActorSetDrawEnable(BmpOamActor *actor, int enable);
NATIVE void BmpOam_ActorBmpTrans(BmpOamActor *actor);

#ifdef CUTOUT_256
typedef struct ClActor ClActor;
typedef struct {
    int16_t x, y;
    uint16_t sequence;
    uint8_t priority, bg_priority;
} ClActorSetup;
NATIVE ArcTool *GFL_ArcSysCreateFileHandle(unsigned archive, unsigned heap);
NATIVE uint32_t ClActSys_LoadChars(ArcTool *arc, unsigned file, int compressed, unsigned screen, unsigned heap);
NATIVE uint32_t ClActSys_GetCharVramAddr(unsigned chars, unsigned screen);
NATIVE void ClActSys_FreeChars(unsigned chars);
NATIVE uint32_t ClActSys_LoadCellAnims(ArcTool *arc, unsigned cells, unsigned anim, unsigned heap);
NATIVE void ClActSys_FreeCellAnims(unsigned cells);
NATIVE ClActor *ClActor_Create(ClActUnit *unit, unsigned chars, unsigned palette, unsigned cells,
                              const ClActorSetup *setup, unsigned screen, unsigned heap);
NATIVE void ClActor_Delete(ClActor *actor);
NATIVE void ClActor_SetFlip(ClActor *actor, unsigned axis, int flip);
NATIVE unsigned GX_GetBankForOBJExtPltt(void);
NATIVE unsigned GX_GetBankForLCDC(void);
NATIVE void GX_SetBankForOBJExtPltt(unsigned banks);
NATIVE unsigned GX_ResetBankForOBJExtPltt(void);
NATIVE unsigned GX_DisableBankForOBJExtPltt(void);
#endif

#define RGB15(r, g, b) ((r) | ((g) << 5) | ((b) << 10))
static const uint16_t boxed_palette[16] = {
    0, RGB15(26, 28, 29), RGB15(7, 7, 7), RGB15(9, 9, 9),
    RGB15(14, 14, 14), RGB15(23, 23, 23), RGB15(26, 25, 25), RGB15(28, 27, 27),
    RGB15(31, 31, 31), RGB15(16, 20, 15), RGB15(22, 27, 20), RGB15(9, 14, 13),
    RGB15(30, 28, 26), RGB15(28, 23, 22), RGB15(22, 16, 16), RGB15(14, 21, 11),
};

// N's headshot from the supplied sheet, fitted to the 32px window and
// indexed to its 4bpp palette. The second variant closes his eyes.
static const char art[32][33] = {
    "11111111111112222211111111111111",
    "11111111111223333322111111111111",
    "11111111122333333333221111111111",
    "11111112332276666662233211111111",
    "11111123227776666666622321111111",
    "11111123667776666666666321111111",
    "11111123667776666666666321111111",
    "11111123667776666666666321111111",
    "11111122666772222266666221111111",
    "11111122666223333322666221111111",
    "11111122622333333333226221111111",
    "11111122233333333333332221111111",
    "11111122233333333333332221111111",
    "11111122222229999B22222221111111",
    "11122299222BE9AA9BBB222992221111",
    "221999999BBBBAAABEBBBB9999991221",
    "2A229BAAB333E9AAABE333BAAB922A21",
    "2AAABAAAB35AF9A9A9AF53BAAABAAA21",
    "12AABA9ADE7FB99D9ABF7EDA9ABAA211",
    "112AAAAADDE33CCCCD33EDDAAAAA2111",
    "111AAAB92DDDCCCDCCCDDD29BAAA1111",
    "1112BB992EDCCCCCCCCCDD299BB21111",
    "1111299BB2DCCCCCCCCCD2BB99211111",
    "1111229B992CCCEEECCC299B92211111",
    "1111112B99B92ECCCE29B99B21111111",
    "111111129B99B2EEE2B99B9211111111",
    "111111129B2482EEE2842B9211111111",
    "11111111925882222288529111111111",
    "11111111924582333285429111111111",
    "11111111288888828888882111111111",
    "11111111888885888588888111111111",
    "11111111888888585888888111111111",
};

typedef struct {
    TalkSystem *owner;
#ifdef CUTOUT_256
    uint32_t chars, cells;
    ClActUnit *unit;
    ClActor *actor;
    bool was_lcdc;
    uint16_t saved_extended[256];
#else
    Bitmap *bitmap;
    ClActUnit *unit;
    BmpOamSys *system;
    BmpOamActor *actor;
#endif
    uint32_t palette;
} Cutout;

typedef struct {
    uint32_t magic;
    uint32_t requested;
    uint32_t applied;
    uint32_t changes;
    uint32_t panel;
    uint32_t result;
    uint16_t saved_palette[16];
    Cutout cutout;
} PortraitState;

PortraitState portrait_state = {.magic = 0x54525057}; // WPRT

static unsigned boxed_pixel(unsigned x, unsigned y, bool blink) {
    if (blink && ((x >= 10 && x <= 12) || (x >= 18 && x <= 20))) {
        if (y == 17) return 13;
        if (y == 18) return x == 10 || x == 20 ? 13 : 3;
        if (y == 19) return 12;
    }
    unsigned color = (unsigned char)art[y][x];
    return color >= 'A' ? color - 'A' + 10 : color - '0';
}

static void draw_boxed(BmpWin *window, bool blink) {
    uint8_t *tiles = GFL_BitmapGetPixelData(BmpWin_GetBitmap(window));
    for (unsigned y = 0; y < 32; ++y) {
        for (unsigned x = 0; x < 32; x += 2) {
            unsigned tile = (y / 8) * BOXED_TILES + x / 8;
            unsigned byte = (y % 8) * 4 + (x % 8) / 2;
            tiles[tile * 32 + byte] = boxed_pixel(x, y, blink) | (boxed_pixel(x + 1, y, blink) << 4);
        }
    }
    BmpWin_FlushChar(window);
}

static void save_palette(uintptr_t address) {
    const volatile uint16_t *palette = (const volatile uint16_t *)address;
    for (unsigned i = 0; i < 16; ++i) portrait_state.saved_palette[i] = palette[i];
}

#ifdef CUTOUT_256
enum { BANK_F = 1 << 5, SPRITE_ARCHIVE = 50, CHARS = 9, ANIMATION = 4 };
#define BANK_F_CONTROL (*(volatile uint8_t *)0x04000245)
#define BANK_F_LCDC ((volatile uint16_t *)0x06890000)

static void release_bank(Cutout *cutout) {
    GX_ResetBankForOBJExtPltt();
    for (unsigned i = 0; i < 256; ++i) BANK_F_LCDC[i] = cutout->saved_extended[i];
    if (!cutout->was_lcdc) {
        GX_SetBankForOBJExtPltt(BANK_F);
        GX_DisableBankForOBJExtPltt();
    }
}

static bool acquire_cutout(Cutout *cutout, TalkSystem *talk, unsigned heap, unsigned id) {
    unsigned member = CHARS;
#ifdef LEADER_COUNT
    member += (id - PORTRAIT_LEADER_FIRST) * 3;
#else
    (void)id;
#endif
    // Bind only the unused F bank in this field configuration. Keep the normal
    // OBJ palette live, including the field's 4bpp UI sprites.
    cutout->was_lcdc = (GX_GetBankForLCDC() & BANK_F) != 0;
    if (GX_GetBankForOBJExtPltt() || BANK_F_CONTROL != (cutout->was_lcdc ? 0x80 : 0)) return false;
    ArcTool *arc = GFL_ArcSysCreateFileHandle(SPRITE_ARCHIVE, heap);
    if (!arc) return false;
    cutout->chars = ClActSys_LoadChars(arc, member, false, MAIN_SCREEN, heap);
    if (cutout->chars == UINT32_MAX) goto fail_arc;
    if (ClActSys_GetCharVramAddr(cutout->chars, MAIN_SCREEN) == UINT32_MAX) goto fail_chars;
    GX_SetBankForOBJExtPltt(BANK_F);
    GX_ResetBankForOBJExtPltt();
    for (unsigned i = 0; i < 256; ++i) cutout->saved_extended[i] = BANK_F_LCDC[i];
    GX_SetBankForOBJExtPltt(BANK_F);
    cutout->palette = ClActSys_LoadPltt(arc, member + 1, MAIN_SCREEN, 0x200, heap);
    if (cutout->palette == UINT32_MAX) goto fail_bank;
    cutout->cells = ClActSys_LoadCellAnims(arc, member + 2, ANIMATION, heap);
    if (cutout->cells == UINT32_MAX) goto fail_palette;
    cutout->unit = ClActUnit_Create(1, 0, heap);
    static const ClActorSetup setup = {CUTOUT_X + CUTOUT_COLUMNS * 4, CUTOUT_Y + CUTOUT_ROWS * 4, 0, 0, 0};
    cutout->actor = ClActor_Create(cutout->unit, cutout->chars, cutout->palette, cutout->cells,
                                  &setup, MAIN_SCREEN, heap);
    if (!cutout->actor) {
        ClActUnit_Delete(cutout->unit);
        ClActSys_FreeCellAnims(cutout->cells);
        goto fail_palette;
    }
    GFL_ArcToolFree(arc);
    cutout->owner = talk;
    return true;

fail_palette:
    ClActSys_FreePltt(cutout->palette);
fail_bank:
    release_bank(cutout);
fail_chars:
    ClActSys_FreeChars(cutout->chars);
fail_arc:
    GFL_ArcToolFree(arc);
    return false;
}

static void draw_cutout(Cutout *cutout, bool mirrored) {
    ClActor_SetFlip(cutout->actor, 1, mirrored);
}

static void release_cutout(Cutout *cutout) {
    ClActor_Delete(cutout->actor);
    ClActUnit_Delete(cutout->unit);
    ClActSys_FreeCellAnims(cutout->cells);
    ClActSys_FreeChars(cutout->chars);
    ClActSys_FreePltt(cutout->palette);
    release_bank(cutout);
    cutout->owner = NULL;
}
#else
static void draw_cutout(Cutout *cutout, bool mirrored) {
    uint8_t *dest = GFL_BitmapGetPixelData(cutout->bitmap);
    for (unsigned y = 0; y < CUTOUT_BITMAP_ROWS; ++y) {
        for (unsigned x = 0; x < CUTOUT_BITMAP_COLUMNS; ++x) {
            unsigned tile = 0;
            if (x < CUTOUT_COLUMNS && y < CUTOUT_ROWS) {
                unsigned source_x = mirrored ? CUTOUT_COLUMNS - 1 - x : x;
                tile = cutout_map[y * CUTOUT_COLUMNS + source_x];
            }
            const uint8_t *source = cutout_tiles + tile * 32;
            for (unsigned b = 0; b < 32; ++b) {
                unsigned byte = source[mirrored ? b ^ 3 : b];
                *dest++ = mirrored ? (byte >> 4) | (byte << 4) : byte;
            }
        }
    }
    BmpOam_ActorBmpTrans(cutout->actor);
}

static bool acquire_cutout(Cutout *cutout, TalkSystem *talk, unsigned heap, unsigned id) {
    (void)id;
    save_palette(0x05000200 + CUTOUT_PALETTE_OFFSET);
    ArcTool *arc = GFL_ArcSysCreateMemoryHandle(cutout_palette_archive, sizeof(cutout_palette_archive), heap);
    cutout->palette = ClActSys_LoadPltt(arc, 0, MAIN_SCREEN, CUTOUT_PALETTE_OFFSET, heap);
    GFL_ArcToolFree(arc);
    if (cutout->palette == UINT32_MAX) return false;

    cutout->bitmap = GFL_BitmapCreate(CUTOUT_BITMAP_COLUMNS, CUTOUT_BITMAP_ROWS, 32, heap);
    cutout->unit = ClActUnit_Create(CUTOUT_SPRITES, 0, heap);
    cutout->system = BmpOam_Init(heap, cutout->unit);
    BmpOamActorSetup setup;
    setup.bitmap = cutout->bitmap;
    setup.x = CUTOUT_X;
    setup.y = CUTOUT_Y;
    setup.palette = cutout->palette;
    setup.palette_offset = 0;
    setup.priority = 0;
    setup.bg_priority = 0;
    setup.surface = MAIN_SCREEN;
    setup.vram_type = MAIN_SCREEN;
    cutout->actor = BmpOam_ActorAdd(cutout->system, &setup);
    cutout->owner = talk;
    return true;
}

static void release_cutout(Cutout *cutout) {
    BmpOam_ActorDel(cutout->actor);
    BmpOam_Exit(cutout->system);
    ClActUnit_Delete(cutout->unit);
    GFL_BitmapFree(cutout->bitmap);
    ClActSys_FreePltt(cutout->palette);
    GX_LoadOBJPltt(portrait_state.saved_palette, CUTOUT_PALETTE_OFFSET, sizeof(portrait_state.saved_palette));
    cutout->owner = NULL;
}

#endif

static void release_boxed(TalkSystem *talk, TalkWindow *slot) {
    TalkWindow_FreeSlot(talk, PORTRAIT_SLOT);
    slot->content = NULL;
    GX_LoadBGPltt(portrait_state.saved_palette, BOXED_PALETTE_OFFSET, sizeof(boxed_palette));
}

// Aspertia plug-in command. Zero clears, 1–2 select a boxed headshot,
// and 3–4 select the original cutout and its mirrored pose. The lineup
// build uses IDs 5–12 for its separate right-aligned portraits.
// Boxed art uses the talk bitmap. The cutout uses the field's sprite engine.
int ScriptCommand_SetPortrait(void *vm, void *env) {
    unsigned id = VM_Read16(vm);
    portrait_state.requested = id;
    portrait_state.result = 0;
    if (id > PORTRAIT_MAX) return 0;
#ifdef LEADER_COUNT
    if (id == PORTRAIT_CUTOUT || id == PORTRAIT_CUTOUT_MIRRORED) return 0;
#endif

    ScriptFieldWork *work = ScriptWork_GetFieldWork(FieldScriptEnv_GetScriptWork(env));
    if (work == NULL || work->messages == NULL || work->messages->talk == NULL) return 0;

    TalkSystem *talk = work->messages->talk;
    TalkWindow *slot = &talk->windows[PORTRAIT_SLOT];
    Cutout *cutout = &portrait_state.cutout;
    bool has_boxed = slot->state == TALK_WINDOW_SHOWN && slot->content == &portrait_state;
    bool has_cutout = cutout->owner == talk;
    bool show_boxed = id == PORTRAIT_BOXED || id == PORTRAIT_BOXED_BLINK;
    bool show_cutout = id >= PORTRAIT_CUTOUT;

    if (has_boxed && !show_boxed) release_boxed(talk, slot);
#ifdef LEADER_COUNT
    if (has_cutout && id != portrait_state.applied) {
        release_cutout(cutout);
        has_cutout = false;
    }
#else
    if (has_cutout && !show_cutout) release_cutout(cutout);
#endif
    portrait_state.applied = 0;
    portrait_state.panel = 0;

    if (show_boxed) {
        if (!has_boxed) {
            if (slot->state != TALK_WINDOW_FREE) return 0;
            BmpWin *window = BmpWin_CreateDynamic(MESSAGE_BG, BOXED_X, BOXED_Y, BOXED_TILES, BOXED_TILES,
                                                  BOXED_PALETTE_OFFSET / 32, 1);
            if (window == NULL) return 0;
            save_palette(0x05000000 + BOXED_PALETTE_OFFSET);
            GX_LoadBGPltt(boxed_palette, BOXED_PALETTE_OFFSET, sizeof(boxed_palette));
            slot->skip_animation = true;
            slot->stream = NULL;
            slot->bitmap_window = window;
            slot->content = &portrait_state;
            slot->state = TALK_WINDOW_SHOWN;
        }
        draw_boxed(slot->bitmap_window, id == PORTRAIT_BOXED_BLINK);
        if (!has_boxed) TalkWindow_DrawNormalFrame(talk, slot->bitmap_window, 0);
        portrait_state.panel = (uintptr_t)slot->bitmap_window;
    } else if (show_cutout) {
        if (!has_cutout && (work->field == NULL || !acquire_cutout(cutout, talk, Field_GetHeapID(work->field), id))) return 0;
        draw_cutout(cutout, id == PORTRAIT_CUTOUT_MIRRORED);
#ifndef CUTOUT_256
        if (!has_cutout) BmpOam_ActorSetDrawEnable(cutout->actor, true);
#endif
        portrait_state.panel = (uintptr_t)cutout->actor;
    }

    portrait_state.applied = id;
    ++portrait_state.changes;
    portrait_state.result = 1;
    return 0;
}
