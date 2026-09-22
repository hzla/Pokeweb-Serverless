#ifndef FOLLOWING_FIELD_LAYOUT_H
#define FOLLOWING_FIELD_LAYOUT_H
#include <stdint.h>

/* US White 2 IRDO revision 0 Field::ZoneID. */
#define FW_FIELD_ZONE_OFFSET 0xe0u
static inline uint16_t fw_field_zone(const void *field) {
 if(!field)return 0;
 const uint8_t *bytes=(const uint8_t*)field;
 return (uint16_t)(bytes[FW_FIELD_ZONE_OFFSET]|(uint16_t)bytes[FW_FIELD_ZONE_OFFSET+1u]<<8);
}
#endif
