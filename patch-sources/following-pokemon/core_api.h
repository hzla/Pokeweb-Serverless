#ifndef FOLLOWING_CORE_API_H
#define FOLLOWING_CORE_API_H
#include <stdint.h>
#include "registry.h"
#define FWC_ABI 2u
typedef struct {
 uint32_t abi,size;
 int (*configure)(const uint8_t*,unsigned,uint16_t,uint16_t);
 void (*clear)(void);
 int (*configureStream)(FwRegistryInput*);
} FwcApi;
extern const FwcApi FollowingCoreAPI;
#endif
