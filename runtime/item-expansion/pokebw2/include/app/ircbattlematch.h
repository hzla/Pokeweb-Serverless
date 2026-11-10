#ifndef POKEBW2_APP_IRCBATTLEMATCH_H
#define POKEBW2_APP_IRCBATTLEMATCH_H

#include "types.h"
#include "gfl/net.h"
#include "gfl/overlay.h"
#include "gfl/proc.h"
#include "struct_decls.h"

// Overlay 174's ircbattlematch.c, named after its string: the infrared match screen. The players hold their consoles
// together, the screen exchanges their modes, trainer data and parties over the infrared link, and checks that they
// chose the same thing. The infrared menu's battles, trade and friend codes, the musical show and the Battle Subway
// all go through it

#define OVERLAY_IRCBATTLEMATCH OVERLAY_ID(174)

// What the screen is for, in IrcBattleMatchParam.result when it starts, which the infrared menu or the script picks
enum {
    IRCBATTLEMATCH_MODE_SINGLE = 1,
    IRCBATTLEMATCH_MODE_DOUBLE,
    IRCBATTLEMATCH_MODE_TRIPLE,
    IRCBATTLEMATCH_MODE_ROTATION,
    // Four players
    IRCBATTLEMATCH_MODE_MULTI,
    IRCBATTLEMATCH_MODE_TRADE,
    // Exchanging friend codes
    IRCBATTLEMATCH_MODE_FRIEND,
    // The musical, started by script command 18 with an argument of 0 or not
    IRCBATTLEMATCH_MODE_MUSICAL_ARG0 = 9,
    IRCBATTLEMATCH_MODE_MUSICAL_ARG1,
    IRCBATTLEMATCH_MODE_BSUBWAY,
};

// What it leaves in IrcBattleMatchParam.result when it ends, other than the mode that was chosen: the players
// quit or the link failed, or they went back to the infrared menu. The Battle Subway has these two only
#define IRCBATTLEMATCH_RESULT_QUIT 12
#define IRCBATTLEMATCH_RESULT_BACK 13

typedef struct {
    GameData *gameData;
    PokeParty *party;
    // The parties of the infrared players, by net ID
    PokeParty *parties[4];
    // Each infrared player's place, by net ID
    u8 order[4];
    // The mode the screen starts in (IRCBATTLEMATCH_MODE_*), and what it was left with: a mode the players agreed
    // on, which is the lowest of theirs for the battles, or IRCBATTLEMATCH_RESULT_*
    int result;
    // The musical's network setup, whose player count and packet size the screen uses in its two modes
    const GFLNetInitData *musicalNetInit;
    // Set when the network failed
    BOOL netError;
} IrcBattleMatchParam;

extern const GameProcFunctions IRCBATTLEMATCH_PROC_FUNCTIONS;

#endif // POKEBW2_APP_IRCBATTLEMATCH_H
