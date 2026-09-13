#ifndef W2U_MENU_RELEARN_LOGIC_H
#define W2U_MENU_RELEARN_LOGIC_H

#include <stdint.h>

constexpr uint32_t W2U_RELEARN_MAX_SOURCE_MOVES = 32;
constexpr uint32_t W2U_RELEARN_MAX_MOVES = 2 * W2U_RELEARN_MAX_SOURCE_MOVES;
constexpr uint32_t W2U_RELEARN_RECORD_BYTES = 4 * (W2U_RELEARN_MAX_SOURCE_MOVES + 1);
constexpr uint16_t W2U_RELEARN_END = 0xffff;
constexpr uint32_t W2U_RELEARN_PARTY_RETURN = 0x4d52;

// Append one complete, bounded learnset. Preserve table order, omit known
// moves, and deduplicate both within a source and across level/KO sources.
// Validate the terminator first so a malformed member contributes nothing.
static inline uint32_t W2URelearnAppend(
    uint16_t* output, uint32_t count, const uint8_t* bytes, uint32_t size,
    uint16_t threshold, const uint16_t known[4], uint32_t moveCount)
{
    if (!output || !bytes || !known || size < 4
        || size > W2U_RELEARN_RECORD_BYTES || (size & 3) != 0
        || count > W2U_RELEARN_MAX_MOVES) {
        return count;
    }
    uint32_t end = 0;
    for (; end < size / 4; ++end) {
        const uint8_t* row = bytes + end * 4;
        if (row[0] == 255 && row[1] == 255
            && row[2] == 255 && row[3] == 255) break;
    }
    if (end == size / 4) return count;
    for (uint32_t i = 0; i < end && count < W2U_RELEARN_MAX_MOVES; ++i) {
        const uint8_t* row = bytes + i * 4;
        const uint16_t move = row[0] | (row[1] << 8);
        const uint16_t requirement = row[2] | (row[3] << 8);
        if (!move || move >= moveCount || move == W2U_RELEARN_END
            || requirement > threshold) continue;
        bool skip = false;
        for (uint32_t j = 0; j < 4; ++j) skip |= known[j] == move;
        for (uint32_t j = 0; j < count; ++j) skip |= output[j] == move;
        if (!skip) output[count++] = move;
    }
    output[count] = W2U_RELEARN_END;
    return count;
}

// Normal field menu: Summary, Switch, Item/Mail, Cancel, plus field moves.
// The HIDEN placeholder expands later, so count the expanded menu too.
static inline uint32_t W2URelearnMenuSpace(uint32_t fieldMoves)
{
    return fieldMoves < 4 ? 4 - fieldMoves : 0;
}

enum W2URelearnAction { W2U_RELEARN_RETAIL, W2U_RELEARN_START, W2U_RELEARN_FINISH };
static inline W2URelearnAction W2URelearnDispatch(
    uint32_t sequence, uint32_t process, bool active,
    bool fieldParty, uint32_t partyReturn)
{
    // Retail SEQ_PROC_RETURN runs only after GSYS has unloaded the app.
    if (sequence != 13 || process != 0) return W2U_RELEARN_RETAIL;
    if (active) return W2U_RELEARN_FINISH;
    return fieldParty && partyReturn == W2U_RELEARN_PARTY_RETURN
        ? W2U_RELEARN_START : W2U_RELEARN_RETAIL;
}

#endif
