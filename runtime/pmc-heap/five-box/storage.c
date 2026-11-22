#include <stddef.h>
#include <stdint.h>

enum {
    BOX_LIMIT = 5, BOX_COUNT = 24, BLOCK_COUNT = 73,
    BOX_BYTES = 4080, BOX_SLOT = 4096, FIRST_HIDDEN_OFFSET = 0x5400,
    BOX_CAPACITY = 30, PKM_BYTES = 136, PKM_HAS_SPECIES = 169,
    OMITTED = (BOX_COUNT - BOX_LIMIT) * BOX_SLOT,
    SAVE_AREA = 0x26000, SAVE_SIZE = 0x25fa4, RETAIL_MAGIC = 0x31053527, ITEM_MAGIC = 0x32495750,
    PACKED_AREA = SAVE_AREA - OMITTED,
    ALLOCATION = PACKED_AREA + BOX_SLOT,
    MAIN = 1, BACKUP = 2, OK = 0, SCAN_HIDDEN = 0x80, COPY_MASK = 0x7f,
    NO_SAVE = 0, LOADED = 1, BROKEN = 3,
};

typedef struct { uint32_t id, size, offset; } Block;
typedef struct { uint32_t id; void *size; void (*init)(void *); } BlockDef;
typedef struct {
    const BlockDef *defs;
    uint32_t count, footerSize, totalSize, areaSize;
    const Block *blocks;
} Table;
typedef struct __attribute__((aligned(4))) { uint16_t count, crc; } BlockFooter;
typedef struct { uint32_t count, size, magic; uint16_t unused, crc; } Footer;
typedef struct {
    uint32_t mainOffset, backupOffset, areaSize, magic;
    uint8_t internal[24];
    uint32_t count;
    const Table *table;
    uint32_t size;
    uint8_t *data;
    uint8_t compare[256];
    uint32_t *status, statusSize, crcSize;
} Save;
typedef void (*ErrorCallback)(void);
typedef struct {
    uint32_t ready;
    uint16_t crcTable[256];
    ErrorCallback readError, writeError;
} Card;

_Static_assert(offsetof(Save, table) == 0x2c && offsetof(Save, crcSize) == 0x140, "save ABI");
_Static_assert(sizeof(Footer) == 16 && sizeof(BlockFooter) == 4, "flash ABI");
_Static_assert(BOX_CAPACITY * PKM_BYTES == BOX_BYTES, "box ABI");

extern Card *card;
extern void *heap_alloc(uint32_t, uint32_t, uint32_t, const char *, uint32_t);
extern void heap_free(void *);
extern void copy16(const void *, void *, uint32_t);
extern void clear32(uint32_t, void *, uint32_t);
extern int compare(const void *, const void *, uint32_t);
extern uint16_t crc16(const uint16_t *, const void *, uint32_t);
extern int read_flash(uint32_t, void *, uint32_t, ErrorCallback);
extern uint16_t write_flash(uint32_t, const void *, uint32_t, ErrorCallback);
extern void set_status(Save *, uint32_t, uint32_t);
extern void fill_status(Save *, uint32_t);
extern void clear_status(Save *);
extern void init_native(void *, const Table *);
extern void init_box(void *);
extern void init_pkm(void *);
extern uint32_t get_pkm_param(void *, uint32_t, void *);
extern void print_create(void);
extern void print_message(const char *);
extern void print_commit(void);
extern void display_on(void);
extern void terminate(void) __attribute__((noreturn));

static uint8_t *compact_data;
volatile uint32_t five_box_rejection;

static int is_compact(const Save *sv) { return compact_data && sv->data == compact_data; }
static int hidden(uint32_t id) { return id > BOX_LIMIT && id <= BOX_COUNT; }
static uint8_t *empty_box(Save *sv) { return sv->data + PACKED_AREA; }
static BlockFooter *hidden_footers(Save *sv) {
    // The last save-area page has 92 bytes of padding after the on-disk footer.
    return (BlockFooter *)empty_box(sv) - (BOX_COUNT - BOX_LIMIT);
}
static uint32_t flash_base(const Save *sv, uint32_t copy) {
    return copy == BACKUP ? sv->backupOffset : sv->mainOffset;
}

static void reject(uint32_t reason) {
    five_box_rejection = reason;
    print_create();
    print_message("Five-box mode could not\nload this save.\nUse your regular ROM.");
    display_on();
    print_commit();
    terminate();
}

void *allocate_save(uint32_t heap, uint32_t size, uint32_t clear, const char *file, uint32_t line) {
    if (heap != 7 || size != SAVE_AREA) return heap_alloc(heap, size, clear, file, line);
    compact_data = heap_alloc(heap, ALLOCATION, clear, file, line);
    return compact_data;
}

void *block_ptr(Save *sv, uint32_t id) {
    uint32_t offset = sv->table->blocks[id].offset;
    if (is_compact(sv)) {
        if (hidden(id)) return empty_box(sv);
        if (id > BOX_COUNT) offset -= OMITTED;
    }
    return sv->data + offset;
}

static int occupied(const uint8_t *pkm) {
    uint32_t copy[PKM_BYTES / 4];
    copy16(pkm, copy, PKM_BYTES);
    return get_pkm_param(copy, PKM_HAS_SPECIES, 0) != 0; // Same occupied-slot query as the native PC.
}

static uint8_t *next_slot(uint8_t *slot, const uint8_t *first) {
    slot += PKM_BYTES;
    return ((slot - first) & (BOX_SLOT - 1)) == BOX_BYTES ? slot + BOX_SLOT - BOX_BYTES : slot;
}

static uint8_t *compact_visible(uint8_t *first) {
    uint8_t *next = first;
    for (uint8_t *slot = first; slot < first + BOX_LIMIT * BOX_SLOT; slot = next_slot(slot, first)) {
        if (!occupied(slot)) continue;
        if (slot != next) {
            copy16(slot, next, PKM_BYTES);
            init_pkm(slot);
        }
        next = next_slot(next, first);
    }
    return next;
}

typedef struct { uint8_t *next; uint32_t moved; } Migration;

static void migrate_box(Save *sv, Migration *migration, const uint8_t *box) {
    uint8_t *first = block_ptr(sv, 1);
    uint8_t *last = first + (BOX_LIMIT - 1) * BOX_SLOT;
    for (const uint8_t *slot = box; slot < box + BOX_BYTES && migration->moved < BOX_CAPACITY; slot += PKM_BYTES) {
        if (!occupied(slot)) continue;
        if (!migration->next) {
            migration->next = compact_visible(first);
            // Keep imported Pokémon together in Box 5, including Nuzlocke memorial boxes.
            if (migration->next < last) migration->next = last;
        }
        if (migration->next == first + BOX_LIMIT * BOX_SLOT) return;
        copy16(slot, migration->next, PKM_BYTES);
        migration->next = next_slot(migration->next, first);
        ++migration->moved;
    }
}

static uint8_t *tail_ptr(Save *sv) {
    return sv->data + sv->size - (is_compact(sv) ? OMITTED : 0) - sizeof(Footer) - sv->crcSize;
}

static BlockFooter *block_footer(Save *sv, uint32_t id) {
    if (is_compact(sv) && hidden(id)) return hidden_footers(sv) + id - BOX_LIMIT - 1;
    return (BlockFooter *)((uint8_t *)block_ptr(sv, id) + sv->table->blocks[id].size);
}

void init_blocks(Save *sv) {
    if (is_compact(sv)) {
        if (sv->table->count != BLOCK_COUNT || sv->crcSize != 148 ||
            sv->size != SAVE_SIZE || (sv->magic != RETAIL_MAGIC && sv->magic != ITEM_MAGIC) ||
            sv->table->blocks[BOX_LIMIT + 1].offset != FIRST_HIDDEN_OFFSET ||
            sv->table->blocks[BOX_COUNT + 1].offset != FIRST_HIDDEN_OFFSET + OMITTED) reject(1);
        clear32(0, sv->data, ALLOCATION);
        for (uint32_t id = 0; id < BLOCK_COUNT; ++id) {
            if (!hidden(id)) sv->table->defs[id].init(block_ptr(sv, id));
        }
        init_box(empty_box(sv));
    } else {
        init_native(sv->data, sv->table);
    }
    fill_status(sv, MAIN);
}

typedef struct { uint16_t crc[74]; Footer footer; } FlashTail;
typedef struct { BlockFooter footer; uint8_t valid, canonical; } CheckedBlock;

static uint32_t check_tail(Save *sv, uint32_t copy, FlashTail *tail, uint32_t requireCount, uint32_t count) {
    if (!read_flash(flash_base(sv, copy) + sv->size - sizeof(*tail), tail, sizeof(*tail), card->readError) ||
        tail->footer.size != sv->size ||
        (requireCount && tail->footer.count != count)) return 2;
    int valid = tail->footer.crc == crc16(card->crcTable, tail->crc, sizeof(tail->crc));
    if (valid && tail->footer.magic != sv->magic) reject(3);
    return !valid;
}

static CheckedBlock check_block(Save *sv, uint32_t copy, uint32_t id, uint16_t wantedCrc, uint8_t *scratch) {
    const Block *block = &sv->table->blocks[id];
    CheckedBlock checked = {{0, 0}, 0, 0};
    if (!read_flash(flash_base(sv, copy) + block->offset, scratch, block->size + sizeof(BlockFooter),
                    card->readError)) return checked;
    checked.footer = *(const BlockFooter *)(scratch + block->size);
    if (checked.footer.crc != wantedCrc || crc16(card->crcTable, scratch, block->size) != wantedCrc) return checked;
    checked.valid = 1;
    checked.canonical = !hidden(id) || (block->size == BOX_BYTES && !compare(scratch, empty_box(sv), BOX_BYTES));
    return checked;
}

extern uint32_t load_backup_native(Save *, uint32_t, uint32_t, uint32_t);

uint32_t load_backup(Save *sv, uint32_t heap, uint32_t requireCount, uint32_t count) {
    if (!is_compact(sv)) return load_backup_native(sv, heap, requireCount, count);
    FlashTail tails[2];
    uint32_t check[2] = {check_tail(sv, MAIN, &tails[0], requireCount, count),
                         check_tail(sv, BACKUP, &tails[1], requireCount, count)};
    if (check[0] && check[1]) {
        fill_status(sv, MAIN);
        return check[0] == 1 || check[1] == 1 ? BROKEN : NO_SAVE;
    }

    uint32_t scratchSize = 0;
    for (uint32_t id = 0; id < BLOCK_COUNT; ++id) {
        uint32_t size = sv->table->blocks[id].size + sizeof(BlockFooter);
        if (size > scratchSize) scratchSize = size;
    }
    uint8_t *scratch = heap_alloc(heap, scratchSize, 0, "five box load", 0);
    uint8_t sources[BLOCK_COUNT];
    uint8_t repairs[BLOCK_COUNT];
    const uint32_t mainCount = check[0] ? 0 : tails[0].footer.count;
    const uint32_t backupCount = check[1] ? 0 : tails[1].footer.count;
    uint32_t newest = check[0] == 0 && (check[1] != 0 || mainCount >= backupCount ||
                      (mainCount == 0 && backupCount == UINT32_MAX)) ? 0 : 1;

    // Use one CRC list for the whole image. For each block, accept a matching
    // copy and queue a repair when the other copy differs.
    for (uint32_t attempt = 0; attempt < 2; ++attempt) {
        uint32_t preferred = newest ^ attempt;
        if (check[preferred]) continue;
        uint32_t id;
        for (id = 0; id < BLOCK_COUNT; ++id) {
            uint16_t crc = tails[preferred].crc[id];
            CheckedBlock first = check_block(sv, preferred + 1, id, crc, scratch);
            CheckedBlock second = check_block(sv, (preferred ^ 1) + 1, id, crc, scratch);
            if (!first.valid && !second.valid) break;
            sources[id] = first.valid ? preferred + 1 : (preferred ^ 1) + 1;
            repairs[id] = first.valid && second.valid && first.footer.count == second.footer.count
                ? OK : (sources[id] == MAIN ? BACKUP : MAIN);
            if (!(first.valid ? first.canonical : second.canonical)) sources[id] |= SCAN_HIDDEN;
            if (hidden(id)) *block_footer(sv, id) = first.valid ? first.footer : second.footer;
        }
        if (id != BLOCK_COUNT) continue;
        clear_status(sv);
        Migration migration = {0};
        for (id = 0; id < BLOCK_COUNT; ++id) {
            const Block *block = &sv->table->blocks[id];
            if (!hidden(id) || (sources[id] & SCAN_HIDDEN)) {
                uint8_t *dest = hidden(id) ? scratch : block_ptr(sv, id);
                if (!read_flash(flash_base(sv, sources[id] & COPY_MASK) + block->offset, dest,
                                block->size + sizeof(BlockFooter), card->readError)) reject(2);
                if (hidden(id)) migrate_box(sv, &migration, dest);
            }
            set_status(sv, id, repairs[id]);
        }
        set_status(sv, BLOCK_COUNT, (preferred ^ 1) + 1);
        set_status(sv, BLOCK_COUNT + 1, (preferred ^ 1) + 1);
        copy16(&tails[preferred], tail_ptr(sv), sizeof(FlashTail));
        uint32_t *currentBox = block_ptr(sv, 0);
        if (*currentBox >= BOX_LIMIT) *currentBox = 0;
        sv->count = tails[preferred].footer.count;
        heap_free(scratch);
        return LOADED;
    }
    heap_free(scratch);
    fill_status(sv, MAIN);
    return BROKEN;
}

uint16_t *block_crcs(Save *sv) { return (uint16_t *)tail_ptr(sv); }

void prepare_save(Save *sv) {
    if (is_compact(sv)) {
        Migration migration = {0};
        migrate_box(sv, &migration, empty_box(sv));
        init_box(empty_box(sv));
    }
}

uint16_t increment_block(Save *sv, uint32_t id) { return ++block_footer(sv, id)->count; }

uint16_t write_block(Save *sv, uint32_t id, uint32_t copy) {
    const Block *block = &sv->table->blocks[id];
    uint8_t *data = block_ptr(sv, id);
    BlockFooter *footer = block_footer(sv, id);
    footer->crc = crc16(card->crcTable, data, block->size);
    block_crcs(sv)[id] = footer->crc;
    if (is_compact(sv) && hidden(id)) *(BlockFooter *)(data + BOX_BYTES) = *footer;
    return write_flash(flash_base(sv, copy) + block->offset, data, block->size + sizeof(*footer), card->writeError);
}

uint16_t write_footer_head(Save *sv, uint32_t copy) {
    Footer *footer = (Footer *)(tail_ptr(sv) + sv->crcSize);
    footer->count = sv->count;
    footer->size = sv->size;
    footer->magic = sv->magic;
    footer->crc = crc16(card->crcTable, tail_ptr(sv), sv->crcSize);
    return write_flash(flash_base(sv, copy) + sv->size - sizeof(*footer), footer, sizeof(*footer) - 1,
                       card->writeError);
}

uint16_t write_footer_last(Save *sv, uint32_t copy) {
    return write_flash(flash_base(sv, copy) + sv->size - 1, tail_ptr(sv) + sv->crcSize + sizeof(Footer) - 1,
                       1, card->writeError);
}

void *upload_data(Save *sv, uint32_t *length) {
    *length = is_compact(sv) ? 0 : sv->size;
    return sv->data;
}

extern void *get_box(void *, uint32_t);

void swap_boxes(void *boxes, uint32_t from, uint32_t fromSlot, uint32_t to, uint32_t toSlot) {
    if (from >= BOX_LIMIT || to >= BOX_LIMIT || fromSlot >= BOX_CAPACITY || toSlot >= BOX_CAPACITY) return;
    uint8_t *a = (uint8_t *)get_box(boxes, from) + fromSlot * PKM_BYTES;
    uint8_t *b = (uint8_t *)get_box(boxes, to) + toSlot * PKM_BYTES;
    uint8_t temp[PKM_BYTES] __attribute__((aligned(4)));
    copy16(a, temp, sizeof(temp));
    copy16(b, a, sizeof(temp));
    copy16(temp, b, sizeof(temp));
}
