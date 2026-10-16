#ifndef POKEWEB_BW1_STREAM_CORE_H
#define POKEWEB_BW1_STREAM_CORE_H
#include <stdint.h>

/* read() is bounded to the selected STRM, never to the containing ROM. */
typedef int (*PwStreamRead)(void *, uint32_t, void *, uint32_t);
typedef struct {
    PwStreamRead read;
    void *context;
    uint32_t length, data, samples, loopStart, blocks, blockBytes, blockSamples;
    uint32_t lastBytes, lastSamples, position, cachedBlock;
    uint16_t rate, timer;
    uint8_t format, channels, loop, failed;
    int16_t decoded[2][960];
    uint8_t encoded[484];
} PwStream;

int PwStreamOpen(PwStream *, PwStreamRead, void *, uint32_t);
int PwStreamSeek(PwStream *, uint32_t);
/* Returns source frames produced; a non-looping tail is padded with silence. */
uint32_t PwStreamReadFrames(PwStream *, int16_t *, int16_t *, uint32_t);
#endif
