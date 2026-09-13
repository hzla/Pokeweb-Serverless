#include "w2u_menu_relearn_logic.h"
#undef NDEBUG
#include <cassert>
struct TestRow { uint16_t move, requirement; };
struct TestRecord {
    uint8_t bytes[W2U_RELEARN_RECORD_BYTES] = {255, 255, 255, 255};
    uint32_t length = 4;
    const uint8_t* data() const { return bytes; }
    uint32_t size() const { return length; }
};

template <unsigned N>
static TestRecord Record(const TestRow (&rows)[N])
{
    TestRecord result;
    result.length = 0;
    for (auto row : rows) {
        result.bytes[result.length++] = uint8_t(row.move);
        result.bytes[result.length++] = uint8_t(row.move >> 8);
        result.bytes[result.length++] = uint8_t(row.requirement);
        result.bytes[result.length++] = uint8_t(row.requirement >> 8);
    }
    for (unsigned i = 0; i < 4; ++i) result.bytes[result.length++] = 255;
    return result;
}

int main()
{
    uint16_t moves[W2U_RELEARN_MAX_MOVES + 2] = {};
    moves[W2U_RELEARN_MAX_MOVES + 1] = 0xbeef;
    const uint16_t known[4] = {52, 53, 0, 0};
    auto level = Record({{52, 1}, {126, 36}, {394, 100}, {126, 50}, {0, 1}, {65534, 1}});
    auto ko = Record({{126, 1}, {57, 2}, {56, 3}, {53, 0}});
    uint32_t count = W2URelearnAppend(moves, 0, level.data(), level.size(), 99, known, 1000);
    assert(count == 1 && moves[0] == 126 && moves[1] == 0xffff);
    count = W2URelearnAppend(moves, count, ko.data(), ko.size(), 2, known, 1000);
    assert(count == 2 && moves[1] == 57 && moves[2] == 0xffff);
    count = W2URelearnAppend(moves, 0, level.data(), level.size(), 100, known, 1000);
    assert(count == 2 && moves[0] == 126 && moves[1] == 394);
    count = W2URelearnAppend(moves, count, ko.data(), ko.size(), 65535, known, 1000);
    assert(count == 4 && moves[2] == 57 && moves[3] == 56);
    auto zero = Record({{10, 0}, {11, 1}, {1000, 0}, {999, 0}});
    assert(W2URelearnAppend(moves, 0, zero.data(), zero.size(), 0, known, 1000) == 2);
    assert(moves[0] == 10 && moves[1] == 999);

    // Malformed/absent archives contribute no moves and cannot damage the
    // other source. Missing a form member is treated the same way by the IO.
    const uint16_t saved[3] = {moves[0], moves[1], moves[2]};
    const uint32_t invalidSizes[] = {0, 3, 5, 136};
    for (uint32_t size : invalidSizes) {
        assert(W2URelearnAppend(moves, 2, zero.data(), size, 100, known, 1000) == 2);
    }
    assert(W2URelearnAppend(moves, 2, nullptr, 4, 100, known, 1000) == 2);
    zero.length -= 4;
    assert(W2URelearnAppend(moves, 2, zero.data(), zero.size(), 100, known, 1000) == 2);
    for (unsigned i = 0; i < 3; ++i) assert(moves[i] == saved[i]);

    // Fully populated expanded level + KO tables fit, followed by a sentinel.
    const uint16_t none[4] = {};
    for (uint32_t source = 0; source < 2; ++source) {
        uint8_t record[W2U_RELEARN_RECORD_BYTES] = {};
        for (uint32_t i = 0; i < 32; ++i) record[i * 4] = 1 + source * 32 + i;
        for (uint32_t i = 128; i < 132; ++i) record[i] = 255;
        count = W2URelearnAppend(moves, source * 32, record, sizeof(record), 0, none, 1000);
        assert(count == (source + 1) * 32);
    }
    assert(moves[63] == 64 && moves[64] == 0xffff && moves[65] == 0xbeef);
    assert(W2URelearnAppend(moves, 64, ko.data(), ko.size(), 100, none, 1000) == 64);
    assert(moves[65] == 0xbeef);
    TestRecord empty;
    assert(W2URelearnAppend(moves, 0, empty.data(), empty.size(), 100, none, 1000) == 0);
    assert(moves[0] == 0xffff);

    for (uint32_t field = 0; field <= 4; ++field) {
        assert(W2URelearnMenuSpace(field) == 4 - field);
        assert(4 + field + (W2URelearnMenuSpace(field) >= 2 ? 2 : W2URelearnMenuSpace(field)) <= 8);
    }
    assert(W2URelearnMenuSpace(100) == 0);
    for (uint32_t seq = 0; seq < 14; ++seq) {
        assert(W2URelearnDispatch(seq, 0, false, true, W2U_RELEARN_PARTY_RETURN)
            == (seq == 13 ? W2U_RELEARN_START : W2U_RELEARN_RETAIL));
        assert(W2URelearnDispatch(seq, 0, true, true, W2U_RELEARN_PARTY_RETURN)
            == (seq == 13 ? W2U_RELEARN_FINISH : W2U_RELEARN_RETAIL));
        for (uint32_t process = 1; process < 13; ++process)
            assert(W2URelearnDispatch(seq, process, false, true, W2U_RELEARN_PARTY_RETURN) == W2U_RELEARN_RETAIL);
    }
    for (uint32_t ordinaryReturn = 0; ordinaryReturn < 32; ++ordinaryReturn)
        assert(W2URelearnDispatch(13, 0, false, true, ordinaryReturn) == W2U_RELEARN_RETAIL);
    assert(W2URelearnDispatch(13, 0, false, false, W2U_RELEARN_PARTY_RETURN) == W2U_RELEARN_RETAIL);
}
