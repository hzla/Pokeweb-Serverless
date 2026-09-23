#ifndef FW_REGISTRY_H
#define FW_REGISTRY_H
#include <stdint.h>
#include <stddef.h>
int fw_registry_validate(const uint8_t *data, size_t size, uint16_t descriptors, uint16_t resources);
#define FW_REGISTRY_PAGE 1024u
/* Callback/context are borrowed for one synchronous validation only. */
typedef struct {
 int (*read)(void*,unsigned,void*,unsigned);
 void *context;
 uint8_t *page;
 uint16_t *index;
 unsigned indexCount,size;
 uint32_t outerCrc;
 uint16_t descriptors,resources,count,stride;
} FwRegistryInput;
int fw_registry_stream(FwRegistryInput *in);
#endif
