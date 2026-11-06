/* Optional Hard Level Caps companion: apply configured caps on field battle return. */
#include <stdint.h>

extern void EventBattleCall_BroadcastBattleResult(void *work);
extern void *GameData_GetEventWork(void *game_data);
extern uint16_t *EventWork_GetWkPtr(void *event_work, uint32_t variable);
extern void FS_InitFile(void *file);
extern int FS_OpenFile(void *file, const char *path);
extern int FS_ReadFile(void *file, void *buffer, uint32_t size);
extern uint32_t FS_GetLength(void *file);
extern int FS_SeekFile(void *file, int offset, int origin);
extern int FS_CloseFile(void *file);

static uint32_t word(const uint8_t *p) {
    return p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

static uint32_t read_cap(void *file, uint32_t count, const uint32_t *trainer) {
    uint8_t cap = 0;
    if (!trainer || *trainer >= count) return 0;
    if (!FS_SeekFile(file, 16 + *trainer, 0) || FS_ReadFile(file, &cap, 1) != 1) return 0;
    return cap <= 100 ? cap : 0;
}

/* Replace only the BL to the retail broadcaster, preserving its normal effects. */
void THUMB_BRANCH_LINK_EventBattleCall_SyncGameDataOnReturn_0x14(void *work) {
    EventBattleCall_BroadcastBattleResult(work);
    if (!work) return;
    uint8_t *w = work;
    uint8_t *setup = *(uint8_t **)(w + 8);
    /* Only ordinary field trainer victories. Other callers share this callback. */
    if (!setup || word(setup) != 1 || word(setup + 0x1c) || setup[0x20] || word(setup + 0xa8) != 1
        || !word(w + 0x14) || word(w + 0x1c) || (word(w + 0x28) & 4)) return;
    void *game_data = *(void **)(w + 4);
    if (!game_data) return;
    uint32_t file[20];
    uint8_t header[16];
    FS_InitFile(file);
    if (!FS_OpenFile(file, "rom:/battle/trainer-caps.bin")) return;
    uint32_t cap = 0;
    if (FS_ReadFile(file, header, 16) == 16) {
        uint32_t count = word(header + 8);
        if (word(header) == 0x434c5750 && word(header + 4) == 0x00010001
            && word(header + 12) == 16415 && count && count <= 65536 && FS_GetLength(file) == 16 + count) {
            cap = read_cap(file, count, *(uint32_t **)(setup + 0x4c));
            /* Two opposing trainers: use the higher configured cap, ignoring allies. */
            uint32_t second = read_cap(file, count, *(uint32_t **)(setup + 0x54));
            if (second > cap) cap = second;
        }
    }
    FS_CloseFile(file);
    if (cap) {
        void *event_work = GameData_GetEventWork(game_data);
        if (event_work) {
            uint16_t *variable = EventWork_GetWkPtr(event_work, 16415);
            if (variable) *variable = (uint16_t)cap;
        }
    }
}
