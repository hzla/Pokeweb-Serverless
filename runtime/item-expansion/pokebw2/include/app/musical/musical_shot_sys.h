#ifndef POKEBW2_APP_MUSICAL_MUSICAL_SHOT_SYS_H
#define POKEBW2_APP_MUSICAL_MUSICAL_SHOT_SYS_H

// Overlay 209's musical_shot_sys.c: the proc that shows a musical's photo

#include "types.h"
#include "gfl/proc.h"
#include "save/musical_savedata.h"
#include "save/save_control.h"
#include "struct_decls.h"

typedef struct {
    // Whether the touch screen asks to keep the photo in the save, after a musical, rather than showing a return
    // button
    BOOL askSave;
    // Whether to load the musical's communication overlay, 211, and its data overlay, 210
    BOOL loadComm;
    BOOL loadData;
    MusicalShot *shot;
    MusicalSave *save;
    // Overlay 211's communication work
    void *comm;
} MusicalShotParam;

extern GameProcFunctions MUSICAL_SHOT_PROC_FUNCTIONS;

#endif // POKEBW2_APP_MUSICAL_MUSICAL_SHOT_SYS_H
