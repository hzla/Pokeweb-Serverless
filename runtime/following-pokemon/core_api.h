#ifndef FOLLOWING_CORE_API_H
#define FOLLOWING_CORE_API_H
#include <stdint.h>
#define FWC_ABI 3u
typedef struct {
 uint32_t abi,size;
 int (*publish)(unsigned);
 void (*clear)(void);
} FwcApi;
extern const FwcApi FollowingCoreAPI;
#endif
