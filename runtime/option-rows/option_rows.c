#include <stdint.h>
#include "option_rows_addr.h"

/* Extra On/Off rows for the retail Options screen (US Black, White, Black 2 and
 * White 2). Pokeweb writes the row table below when it installs a feature that
 * owns a row (Autorun, and Following Pokemon on Black 2 / White 2).
 *
 * Each row stores "Off" in one reserved CONFIG bit, so existing saves start
 * with every row on. The native list keeps its five rows; this sidecar draws
 * the extra rows below them with the fifth row's art, two native-style choice
 * markers, and its own windows. With two extra rows the list scrolls by one
 * row so the seventh row is not hidden under the button bar.
 *
 * Virtual cursor: 0-4 native rows, 5..5+n-1 extra rows, then Confirm, Quit.
 * The native cursor keeps its own meaning (5 Confirm, 6 Quit); the extra rows
 * borrow the Confirm ordinal and the bar's cursor query is answered here. */

#define CALL(address, type) ((type)(uintptr_t)(address))
#define PTR(base, offset) (*(void **)((uint8_t *)(base) + (offset)))
#define U32(base, offset) (*(uint32_t *)((uint8_t *)(base) + (offset)))

enum { OPT_HEAP = 28, NATIVE_ROWS = 5, MAX_ROWS = 2, SE_CURSOR = 0x548, ROWS_TOP = 24, ROWS_BOTTOM = 168 };
enum { INPUT_NONE, INPUT_SLIDE, INPUT_FLICK, INPUT_TOUCH, INPUT_UP, INPUT_DOWN, INPUT_RIGHT, INPUT_LEFT,
       INPUT_DECIDE, INPUT_CANCEL, INPUT_CONT_UP, INPUT_CONT_DOWN, INPUT_Y, INPUT_X, INPUT_KEY };
enum { GATE_ALWAYS = 0, GATE_FOLLOWING = 1 };

typedef struct { int32_t x, y; } OptPoint;
typedef struct { int16_t x, y; } OptPos;
typedef struct { int32_t input; OptPoint touch; } OptUi;
typedef struct { uint16_t font, back; int32_t select; void *items[11]; int32_t objectY; uint32_t repeat; } OptScroll;
typedef struct { int16_t x, y; uint16_t sequence; uint8_t softPriority, bgPriority; } OptClData;

/* One row: CONFIG bit that means Off, visibility gate, and Options text IDs. */
typedef struct { uint16_t bit, gate, label, on, off, help; } RowDef;
typedef struct { uint32_t magic, version, count; RowDef rows[MAX_ROWS]; } RowTable;

/* "PWOR" table, configured by Pokeweb in the DLL image. */
__attribute__((used)) volatile RowTable PokewebOptionRows = { .magic = 0x524f5750u, .version = 1u, .count = 0u };

typedef struct {
    void *windows[3], *markers[2];
    RowDef def;
    uint8_t staged, original;
} Row;

static struct {
    OptScroll *scroll;
    uint16_t *config;
    Row rows[MAX_ROWS];
    uint8_t count, active, vr, shownRow, shownFocus, touchMode, scrolled;
    uint8_t shownValue[MAX_ROWS];
    int32_t markerBase;
} st;

static const uint8_t windowGeometry[3][3] = { { 1, 12, 2 }, { 15, 6, 2 }, { 24, 7, 2 } };

static unsigned row_of(unsigned virtualRow) { return virtualRow - NATIVE_ROWS; }
static int is_row(unsigned virtualRow) { return virtualRow >= NATIVE_ROWS && virtualRow < (unsigned)NATIVE_ROWS + st.count; }
static unsigned confirm_row(void) { return NATIVE_ROWS + st.count; }
static unsigned quit_row(void) { return NATIVE_ROWS + st.count + 1; }

#ifdef OR_FS_OPEN
static int following_enabled(void) {
    uint32_t file[32], header[8];
    CALL(OR_FS_INIT, void (*)(void *))(file);
    if (!CALL(OR_FS_OPEN, int (*)(void *, const char *))(file, "rom:/following/native.bin")) return 0;
    unsigned size = CALL(OR_FS_LENGTH, unsigned (*)(void *))(file);
    int ok = size == sizeof(header) && CALL(OR_FS_READ, unsigned (*)(void *, void *, unsigned))(file, header, sizeof(header)) == sizeof(header);
    CALL(OR_FS_CLOSE, int (*)(void *))(file);
    return ok && header[0] == 0x544e5746u && header[1] == 1u;
}
#else
static int following_enabled(void) { return 0; }
#endif

static void destroy_sidecar(void) {
    for (unsigned r = 0; r < MAX_ROWS; ++r) {
        Row *row = &st.rows[r];
        for (unsigned i = 0; i < 2; ++i) if (row->markers[i]) { CALL(OR_ACTOR_DELETE, void (*)(void *))(row->markers[i]); row->markers[i] = 0; }
        for (unsigned i = 0; i < 3; ++i) if (row->windows[i]) { CALL(OR_WINDOW_FREE, void (*)(void *))(row->windows[i]); row->windows[i] = 0; }
    }
    st.active = 0; st.count = 0; st.scroll = 0; st.config = 0; st.scrolled = 0;
}

static void print_window(void *window, void *font, void *message, unsigned id) {
    void *str = CALL(OR_MSG_LOAD, void *(*)(void *, unsigned))(message, id);
    if (!str) return;
    void *bitmap = CALL(OR_WINDOW_BITMAP, void *(*)(void *))(window);
    CALL(OR_BITMAP_FILL, void (*)(void *, unsigned))(bitmap, 0);
    CALL(OR_TEXT_DRAW, void (*)(void *, int, int, void *, void *))(bitmap, 0, 0, str, font);
    CALL(OR_WINDOW_FLUSH_CHAR, void (*)(void *))(window);
    CALL(OR_WINDOW_FLUSH_MAP, void (*)(void *))(window);
    unsigned frame = CALL(OR_WINDOW_BG, unsigned (*)(void *))(window);
    CALL(OR_BG_QUEUE, void (*)(unsigned))(frame);
    CALL(OR_STRBUF_FREE, void (*)(void *))(str);
}

static void palette_region(unsigned frame, unsigned x, unsigned y, unsigned w, unsigned h, unsigned palette) {
    CALL(OR_BG_PALETTE, void (*)(unsigned, unsigned, unsigned, unsigned, unsigned, unsigned))(frame, x, y, w, h, palette);
}

static uint16_t *background_tiles(const OptScroll *s) {
    return CALL(OR_BG_BUFFER, uint16_t *(*)(unsigned))(s->back);
}

static int scroll_rows(const OptScroll *s) {
    int top = CALL(OR_BG_OFFSET_Y, int (*)(unsigned))(s->back) + 20, rows = 0;
    while (top >= 24) { top -= 24; ++rows; }
    return rows;
}

static __attribute__((noinline)) void extend_background(OptScroll *s) {
    /* Reuse the fifth row's complete tile art (fill, bevel, border). */
    uint16_t *tiles = background_tiles(s);
    if (!tiles) return;
    for (unsigned r = 0; r < st.count; ++r)
        for (unsigned y = 0; y < 3; ++y)
            for (unsigned x = 0; x < 32; ++x)
                tiles[(17 + 3 * r + y) * 32 + x] = tiles[(14 + y) * 32 + x];
    CALL(OR_BG_QUEUE, void (*)(unsigned))(s->back);
}

static __attribute__((noinline)) void restyle_background(OptScroll *s) {
    /* The retail palette pass stops after five rows. */
    static const uint8_t bright[5] = { 3, 1, 0, 1, 3 };
    uint16_t *tiles = background_tiles(s);
    if (!tiles) return;
    int first = scroll_rows(s), changed = 0;
    for (unsigned r = 0; r < st.count; ++r) {
        int visible = NATIVE_ROWS + (int)r - first;
        if (visible < 0) visible = 0;
        if (visible > 4) visible = 4;
        unsigned focused = st.vr == NATIVE_ROWS + r && !st.touchMode;
        unsigned palette = focused ? 7u : bright[visible];
        unsigned y = 17 + 3 * r;
        if ((tiles[y * 32] >> 12) != palette) { palette_region(s->back, 0, y, 32, 3, palette); changed = 1; }
    }
    if (changed) CALL(OR_BG_QUEUE, void (*)(unsigned))(s->back);
}

static void restyle(OptScroll *s) {
    for (unsigned r = 0; r < st.count; ++r) {
        Row *row = &st.rows[r];
        unsigned focused = st.vr == NATIVE_ROWS + r && !st.touchMode;
        unsigned label = focused ? 7u : 0u, selected = focused ? 7u : 0u, other = focused ? 12u : 3u, y = 20 + 3 * r;
        palette_region(s->font, 1, y, 12, 2, label);
        palette_region(s->font, 15, y, 6, 2, row->staged ? other : selected);
        palette_region(s->font, 24, y, 7, 2, row->staged ? selected : other);
        for (unsigned i = 0; i < 2; ++i) if (row->markers[i]) {
            unsigned checked = i == row->staged;
            CALL(OR_ACTOR_SEQUENCE, void (*)(void *, unsigned))(row->markers[i], focused ? (checked ? 3u : 2u) : (checked ? 0u : 1u));
        }
    }
    CALL(OR_BG_QUEUE, void (*)(unsigned))(s->font);
}

static void place_markers(const OptScroll *s) {
    for (unsigned r = 0; r < st.count; ++r)
        for (unsigned i = 0; i < 2; ++i) if (st.rows[r].markers[i]) {
            OptPos position = { (int16_t)(i ? 192 : 120), (int16_t)(120 + 24 * (int)r + s->objectY) };
            CALL(OR_ACTOR_POS, void (*)(void *, const void *, unsigned))(st.rows[r].markers[i], &position, 0);
        }
}

static void draw_help(void *message, unsigned r) {
    /* The native message window prints the help line with its own font and timing. */
    CALL(OR_BG_ENABLE, void (*)(unsigned, int))(4u, 1);
    CALL(OR_MSG_PRINT, void (*)(void *, unsigned, int, int))(message, st.rows[r].def.help, 0, 0);
}

static void set_scrolled(OptScroll *s, uint8_t scrolled) {
    if (st.count < 2 || st.scrolled == scrolled) return;
    CALL(OR_SCROLL_MOVE, void (*)(void *, int, int, int))(s, scrolled ? 24 : -24, -192, 192);
    st.scrolled = scrolled;
}

void OptionRowsInit(OptScroll *s, unsigned font, unsigned back, void *graphic, const void *pre, unsigned heap) {
    destroy_sidecar();
    CALL(OR_SCROLL_INIT, void (*)(void *, unsigned, unsigned, void *, const void *, unsigned))(s, font, back, graphic, pre, heap);
    void *config = PTR(pre, 8);
    if (!config || PokewebOptionRows.version != 1u) return;
    unsigned count = PokewebOptionRows.count > MAX_ROWS ? MAX_ROWS : PokewebOptionRows.count;
    for (unsigned i = 0; i < count; ++i) {
        RowDef def = { PokewebOptionRows.rows[i].bit, PokewebOptionRows.rows[i].gate, PokewebOptionRows.rows[i].label,
                       PokewebOptionRows.rows[i].on, PokewebOptionRows.rows[i].off, PokewebOptionRows.rows[i].help };
        if (def.bit < 11 || def.bit > 15) continue;
        if (def.gate == GATE_FOLLOWING && !following_enabled()) continue;
        if (def.gate != GATE_ALWAYS && def.gate != GATE_FOLLOWING) continue;
        Row *row = &st.rows[st.count++];
        row->def = def;
        row->original = row->staged = !!(*(uint16_t *)config & (1u << def.bit));
    }
    if (!st.count) return;
    st.scroll = s; st.config = config;
    uint8_t *work = graphic;
    void *textFont = PTR(work, 0x254), *messages = PTR(work, 0x25c);
    uint8_t *obj = work + 0x7c;
    for (unsigned r = 0; r < st.count; ++r) {
        Row *row = &st.rows[r];
        const unsigned ids[3] = { row->def.label, row->def.on, row->def.off };
        for (unsigned i = 0; i < 3; ++i) {
            row->windows[i] = CALL(OR_WINDOW_CREATE, void *(*)(unsigned, unsigned, unsigned, unsigned, unsigned, unsigned, unsigned))
                (font, windowGeometry[i][0], 20 + 3 * r, windowGeometry[i][1], windowGeometry[i][2], 0, 1);
            if (!row->windows[i]) { destroy_sidecar(); return; }
            print_window(row->windows[i], textFont, messages, ids[i]);
        }
        for (unsigned i = 0; i < 2; ++i) {
            OptClData data = { (int16_t)(i ? 192 : 120), (int16_t)(120 + 24 * (int)r + s->objectY), 0, 2, 2 };
            row->markers[i] = CALL(OR_ACTOR_CREATE, void *(*)(void *, unsigned, unsigned, unsigned, const OptClData *, unsigned, unsigned))
                (PTR(obj, 0), U32(obj, 8), U32(obj, 4), U32(obj, 12), &data, 0, OPT_HEAP);
            if (!row->markers[i]) { destroy_sidecar(); return; }
            CALL(OR_ACTOR_AUTOANIM, void (*)(void *, int))(row->markers[i], 0);
        }
    }
    extend_background(s);
    st.active = 1;
    st.vr = s->select < 0 ? 0 : (uint8_t)s->select;
    st.touchMode = s->select < 0;
    st.shownRow = 255; st.shownFocus = 255; st.markerBase = s->objectY;
    for (unsigned r = 0; r < MAX_ROWS; ++r) st.shownValue[r] = 255;
    restyle_background(s);
    restyle(s);
}

void OptionRowsExit(OptScroll *s) {
    if (st.scroll == s) destroy_sidecar();
    CALL(OR_SCROLL_EXIT, void (*)(void *))(s);
}

void OptionRowsMain(OptScroll *s, OptUi *ui, void *message, void *graphic, void *appbar) {
    if (!st.active || st.scroll != s) {
        CALL(OR_SCROLL_MAIN, void (*)(void *, void *, void *, void *, void *))(s, ui, message, graphic, appbar);
        return;
    }
    unsigned input = (unsigned)ui->input, old = st.vr, confirm = confirm_row(), quit = quit_row();
    int target = -1, ours = 0;
    if (input == INPUT_TOUCH || input == INPUT_SLIDE || input == INPUT_FLICK) st.touchMode = 1;
    else if (input == INPUT_KEY || input == INPUT_UP || input == INPUT_DOWN || input == INPUT_RIGHT ||
             input == INPUT_LEFT || input == INPUT_CONT_UP || input == INPUT_CONT_DOWN) st.touchMode = 0;
    if (is_row(old) && (input == INPUT_LEFT || input == INPUT_RIGHT)) {
        Row *row = &st.rows[row_of(old)];
        uint8_t next = input == INPUT_RIGHT ? 1 : 0;
        if (row->staged != next) { row->staged = next; CALL(OR_SE_PLAY, void (*)(unsigned))(SE_CURSOR); }
        ui->input = INPUT_NONE;
    } else if (is_row(old) && (input == INPUT_DOWN || input == INPUT_CONT_DOWN) && old + 1 < confirm) {
        ours = 1; target = (int)old + 1;
    } else if (is_row(old) && (input == INPUT_UP || input == INPUT_CONT_UP) && old > NATIVE_ROWS) {
        ours = 1; target = (int)old - 1;
    }
    if (ours) {
        /* Moves between two extra rows have no native equivalent. */
        ui->input = INPUT_NONE;
        if ((input == INPUT_CONT_UP || input == INPUT_CONT_DOWN) && s->repeat++ < 10) target = -1;
        else { s->repeat = 0; CALL(OR_SE_PLAY, void (*)(unsigned))(SE_CURSOR); }
    }
    /* Native cursor for this frame: Confirm stands in for the extra rows. */
    if (old == quit) s->select = 6;
    else if (old == confirm && (input == INPUT_UP || input == INPUT_CONT_UP)) s->select = 6;
    else if (is_row(old) || old == confirm) s->select = 5;
    CALL(OR_SCROLL_MAIN, void (*)(void *, void *, void *, void *, void *))(s, ui, message, graphic, appbar);
    ui->input = (int32_t)input;
    if (ours) {
        if (target >= 0) st.vr = (uint8_t)target;
    } else if (s->select >= 0 && s->select < NATIVE_ROWS) {
        st.vr = (uint8_t)s->select;
    } else if (s->select == 6) {
        st.vr = (uint8_t)(is_row(old) ? confirm : old == confirm && input == INPUT_CONT_UP ? confirm : quit);
    } else if (s->select == 5) {
        st.vr = (uint8_t)(old == quit ? confirm
            : old == confirm ? (input != INPUT_UP && input != INPUT_CONT_UP ? confirm : confirm - 1)
            : is_row(old) ? old : NATIVE_ROWS);
    }
    /* Touching an extra row picks it and, between the markers, its value. */
    if (input == INPUT_TOUCH) {
        for (unsigned r = 0; r < st.count; ++r) {
            /* Rows are 24 pixels tall from the marker's y; only touch rows fully above the button bar. */
            int top = 120 + 24 * (int)r + s->objectY;
            if (ui->touch.y < top || ui->touch.y >= top + 24 || top < ROWS_TOP || top + 24 > ROWS_BOTTOM) continue;
            Row *row = &st.rows[r];
            st.vr = (uint8_t)(NATIVE_ROWS + r);
            uint8_t next = row->staged;
            if (ui->touch.x >= 112 && ui->touch.x < 184) next = 0;
            else if (ui->touch.x >= 184 && ui->touch.x < 256) next = 1;
            if (row->staged != next) { row->staged = next; CALL(OR_SE_PLAY, void (*)(unsigned))(SE_CURSOR); }
            if (r + 1 < st.count) set_scrolled(s, 1);
            break;
        }
    }
    if (is_row(st.vr) || st.vr == confirm) s->select = 5;
    else if (st.vr == quit) s->select = 6;
    /* With two extra rows, show the seventh by scrolling one row; scroll back near the top. */
    if (st.vr == NATIVE_ROWS + 1) set_scrolled(s, 1);
    else if (st.vr <= 1) set_scrolled(s, 0);
    if (s->objectY != st.markerBase) { st.markerBase = s->objectY; place_markers(s); }
    uint8_t focused = is_row(st.vr) && !st.touchMode;
    restyle_background(s);
    int valuesChanged = 0;
    for (unsigned r = 0; r < st.count; ++r) if (st.shownValue[r] != st.rows[r].staged) valuesChanged = 1;
    if (st.shownRow != st.vr || valuesChanged || st.shownFocus != focused || input != INPUT_NONE) {
        restyle(s);
        if (is_row(st.vr) && (st.shownRow != st.vr || input == INPUT_TOUCH)) draw_help(message, row_of(st.vr));
        st.shownRow = st.vr; st.shownFocus = focused;
        for (unsigned r = 0; r < st.count; ++r) st.shownValue[r] = st.rows[r].staged;
    }
}

int OptionRowsSelect(const OptScroll *s) {
    if (st.active && st.scroll == s) {
        if (is_row(st.vr)) return 4;
        if (st.vr == confirm_row()) return 5;
        if (st.vr == quit_row()) return 6;
    }
    return s->select;
}

int OptionRowsCompare(const void *pre, const void *now) {
    const uint8_t *a = pre, *b = now;
    for (unsigned i = 0; i < NATIVE_ROWS; ++i) if (a[i] != b[i]) return 0;
    if (st.active) for (unsigned r = 0; r < st.count; ++r) if (st.rows[r].original != st.rows[r].staged) return 0;
    return 1;
}

void OptionRowsCommit(const void *configParam) {
    CALL(OR_OPTIONS_APPLY, void (*)(const void *))(configParam);
    if (!st.active || !st.config) return;
    uint16_t value = *st.config;
    for (unsigned r = 0; r < st.count; ++r) {
        uint16_t bit = (uint16_t)(1u << st.rows[r].def.bit);
        value = (uint16_t)((value & ~bit) | (st.rows[r].staged ? bit : 0u));
        st.rows[r].original = st.rows[r].staged;
    }
    *st.config = value;
}
