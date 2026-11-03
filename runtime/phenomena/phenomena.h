#pragma once
// Configuration block shared by the four phenomenon DLLs. Pokeweb writes it in
// place at install time (src/pokeweb/phenomenaModel.ts mirrors this layout).
// All fields are little-endian; the block is 4-byte aligned.

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

#define PHEN_MAGIC 0x314e4850u /* "PHN1" */
#define PHEN_VERSION 1
#define PHEN_KIND_DUST 0
#define PHEN_KIND_SHADOW 1
#define PHEN_KINDS 2
#define PHEN_MAX_ITEMS 48
#define PHEN_MAX_GROUPS 8
#define PHEN_MAX_ZONES 32
#define PHEN_INHERIT 0xffffu
#define PHEN_PERMILLE 1000u

typedef struct {
    u16 item;
    u16 weight;
} PhenEntry;

typedef struct {
    u16 count; /* 0 in a zone group: use the phenomenon's default items */
    u16 reserved;
    PhenEntry entries[PHEN_MAX_ITEMS];
} PhenTable;

typedef struct {
    u8 kind; /* PHEN_KIND_* */
    u8 zoneCount;
    u16 encounterPermille; /* PHEN_INHERIT: use the phenomenon's default */
    u16 zones[PHEN_MAX_ZONES];
    PhenTable items;
} PhenGroup;

typedef struct {
    u32 magic;
    u16 version;
    u16 groupCount;
    u16 encounterPermille[PHEN_KINDS];
    PhenTable items[PHEN_KINDS];
    PhenGroup groups[PHEN_MAX_GROUPS];
} PhenConfig;

_Static_assert(sizeof(PhenEntry) == 4, "entry layout");
_Static_assert(sizeof(PhenTable) == 196, "table layout");
_Static_assert(sizeof(PhenGroup) == 264, "group layout");
_Static_assert(sizeof(PhenConfig) == 2516, "config layout");

/* The active phenomenon as both games store it: zone id at 0x00, kind at 0x0C. */
#define PHEN_SPOT_ZONE(spot) (*(const u16 *)(spot))
#define PHEN_SPOT_KIND(spot) (((const u8 *)(spot))[12])
#define PHEN_NATIVE_DUST_CLOUD 4
#define PHEN_NATIVE_FLYING_SHADOW 7
