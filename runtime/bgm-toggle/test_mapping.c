#include <assert.h>
#include <stdio.h>
#include "mapping.c"

int main(void)
{
    struct {
        uint32_t magic;
        uint16_t version, flags;
        uint32_t offset;
        uint16_t count, stride;
        uint32_t reserved[4];
        uint16_t entries[512][5];
    } config = { .magic = 0x53424750, .version = 2, .flags = 2,
                 .offset = 32, .count = 512, .stride = 10 };
    assert((const uint8_t *)config.entries - (const uint8_t *)&config == 32);
    for (uint32_t i = 0; i < 512; i++) {
        config.entries[i][0] = 1000 + i * 2;
        config.entries[i][1] = i + 1;
    }
    for (uint32_t i = 0; i < 512; i++) {
        assert(PokewebFindBgmStream(&config, 1000 + i * 2) == i + 1);
        assert(PokewebFindBgmStream(&config, 1001 + i * 2) == 0xffff);
    }
    assert(PokewebFindBgmStream(&config, 0) == 0xffff);
    assert(PokewebFindBgmStream(&config, 999) == 0xffff);
    assert(PokewebFindBgmStream(&config, 0xffff) == 0xffff);
    config.count = 0;
    assert(PokewebFindBgmStream(&config, 1000) == 0xffff);
    config.count = 512;
    config.flags = 1;
    assert(PokewebFindBgmStream(&config, 1000) == 0xffff);
    config.flags = 2;
    config.version = 1;
    assert(PokewebFindBgmStream(&config, 1000) == 0xffff);
    puts("BGM mapping lookup: 512 entries, misses, boundaries, disabled and legacy configs passed");
    return 0;
}
