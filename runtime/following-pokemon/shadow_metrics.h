#ifndef FW_SHADOW_METRICS_H
#define FW_SHADOW_METRICS_H
#include <stdint.h>
typedef struct {
 int (*read)(void *context,unsigned offset,void *output,unsigned size);
 void *context;
 unsigned size;
} FwnShadowInput;
/* Inspect the installed appearance, including replacement artwork. The maximum
 * opaque width across its frames produces one stable diameter in world units.
 * Unsupported/corrupt resources leave the native shadow size in place. */
int fwn_shadow_measure(const FwnShadowInput *input,unsigned resource,unsigned *diameter);
#endif
