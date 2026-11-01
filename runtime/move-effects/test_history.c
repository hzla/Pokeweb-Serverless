#include "history.h"
#include <assert.h>

int main(void) {
    MoveHistory h;
    move_history_reset(&h);
    assert(sizeof(h) <= 256);
    move_history_berry(&h, 0, 1, 1, 1);
    move_history_berry(&h, 0, 0, 1, 0);
    move_history_berry(&h, 0, 1, 0, 0);
    assert(!h.ate_berry);
    move_history_berry(&h, 0, 1, 1, 0);
    move_history_berry(&h, 24, 1, 1, 0);
    assert(h.ate_berry == 1);

    move_history_hit(&h, 1, 0, 30, 1, 0);
    move_history_hit(&h, 1, 0, 0, 0, 0);
    move_history_hit(&h, 0, 0, 30, 0, 0);
    move_history_hit(&h, 1, 0, 30, 0, 1);
    assert(!h.hits[0]);
    for (int i = 0; i < 300; ++i) move_history_hit(&h, 1, 0, 30, 0, 0);
    assert(h.hits[0] == 255);

    move_history_faint(&h, 1, 0, 0);
    move_history_faint(&h, 1, 1, 1);
    move_history_faint(&h, 4, 1, 0);
    assert(!h.faints[1]);
    for (int i = 0; i < 300; ++i) move_history_faint(&h, 1, 1, 0);
    assert(h.faints[1] == 255);

    move_history_stage(&h, 0, 1, 0, 0);
    move_history_stage(&h, 0, -1, 1, 1);
    assert(!h.raised && !h.lowered);
    move_history_stage(&h, 0, 1, 1, 0);
    move_history_stage(&h, 0, -2, 1, 0);
    assert(h.raised == 1 && h.lowered == 1);
    move_history_action(&h, 0, 12, 0, 0, 0);
    move_history_next_turn(&h, 1);
    assert(h.failed_this_turn == 1 && h.raised == 1);
    move_history_next_turn(&h, 0);
    assert(h.failed_last_turn == 1 && !h.failed_this_turn && !h.raised && !h.lowered);
    move_history_action(&h, 0, 13, 0, 1, 0);
    assert(!h.failed_this_turn && !h.selected_move[0]);
    move_history_action(&h, 0, 14, 1, 0, 0);
    assert(h.selected_move[0] == 14);
    move_history_leave(&h, 0, 0);
    assert(!h.selected_move[0] && !h.failed_last_turn && h.ate_berry == 1 && h.hits[0] == 255);
    move_history_reset(&h);
    assert(!h.ate_berry && !h.hits[0] && !h.faints[1]);
    return 0;
}
