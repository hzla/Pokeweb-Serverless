# Desmond Savestate Core Patch

The bundled Desmond runtime in `public/desmond/` is built from the
`44670/desmume-wasm` DeSmuME WASM port, plus small patches for Pokeweb's test
battle emulator.

Pokeweb requires a real DeSmuME `.dst` savestate export so the browser emulator
can download compact save states and immediately reload the most recently
exported state in the same tab.

## Added Core API

Patch `desmume/wasm-port/main.cpp`:

```cpp
#include "saves.h"

EMUFILE_MEMORY *stateFile = new EMUFILE_MEMORY();

int stateGetSize()
{
    return stateFile->size();
}

void *stateGetPointer(int desiredSize)
{
    if (desiredSize > 0) {
        stateFile->truncate(desiredSize);
        stateFile->fseek(0, SEEK_SET);
    }
    return stateFile->buf();
}

int saveState(int compressionLevel)
{
    stateFile->truncate(0);
    stateFile->fseek(0, SEEK_SET);
    if (!savestate_save(*stateFile, compressionLevel)) {
        stateFile->truncate(0);
        return -1;
    }
    stateFile->fseek(0, SEEK_SET);
    return stateFile->size();
}

int loadState(void *stateBuffer)
{
    if (stateBuffer == NULL || stateFile->size() <= 0)
        return 0;
    stateFile->fseek(0, SEEK_SET);
    return savestate_load(*stateFile) ? 1 : 0;
}
```

Export these functions from Emscripten:

```text
_stateGetSize
_stateGetPointer
_saveState
_loadState
```

`loadState` receives a pointer for the JavaScript ABI, but the core loads from
the shared `stateFile`; JavaScript writes incoming bytes through
`stateGetPointer(size)` before calling it.

## Browser Contract

The test battle emulator calls:

1. `Module._saveState(1)` for a fast zlib-compressed `.dst`.
2. `Module._stateGetSize()` to get the exact byte length.
3. `Module._stateGetPointer(0)` and `Module.HEAPU8` to copy the state out.

For loading the last exported state in-tab, the emulator calls
`Module._stateGetPointer(state.length)`, copies the `.dst` bytes into WASM
memory, then calls `Module._loadState(pointer)`.

The TypeScript side validates the DeSmuME state header before accepting exported
or reloaded bytes.

The bundled core must also return `1` from `loadROM` after a successful
`NDS_LoadROM` call, because the existing Desmond player wrapper treats any other
return value as a load failure. If this accidentally returns `0`, ROM loading
can appear to fail even after the core has accepted the ROM.

## Secure Area Decryption

The upstream WASM fork currently has a stubbed `DecryptSecureArea`
implementation. That can cause encrypted or partially encrypted ROMs to fail
during `NDS_LoadROM`, or to depend on every uploaded ROM already being decrypted.

The bundled core restores the real DeSmuME secure-area decrypt implementation in
`desmume/src/utils/decrypt/decrypt.cpp`, with the return type adapted to this
WASM fork's boolean `DecryptSecureArea` ABI. Invalid ROMs or failed decrypts
return `false`; already decrypted ROMs, successfully decrypted ROMs, and ROMs
without a secure area return `true`.
