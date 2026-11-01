#ifndef POKEWEB_MOVE_HISTORY_H
#define POKEWEB_MOVE_HISTORY_H

#include <stdint.h>

/* Battle-local bookkeeping. The integration must feed these functions only
 * committed native events, and reset the state at every battle start. IDs are
 * native party identities (0..23), not field positions. */
typedef struct {
    uint32_t ate_berry, raised, lowered, failed_this_turn, failed_last_turn;
    uint32_t faint_seen, raised_snapshot;
    uint8_t hits[24], faints[4];
    uint16_t selected_move[24], selected_this_turn[24], selected_last_turn[24];
    uint8_t sequence_depth[24];
    uint32_t protected_move;
} MoveHistory;

static inline uint32_t move_history_mask(unsigned id) {
    return id < 24 ? (uint32_t)1 << id : 0;
}

static inline void move_history_reset(MoveHistory *history) {
    *history = (MoveHistory){0};
}

static inline void move_history_berry(MoveHistory *history, unsigned id,
                                      int eaten, int is_berry, int simulation) {
    if (!simulation && eaten && is_berry) history->ate_berry |= move_history_mask(id);
}

static inline void move_history_hit(MoveHistory *history, unsigned attacker,
                                    unsigned target, unsigned damage,
                                    int substitute, int simulation) {
    if (!simulation && attacker < 24 && target < 24 && attacker != target &&
        damage && !substitute && history->hits[target] < 255) ++history->hits[target];
}

static inline void move_history_faint(MoveHistory *history, unsigned party,
                                      int committed, int simulation) {
    if (!simulation && committed && party < 4 && history->faints[party] < 255)
        ++history->faints[party];
}

static inline void move_history_stage(MoveHistory *history, unsigned id,
                                      int delta, int applied, int simulation) {
    if (simulation || !applied || !delta) return;
    if (delta > 0) history->raised |= move_history_mask(id);
    else history->lowered |= move_history_mask(id);
}

/* The adapter must identify the selected move separately from called moves and
 * pass the native success outcome. A protected move is not a failure for the
 * previous-turn power condition. */
static inline void move_history_action(MoveHistory *history, unsigned id,
                                       unsigned selected, int successful,
                                       int protected_move, int simulation) {
    uint32_t mask = move_history_mask(id);
    if (simulation || !mask) return;
    history->failed_this_turn &= ~mask;
    if (!successful && !protected_move) history->failed_this_turn |= mask;
    history->selected_move[id] = successful && selected <= 65535 ? (uint16_t)selected : 0;
}

static inline void move_history_leave(MoveHistory *history, unsigned id, int simulation) {
    uint32_t mask = move_history_mask(id);
    if (simulation || !mask) return;
    history->raised &= ~mask;
    history->lowered &= ~mask;
    history->failed_this_turn &= ~mask;
    history->failed_last_turn &= ~mask;
    history->selected_move[id] = 0;
    history->selected_this_turn[id] = history->selected_last_turn[id] = 0;
    history->sequence_depth[id] = 0;
}

static inline void move_history_next_turn(MoveHistory *history, int simulation) {
    if (simulation) return;
    history->failed_last_turn = history->failed_this_turn;
    history->failed_this_turn = history->raised = history->lowered = 0;
    for (unsigned id = 0; id < 24; ++id) {
        history->selected_last_turn[id] = history->selected_this_turn[id];
        history->selected_this_turn[id] = 0;
    }
}

#endif
