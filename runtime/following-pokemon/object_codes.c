#include "following.h"
uint16_t fw_stock_row(uint16_t code) {
    if (code < 0x179) return code;
    if (code >= 0x1000 && code < 0x126c) return code - 0xe87;
    if (code >= 0x2000 && code < 0x200b) return code - 0x1c1b;
    return 10;
}
uint16_t fw_object_row(uint16_t code, uint16_t count) {
    if (count <= FW_MAX_ROWS && code >= FW_CODE_BASE && (uint32_t)code - FW_CODE_BASE < count)
        return FW_STOCK_ROWS + code - FW_CODE_BASE;
    return fw_stock_row(code);
}
uint32_t fw_descriptor_offset(uint16_t row) { return 4u + (uint32_t)row * 28u; }
