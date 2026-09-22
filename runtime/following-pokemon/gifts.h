#ifndef FOLLOWING_GIFTS_H
#define FOLLOWING_GIFTS_H
#include "reactions.h"
/* Reads the low ten legacy metadata bits in logical PK5 Block C. All helpers
 * preserve ciphertext/fast-mode state and fail closed on malformed party data. */
int fwg_claims(void *gameData,const FwrSnapshot *snapshot,uint16_t *out);
/* 1 success, 0 full bag/invalid item, -1 stale or malformed party member. */
int fwg_grant(void *gameData,const FwrSnapshot *snapshot,const FwrItemChoice *choice);
#endif
