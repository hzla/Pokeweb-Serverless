#ifndef POKEWEB_FOLLOWING_POSITIONING_H
#define POKEWEB_FOLLOWING_POSITIONING_H
#include <stdint.h>
/* Read only the chosen record from the single-member ROM NARC. Failure leaves
 * the caller's calculated legacy positioning in place. */
int fwp_land(unsigned row,unsigned count,uint32_t registry_crc,uint8_t out[12]);
#ifdef FW_MOUNT
int fwp_surf(unsigned row,unsigned count,uint8_t out[8]);
#endif
#endif
