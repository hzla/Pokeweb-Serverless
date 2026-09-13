#include "w2u_battle.h"
#include "w2u_battle_log.h"

namespace {

#if defined(W2U_TARGET_BW1)
#if defined(W2U_TARGET_B1)
constexpr uintptr_t kPkmDecryptAddress = 0x02017DBD;
constexpr uintptr_t kPkmReEncryptAddress = 0x02017DE5;
constexpr uintptr_t kPkmCryptoRunAddress = 0x02019A51;
constexpr uintptr_t kPkmGetBlockAddress = 0x02019C39;
#define W2U_BATTLE_LOG_SUMMARY_VALUE_HOOK THUMB_BRANCH_LINK_131_0x21D80CE
#define W2U_BATTLE_LOG_SUMMARY_FORMAT_HOOK THUMB_BRANCH_LINK_131_0x21D80E4
#define W2U_BATTLE_LOG_SUMMARY_DRAW_HOOK THUMB_BRANCH_LINK_131_0x21D80FE
constexpr uintptr_t kDrawValueStringAddress = 0x021D6215;
#else
constexpr uintptr_t kPkmDecryptAddress = 0x02017DD9;
constexpr uintptr_t kPkmReEncryptAddress = 0x02017E01;
constexpr uintptr_t kPkmCryptoRunAddress = 0x02019A6D;
constexpr uintptr_t kPkmGetBlockAddress = 0x02019C55;
#define W2U_BATTLE_LOG_SUMMARY_VALUE_HOOK THUMB_BRANCH_LINK_131_0x21D80EE
#define W2U_BATTLE_LOG_SUMMARY_FORMAT_HOOK THUMB_BRANCH_LINK_131_0x21D8104
#define W2U_BATTLE_LOG_SUMMARY_DRAW_HOOK THUMB_BRANCH_LINK_131_0x21D811E
constexpr uintptr_t kDrawValueStringAddress = 0x021D6235;
#endif
#elif defined(W2U_TARGET_B2)
constexpr uintptr_t kPkmDecryptAddress = 0x0201CC99;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCC1;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ECDD;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEC5;
#define W2U_BATTLE_LOG_SUMMARY_VALUE_HOOK THUMB_BRANCH_LINK_207_0x21B6EF6
#define W2U_BATTLE_LOG_SUMMARY_FORMAT_HOOK THUMB_BRANCH_LINK_207_0x21B6F0C
#define W2U_BATTLE_LOG_SUMMARY_DRAW_HOOK THUMB_BRANCH_LINK_207_0x21B6F26
constexpr uintptr_t kDrawValueStringAddress = 0x021B4FA1;
#else
constexpr uintptr_t kPkmDecryptAddress = 0x0201CCC5;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCED;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ED09;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEF1;
#define W2U_BATTLE_LOG_SUMMARY_VALUE_HOOK THUMB_BRANCH_LINK_207_0x21B6F36
#define W2U_BATTLE_LOG_SUMMARY_FORMAT_HOOK THUMB_BRANCH_LINK_207_0x21B6F4C
#define W2U_BATTLE_LOG_SUMMARY_DRAW_HOOK THUMB_BRANCH_LINK_207_0x21B6F66
constexpr uintptr_t kDrawValueStringAddress = 0x021B4FE1;
#endif

constexpr u16 kPk5FastModeFlag = 1 << 1;
constexpr u32 kPk5WordCount = W2U_PK5_ENCRYPTED_DATA_SIZE / sizeof(u16);
constexpr int kPk5BlockB = 1;
constexpr int kPk5BlockC = 2;

constexpr u32 kCounterDisplayMax = 999;
constexpr u32 kPackedCounterBits = 10;
constexpr u32 kPackedCounterMask = (1u << kPackedCounterBits) - 1;
constexpr u32 kBroughtShift = kPackedCounterBits;

constexpr u16 kEndOfMessageCode = 0xFFFF;
constexpr u16 kHalfWidthDigitZero = 0x0030;
constexpr u32 kWordSetEntrySize = 12;
constexpr u32 kWordSetStringPointerOffset = 8;
constexpr u16 kCounterFieldPitchPixels = 24;
constexpr u16 kSummaryRedColor = (3 << 10) | (4 << 5);

struct Pk5CoreView {
    u32 pid;
    u16 sanityFlags;
    u16 checksum;
    u8 encryptedData[W2U_PK5_ENCRYPTED_DATA_SIZE];
};

// These are the retail STRBUF/WORDSET layouts. Keep only the six numeric codes
// in the registered word; the retail summary expansion destination is just 16
// codes long, so embedding color controls is unsafe.
struct SummaryStrBuf {
    u16 capacity;
    u16 length;
    u32 magic;
    u16 codes[1];
};

struct SummaryWordSet {
    u32 max;
    u32 heapID;
    void* words;
    SummaryStrBuf* temporary;
};

static_assert(sizeof(Pk5CoreView) == W2U_PK5_SIZE,
    "Gen 5 boxed Pokemon core must remain 136 bytes");
static_assert(kCounterDisplayMax <= kPackedCounterMask,
    "Displayed battle counters must fit their packed summary value fields");

using PkmDecryptFn = b32 (*)(void*);
using PkmReEncryptFn = b32 (*)(void*, b32);
using PkmCryptoRunFn = void (*)(void*, u32, u32);
using PkmGetBlockFn = void* (*)(void*, u32, int);
using DrawValueStringFn = void (*)(
    void*, void*, void*, u32, u32, u32, u32);

static u16 Pk5Checksum(const u8* decryptedData)
{
    const u16* words = reinterpret_cast<const u16*>(decryptedData);
    u16 checksum = 0;
    for (u32 i = 0; i < kPk5WordCount; ++i) {
        checksum = static_cast<u16>(checksum + words[i]);
    }
    return checksum;
}

static u32 ClampCounterForDisplay(u16 value)
{
    return value > kCounterDisplayMax ? kCounterDisplayMax : value;
}

static u32 ReadPackedBattleCounters(const void* partyPokemon)
{
    if (!partyPokemon) {
        return 0;
    }

    // POKEMON_PASO_PARAM begins with the same 136-byte BoxPkm core used by
    // PartyPkm. Temporarily decrypt it exactly as PPP_Get does, then restore
    // its incoming fast/encrypted state after reading the reserved fields.
    Pk5CoreView* pokemon = reinterpret_cast<Pk5CoreView*>(
        const_cast<void*>(partyPokemon));
    const u16 originalSanityFlags = pokemon->sanityFlags;
    const u16 originalChecksum = pokemon->checksum;
    const bool wasAlreadyDecrypted =
        (originalSanityFlags & kPk5FastModeFlag) != 0;
    const b32 decryptedByCaller =
        reinterpret_cast<PkmDecryptFn>(kPkmDecryptAddress)(pokemon);

    if (!wasAlreadyDecrypted
        && Pk5Checksum(pokemon->encryptedData) != originalChecksum) {
        // Do not turn malformed PK5 data into a checksum-valid structure just
        // by opening its summary page. Restore its exact encrypted state.
        pokemon->sanityFlags = originalSanityFlags;
        reinterpret_cast<PkmCryptoRunFn>(kPkmCryptoRunAddress)(
            pokemon->encryptedData,
            W2U_PK5_ENCRYPTED_DATA_SIZE,
            originalChecksum);
        return 0;
    }

    const u8* blockB = static_cast<const u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, kPk5BlockB));
    const u8* blockC = static_cast<const u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, kPk5BlockC));

    u32 packed = 0;
    if (blockB && blockC) {
        const W2UPk5BattleCounterBlockB* countersB =
            reinterpret_cast<const W2UPk5BattleCounterBlockB*>(blockB);
        const W2UPk5BattleCounterBlockC* countersC =
            reinterpret_cast<const W2UPk5BattleCounterBlockC*>(blockC);
        packed = ClampCounterForDisplay(
                W2U_ReadPk5KoCounter(countersB, countersC))
            | (ClampCounterForDisplay(countersB->battlesBrought) << kBroughtShift);
    }

    reinterpret_cast<PkmReEncryptFn>(kPkmReEncryptAddress)(
        pokemon, decryptedByCaller);
    return packed;
}

static SummaryStrBuf* GetWordSetString(void* rawWordSet, u32 bufferID)
{
    SummaryWordSet* wordSet = static_cast<SummaryWordSet*>(rawWordSet);
    if (!wordSet || !wordSet->words || bufferID >= wordSet->max) {
        return nullptr;
    }

    u8* entry = static_cast<u8*>(wordSet->words)
        + bufferID * kWordSetEntrySize;
    return *reinterpret_cast<SummaryStrBuf**>(
        entry + kWordSetStringPointerOffset);
}

static bool AppendCode(SummaryStrBuf* string, u16 code)
{
    if (!string || string->length + 1 >= string->capacity) {
        return false;
    }
    string->codes[string->length++] = code;
    string->codes[string->length] = kEndOfMessageCode;
    return true;
}

static bool AppendThreeDigits(SummaryStrBuf* string, u32 value)
{
    value = value > kCounterDisplayMax ? kCounterDisplayMax : value;
    u32 hundreds = 0;
    while (value >= 100) {
        value -= 100;
        ++hundreds;
    }
    u32 tens = 0;
    while (value >= 10) {
        value -= 10;
        ++tens;
    }
    return AppendCode(string,
               static_cast<u16>(kHalfWidthDigitZero + hundreds))
        && AppendCode(string,
            static_cast<u16>(kHalfWidthDigitZero + tens))
        && AppendCode(string,
            static_cast<u16>(kHalfWidthDigitZero + value));
}

static void FormatBattleCounters(
    void* rawWordSet,
    u32 bufferID,
    u32 packedCounters)
{
    SummaryStrBuf* string = GetWordSetString(rawWordSet, bufferID);
    if (!string) {
        return;
    }

    string->length = 0;
    string->codes[0] = kEndOfMessageCode;

    const u32 kos = packedCounters & kPackedCounterMask;
    const u32 brought =
        (packedCounters >> kBroughtShift) & kPackedCounterMask;
    // Store the two displayed fields without controls. The draw hook below
    // presents each three-code slice independently so KOs can safely use red.
    AppendThreeDigits(string, kos);
    AppendThreeDigits(string, brought);
}

static void DrawBattleCounters(
    void* work,
    void* bitmapWindow,
    void* rawWordSet,
    u32 stringID,
    u32 positionX,
    u32 positionY,
    u32 defaultColor)
{
    SummaryStrBuf* string = GetWordSetString(rawWordSet, 0);
    if (!string || string->length < 6) {
        reinterpret_cast<DrawValueStringFn>(kDrawValueStringAddress)(
            work,
            bitmapWindow,
            rawWordSet,
            stringID,
            positionX,
            positionY,
            defaultColor);
        return;
    }

    u16 digits[6];
    for (u32 i = 0; i < 6; ++i) {
        digits[i] = string->codes[i];
    }

    // Each draw expands only three characters into the retail 16-code
    // scratch buffer. Separate draws also avoid changing the print system's
    // persistent palette/control state with inline color tags.
    for (u32 field = 0; field < 2; ++field) {
        string->length = 3;
        for (u32 digit = 0; digit < 3; ++digit) {
            string->codes[digit] = digits[field * 3 + digit];
        }
        string->codes[3] = kEndOfMessageCode;

        reinterpret_cast<DrawValueStringFn>(kDrawValueStringAddress)(
            work,
            bitmapWindow,
            rawWordSet,
            stringID,
            positionX + field * kCounterFieldPitchPixels,
            positionY,
            field == 0 ? kSummaryRedColor : defaultColor);
    }

    // Restore the registered word before the retail WORDSET is deleted. This
    // is not required by the current caller, but keeps the hook transparent.
    string->length = 6;
    for (u32 i = 0; i < 6; ++i) {
        string->codes[i] = digits[i];
    }
    string->codes[6] = kEndOfMessageCode;
}

} // namespace

// Summary info page: replace the original trainer-ID getter with the packed
// counters carried by this displayed PK5.
extern "C" u32 W2U_BATTLE_LOG_SUMMARY_VALUE_HOOK(
    const void* pokemon,
    u32,
    void*)
{
    return ReadPackedBattleCounters(pokemon);
}

// Replace the retail five-digit trainer-ID formatter with six numeric codes:
// KOs followed by battles brought.
extern "C" void W2U_BATTLE_LOG_SUMMARY_FORMAT_HOOK(
    void* wordSet,
    u32 bufferID,
    s32 packedCounters,
    u32,
    u32,
    u32)
{
    FormatBattleCounters(
        wordSet,
        bufferID,
        static_cast<u32>(packedCounters));
}

// Replace only the ID-value draw call. The retail shared helper remains
// untouched for every other summary string and UI screen.
extern "C" void W2U_BATTLE_LOG_SUMMARY_DRAW_HOOK(
    void* work,
    void* bitmapWindow,
    void* wordSet,
    u32 stringID,
    u32 positionX,
    u32 positionY,
    u32 defaultColor)
{
    DrawBattleCounters(
        work,
        bitmapWindow,
        wordSet,
        stringID,
        positionX,
        positionY,
        defaultColor);
}
