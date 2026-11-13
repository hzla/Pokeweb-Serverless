// Pokeweb species expansion (Black 2 / White 2): species past Genesect, numbered after retail's sentinels.
//
// Retail uses species 650 (Egg), 651 (Bad Egg), 652-684 (Pokéstar Studios actors) and 685-686 (two more Egg names),
// and checks for an Egg against 650. The added species keep all of that: species 687 onwards, national number + 37
// (Chespin 687 ... Pecharunt 1062). Pokeweb moves the form records and the regional Pokédex file past them, so their
// personal, learnset and evolution records are at their own number, as retail's are; their names, baby species and
// egg moves are at their own number too. What retail can't find by number is here:
//
// - PW_SPECIES_CORE (ARM9, resident): sprites (GetPokemonDataIDBase) and icons (PokeParty_GetIconIndex,
//   PokeIcon_GetPalette) from a sprite block of the table; cries (getResIDFunc, getWaveInfoFunc) from a retail
//   species of the table, a placeholder; the regional Pokédex table (PML_PersonalLoadRegionalDexTable) from the
//   moved file; battle rules' banned species (Regulation_CheckParamBit), whose bits stop at 655. Each replaces the retail function; outside the added species they do what retail does (pokebw2's
//   decomp: src/system/pokegra.c, poke_icon.c, pm_voice.c, poke_personal.c).
// - PW_SPECIES_SUMMARY (overlay 207) and PW_SPECIES_BOX (overlay 255): the summary's and the box's Pokédex number,
//   national (number - 37) for an added species.
//
// The table (sSpecies, "PWSX") is written by Pokeweb (src/pokeweb/speciesExpansionModel.ts).
#include "hooks.h"

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef int BOOL;
typedef int s32;
typedef short s16;
#define TRUE 1
#define FALSE 0

#define FIRST_ADDED 687
#define NATIONAL_OFFSET 37
#define LAST_POSSIBLE 2047

#ifdef PW_SPECIES_CORE
#define CAPACITY 400
#define SPECIES_MANAPHY 490
#define SPECIES_EGG 650

// pokegra.c
#define ARCID_POKEGRA 4
#define POKEGRA_FILE_SINGLE_CELL_CHARS 0
#define POKEGRA_FILE_CHARS 2
#define POKEGRA_FILE_BACK 9
#define POKEGRA_FILE_COUNT 20
#define POKEGRA_EGG 683
#define POKEGRA_FORM_FILES 0x3584
#define POKEGRA_FORM_PALETTES 0x3ab9
// poke_icon.c
#define ARCID_POKEICON 7
#define POKEICON_FILE_ICONS 8
#define POKEICON_EGG 683
#define POKEICON_FORMS 685
#define POKEICON_PALETTE_EGG 685
#define POKEICON_PALETTE_FORMS 686
// pm_voice.c
#define ARCID_POKE_VOICE_DATA 191
#define POKE_VOICE_SPECIES_MAX 684
#define POKE_VOICE_DIRECT_MIN 652
#define SPECIES_CHATOT 441
#define PERAP_VOICE_DECODED_SIZE 8180
#define CHATTER_VOLUME 120
// personal.h
#define PERSONAL_FORM_SPRITE_OFFSET 31
#define PERSONAL_FORM_COUNT 32
#define PERSONAL_PALETTE_FORMS 35
#define REGIONAL_DEX_NONE 999

// cry: a retail species whose cry it uses; RESTRICTED: legendary or mythical; MYTHICAL: mythical (left out of the
// national Pokédex's completion, as retail's mythical species are).
typedef struct { u16 sprite; u16 cry; } AddedSpecies;
#define CRY_SPECIES 0x3fff
#define RESTRICTED 0x8000
#define MYTHICAL 0x4000

// {mark, version, count, regional Pokédex file, added species (FIRST_ADDED onwards)}; count 0: none.
volatile struct {
    char mark[4];
    u16 version;
    u16 count;
    u16 regionalDexFile;
    u16 reserved;
    AddedSpecies species[CAPACITY];
} sSpecies = { { 'P', 'W', 'S', 'X' }, 1, 0, 709, 0, { { 0, 0 } } };

typedef struct { u16 species; u16 form; u16 waveArc; } PokeVoiceFormEntry;
typedef struct { void *chatter; } PokeVoiceChatterInfo;
typedef struct { u16 unk0; u16 volume; } PokeVoiceData;

u32 PML_PersonalGetParamSingle(u32 species, u32 form, u32 param);
u32 GFL_ArcSysGetDataLength(u32 arcId, u32 file);
void GFL_ArcSysRead(void *dest, u32 arcId, u32 file);
void *GFL_ArcToolReadHeapNewLZGetLen(void *arc, u32 file, BOOL compressed, u32 heapId, u32 *size);
u32 GFL_RandomLC(u32 max);
BOOL doesChatotExist(void *chatter);
void *getChatterVoice(void *chatter);
void PerapVoice_Decode(void *dest, void *src);
extern const PokeVoiceFormEntry POKE_VOICE_EXTRA_ENTRIES[6];

static const volatile AddedSpecies *Added(u32 species) {
    u32 index = species - FIRST_ADDED;
    return species >= FIRST_ADDED && index < sSpecies.count && index < CAPACITY ? &sSpecies.species[index] : 0;
}

// GetPokemonDataIDBase: the first file of the sprite, the direction's and the sex's offsets.
void HOOK_POKEGRA_BASE(u32 arcId, s32 species, s32 form, u32 sex, BOOL rare, u32 dir, BOOL egg, u32 *base,
                       u32 *dirOffset, u32 *sexOffset, u32 *rareOffset, u32 *formPalette, BOOL singleCell) {
    const volatile AddedSpecies *added = egg ? 0 : Added(species);
    u32 file = (added ? added->sprite : (u32)species) * POKEGRA_FILE_COUNT;
    u32 dirFile = dir == 0 ? 0 : POKEGRA_FILE_BACK;
    u32 charsFile = (singleCell ? POKEGRA_FILE_SINGLE_CELL_CHARS : POKEGRA_FILE_CHARS) + dirFile;

    if (egg) {
        file = (POKEGRA_EGG + (species == SPECIES_MANAPHY)) * POKEGRA_FILE_COUNT;
    } else if (form != 0) {
        u32 spriteOffset = PML_PersonalGetParamSingle(species, 0, PERSONAL_FORM_SPRITE_OFFSET);
        u32 paletteForms = PML_PersonalGetParamSingle(species, 0, PERSONAL_PALETTE_FORMS);
        s32 formCount = PML_PersonalGetParamSingle(species, 0, PERSONAL_FORM_COUNT);

        if (form >= formCount) form = 0;
        if (paletteForms) {
            if (formPalette != 0 && form != 0) *formPalette = POKEGRA_FORM_PALETTES + (spriteOffset + form - 1) * 2 + rare;
        } else if (form != 0) {
            file = POKEGRA_FORM_FILES + (spriteOffset + form - 1) * POKEGRA_FILE_COUNT;
        }
    } else if (!added && species > SPECIES_EGG + 1) {
        file = (species - 2) * POKEGRA_FILE_COUNT;  // no sprites for the egg and the bad egg
    }
    if (sex == 1) sex = GFL_ArcSysGetDataLength(arcId, file + charsFile + 1) != 0 ? 1 : 0;
    else if (sex == 2) sex = 0;
    if (base) *base = file;
    if (dirOffset) *dirOffset = dirFile;
    if (sexOffset) *sexOffset = sex;
    if (rareOffset) *rareOffset = rare;
}

// PokeParty_GetIconIndex: the icon file; an added species' is its sprite block's (Pokeweb keeps icons by sprite).
u32 HOOK_ICON_INDEX(u32 species, u32 form, u32 sex, BOOL egg) {
    const volatile AddedSpecies *added = egg ? 0 : Added(species);
    u32 file = POKEICON_FILE_ICONS + (added ? added->sprite : species) * 2;

    if (egg) {
        file = POKEICON_FILE_ICONS + ((species == SPECIES_MANAPHY) + POKEICON_EGG) * 2;
    } else if (form != 0) {
        u32 formOffset = PML_PersonalGetParamSingle(species, 0, PERSONAL_FORM_SPRITE_OFFSET);
        u32 paletteForms = PML_PersonalGetParamSingle(species, 0, PERSONAL_PALETTE_FORMS);

        if (form >= PML_PersonalGetParamSingle(species, 0, PERSONAL_FORM_COUNT)) form = 0;
        if (!paletteForms && form != 0) file = (formOffset + form - 1) * 2 + (POKEICON_FILE_ICONS + POKEICON_FORMS * 2);
    }
    if (sex == 1) sex = GFL_ArcSysGetDataLength(ARCID_POKEICON, file + 1) != 0 ? 1 : 0;
    else if (sex == 2) sex = 0;
    return file + sex;
}

// PokeIcon_GetPalette: the palette of the icon, from the palette table (which Pokeweb may have moved: read through
// the retail function's literal, PALETTE_TABLE_LITERAL). Pokeweb keeps a sprite's palette at sprite + 2.
u8 HOOK_ICON_PALETTE(u32 species, u32 form, u32 sex, BOOL egg) {
    const u8 *table = *(const u8 *const *)PALETTE_TABLE_LITERAL;
    const volatile AddedSpecies *added = egg ? 0 : Added(species);
    u32 index = added ? added->sprite + 2u : species;

    if (egg) {
        index = (species == SPECIES_MANAPHY) + POKEICON_PALETTE_EGG;
    } else if (form != 0) {
        u32 formOffset = PML_PersonalGetParamSingle(species, 0, PERSONAL_FORM_SPRITE_OFFSET);
        u32 paletteForms = PML_PersonalGetParamSingle(species, 0, PERSONAL_PALETTE_FORMS);

        if (form >= PML_PersonalGetParamSingle(species, 0, PERSONAL_FORM_COUNT)) form = 0;
        if (!paletteForms && form != 0) index = formOffset + form + POKEICON_PALETTE_FORMS;
    }
    return sex != 0 ? (u8)((table[index] & 0xf0) >> 4) : (u8)(table[index] & 0xf);
}

static u32 CrySpecies(u32 species) {
    const volatile AddedSpecies *added = Added(species);
    return added ? added->cry & CRY_SPECIES : species;
}

// getResIDFunc: the wave archive of a cry.
void HOOK_CRY_RES(u32 species, u32 form, u32 *waveArc) {
    u32 i;

    species = CrySpecies(species);
    if (species < 1 || species > POKE_VOICE_SPECIES_MAX) { *waveArc = 1; return; }
    if (species >= POKE_VOICE_DIRECT_MIN) { *waveArc = species; return; }
    for (i = 0; i < 6; i++) {
        if (POKE_VOICE_EXTRA_ENTRIES[i].species == species && POKE_VOICE_EXTRA_ENTRIES[i].form == form) {
            *waveArc = POKE_VOICE_EXTRA_ENTRIES[i].waveArc;
            return;
        }
    }
    *waveArc = species;
}

// getWaveInfoFunc: the cry's volume, and Chatot's recording.
BOOL HOOK_CRY_WAVE(u32 species, u32 form, const PokeVoiceChatterInfo *chatterInfo, void **samples, u32 *size,
                   u32 *sampleRate, u32 *speed, signed char *volume) {
    PokeVoiceData data;

    species = CrySpecies(species);
    if (species < 1 || species > POKE_VOICE_SPECIES_MAX) species = 1;
    GFL_ArcSysRead(&data, ARCID_POKE_VOICE_DATA, species);
    *volume = (signed char)data.volume;
    if (chatterInfo == 0) return 0;
    if (species == SPECIES_CHATOT && form == 0 && doesChatotExist(chatterInfo->chatter) == 1) {
        PerapVoice_Decode(*samples, getChatterVoice(chatterInfo->chatter));
        *size = PERAP_VOICE_DECODED_SIZE;
        *sampleRate = PERAP_VOICE_DECODED_SIZE;
        *volume = CHATTER_VOLUME;
        *speed = GFL_RandomLC(0x2000) + 0x8000;
        return 1;
    }
    return 0;
}

// Regulation_CheckParamBit (battle rules: the Battle Subway, the PWT, link battles): a regulation's banned species bits
// stop at 655 (bannedSpecies[0x52], bannedItems follows). A restricted (legendary or mythical) added species is banned
// where the rules ban Mewtwo, another added species is allowed, and any other number past the bits is banned
// (White2Upgrade bans them all).
#define REGULATION_BANNED_SPECIES 9
#define REGULATION_BANNED_ITEMS 10
#define REGULATION_BITS_AC 14
#define REGULATION_BANNED_SPECIES_BITS (0x52 * 8)
#define SPECIES_MEWTWO 150
BOOL HOOK_REGULATION_BIT(const u8 *regulation, u32 param, s32 index) {
    const u8 *bits;

    switch (param) {
    case REGULATION_BANNED_SPECIES:
        bits = regulation + 0x0a;
        if ((u32)index >= REGULATION_BANNED_SPECIES_BITS) {
            const volatile AddedSpecies *added = Added((u32)index);
            if (added == 0) return 1;
            return (added->cry & RESTRICTED) != 0 && (bits[SPECIES_MEWTWO / 8] & (1 << (SPECIES_MEWTWO % 8))) != 0;
        }
        break;
    case REGULATION_BANNED_ITEMS:
        bits = regulation + 0x5c;
        break;
    case REGULATION_BITS_AC:
        bits = regulation + 0xac;
        break;
    default:
        return 0;
    }
    return (bits[index / 8] & (1 << (index % 8))) != 0;
}

// PML_PersonalLoadRegionalDexTable: the regional Pokédex numbers, from the moved file.
u16 *HOOK_REGIONAL_DEX(u32 heapId, u16 *count) {
    u32 size;
    u16 *table = GFL_ArcToolReadHeapNewLZGetLen(((void *const *)PERSONAL_ARC_HANDLES)[0], sSpecies.regionalDexFile, 0, heapId, &size);

    if (count != 0) {
        u16 found = 0;
        u32 i;
        for (i = 0; i < size / 2; i++) {
            if (table[i] != REGIONAL_DEX_NONE) found++;
        }
        *count = found;
    }
    return table;
}

// ---- The Pokédex (pokedex.c). Its lists are bits by national number - 1: retail's (0x54 bytes, numbers 1-672) hold
// 1-649 and the added species up to 672; the rest (673-1025) are in the area retail keeps for the other languages'
// entries (7 bits for each of species 1-493, 0x1b0 bytes), nine lists of 45 bytes in the order of retail's: caught, seen
// (male, female, shiny male, shiny female), shown (the same). The area's last word holds DEX_EXT_MAGIC: without it
// (a save from before the expansion) the area is cleared first, so a save's language bits never read as species. The
// other languages' entries are not kept. Everything else is retail's layout.
#define DEX_LISTS_OFFSET 0x08
#define DEX_SEEN_FORMS_OFFSET 0x2fc
#define DEX_SHOWN_FORMS_OFFSET 0x312
#define DEX_LIST_BYTES 0x54
#define DEX_LIST_BITS (DEX_LIST_BYTES * 8)
#define DEX_EXT_OFFSET 0x328
#define DEX_EXT_SIZE 0x1b0
#define DEX_EXT_LIST_BYTES 45
#define DEX_EXT_MAGIC_OFFSET (DEX_EXT_OFFSET + DEX_EXT_SIZE - 4)
#define DEX_EXT_MAGIC 0x58445750 // "PWDX"
#define DEX_FORM_BYTES 0x0b
#define DEX_CAUGHT 0
#define DEX_SEEN 1
#define DEX_SHOWN 5
#define DEX_KIND_MALE 0
#define DEX_KIND_FEMALE 1
#define DEX_KIND_RARE_MALE 2
#define DEX_KIND_RARE_FEMALE 3
#define DEX_FLAGS_OFFSET 0x04
#define DEX_FLAG_GIVEN (1 << 2)
#define DEX_LAST_SPECIES_SHIFT 12
#define DEX_LAST_SPECIES_MASK 0x7ff // retail's 10 bits and the unused bit after them
#define DEX_MAGIC 0xbeefcafe
#define DEX_SIZE 0x4dc
#define DEX_NATIONAL_COMPLETE 636 // retail's: species 1-649 but the 13 mythical ones
#define SPECIES_LAST_RETAIL 649
#define SPECIES_SPINDA 327
#define PKM_PARAM_PID 0x00
#define PKM_PARAM_SPECIES 0x05
#define PKM_PARAM_IS_EGG 0x4c
#define PKM_PARAM_FORM 0x6f
#define PERSONAL_SEX_RATIO 20
#define SEX_RATIO_GENDERLESS 0xff

typedef struct { u16 species; u16 count; } DexFormEntry;
extern const DexFormEntry pokemonFormList[];
BOOL PokeParty_DecryptPkm(void *pkm);
BOOL PokeParty_EncryptPkm(void *pkm, BOOL wasEncrypted);
u32 PokeParty_GetParam(const void *pkm, u32 param, void *buffer);
u8 PokeParty_GetSex(void *pkm);
BOOL PokeParty_IsRare(void *pkm);
void getForm(u8 *dex, u32 species, u32 sex, BOOL rare, u32 form);
BOOL PML_PkmIsNationalDexExclude(u16 species);
void *PML_PersonalLoad(u32 species, u32 form, u32 heapId);
u32 PML_PersonalGetParam(void *personal, u32 param);
void PML_PersonalFree(void *personal);

// The national number of a species, or 0 for none (an egg, a Pokéstar actor, a number past the added species).
static u32 DexIndex(u32 species) {
    if (species >= 1 && species <= SPECIES_LAST_RETAIL) return species;
    return Added(species) ? species - NATIONAL_OFFSET : 0;
}

static void DexExtReady(u8 *dex) {
    u32 i;

    if (*(u32 *)(dex + DEX_EXT_MAGIC_OFFSET) == DEX_EXT_MAGIC) return;
    for (i = 0; i < DEX_EXT_SIZE - 4; i++) dex[DEX_EXT_OFFSET + i] = 0;
    *(u32 *)(dex + DEX_EXT_MAGIC_OFFSET) = DEX_EXT_MAGIC;
}

static u8 *DexByte(u8 *dex, u32 list, u32 index, u8 *mask) {
    u32 bit = index - 1;
    u8 *base;

    if (bit < DEX_LIST_BITS) {
        base = dex + DEX_LISTS_OFFSET + list * DEX_LIST_BYTES;
    } else {
        DexExtReady(dex);
        bit -= DEX_LIST_BITS;
        base = dex + DEX_EXT_OFFSET + list * DEX_EXT_LIST_BYTES;
    }
    *mask = (u8)(1 << (bit & 7));
    return base + (bit >> 3);
}

static BOOL DexCheck(u8 *dex, u32 list, u32 index) {
    u8 mask;
    return (*DexByte(dex, list, index, &mask) & mask) != 0;
}

static void DexSet(u8 *dex, u32 list, u32 index) {
    u8 mask;
    u8 *byte = DexByte(dex, list, index, &mask);
    *byte |= mask;
}

static void DexClear(u8 *dex, u32 list, u32 index) {
    u8 mask;
    u8 *byte = DexByte(dex, list, index, &mask);
    *byte &= (u8)~mask;
}

static void SetBitAt(u8 *bits, u32 index) {
    bits[index >> 3] |= (u8)(1 << (index & 7));
}

static BOOL CheckBitAt(const u8 *bits, u32 index) {
    return (bits[index >> 3] & (1 << (index & 7))) != 0;
}

// The kind of a sex and shininess (a genderless Pokémon is listed as male).
static u32 DexKind(u32 sex, BOOL rare) {
    return (sex == 1 ? DEX_KIND_FEMALE : DEX_KIND_MALE) + (rare == TRUE ? DEX_KIND_RARE_MALE : 0);
}

// The first bit of a species' forms in the form lists, its entry in pokemonFormList (or -1).
static int DexFormEntryOf(u32 species, int *firstBit) {
    int i = 0, bit = 0;

    do {
        if (species == pokemonFormList[i].species) {
            *firstBit = bit;
            return i;
        }
        bit += pokemonFormList[i].count;
        i++;
    } while (pokemonFormList[i].species != 0);
    return -1;
}

void HOOK_DEX_INIT(u8 *dex) {
    u32 i;

    for (i = 0; i < DEX_SIZE; i++) dex[i] = 0;
    *(u32 *)dex = DEX_MAGIC;
    *(u32 *)(dex + DEX_FLAGS_OFFSET) = DEX_FLAG_GIVEN;
    *(u32 *)(dex + DEX_EXT_MAGIC_OFFSET) = DEX_EXT_MAGIC;
}

BOOL HOOK_DEX_BAD_SPECIES(u16 species) {
    return DexIndex(species) == 0;
}

BOOL HOOK_DEX_IS_CAUGHT(u8 *dex, u16 species) {
    u32 index = DexIndex(species);
    return index != 0 && DexCheck(dex, DEX_CAUGHT, index);
}

BOOL HOOK_DEX_IS_SEEN(u8 *dex, u16 species) {
    u32 index = DexIndex(species), kind;

    if (index == 0) return FALSE;
    for (kind = 0; kind < 4; kind++) {
        if (DexCheck(dex, DEX_SEEN + kind, index)) return TRUE;
    }
    return FALSE;
}

// addToDex: the form, sex and shininess the Pokédex shows of a species.
void HOOK_DEX_ADD(u8 *dex, u16 species, u32 sex, BOOL rare, u32 form) {
    u32 index = DexIndex(species), kind, j;
    int firstBit, entry = DexFormEntryOf(species, &firstBit);

    if (index == 0) return;
    if (entry != -1) {
        u8 *normal = dex + DEX_SHOWN_FORMS_OFFSET, *shiny = normal + DEX_FORM_BYTES;
        u32 count = pokemonFormList[entry].count;

        for (j = 0; j < count; j++) {
            u32 bit = firstBit + j;
            normal[bit >> 3] &= (u8)~(1 << (bit & 7));
            shiny[bit >> 3] &= (u8)~(1 << (bit & 7));
        }
        if (form >= count) form = 0;
        SetBitAt(rare == TRUE ? shiny : normal, firstBit + form);
    }
    for (kind = 0; kind < 4; kind++) DexClear(dex, DEX_SHOWN + kind, index);
    DexSet(dex, DEX_SHOWN + DexKind(sex, rare), index);
}

void HOOK_DEX_SHOWN(u8 *dex, u16 species, u32 *sex, u32 *rare, u32 *form, u32 heapId) {
    u32 index = DexIndex(species), i;
    int firstBit, entry = DexFormEntryOf(species, &firstBit);
    void *personal;

    if (index == 0) {
        *form = 0;
    } else if (entry != -1) {
        const u8 *normal = dex + DEX_SHOWN_FORMS_OFFSET, *shiny = normal + DEX_FORM_BYTES;

        for (i = 0; i < pokemonFormList[entry].count; i++) {
            if (CheckBitAt(normal, firstBit + i)) { *form = i; *rare = FALSE; break; }
            if (CheckBitAt(shiny, firstBit + i)) { *form = i; *rare = TRUE; break; }
        }
        if (DexCheck(dex, DEX_SHOWN + DEX_KIND_MALE, index) || DexCheck(dex, DEX_SHOWN + DEX_KIND_RARE_MALE, index)) *sex = 0;
        if (DexCheck(dex, DEX_SHOWN + DEX_KIND_FEMALE, index) || DexCheck(dex, DEX_SHOWN + DEX_KIND_RARE_FEMALE, index)) *sex = 1;
    } else {
        *form = 0;
        if (DexCheck(dex, DEX_SHOWN + DEX_KIND_MALE, index)) { *sex = 0; *rare = FALSE; }
        if (DexCheck(dex, DEX_SHOWN + DEX_KIND_FEMALE, index)) { *sex = 1; *rare = FALSE; }
        if (DexCheck(dex, DEX_SHOWN + DEX_KIND_RARE_MALE, index)) { *sex = 0; *rare = TRUE; }
        if (DexCheck(dex, DEX_SHOWN + DEX_KIND_RARE_FEMALE, index)) { *sex = 1; *rare = TRUE; }
    }
    personal = PML_PersonalLoad(species, *form, heapId);
    if (PML_PersonalGetParam(personal, PERSONAL_SEX_RATIO) == SEX_RATIO_GENDERLESS) *sex = 2;
    PML_PersonalFree(personal);
}

BOOL HOOK_DEX_HAS_SEEN_VARIANT(u8 *dex, u16 species, u32 sex, BOOL rare, u32 form) {
    u32 index = DexIndex(species);
    int firstBit;

    if (index == 0) return -1;
    if (DexFormEntryOf(species, &firstBit) != -1) {
        return CheckBitAt(dex + DEX_SEEN_FORMS_OFFSET + (rare ? DEX_FORM_BYTES : 0), firstBit + form);
    }
    if (sex == 0 || sex == 1) return DexCheck(dex, DEX_SEEN + DexKind(sex, rare), index);
    return DexCheck(dex, DEX_SEEN + DexKind(0, rare), index) || DexCheck(dex, DEX_SEEN + DexKind(1, rare), index);
}

// addPkmToDex (caught) and PokeDex_RegistPkm (seen): retail's, without the other languages' bits.
static void DexRegister(u8 *dex, void *pkm, BOOL caught) {
    BOOL wasEncrypted = PokeParty_DecryptPkm(pkm);
    u32 species, pid, form, sex, index;
    BOOL rare;

    if (PokeParty_GetParam(pkm, PKM_PARAM_IS_EGG, 0) == TRUE) {
        PokeParty_EncryptPkm(pkm, wasEncrypted);
        return;
    }
    species = PokeParty_GetParam(pkm, PKM_PARAM_SPECIES, 0);
    pid = PokeParty_GetParam(pkm, PKM_PARAM_PID, 0);
    form = PokeParty_GetParam(pkm, PKM_PARAM_FORM, 0);
    sex = PokeParty_GetSex(pkm);
    rare = PokeParty_IsRare(pkm);
    PokeParty_EncryptPkm(pkm, wasEncrypted);
    index = DexIndex(species);
    if (index == 0) return;
    if (!HOOK_DEX_IS_SEEN(dex, species)) HOOK_DEX_ADD(dex, species, sex, rare, form);
    if (species == SPECIES_SPINDA && *(u32 *)(dex + DEX_SIZE - 4) == 0) *(u32 *)(dex + DEX_SIZE - 4) = pid;
    DexSet(dex, DEX_SEEN + DexKind(sex, rare), index);
    getForm(dex, species, sex, rare, form);
    if (caught) DexSet(dex, DEX_CAUGHT, index);
}

void HOOK_DEX_ADD_CAUGHT(u8 *dex, void *pkm) { DexRegister(dex, pkm, TRUE); }
void HOOK_DEX_ADD_SEEN(u8 *dex, void *pkm) { DexRegister(dex, pkm, FALSE); }

BOOL HOOK_DEX_HAS_LANGUAGE(u8 *dex, u16 species, u32 language) {
    return FALSE; // the area holds the added species' lists
}

static u32 DexSpeciesAt(u32 n) {
    return n <= SPECIES_LAST_RETAIL ? n : FIRST_ADDED + (n - SPECIES_LAST_RETAIL - 1);
}

static u32 DexSpeciesCount(void) {
    return SPECIES_LAST_RETAIL + sSpecies.count;
}

u16 HOOK_DEX_CAUGHT_NATIONAL(u8 *dex) {
    u32 n, count = 0;
    for (n = 1; n <= DexSpeciesCount(); n++) count += HOOK_DEX_IS_CAUGHT(dex, DexSpeciesAt(n)) ? 1 : 0;
    return count;
}

u16 HOOK_DEX_SEEN_NATIONAL(u8 *dex) {
    u32 n, count = 0;
    for (n = 1; n <= DexSpeciesCount(); n++) count += HOOK_DEX_IS_SEEN(dex, DexSpeciesAt(n)) ? 1 : 0;
    return count;
}

// Mythical species don't count for the national Pokédex's completion (retail's NATIONAL_DEX_COMPLETION_EXCLUSIONS).
static BOOL DexCounts(u32 species) {
    const volatile AddedSpecies *added = Added(species);
    return added ? (added->cry & MYTHICAL) == 0 : PML_PkmIsNationalDexExclude(species);
}

u16 HOOK_DEX_CAUGHT_PERMISSIVE(u8 *dex) {
    u32 n, count = 0;
    for (n = 1; n <= DexSpeciesCount(); n++) {
        u32 species = DexSpeciesAt(n);
        if (HOOK_DEX_IS_CAUGHT(dex, species) && DexCounts(species)) count++;
    }
    return count;
}

BOOL HOOK_DEX_COMPLETE_NATIONAL(u8 *dex) {
    u32 i, needed = DEX_NATIONAL_COMPLETE;
    for (i = 0; i < sSpecies.count && i < CAPACITY; i++) needed += (sSpecies.species[i].cry & MYTHICAL) == 0;
    return HOOK_DEX_CAUGHT_PERMISSIVE(dex) >= needed;
}

void HOOK_DEX_SET_LAST(u8 *dex, u16 species) {
    u32 *flags = (u32 *)(dex + DEX_FLAGS_OFFSET);
    *flags = (*flags & ~((u32)DEX_LAST_SPECIES_MASK << DEX_LAST_SPECIES_SHIFT)) | ((species & DEX_LAST_SPECIES_MASK) << DEX_LAST_SPECIES_SHIFT);
}

u16 HOOK_DEX_GET_LAST(u8 *dex) {
    return (*(u32 *)(dex + DEX_FLAGS_OFFSET) >> DEX_LAST_SPECIES_SHIFT) & DEX_LAST_SPECIES_MASK;
}
#endif

#if defined(PW_SPECIES_SUMMARY) || defined(PW_SPECIES_BOX) || defined(PW_SPECIES_DEX_INFO) || defined(PW_SPECIES_DEX_LIST)
void WordSetNumber(void *wordSet, u32 index, u32 number, u32 digits, u32 style, u32 codeType);

static u32 National(u32 number) {
    return number >= FIRST_ADDED && number <= LAST_POSSIBLE ? number - NATIONAL_OFFSET : number;
}

// The Pokédex number: an added species' national number (four digits from 1000).
void HOOK_DEX_NUMBER(void *wordSet, u32 index, u32 number, u32 digits, u32 style, u32 codeType) {
    number = National(number);
    WordSetNumber(wordSet, index, number, number >= 1000 && digits < 4 ? 4 : digits, style, codeType);
}
#endif

#ifdef PW_SPECIES_DEX_LIST
// ---- The Pokédex's list (overlay 299, zknlist_main.c). Retail keeps every item's name in ZknListWork.names[649] (+0x64),
// which an expanded list would overrun: the list is set up without them, and a row loads its name when it is printed
// (the print queue copies the string). Retail's offsets: ZknListWork param +0x00, msgData +0x54, frameList +0xc50,
// listRows +0xc58; ZukanListParam pokedex +0x04, count +0x0a, list +0x0c.
#define ARCID_ZUKAN_GRA 157
#define HEAPID_ZUKAN_LIST 0x6b
#define HEAPID_TAIL_BIT 0x8000
#define LIST_ROWS 7
#define ITEM_SPECIES_MASK 0x0fffffff
#define ITEM_STATE_SHIFT 28
#define ITEM_SEEN (1u << ITEM_STATE_SHIFT)
#define ITEM_CAUGHT (2u << ITEM_STATE_SHIFT)
#define MSG_UNSEEN 7 // GameStart3_Text_Empty_3

typedef struct {
    u8 layout[0x14];
    u16 count;
    u16 screenCount;
    u8 cursorPos;
    u8 visibleRows;
    u16 scroll;
    const void *touch;
    const void *callbacks;
    void *work;
} FrameListSetup;

extern const FrameListSetup sZknListSetup;
extern void *g_PMLSpeciesNamesResident;
void *GFL_ArcSysCreateFileHandle(u32 arcId, u32 heapId);
void GFL_ArcToolFree(void *arc);
u16 PokeDex_GetLastSpecies(void *dex);
BOOL PokeDex_IsCaught(void *dex, u16 species);
BOOL PokeDex_IsSeen(void *dex, u16 species);
void *FrameList_Create(const FrameListSetup *setup, u32 heapId);
void FrameList_LoadScreen(void *list, void *arc, u32 file, BOOL compressed, u32 index);
void FrameList_LoadCursorPalette(void *list, void *arc, u32 file, u32 a, u32 b);
void FrameList_AddItem(void *list, u32 type, u32 value);
void FrameList_Free(void *list);
u32 FrameList_GetValue(void *list, u32 index);
void *GFL_MsgDataLoadStrbufNew(void *msgData, u32 id);
void GFL_StrBufFree(void *strbuf);
void ZknListBmp_PrintItem(void *wk, void *window, void *name, u32 species);
void ZknListObj_PutIcon(void *wk, u32 species, s16 y, BOOL firstBG);

#define WK_PARAM(wk) (*(u8 **)(wk))
#define WK_MSG_DATA(wk) (*(void **)((wk) + 0x54))
#define WK_FRAME_LIST(wk) (*(void **)((wk) + 0xc50))
#define WK_LIST_ROWS(wk) (*(u32 *)((wk) + 0xc58))
#define PARAM_DEX(param) (*(void **)((param) + 0x04))
#define PARAM_COUNT(param) (*(u16 *)((param) + 0x0a))
#define PARAM_LIST(param) (*(u16 **)((param) + 0x0c))

// ZknListMain_InitList: retail's, without the names; the list holds as many items as it is given.
void HOOK_LIST_INIT(u8 *wk) {
    u8 *param = WK_PARAM(wk);
    void *arc = GFL_ArcSysCreateFileHandle(ARCID_ZUKAN_GRA, HEAPID_ZUKAN_LIST | HEAPID_TAIL_BIT);
    u16 last = PokeDex_GetLastSpecies(PARAM_DEX(param)), count = PARAM_COUNT(param);
    const u16 *list = PARAM_LIST(param);
    FrameListSetup setup = sZknListSetup;
    void *frameList;
    u32 i;

    setup.count = count;
    setup.work = wk;
    // The cursor goes on the species that the Pokédex was last on
    for (i = 0; i < count; i++) {
        if (last != list[i]) continue;
        if (i > (u32)(count - LIST_ROWS)) {
            setup.cursorPos = i - (count - LIST_ROWS);
            setup.scroll = i - setup.cursorPos;
        } else if (i < LIST_ROWS) {
            setup.cursorPos = i;
        } else {
            setup.scroll = i;
        }
        break;
    }
    frameList = FrameList_Create(&setup, HEAPID_ZUKAN_LIST);
    WK_FRAME_LIST(wk) = frameList;
    WK_LIST_ROWS(wk) = count < LIST_ROWS ? count : LIST_ROWS;
    FrameList_LoadScreen(frameList, arc, 68, FALSE, 0);
    FrameList_LoadScreen(frameList, arc, 69, FALSE, 1);
    FrameList_LoadScreen(frameList, arc, 70, FALSE, 2);
    FrameList_LoadCursorPalette(frameList, arc, 49, 2, 3);
    GFL_ArcToolFree(arc);
    for (i = 0; i < count; i++) {
        if (PokeDex_IsCaught(PARAM_DEX(param), list[i]) == TRUE) FrameList_AddItem(frameList, 0, list[i] | ITEM_CAUGHT);
        else if (PokeDex_IsSeen(PARAM_DEX(param), list[i]) == TRUE) FrameList_AddItem(frameList, 1, list[i] | ITEM_SEEN);
        else FrameList_AddItem(frameList, 2, list[i]);
    }
}

// ZknListMain_ExitList
void HOOK_LIST_EXIT(u8 *wk) {
    FrameList_Free(WK_FRAME_LIST(wk));
}

// ZknListMain_ListPrint: the row's name, loaded for the print.
void HOOK_LIST_PRINT(u8 *wk, u32 index, void *window, s16 y, BOOL firstBG) {
    u32 value = FrameList_GetValue(WK_FRAME_LIST(wk), index);
    u32 species = value & ITEM_SPECIES_MASK;
    BOOL known = (value >> ITEM_STATE_SHIFT) != 0;
    void *name = known ? GFL_MsgDataLoadStrbufNew(g_PMLSpeciesNamesResident, species) : GFL_MsgDataLoadStrbufNew(WK_MSG_DATA(wk), MSG_UNSEEN);

    ZknListBmp_PrintItem(wk, window, name, species);
    GFL_StrBufFree(name);
    if (known) ZknListObj_PutIcon(wk, (u16)species, y, firstBG);
}

// The seen, caught and search counts (a hook at each WordSetNumber call): four digits from 1000.
static void DexCount(void *wordSet, u32 index, u32 number, u32 digits, u32 style, u32 codeType) {
    WordSetNumber(wordSet, index, number, number >= 1000 && digits < 4 ? 4 : digits, style, codeType);
}
#define DEX_COUNT_HOOK(name) \
    void name(void *wordSet, u32 index, u32 number, u32 digits, u32 style, u32 codeType) { \
        DexCount(wordSet, index, number, digits, style, codeType); \
    }
DEX_COUNT_HOOK(HOOK_DEX_COUNT_SEEN)
DEX_COUNT_HOOK(HOOK_DEX_COUNT_CAUGHT)
DEX_COUNT_HOOK(HOOK_DEX_COUNT_SEARCH)
#endif

#ifdef PW_SPECIES_DEX_SEARCH
// ---- The Pokédex's lists (overlay 302, zukan_search_engine.c). Retail makes the national list (1-649) itself; it is read
// from the search archive's national order (file 4), which Pokeweb writes with the added species after Genesect.
#define ARCID_ZUKAN_SEARCH 97
#define FILE_NATIONAL_ORDER 4
#define REGIONAL_NONE 999

void *GFL_ArcSysReadHeapNewLZGetLen(u32 arcId, u32 file, BOOL compressed, u32 heapId, u32 *length);
void *GFL_ArcToolReadHeapNewLZGetLen(void *arc, u32 file, BOOL compressed, u32 heapId, u32 *length);
void *GFL_HeapAllocate(u32 heapId, u32 size, BOOL clear, const char *file, u32 line);
void GFL_HeapFree(void *data);
u16 *PML_PersonalLoadRegionalDexTable(u32 heapId, u16 *count);

static const u8 sOrderFiles[6] = { 4, 5, 8, 9, 6, 7 };

// ZukanSearchEngine_LoadList: the national list (type 0) or the regional one, in national order.
u32 HOOK_SEARCH_LOAD_LIST(u32 type, u32 heapId, u16 **outList) {
    u32 length, i;
    u16 size, n = 0;
    u16 *national = GFL_ArcSysReadHeapNewLZGetLen(ARCID_ZUKAN_SEARCH, FILE_NATIONAL_ORDER, FALSE, heapId, &length);
    u16 *regional, *list;

    if (type == 0) {
        *outList = national;
        return length / 2;
    }
    regional = PML_PersonalLoadRegionalDexTable(heapId, &size);
    list = GFL_HeapAllocate(heapId, size * 2, FALSE, "species.c", __LINE__);
    for (i = 0; i < length / 2; i++) {
        if (regional[national[i]] != REGIONAL_NONE) list[n++] = national[i];
    }
    GFL_HeapFree(national);
    GFL_HeapFree(regional);
    *outList = list;
    return size;
}

// ZukanSearchEngine_LoadOrder: every order from its file (retail made the national order itself).
u16 HOOK_SEARCH_LOAD_ORDER(void *arc, u32 regional, u32 order, u32 heapId, u16 **list) {
    u32 length;

    *list = GFL_ArcToolReadHeapNewLZGetLen(arc, sOrderFiles[order], FALSE, heapId, &length);
    return length >> 1;
}
#endif
