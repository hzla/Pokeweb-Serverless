#include "swan/swantypes.h"
#include "w2u_battle_log.h"
#include "w2u_menu_evolution_script_api.h"

namespace {

constexpr u16 kPk5FastModeFlag = 1u << 1;
constexpr u32 kPk5WordCount = W2U_PK5_ENCRYPTED_DATA_SIZE / sizeof(u16);
constexpr int kPk5BlockB = 1;
constexpr int kPk5BlockC = 2;

struct Pk5CoreView {
    u32 pid;
    u16 sanityFlags;
    u16 checksum;
    u8 encryptedData[W2U_PK5_ENCRYPTED_DATA_SIZE];
};

static_assert(sizeof(Pk5CoreView) == W2U_PK5_SIZE,
    "Gen 5 boxed Pokemon core must remain 136 bytes");

using GetVMWorkFn = u16* (*)(void*, void*);
using GetVMWorkValueFn = u16 (*)(void*, void*);
using GetPartyPokemonFn = b32 (*)(void*, u16, void**);
using GetPartyPokemonValueFn = u32 (*)(void*, u16, int);
using PkmDecryptFn = b32 (*)(void*);
using PkmReEncryptFn = b32 (*)(void*, b32);
using PkmCryptoRunFn = void (*)(void*, u32, u32);
using PkmGetBlockFn = void* (*)(void*, u32, int);

#if defined(W2U_TARGET_B2)
constexpr uintptr_t kGetVMWorkAddress = 0x021548E9;
constexpr uintptr_t kGetVMWorkValueAddress = 0x02154911;
constexpr uintptr_t kGetPartyPokemonAddress = 0x02156175;
constexpr uintptr_t kGetPartyPokemonValueAddress = 0x021561A5;
constexpr uintptr_t kPkmDecryptAddress = 0x0201CC99;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCC1;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ECDD;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEC5;
#else
constexpr uintptr_t kGetVMWorkAddress = 0x02154929;
constexpr uintptr_t kGetVMWorkValueAddress = 0x02154951;
constexpr uintptr_t kGetPartyPokemonAddress = 0x021561B5;
constexpr uintptr_t kGetPartyPokemonValueAddress = 0x021561E5;
constexpr uintptr_t kPkmDecryptAddress = 0x0201CCC5;
constexpr uintptr_t kPkmReEncryptAddress = 0x0201CCED;
constexpr uintptr_t kPkmCryptoRunAddress = 0x0201ED09;
constexpr uintptr_t kPkmGetBlockAddress = 0x0201EEF1;
#endif

static u16 ReadU16(const u8* data)
{
    return static_cast<u16>(data[0] | (data[1] << 8));
}

static u16 Pk5Checksum(const u8* decryptedData)
{
    const u16* words = reinterpret_cast<const u16*>(decryptedData);
    u16 checksum = 0;
    for (u32 index = 0; index < kPk5WordCount; ++index) {
        checksum = static_cast<u16>(checksum + words[index]);
    }
    return checksum;
}

static bool IsCounterParameter(u16 parameter)
{
    return parameter >= W2U_SCR_POKEPARA_KOS
        && parameter <= W2U_SCR_POKEPARA_BATTLES_USED;
}

static bool IsRetailParameter(u16 parameter)
{
    // This is the exact US B2/W2 allowlist used by retail command 0x010C.
    // Keeping the check here preserves its behavior for every existing
    // script while the three IDs above take the extension path.
    static const u8 parameters[] = {
        5, 6, 10, 12, 109, 110, 111, 112, 117, 119,
        153, 154, 158, 162, 163, 164, 165, 166, 178, 160,
    };
    for (u32 index = 0; index < sizeof(parameters); ++index) {
        if (parameters[index] == parameter) {
            return true;
        }
    }
    return false;
}

static void RestoreMalformedPokemon(
    Pk5CoreView* pokemon,
    u16 originalSanityFlags,
    u16 originalChecksum,
    bool wasAlreadyDecrypted,
    b32 decryptedByCaller)
{
    if (wasAlreadyDecrypted) {
        reinterpret_cast<PkmReEncryptFn>(kPkmReEncryptAddress)(
            pokemon, decryptedByCaller);
        return;
    }

    // PkmDecrypt has already changed the sanity flags and decrypted the
    // payload. Restore the corrupt structure exactly instead of making its
    // bad checksum valid merely because a field script inspected it.
    pokemon->sanityFlags = originalSanityFlags;
    reinterpret_cast<PkmCryptoRunFn>(kPkmCryptoRunAddress)(
        pokemon->encryptedData,
        W2U_PK5_ENCRYPTED_DATA_SIZE,
        originalChecksum);
}

static bool ReadBattleCounter(void* rawPokemon, u16 parameter, u16* value)
{
    if (!rawPokemon || !value || !IsCounterParameter(parameter)) {
        return false;
    }

    Pk5CoreView* pokemon = static_cast<Pk5CoreView*>(rawPokemon);
    const u16 originalSanityFlags = pokemon->sanityFlags;
    const u16 originalChecksum = pokemon->checksum;
    const bool wasAlreadyDecrypted =
        (originalSanityFlags & kPk5FastModeFlag) != 0;
    const b32 decryptedByCaller =
        reinterpret_cast<PkmDecryptFn>(kPkmDecryptAddress)(pokemon);

    if (Pk5Checksum(pokemon->encryptedData) != originalChecksum) {
        RestoreMalformedPokemon(
            pokemon,
            originalSanityFlags,
            originalChecksum,
            wasAlreadyDecrypted,
            decryptedByCaller);
        return false;
    }

    const u8* blockB = static_cast<const u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, kPk5BlockB));
    const u8* blockC = static_cast<const u8*>(
        reinterpret_cast<PkmGetBlockFn>(kPkmGetBlockAddress)(
            pokemon, pokemon->pid, kPk5BlockC));

    bool valid = blockB && blockC;
    if (valid) {
        switch (parameter) {
        case W2U_SCR_POKEPARA_KOS:
            *value = W2U_ReadPk5KoCounter(
                reinterpret_cast<const W2UPk5BattleCounterBlockB*>(blockB),
                reinterpret_cast<const W2UPk5BattleCounterBlockC*>(blockC));
            break;
        case W2U_SCR_POKEPARA_BATTLES_BROUGHT:
            *value = ReadU16(blockB + W2U_PK5_COUNTERS_IN_BLOCK_OFFSET);
            break;
        case W2U_SCR_POKEPARA_BATTLES_USED:
            *value = ReadU16(
                blockB + W2U_PK5_COUNTERS_IN_BLOCK_OFFSET + sizeof(u16));
            break;
        default:
            valid = false;
            break;
        }
    }

    reinterpret_cast<PkmReEncryptFn>(kPkmReEncryptAddress)(
        pokemon, decryptedByCaller);
    return valid;
}

static u32 GetPartyPokeParameterHook(void* core, void* work)
{
    GetVMWorkFn getWork = reinterpret_cast<GetVMWorkFn>(kGetVMWorkAddress);
    GetVMWorkValueFn getValue =
        reinterpret_cast<GetVMWorkValueFn>(kGetVMWorkValueAddress);
    u16* destination = getWork(core, work);
    const u16 partySlot = getValue(core, work);
    const u16 parameter = getValue(core, work);
    u16 value = 0;

    if (IsCounterParameter(parameter)) {
        void* pokemon = nullptr;
        if (reinterpret_cast<GetPartyPokemonFn>(kGetPartyPokemonAddress)(
                work, partySlot, &pokemon)) {
            ReadBattleCounter(pokemon, parameter, &value);
        }
    } else if (IsRetailParameter(parameter)) {
        value = static_cast<u16>(
            reinterpret_cast<GetPartyPokemonValueFn>(
                kGetPartyPokemonValueAddress)(work, partySlot, parameter));
    }

    if (destination) {
        *destination = value;
    }
    return 0;
}

} // namespace

#if defined(W2U_TARGET_B2)
extern "C" u32 THUMB_BRANCH_12_0x2156FDC(void* core, void* work)
{
    return GetPartyPokeParameterHook(core, work);
}
#else
extern "C" u32 THUMB_BRANCH_12_0x215701C(void* core, void* work)
{
    return GetPartyPokeParameterHook(core, work);
}
#endif
