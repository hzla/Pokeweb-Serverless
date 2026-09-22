#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../field_layout.h"

int main(void) {
 uint32_t aligned[(FW_FIELD_ZONE_OFFSET+4u)/4u];
 memset(aligned,0,sizeof(aligned));
 uint8_t *field=(uint8_t*)aligned;
 field[FW_FIELD_ZONE_OFFSET]=427&255;
 field[FW_FIELD_ZONE_OFFSET+1u]=427>>8;
 uint16_t playerActorZone=0;

 /* Player actors can have zone zero even while the live field is zone 427. */
 assert(playerActorZone==0);
 assert(fw_field_zone(field)==427);
 assert(fw_field_zone(0)==0);
 return 0;
}
