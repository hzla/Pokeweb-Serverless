.thumb

// Battle logging owns normal save blocks 29-31. White 2 otherwise mirrors
// block 30 (Pal Pad / Wi-Fi List) through a heap buffer and copies that stale
// buffer over the battle log immediately before every save. The battle-log
// installer explicitly retires those incompatible Wi-Fi features, so make the
// shared copy routine a no-op instead of introducing an always-resident branch
// from ARM9 into the unloadable battle-log DLL.
.type FULL_COPY_copyWifilist, %function
FULL_COPY_copyWifilist:
    bx lr
.size FULL_COPY_copyWifilist, . - FULL_COPY_copyWifilist
